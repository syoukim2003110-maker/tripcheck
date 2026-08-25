# TripCheck Worker 認証 設計仕様(2026-08-25)

対象: `apple/` の iOS アプリと、既存 Cloudflare Worker(`worker/index.ts`)の間の認証基盤。
前提 spec: `docs/superpowers/specs/2026-08-21-tripcheck-swift-v1-design.md`(「アプリ用認証を次 spec で追加」)、
`docs/superpowers/specs/2026-08-23-apple-capabilities-proposal.md` §3.7(App Attest 採用・DeviceCheck 却下)。

## 1. 目的と信頼モデル

Worker の門は今日まで「ブラウザの同一オリジン証明」(Origin + `Sec-Fetch-Site`)だけで守られており、
ネイティブアプリはその証明を出せないので門を通れない。この spec は
**「本物の TripCheck.app が動く本物の Apple 端末」だけが通れる第二の門**を作る。

- 身元の根拠は **App Attest**。Secure Enclave が持つ鍵と Apple 発行の証明書チェーンにより、
  偽クライアント(スクリプト・改造アプリ・エミュレータ)はアテステーションを偽造できない。
- 入場の形は **attest → 短命セッション**(ユーザー裁定 2026-08-25)。
  アサーションはセッション取得・更新時だけに使い、以降は Worker 発行の
  短命トークン(`X-TripCheck-App-Session`)で通行する。既存の `tc_paid_session` と同格の
  識別子なので、将来のクォータ紐付けにそのまま載る。
- **DeviceCheck は不採用**(capabilities 提案の結論を踏襲): 実機であることしか証明できず、
  リクエスト単位の完全性とクォータ紐付けができない。

ユーザーに見える新機能はまだ無い。完成の証明は「認証付き `GET /api/app/ping` が通ること」。

## 2. スコープ / 非スコープ

**スコープ(この spec で作るもの):**
- Worker 側: `/api/app/*` 4 エンドポイント(challenge / attest / assert / ping)、
  App Attest 検証器(CBOR + X.509 チェーン)、D1 鍵台帳、dev バイパス、キルスイッチ
- アプリ側: `WorkerClient`(AppCore)、Keychain の keyId 保管、起動引数ゲートの診断画面、
  entitlements 追加
- テスト: web 側(合成ミニ CA)・apple 側(unit + UI)・Simulator+バイパスの半自動 E2E・実機手順書

**非スコープ(次 spec 以降):**
- 既存 paid ルート(Google 解決・推薦等)へのアプリセッション適用
- Cloudflare への本番デプロイ、production 環境への attest 切替
- リスクメトリクス・鍵失効・レート制限の運用設計
- Kit(TripCheckKit)への変更 — 消費者がまだ無いので **Kit は 1 行も変えない**

## 3. アーキテクチャ

```
[iOS app]                                [Cloudflare Worker (worker/index.ts)]
WorkerClient (AppCore, actor)            /api/app/* 早期分岐(同一オリジン検査より前)
 ├ AppAttesting(DCAppAttestService 抽象)   ├ lib/server/app-attest/ … 検証器・トークン発行
 ├ WorkerTransport(URLSession 抽象)        ├ D1: app_attest_keys(keyId・公開鍵・counter)
 ├ AttestKeyStore(Keychain)               └ 既存ルートは 1 バイトも変えない
 └ 診断画面(-workerDiagnostics 時のみ)
```

- Worker 側の変更は「`worker/index.ts` の早期分岐 1 箇所 + `lib/server/app-attest/` 新設 +
  D1 テーブル 1 枚 + テスト」。web 不可侵制約はこの範囲に限り緩和(ユーザー裁定 2026-08-25)。
  既存 web の挙動不変は既存テスト全緑で担保する。
- アプリ側は既存パターンの写し: プロトコル + 実装 + canned + 可用性判定は composition root のみ
  (`IntentAvailability` と同型の `WorkerAvailability.makeDefaultClient(uiTesting:)`)。

## 4. プロトコル仕様

共通: リクエスト/レスポンスとも JSON(`content-type: application/json`)。エラーは
`{ "error": "<code>" }`。コードは `bad_request`(400) / `challenge_invalid` / `challenge_expired` /
`attestation_invalid` / `assertion_invalid` / `unknown_key` / `counter_regressed` /
`app_id_mismatch` / `environment_rejected` / `bypass_disabled` / `session_invalid` /
`session_expired`(以上 401) / `disabled` / `no_signing_secret`(以上 503)。
署名の秘密鍵は既存 `lib/server/hmac-signature.ts` の `signingSecret()` チェーン
(`TRIPCHECK_PHOTO_TOKEN_SECRET` → `TRIPCHECK_QUOTA_HASH_SECRET` → `GOOGLE_PLACES_API_KEY`)を流用し、
**新規シークレットは作らない**。秘密鍵が無ければ 503 `no_signing_secret`(fail-closed)。

