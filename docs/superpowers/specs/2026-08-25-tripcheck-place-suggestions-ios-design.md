# TripCheck iOS: `/api/place-suggestions` を検索窓タイプアヘッドに効かせる — 設計

**日付:** 2026-08-25
**ブランチ:** `claude/place-suggestions-ios`(`claude/architecture-v2` @ 5d1f0b1 起点)
**先行縦切り:** app セッション→`/api/place-resolution`(5d1f0b1)。本 spec はその姉妹で、同じ Worker セッションを **2 本目の paid ルート**(`/api/place-suggestions`)に効かせる。

---

## 1. ゴールと非ゴール

**ゴール:** 出発地/目的地の検索窓で文字を打つ間、端末内 Apple サジェスト(`MKLocalSearchCompleter`)に加えて **Google Places Autocomplete**(Worker 経由)の候補を出す。Google は「鍵を持つ Worker が返す、そのまま解決すれば Google 検証済み停留所になる候補」であり、Apple では弱い POI・非ラテン表記・海外地名で効く。

**非ゴール(本 spec では扱わない):**
- **web / Kit を 1 バイトも変えない。** `/api/place-suggestions` は既に paid 登録済みで Worker ゲートが app セッションを認可済み(route 非依存)。`PlaceQuery.pinnedProviderRef`(Kit 既存)を web 契約へ通す案は **web ハンドラ改変が要るため不可**(§3 の決定 R1)。
- タップした Google 候補を **その場で座標に確定**すること(Apple の `CompletionToken` パスの即時 pin と同等)。MVP は「タップ→テキストとして入力欄へ→CTA 時に既存 resolver チェーンが Google 優先で解決」= `addEntry(text:, suggestion: nil)` の既存経路をそのまま使う(R1)。
- Apple/Google 候補の名寄せ以上の高度なランキングや、写真・評価の表示。

---

## 2. いま在るもの(実測済み)

- **Apple サジェスト seam(AppCore、改変可):** `TripCheckAppCore/Providers/AppleSuggestions.swift`。`@Observable` 相当・query 駆動、**2 文字最小・550ms デバウンス・(query, region) キーの 60 件 FIFO キャッシュ・失敗は非キャッシュ**。行 `PlaceSuggestion { title, subtitle, token: CompletionToken }`。純関数 `nextStep(after:asking:)` が「尋ね直すか」を決め、`swift test`(macOS)で検査できる唯一の部分。
- **タップ→解決経路(実測):** `PlaceSearchField.choose` → `StartScreen` の closure → `PlannerStore.addEntry(text:suggestion:)`。ここは **`resolvers` から `ApplePlaceResolver` を型キャストで抜き**、`resolve(completion:)` を**直接**呼ぶ(チェーンをバイパス)。`CompletionToken` は「まさに押した場所」の唯一の材料で、`MKLocalSearchCompletion` を包む。**Google 予測はこのトークンを構造的に作れない。** `suggestion == nil`(自由入力/Google 選択)なら pin されず、CTA の `requestBuildFromStart()` が `ResolutionPipeline.resolve(...)` = 全 resolver チェーンで解決する。
- **Worker ゲートは開通済み:** `lib/server/api-route-policy.ts` に `place_suggestions`(paid/strict_same_origin)、`worker/index.ts` の `handlePaidApi` が `X-TripCheck-App-Session` を認可、`paidRequestUnits` に `place_suggestions` の 1 単位課金あり。**iOS から `X-TripCheck-App-Session` 付きで叩けば server 側の追加実装ゼロ。**
- **web 契約(`app/api/place-suggestions/route.ts` / `lib/google-place-suggestions.ts`):**
  - 要求 `{ query: string(2–120), languageCode: "en"|"ja", destination: DestinationChoice }`。
  - 応答 200 `{ provider: "google_maps", suggestions: PlaceSuggestion[] }`、`PlaceSuggestion = { providerRef, primaryText, secondaryText, fullText }`(最大 5、providerRef 重複排除)。
  - エラー `{ code: "invalid_request" }`(400)/`{ code: "not_configured" }`(503)/`{ code: "unavailable" }`(502)/ゲート否認(403/429/503)。
