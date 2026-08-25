# TripCheck iOS: `/api/live-routes` を Google 優先の経路源に効かせる — 設計

**日付:** 2026-08-25
**ブランチ:** `claude/live-routes-ios`(`claude/architecture-v2` @ 9ff013a 起点)
**位置づけ:** app セッション→paid ルートの **3 本目**(place-resolution ✅ / place-suggestions ✅ に続く)。同じ Worker セッションを `/api/live-routes`(Google Routes API)に効かせ、実経路を **Google 優先・Apple(MKDirections)代替**にする。

---

## 1. ゴールと正直な非ゴール

**ゴール:** 経路 enrichment(`PlannerStore` が画面表示後に静かに実経路を測る箇所)の第一情報源を、鍵を持つ Worker 経由の Google Routes にする。Google が綺麗に答えれば Google の**より信頼できる分数・距離・ポリライン**を使い、答えられなければ従来どおり端末内 Apple(MKDirections)へ**フォールバック**する。

**Kit 凍結ゆえの正直な非ゴール(重要):** Kit の `RouteOutcome.measured(minutes:distanceMeters:geometry:expectedDeparture:)` は 4 フィールドしか持たない。web 応答の `transferCount`・`transitSteps`(乗る路線名・乗降停留所)・`walkToStopMinutes`/`walkFromStopMinutes` は**どのスロットにも入らないので黙って落とす**。したがって本機能は「**どの電車に乗るか**を出す」ものではない。得られる upgrade は:
- **より信頼できる分数・距離**(Google のライブ交通反映)。
- **交通機関のポリライン**。MKDirections は transit で `calculateETA()` を使い `geometry: nil`(線を引けない)。Google の `encodedPolyline` を復号すれば **transit でも地図に線が引ける**=真の upgrade。

**その他の非ゴール:** web/Kit を 1 バイトも変えない。エンドポイントの 1〜20 レグ一括は使わない(下記 §4.2、per-leg のまま)。「どの電車」表示・並行レース以上の最適化は将来。

---

## 2. いま在るもの(実測済み)

- **Kit 契約(凍結):** `protocol RouteProvider { func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome }`。`RouteRequest{legKey, from:GeoPoint, to:GeoPoint, mode:TransportMode(.walk/.transit/.taxi), departure:Date?}`。`RouteOutcome = .measured(minutes:Int, distanceMeters:Int?, geometry:[GeoPoint]?, expectedDeparture:Date?) | .unroutable | .failed`。全て `Sendable`。`GeoPoint{latitude,longitude}` は Codable。
- **駆動:** `PlannerStore.routeProvider: (any RouteProvider)?` は**単一スロット**(配列ではない)。`RouteFetcher.fetch` が **1 レグ×1 モードの `RouteRequest` ごとに `route()` を 1 回**、4 並行・全体 deadline 40s で呼ぶ。`.failed`(と辞書に入らない=未settle)は覚えず次ビルドで再試行、`.measured`/`.unroutable` は `liveRoutes[request]` に保存。`LiveRouteMerge.apply` は **minutes だけ** context(liveWalking/Driving/TransitMinutes)へ折り込む(0 分は不採用)。**geometry は地図描画が読む**(transit ポリラインの upgrade はここに出る)。
- **Apple(雛形+フォールバック):** `AppleRouteProvider: RouteProvider`(AppCore、改変可)。`Directing`+`MKDirectionsAdapter`、walk/taxi は `calculate()`+polyline、transit は `calculateETA()`(geometry nil)。`race(limit,…)` の withTaskGroup、walk/drive 8s・transit 12s、throttle 3 段再試行、`minutes>=1` guard(0→.failed)、`PolylineSimplifier.thinned([GeoPoint])`(2000点超で間引き、汎用・再利用可)。
- **合成の根:** `apple/TripCheck/App/TripCheckApp.swift:77` の `routeProvider: isUITesting ? CannedRouteProvider() : AppleRouteProvider()`。ここ 1 行が唯一の注入点。`CannedRouteProvider`(直線距離、UI テスト用)は据え置き。
- **Worker ゲート開通済み:** `/api/live-routes` は paid・`strict_same_origin`(=同一オリジン **または** app セッション)・quota=leg 数。`resolvePlaces`/`suggestPlaces` と同じ door。**web/Worker 追加実装ゼロ。**
- **web 契約(`app/api/live-routes/route.ts` / `lib/google-routes.ts` / `lib/google-polyline.ts`):**
  - 要求 `{ legs:[{id, origin:{latitude,longitude}, destination:{latitude,longitude}, departureTime:ISO(全レグ必須)}], languageCode:"en"|"ja"|..., travelMode:"TRANSIT"|"WALK"|"DRIVE"(バッチ全体で 1 つ) }`。1〜20 レグ。`departureTime` は walk/drive でも必須(範囲 [now−7d, now+100d])だが Google へ渡すのは transit のみ。
  - 応答 `{ provider, fetchedAt, travelMode, legs:[{id, durationMinutes:Int?, distanceMeters:Int?, encodedPolyline:String?, transferCount, transitSteps[], walkToStopMinutes, walkFromStopMinutes, status:"ok"|"unavailable"}] }`。**1レグ要求なら 200(legs[0].status=="ok") か 非200 のどちらか**(部分成功なし)=クライアントは `status != 200` を唯一の失敗合図にできる。
  - `encodedPolyline` は **Google 1e-5 エンコード文字列**(配列ではない)。復号は web に `lib/google-polyline.ts`(34行)。**Swift 版は存在しない → ~30 行の移植を AppCore に新設。**
  - `LiveRouteCoordinate{latitude,longitude}` は `GeoPoint` と**同形**=リクエストは `GeoPoint` の合成 Codable で直結。

