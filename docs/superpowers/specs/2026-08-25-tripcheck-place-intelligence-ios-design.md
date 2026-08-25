# TripCheck iOS: `/api/place-intelligence` を停留所詳細に効かせる — 設計

**日付:** 2026-08-25
**ブランチ:** `claude/place-intelligence-ios`(`claude/architecture-v2` @ 8f67ef3 起点)
**位置づけ:** app セッション→paid ルートの **5 本目(最後)**。同じ Worker セッションを `/api/place-intelligence`(Google Places 詳細)に効かせ、**Google 検証済み停留所の詳細シート(`StopInspector`)に「この場所について」開示カード**(営業時間・評価・要約)を足す。

---

## 1. 範囲(正直な分解)

**やること(この spec):** **base ルートのみ(`/fresh` なし)・表示専用・展開時 lazy 取得・テキストのみ(写真なし)・`provider == .google`(=`providerRef != nil`)停留所限定**。停留所詳細シートに閉じた開示カードを足し、旅行者が開いたときだけ Worker に問い合わせて詳細を出す。

**やらないこと(後回し・理由付き):**
- **`/fresh`(Anthropic の公開ウェブ/SNS 検索)** — `ANTHROPIC_REQUESTS_ENABLED` の運用依存 + 別 Codable/provider/store 面。base だけで営業時間・評価・要約が得られる。v1.1(food が `/ai` を出さなかったのと同じ)。
- **写真** — food と同じく除外。加えて **`/api/place-photo` は iOS から構造的に到達不能**(signed_resource ゲートがブラウザ限定 `Sec-Fetch-Site: same-origin` を要求、`URLSession` は送らない)。`photoName`/`photoSignature`/`photoAttribution` はデコードで捨てる。
- **payment 詳細・`analysis.signals`・構造化 hours periods・`links.x/instagram`** — v1 は要約文と基本フィールドまで。signals/payment は v1.1。
- **eager 取得** — inspector を開く度に 1 unit 使うのは無駄。**開示カードを開いた初回だけ取得**。

**Kit 凍結の帰結:** 詳細は **AppCore 側 store(stopId キー)**に置く。エンジン型には入れない。停留所の name/area/座標/providerRef は `bundle.plan.days[].stops[].stop`(`RouteStop`、Codable/Sendable)から直読み。

---

## 2. いま在るもの(実測済み)

- **停留所は providerRef を end-to-end 保持:** `ResolvedStop.providerRef: String?`(`RouteStop.swift`)は **Google 停留所のみ非 nil**(`WorkerPlaceResolver.mapStop` が `raw.providerRef` を入れる、Apple/Catalog は nil)。`.routeStop`→`BuiltPlanStop.stop`→`BuiltTripPlan.days[].stops[].stop.providerRef` と保存。`RouteStop{ id, providerRef?, name, area, latitude, longitude, ... }`(Codable/Sendable)。**gating は `stop.providerRef != nil` で判定**(RouteStop.provider を読まずに済む)。
- **詳細シートの現状:** `StopInspector.swift`(`apple/TripCheck/Screens/Detail/`)は `store.inspector(for: stopId)` の `StopInspectorModel` を読み、`header → dayPills → EvidenceDisclosure → ConditionsDisclosure → mapLinks → removeButton`(読む→変える→出ていく)を描く。`EvidenceDisclosure`/`ConditionsDisclosure` は `DisclosureCard`(既定で閉じ)ラップの**ビルド時オフライン証拠**。`StopInspectorModel`(`PlannerStore+Inspector.swift`)は providerRef/座標を**持たない**(`inspector(for:)` が `bundle...stops[].stop` を読むが name/meta/URL しか model に載せない)。**place-intelligence 用に model へ `isProviderVerified: Bool` を足し、パイプラインは request 用の name/area/座標を bundle から直読み。**
- **既存の詳細 UI 無し:** app ターゲットに rating/review/hours の表示は皆無(Kit に `PlacePaymentFacts` 等の未使用プラミングがあるが別物・build 時証拠用)。net-new な表示面。
- **food が敷いた道(ほぼそのまま鏡):** `WorkerClient.foodRecommendations` + `FoodRecommendationModels` + `FoodRecommending`/`WorkerFoodRecommender`/`FoodRecommendationAvailability`(`Providers/FoodRecommender.swift`) + `PlannerStore+FoodRecommendations`(lazy・世代ガード) + composition-root 配線(`TripCheckApp.swift`)。place-intelligence は**停留所キー**にして同型で作る。
- **Worker ゲート開通済み:** `/api/place-intelligence` は paid・`strict_same_origin`・**featureFlag 無し(常時有効)**・quota=1・app セッション認可済み。**web/Worker 追加実装ゼロ。**
- **web 契約(`app/api/place-intelligence/route.ts` / `lib/place-intelligence.ts`):**
  - 要求 `PlaceIntelligenceRequest{ name(1–160), area(1–100), latitude, longitude, providerRef?, languageCode:"en"|"ja", destination, scope?:"planning"|"enrichment" }`。
  - **フィールドマスク二段(要点):** `providerRef` を付ける **または** `scope:"planning"` → **slim**(identity+hours、rating/review/payment 無し)。**リッチ**(rating/userRatingCount/reviews/payment/意味ある analysis)は **`providerRef` を省き `scope` も planning でない**とき `places:searchText`(name+area、座標 bias、**1.5km ミスマッチ検査**で保護)で取れる。base ルートは常に `anthropicApiKey: null` = analysis は決定的ルール。
  - 応答 `PlaceIntelligenceResult{ provider, checkedAt, analyzedBy:"rules", place:{ name, address, googleMapsUrl, websiteUrl?, businessStatus?, rating?, userRatingCount?, openNow?, hours:[String], payment{...}, photo*(捨てる) }, reviews:[PlaceReviewEvidence ≤5], analysis:{ summary, confidence, signals[], nextCheck }, links{x,instagram} }`。
  - エラー `{code:"invalid_request"}`(400)/`{code:"not_configured"}`(503)/`{code:"unavailable"}`(502)/否認(403/429/503)。

