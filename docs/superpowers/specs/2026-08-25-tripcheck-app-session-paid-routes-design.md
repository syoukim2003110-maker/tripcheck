# TripCheck: app セッションで place-resolution を通す — 設計

**日付**: 2026-08-25
**ブランチ**: `claude/app-session-paid-routes`(`claude/architecture-v2` から分岐)
**前提 spec**: `docs/superpowers/specs/2026-08-25-tripcheck-worker-auth-design.md`(App Attest → 短命セッションの認証基盤)

---

## 1. 目的と信頼モデル

Worker 認証(App Attest)で「本物の TripCheck.app が動く本物の Apple 端末」だけが通れる**第二の門**を作り、短命セッション `X-TripCheck-App-Session` を発行できるようになった。だがそのセッションは今日まで `GET /api/app/ping`(トークン検証のみ)しか通せず、**実際の paid ルートには一切効いていない**。認証基盤は「鍵と扉」で、まだ何も開けていない未使用の配管だった。

この spec は、その発行済みセッションを使って **1 本の paid ルート `POST /api/place-resolution`** を iOS から通せるようにする。ユーザーに見える成果は「打った地名が、Apple のローカル検索(未検証)ではなく **Google が検証した停留所**(実座標・住所・`providerRef`・`verifiedAt`・`sourceUrl` 付き)に解決される」こと。

信頼モデルは認証基盤を継承する:
- 通行証はサーバ発行の短命 HMAC トークン。`verifySession` が「この Worker が発行した、失効していないセッションか」を検証する。偽造は署名鍵無しには不可能。
- ブラウザの同一オリジン門は**据え置き**。app セッションはそれに**並ぶ第二の認可**であって置換ではない。
- fail-closed を継承。署名鍵が無ければ 503、セッションが無効/期限切れなら paid ゲートは 403。

**信頼の非目標**: この spec は「本物の端末が本物のアプリで解決を要求している」ことまでを保証する。個々の解決結果が地理的に正しいことは Google の責任範囲であり、TripCheck は Google の応答を写すだけ(表示・座標として使うが、TripCheck 自身が真偽を再判定はしない)。

## 2. スコープ / 非スコープ

**スコープ:**
- Worker の paid 認可に「有効な app セッション」の OR 分岐を1箇所足す(`worker/index.ts` の `handlePaidApi`)。
- app 認証リクエストの quota 識別子を cookie ではなく `keyId` でキーする。
- iOS: `WorkerClient` に認証付き `resolvePlaces` を追加(トークン付与 + 401 再試行)。web の place-resolution 応答に対応する `Decodable` を新設。
- iOS: `ApplePlaceResolver` の兄弟 `WorkerPlaceResolver` を新設し、解決チェーンの先頭に置く(Google 優先・ローカル代替)。`any WorkerAuthenticating` を `PlannerStore` に注入。
- テスト: web は hermetic(実 Google を呼ばない)で越境オリジン+有効セッション=通過を追加。iOS は Fake を注入して成功/代替を検証。手動 E2E 手順書。

**非スコープ(次 spec 以降):**
- 推薦(hotel/food/route)・live-routes・place-intelligence など**ほかの paid ルート**。
- **Worker のデプロイ**(本番 URL・本番 secret 運用)。今回はローカル(`pnpm dev`)のみ。
- **レート制限・鍵失効・リスクメトリクスの運用設計**(認証基盤 spec が先送りした項目のまま)。
- paid ゲートでの **appId 再検査**(keyStore 経由の防御多重化)。§4.1 の判断参照。
- `ambiguous`(要トラベラー選択)の**新規 UI**。既存のレビュー導線を再利用する(§4.5)。
- 既存 web(ブラウザ)の挙動変更。既存テスト全緑で不変を担保する。

## 3. アーキテクチャ