---

## 3. Global Constraints(全タスクに効く)

- **web 不可侵**(`lib/**`・`app/api/**` 本体不変。緩和は `worker/index.ts`・`tests/` のみだが本機能は web/Worker 変更を要しない)。
- **Kit 不可侵**(`Sources/TripCheckKit/`)。新規型・部品は `TripCheckAppCore` かアプリターゲット。
- **Swift 6 strict concurrency 新規警告ゼロ**、越境型は `Sendable`。
- **絵文字禁止。** 日本語リテラルは `AppCopy.swift` のみ(本機能は UI 文言を足さない)。ブランド文字列は `Text(verbatim:)`。
- **`git push` しない。**
- **表示/データ利用のみ:** Google の真偽を再判定しない。
- **コミット trailer 厳守:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J`。

---

## 4. アーキテクチャ

### 4.1 クライアント越しの取得 — `WorkerClient.liveRoutes`

`resolvePlaces`/`suggestPlaces` を鏡写し。`WorkerAuthenticating` に追加要件:
```swift
func liveRoutes(_ payload: LiveRoutesRequestPayload) async -> LiveRoutesResult?
```
- `WorkerClient`: `ensureSession()` → `POST /api/live-routes`(`X-TripCheck-App-Session` 付与)→ 200 を `LiveRoutesResult` にデコード。**401 一回再試行**(`enum LiveRoutesOnce`)。非200/デコード不能/例外は nil。
- `CannedWorkerClient`: `nil`(UI テストは経路を Canned で回す=Worker 非経由)。

### 4.2 越境モデル — 新規 `TripCheckAppCore/Worker/LiveRouteModels.swift`
```swift
public struct LiveRouteLegPayload: Encodable, Sendable {
  public let id: String
  public let origin: GeoPoint          // {latitude,longitude} を直に符号化
  public let destination: GeoPoint
  public let departureTime: String     // ISO8601
}
public struct LiveRoutesRequestPayload: Encodable, Sendable {
  public let legs: [LiveRouteLegPayload]
  public let languageCode: String      // "ja" | "en"
  public let travelMode: String        // "WALK" | "DRIVE" | "TRANSIT"
}
public struct LiveRouteLegResult: Decodable, Sendable {
  public let id: String
  public let durationMinutes: Int?
  public let distanceMeters: Int?
  public let encodedPolyline: String?
  public let status: String            // "ok" | "unavailable"
}   // transferCount/transitSteps/walk*Minutes は表現不可ゆえデコードで無視
public struct LiveRoutesResult: Decodable, Sendable {
  public let legs: [LiveRouteLegResult]
}
```

### 4.3 polyline デコーダ — 新規 `TripCheckAppCore/Map/GooglePolyline.swift`
`lib/google-polyline.ts` の忠実な移植。純関数:
```swift
public enum GooglePolyline {
  /// Google 1e-5 デルタ符号化文字列を [GeoPoint] に復号。空/不正は空配列。
  public static func decode(_ value: String) -> [GeoPoint]
}
```
`PolylineSimplifier.swift` の隣(`Map/`)。Google 標準例で決定的にテスト。

### 4.4 Google 優先リゾルバ — 新規 `TripCheckAppCore/Providers/WorkerRouteProvider.swift`
`RouteProvider` 準拠。単一スロットなので **Apple フォールバックを内部に合成**する:
```swift
public struct WorkerRouteProvider: RouteProvider {
  private let client: any WorkerAuthenticating
  private let fallback: any RouteProvider
  private let timeout: Duration            // Google leg 上限。既定 .seconds(10)（web 上流 8s 超）
  private let now: @Sendable () -> Date     // departure 無しレグ用。既定 Date.init
  public init(client:, fallback:, timeout: Duration = .seconds(10), now: @Sendable @escaping () -> Date = Date.init)

