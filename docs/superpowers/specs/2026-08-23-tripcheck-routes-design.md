# TripCheck Swift v1.1 — 実経路(MKDirections)設計書

- 作成日: 2026-08-23
- 対象: `apple/` の Swift 実装(TripCheckKit / TripCheckAppCore / TripCheck アプリ)への 2 番目のサブプロジェクト
- 前提: v1 設計書 `docs/superpowers/specs/2026-08-21-tripcheck-swift-v1-design.md`(Plan 1・Plan 2 完了、`claude/architecture-v2` 3be31d0)。本書は v1 の §1.3「範囲外」のうち**実経路**に答える。根拠調査は `~/.claude/jobs/ca26b62e/tmp/routes-scout/integration-map.md`(Kit/Web/MapKit の file:line 付き)。
- 状態: 設計確定(ブレインストームの結論を §0 に記録)

---

## 0. 決定の記録

| 論点 | 決定 | 理由 |
| --- | --- | --- |
| 次 spec の方向 | **MKDirections の実経路**(提案書 §4 の ①)。Worker 認証(②)は次々 spec、Foundation Models は実経路の**すぐ後**に繰り上げ | 鍵ゼロ・entitlement 不要で今すぐ着手でき、アプリ体験が目に見えて変わる |
| 実測の対象手段 | **徒歩・車・公共交通の全部**。徒歩/車は経路線+時間、公共交通は時間のみ | 日本・スイスは公共交通が主役。外すと価値が半減 |
| 取得タイミング | **推定で先に表示 → 裏で取得 → 全レグが揃ったら置き換え** | 鍵ゼロのビルドは一瞬。数字が後から変わることは見せる |
| 置換の見せ方 | **黙って置き換え、差分をトーストで一言**。Undo の対象にしない。新しい衝突は通常の警告行に出る | 編集ではなく事実の更新(Web と同じ) |
| 日付未定の旅程 | **徒歩・車は実測、公共交通は日付が入ってから**(Web の `date_required` と同じ)。日付入力時に 1 回だけ置換 | 時刻表のない「つもりの日」を勝手に仕入れない |
| 取得失敗の扱い | すべて「根拠なし = 推定のまま」。**「その経路は存在しない」(`liveTransitAbsentLegs`)には v1 では決して入れない** | 未対応地域で全レグがタクシー推奨に倒れるのを防ぐ |
| Evidence | Apple 由来は全部 `estimated` 止まり。`routeEvidenceByFactId` / `transitConvergence` / `liveTransitTransferCounts` は渡さない | v1 §4.2 の「Apple 由来を verified にしない」の延長 |

---

## 1. 目的と完了条件

### 1.1 目的

Plan 2 の鍵ゼロ iOS アプリに、端末内の MapKit `MKDirections` で測った移動時間と経路線を入れる。判定・代替案・日割りはエンジン(TripCheckKit)の既存の受け口 `PlannerContext.live*` から再計算され、地図は測れたレグだけ実線になる。Web 版が Google Routes + Worker で行っていることの「鍵ゼロで端末だけで出来る部分」を揃える。

### 1.2 完了条件

1. `apple/tools/verify-kit.sh` 緑。**G1 golden 500/500、G3 TS スナップショット差分ゼロは不変**(フィクスチャを 1 バイトも変えない)。`apple/tools/verify-app.sh test` 緑(アプリ単体 + UI テスト 4 本以上)。
2. iPhone 17 Pro シミュレータで、スイス 4 日サンプルと東京 3 日の入力それぞれで: 徒歩/車のレグに実線が引かれ、公共交通レグの所要時間が Apple の ETA に置き換わり、置換トーストと VoiceOver 読み上げが **1 回**出る。機内モードでは推定のプランが出て「N 区間は推定のまま」が示される。
3. Apple 由来の経路根拠が `verified` にならないことがテストで固定されている(出典 `apple`、状態 `estimated`)。
4. 保存 payload と共有コードに `live*` / 経路ジオメトリの鍵が含まれないことがテストで固定されている。
5. Web 版から変えた点が §9 に全部列挙されている。

### 1.3 範囲外(次以降)

- transit 収束による `verified` 化、公共交通の経路線・乗換回数・乗り場(Worker 認証 spec → Google / Apple Maps Server API)
- Foundation Models(次 spec)、WeatherKit、推薦(`RecommendationSource` の実装)
- 経路キャッシュの永続化(v1 は 1 セッション内のみ)

---

## 2. 全体構成