```
iOS                                   Worker (Cloudflare)             Next.js handler
────────────────────────────────     ──────────────────────────     ─────────────────────────
PlannerStore.resolve(queries)
  → resolvers[0] = WorkerPlaceResolver
       ├─ ensureSession() (App Attest / bypass)
       └─ POST /api/place-resolution
            X-TripCheck-App-Session: v1.<keyId>...    ── handlePaidApi ──────────
                                                         authorized =
                                                           sameOrigin(browser)
                                                           OR verifySession(app).ok  ← 新規 OR
                                                         quotaIdentity = app:<keyId>  ← 新規
                                                         (feature flag / durable quota は既存)
                                                                                    → POST route.ts
                                                                                      (ハンドラ本体は不変)
                                                                                      fetchGooglePlaceResolutions
       ← { places, hotel, ambiguous } ────────────────────────────────────────────┘
  成功 → google- 検証済み停留所を返す
  失敗/未認証/オフライン/タイムアウト
       → resolvers[1]=ApplePlaceResolver, [2]=CatalogResolver へ落とす
```

- **既存ルートのハンドラ本体(`app/api/place-resolution/route.ts`, `lib/google-place-resolver.ts`)は 1 バイトも変えない。** 認可の追加は Worker 層(`worker/index.ts`)のみ。
- 既存 web の挙動不変は既存テスト全緑で担保する。

## 4. 詳細設計

### 4.1 Worker: 認可の OR ゲート

差し込み口は `handlePaidApi` 内の認可判定 1 箇所(`worker/index.ts:328-330` 付近の `const authorized = …`)。現状:

```ts
const authorized =
  route.origin === "signed_resource"
    ? await signedResourceIsAuthorized(request, url, env)
    : paidRequestIsSameOrigin(request, env);
```

変更後:

```ts
const appSession = appSessionIsAuthorized(request, env, nowSeconds);
const authorized =
  route.origin === "signed_resource"
    ? await signedResourceIsAuthorized(request, url, env)
    : (paidRequestIsSameOrigin(request, env) || appSession.ok);
```

`appSessionIsAuthorized(request, env, nowSeconds)` は新規の薄いヘルパー(`worker/index.ts` ローカル、または `lib/server/app-attest/` に隣接):
- `env.TRIPCHECK_APP_API_DISABLED` が空でなければ `{ ok: false }`(キルスイッチはここでも尊重)。
- ヘッダ `X-TripCheck-App-Session` を読み、長さガード(1–512)。無ければ `{ ok: false }`。
- `verifySession(env, token, nowSeconds)` を呼ぶ。`{ ok: true, keyId }` を返すのは verdict が `ok:true` のときのみ。`no_signing_secret` は `{ ok: false, code: "no_signing_secret" }` として上に伝え、paid ゲートは同一オリジンでもない限り 503 を返せる(fail-closed)。

**判断★: paid ゲートでは `verifySession` の `ok:true` で十分とし、keyStore による appId 再検査はしない。**
- 根拠: セッションは attest/assert で `TRIPCHECK_APP_IDS` 許可リストを通過した後にしか発行されない(認証基盤 spec §5.2/§5.5)。有効な署名付きセッションを持つ = 許可 app が attest 済み、を含意する。
- TTL 24 時間が陳腐化の窓を限定する。許可リスト変更・鍵失効の途中反映は運用設計(非スコープ)側の課題。
- この判断により **bypass セッション**(keyId=`bypass-local`、keyStore 記録なし)も通る。bypass トークンは `.dev.vars` 専用で本番に存在しないため、ローカルでのみ bypass セッションが paid を認可する。Simulator(App Attest 非対応)で縦切りを E2E できる、という開発上の利点がある。

**エラー応答**: app セッションが無い/無効/期限切れで、かつ同一オリジンでもないリクエストは、現状どおり **403 `{"code":"forbidden"}`**。`no_signing_secret` のみ 503。ブラウザ由来のリクエストの応答は不変。

### 4.2 Worker: quota 識別子

`quotaIdentity(request)`(`worker/index.ts:174-187`)は `tc_paid_session` cookie を読む/発行する。ネイティブアプリはこの cookie を送らない。

**判断★: app 認証リクエストは `keyId` を quota 識別子にする(例 `app:<keyId>`)。**
- `handlePaidApi` は認可判定で得た `appSession`(`{ ok, keyId }`)を持っているので、`authorized` が app セッション由来のときは `quotaIdentity` の戻りを `app:<keyId>` に差し替える(同一オリジン由来のときは従来どおり cookie)。
- 既存の durable provider quota 機構(`enforceDurableProviderQuota`)はそのまま流用。**新しいレート制限は設計しない**(認証基盤 spec の先送り方針を踏襲)。bypass セッションは全て keyId=`bypass-local` に集約されるが、ローカル専用なので許容。