  public func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome {
    // Google と Apple を並行に走らせる。Google の綺麗な measured があればそれ、
    // 無ければ Apple の結果。Google が勝てば未 await の Apple は scope 退出で cancel。
    async let google = askGoogle(request, locale)     // -> RouteOutcome?
    async let apple  = fallback.route(request, locale) // -> RouteOutcome
    if let g = await google { return g }
    return await apple
  }
}
```
- **`askGoogle` → `RouteOutcome?`(綺麗な measured のみ non-nil):** 1 レグ payload を組み(`travelMode`: `.walk`→"WALK"/`.taxi`→"DRIVE"/`.transit`→"TRANSIT"、`languageCode`: `locale.rawValue`、`departureTime`: ISO8601(`request.departure ?? now()`))、`withTaskGroup` で `client.liveRoutes(payload)` と `Task.sleep(timeout)→nil` を競わせ負けは cancel。応答から `legs.first` を取り、`status=="ok"` かつ `durationMinutes` があり `>=1` のときだけ:
  ```swift
  .measured(minutes: dur,
            distanceMeters: leg.distanceMeters,
            geometry: leg.encodedPolyline.map { PolylineSimplifier.thinned(GooglePolyline.decode($0)) },
            expectedDeparture: request.departure)
  ```
  それ以外(未認証/タイムアウト/非200/`unavailable`/`durationMinutes` nil/`<1`)は **nil**。→ フォールバックへ。
- **なぜ Google の `unavailable` を `.unroutable` にしないか:** web は「経路なし」と「throttle/失敗」を区別せず両方 `"unavailable"` に畳む(理由コード無し)。信頼して `.unroutable` を返すと Apple が見つけられる経路を捨てうる。よって **Google の非成功は必ず Apple へ委ね**、`WorkerRouteProvider` が直接 `.unroutable`/`.failed` を Google 由来で返すことはない(worst case=今日の Apple 挙動)。
- **レイテンシ:** Google と Apple を **並行**にするので per-leg ≈ max(Google 10s, Apple 8/12s)=今日と同等。順次(≈22s)にすると transit-heavy な旅程で 40s 全体 deadline 内の enrichment 被覆が退行するため避ける。

### 4.5 合成の根での差し替え — `apple/TripCheck/App/TripCheckApp.swift:77`
```swift
routeProvider: isUITesting ? CannedRouteProvider() as any RouteProvider
                           : WorkerRouteProvider(client: workerClient, fallback: AppleRouteProvider()),