```
TripCheckKit (Foundation のみ、既存)
  Routing/RouteProvider.swift      ← 新設: RouteRequest / RouteOutcome / protocol RouteProvider / LiveRouteMerge
  Routing/RecommendationSource.swift ← 新設: 型のみ(v1 §1.3 の約束を果たす。実装は推薦 spec)
  Feasibility/Evidence.swift        ← EvidenceSource に case apple を追加(加法的)
  Feasibility/FeasibilityTypes.swift← EvidenceSnapshotOptions.liveRouteSource: EvidenceSource? = nil(加法的)
  Feasibility/EvidenceSnapshot.swift← 出典リテラル .google の 3 か所を options.liveRouteSource ?? .google に

TripCheckAppCore (MapKit 可)
  Providers/AppleRouteProvider.swift ← 新設: MKDirections アダプタ(Directing プロトコル + @MainActor MKDirectionsAdapter)
  Store/PlannerStore+Routes.swift    ← 新設: 取得コーディネータ(列挙・優先順・キャッシュ・世代・静かな置換・トースト)
  Store/PlannerStore.swift           ← tripRequest(with:days:) が liveRoutes を PlannerContext に折り込む
  Store/PlannerStore+Map.swift       ← 実測ジオメトリを MapRoute(measured: true) に
  Store/PlannerStore+Timeline.swift  ← 実測レグの根拠行
  Store/BuildRunner.swift            ← liveRouteSource: .apple を渡す
  Presentation/AppCopy.swift         ← 新しい文言(取得中 / 推定のまま / 置換トースト / Apple Maps の経路)

TripCheck (SwiftUI)
  Screens/Plan/RouteProgressLine.swift ← 新設: 統計行の横の小さな進捗
  Map/TripMapView.swift               ← 変更なし(measured で実線/破線を既に切替)
  App/TripCheckApp.swift              ← AppleRouteProvider() を注入(-uiTesting ではフェイク)
```

境界規則は v1 のまま: Kit は `import Foundation` のみ(`ImportBoundaryTests`)、`PlannerViewState` は Kit に渡さない、`PlannerCopy` の鍵は増やさない(267 鍵のパリティテスト)。

---

## 3. Kit — `RouteProvider` と Evidence の出典

### 3.1 `Routing/RouteProvider.swift`

```swift
public struct RouteRequest: Hashable, Sendable, Codable {
  public let legKey: String          // routeLegKey(from.id, to.id) = "<from>::<to>"(既存 Builder/Legs.swift)
  public let from: GeoPoint
  public let to: GeoPoint
  public let mode: TransportMode     // .walk | .taxi | .transit(1 リクエスト = 1 レグ × 1 手段)
  public let departure: Date?        // .transit は必須、.taxi は任意、.walk は nil(バケット無し)
}

public enum RouteOutcome: Hashable, Sendable {
  case measured(minutes: Int, distanceMeters: Int?, geometry: [GeoPoint]?, expectedDeparture: Date?)
  case unroutable                    // プロバイダが「経路なし」と答えた(v1 ではエンジンに入れない)
  case failed                        // 通信・スロットル・タイムアウト(何も変えない)
}

public protocol RouteProvider: Sendable {
  func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome
}

public enum LiveRouteMerge {
  /// 回答を PlannerContext の live* に折り込む純関数。minutes >= 1 のものだけ採用(0 は「根拠なし」と同じ扱い)。
  /// .unroutable / .failed は無視。liveTransitAbsentLegs と liveTransitTransferCounts には何も書かない。
  public static func apply(_ answers: [RouteRequest: RouteOutcome], to context: inout PlannerContext)
}
```

- `.walk` → `liveWalkingMinutes`、`.taxi` → `liveDrivingMinutes`、`.transit` → `liveTransitMinutes`。鍵は `request.legKey`。
- 公共交通の分は Apple の `expectedTravelTime`(乗車時間。初回の待ち時間は Kit の乗換バッファが別に足す)。
- `LiveRouteMerge` は MapKit なしで Kit のテストから駆動できる。G1/G3 のフィクスチャには live 鍵が無いので、この関数を通らない限り既存の出力は不変。

### 3.2 `Routing/RecommendationSource.swift`(型のみ)

```swift
public struct RecommendationQuery: Hashable, Sendable { slot: FoodRecommendationSlot の id / 座標 / 半径 / 種別 / 検索語 }
public struct RecommendationCandidate: Hashable, Sendable { name, latitude, longitude, category: String?, address: String? }
public protocol RecommendationSource: Sendable {
  func candidates(for query: RecommendationQuery, locale: PlannerLocale) async -> [RecommendationCandidate]
}
```