### 4.1 チャレンジ `POST /api/app/challenge`

- リクエスト body: `{}`(空 JSON)
- レスポンス: `{ "challenge": "v1.<issuedAt>.<nonce>.<sig>" }`
  - `issuedAt` = epoch 秒(10 進)、`nonce` = 乱数 16 バイトの hex 32 文字
  - `sig` = HMAC-SHA256 base64url、ペイロード `"tc-app-challenge-v1\n<issuedAt>\n<nonce>"`
- サーバは何も保存しない(stateless)。検証時の有効窓: `issuedAt - 60 ≤ now ≤ issuedAt + 300`
  (TTL 5 分 + 時計ずれ 60 秒)
- クライアントは challenge 文字列を不透明値として扱い、
  `clientDataHash = SHA256(challenge の UTF-8 バイト)` を作る

### 4.2 初回登録 `POST /api/app/attest`

- リクエスト: `{ "keyId": "<base64url>", "attestation": "<base64>", "challenge": "<challenge>" }`
- 検証(§5.2)後、鍵を D1 に upsert し、セッションを発行
- レスポンス: `{ "session": "<token>", "expiresAt": <epoch秒> }`
- 同じ keyId の再 attest は upsert(counter は 0 に戻さず保持)。リプレイしても新しい権限は生まれない
- `keyId` は wire 上も D1 上も **base64url・パディングなし**に正規化する
  (`DCAppAttestService.generateKey()` は標準 base64 を返すのでアプリ側で変換)

### 4.3 再入場 `POST /api/app/assert`

- リクエスト: `{ "keyId": "<base64url>", "assertion": "<base64>", "challenge": "<challenge>" }`
- D1 に keyId が無ければ 401 `unknown_key` — クライアントはこれを合図に attest からやり直す
- 検証(§5.2)後、counter を更新しセッションを発行。レスポンスは attest と同形

### 4.4 セッショントークンと `GET /api/app/ping`

- トークン形式: `v1.<keyId>.<issuedAt>.<expiresAt>.<sig>`(stateless、D1 に保存しない)
  - `sig` のペイロード: `"tc-app-session-v1\n<keyId>\n<issuedAt>\n<expiresAt>"`
  - TTL 24 時間(`expiresAt = issuedAt + 86400`)
- 送り方: リクエストヘッダ `X-TripCheck-App-Session: <token>`
- `GET /api/app/ping` はトークン検証のみ行い、`{ "ok": true, "expiresAt": <epoch秒> }` を返す。
  これが E2E の証明点。期限切れは 401 `session_expired`、改竄は 401 `session_invalid`
- クライアントはトークンを**メモリにのみ**保持(§7)。期限切れ・401 を合図に assert で再入場

### 4.5 dev バイパスとキルスイッチ

- 環境変数 `TRIPCHECK_APP_ATTEST_BYPASS_TOKEN` が**設定されている場合に限り**、
  `POST /api/app/attest` の body `{ "bypassToken": "<値>", "challenge": "<challenge>" }` が
  合成 keyId `bypass-local` のセッションを発行する(Simulator 用)。
  未設定なら分岐ごと存在せず 401 `bypass_disabled`。`.dev.vars` 専用で、本番には置かない
- `TRIPCHECK_APP_API_DISABLED` が空でなければ `/api/app/*` 全体が 503 `disabled`
  (既存キルスイッチ群と同じ流儀)

## 5. Worker 側実装

### 5.1 ファイル配置と分岐

- `worker/index.ts`: fetch ハンドラの先頭付近(静的資産・画像最適化の後、同一オリジン検査を含む
  paid ルート処理の前)に `url.pathname が "/api/app/" で始まるか "/api/app" 系 4 ルートに一致`
  したら `handleAppGateway(request, env)` に委譲して return する分岐を **1 箇所**追加