```
UI テストは `CannedRouteProvider`(Worker 非経由=決定的・非回帰)。実利用のみ Google 優先。`workerClient` は解決/サジェストと**同一インスタンス**(actor=セッション直列化)。

---

## 5. データフロー(1 レグ×モード)
1. `RouteFetcher` が `route(request, locale)` を呼ぶ。
2. `WorkerRouteProvider` が Google(10s 上限)と Apple を並行起動。
3. Google が `status:"ok"`+`minutes>=1` → その `.measured`(transit なら polyline 付き)。Apple は cancel。
4. Google 非成功/nil → Apple の `.measured`/`.unroutable`/`.failed`。
5. `PlannerStore` が `.measured`/`.unroutable` を `liveRoutes` に保存、`.failed` は捨てる。`LiveRouteMerge` が minutes を context へ。地図が geometry を読む(transit ポリライン)。

---

## 6. エラー処理と劣化
| 事象 | 挙動 |
|---|---|
| Worker 未認証(初回) | `liveRoutes` が一度ハンドシェイク→間に合わなければ nil → Apple。以降キャッシュ済み。 |
| Google タイムアウト(>10s) | race nil → 並行して走った Apple の結果。 |
| 401 | 一回再認証・再試行。なお失敗なら nil → Apple。 |
| `status:"unavailable"`/非200/minutes<1 | nil → Apple。 |
| 503 not_configured(鍵無し=ローカル) | nil → Apple(ローカル `pnpm dev` で鍵未設定なら常に Apple)。 |

**不変条件:** Google が答えられない限り、経路は今日の Apple(MKDirections)挙動と同一。Google が答えれば数値/ポリラインが上振れするだけ。

---

## 7. テスト戦略
- **`GooglePolylineTests`(AppCore):** Google 標準例 `"_p~iF~ps|U_ulLnnqC_mqNvxq`@"` → `[(38.5,-120.2),(40.7,-120.95),(43.252,-126.453)]`(1e-5、許容 1e-5)。空/不正 → 空配列。
- **`LiveRouteModelsTests`(AppCore):** 応答 JSON をデコード(余剰 `transferCount` 等を無視)、payload エンコード(`origin`/`destination` が `{latitude,longitude}`)。
- **`WorkerClientTests`(AppCore):** FakeGateway に `/api/live-routes` ケース+`liveRoutesUnauthorizedOnce` を足し、`liveRoutes` が 401 で一度再試行して成功、非200/デコード不能で nil。
- **`WorkerRouteProviderTests`(AppCore、`AppleRouteProviderTests` に倣う):** ①Google ok → Google の measured(distance/geometry 反映)。②Google `unavailable`/nil → 注入した fake fallback の結果。③Google 遅延(slow fake)→ fallback。④`.walk/.taxi/.transit` が payload の `"WALK"/"DRIVE"/"TRANSIT"` に写り、`departureTime` が入る(departure nil のとき `now()` 由来)。⑤Google minutes<1 → fallback。⑥transit で `encodedPolyline` → `geometry` 非 nil。fake fallback は Google と区別できる値を返し「どちらが勝ったか」を判定。
- **UI テスト:** 追加なし。経路は背景 enrichment で新規 UI 無し。UI テストは `CannedRouteProvider`(不変)で**非回帰**を担保。`verify-app` が新プロバイダ配線での app ビルド+既存フロー緑を確認。
- **回帰:** `apple/tools/verify-kit.sh`(**引数なし**)全緑、`apple/tools/verify-app.sh test`(app unit/UI)全緑、新規警告ゼロ。web 無改変ゆえ web テスト対象外。

---

## 8. 決定(Rulings — 誤りなら差し戻せる)
- **R1:** Google の非成功(`unavailable`/非200/nil/minutes<1/timeout)は**全て Apple フォールバック**。Google 由来の `.unroutable`/`.failed` は返さない(web が no-route と throttle を畳むため信頼不可)。**コスト:** 真に経路が無いレグで Apple を 1 回余計に呼ぶ(Apple も unroutable/failed)=微小。正しい結果。
- **R2:** **1 レグ/POST**(protocol が per-leg)。1〜20 一括は使わない。**コスト:** ビルドあたり最大 120 往復(4 並行・40s deadline 内)。バッチ化は将来(coalescing か RouteFetcher 変更が要る大改造)。
- **R3:** Google と Apple を **`async let` で並行**し Google 優先(未 await の Apple は scope 退出で cancel)。**コスト:** Google 成功時も Apple(端末内=無料)を一度起動しうる。順次にするより per-leg レイテンシが半減し enrichment 被覆の退行を防ぐ。
- **R4:** Google leg タイムアウト **10s**(web 上流 8s 超で正答を race off しない)。`now` は注入(既定 `Date.init`)で departure 無しレグの `departureTime` を賄い、テストは決定的。**コスト:** なし。
- **R5:** `liveRoutes` を `WorkerAuthenticating` の要件に(4 conformer 全実装:WorkerClient/Canned/テストの StubWorker・SlowStubWorker)。**コスト:** なし。
- **R6:** `transferCount`/`transitSteps`/徒歩分は `RouteOutcome` に入らないので**復号せず落とす**(Decodable が無視)。**コスト:** 「どの電車」は出せない(範囲外・Kit 凍結ゆえ)。数値+ポリラインは得られる。

## 9. Out of scope / 将来
- 交通機関の詳細(路線名・乗換回数・停留所)表示 → `RouteOutcome` 拡張=Kit 改変が要るので合意後。
- `/api/live-routes` の 1〜20 レグ**バッチ化**(往復削減)。
- Google `expectedDeparture` の意味的な補正(現状は要求 departure をそのまま返す)。