実装も呼び出しも本 spec には無い。v1 §1.3「型とプロトコルは本 spec で切る」の未履行分を埋めるだけ。

### 3.3 Evidence の出典(加法的 3 編集)

1. `EvidenceSource` に `case apple` を足す。表示・判定ロジックは `source` を読まない(状態だけ読む)ので挙動は変わらない。
2. `EvidenceSnapshotOptions` に `liveRouteSource: EvidenceSource? = nil` を足す(入力専用、スナップショットの木には入らない)。
3. `Feasibility.snapshot` で `let liveSource = options.liveRouteSource ?? .google` とし、出典リテラル `.google` の 3 か所(transit の provisional、transfer fact、transit の説明文)を置き換える。
- `BuildRunner` は `.apple` を渡す。Web と Kit 既存テスト・フィクスチャは nil のまま = `google`。
- **やらないこと**: `ModeSource` に出典を足す、`RouteFactMode` に walk/drive を足す(TS と乖離)、`Copy.legLive`「Google Maps経路」を Apple に流用する。

---

## 4. AppCore — 取得コーディネータ

### 4.1 状態

`PlannerStore` に以下を足す(いずれも **永続化しない・Undo に入れない・`view` には置かない**):
- `liveRoutes: [RouteRequest: RouteOutcome]`(回答キャッシュ。ジオメトリも同じ値の中)
- `attemptedRoutes: Set<RouteRequest>`(1 ビルド内で再試行しないための印)
- `routeGeneration: Int`(`resolveGeneration` と同じ流儀)
- `routeProgress: RouteProgress?`(`view` ではなく store 直下の表示用値: `requested`, `settled`, `estimatedRemaining`)
- `PlannerStore.init` に `routeProvider: (any RouteProvider)? = nil` を足す(nil = 今までの挙動。既存テストの呼び出し 182 か所は無変更)

`tripRequest(with:days:)` の不変条件を「`request` + `edit` + `liveRoutes` から組む(`view` は読まない)」に改める。キャッシュの折り込みは `LiveRouteMerge.apply` で行う。

### 4.2 どのレグを測るか

プランが確定した直後(`commit` / ガード付き編集の `adopt` / Undo・Redo / 再開 / リンク取込の後)に、`bundle.plan` から列挙する:
- 各日の `day.legs`(停留所→停留所)
- ホテル往復: `startBase → 最初の停留所`、`最後の停留所 → endBase ?? startBase`(鍵は `base.id`)
- 空港レグ: 到着 `airport-<code> → base`、出発 `base → airport-<code>`(`Builder/Airports.swift` の鍵と同じ。到着便の出発時刻 = 便時刻 + 空港所要分)
- **除外**: `PoiAccess.routeEndpoints(from:to:).scope != nil` の条件付きアクセスレグ(Kit が推定に戻すので測っても無駄)

手段の候補(Web の contender 規則を踏襲):
- 公共交通のみの方針 → `[transit]`
- 車優先 → `[taxi]` + 徒歩(推定徒歩 ≤15 分のとき)
- それ以外 → `[transit]` + 徒歩(推定徒歩 ≤35 分)+ 車(直線 ≥4 km、かつ推定タクシーが推定公共交通 +5 分以内)
- 使用中の手段(手動上書き含む)は必ず含める。徒歩は推定 90 分超なら要求しない。

公共交通を**要求しない**条件: 旅行日が未定 / 旅行日が今日から −7 日〜+100 日の窓の外 / 目的地が `worldwide`。徒歩・車はこれらに関係なく要求する。

### 4.3 出発日時とキャッシュ鍵

- 出発日時 = 旅行日 + 日オフセット + そのレグの出発時刻(目的地のタイムゾーン)。今より前なら今に丸める。
- キャッシュ鍵 = `RouteRequest` そのもの(`mode | legKey | departure を 30 分単位に床丸め`、`.walk` は `departure = nil`)。座標は `GeoPoint` が等値比較に入るので、手動ピンを動かせば別鍵になる。
- 無効化: `reset()`、再解決で停留所 id が変わったとき、日の開始/終了時刻の編集で公共交通のバケットが動いたとき(鍵が変わるので自然に再取得)。

### 4.4 取得の順序と予算