- **なぞる雛形:** `WorkerClient.resolvePlaces`(セッション付与 + 401 一回再試行 `enum ResolveOnce`)、`WorkerTransport` の `X-TripCheck-App-Session` 付与、`PlaceResolutionModels.swift` の Codable 作法、`WorkerPlaceResolver` の `withTaskGroup` タイムアウトレース、`CannedWorkerClient` の nil スタブ。

---

## 3. Global Constraints(全タスクに暗黙で効く)

- **web 不可侵:** `lib/**`・`app/api/**` のハンドラ本体を変更しない。緩和済みは `worker/index.ts` と `tests/` のみ。本機能は **web 側の変更を要しない**(要したら設計が誤り)。
- **Kit 不可侵:** `Sources/TripCheckKit/`(`PlaceResolver`/`PlaceQuery`/`PlaceCandidate`/`ResolvedStop`/`PlannerLocale`/`DestinationChoice` 等エンジン)を変更しない。新規型・新規部品は **`TripCheckAppCore`** かアプリターゲット(`apple/TripCheck/`)に置く。
- **Swift 6 strict concurrency:** 新規警告ゼロ。新しい越境型は `Sendable`。UI 側は `@MainActor`。
- **絵文字禁止。** 日本語リテラルは `AppCopy.swift` のみ(日本語 doc コメントは可)。
- **`git push` しない**(ユーザーが `! git push`)。
- **表示/データ利用のみ:** TripCheck は Google の真偽を再判定しない。Google 候補は「そのまま解決すれば Google 検証済みになる入力候補」として提示するだけ。
- **コミット trailer:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` と `Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J` を厳守。

---

## 4. アーキテクチャ

### 4.1 クライアント越しの取得 — `WorkerClient.suggestPlaces`

`resolvePlaces` を鏡写しにする。`WorkerAuthenticating` プロトコル(`WorkerAuthState.swift`)に追加要件:

```swift
func suggestPlaces(_ payload: PlaceSuggestionRequestPayload) async -> PlaceSuggestionResult?
```

- `WorkerClient`: `ensureSession()` → `POST /api/place-suggestions`(`WorkerRequest(path:method:"POST",body:,sessionToken:)` で `X-TripCheck-App-Session` 付与)→ 200 を `PlaceSuggestionResult` にデコード。**401 は一度だけ再認証して再試行**(`enum SuggestOnce { resolved, unauthorized, failed }`、`resolvePlacesOnce` と同型)。失敗/非 200/デコード不能は `nil`。
- `CannedWorkerClient`: `suggestPlaces(_:) async -> PlaceSuggestionResult? { nil }`(UI テストは Apple 行のみで非回帰)。

### 4.2 越境モデル — 新規 `TripCheckAppCore/Worker/PlaceSuggestionModels.swift`

```swift
public struct PlaceSuggestionRequestPayload: Encodable, Sendable {
  public let query: String        // 2–120
  public let languageCode: String // "ja" | "en"
  public let destination: String  // "auto" or 目的地 id（DestinationChoice.rawValue）
}
public struct WorkerPlaceSuggestion: Decodable, Sendable, Identifiable, Equatable {
  public let providerRef: String  // Google Place ID（一覧内の一意鍵）
  public let primaryText: String
  public let secondaryText: String
  public let fullText: String     // タップ時に入力欄へ入れるテキスト（R1）
  public var id: String { providerRef }
}
public struct PlaceSuggestionResult: Decodable, Sendable {
  public let provider: String
  public let suggestions: [WorkerPlaceSuggestion]
}
```

不要な付随フィールドはデコードで無視(`PlaceResolutionModels.swift` の作法)。

### 4.3 2 本目のサジェスト源 — 新規 `TripCheckAppCore/Providers/WorkerSuggestions.swift`

`AppleSuggestions` と**同じ query 駆動**の `@MainActor @Observable`。ただし paid・ネットワーク源なので**より保守的**に:

- **3 文字最小**(Apple の 2 より 1 段厳しく。paid 予算の無駄打ちを避ける)。
- **より長いデバウンス**(既定 700ms)。キーストロークの連続では最後の 1 回だけ発火。
- **(query, region) キーの FIFO キャッシュ**(既定 40 件)。失敗は非キャッシュ、0 件の確定答だけキャッシュ(Apple と同じ規律)。
- **セッションは遅延確立:** `suggestPlaces` 内部で `ensureSession()`(= `resolvePlaces` と同じ)。未認証の初回はハンドシェイクで一度だけ遅く、`nil`→Apple のみ、以降はキャッシュ済みセッション。**キーストロークから明示的に attest を叩く speculative pre-warm は MVP では入れない**(YAGNI、§9)。
- **タイムアウトレース:** `withTaskGroup` で `client.suggestPlaces(payload)` と `Task.sleep(limit)` を競わせ負けは `cancelAll`。**タイプアヘッド用に既定 `.seconds(3)`**(resolver の 6s は遅すぎる)。
- **失敗ソフト:** 未認証/タイムアウト/ネットワーク/非 200 は `results = []`(可視の劣化なし、Apple 行はそのまま)。
- **純判定 `SuggestionGate`:** 「発火すべきか(3 文字以上か)・キャッシュ命中か・region 同一か」を純関数/純 struct に切り出し `swift test` で決定的に検査(`AppleSuggestions.nextStep` に倣う)。async ラッパは sleep + client 呼び出しだけ。
- 依存は `any WorkerAuthenticating`(既存プロトコル存在)。テストは fake conformer を注入(`CannedWorkerClient`/`FakeGateway` 系)。
- 状態を持つ:`var query`、`private(set) var results: [WorkerPlaceSuggestion]`、`configure(region:destination:locale:)`(payload 用に目的地 raw と言語を受け取る。region は Apple と同じく `store.destinationBounds`)。

### 4.4 一覧の合成 — `apple/TripCheck/Screens/Start/PlaceSearchField.swift`

- 両源を観測。`TextField(text:)` が更新する query は **Apple・Worker の両方へ**流す(StartScreen が橋渡し、§4.6)。
- **描画は Apple 先・Google 後の 2 区画。** Apple は即時・オフライン可なので上、Google は届き次第下に**別区画**として現れる(Apple 行は reflow しない)。区画見出しは `AppCopy`(日本語リテラルはそこだけ)。
- **重複排除:** Google 行のうち、正規化名(小文字化 + 空白畳み)で Apple 行の `title` と一致するものは落とす。
- **上限:** Apple は現行の `visibleSuggestions = 5` を据え置き、Google は最大 3。合計でも一覧が長くなりすぎない。
- **行タップ(選択):**
  - Apple 行 → **現状のまま** `onSubmit(suggestion.title, suggestion)`(`CompletionToken` パス、即時 pin)。
  - Google 行 → `onSubmit(prediction.fullText, nil)`。`suggestion == nil` なので `addEntry` は pin せず、CTA 時に **全 resolver チェーン(Worker=Google 優先)** が解決(R1)。**`PlannerStore`/`addEntry` は無改変。**

### 4.5 合成の根での注入 — `apple/TripCheck/App/TripCheckApp.swift` / `RootView.swift` / `StartScreen.swift`

- `WorkerSuggestions` を **composition root**(TripCheckApp)で `workerClient`(UI テストでは `CannedWorkerClient`)から生成し、`store` と同じく `.environment(workerSuggestions)` で注入。
- `StartScreen` は `@Environment(WorkerSuggestions.self)` で受け、既存の `suggestions.setRegion(...)` と並べて `workerSuggestions.configure(region: store.destinationBounds, destination: store.request.destination, locale: store.request.locale)` を同じ箇所(国変更時・`.task`)で呼ぶ。query は `PlaceSearchField` 経由で両源へ。
- `RootView` のプレビュー(`resolvers: []` の素 store)が壊れないよう、プレビュー用に `CannedWorkerClient` 由来の `WorkerSuggestions` を environment に足す(テスト・プレビューのみ)。

---

## 5. データフロー(1 キーストローク)

1. ユーザーが入力 → `TextField` が Apple・Worker 双方の `query` を更新。
2. Apple:2 文字/550ms/キャッシュで従来通り即時に `results`。
3. Worker:3 文字/700ms/キャッシュ/セッション有りで `suggestPlaces` 発火(3s レース、失敗ソフト)。届けば下区画に最大 3 行。
4. Apple 行タップ → 即時 pin(不変)。Google 行タップ → `fullText` を入力欄へ、CTA で Google 優先解決。
5. CTA(`requestBuildFromStart`)→ 未 pin エントリを全チェーンで解決 → Google 行由来は `google-` 検証済み停留所になる(先行縦切りの成果を再利用)。

---

## 6. エラー処理と劣化

| 事象 | 挙動 |
|---|---|
| Worker 未認証(初回) | `suggestPlaces` が一度ハンドシェイク→間に合わなければ `nil`→Apple のみ。以降キャッシュ済み。 |
| タイムアウト(>3s) | レースが `nil`→Apple のみ。**可視の劣化なし。** |
| 401 | 一度だけ再認証・再試行(`SuggestOnce`)。なお失敗なら Apple のみ。 |
| 429/quota 否認 | `nil`→Apple のみ。次のキーストロークで再試行(失敗は非キャッシュ)。 |
| 503 not_configured(鍵無し=ローカル) | `nil`→Apple のみ。ローカル `pnpm dev` で `GOOGLE_PLACES_API_KEY` 未設定なら Google 区画は出ない(想定内)。 |

**不変条件:** Google が何を返そうが/返すまいが、Apple の即時サジェストと自由入力は一切劣化しない。

---

## 7. テスト戦略

- **`PlaceSuggestionModelsTests`(AppCore):** web の 200 応答 JSON をデコード→フィールド一致、余剰フィールド無視、providerRef=id。
- **`WorkerClientTests`(AppCore):** `FakeGateway` に `/api/place-suggestions` ケースを足し、`suggestPlaces` が **401 で一度だけ再試行**して 2 回目で成功すること、非 200/デコード不能で `nil` を返すこと。
- **`WorkerSuggestionsTests`(AppCore):** 純 `SuggestionGate` の決定(<3 文字は非発火、キャッシュ命中は非発火、region 変化で作り直し)+ fake client 注入で「3 文字で 1 回だけ呼ぶ」「タイムアウトで空・Apple 非依存」「失敗は非キャッシュ」。
- **UI テスト(app、1 本):** `CannedWorkerClient` 前提で Google 区画が出ない=**既存の検索窓フローが非回帰**(Apple 行の選択→ビルドが従来通り)。Google 行の実データ経路は `pnpm dev` + 実鍵の手動 E2E(`apple/docs/paid-route-check.md` に追記)で確認。
- **回帰:** `apple/tools/verify-kit.sh`(**引数なし**、862 系)全緑、`apple/tools/verify-app.sh test`(7 unit + 8 UI)全緑、新規警告ゼロ。**web は変更しないので web テスト対象外。**

---

## 8. 決定(Rulings — 誤りなら差し戻せる)

- **R1(最重要):** タップした Google 候補は **`fullText` を通常テキストとして `addEntry(text:, suggestion: nil)`** に渡し、CTA で既存チェーン(Google 優先)が解決する。provider-ref を web 契約へ通す案(seam レポート Q2-a/c)は **web ハンドラ改変が要り Global Constraints 違反**なので採らない。**コスト(誤り時):** 稀に同名別地点に解決しうる(Google Autocomplete の `fullText` は具体的なので低確率)。それでも Google 検証済み停留所は得られ、ユーザーは編集可。Kit/web 変更ゼロ。
- **R2:** 描画は **Apple 先・Google 別区画・正規化名で重複排除・Apple5/Google3 上限。** **コスト:** 体裁のみ。後で調整可。
- **R3:** Google 源は **3 文字最小・700ms デバウンス・3s レース・失敗ソフト**、セッションは `suggestPlaces` 内で遅延確立。**コスト:** 初期に Google 候補が出にくいだけ。quota 暴発なし・安全側。
- **R4:** `WorkerSuggestions` を **composition root で `workerClient` から生成し environment 注入**(`store` と同型)。UI テストは Canned 注入で非回帰。**コスト:** なし(構造のみ)。
- **R5:** `suggestPlaces` を **`WorkerAuthenticating` の要件**にする(両 conformer が実装)。opt-in ではなくプロトコル追加。**コスト:** なし(Canned は nil)。

## 9. Out of scope / 将来

- タップした Google 候補の **即時 pin**(provider-ref 解決)。将来 web 契約を触れる合意が取れたら `PlaceResolutionRequestPayload` に per-query provider-ref を足す。
- **speculative `ensureSession()` pre-warm**(StartScreen 出現時)で初回キーストロークの遅延を隠す。
- Apple/Google の 1 本化ランキング・写真・評価表示。