### 4.3 iOS: `WorkerClient.resolvePlaces`

`WorkerAuthenticating` プロトコル(`WorkerAuthState.swift`)に認証付きメソッドを1本追加:

```swift
func resolvePlaces(_ request: PlaceResolutionRequest) async -> PlaceResolutionResult?
```

- 戻りは失敗時 `nil`(呼び出し側=リゾルバはこれを「ローカルへ代替せよ」の合図にする)。
- `WorkerClient`(actor)実装: `ensureSession()` でトークンを確保 → `URLSessionWorkerTransport.send` で `POST /api/place-resolution`、`X-TripCheck-App-Session` を付与(transport は既に対応)。**`ping` と同じ 401→トークン破棄→再認証→1 回だけ再試行**。
- タイムアウト: リゾルバ層で既存の 6s レース(`ApplePlaceResolver` の `race`)に倣った上限を設ける。到達不能・タイムアウトは `nil`。
- 新規 `Decodable`:
  - `PlaceResolutionRequest`(送信): `queries: [String]`, `languageCode: "en"|"ja"`, `destination: String`(MVP は `"auto"`)。`providerOverrides` は空、`hotelQuery` は `nil`(ホテルは別機能=送らない)。
  - `PlaceResolutionResult`(受信): `provider: String`, `fetchedAt: String`, `places: [WorkerResolvedStop]`, `hotel: WorkerResolvedStop?`, `ambiguous: [WorkerAmbiguous]`。
  - `WorkerResolvedStop`: web `ResolvedInputStop` を写す — `id, providerRef?, name, area, latitude, longitude, sourceUrl, verifiedAt, confidence("low"|"medium"), planningDurationMinutes, isAnchor, placeTypes?, address, countryCode?, input, inputIndex?`。
  - `WorkerAmbiguous`: `{ input: String, candidates: [WorkerResolvedStop] }`。

### 4.4 iOS: `WorkerPlaceResolver` と注入

`ApplePlaceResolver` と同じリゾルバ・プロトコルに準拠する兄弟を新設し、`TripCheckApp` の合成ルートで `resolvers` の**先頭**に置く:

```
resolvers: [WorkerPlaceResolver(client:), ApplePlaceResolver(), CatalogResolver()]
```

- `WorkerPlaceResolver` は入力(打たれた地名群)を `PlaceResolutionRequest` に詰めて `client.resolvePlaces` を呼ぶ。
- 成功(`nil` でない)→ `places` を iOS ドメインの**検証済み**停留所に写像(§4.5)。`ambiguous` は既存レビュー導線へ(§4.5)。
- 失敗(`nil`)→ 解決を返さず、チェーンの次(`ApplePlaceResolver` → `CatalogResolver`)が処理する。**現状のオンデバイス挙動が下限**なので、Google が使えなくても解決は壊れない。
- 注入: `any WorkerAuthenticating` を `WorkerAvailability.makeDefaultClient` 経由で `PlannerStore` に渡す。UI テストでは `CannedWorkerClient` を差し、決定的に成功/失敗を演じる。

### 4.5 データ写像と ambiguous

- web `ResolvedInputStop` → iOS ドメインの「paid が検証した」枠へ: `id` は `google-` 接頭辞、`provider = .google`、`providerRef`/`verifiedAt`/`sourceUrl` を非空で保持、座標・`address`(→ area/住所相当)・`countryCode`・`placeTypes` を保持。`confidence` は `low|medium` の 2 値をそのまま持つ(`.high` は無い)。
- **判断★: `ambiguous` は既存のレビュー導線(`ResolutionPipeline.review` 相当)に流す。** Apple 側が候補提示に使う「候補から選ぶ」UI をそのまま再利用し、MVP で新規 UI は作らない。`places`(自動確定)は `autoAccept` に相当。
- `hotel` フィールドは place-resolution の付随物だが、今回は `hotelQuery` を送らないので常に `nil`。デコードはするが使わない。

## 5. エラー処理・代替マトリクス