- 同時 4 件。優先: 空港 → 選択中の日 → 残りの日。各レグ内は 公共交通 → 徒歩 → 車。
- タイムアウト: 徒歩/車の `calculate()` 8 秒、公共交通の `calculateETA()` 12 秒。ビルド全体の締切 40 秒(残りは推定のまま)。
- 1 ビルドの上限 120 リクエスト(超える入力は 12 か所 × 14 日でも起きないが、暴走防止)。
- `loadingThrottled` は 1 / 2 / 4 秒で 3 回まで再試行、それでも駄目ならこのビルドでは諦める。**再試行するのは `AppleRouteProvider.route` の中**で、コーディネータ(`RouteFetcher`)は再試行しない —— そこから見た `.failed` は既に待ち終えた答えである。だから 40 秒の締切は待って諦めるのではなく、走っている問い合わせを取り消して閉じる(公共交通 1 件は再試行を挟むと締切より長く占有しうる)。

### 4.5 置換(静かな再ビルド)

1. この世代の全リクエストが収束(回答・失敗・締切)したら、**旅程がキャッシュを消費していない場合**に進む(新しい測定が 1 つでもあるか、`liveRoutesAreAdopted` が偽)。「新しい回答があるとき」だけでは足りない —— 日付や開始時刻が動いて鍵が振り直された直後は、古いバケットの回答が捨てられたのに新しいバケットが 1 件も測れないことがあり、そのとき旅程は既に消えた値を畳んだままになる。`.failed` は `liveRoutes` に入れない(答えではないので、次のビルドで尋ね直せる)。
2. `pendingApply != nil`(確認ダイアログが開いている)なら保留し、ダイアログが閉じた時点で再開。**旅行者が頼んだ組み直し(`build()` / `applyGuardedEdit` / `adoptHistoryPresent`)が走っている間も同様に保留し、その組み直しが終わった時点で再開する** —— どちらも `buildGeneration` を進めてから待つので、その間に置換が世代を進めると旅行者の一手が自分の世代ガードで落ち、押しても何も起きない(再開時に既に `liveRoutes` が反映済みなら、置換そのものを取り止める)。
3. `buildGeneration` を進めて捕捉 → `Task.detached { BuildRunner.run(tripRequest()) }` → `buildGate` → 世代一致を確認 → `adopt`(**`build()` は呼ばない**: `.building` を挟まず、読み上げを再発火しない)。
4. `history` には触れない(編集ではない)。`historyPointsAtTheCurrentEdit` は `edit` が不変なので真のまま。
5. トースト: `AppCopy.routesUpdatedToast` + `VerdictCopy.bufferToastDetail(delta)`(`before.plan` と `after.plan` の最小余裕差)。`canUndo: false`。`view.announcement` は更新しない —— 置換が旅行者に向けて出す知らせはこのトースト 1 つだけである(読み上げも同文)。**「元に戻す」を差し出しているトースト(`view.toast?.canUndo == true`)が画面に出ている間は、このトーストを出さない** —— 上書きすると旅行者が今まさに押した一手の取り消しが消える。置換そのもの(`adopt`)は知らせの有無に関わらず行う。
6. 置換後に新しいレグが生まれた場合(日割りが変わった等)は次の世代で追加取得する。連鎖は 2 世代まで(3 世代目以降は取りに行かない。暴走防止)。

`routeGeneration` を進める事象: `reset()`、`cancelBuild()`、`build()`、ガード付き編集の確定、Undo/Redo、`openTrip`、`importShare`、目的地の変更。古い世代の回答は捨てる(キャッシュには入れない)。

---

## 5. AppCore — `AppleRouteProvider`

- `protocol Directing: Sendable { func directions(_ request: RouteRequest) async throws -> DirectionsAnswer }` と `@MainActor MKDirectionsAdapter`。`ApplePlaceResolver` の `CancelHandle` / レース / `withTaskGroup` の同時数制御をそのまま流用する(`MKDirections.calculate()` はタスクキャンセルを見ないので `cancel()` を中継する)。
- 手段ごとの呼び分け: `.walk` → `transportType = .walking`, `calculate()`;`.taxi` → `.automobile`, `calculate()`;`.transit` → `.transit`, **`calculateETA()` のみ**(`calculate()` は失敗する)。`requestsAlternateRoutes = false`。`departureDate` は `.transit` と `.taxi` にだけ設定、`arrivalDate` は使わない。
- 座標 → `MKMapItem` は 1 か所のヘルパに閉じる(iOS 26 で初期化子が変わる)。
- `MKRoute.polyline` は `getCoordinates(_:range:)` でアダプタの隔離内で `[GeoPoint]` に変換してから返す(2000 点超は約 5 m の Douglas–Peucker で間引く)。MapKit の型を AppCore の外に出さない。
- エラー分類: `loadingThrottled` → `.failed`(コーディネータが再試行)/ `directionsNotFound`, `placemarkNotFound` → `.unroutable` / その他・タイムアウト → `.failed`。**0 分の回答は `.failed` に読み替える**(Kit は 0 を根拠なしとして扱うが、ここで揃えておく)。
- テスト用 `FakeDirecting`(`Tests/TripCheckAppCoreTests/Support/FakeDirecting.swift`): 鍵ごとの回答・遅延・スロットル回数を指定できる。`swift test` は Apple を呼ばない。