---

## 3. Global Constraints
- **web 不可侵**(`lib/**`・`app/api/**`・`worker/**`)。本機能は web/Worker 変更を要しない。
- **Kit 不可侵**(`Sources/TripCheckKit/`)。`RouteStop` 等は**読むだけ**。新規は `TripCheckAppCore` かアプリターゲット。
- **Swift 6 strict concurrency 新規警告ゼロ**、越境型は `Sendable`。
- **絵文字禁止**(星も使わず数値表記)。日本語 UI リテラルは `AppCopy.swift` のみ。
- **`git push` しない。**
- **表示/データ利用のみ:** TripCheck は Google の真偽を再判定しない。詳細は「read」節の閉じた提案カード。
- **コミット trailer 厳守:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J`。

---

## 4. アーキテクチャ(food をほぼ鏡写し、停留所キー)

### 4.1 クライアント — `WorkerClient.placeIntelligence`
`WorkerAuthenticating` に追加要件:
```swift
func placeIntelligence(_ payload: PlaceIntelligenceRequestPayload) async -> PlaceIntelligenceResult?
```
`foodRecommendations` を鏡写し(ensureSession・POST `/api/place-intelligence`・401 一回再試行・非200/デコード不能は nil)。Canned + テストスタブ(`StubWorker`/`SlowStubWorker`/`FakeRouteWorker`)= nil(**5 conformer 全実装**)。

### 4.2 越境モデル — 新規 `TripCheckAppCore/Worker/PlaceIntelligenceModels.swift`
```swift
public struct PlaceIntelligenceRequestPayload: Encodable, Sendable {
  public let name: String
  public let area: String
  public let latitude: Double
  public let longitude: Double
  public let languageCode: String    // "ja" | "en"
  public let destination: String     // DestinationChoice.rawValue
  // providerRef と scope は **送らない**(リッチ tier を引くため)。
}
public struct PlaceIntelligencePlace: Decodable, Sendable {
  public let name: String
  public let address: String
  public let googleMapsUrl: String
  public let businessStatus: String?
  public let rating: Double?
  public let userRatingCount: Int?
  public let openNow: Bool?
  public let hours: [String]
}   // payment/photo* は無視
public struct PlaceIntelligenceReview: Decodable, Sendable, Identifiable {
  public let text: String?           // ※ 実装時に lib/place-intelligence.ts の PlaceReviewEvidence の
                                     //   本文フィールド名を確認して合わせる(違えば nil=空でグレースフル)
  public let rating: Double?
  public var id: String { (text ?? "") + "\(rating ?? 0)" }
}
public struct PlaceIntelligenceAnalysis: Decodable, Sendable {
  public let summary: String
  public let confidence: String
}
public struct PlaceIntelligenceResult: Decodable, Sendable {
  public let place: PlaceIntelligencePlace
  public let reviews: [PlaceIntelligenceReview]
  public let analysis: PlaceIntelligenceAnalysis
}
```

### 4.3 狭い seam + アダプタ — 新規 `TripCheckAppCore/Providers/PlaceIntelligenceProvider.swift`
`FoodRecommender.swift` に倣う:
```swift
public protocol PlaceIntelligenceProviding: Sendable {
  func intelligence(_ payload: PlaceIntelligenceRequestPayload) async -> PlaceIntelligenceResult?
}
public struct WorkerPlaceIntelligenceProvider: PlaceIntelligenceProviding {   // withTaskGroup 8s レース
  init(client: any WorkerAuthenticating, timeout: Duration = .seconds(8))
}
public enum PlaceIntelligenceAvailability {
  public static func makeDefaultProvider(uiTesting: Bool, client: any WorkerAuthenticating) -> (any PlaceIntelligenceProviding)?
  // uiTesting → nil、それ以外 → WorkerPlaceIntelligenceProvider(client:)
}
```

### 4.4 lazy パイプライン — 新規 `TripCheckAppCore/Store/PlannerStore+PlaceIntelligence.swift` + `PlannerStore.swift`
`PlannerStore+FoodRecommendations.swift` を停留所キーにして鏡写し:
```swift
public enum StopPlaceIntelligence: Equatable, Sendable { case loading; case loaded(PlaceIntelligenceResult); case unavailable }
// PlannerStore に:
@ObservationIgnored let placeIntelligenceProvider: (any PlaceIntelligenceProviding)?   // init 既定 nil
@ObservationIgnored var placeIntelligenceGeneration = 0
@ObservationIgnored var placeIntelligenceTasks: [String: Task<Void, Never>] = [:]
public internal(set) var placeIntelligenceByStop: [String: StopPlaceIntelligence] = [:]
```
- **`public func loadPlaceIntelligence(stopId: String)`:** `bundle` の全日・全停留所から `stop.id == stopId` を引く。`guard stop.providerRef != nil`(=Google 停留所)else 何もしない(非 Google は state を作らない=カードも出ない)。既に `.loading`/`.loaded` なら何もしない。それ以外なら `beginPlaceIntelligence(stop)`。provider nil なら即 `.unavailable`。
- **`func beginPlaceIntelligence(_ stop: RouteStop)`(internal、テストが RouteStop を直接渡す):** `.loading` を置き、payload(`name/area/latitude/longitude`、`languageCode = request.locale.rawValue`、`destination = request.destination.rawValue`、**providerRef・scope は送らない**)を組み、世代を捕まえ、`[weak self]` Task で `provider.intelligence(payload)` を待ち、**`guard placeIntelligenceGeneration == gen, !Task.isCancelled`**、結果を `.loaded`/`.unavailable` に。
- **`func invalidatePlaceIntelligence()`:** 世代 +1・全 task cancel・両 dict クリア。**food と同じ 4 adopt + reset()** で呼ぶ。

### 4.5 model へ 1 フィールド — `PlannerStore+Inspector.swift`
`StopInspectorModel` に `public var isProviderVerified: Bool` を足し、`inspector(for:)` が `built.stop.providerRef != nil` で設定。UI はこれでカードの表示可否を判断(providerRef を model に晒さず bool だけ)。

### 4.6 合成の根での配線 — `apple/TripCheck/App/TripCheckApp.swift`(**③の教訓: 必ず配線**)
`PlannerStore.init` に `placeIntelligenceProvider: PlaceIntelligenceAvailability.makeDefaultProvider(uiTesting: isUITesting, client: workerClient)` を渡す(`foodRecommendationProvider` の隣、同一 `workerClient`)。UI テストは nil=カードは「詳細なし」。

### 4.7 UI — `StopInspector` に開示カード
- `StopInspectorModel.isProviderVerified` が true のとき、`EvidenceDisclosure(model:)` の**直後**に新規 `PlaceIntelligenceDisclosure(stopId: model.stopId)` を挿す(read 節、`ConditionsDisclosure` の前)。
- 新規 `apple/TripCheck/Screens/Detail/PlaceIntelligenceDisclosure.swift`(既存 `EvidenceDisclosure` の `DisclosureCard` 作法を鏡写し):**既定で閉じ**、`@State private var expanded = false`、見出しタップで開閉、`.onChange(of: expanded) { if expanded { store.loadPlaceIntelligence(stopId: stopId) } }`(=**開いた初回だけ取得**)。中身は `store.placeIntelligenceByStop[stopId]` を読み `.loading`→スピナー、`.unavailable`/nil→「詳細を取得できませんでした」、`.loaded(result)`→テキスト:営業中バッジ+hours、rating(userRatingCount)、businessStatus、`analysis.summary`、review 抜粋 1–2 件、`Link(place.googleMapsUrl)`。写真なし。
- `AppCopy.swift` に文言(カード見出し「この場所について」、「詳細を取得できませんでした」、「営業中」、評価/クチコミの補助)を ja/en で追加。

---

## 5. データフロー
1. Google 検証済み停留所の詳細を開く → `StopInspector` が `isProviderVerified==true` で `PlaceIntelligenceDisclosure` を閉じた状態で表示(まだ取得しない)。
2. 旅行者がカードを開く → `loadPlaceIntelligence(stopId)` → 停留所を引き `.loading` → payload(providerRef 省略=リッチ)→ `WorkerPlaceIntelligenceProvider`(8s レース)→ `.loaded`/`.unavailable`。世代ガードで再ビルド跨ぎ stale を捨てる。
3. カードが state を verbatim 表示。再ビルド/日付変更/reset で `invalidatePlaceIntelligence` が消す(次の展開で再取得)。

---

## 6. エラー処理と劣化
| 事象 | 挙動 |
|---|---|
| 非 Google 停留所(providerRef nil) | カードそのものが出ない(state を作らない)。 |
| provider nil(UI テスト/未構成) | 展開すると即 `.unavailable`(「詳細を取得できませんでした」)。 |
| 未認証/オフライン/タイムアウト(>8s)/401 失敗/非200/`place_mismatch` | `.unavailable`。inspector の他の内容(証拠・地図リンク)は不変。 |
| 503 not_configured(鍵無し) | `.unavailable`。 |
| 再ビルド中に返った古い取得 | 世代ガードで破棄。 |

**不変条件:** 詳細カードは純粋な追加表示。停留所・旅程・feasibility・ビルド時証拠は一切変わらない。

---

## 7. テスト戦略
- **`PlaceIntelligenceModelsTests`(AppCore):** 応答 JSON をデコード(payment/photo/links/signals の余剰無視)、payload エンコード(providerRef/scope が**含まれない**ことを確認)。
- **`WorkerClientTests`(AppCore):** FakeGateway に `/api/place-intelligence` ケース+`intelUnauthorizedOnce`、`placeIntelligence` が 401 一回再試行で成功、非200 で nil。
- **`PlannerStorePlaceIntelligenceTests`(AppCore):** `RouteStop` を memberwise init で構築し fake `PlaceIntelligenceProviding` 注入。①providerRef 有りで `beginPlaceIntelligence`→`.loading`→`.loaded`。②nil 返し→`.unavailable`。③slow fake + `invalidatePlaceIntelligence()`→世代ガードで破棄・dict 空。④provider nil→即 `.unavailable`。⑤`loadPlaceIntelligence(stopId:)` で providerRef nil の停留所は state を作らない(カード非表示)。⑥payload に providerRef/scope が無く name/area/座標/destination/languageCode が入る。
- **UI テスト(app):** サンプル旅程で **Google 停留所の詳細**に到達できるなら、`PlaceIntelligenceDisclosure` を開き(provider nil=`.unavailable` 表示)カードが出て非回帰を確認。到達不能なら報告しパイプライン単体+build に委ねる(flaky にしない)。
- **回帰:** `apple/tools/verify-kit.sh`(**引数なし**)全緑、`apple/tools/verify-app.sh test` 全緑、新規警告ゼロ。

---

## 8. 決定(Rulings)
- **R1:** base `/api/place-intelligence` のみ、`/fresh` 後回し。**コスト:** 「fresh voices」は無し(v1.1)。
- **R2:** リッチ tier のため **providerRef と scope を送らない**(1.5km 検査で保護)。**コスト:** ごく稀に同名近接地点の誤取得(Google 停留所は name+座標が正準で低確率)。それでも `.unavailable` 相当に落ちるだけ。
- **R3:** **`provider == .google`(providerRef != nil)停留所限定**の hard gate。**コスト:** Apple/Catalog 停留所には詳細を出さない(将来緩和可)。
- **R4:** **開いた初回だけ取得**(inspector 開く度でなく)。**コスト:** 開くまで詳細は出ない(スピナー)。1 unit/展開 に抑える。
- **R5:** food と同じ狭い seam + アダプタ + availability + 世代ガード lazy + init 既定 nil param + **composition-root 配線を必ず入れる**。`placeIntelligence` を `WorkerAuthenticating` に(5 conformer)。
- **R6:** v1 は place の基本 + `analysis.summary` + review 抜粋のみ。payment/signals/写真/links/構造化 periods は落とす。**コスト:** 表示は簡素(promote は v1.1)。

## 9. Out of scope / 将来
- `/fresh`(fresh voices)。写真(`/api/place-photo` は iOS 到達不能)。payment 詳細・`analysis.signals`・非 Google 停留所への緩和。