| 状況 | Worker 応答 | iOS 挙動 |
|---|---|---|
| 有効セッション + Google 成功 | 200 `{places,…}` | `google-` 検証済み停留所 |
| セッション無 / 無効 / 期限切れ(同一オリジンでもない) | 403 forbidden | `nil` → ローカル代替 |
| 署名鍵無し | 503 no_signing_secret | `nil` → ローカル代替 |
| app API キルスイッチ ON | 403(paid) | `nil` → ローカル代替 |
| Google キー未設定 | 503 not_configured | `nil` → ローカル代替 |
| Google 5xx / タイムアウト | 502 unavailable | `nil` → ローカル代替 |
| オフライン / 到達不能 | (応答なし) | `nil` → ローカル代替 |
| `ambiguous` 返却 | 200 | 既存レビュー導線へ |

ネットワーク失敗はユーザーに赤いエラーを出さず、静かに Apple 結果へ落とす。認証の 401 は 1 回だけ自動再試行(`ping` と同型)。

## 6. テスト

**web(hermetic、実 Google を呼ばない):**
- `tests/worker-durable-quota.test.ts` を拡張: (a) 越境オリジン + 有効 `X-TripCheck-App-Session` → **200 通過**、(b) 越境 + 無効/期限切れセッション → **403**、(c) 越境 + セッション無 → 403(既存)。app セッションは既存 `issueSession`(テストヘルパ)で発行。
- `tests/api-route-policy-exhaustive.test.ts` はマニフェスト構造(route→[class,operation,origin])を変えないので**不変**。origin ルールは書き換えない(認可の追加は Worker の実行時分岐であって、ルート分類ではない)。
- quota が `app:<keyId>` でキーされることを、同一 keyId の連続リクエストが同じ quota バケットを消費する形で確認。

**iOS(XCTest、実 Google を呼ばない):**
- `FakeWorkerClient`(`resolvePlaces` を制御)を注入し、`WorkerPlaceResolver` 単体で: 成功→`google-` 検証済みが出る / `nil`→次リゾルバへ委譲、を検証。
- `PlannerStore` レベルで、Worker 成功時に検証済み停留所が採用され、失敗時に Apple 結果へ代替することを確認。
- 既存の CopyBoundary / BannedTerms を緑に保つ(新規 Swift リテラルは AppCopy 経由、`google_maps` 等の provider 語は許可リストの扱いに従う)。

**手動 E2E(ローカル):**
- 手順書 `apple/docs/paid-route-check.md` を追加。`.dev.vars` に実 `GOOGLE_PLACES_API_KEY` + `TRIPCHECK_APP_ATTEST_BYPASS_TOKEN` を置き、`pnpm dev`。Simulator が bypass セッションで `place-resolution` を通し、実 Google 検証停留所(`google-` id・非空 `sourceUrl`)が UI に出ることを確認。実機は実 App Attest で同じ確認。

## 7. 環境変数

新規は無し。既存を継承:
- `TRIPCHECK_APP_IDS`, `TRIPCHECK_APP_ATTEST_BYPASS_TOKEN`, `TRIPCHECK_APP_API_DISABLED`, 署名鍵チェーン(認証基盤 spec §5.5)。
- `GOOGLE_PLACES_API_KEY`(place-resolution が既に要求)。
- iOS: `TRIPCHECK_WORKER_BASE_URL` / Info.plist `TripCheckWorkerBaseURL`(現状 `http://127.0.0.1:3000`)、`TRIPCHECK_WORKER_BYPASS_TOKEN`(Simulator 用)。

## 8. Global Constraints(実装時に全タスク共通で守る)

- **web で触ってよいのは `worker/index.ts`(認可 OR + quota キー)と `tests/`(ケース追加)のみ。** `lib/` と `app/api/**` のハンドラ本体は不変。`app/api/place-resolution/route.ts` と `lib/google-place-resolver.ts` は読み取り専用。
- **iOS は Swift 6 strict concurrency で新規警告ゼロ。** 日本語リテラルは `AppCopy.swift` のみ。絵文字禁止。
- **`TripCheckKit`(エンジン)は不可侵。** place-resolution の Decodable・リゾルバは AppCore/app 側に置く。
- **表示・データとしての利用は可**(検証済み座標は実際にルート構築に使う)。ただし TripCheck 自身が Google の真偽を再判定しない。
- コミット trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` と `Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J`。
- `git push` はしない(ユーザーが `! git push`)。ローカルのみ。