---

## 6. 画面・文言・地図

### 6.1 Plan 画面
- **進捗**: 統計行の横に `RouteProgressLine`(`label` 11pt、`IconView(.signal)`)「実経路を取得中 12/38」。完了で消える。失敗が残れば「N 区間は推定のまま」に変わり、その後のビルドまで残る。Build 画面は挟まない。
- **トースト**: 既存 `Toast`(`kind: .info`, `canUndo: false`)「実経路で更新しました 余裕 −12分」。VoiceOver は同文。
- **MovementCard**: 実測レグの根拠行 = `AppCopy.appleRouteEvidence`(ja「Apple Maps の経路」/ en "Apple Maps route")。推定レグは今までどおり `Copy.estimated`。公共交通に乗換回数・乗り場は出ない(Apple は返さない)。
- **手段ピッカー**: 規則は不変(徒歩 ≤90 分のみ有効)。値が実測に変わるだけ。
- **Detail**: 移動の根拠は「推定」のまま(正しい)。出典 `apple` は内部記録のみ。

### 6.2 地図
- `mapModel(scope:)` で、各レグの使用中手段(`legModeOverrides[legKey] ?? recommended.mode`)の回答にジオメトリがあり、**かつ旅程がその手段の live 値を消費済み**なら `MapRoute(points: polyline, measured: true)`、無ければ今までの 2 点破線。消費済みを条件に入れるのは、実線が「この線の上を歩いた時間で組んである」という意味だから —— 測っただけでまだ畳まれていない回答は実線を名乗らない。公共交通はジオメトリが無いので常に破線。
- 実測経路の始点/終点が地点から 300 m 以上離れていれば、その区間を短い破線で橋渡し(Web と同じ)。
- `TripMapView` は無変更(`measured` で実線/破線を切替済み)。凡例の「実経路 / 推定」(Kit の `legendMeasured/legendEstimated`)がそのまま実態に一致する。

### 6.3 印刷・共有・保存
- PDF は時間が更新されるだけ。脚注「所要時間は計画上の目安」は引き続き真(`verified` ではない)。
- 共有コード・保存 payload には実測を一切乗せない(`liveRoutes` は `request`/`edit` の外)。再開・リンク取込後は再取得。

### 6.4 文言の規則
- 新しい文言は全部 `AppCopy`(ja/en、`BannedTerms` を通す)。「実測」「API」「MapKit」「Directions」は使わない。Kit の `Copy.legLive`(Google Maps経路)は使わない。
- 統合仕様 §13.2 の送信先の表に「Apple Maps 経路: 座標の組・出発日時・手段のみ。場所名・旅程本文は送らない」を足す(配布 spec での開示更新の材料)。

---

## 7. エラー処理

| 事象 | 扱い | 画面 |
| --- | --- | --- |
| スロットル | 1/2/4 秒で再試行、3 回で諦め | 「N 区間は推定のまま」 |
| 経路なし | 根拠なし(`unroutable` はエンジンに入れない) | 同上 |
| 通信断・サーバ失敗・タイムアウト | 根拠なし。全体締切 40 秒 | 同上(機内モードでも推定のプランは出る) |
| 取得中の編集/Undo/再開/取込/目的地変更 | 世代を進め古い回答を捨てる。残るレグのキャッシュは再利用 | なし |
| 確認ダイアログが開いている | 置換を保留、閉じたら反映 | なし |
| 置換で日割りが変わり新レグが出た | 次の世代で追加取得(2 世代まで) | 進捗が再表示 |
| provider 未注入(`routeProvider == nil`) | 何もしない(今までの挙動) | なし |

---