- `lib/server/app-attest/` 新設(すべて依存追加ゼロ・WebCrypto のみ・Node 22 の `node --test` と
  Worker で同一コード):
  - `cbor.ts` — 最小 CBOR デコーダ(map / bytes / text / array / uint。attestation 読取に必要な分だけ)
  - `der.ts` — 最小 DER 読取(X.509 の tbs/署名/SPKI/拡張の切り出し、ECDSA 署名の DER→raw 変換)
  - `certificate-chain.ts` — `AppAttestVerifier` 相当。**ルート CA を注入可能**にする
    (本番は §5.5 の Apple ルート証明書定数、テストは自前ミニ CA)。有効期間も検証
  - `attestation.ts` — §5.2 の attest 検証手順
  - `assertion.ts` — §5.2 の assert 検証手順
  - `app-session.ts` — チャレンジ・セッショントークンの発行/検証(`hmac-signature.ts` を利用)
  - `key-store.ts` — D1 台帳 + D1 不在時の process-local フォールバック(§5.3)
  - `gateway.ts` — ルーティング表 `APP_GATEWAY_ROUTES` と `handleAppGateway()`本体
- Apple App Attest Root CA(PEM、2045-03-15 失効、P-384)は `certificate-chain.ts` に定数で同梱:

```text
-----BEGIN CERTIFICATE-----
MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw
JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK
QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa
Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv
biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y
bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh
NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au
Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/
MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw
CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn
53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV
oyFraWVIyd/dganmrduC1bmTBGwD
-----END CERTIFICATE-----
```

### 5.2 検証手順(Apple 文書の手順をそのまま実装する)

**attest(初回)**:
1. attestation を base64 デコードし CBOR として読む。`fmt == "apple-appattest"` を要求
2. `attStmt.x5c = [credCert, intermediate]`。チェーン credCert ← intermediate ← ルート CA を
   検証(各リンクは WebCrypto ECDSA。ルートは注入されたもの。全証明書の有効期間内であること)
3. `clientDataHash = SHA256(challenge)`、`nonce = SHA256(authData || clientDataHash)`
4. credCert の拡張 OID `1.2.840.113635.100.8.2`(OCTET STRING 内の DER SEQUENCE の
   `[1]` 要素 OCTET STRING)が nonce と一致すること
5. credCert の公開鍵(非圧縮 EC 点 65 バイト)の SHA256 が keyId(base64url デコード後の
   32 バイト)と一致すること
6. authData の検証: `rpIdHash(先頭 32 バイト) == SHA256("T8L5BPC2XJ.com.muraoshoki.tripcheck")`
   (許可 App ID は環境変数 §5.5。複数可)/ `counter(33..37 ビッグエンディアン) == 0` /
   `aaguid(37..53)` が許可環境のもの(development = ASCII "appattestdevelop"、
   production = "appattest" + 0x00×7)/ `credentialId(55..) == keyId`
7. D1 に upsert: keyId・公開鍵(非圧縮点の base64url)・counter(既存行があれば保持、無ければ 0)・
   環境・App ID・時刻
8. セッション発行

**assert(再入場)**:
1. assertion を CBOR として読む: `{ signature(DER ECDSA), authenticatorData }`
2. keyId で D1 から公開鍵・counter を取得(無ければ `unknown_key`)
3. `clientDataHash = SHA256(challenge)`、`nonce = SHA256(authenticatorData || clientDataHash)`
4. 公開鍵で `signature` を検証(P-256 / SHA-256。DER→raw 変換して WebCrypto へ)
5. `rpIdHash == SHA256(登録時の App ID)` / `counter(33..37) > 保存済み counter`
   (等しい・小さいは `counter_regressed`)
6. counter を保存し、セッション発行

### 5.3 D1 スキーマとフォールバック

```sql
CREATE TABLE IF NOT EXISTS app_attest_keys (
  key_id       TEXT PRIMARY KEY,
  public_key   TEXT NOT NULL,
  counter      INTEGER NOT NULL DEFAULT 0,
  environment  TEXT NOT NULL,
  app_id       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
```

- 初期化は既存 `db/provider-quota-schema.ts` と同じ流儀(CREATE TABLE IF NOT EXISTS を
  実行してから使う)に従う
- D1(`env.DB`)不在時は process-local の Map による台帳に落ちる
  (既存 `ProcessLocalProviderLedger` と同じ fail-safe 思想。isolate が変わると鍵が消え、
  クライアントは `unknown_key` → 再 attest で自己回復する。dev 専用の妥協として明記)

### 5.4 ルートポリシーへの非追加(裁定)