## 8. テスト

| 層 | 固定するもの |
| --- | --- |
| Kit 単体 | `LiveRouteMerge.apply` の写像(手段→辞書、0 分・失敗・経路なしは無視、absent/transfer に書かない)/ `liveRouteSource` 指定時だけ出典 `apple`、既定は `google` のまま / **G1 500・G3 差分ゼロ・share ベクタが不変**(フィクスチャ無変更)/ `ImportBoundaryTests`(Routing/ も Foundation のみ)/ Copy 267 鍵不変 |
| AppCore | 列挙(日レグ・ホテル・空港、条件付きレグ除外)/ 手段候補の規則 / 公共交通を要求しない 3 条件 / キャッシュ鍵と 30 分バケット / 優先順と同時 4 件 / 世代ガード(取得中の編集で古い回答を捨てる、2 世代で止まる)/ 置換が静か(`view.screen` が `.building` にならない、`history` 不変、トースト 1 回、`canUndo == false`)/ ダイアログ中の保留 / 失敗 3 分類と再試行回数 / 日付未定→公共交通なし→日付入力で 1 回置換 / 保存 payload・共有コードに `live*`・ジオメトリ鍵が無い / `mapModel` の `measured`・300 m 橋渡し / 根拠行の文言 / `BannedTerms` |
| アプリ単体 | 走査テストが新ファイルも対象に入る(自動) |
| UI テスト | 既存 3 本 + 「サンプル → 進捗が消える → 地図タブで実線の経路がある」1 本(`-uiTesting` でフェイク provider を注入) |
| 実機確認 | スイスサンプル・東京入力で実線/数字更新/トースト、機内モードで推定のまま、のスクリーンショット |

TDD は v1 と同じ: まず Kit の `LiveRouteMerge` と出典テストを赤にしてから実装する。

---

## 9. Web 版から変えた点(Plan 2 の §9 に続く番号)

| # | 変更 | 理由 |
| --- | --- | --- |
| 21 | 経路の取得元が Google Routes(Worker)ではなく端末内 MapKit `MKDirections` | 鍵ゼロ。Worker 認証は次々 spec |
| 22 | 公共交通は所要時間のみ(経路線・乗換回数・乗り場なし)。`liveTransitTransferCounts` は渡さない | MapKit の transit は ETA しか返さない |
| 23 | transit 収束(`routeEvidenceByFactId` / `transitConvergence`)を行わない → 経路根拠が `verified` になることは無い | 収束は Worker 認証 spec で。Apple 由来を verified にしない原則 |
| 24 | 「経路なし」を `liveTransitAbsentLegs` に入れない(Web は unavailable を absent として渡す) | Apple の transit 未対応地域で全レグがタクシー推奨に倒れるのを防ぐ |
| 25 | `EvidenceSource.apple` は Swift 限定(TS `lib/feasibility-result.ts` には無い) | Kit の出典記録を正しくするための加法的変更。G3 は既定 nil で不変 |
| 26 | 取得と地図ジオメトリを 1 本の取得に統合(Web は prefetch と地図の 2 経路) | Web 自身が二重要求を認めている |
| 27 | 置換はトースト+読み上げ 1 回の静かな再ビルド。Build 画面の第 3 段階(enriching)は使わない | 決定 §0 |
| 28 | 公共交通の所要時間は Apple の `expectedTravelTime`(初回待ちは含まない) | Kit の乗換バッファと二重計上しない |

---

## 10. リスク

| リスク | 対処 |
| --- | --- |
| MapKit のスロットリングで半端に推定が残る | 優先順(空港→選択日)と進捗表示、「N 区間は推定のまま」の明示、再試行 3 回 |
| 実測で日割りが変わり停留所が動く | 置換トーストで余裕差を示す。Undo 対象にしないのは決定事項 — 気になれば次 spec で「実測を使わない」トグル |
| Apple の transit 未対応地域 | 失敗は根拠なし扱い(推定のまま)。`CoverageProfile` の A/B/C は Google 基準なので、Apple 基準の再検証は次 spec の課題 |
| 取得中の編集との競合 | `routeGeneration` + `buildGeneration` の二重ガード、ダイアログ中は保留 |
| 二重計上(乗換バッファと待ち時間) | `expectedTravelTime` を採用(§9-28) |
| Swift 6 strict concurrency と MapKit の非 Sendable 型 | アダプタの `@MainActor` 隔離内で値型に変換してから返す(`ApplePlaceResolver` と同じ) |