設計提示時は「`lib/server/api-route-policy.ts` にマニフェスト行を追加」としたが、
`tests/api-route-policy-exhaustive.test.ts` は**マニフェストと `app/api/**/route.ts` の
ファイルシステムを厳密一致**で照合しており、route.ts を持たないエッジ専用ルートを載せると
逆に赤になる。よって `/api/app/*` は既存マニフェストに**載せない**。代わりに
`lib/server/app-attest/gateway.ts` の `APP_GATEWAY_ROUTES` 定数(method/path/認証要件)を
唯一の表とし、専用テストで gateway 実装との一致を縛る。(コントローラ裁定 2026-08-25)

### 5.5 環境変数(すべて `.env.example` に空値で追記)

| 変数 | 意味 |
|---|---|
| `TRIPCHECK_APP_IDS` | 許可 App ID のカンマ区切り。dev では `T8L5BPC2XJ.com.muraoshoki.tripcheck`。未設定なら attest/assert は 401 `app_id_mismatch`(fail-closed) |
| `TRIPCHECK_APP_ATTEST_ENVIRONMENTS` | 許可 aaguid 環境。`development` / `production` のカンマ区切り。未設定なら `production` のみ |
| `TRIPCHECK_APP_ATTEST_BYPASS_TOKEN` | 設定時のみ dev バイパスが開く(§4.5)。`.dev.vars` 専用 |
| `TRIPCHECK_APP_API_DISABLED` | 空でなければ `/api/app/*` を丸ごと 503 に |

## 6. アプリ側実装

### 6.1 構成(すべて TripCheckAppCore、Kit 不変)

- `Worker/WorkerClient.swift` — actor。公開 API:
  `ensureSession() async -> WorkerAuthState` / `ping() async -> WorkerPingResult` /
  `var state: WorkerAuthState`。内部フロー: Keychain に keyId があれば
  challenge → assert、無ければ generateKey → challenge → attest。
  `unknown_key` / `DCError.invalidKey` を受けたら keyId を破棄して attest からやり直す。
  `session_expired` を受けたら assert で再入場
- `Worker/WorkerAuthState.swift` — `idle / authenticating / authenticated(expiresAt:) /`
  `failed(WorkerAuthFailure)`。失敗理由はサーバのエラーコードをそのまま保持
- `Worker/AppAttestor.swift` — `protocol AppAttesting: Sendable`
  (`isSupported` / `generateKey()` / `attest(keyId:clientDataHash:)` /
  `assert(keyId:clientDataHash:)`)と `DCAppAttestService` 実アダプタ
- `Worker/WorkerTransport.swift` — `protocol WorkerTransport: Sendable`(URLRequest 相当の
  最小型で送受信)と URLSession 実装。テストは URLSession を使わない
- `Worker/AttestKeyStore.swift` — Keychain(`kSecClassGenericPassword`、
  service `com.muraoshoki.tripcheck.worker`、account `attest-key-id`)。保存するのは keyId のみ
- `Worker/WorkerAvailability.swift` — `makeDefaultClient(uiTesting:)`:
  uiTesting → `CannedWorkerClient`(決定的な成功系)/ それ以外 → 実 `WorkerClient`
  (attestor 非対応かつ起動環境 `TRIPCHECK_WORKER_BYPASS_TOKEN` があればバイパス、
  どちらも無ければ `failed(attestUnsupported)` を返すだけの実クライアント)
- ベース URL: Info.plist キー `TripCheckWorkerBaseURL`(既定 `http://127.0.0.1:3000`)、
  起動環境変数 `TRIPCHECK_WORKER_BASE_URL` で上書き可

### 6.2 診断画面(唯一の UI 表面)

- 起動引数 `-workerDiagnostics` があるときだけ、通常 UI の代わりに診断画面をルートに出す
  (通常ユーザーには存在しない)。実機手順書と UI テストの観測点
- 表示: 接続先 URL / App Attest 対応状況 / セッション状態 / 「疎通を確認」ボタンと結果。
  アクセシビリティ id は `diag.*`
- 文言は全部 `AppCopy` に ja/en で追加(絵文字なし、CopyBoundaryTests の流儀に従う)。
  エラーコードは翻訳せず raw 表示(開発用画面のため)

### 6.3 entitlements / Info.plist / project.yml

- `apple/TripCheck/Resources/TripCheck.entitlements` 新設:
  `com.apple.developer.devicecheck.appattest-environment = development`
- `project.yml` に `CODE_SIGN_ENTITLEMENTS` を配線(XcodeGen 再生成で反映)
- Info.plist に `NSAppTransportSecurity > NSAllowsLocalNetworking = true`
  (実機からローカル dev サーバ `http://<Mac名>.local:3000` へ繋ぐため)と
  `TripCheckWorkerBaseURL` を追加

### 6.4 プライバシーとログ

- 端末外に出るのは attest/assert の暗号材料と challenge のみ。旅程・ウィッシュ・自由文は送らない
- Keychain に保存するのは keyId(公開値のハッシュ)のみ。セッショントークンは保存せず
  メモリだけに保持。UserDefaults には何も書かない
- サーバ・アプリともトークン・鍵・アテステーションの中身をログに出さない
  (Worker の既存ログ方針に従い、エラーコードのみ)

## 7. テスト戦略

- **web 側**(`node --test`、既存 `pnpm test` に同乗):
  - 合成ミニ CA(テストヘルパが `node:crypto` で P-256/P-384 鍵と最小 X.509 チェーンを生成し、
    App Attest と同形の attestation/assertion を組み立てる)で:
    attest 正常系 / チェーン改竄 / nonce 不一致 / App ID 不一致 / 環境不許可 / challenge 期限切れ /
    assert 正常系 / 署名不正 / counter 巻き戻し / unknown_key / セッション期限切れ・改竄 /
    バイパス fail-closed / キルスイッチ / 秘密鍵不在 503
  - `APP_GATEWAY_ROUTES` と gateway 実装の一致テスト
  - **既存テストは 1 本も変えず全緑** = 既存挙動不変の担保
- **apple 側 unit**(FakeAttestor + FakeTransport): WorkerClient の状態遷移
  (初回 attest / 再入場 assert / 期限切れ再入場 / unknown_key からの自己回復 /
  invalidKey からの keyId 破棄 / オフライン失敗 / 非対応端末)
- **apple 側 UI テスト**: `-uiTesting -workerDiagnostics` + CannedWorkerClient で診断画面を assert
- **半自動 E2E**(コントローラが実行): `pnpm dev` + `.dev.vars` にバイパストークン →
  Simulator 実アプリから challenge → bypass attest → ping の本物 HTTP ループを確認
- **本物の attest**: 実機手順書(§8)でユーザーが 1 回確認。このとき採取した実アテステーションを
  fixture 化して回帰テストに足せる(採取までは合成 CA が正)
- 実 LLM 同様、**実機・実 Apple サーバは自動テストに含めない**

## 8. 実機手順書(成果物として同梱)

`apple/docs/worker-auth-device-checklist.md` に 3 ステップで書く:
1. Mac 側: `.dev.vars` に §5.5 の 2 変数(App ID・development)を足して `pnpm dev` を起動
2. iPhone を USB 接続し、Xcode から scheme 引数 `-workerDiagnostics` と
   `TRIPCHECK_WORKER_BASE_URL=http://<Mac名>.local:3000` を付けて Run
3. 診断画面で「疎通を確認」→「認証付き応答を受信」が出れば完了
   (このとき D1 台帳に本物の keyId が載る)

## 9. 既知の落とし穴(設計に織り込み済み)

- **Simulator は DCAppAttestService 非対応** → バイパス経路(§4.5)。自動テストは全てフェイク
- **`attestKey` は Apple サーバとの通信を要する** → 実機手順はオンライン前提。
  オフライン時は `failed(network)` に落として再試行可能に
- **鍵はアンインストールで消え得る / `invalidKey` が返り得る** → keyId 破棄 → 再 attest の
  自己回復ループを WorkerClient に内蔵
- **counter の直列化**はセッション方式のおかげで問題にならない(署名は入場時だけ)
- **時計ずれ** → challenge に 60 秒の leeway。セッションは期限のみ検証
- **ATS** → `NSAllowsLocalNetworking` は dev 専用の緩和。本番デプロイ spec で https 前提に戻す

## 10. グローバル制約(全タスク共通)

- web: 既存ファイルの変更は `worker/index.ts` の分岐 1 箇所と `.env.example` 追記のみ。
  それ以外は新規ファイル。既存テストの変更禁止・全緑維持。依存パッケージ追加ゼロ。
  暗号は WebCrypto のみ(`node:crypto` はテストヘルパに限り可)
- apple: TripCheckKit 不変。AppCore は additive(既存 public API の変更禁止)。
  `PlannerCopy` 267 キー不変。fixtures バイト同一。Swift 6 strict concurrency・新規警告ゼロ。
  日本語文リテラルは `AppCopy.swift` のみ(CopyBoundaryTests)。絵文字禁止
- 秘密(トークン・鍵・アテステーション)をログ・永続化に出さない
- コミットは既定のトレーラ 2 行を付ける。`git push` はしない(ユーザーが行う)
