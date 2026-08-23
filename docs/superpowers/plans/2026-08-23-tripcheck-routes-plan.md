# TripCheck Swift v1.1 実経路(MKDirections)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan 2 の鍵ゼロ iOS アプリに、端末内 MapKit `MKDirections` で測った移動時間(徒歩・車・公共交通)と経路線(徒歩・車)を入れ、エンジンの既存の受け口 `PlannerContext.live*` から判定・日割りを再計算させ、測れたレグだけ地図を実線にする。

**Architecture:** Kit には Foundation のみの `Routing/`(`RouteRequest` / `RouteOutcome` / `RouteProvider` / `LiveRouteMerge` と型だけの `RecommendationSource`)と、Evidence の出典を `apple` と記録できる加法的 3 編集だけを足す。AppCore には `Store/RouteRequests.swift`(純関数の列挙・候補手段・バケット)、`Providers/AppleRouteProvider.swift`(`Directing` プロトコル + `@MainActor MKDirectionsAdapter`、`ApplePlaceResolver` と同じ `CancelHandle` / レース)、`Store/PlannerStore+Routes.swift`(コーディネータ: 優先順・同時 4 件・締切・世代・静かな置換・トースト)を置く。`liveRoutes` は `request`/`edit`/`view` の外に住み、`tripRequest(with:days:)` が `LiveRouteMerge.apply` で折り込む。アプリ側は `RouteProgressLine` 1 ファイルと注入だけ(`TripMapView` は `measured` で既に実線/破線を切り替える)。

**Tech Stack:** Swift 6.0 言語モード(`SWIFT_STRICT_CONCURRENCY: complete`)/ SwiftUI(iOS 17+)/ Observation / MapKit(`MKDirections.calculate()` / `calculateETA()`, `MKPolyline.getCoordinates`)/ Swift Testing(Kit・AppCore・App 単体)/ XCTest(UI)/ XcodeGen(`~/.local/xcodegen/bin/xcodegen`)/ `apple/tools/verify-kit.sh`・`apple/tools/verify-app.sh`。

**Spec:** `docs/superpowers/specs/2026-08-23-tripcheck-routes-design.md`(§0〜§10)。根拠調査: `~/.claude/jobs/ca26b62e/tmp/routes-scout/integration-map.md`。**Interfaces は 2026-08-23 に `claude/architecture-v2`(`4b07936`)の Kit/AppCore に対して照合済み**。次の名前はその通りに存在する: `PlannerContext.liveTransitMinutes/liveTransitAbsentLegs/liveTransitTransferCounts/liveWalkingMinutes/liveDrivingMinutes/legModeOverrides`、`routeLegKey(_:_:)`(`"from::to"`)、`TravelInputs(preference:mobility:…)`、`Legs.routeComparison(from:to:travel:)`、`PoiAccess.routeEndpoints(from:to:)`(`scope == nil` が直行)、`PoiAccess.allowedModes(from:to:)`、`BuiltPlanLeg`、`BuiltPlanDay`(`startBase`/`endBase`/`startTime`/`finishTime`/`date`/`hotelOutboundMode`/`hotelInboundMode`)、`BuiltTripPlan`(`destination: DestinationId`, `selectedBase: TripBase?`, `airportConstraints`, `travelPreference`, `mobilityPolicy`)、`TripBase.routeStop`、`AirportConstraint`(`airport`, `cityTime`, `cityTimeDayOffset`, `airportMinutes`)、`ModeSource { estimate, live }`、`EvidenceSource { user, google, tripcheck_catalog, derived, other }`、`EvidenceSnapshotOptions.init(dateWasProvided:baseWasProvided:dayEndWasProvided:…)`、`Feasibility.snapshot(plan:options:)`、`GeoPoint`、`straightLineDistanceKm`、`CalendarDate`(`init?(_:)`, `epochDay`, `adding(days:)`, `description`)、`ClockTime`、`Destinations.localDateTimeWithOffset(date:time:timeZone:)`、`Destinations.localDateIn(timeZone:at:)`、`Destinations.byId(_:)`、`Destinations.airport(_:code:)`、`Destination.timeZone/mobility/id`、`TripScenarios.totalPlanBufferMinutes(plan:context:)`、`VerdictCopy.bufferToastDetail(_:locale:)`、`Copy.for(locale).estimated`、`Pace { relaxed, balanced, fast }`、`PlannerStore`(`build()`, `cancelBuild()`, `reset()`, `adopt(_:)`, `commit(_:)`, `tripRequest()`, `applyGuardedEdit`, `confirmPendingEdit()`, `cancelPendingEdit()`, `adoptPending(_:)`, `adoptHistoryPresent()`, `showToast(_:)`, `buildGate`, `pendingApply`, `setDestination(_:)`, `openTrip(id:)`, `importShare(code:)`, `mapModel(scope:)`, `timelineRows(_:)`, `movementRow`, `persistedPayload()`, `shareableInput()`)、`BuildRunner.run(_:options:now:)`、`MapRoute(id:dayIndex:points:measured:selected:)`、`MovementModel.evidenceLine`、`Toast(text:kind:canUndo:)`、`AppCopy`(ja/en 表 + `AppCopyTests` の `checked == 446`)、`CancelHandle`(`ApplePlaceResolver.swift:73`、同モジュール内部)、`GeoPoint.clLocation`、`PendingGuardedEdit(candidate:bundle:label:bufferDeltaMinutes:generation:sideEffects:)`、`GuardedEditSideEffects.none`、`SwissSample.resolvedStops(locale:)`。

## Global Constraints

- **Kit は `import Foundation` のみ**(`ImportBoundaryTests.kitSourcesImportFoundationOnly` が `Sources/TripCheckKit` 全体を走査。新設の `Routing/` も対象)。`PlannerViewState` の名を Kit に書かない。
- **Kit への変更は spec §3.3 の加法的 3 編集と `Routing/` の 2 ファイルだけ**: `EvidenceSource` に `case apple`、`EvidenceSnapshotOptions` に `liveRouteSource: EvidenceSource? = nil`、`Feasibility.snapshot` の出典リテラル `.google` 3 か所(`EvidenceSnapshot.swift:180, :198, :230`)を `liveSource` に。**やらないこと**: `ModeSource` に出典を足す、`RouteFactMode` に walk/drive を足す、`Copy.legLive`「Google Maps経路」を Apple に流用する。
- **`PlannerCopy` の鍵は増やさない**(`CopyTests` が `keys.count == 267` と ja/en パリティを固定)。新しい文言は全部 `AppCopy`(ja/en)に置き `BannedTerms` を通す。**「実測」「API」「MapKit」「Directions」は文言に使わない**(凡例は Kit の `legendMeasured`「実経路」、根拠行は「Apple Maps の経路」)。
- **G1 golden 500/500・G3 TS スナップショット差分ゼロ・share ベクタは不変**: `Tests/TripCheckKitTests/Fixtures/*.json` を 1 バイトも変えない。新しい Kit の欄は既定 `nil`(`encodeIfPresent`)、`.google` 側が既定の枝。
- **`liveRoutes` は `request`/`edit`/`view` のどこにも置かない**(永続化しない・共有しない・Undo に入れない)。`tripRequest(with:days:)` の不変条件は「`request` + `edit` + `liveRoutes` から組む(`view` は読まない)」。
- **Apple 由来の根拠は `verified` にならない**: `EvidenceSnapshotOptions.routeEvidenceByFactId` / `transitConvergence` と `PlannerContext.liveTransitTransferCounts` は常に `nil`。
- **`unroutable` を v1 では `liveTransitAbsentLegs` に入れない**(`LiveRouteMerge.apply` は absent/transfer に何も書かない)。
- **`PlannerStore` に触るテストは全て `@Test @MainActor func … async`** で、必ず何かを表明する(空ループで黙って通る形にしない)。
- **テストは Apple を呼ばない**: `swift test` は `FakeDirecting` / `FakeRouteProvider` だけを通る。`MKDirectionsAdapter` はプロトコルの裏に閉じる。
- SF Symbols・絵文字は使わない(進捗アイコンは `Design/Icons/` の `.signal`)。色・字は `Tokens` / `Typography` のみ(ラベル 11pt は `.label` だけ)。主要タップ標的 ≥44pt。`reduceMotion` でアニメーション停止。
- Swift 6 strict concurrency: MapKit の非 Sendable 型は `@MainActor` アダプタの中で `[GeoPoint]` / `Double` に変換してから返す。新しい型は `Sendable`。
- `PlannerStore.init` の新引数は既定値 `nil`(テストの呼び出し 189 か所 + アプリ側 13 か所を壊さない)。
- コミット規約: 散文体の subject(prefix なし)+ 本文末尾にトレーラー 2 行 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` と `Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J`。`git push` はしない。
- 検証: Kit/AppCore は `cd apple && tools/verify-kit.sh`(`--filter X` 可)、アプリは `tools/verify-app.sh` / `tools/verify-app.sh test`。

---

## ファイル構成

```
apple/Packages/TripCheckKit/
├ Sources/TripCheckKit/
│  ├ Routing/RouteProvider.swift            ← 新設(T1): RouteRequest / RouteOutcome / RouteProvider / LiveRouteMerge
│  ├ Routing/RecommendationSource.swift     ← 新設(T1): 型のみ
│  ├ Feasibility/Evidence.swift             ← T2: EvidenceSource.apple
│  ├ Feasibility/FeasibilityTypes.swift     ← T2: EvidenceSnapshotOptions.liveRouteSource
│  └ Feasibility/EvidenceSnapshot.swift     ← T2: .google → liveSource(3 か所)
├ Sources/TripCheckAppCore/
│  ├ Store/RouteRequests.swift              ← 新設(T3): 列挙・候補手段・transit 条件・出発バケット・優先順・上限 120
│  ├ Providers/AppleRouteProvider.swift     ← 新設(T4): Directing / DirectionsAnswer / DirectionsFailure / MKDirectionsAdapter / AppleRouteProvider
│  ├ Providers/CannedRouteProvider.swift    ← 新設(T4): 決定的な疑似回答(-uiTesting 用)
│  ├ Map/PolylineSimplifier.swift           ← 新設(T4): Douglas–Peucker
│  ├ Store/PlannerStore.swift               ← T5: 状態・init 引数・tripRequest の折り込み・build/cancelBuild/reset の無効化
│  ├ Store/BuildRunner.swift                ← T5: liveRouteSource: .apple
│  ├ Store/PlannerStore+Start.swift         ← T5: setDestination で無効化
│  ├ Store/PlannerStore+Routes.swift        ← T5 状態 / T6 コーディネータ / T7 routeProgressLine
│  ├ Store/RouteFetcher.swift               ← 新設(T6): 同時 4 件・締切つきの取得
│  ├ Store/PlannerStore+Edits.swift         ← T6: adoptPending / adoptHistoryPresent / confirm・cancelPendingEdit のフック
│  ├ Store/PlannerStore+Map.swift           ← T7: 実測ジオメトリ + 300 m 橋渡し
│  ├ Map/MapModel.swift                     ← T7: 注記の書き換え、measuredCount
│  ├ Store/PlannerStore+Timeline.swift      ← T7: 根拠行
│  └ Presentation/AppCopy.swift             ← T6/T7: 5 鍵
├ Tests/TripCheckKitTests/Units/LiveRouteMergeTests.swift(T1)、EvidenceSourceTests.swift(T2)
└ Tests/TripCheckAppCoreTests/
   ├ Support/Fakes.swift(FakeRouteProvider 追記, T3)、Support/FakeDirecting.swift(T4)
   ├ RouteRequestsTests.swift(T3)、AppleRouteProviderTests.swift(T4)、RouteEnrichmentTests.swift(T5/T6/T9)
   ├ MapModelTests.swift(T7 書き換え)、TimelineRowsTests.swift(T7 追記)、AppCopyTests.swift(T7 count 460)
   └ PersistenceFlowTests.swift / ShareFlowTests.swift(T9 追記)
apple/TripCheck/
├ Screens/Plan/RouteProgressLine.swift      ← 新設(T8)
├ Screens/Plan/PlanScreen.swift, MovementCard.swift, Map/TripMapView.swift, App/TripCheckApp.swift ← T8
apple/TripCheckUITests/PlannerFlowTests.swift ← T9: 1 本追加
apple/README.md                             ← T9: 検証値
```

---

### Task 1: Kit `Routing/` — `RouteRequest` / `RouteOutcome` / `RouteProvider` / `LiveRouteMerge` と `RecommendationSource` の型

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckKit/Routing/RouteProvider.swift`, `apple/Packages/TripCheckKit/Sources/TripCheckKit/Routing/RecommendationSource.swift`
- Test: `apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Units/LiveRouteMergeTests.swift`

**Interfaces:**
- Consumes: `GeoPoint`、`TransportMode`、`PlannerLocale`、`PlannerContext`(`liveTransitMinutes/liveWalkingMinutes/liveDrivingMinutes: [String: Int]?`)、`MealKind`。
- Produces: `public struct RouteRequest: Hashable, Sendable, Codable { legKey: String; from: GeoPoint; to: GeoPoint; mode: TransportMode; departure: Date? }` + `init(legKey:from:to:mode:departure:)`、`public enum RouteOutcome: Hashable, Sendable { case measured(minutes: Int, distanceMeters: Int?, geometry: [GeoPoint]?, expectedDeparture: Date?); case unroutable; case failed }`、`public protocol RouteProvider: Sendable { func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome }`、`public enum LiveRouteMerge { public static func apply(_ answers: [RouteRequest: RouteOutcome], to context: inout PlannerContext) }`、`RecommendationQuery(slotId:latitude:longitude:radiusMeters:kind:queryIdeas:)`、`RecommendationCandidate(name:latitude:longitude:category:address:)`、`protocol RecommendationSource { func candidates(for:locale:) async -> [RecommendationCandidate] }`。

- [ ] **Step 1: 失敗するテストを書く**

```swift
// Tests/TripCheckKitTests/Units/LiveRouteMergeTests.swift
import Foundation
import Testing
@testable import TripCheckKit

private let a = GeoPoint(latitude: 35.7148, longitude: 139.7967), b = GeoPoint(latitude: 35.7101, longitude: 139.8107)
private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
private func request(_ mode: TransportMode, departure: Date? = nil) -> RouteRequest {
  RouteRequest(legKey: "tk-sensoji::tk-skytree", from: a, to: b, mode: mode, departure: departure)
}

/// 手段ごとに別の辞書へ。鍵は `request.legKey` そのもの。
@Test func eachModeLandsInItsOwnLiveDictionary() {
  var context = PlannerContext()
  LiveRouteMerge.apply([
    request(.walk): .measured(minutes: 34, distanceMeters: 2600, geometry: [a, b], expectedDeparture: nil),
    request(.taxi): .measured(minutes: 12, distanceMeters: 3100, geometry: [a, b], expectedDeparture: nil),
    request(.transit, departure: t0): .measured(minutes: 17, distanceMeters: nil, geometry: nil, expectedDeparture: nil),
  ], to: &context)
  #expect(context.liveWalkingMinutes == ["tk-sensoji::tk-skytree": 34])
  #expect(context.liveDrivingMinutes == ["tk-sensoji::tk-skytree": 12])
  #expect(context.liveTransitMinutes == ["tk-sensoji::tk-skytree": 17])
}

/// 0 分・失敗・経路なしは根拠なし。absent と transfer には**何も書かない**(spec §0、§9-24)。
@Test func zeroFailedAndUnroutableAnswersLeaveTheContextUntouched() {
  var context = PlannerContext()
  LiveRouteMerge.apply([
    request(.walk): .measured(minutes: 0, distanceMeters: 0, geometry: nil, expectedDeparture: nil),
    request(.taxi): .failed,
    request(.transit, departure: t0): .unroutable,
  ], to: &context)
  #expect(context == PlannerContext())
  #expect(context.liveTransitAbsentLegs == nil && context.liveTransitTransferCounts == nil)
}

/// 既にある live 値は残り、同じ鍵は出発の遅いほうが勝つ(辞書の列挙順に依らない)。`RouteRequest` は
/// Codable で、座標も等値比較に入る。
@Test func applyIsDeterministicAndTheRequestIsACodableKey() throws {
  var context = PlannerContext()
  context.liveTransitMinutes = ["x::y": 40]
  LiveRouteMerge.apply([
    request(.transit, departure: t0.addingTimeInterval(1800)): .measured(minutes: 21, distanceMeters: nil, geometry: nil, expectedDeparture: nil),
    request(.transit, departure: t0): .measured(minutes: 19, distanceMeters: nil, geometry: nil, expectedDeparture: nil),
  ], to: &context)
  #expect(context.liveTransitMinutes == ["x::y": 40, "tk-sensoji::tk-skytree": 21])
  let r = request(.walk)
  #expect(try JSONDecoder().decode(RouteRequest.self, from: JSONEncoder().encode(r)) == r)
  #expect(RouteRequest(legKey: r.legKey, from: b, to: a, mode: .walk, departure: nil) != r)
}
```

- [ ] **Step 2: 赤を確認** — Run: `cd apple && tools/verify-kit.sh --filter LiveRouteMergeTests` → Expected: `cannot find 'RouteRequest' in scope`。

- [ ] **Step 3: 実装**

```swift
// Sources/TripCheckKit/Routing/RouteProvider.swift
import Foundation

/// 1 レグ × 1 手段の問い合わせ。そのままキャッシュの鍵になる —— 座標が等値比較に入るので、
/// 手動ピンを動かせば別の鍵になる。Kit は提供元を知らない(`PlaceResolver` と同じ約束)。
public struct RouteRequest: Hashable, Sendable, Codable {
  /// `routeLegKey(from.id, to.id)` = `"<from>::<to>"`(`Builder/Legs.swift:12`)。
  public let legKey: String
  public let from: GeoPoint
  public let to: GeoPoint
  public let mode: TransportMode
  /// `.transit` は必須、`.taxi` は任意、`.walk` は `nil`(バケット無し)。
  public let departure: Date?

  public init(legKey: String, from: GeoPoint, to: GeoPoint, mode: TransportMode, departure: Date?) {
    self.legKey = legKey; self.from = from; self.to = to; self.mode = mode; self.departure = departure
  }
}

public enum RouteOutcome: Hashable, Sendable {
  case measured(minutes: Int, distanceMeters: Int?, geometry: [GeoPoint]?, expectedDeparture: Date?)
  /// 提供元が「経路なし」と答えた。v1 ではエンジンに入れない(spec §9-24)。
  case unroutable
  /// 通信・スロットル・タイムアウト。何も変えない。
  case failed
}

public protocol RouteProvider: Sendable {
  func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome
}

public enum LiveRouteMerge {
  /// 回答を `PlannerContext` の live* に折り込む。`minutes >= 1` のものだけ採用(0 は「根拠なし」)。
  /// `.unroutable` / `.failed` は無視。`liveTransitAbsentLegs` と `liveTransitTransferCounts` には
  /// 何も書かない。鍵・手段・出発時刻で並べてから折り込むので、辞書の列挙順に依らない。
  public static func apply(_ answers: [RouteRequest: RouteOutcome], to context: inout PlannerContext) {
    let ordered = answers.sorted { lhs, rhs in
      if lhs.key.legKey != rhs.key.legKey { return lhs.key.legKey < rhs.key.legKey }
      if lhs.key.mode != rhs.key.mode { return lhs.key.mode.rawValue < rhs.key.mode.rawValue }
      return (lhs.key.departure?.timeIntervalSince1970 ?? -1) < (rhs.key.departure?.timeIntervalSince1970 ?? -1)
    }
    for (request, outcome) in ordered {
      guard case .measured(let minutes, _, _, _) = outcome, minutes >= 1 else { continue }
      switch request.mode {
      case .walk: var d = context.liveWalkingMinutes ?? [:]; d[request.legKey] = minutes; context.liveWalkingMinutes = d
      case .taxi: var d = context.liveDrivingMinutes ?? [:]; d[request.legKey] = minutes; context.liveDrivingMinutes = d
      case .transit: var d = context.liveTransitMinutes ?? [:]; d[request.legKey] = minutes; context.liveTransitMinutes = d
      }
    }
  }
}
```

```swift
// Sources/TripCheckKit/Routing/RecommendationSource.swift
import Foundation

/// v1 §1.3「型とプロトコルは本 spec で切る」の未履行分。実装も呼び出しも本 spec には無い。
public struct RecommendationQuery: Hashable, Sendable {
  /// `FoodRecommendationSlot.id`
  public let slotId: String
  public let latitude: Double
  public let longitude: Double
  public let radiusMeters: Int
  public let kind: MealKind
  /// `FoodRecommendationSlot.queryIdeas`
  public let queryIdeas: [String]
  public init(slotId: String, latitude: Double, longitude: Double, radiusMeters: Int, kind: MealKind, queryIdeas: [String]) {
    self.slotId = slotId; self.latitude = latitude; self.longitude = longitude
    self.radiusMeters = radiusMeters; self.kind = kind; self.queryIdeas = queryIdeas
  }
}

public struct RecommendationCandidate: Hashable, Sendable {
  public let name: String
  public let latitude: Double
  public let longitude: Double
  public let category: String?
  public let address: String?
  public init(name: String, latitude: Double, longitude: Double, category: String?, address: String?) {
    self.name = name; self.latitude = latitude; self.longitude = longitude; self.category = category; self.address = address
  }
}

public protocol RecommendationSource: Sendable {
  func candidates(for query: RecommendationQuery, locale: PlannerLocale) async -> [RecommendationCandidate]
}
```

- [ ] **Step 4: 緑を確認** — Run: `cd apple && tools/verify-kit.sh --filter "LiveRouteMergeTests|ImportBoundaryTests"` → Expected: 3 + 2 本 passed(`kitSourcesImportFoundationOnly` が `Routing/` を走査して `import Foundation` だけと確認)。

- [ ] **Step 5: Commit**

```bash
git add apple/Packages/TripCheckKit/Sources/TripCheckKit/Routing apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Units/LiveRouteMergeTests.swift
git commit -m "The engine learns the shape of a route answer without learning who measured it

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J"
```

---

### Task 2: Kit Evidence の出典 `apple`(加法的 3 編集)と既定 `google` の固定

**Files:**
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckKit/Feasibility/Evidence.swift:16-18`、`apple/Packages/TripCheckKit/Sources/TripCheckKit/Feasibility/FeasibilityTypes.swift:369-415`(`EvidenceSnapshotOptions` の欄と init)、`apple/Packages/TripCheckKit/Sources/TripCheckKit/Feasibility/EvidenceSnapshot.swift:76-80`(`snapshot` 冒頭)、`:180`、`:198`、`:230`
- Test: `apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Units/EvidenceSourceTests.swift`

**Interfaces:**
- Consumes: `TestStops.tokyoRequest(_:days:context:)`(`Tests/…/Support/TestStops.swift:272`)、`TripBuilder.build`、`Feasibility.snapshot(plan:options:)`。
- Produces: `EvidenceSource.apple`(raw `"apple"`)、`EvidenceSnapshotOptions.liveRouteSource: EvidenceSource?`(init の**最後**に `liveRouteSource: EvidenceSource? = nil`)。

- [ ] **Step 1: 失敗するテストを書く**

```swift
// Tests/TripCheckKitTests/Units/EvidenceSourceTests.swift
import Testing
@testable import TripCheckKit

/// live の公共交通レグに `RouteFactEvidence` が無いとき、出典は既定で `google`(TS と同じ)、
/// `liveRouteSource: .apple` を渡したときだけ `apple`。状態はどちらも `estimated` 止まり。
@Test func liveTransitWithoutConvergenceIsGoogleByDefaultAndAppleOnRequest() {
  let raw = "Senso-ji\nteamLab Planets"
  let leg = TripBuilder.build(TestStops.tokyoRequest(raw, days: 1)).days[0].legs[0]
  var context = PlannerContext()
  context.liveTransitMinutes = [routeLegKey(leg.from.id, leg.to.id): 17]
  let plan = TripBuilder.build(TestStops.tokyoRequest(raw, days: 1, context: context))
  let factId = "route:\(plan.days[0].label):\(leg.from.id):\(leg.to.id)"
  #expect(plan.days[0].legs[0].comparison.recommended.source == .live)

  let byDefault = Feasibility.snapshot(plan: plan, options: .init(dateWasProvided: true, baseWasProvided: false, dayEndWasProvided: false))
  let fromApple = Feasibility.snapshot(plan: plan, options: .init(dateWasProvided: true, baseWasProvided: false, dayEndWasProvided: false, liveRouteSource: .apple))
  #expect(byDefault.facts.first { $0.id == factId }?.evidence.source == .google)
  #expect(fromApple.facts.first { $0.id == factId }?.evidence.source == .apple)
  #expect(fromApple.facts.first { $0.id == factId }?.evidence.status == .estimated)
  #expect(byDefault.facts.count == fromApple.facts.count)
}

/// `apple` は Swift 限定の加法(spec §9-25)。raw 値と既存 5 件の順が不変。
@Test func evidenceSourceGainsAppleAdditively() {
  #expect(EvidenceSource.apple.rawValue == "apple")
  #expect(EvidenceSource.allCases == [.user, .google, .tripcheck_catalog, .derived, .other, .apple])
}
```

- [ ] **Step 2: 赤を確認** — Run: `cd apple && tools/verify-kit.sh --filter EvidenceSourceTests` → Expected: `type 'EvidenceSource' has no member 'apple'`。

- [ ] **Step 3: 実装(3 編集)**

```swift
// Feasibility/Evidence.swift:16-18
/// TS `EvidenceSource` (`lib/feasibility-result.ts:14-19`) + Swift 限定の `apple`(spec §9-25)。
/// 判定・表示は `status` しか読まないので、`apple` を足しても挙動は変わらない。
public enum EvidenceSource: String, Codable, Sendable, CaseIterable {
  case user, google, tripcheck_catalog, derived, other, apple
}
```

```swift
// Feasibility/FeasibilityTypes.swift — EvidenceSnapshotOptions(:369-415)。欄は末尾、init も末尾。
  /// live の経路分の出典。**入力専用**(木には入らない)。`nil` = `google`(Web と既存フィクスチャの既定)。
  public var liveRouteSource: EvidenceSource?
  // init(...) の最後の引数:
    lastEntryEvidenceByStop: [String: LastEntryFactEvidence]? = nil,
    liveRouteSource: EvidenceSource? = nil
  // 代入:
    self.liveRouteSource = liveRouteSource
```

```swift
// Feasibility/EvidenceSnapshot.swift — snapshot 冒頭(:80 の nonConverged の直後)に 1 行、3 か所を差し替え
    let liveSource: EvidenceSource = options.liveRouteSource ?? .google
// :180
          provisionallyMeasured || isTruthy(routeEvidence?.providerRef) ? liveSource : hasPlanningEstimate ? .derived : .other,
// :198
        exactLiveValue ? liveSource : .derived,
// :230
        exactProviderValue ? liveSource : isTruthy(routeEvidence?.providerRef) ? liveSource : .other,
```

`:86`・`:271`・`:285`・`:390`・`:406` の `.google` は場所・営業時間の出典なので触らない。

- [ ] **Step 4: 緑とパリティを確認** — Run: `cd apple && tools/verify-kit.sh` → Expected: 全 795 + 5 本 passed、`exit=0`。`GoldenParityTests`(G1 500/500)、`SnapshotParityTests`(G3 差分ゼロ)、`ShareCodecTests`、`CopyTests`(267)、`PlannerContextCodableTests` が緑。`git status -- apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures` が空。

- [ ] **Step 5: Commit**

```bash
git add apple/Packages/TripCheckKit/Sources/TripCheckKit/Feasibility apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Units/EvidenceSourceTests.swift
git commit -m "The evidence record can say a route came from Apple, and still says Google when nobody tells it otherwise

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J"
```

---

### Task 3: AppCore `RouteRequests` — 列挙・候補手段・公共交通の条件・出発バケット・優先順・上限

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/RouteRequests.swift`
- Modify: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/Support/Fakes.swift`(末尾に `RouteCallLog` / `FakeRouteProvider`)
- Test: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/RouteRequestsTests.swift`

**Interfaces:**
- Consumes: `BuiltTripPlan`/`BuiltPlanDay`/`BuiltPlanLeg`/`TripBase.routeStop`/`AirportConstraint`、`Destinations.byId/airport/localDateTimeWithOffset/localDateIn`、`PoiAccess.routeEndpoints`/`allowedModes`、`Legs.routeComparison`、`TravelInputs`、`straightLineDistanceKm`、`routeLegKey`、`CalendarDate`、`ClockTime`、T1 の `RouteRequest`。
- Produces: `public enum RouteRequests { static let maximumPerBuild = 120; static let transitPastDays = 7; static let transitFutureDays = 100; static let bucketSeconds: TimeInterval = 1800 }`、`public struct RouteRequests.Leg: Hashable, Sendable { legKey; from: RouteStop; to: RouteStop; dayIndex: Int?; date: CalendarDate?; clock: String; modeInUse: TransportMode }`、`static func legs(plan:overrides:) -> [Leg]`、`static func contenders(for:plan:context:) -> [TransportMode]`、`static func transitAllowed(on:destination:now:) -> Bool`、`static func departure(date:clock:timeZone:now:) -> Date?`、`static func bucket(_:) -> Date`、`static func requests(plan:context:overrides:selectedDay:now:limit: Int = maximumPerBuild) -> [RouteRequest]`。

- [ ] **Step 1: 失敗するテストを書く**

```swift
// Tests/TripCheckAppCoreTests/RouteRequestsTests.swift
import Foundation
import Testing
@testable import TripCheckAppCore
import TripCheckKit

@MainActor private func builtSwitzerland() async -> (BuiltTripPlan, PlannerContext) {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  await store.build()
  return (store.bundle!.plan, store.bundle!.request.context)
}
private func stop(_ id: String, _ lat: Double, _ lon: Double) -> RouteStop {
  RouteStop(id: id, name: id, area: "", latitude: lat, longitude: lon, sourceUrl: "", verifiedAt: "", confidence: .medium, planningDurationMinutes: 30, isAnchor: true)
}

/// 日レグは全部入り、条件付きアクセスのレグ(ゴルナーグラート等)は入らない。ホテルが決まれば往復 2 レグ(鍵は `base.id`)。
@Test @MainActor func enumeratesDayAndHotelLegsAndSkipsConditionalAccessLegs() async {
  let (plan, _) = await builtSwitzerland()
  let legs = RouteRequests.legs(plan: plan, overrides: [:])
  let dayLegs = plan.days.flatMap(\.legs)
  let direct = dayLegs.filter { PoiAccess.routeEndpoints(from: $0.from, to: $0.to).scope == nil }
  #expect(!direct.isEmpty && direct.count < dayLegs.count)
  #expect(Set(legs.map(\.legKey)) == Set(direct.map { routeLegKey($0.from.id, $0.to.id) }))
  #expect(legs.allSatisfy { $0.dayIndex != nil && $0.date == nil })

  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  store.edit.hotelQuery = "Bern"
  store.edit.resolvedBase = ResolvedStop(id: "hotel-bern", name: "Hotel Bern", area: "Bern", latitude: 46.948, longitude: 7.44, sourceUrl: "", verifiedAt: "", confidence: .medium, planningDurationMinutes: 0, isAnchor: false, input: "Bern", inputIndex: 0, address: "", countryCode: "CH", provider: .apple)
  await store.build()
  let day = store.bundle!.plan.days[0]
  let withHotel = RouteRequests.legs(plan: store.bundle!.plan, overrides: [:])
  #expect(day.startBase != nil)
  #expect(withHotel.contains { $0.legKey == routeLegKey(day.startBase!.id, day.stops.first!.stop.id) && $0.clock == day.startTime })
  #expect(withHotel.contains { $0.legKey == routeLegKey(day.stops.last!.stop.id, (day.endBase ?? day.startBase)!.id) })
}

/// 候補手段(Web `contenderModes`): 通常 → transit + 徒歩(≤35)+ 車(直線 ≥4 km かつ 推定タクシー ≤ 推定 transit+5)。
/// 使用中の手段は必ず含み、徒歩は推定 90 分超なら要求しない。車優先は [taxi] + 徒歩(≤15)。
@Test @MainActor func contenderRulesFollowTheWebClient() async {
  let (plan, context) = await builtSwitzerland()
  let mobility = Destinations.byId(plan.destination).mobility
  var checked = 0
  for leg in RouteRequests.legs(plan: plan, overrides: [:]) {
    let modes = RouteRequests.contenders(for: leg, plan: plan, context: context)
    let walk = Legs.routeComparison(from: leg.from, to: leg.to, travel: TravelInputs(preference: plan.travelPreference, mobility: mobility)).options.first { $0.mode == .walk }!.minutes
    #expect(modes.contains(.transit))
    #expect(modes.contains(.walk) == (walk <= 35))
    if leg.modeInUse != .walk { #expect(modes.contains(leg.modeInUse)) }
    checked += 1
  }
  #expect(checked > 0)
  let first = RouteRequests.legs(plan: plan, overrides: [:])[0]
  let overridden = RouteRequests.legs(plan: plan, overrides: [first.legKey: .taxi])[0]
  #expect(overridden.modeInUse == .taxi && RouteRequests.contenders(for: overridden, plan: plan, context: context).contains(.taxi))

  var car = plan; car.travelPreference = .car
  let long = RouteRequests.Leg(legKey: "a::b", from: stop("a", 46.948, 7.447), to: stop("b", 47.05, 8.30), dayIndex: 0, date: nil, clock: "09:00", modeInUse: .taxi)
  #expect(RouteRequests.contenders(for: long, plan: car, context: context) == [.taxi])
  let short = RouteRequests.Leg(legKey: "a::c", from: stop("a", 46.948, 7.447), to: stop("c", 46.951, 7.450), dayIndex: 0, date: nil, clock: "09:00", modeInUse: .taxi)
  #expect(RouteRequests.contenders(for: short, plan: car, context: context) == [.taxi, .walk])
}

/// 公共交通を要求しない 3 条件: 日付未定 / 窓(−7〜+100 日)の外 / worldwide。出発は目的地の時刻で
/// 作り、今より前なら今に丸め、30 分に床丸めする。
@Test func transitWindowDepartureClampAndBucket() {
  let ch = Destinations.byId(.switzerland)
  let now = Date(timeIntervalSince1970: 1_800_000_000)
  let today = Destinations.localDateIn(timeZone: ch.timeZone, at: now)
  #expect(RouteRequests.transitAllowed(on: nil, destination: ch, now: now) == false)
  #expect(RouteRequests.transitAllowed(on: today, destination: ch, now: now))
  #expect(RouteRequests.transitAllowed(on: today.adding(days: -7), destination: ch, now: now))
  #expect(RouteRequests.transitAllowed(on: today.adding(days: -8), destination: ch, now: now) == false)
  #expect(RouteRequests.transitAllowed(on: today.adding(days: 100), destination: ch, now: now))
  #expect(RouteRequests.transitAllowed(on: today.adding(days: 101), destination: ch, now: now) == false)
  #expect(RouteRequests.transitAllowed(on: today, destination: Destinations.byId(.worldwide), now: now) == false)

  let zone = "Asia/Tokyo"
  let at = Destinations.localDateTimeWithOffset(date: "2027-03-10", time: "10:17", timeZone: zone)!
  #expect(RouteRequests.departure(date: CalendarDate("2027-03-10"), clock: "09:00", timeZone: zone, now: at) == at)
  #expect(RouteRequests.departure(date: CalendarDate("2027-03-11"), clock: "09:05", timeZone: zone, now: at) == Destinations.localDateTimeWithOffset(date: "2027-03-11", time: "09:05", timeZone: zone))
  #expect(RouteRequests.departure(date: nil, clock: "09:00", timeZone: zone, now: at) == nil)
  #expect(RouteRequests.bucket(at) == Destinations.localDateTimeWithOffset(date: "2027-03-10", time: "10:00", timeZone: zone))
}

/// 並び: 空港 → 選択中の日 → 残りの日、各レグ内は transit → walk → taxi。上限で切る。
/// 日付が無いので transit は 1 件も無く、徒歩の鍵は `departure == nil`。
@Test @MainActor func requestsArePrioritisedAndCapped() async {
  let (plan, context) = await builtSwitzerland()
  let all = RouteRequests.requests(plan: plan, context: context, overrides: [:], selectedDay: 2, now: Date())
  #expect(!all.isEmpty && all.allSatisfy { $0.mode != .transit })
  #expect(all.filter { $0.mode == .walk }.allSatisfy { $0.departure == nil })
  let dayOf = Dictionary(RouteRequests.legs(plan: plan, overrides: [:]).map { ($0.legKey, $0.dayIndex!) }, uniquingKeysWith: { a, _ in a })
  let days = all.map { dayOf[$0.legKey]! }
  let rest = days.drop(while: { $0 == 2 })
  #expect(days.first == 2 && !rest.contains(2) && Array(rest) == rest.sorted())
  #expect(RouteRequests.requests(plan: plan, context: context, overrides: [:], selectedDay: 0, now: Date(), limit: 3).count == 3)
}
```

```swift
// Tests/TripCheckAppCoreTests/Support/Fakes.swift — 末尾に追記
actor RouteCallLog {
  private(set) var requests: [RouteRequest] = []
  func record(_ request: RouteRequest) { requests.append(request) }
}

/// 経路の疑似提供元。鍵ごとの失敗・遅延・呼び出し記録を持つ。`swift test` は Apple を呼ばない。
struct FakeRouteProvider: RouteProvider {
  var walkMinutes = 9, taxiMinutes = 7, transitMinutes = 12
  var failing: Set<String> = []      // legKey → .failed
  var unroutable: Set<String> = []   // legKey → .unroutable
  var delay: Duration = .milliseconds(20)
  let log = RouteCallLog()

  func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome {
    await log.record(request)
    try? await Task.sleep(for: delay)
    if Task.isCancelled || failing.contains(request.legKey) { return .failed }
    if unroutable.contains(request.legKey) { return .unroutable }
    let mid = GeoPoint(latitude: (request.from.latitude + request.to.latitude) / 2 + 0.002, longitude: (request.from.longitude + request.to.longitude) / 2)
    switch request.mode {
    case .walk: return .measured(minutes: walkMinutes, distanceMeters: 700, geometry: [request.from, mid, request.to], expectedDeparture: nil)
    case .taxi: return .measured(minutes: taxiMinutes, distanceMeters: 2100, geometry: [request.from, mid, request.to], expectedDeparture: request.departure)
    case .transit: return .measured(minutes: transitMinutes, distanceMeters: nil, geometry: nil, expectedDeparture: request.departure)
    }
  }
}
```

- [ ] **Step 2: 赤を確認** — Run: `cd apple && tools/verify-kit.sh --filter RouteRequestsTests` → Expected: `cannot find 'RouteRequests' in scope`。

- [ ] **Step 3: 実装**

```swift
// Sources/TripCheckAppCore/Store/RouteRequests.swift
import Foundation
import TripCheckKit

/// どのレグを、どの手段で、いつの出発で測るか(spec §4.2〜§4.4)。純関数 —— `PlannerStore` も MapKit も知らない。
public enum RouteRequests {
  public static let maximumPerBuild = 120
  public static let transitPastDays = 7
  public static let transitFutureDays = 100
  public static let bucketSeconds: TimeInterval = 1800
  /// 推定徒歩がこれを超えるレグには徒歩を要求しない(`MovementModel` の 90 分規則と同じ値)。
  static let walkHardCapMinutes = 90

  public struct Leg: Hashable, Sendable {
    public var legKey: String
    public var from: RouteStop
    public var to: RouteStop
    /// `nil` = 空港レグ(優先順で先頭)。
    public var dayIndex: Int?
    public var date: CalendarDate?
    /// 出発時刻 "HH:MM"(目的地の時刻)。
    public var clock: String
    public var modeInUse: TransportMode
    public init(legKey: String, from: RouteStop, to: RouteStop, dayIndex: Int?, date: CalendarDate?, clock: String, modeInUse: TransportMode) {
      self.legKey = legKey; self.from = from; self.to = to; self.dayIndex = dayIndex; self.date = date; self.clock = clock; self.modeInUse = modeInUse
    }
  }

  public static func legs(plan: BuiltTripPlan, overrides: [String: TransportMode]) -> [Leg] {
    let destination = Destinations.byId(plan.destination)
    let preferDriving = plan.travelPreference == .car || destination.mobility == .car_first
    var legs: [Leg] = []
    func add(_ from: RouteStop, _ to: RouteStop, dayIndex: Int?, date: CalendarDate?, clock: String, fallback: TransportMode) {
      // 条件付きアクセスのレグは Kit が推定に戻すので測っても無駄(spec §4.2)。
      guard PoiAccess.routeEndpoints(from: from, to: to).scope == nil else { return }
      let key = routeLegKey(from.id, to.id)
      legs.append(Leg(legKey: key, from: from, to: to, dayIndex: dayIndex, date: date, clock: clock, modeInUse: overrides[key] ?? fallback))
    }
    // 空港: 到着 airport → base、出発 base → airport(鍵は `Builder/Airports.swift:52` と同じ)。
    if let base = plan.selectedBase?.routeStop, let firstDate = plan.days.first?.date.flatMap({ CalendarDate($0) }) {
      for constraint in plan.airportConstraints {
        guard let airport = Destinations.airport(destination, code: constraint.airport) else { continue }
        let airportStop = RouteStop(id: "airport-\(airport.code.lowercased())", name: airport.code, area: airport.code, latitude: airport.latitude, longitude: airport.longitude, sourceUrl: airport.sourceUrl, verifiedAt: "", confidence: .medium, planningDurationMinutes: 0, isAnchor: true)
        let mode: TransportMode = preferDriving ? .taxi : .transit
        if constraint.direction == .arrival {
          // 到着便の出発時刻 = 便の街時刻 + 空港所要分(spec §4.2)。
          let minutes = (ClockTime(constraint.cityTime)?.minutes ?? 0) + constraint.airportMinutes
          add(airportStop, base, dayIndex: nil, date: firstDate.adding(days: constraint.cityTimeDayOffset + minutes / 1440), clock: ClockTime(minutes: minutes).description, fallback: mode)
        } else if let last = plan.days.last {
          // 出発便のレグは最終日の終了時刻から(spec は定義していないので、ここで決める)。
          add(base, airportStop, dayIndex: nil, date: last.date.flatMap({ CalendarDate($0) }), clock: last.finishTime, fallback: mode)
        }
      }
    }
    for (dayIndex, day) in plan.days.enumerated() {
      let date = day.date.flatMap({ CalendarDate($0) })
      guard let first = day.stops.first, let last = day.stops.last else { continue }
      if let start = day.startBase { add(start.routeStop, first.stop, dayIndex: dayIndex, date: date, clock: day.startTime, fallback: day.hotelOutboundMode ?? .transit) }
      for leg in day.legs {
        let clock = day.stops.first { $0.stop.id == leg.from.id }?.departure ?? day.startTime
        add(leg.from, leg.to, dayIndex: dayIndex, date: date, clock: clock, fallback: leg.comparison.recommended.mode)
      }
      if let end = day.endBase ?? day.startBase { add(last.stop, end.routeStop, dayIndex: dayIndex, date: date, clock: last.departure, fallback: day.hotelInboundMode ?? .transit) }
    }
    return legs
  }

  /// Web `contenderModes`(`lib/planning-live-routes-client.ts:389-408`)。推定だけで刈る(live 値は渡さない)。
  public static func contenders(for leg: Leg, plan: BuiltTripPlan, context: PlannerContext) -> [TransportMode] {
    if PoiAccess.allowedModes(from: leg.from, to: leg.to) == [.transit] { return [.transit] }
    let comparison = Legs.routeComparison(from: leg.from, to: leg.to, travel: TravelInputs(
      preference: plan.travelPreference, mobility: Destinations.byId(plan.destination).mobility, bufferMinutes: context.transferBufferMinutes,
      maxWalkingMinutesPerLeg: plan.mobilityPolicy.maxWalkingMinutesPerLeg, maxTransfersPerLeg: plan.mobilityPolicy.maxTransfersPerLeg))
    func minutes(_ mode: TransportMode) -> Int { comparison.options.first { $0.mode == mode }?.minutes ?? Int.max }
    let walk = minutes(.walk)
    var modes: [TransportMode]
    if plan.travelPreference == .car {
      modes = walk <= 15 ? [.taxi, .walk] : [.taxi]
    } else {
      modes = [.transit]
      if walk <= 35 { modes.append(.walk) }
      let km = straightLineDistanceKm(GeoPoint(latitude: leg.from.latitude, longitude: leg.from.longitude), GeoPoint(latitude: leg.to.latitude, longitude: leg.to.longitude))
      if km >= 4 && minutes(.taxi) <= minutes(.transit) + 5 { modes.append(.taxi) }
    }
    if !modes.contains(leg.modeInUse) { modes.append(leg.modeInUse) }
    if walk > walkHardCapMinutes { modes.removeAll { $0 == .walk } }
    return modes
  }

  public static func transitAllowed(on date: CalendarDate?, destination: Destination, now: Date) -> Bool {
    guard let date, destination.id != .worldwide else { return false }
    let offset = date.epochDay - Destinations.localDateIn(timeZone: destination.timeZone, at: now).epochDay
    return offset >= -transitPastDays && offset <= transitFutureDays
  }

  public static func departure(date: CalendarDate?, clock: String, timeZone: String, now: Date) -> Date? {
    guard let date, let planned = Destinations.localDateTimeWithOffset(date: date.description, time: clock, timeZone: timeZone) else { return nil }
    return max(planned, now)
  }

  public static func bucket(_ date: Date) -> Date {
    Date(timeIntervalSince1970: (date.timeIntervalSince1970 / bucketSeconds).rounded(.down) * bucketSeconds)
  }

  /// 優先順: 空港 → 選択中の日 → 残りの日(同順位は列挙順)、各レグ内は transit → walk → taxi。`limit` で切る。
  public static func requests(plan: BuiltTripPlan, context: PlannerContext, overrides: [String: TransportMode], selectedDay: Int, now: Date, limit: Int = maximumPerBuild) -> [RouteRequest] {
    let destination = Destinations.byId(plan.destination)
    func rank(_ leg: Leg) -> Int { leg.dayIndex == nil ? -1 : leg.dayIndex == selectedDay ? 0 : leg.dayIndex! + 1 }
    let ordered = legs(plan: plan, overrides: overrides).enumerated()
      .sorted { (rank($0.element), $0.offset) < (rank($1.element), $1.offset) }.map(\.element)
    let modeRank: [TransportMode: Int] = [.transit: 0, .walk: 1, .taxi: 2]
    var out: [RouteRequest] = []
    for leg in ordered {
      let from = GeoPoint(latitude: leg.from.latitude, longitude: leg.from.longitude), to = GeoPoint(latitude: leg.to.latitude, longitude: leg.to.longitude)
      for mode in contenders(for: leg, plan: plan, context: context).sorted(by: { modeRank[$0]! < modeRank[$1]! }) {
        if mode == .transit && !transitAllowed(on: leg.date, destination: destination, now: now) { continue }
        let departure = mode == .walk ? nil : RouteRequests.departure(date: leg.date, clock: leg.clock, timeZone: destination.timeZone, now: now).map(bucket)
        if mode == .transit && departure == nil { continue }
        out.append(RouteRequest(legKey: leg.legKey, from: from, to: to, mode: mode, departure: departure))
        if out.count == limit { return out }
      }
    }
    return out
  }
}
```

- [ ] **Step 4: 緑を確認** — Run: `cd apple && tools/verify-kit.sh --filter RouteRequestsTests` → Expected: 4 本 passed。

- [ ] **Step 5: Commit**

```bash
git add apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/RouteRequests.swift apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/RouteRequestsTests.swift apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/Support/Fakes.swift
git commit -m "The app decides which legs are worth measuring before it asks anyone

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J"
```

---

### Task 4: `AppleRouteProvider` — `Directing` / `MKDirectionsAdapter` / レース / 再試行 / エラー分類 / 経路線

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Providers/AppleRouteProvider.swift`, `…/Providers/CannedRouteProvider.swift`, `…/Map/PolylineSimplifier.swift`, `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/Support/FakeDirecting.swift`
- Test: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/AppleRouteProviderTests.swift`

**Interfaces:**
- Consumes: T1 `RouteRequest`/`RouteOutcome`/`RouteProvider`、`CancelHandle`(`ApplePlaceResolver.swift:73`)、`GeoPoint.clLocation`、`straightLineDistanceKm`。
- Produces: `public struct DirectionsAnswer: Hashable, Sendable { travelSeconds: Double; distanceMeters: Double?; geometry: [GeoPoint]?; expectedDeparture: Date? }`、`public enum DirectionsFailure: Error, Equatable { case throttled, notFound, other }`、`public protocol Directing: Sendable { func directions(_ request: RouteRequest) async throws -> DirectionsAnswer }`、`@MainActor public final class MKDirectionsAdapter: Directing { nonisolated public init() }`、`public struct AppleRouteProvider: RouteProvider { init(directing: any Directing = MKDirectionsAdapter(), walkDriveTimeout: Duration = .seconds(8), transitTimeout: Duration = .seconds(12), throttleDelays: [Duration] = [.seconds(1), .seconds(2), .seconds(4)]) }`、`public enum PolylineSimplifier { static let simplifyAbovePoints = 2000; static func simplify(_:toleranceMeters:) -> [GeoPoint] }`、`public struct CannedRouteProvider: RouteProvider { public init() }`(直線距離から決定的に: 徒歩 12 分/km、車 max(3, 3 分/km)、公共交通 max(5, 4 分/km)。徒歩・車は 3 点のジオメトリ)。

- [ ] **Step 1: 失敗するテストを書く**

```swift
// Tests/TripCheckAppCoreTests/Support/FakeDirecting.swift
import Foundation
import TripCheckKit
@testable import TripCheckAppCore

actor DirectingLog { private(set) var calls = 0; func next() -> Int { calls += 1; return calls } }

/// 鍵 `"\(mode.rawValue)|\(legKey)"` ごとの回答。無い鍵は `notFound`。最初の `throttleFirst` 回は `throttled`。
struct FakeDirecting: Directing {
  var answers: [String: DirectionsAnswer] = [:]
  var throttleFirst = 0
  var delay: Duration = .zero
  let log = DirectingLog()
  func directions(_ request: RouteRequest) async throws -> DirectionsAnswer {
    if await log.next() <= throttleFirst { throw DirectionsFailure.throttled }
    try await Task.sleep(for: delay)
    guard let answer = answers["\(request.mode.rawValue)|\(request.legKey)"] else { throw DirectionsFailure.notFound }
    return answer
  }
}

struct HangingDirecting: Directing {
  func directions(_ request: RouteRequest) async throws -> DirectionsAnswer {
    try await Task.sleep(for: .seconds(60))
    return DirectionsAnswer(travelSeconds: 60, distanceMeters: nil, geometry: nil, expectedDeparture: nil)
  }
}
```

```swift
// Tests/TripCheckAppCoreTests/AppleRouteProviderTests.swift
import Foundation
import Testing
@testable import TripCheckAppCore
import TripCheckKit

private let a = GeoPoint(latitude: 46.948, longitude: 7.447), b = GeoPoint(latitude: 46.96, longitude: 7.46)
private func walk(_ key: String = "x::y") -> RouteRequest { RouteRequest(legKey: key, from: a, to: b, mode: .walk, departure: nil) }
private func transit() -> RouteRequest { RouteRequest(legKey: "x::y", from: a, to: b, mode: .transit, departure: Date(timeIntervalSince1970: 1_800_000_000)) }
private let tenMinutes = DirectionsAnswer(travelSeconds: 600, distanceMeters: nil, geometry: nil, expectedDeparture: nil)

@Test func aMeasuredWalkCarriesMinutesAndGeometryAndZeroMinutesIsAFailure() async {
  let fake = FakeDirecting(answers: ["walk|x::y": DirectionsAnswer(travelSeconds: 1_530, distanceMeters: 1_900.4, geometry: [a, b], expectedDeparture: nil)])
  #expect(await AppleRouteProvider(directing: fake).route(walk(), locale: .ja) == .measured(minutes: 26, distanceMeters: 1_900, geometry: [a, b], expectedDeparture: nil))
  let zero = FakeDirecting(answers: ["walk|x::y": DirectionsAnswer(travelSeconds: 20, distanceMeters: 10, geometry: [a, b], expectedDeparture: nil)])
  #expect(await AppleRouteProvider(directing: zero).route(walk(), locale: .en) == .failed)
}

/// 3 分類: notFound → unroutable、other → failed、throttled → 1/2/4 秒で 3 回まで再試行(ここでは短く注入)。
@Test func failuresAreClassifiedAndThrottlingIsRetriedThreeTimes() async {
  #expect(await AppleRouteProvider(directing: FakeDirecting()).route(walk("no::route"), locale: .en) == .unroutable)
  struct Broken: Directing { func directions(_ request: RouteRequest) async throws -> DirectionsAnswer { throw DirectionsFailure.other } }
  #expect(await AppleRouteProvider(directing: Broken()).route(walk(), locale: .en) == .failed)
  let fast: [Duration] = [.milliseconds(1), .milliseconds(2), .milliseconds(4)]
  let recovers = FakeDirecting(answers: ["transit|x::y": tenMinutes], throttleFirst: 3)
  #expect(await AppleRouteProvider(directing: recovers, throttleDelays: fast).route(transit(), locale: .en) == .measured(minutes: 10, distanceMeters: nil, geometry: nil, expectedDeparture: nil))
  let recoveredAfter = await recovers.log.calls
  #expect(recoveredAfter == 4)
  let givesUp = FakeDirecting(answers: ["transit|x::y": tenMinutes], throttleFirst: 4)
  #expect(await AppleRouteProvider(directing: givesUp, throttleDelays: fast).route(transit(), locale: .en) == .failed)
  let gaveUpAfter = await givesUp.log.calls
  #expect(gaveUpAfter == 4)
}

/// タイムアウト(徒歩/車 8 秒・公共交通 12 秒、ここでは短く注入)。待ちは本当に解ける。
@Test func aHangingProviderLosesTheRace() async {
  let clock = ContinuousClock(), start = clock.now
  let provider = AppleRouteProvider(directing: HangingDirecting(), walkDriveTimeout: .milliseconds(30), transitTimeout: .milliseconds(60))
  #expect(await provider.route(walk(), locale: .en) == .failed)
  #expect(await provider.route(transit(), locale: .en) == .failed)
  #expect(clock.now - start < .seconds(5))
}

@Test func douglasPeuckerKeepsEndpointsAndDropsNearlyCollinearPoints() {
  let line = (0...4000).map { GeoPoint(latitude: 46.0 + Double($0) * 0.00001, longitude: 7.0 + Double($0) * 0.00001) }
  let simplified = PolylineSimplifier.simplify(line, toleranceMeters: 5)
  #expect(simplified.first == line.first && simplified.last == line.last && simplified.count < 10)
  let bent = [GeoPoint(latitude: 46, longitude: 7), GeoPoint(latitude: 46.01, longitude: 7.02), GeoPoint(latitude: 46.02, longitude: 7)]
  #expect(PolylineSimplifier.simplify(bent, toleranceMeters: 5) == bent)
}
```

- [ ] **Step 2: 赤を確認** — Run: `cd apple && tools/verify-kit.sh --filter AppleRouteProviderTests` → Expected: `cannot find type 'Directing' in scope`。

- [ ] **Step 3: 実装**

```swift
// Sources/TripCheckAppCore/Providers/AppleRouteProvider.swift
import Foundation
import MapKit
import TripCheckKit

/*
 * 端末内の `MKDirections` を Kit の `RouteProvider` に合わせる(spec §5)。`ApplePlaceResolver` と同じ作り:
 * プロトコルの裏に MapKit を閉じ、`CancelHandle` で取り消しを中継し、時計とレースする。
 * Apple の答えは「見つかった」であって「確かめた」ではない —— 出典は `BuildRunner` が `.apple` と記録し、
 * 状態は `estimated` 止まり。
 */
public struct DirectionsAnswer: Hashable, Sendable {
  public var travelSeconds: Double
  public var distanceMeters: Double?
  public var geometry: [GeoPoint]?
  public var expectedDeparture: Date?
  public init(travelSeconds: Double, distanceMeters: Double?, geometry: [GeoPoint]?, expectedDeparture: Date?) {
    self.travelSeconds = travelSeconds; self.distanceMeters = distanceMeters; self.geometry = geometry; self.expectedDeparture = expectedDeparture
  }
}

public enum DirectionsFailure: Error, Equatable {
  /// `MKError.loadingThrottled` —— 提供元が 1/2/4 秒で再試行する。
  case throttled
  /// `MKError.directionsNotFound` / `.placemarkNotFound` —— 経路なし。
  case notFound
  case other
}

public protocol Directing: Sendable {
  func directions(_ request: RouteRequest) async throws -> DirectionsAnswer
}

@MainActor
public final class MKDirectionsAdapter: Directing {
  nonisolated public init() {}

  public func directions(_ request: RouteRequest) async throws -> DirectionsAnswer {
    let mk = MKDirections.Request()
    mk.source = Self.mapItem(request.from)
    mk.destination = Self.mapItem(request.to)
    mk.requestsAlternateRoutes = false
    switch request.mode {
    case .walk: mk.transportType = .walking
    case .taxi: mk.transportType = .automobile; mk.departureDate = request.departure
    case .transit: mk.transportType = .transit; mk.departureDate = request.departure
    }
    // 1 台を手元に持ったまま待つ(`MKLocalSearchAdapter` と同じ)。`calculate()` はタスクの取り消しを
    // 見ないので、`CancelHandle` が `cancel()` を引いて待ちを解く。
    let directions = MKDirections(request: mk)
    do {
      if request.mode == .transit {
        // transit は ETA しか返さない(`calculate()` は失敗する)。
        let eta = try await CancelHandle { directions.cancel() }.relaying { try await directions.calculateETA() }
        return DirectionsAnswer(travelSeconds: eta.expectedTravelTime, distanceMeters: eta.distance, geometry: nil, expectedDeparture: eta.expectedDepartureDate)
      }
      let response = try await CancelHandle { directions.cancel() }.relaying { try await directions.calculate() }
      guard let route = response.routes.first else { throw DirectionsFailure.notFound }
      return DirectionsAnswer(travelSeconds: route.expectedTravelTime, distanceMeters: route.distance, geometry: Self.geometry(route.polyline), expectedDeparture: nil)
    } catch let error as MKError {
      throw Self.classify(error)
    }
  }

  static func classify(_ error: MKError) -> DirectionsFailure {
    switch error.code {
    case .loadingThrottled: .throttled
    case .directionsNotFound, .placemarkNotFound: .notFound
    default: .other
    }
  }

  /// 座標 → `MKMapItem` はここ 1 か所(iOS 26 で初期化子が変わる)。
  static func mapItem(_ point: GeoPoint) -> MKMapItem { MKMapItem(placemark: MKPlacemark(coordinate: point.clLocation)) }

  /// `MKPolyline` はアダプタの隔離内で `[GeoPoint]` に変換してから返す(MapKit の型を外に出さない)。
  static func geometry(_ polyline: MKPolyline) -> [GeoPoint] {
    var coordinates = [CLLocationCoordinate2D](repeating: kCLLocationCoordinate2DInvalid, count: polyline.pointCount)
    polyline.getCoordinates(&coordinates, range: NSRange(location: 0, length: polyline.pointCount))
    let points = coordinates.map { GeoPoint(latitude: $0.latitude, longitude: $0.longitude) }
    return points.count > PolylineSimplifier.simplifyAbovePoints ? PolylineSimplifier.simplify(points, toleranceMeters: 5) : points
  }
}

public struct AppleRouteProvider: RouteProvider {
  let directing: any Directing
  let walkDriveTimeout: Duration
  let transitTimeout: Duration
  let throttleDelays: [Duration]

  public init(directing: any Directing = MKDirectionsAdapter(), walkDriveTimeout: Duration = .seconds(8), transitTimeout: Duration = .seconds(12), throttleDelays: [Duration] = [.seconds(1), .seconds(2), .seconds(4)]) {
    self.directing = directing; self.walkDriveTimeout = walkDriveTimeout; self.transitTimeout = transitTimeout; self.throttleDelays = throttleDelays
  }

  public func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome {
    let limit = request.mode == .transit ? transitTimeout : walkDriveTimeout
    let directing = self.directing
    var delays = throttleDelays.makeIterator()
    while true {
      switch await race(limit, { try await directing.directions(request) }) {
      case .answered(let answer):
        let minutes = Int((answer.travelSeconds / 60).rounded())
        guard minutes >= 1 else { return .failed }   // 0 分は failed に読み替える(spec §5)
        return .measured(minutes: minutes, distanceMeters: answer.distanceMeters.map { Int($0.rounded()) }, geometry: answer.geometry, expectedDeparture: answer.expectedDeparture)
      case .unroutable: return .unroutable
      case .throttled:
        guard let delay = delays.next() else { return .failed }
        try? await Task.sleep(for: delay)
        if Task.isCancelled { return .failed }
      case .failed: return .failed
      }
    }
  }

  private enum Raced: Sendable { case answered(DirectionsAnswer), unroutable, throttled, failed }

  private func race(_ limit: Duration, _ ask: @escaping @Sendable () async throws -> DirectionsAnswer) async -> Raced {
    await withTaskGroup(of: Raced.self) { group in
      group.addTask {
        do { return .answered(try await ask()) }
        catch DirectionsFailure.notFound { return .unroutable }
        catch DirectionsFailure.throttled { return .throttled }
        catch { return .failed }
      }
      group.addTask { try? await Task.sleep(for: limit); return .failed }
      let first = await group.next() ?? .failed
      group.cancelAll()   // 負けた側を畳む: `Task.sleep` は自分で解け、MapKit は `CancelHandle` が解く
      return first
    }
  }
}
```

```swift
// Sources/TripCheckAppCore/Map/PolylineSimplifier.swift
import Foundation
import TripCheckKit

/// Douglas–Peucker。2000 点を超える経路線だけに約 5 m で掛ける(`MKDirectionsAdapter.geometry`)。
public enum PolylineSimplifier {
  public static let simplifyAbovePoints = 2000

  public static func simplify(_ points: [GeoPoint], toleranceMeters: Double) -> [GeoPoint] {
    guard points.count > 2 else { return points }
    var keep = [Bool](repeating: false, count: points.count)
    keep[0] = true; keep[points.count - 1] = true
    var stack: [(Int, Int)] = [(0, points.count - 1)]
    while let (first, last) = stack.popLast() {
      var farthest = 0.0, index = first
      for i in (first + 1)..<last {
        let d = distanceMeters(points[i], fromSegment: points[first], points[last])
        if d > farthest { farthest = d; index = i }
      }
      if farthest > toleranceMeters { keep[index] = true; stack.append((first, index)); stack.append((index, last)) }
    }
    return points.enumerated().filter { keep[$0.offset] }.map(\.element)
  }

  /// 等距円筒近似(経路線 1 本の範囲では十分)。
  static func distanceMeters(_ p: GeoPoint, fromSegment a: GeoPoint, _ b: GeoPoint) -> Double {
    let scale = 111_320.0, cosLat = cos(a.latitude * .pi / 180)
    let bx = (b.longitude - a.longitude) * scale * cosLat, by = (b.latitude - a.latitude) * scale
    let px = (p.longitude - a.longitude) * scale * cosLat, py = (p.latitude - a.latitude) * scale
    let len2 = bx * bx + by * by
    let t = len2 == 0 ? 0 : max(0, min(1, (px * bx + py * by) / len2))
    let dx = px - t * bx, dy = py - t * by
    return (dx * dx + dy * dy).squareRoot()
  }
}
```

```swift
// Sources/TripCheckAppCore/Providers/CannedRouteProvider.swift
import Foundation
import TripCheckKit

/// 通信しない決定的な提供元。`-uiTesting` の注入先(`TripCheckApp`)。
/// 徒歩 12 分/km、車 max(3, 3 分/km)、公共交通 max(5, 4 分/km)。徒歩・車は 3 点のジオメトリ。
public struct CannedRouteProvider: RouteProvider {
  public init() {}
  public func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome {
    let km = straightLineDistanceKm(request.from, request.to), meters = Int((km * 1000).rounded())
    let mid = GeoPoint(latitude: (request.from.latitude + request.to.latitude) / 2 + 0.002, longitude: (request.from.longitude + request.to.longitude) / 2)
    switch request.mode {
    case .walk: return .measured(minutes: max(1, Int((km * 12).rounded())), distanceMeters: meters, geometry: [request.from, mid, request.to], expectedDeparture: nil)
    case .taxi: return .measured(minutes: max(3, Int((km * 3).rounded())), distanceMeters: meters, geometry: [request.from, mid, request.to], expectedDeparture: request.departure)
    case .transit: return .measured(minutes: max(5, Int((km * 4).rounded())), distanceMeters: nil, geometry: nil, expectedDeparture: request.departure)
    }
  }
}
```

- [ ] **Step 4: 緑を確認** — Run: `cd apple && tools/verify-kit.sh --filter AppleRouteProviderTests` → Expected: 4 本 passed(Apple は 1 度も呼ばれない)。

- [ ] **Step 5: Commit**

```bash
git add apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Providers apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Map/PolylineSimplifier.swift apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/Support/FakeDirecting.swift apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/AppleRouteProviderTests.swift
git commit -m "The phone asks its own map for a route, waits a bounded time, and never mistakes silence for a road

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J"
```

---

### Task 5: `PlannerStore` への組み込み — `liveRoutes` / `routeProvider` / 折り込み / 世代の無効化 / `BuildRunner` の出典

**Files:**
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore.swift:70-109`(stored tools)、`:111-119`(init)、`:141-211`(`tripRequest`)、`:218-248`(`build()`)、`:253-260`(`cancelBuild()`)、`:263-286`(`reset()`);`…/Store/BuildRunner.swift:20-38`;`…/Store/PlannerStore+Start.swift:236-246`(`setDestination`)
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore+Routes.swift`(状態と `invalidateRoutes`。コーディネータは T6 で同じファイルに足す)
- Test: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/RouteEnrichmentTests.swift`(新規、T6/T9 で追記)

**Interfaces:**
- Consumes: T1 `RouteRequest`/`RouteOutcome`/`RouteProvider`/`LiveRouteMerge`、T2 `EvidenceSnapshotOptions.liveRouteSource`、T3 `FakeRouteProvider`。
- Produces(`PlannerStore`): `init(…, initialLocale: PlannerLocale = .ja, routeProvider: (any RouteProvider)? = nil)`(**最後**に追加)、`@ObservationIgnored let routeProvider`、`@ObservationIgnored var liveRoutes: [RouteRequest: RouteOutcome]`、`@ObservationIgnored var attemptedRoutes: Set<RouteRequest>`、`@ObservationIgnored var routeGeneration: Int`、`@ObservationIgnored var routeTask: Task<Void, Never>?`、`@ObservationIgnored var deferredRouteReplacement: Int?`(保留中の連鎖深さ)、`@ObservationIgnored var routeReplacements: Int`、`public internal(set) var routeProgress: RouteProgress?`(観測される)、`public struct RouteProgress: Equatable, Sendable { requested; settled; estimatedRemaining; isComplete }`、`func invalidateRoutes(keepCache: Bool)`、`tripRequest(with:days:)` 末尾の `LiveRouteMerge.apply(liveRoutes, to: &ctx)`、`BuildRunner.liveRouteSource: EvidenceSource = .apple`。

- [ ] **Step 1: 失敗するテストを書く**

```swift
// Tests/TripCheckAppCoreTests/RouteEnrichmentTests.swift
import Foundation
import Testing
@testable import TripCheckAppCore
import TripCheckKit

private func walkRequest(_ key: String) -> RouteRequest {
  RouteRequest(legKey: key, from: GeoPoint(latitude: 46.9, longitude: 7.4), to: GeoPoint(latitude: 46.95, longitude: 7.45), mode: .walk, departure: nil)
}

/// `tripRequest()` は request + edit + liveRoutes から組む。absent/transfer には何も入らない。
@Test @MainActor func theTripRequestFoldsTheRouteCacheIntoTheContext() async {
  let store = PlannerStore(resolvers: [], store: nil)
  store.loadSample(.switzerland)
  #expect(store.tripRequest().context.liveWalkingMinutes == nil)
  store.liveRoutes[walkRequest("a::b")] = .measured(minutes: 14, distanceMeters: 900, geometry: nil, expectedDeparture: nil)
  store.liveRoutes[walkRequest("c::d")] = .failed
  let ctx = store.tripRequest().context
  #expect(ctx.liveWalkingMinutes == ["a::b": 14] && ctx.liveTransitAbsentLegs == nil && ctx.liveTransitTransferCounts == nil)
}

/// provider 未注入なら何も起きない(今までの挙動)。
@Test @MainActor func withoutAProviderNothingIsFetched() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  await store.build()
  #expect(store.routeProvider == nil && store.routeProgress == nil && store.liveRoutes.isEmpty)
  #expect(store.bundle?.plan.days.flatMap(\.legs).allSatisfy { $0.comparison.recommended.source == .estimate } == true)
}

/// reset と目的地変更はキャッシュごと捨て、cancelBuild/build は世代だけ進めてキャッシュを残す。
/// 世代の数は `invalidateRoutes` の呼び出し数そのもの: `reset()` は `cancelBuild()` を経由するので 2 つ進む。
@Test @MainActor func generationsAdvanceAndTheCacheIsClearedOnlyWhereTheTripChanges() async {
  let store = PlannerStore(resolvers: [], store: nil)
  store.loadSample(.switzerland)
  store.liveRoutes[walkRequest("a::b")] = .failed
  store.attemptedRoutes.insert(walkRequest("a::b"))
  let g0 = store.routeGeneration
  store.cancelBuild()
  #expect(store.routeGeneration == g0 + 1 && store.liveRoutes.count == 1 && store.attemptedRoutes.isEmpty)
  await store.build()
  #expect(store.routeGeneration == g0 + 2 && store.liveRoutes.count == 1)
  store.setDestination(.destination(.japan))
  #expect(store.routeGeneration == g0 + 3 && store.liveRoutes.isEmpty)
  store.liveRoutes[walkRequest("a::b")] = .failed
  store.reset()   // cancelBuild()(+1)→ invalidateRoutes(keepCache: false)(+1)
  #expect(store.routeGeneration == g0 + 5 && store.liveRoutes.isEmpty && store.routeProgress == nil)
}

/// `BuildRunner` は Apple を出典として渡す。live が無ければ経路の事実は derived のまま。
/// 生テキストは見本の 8 行(`TripBuilder` は行と `resolvedStops` を `inputIndex` で突き合わせるので、空の raw では停留所が 1 つも組まれない)。
@Test func theBuildRunnerRecordsAppleAsTheLiveRouteSource() {
  let raw = Destinations.byId(.switzerland).sample?[.en] ?? ""
  let bundle = BuildRunner.run(TripRequest(raw: raw, days: 2, pace: .balanced, locale: .en, context: PlannerContext(destination: .destination(.switzerland), resolvedStops: SwissSample.resolvedStops(locale: .en))))
  let routeFacts = bundle.evidence.facts.filter { $0.kind == .route_leg }
  #expect(!routeFacts.isEmpty && routeFacts.allSatisfy { $0.evidence.source != .google && $0.evidence.source != .apple })
  #expect(BuildRunner.liveRouteSource == .apple)
}
```

- [ ] **Step 2: 赤を確認** — Run: `cd apple && tools/verify-kit.sh --filter RouteEnrichmentTests` → Expected: `value of type 'PlannerStore' has no member 'liveRoutes'`。

- [ ] **Step 3: 実装**

```swift
// Store/PlannerStore.swift — stored tools(:70-109 の群に追記)
  /// 経路の提供元。`nil` = 今までの挙動(テストと旧来の呼び出しの既定)。
  @ObservationIgnored let routeProvider: (any RouteProvider)?
  /// 回答キャッシュ(ジオメトリも同じ値の中)。**永続化しない・共有しない・Undo に入れない・`view` に
  /// 置かない。** `tripRequest(with:days:)` が `LiveRouteMerge.apply` で折り込む。
  @ObservationIgnored var liveRoutes: [RouteRequest: RouteOutcome] = [:]
  /// 1 ビルド内で再試行しないための印(`build()` / `reset()` / `cancelBuild()` で空になる)。
  @ObservationIgnored var attemptedRoutes: Set<RouteRequest> = []
  /// `resolveGeneration` と同じ流儀。進んだ後に返ってきた回答は捨てる(キャッシュにも入れない)。
  @ObservationIgnored var routeGeneration = 0
  @ObservationIgnored var routeTask: Task<Void, Never>?
  /// 確認ダイアログが開いていて置換を保留した連鎖の深さ。閉じたときに再開する。
  @ObservationIgnored var deferredRouteReplacement: Int?
  /// 置換した回数(テストが「1 回だけ」を数えるため)。
  @ObservationIgnored var routeReplacements = 0
  /// 進捗の表示用値。`view` ではなく store 直下(spec §4.1)。
  public internal(set) var routeProgress: RouteProgress?

// init(:111-119)の最後の引数と代入
    initialLocale: PlannerLocale = .ja,
    routeProvider: (any RouteProvider)? = nil
  ) {
    self.routeProvider = routeProvider

// tripRequest(with:days:)(:161-211)。doc(:141-145)を「`request` と `edit` と `liveRoutes` を畳む。
// **`view` は読まない**」に改め、`ctx.mealPlan = request.mealPlan` の直後に:
    LiveRouteMerge.apply(liveRoutes, to: &ctx)

// build()(:218)と cancelBuild()(:253)の `buildGeneration += 1` の直後:
    invalidateRoutes(keepCache: true)
// reset()(:263)の `cancelBuild()` の直後:
    invalidateRoutes(keepCache: false)
// Store/PlannerStore+Start.swift setDestination(:237)の `request.destination = choice` の直後:
    invalidateRoutes(keepCache: false)
```

```swift
// Store/PlannerStore+Routes.swift
import Foundation
import TripCheckKit

/// 取得の進み具合。`requested` 件のうち `settled` 件が答え(成功・失敗・締切)を持ち、
/// `estimatedRemaining` はどの手段も測れなかった**レグ**の数(要求した鍵のうち `.measured` が 1 つも無いレグ)。
/// 全部測れたら `routeProgress` そのものが `nil` になる(T6)。
public struct RouteProgress: Equatable, Sendable {
  public var requested: Int
  public var settled: Int
  public var estimatedRemaining: Int
  public var isComplete: Bool { settled >= requested }
  public init(requested: Int, settled: Int, estimatedRemaining: Int) {
    self.requested = requested; self.settled = settled; self.estimatedRemaining = estimatedRemaining
  }
}

extension PlannerStore {
  /// 走っている取得を止め、世代を進める。`keepCache: false` は旅そのものが入れ替わるとき
  /// (`reset()` / 目的地の変更)。`build()` / `cancelBuild()` はキャッシュを残して再利用する。
  func invalidateRoutes(keepCache: Bool) {
    routeTask?.cancel()
    routeTask = nil
    routeGeneration += 1
    attemptedRoutes.removeAll()
    deferredRouteReplacement = nil
    routeProgress = nil
    if !keepCache { liveRoutes.removeAll() }
  }
}
```

```swift
// Store/BuildRunner.swift — :20 の直前に定数、:28-38 の options に 1 引数
  /// spec §3.3: このアプリの live 経路は Apple 由来。Kit の既定(nil = google)は Web とフィクスチャのもの。
  public static let liveRouteSource: EvidenceSource = .apple
  …
      dayEndTimes: ctx.dayEndTimes,
      liveRouteSource: liveRouteSource
    ))
```

- [ ] **Step 4: 緑を確認** — Run: `cd apple && tools/verify-kit.sh` → Expected: 全件 passed(`PlannerStoreBuildTests` の `buildGate` 2 本も不変 —— `invalidateRoutes` は同期で `buildGate` の前)。

- [ ] **Step 5: Commit**

```bash
git add apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/RouteEnrichmentTests.swift
git commit -m "The store keeps measured routes beside the request, folds them in at build time, and forgets them when the trip changes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J"
```

---

### Task 6: 取得コーディネータ — 同時 4 件・締切・世代・静かな置換・保留・連鎖上限・トースト・進捗

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/RouteFetcher.swift`
- Modify: `…/Store/PlannerStore+Routes.swift`(追記)、`…/Store/PlannerStore.swift:321-345`(`commit` 末尾)、`…/Store/PlannerStore+Edits.swift:165-173`(`confirmPendingEdit`)、`:176-179`(`cancelPendingEdit`)、`:184-192`(`adoptPending` 末尾)、`:239-253`(`adoptHistoryPresent` 末尾)、`…/Presentation/AppCopy.swift`(`routesUpdatedToast` 1 鍵。残りは T7)
- Test: `RouteEnrichmentTests.swift`(追記)

**Interfaces:**
- Consumes: T3 `RouteRequests.requests`、T5 の状態、`BuildRunner.run`、`buildGate`、`adopt(_:)`、`pendingApply`、`showToast(_:)`、`TripScenarios.totalPlanBufferMinutes(plan:context:)`、`VerdictCopy.bufferToastDetail(_:locale:)`。
- Produces: `enum RouteFetcher { static let concurrency = 4; static let deadline: Duration = .seconds(40); static func fetch(_ requests: [RouteRequest], provider: any RouteProvider, locale: PlannerLocale, concurrency: Int = concurrency, deadline: Duration = deadline, onSettled: @escaping @MainActor @Sendable (RouteRequest, RouteOutcome) -> Void) async -> [RouteRequest: RouteOutcome] }`、`PlannerStore.maximumRouteChain = 2`、`startRouteEnrichment(chainDepth: Int = 0)`、`replaceWithLiveRoutes(chainDepth: Int) async`、`scheduleRouteReplacement(chainDepth: Int)`(private)、`resumeDeferredRouteReplacement()`、`liveRoutesAreAdopted: Bool`、`awaitRouteEnrichment() async`(テスト用)、`AppCopy.routesUpdatedToast`(ja「実経路で更新しました」/ en "Updated with measured routes")。
- `routeTask` の約束: **`routeGeneration` を進めた者が `routeTask` を持ち、終わりに世代が変わっていなければ自分で畳む**。`startRouteEnrichment` と `scheduleRouteReplacement` は呼ばれるたびに世代を進める。取りに行くものが無く置換も要らない呼び出しは、その場で `routeTask = nil` にする(外側の task の末尾は世代が変わっているので触らない)。`awaitRouteEnrichment` はこの約束に乗る。

- [ ] **Step 1: 失敗するテストを書く(`RouteEnrichmentTests.swift` に追記)**

```swift
@MainActor func enrichedSample(_ provider: some RouteProvider, taxiOnFirstLeg: Bool = false) async -> PlannerStore {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil, routeProvider: provider)
  store.loadSample(.switzerland)
  if taxiOnFirstLeg {
    let plain = PlannerStore(resolvers: [CatalogResolver()], store: nil); plain.loadSample(.switzerland); await plain.build()
    store.edit.legModeOverrides[RouteRequests.legs(plan: plain.bundle!.plan, overrides: [:])[0].legKey] = .taxi
  }
  await store.build()
  await store.awaitRouteEnrichment()
  return store
}

/// 置換は静か: `.building` を挟まず、history に触れず、トーストは 1 回で Undo 不可。置換後のレグは live を使う。
@Test @MainActor func theQuietReplacementUsesTheAnswersOnceAndLeavesHistoryAlone() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil, routeProvider: FakeRouteProvider())
  store.loadSample(.switzerland)
  await store.build()
  let presentBefore = store.history.present
  #expect(store.routeProgress?.isComplete == false)
  // 置換が来るまで画面を見張る(本線を譲りながら)。10 秒で諦めるが、そのときは下の
  // `routeReplacements == 1` が赤になるので黙って通ることは無い。
  var sawBuilding = false
  let clock = ContinuousClock(), deadline = clock.now + .seconds(10)
  while store.routeReplacements == 0 && clock.now < deadline {
    if store.view.screen == .building { sawBuilding = true }
    await Task.yield()
  }
  await store.awaitRouteEnrichment()
  #expect(!sawBuilding && store.view.screen == .plan)
  #expect(store.routeReplacements == 1)
  #expect(store.history.present == presentBefore && store.canUndo == false)
  #expect(store.view.toast?.kind == .info && store.view.toast?.canUndo == false)
  #expect(store.view.toast?.text.hasPrefix(AppCopy.for(store.request.locale).routesUpdatedToast) == true)
  #expect(store.routeProgress == nil)   // 全部測れたので行そのものが消える
  #expect(store.bundle!.plan.days.flatMap(\.legs).contains { $0.comparison.options.contains { $0.source == .live } })
  #expect(store.liveRoutesAreAdopted)
}

/// 同時 4 件。締切を過ぎた分は答え無し(呼び手が失敗として扱う)。
@Test func theFetcherKeepsFourInFlightAndStopsAtTheDeadline() async {
  actor Peak { var inFlight = 0; var peak = 0; func enter() { inFlight += 1; peak = max(peak, inFlight) }; func leave() { inFlight -= 1 } }
  struct Counting: RouteProvider {
    let peak: Peak
    func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome {
      await peak.enter(); try? await Task.sleep(for: .milliseconds(30)); await peak.leave()
      return .measured(minutes: 5, distanceMeters: nil, geometry: nil, expectedDeparture: nil)
    }
  }
  struct Hanging: RouteProvider { func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome { try? await Task.sleep(for: .seconds(30)); return .failed } }
  let peak = Peak()
  let requests = (0..<12).map { walkRequest("s\($0)::t\($0)") }
  let answers = await RouteFetcher.fetch(requests, provider: Counting(peak: peak), locale: .en, onSettled: { _, _ in })
  let observed = await peak.peak
  #expect(answers.count == 12 && observed == 4)
  let clock = ContinuousClock(), start = clock.now
  let late = await RouteFetcher.fetch(requests, provider: Hanging(), locale: .en, deadline: .milliseconds(50), onSettled: { _, _ in })
  #expect(late.isEmpty && clock.now - start < .seconds(5))
}

/// 取得中に旅が入れ替わったら古い回答は捨てる(キャッシュにも入れない)。
@Test @MainActor func answersFromAnOlderGenerationAreDropped() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil, routeProvider: FakeRouteProvider(delay: .milliseconds(80)))
  store.loadSample(.switzerland)
  await store.build()
  let running = store.routeTask
  store.setDestination(.destination(.switzerland))   // routeGeneration が進む
  await running?.value
  #expect(store.liveRoutes.isEmpty && store.routeReplacements == 0)
}

/// 確認ダイアログが開いている間は置換を保留し、閉じたときに反映する。
@Test @MainActor func replacementWaitsWhileAQuestionIsOpen() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil, routeProvider: FakeRouteProvider(delay: .milliseconds(40)))
  store.loadSample(.switzerland)
  await store.build()
  store.pendingApply = PendingGuardedEdit(candidate: store.edit, bundle: store.bundle!, label: "x", bufferDeltaMinutes: 0, generation: store.buildGeneration, sideEffects: .none)
  store.view.pendingHardEdit = .edit(conflicts: [], extraConflicts: [], fallbackTitle: "t")
  await store.awaitRouteEnrichment()
  #expect(store.routeReplacements == 0 && store.deferredRouteReplacement == 0)
  store.cancelPendingEdit()
  await store.awaitRouteEnrichment()
  #expect(store.routeReplacements == 1 && store.deferredRouteReplacement == nil)
}

/// 失敗したレグは推定のまま。進捗は「N 区間は推定のまま」の材料を持ち、次のビルドまで残る。
@Test @MainActor func failedLegsStayEstimatedAndAreCounted() async {
  let plain = PlannerStore(resolvers: [CatalogResolver()], store: nil); plain.loadSample(.switzerland); await plain.build()
  let firstKey = RouteRequests.legs(plan: plain.bundle!.plan, overrides: [:])[0].legKey
  // 車の上書きを置くのは、そのレグに必ず 1 件は要求が立つようにするため(使用中の手段は必ず候補に入る)。
  let store = await enrichedSample(FakeRouteProvider(failing: [firstKey]), taxiOnFirstLeg: true)
  #expect(store.routeProgress?.isComplete == true && store.routeProgress?.estimatedRemaining == 1)
  #expect(store.attemptedRoutes.contains { $0.legKey == firstKey })
  #expect(store.bundle!.plan.days.flatMap(\.legs).first { routeLegKey($0.from.id, $0.to.id) == firstKey }?.comparison.options.allSatisfy { $0.source == .estimate } == true)
}

/// 連鎖は 2 世代まで。3 世代目は取りに行かない。
@Test @MainActor func theChainStopsAtTheSecondGeneration() async {
  let provider = FakeRouteProvider()
  let store = await enrichedSample(provider)
  store.attemptedRoutes.removeAll(); store.liveRoutes.removeAll()
  let before = await provider.log.requests.count
  store.startRouteEnrichment(chainDepth: PlannerStore.maximumRouteChain)
  await store.awaitRouteEnrichment()
  let after = await provider.log.requests.count
  #expect(after == before && store.routeTask == nil)
}
```

- [ ] **Step 2: 赤を確認** — Run: `cd apple && tools/verify-kit.sh --filter RouteEnrichmentTests` → Expected: `cannot find 'RouteFetcher' in scope`、`has no member 'awaitRouteEnrichment'`。

- [ ] **Step 3: 実装**

```swift
// Store/RouteFetcher.swift
import Foundation
import TripCheckKit

/// 同時 `concurrency` 件の窓で取得し、`deadline` で打ち切る(spec §4.4)。答えの無い要求は辞書に
/// **入らない**(失敗と同じ扱い、印は呼び手が付ける)。`ApplePlaceResolver.resolve` と同じ窓: 1 件返るたびに次を 1 件立てる。
enum RouteFetcher {
  static let concurrency = 4
  static let deadline: Duration = .seconds(40)

  static func fetch(
    _ requests: [RouteRequest], provider: any RouteProvider, locale: PlannerLocale,
    concurrency: Int = concurrency, deadline: Duration = deadline,
    onSettled: @escaping @MainActor @Sendable (RouteRequest, RouteOutcome) -> Void
  ) async -> [RouteRequest: RouteOutcome] {
    await withTaskGroup(of: (RouteRequest, RouteOutcome)?.self) { group in
      var answers: [RouteRequest: RouteOutcome] = [:]
      var pending = requests.makeIterator()
      var inFlight = 0
      group.addTask { try? await Task.sleep(for: deadline); return nil }   // 締切の時計
      for _ in 0..<max(1, concurrency) {
        guard let request = pending.next() else { break }
        inFlight += 1
        group.addTask { (request, await provider.route(request, locale: locale)) }
      }
      while inFlight > 0, let next = await group.next() {
        guard let (request, outcome) = next else { break }   // 締切が鳴った
        inFlight -= 1
        answers[request] = outcome
        await onSettled(request, outcome)
        if let request = pending.next() { inFlight += 1; group.addTask { (request, await provider.route(request, locale: locale)) } }
      }
      group.cancelAll()   // 負けた側(時計か、締切後の取得)を畳む。提供元は取り消しで解ける
      return answers
    }
  }
}
```

```swift
// Store/PlannerStore+Routes.swift — 追記
extension PlannerStore {
  /// 置換で日割りが変わって新しいレグが出たとき、追加で取りに行ける世代の数(spec §4.5-6)。
  static let maximumRouteChain = 2

  /// `commit` / `adoptPending` / `adoptHistoryPresent` の直後に呼ぶ。`bundle.plan` から要求を列挙し、
  /// キャッシュに無く未試行のものだけ取りに行く。全部揃っていて未反映なら即置換。
  func startRouteEnrichment(chainDepth: Int = 0) {
    guard let routeProvider, let bundle, chainDepth < Self.maximumRouteChain else { return }
    if chainDepth == 0 { routeTask?.cancel() }   // 連鎖は自分の中から呼ばれるので自分を畳まない
    routeGeneration += 1
    let generation = routeGeneration
    let requests = RouteRequests.requests(plan: bundle.plan, context: bundle.request.context, overrides: edit.legModeOverrides, selectedDay: view.selectedDay, now: Date())
    // 今の旅程に無い鍵(古いバケット・消えたレグ)は捨てる。同じレグ×手段の答えは 1 つだけ残る。
    let current = Set(requests)
    liveRoutes = liveRoutes.filter { current.contains($0.key) }
    let pending = requests.filter { liveRoutes[$0] == nil && !attemptedRoutes.contains($0) }
    guard !pending.isEmpty else {
      // 取りに行くものは無い。旅程がキャッシュを既に消費していれば仕事そのものが無い ——
      // 世代はもう進めてあるので、外側の task の末尾は触らない。ここで自分で畳む。
      if liveRoutesAreAdopted { routeTask = nil } else { scheduleRouteReplacement(chainDepth: chainDepth) }
      return
    }
    attemptedRoutes.formUnion(pending)
    routeProgress = RouteProgress(requested: pending.count, settled: 0, estimatedRemaining: 0)
    let locale = request.locale
    routeTask = Task { [weak self] in
      let answers = await RouteFetcher.fetch(pending, provider: routeProvider, locale: locale) { [weak self] _, _ in
        guard let self, routeGeneration == generation else { return }
        routeProgress?.settled += 1
      }
      guard let self, routeGeneration == generation, !Task.isCancelled else { return }
      for (request, outcome) in answers { liveRoutes[request] = outcome }
      let measured = Set(answers.compactMap { entry -> String? in if case .measured = entry.value { return entry.key.legKey }; return nil })
      let remaining = Set(pending.map(\.legKey)).subtracting(measured).count
      // 全部測れたら進捗そのものを消す(行が消える)。残れば「N 区間は推定のまま」の材料として次のビルドまで残る。
      routeProgress = remaining == 0 ? nil : RouteProgress(requested: pending.count, settled: pending.count, estimatedRemaining: remaining)
      if !measured.isEmpty { await replaceWithLiveRoutes(chainDepth: chainDepth) }
      if routeGeneration == generation { routeTask = nil }
    }
  }

  /// 取りに行くものは無いが、キャッシュをまだ旅程が消費していないときの置換。世代を進めて
  /// この task を `routeTask` の持ち主にする(連鎖の外側の task の末尾に畳まれないため)。
  private func scheduleRouteReplacement(chainDepth: Int) {
    routeGeneration += 1
    let generation = routeGeneration
    routeTask = Task { [weak self] in
      await self?.replaceWithLiveRoutes(chainDepth: chainDepth)
      if let self, routeGeneration == generation { routeTask = nil }
    }
  }

  /// `bundle` が今の `liveRoutes` を既に消費しているか(= 置換が要らないか)。
  var liveRoutesAreAdopted: Bool {
    guard let bundle else { return true }
    let now = tripRequest().context, was = bundle.request.context
    return now.liveWalkingMinutes == was.liveWalkingMinutes && now.liveDrivingMinutes == was.liveDrivingMinutes && now.liveTransitMinutes == was.liveTransitMinutes
  }

  /// 静かな再ビルド(spec §4.5)。**`build()` は呼ばない**(`.building` を挟まず、読み上げを再発火しない)。
  /// `history` にも触れない(編集ではない)。
  func replaceWithLiveRoutes(chainDepth: Int) async {
    guard let before = bundle else { return }
    if pendingApply != nil { deferredRouteReplacement = chainDepth; return }
    let req = tripRequest()
    buildGeneration += 1
    let generation = buildGeneration
    let after = await Task.detached(priority: .userInitiated) { BuildRunner.run(req) }.value
    await buildGate?()
    guard generation == buildGeneration, !Task.isCancelled else { return }
    adopt(after)
    routeReplacements += 1
    let delta = TripScenarios.totalPlanBufferMinutes(plan: after.plan, context: req.context) - TripScenarios.totalPlanBufferMinutes(plan: before.plan, context: before.request.context)
    let text = [AppCopy.for(request.locale).routesUpdatedToast, VerdictCopy.bufferToastDetail(delta, locale: request.locale)].compactMap { $0 }.joined(separator: " ")
    showToast(Toast(text: text, kind: .info, canUndo: false))
    startRouteEnrichment(chainDepth: chainDepth + 1)   // 日割りが変わって新しいレグが出ていれば次の世代で
  }

  /// ダイアログが閉じたときに呼ぶ(`confirmPendingEdit` の捨てる枝 / `cancelPendingEdit`)。
  func resumeDeferredRouteReplacement() {
    guard let depth = deferredRouteReplacement else { return }
    deferredRouteReplacement = nil
    scheduleRouteReplacement(chainDepth: depth)
  }

  /// テスト用: 連鎖も含めて取得が落ち着くまで待つ。
  func awaitRouteEnrichment() async {
    while let task = routeTask { await task.value; if routeTask == task { routeTask = nil } }
  }
}
```

フック(各 1 行):
- `PlannerStore.swift` `commit(_:)`(:321-345)の `view.announcement = hero.text`(:344)の直後に `startRouteEnrichment()`。
- `PlannerStore+Edits.swift` `adoptPending(_:)`(:184-192)の `showEditToast(...)`(:191)の直後、`adoptHistoryPresent()`(:239-253)の `closeInspectorIfItPointsAtNothing()`(:252)の直後に `startRouteEnrichment()`。
- `confirmPendingEdit()`(:165-173): `guard pending.generation == buildGeneration else { resumeDeferredRouteReplacement(); return }` とし、`adoptPending(pending)` の**直前**に `deferredRouteReplacement = nil`(採用すれば `adoptPending` → `startRouteEnrichment()` が最初から測り直すので、保留していた置換は要らない。残すと置換が 2 本走る)。
- `cancelPendingEdit()`(:176-179)の末尾に `resumeDeferredRouteReplacement()`。
- `AppCopy.swift`: `openAppleMaps`(:172)の並びに `public let routesUpdatedToast: String`、init の引数・代入、`ja`「実経路で更新しました」、`en` "Updated with measured routes"(`AppCopyTests` の配列と count は T7 でまとめて更新)。

- [ ] **Step 4: 緑を確認** — Run: `cd apple && tools/verify-kit.sh` → Expected: 全件 passed(`GuardedEditFlowTests` / `PlannerStoreBuildTests` は `routeProvider == nil` なので `startRouteEnrichment` が即 return し不変)。

- [ ] **Step 5: Commit**

```bash
git add apple/Packages/TripCheckKit/Sources/TripCheckAppCore apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/RouteEnrichmentTests.swift
git commit -m "Measured routes arrive in the background and replace the plan once, quietly, with a word about the slack

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J"
```

---

### Task 7: 地図のジオメトリ(実線・300 m 橋渡し)、根拠行、`AppCopy` の残りの鍵

**Files:**
- Modify: `…/Store/PlannerStore+Map.swift:48-61`、`…/Map/MapModel.swift:4-16`(頭の注記)/`:83-86`(`measured` の doc)/`:115-127`(`measuredCount`)、`…/Store/PlannerStore+Timeline.swift:219-260`、`…/Presentation/AppCopy.swift`、`…/Store/PlannerStore+Routes.swift`(`routeProgressLine`)
- Test: `MapModelTests.swift:18-26`(書き換え + 2 本)、`TimelineRowsTests.swift`(1 本)、`AppCopyTests.swift:9-88`(配列と count)

**Interfaces:**
- Consumes: T5/T6 の `liveRoutes`、`edit.legModeOverrides`、`MapRoute`、`straightLineDistanceKm`、`Copy.for(locale).estimated`、T6 の `enrichedSample(_:taxiOnFirstLeg:)`。
- Produces: `MapModel.measuredCount: Int`、`PlannerStore.bridgeThresholdMeters = 300.0`、`PlannerStore.measuredGeometry(for: BuiltPlanLeg) -> [GeoPoint]?`(使用中の手段の回答にジオメトリがあり、**同じ手段の option が `.live`** のときだけ)、`mapModel` の橋渡し id `"leg:<d>:<i>:bridge-start"` / `":bridge-end"`、`MovementModel.evidenceLine`(選択中の option が `.live` → `AppCopy.appleRouteEvidence`、他は `Copy.estimated`)、`AppCopy.appleRouteEvidence`(ja「Apple Maps の経路」/ en "Apple Maps route")、`routesFetching(settled:total:)`(ja「実経路を取得中 \(settled)/\(total)」/ en "Fetching routes \(settled)/\(total)")、`routesEstimatedRemaining(count:)`(ja「\(count)区間は推定のまま」/ en "\(count) leg(s) still estimated")、`mapMeasuredRoutesValue(count:)`(ja「実経路 \(count)区間」/ en "\(count) measured leg(s)")、`PlannerStore.routeProgressLine: String?`。

- [ ] **Step 1: 失敗するテストを書く**

```swift
// MapModelTests.swift:18-26 を置き換え(頭の注記も「提供元が無い区間は破線」に改める)
/// 提供元が無ければ、2 点を結ぶ破線しか描けない。実線は「ここを通る」と言い切る絵。
@Test @MainActor func legsWithoutAProviderAreDashedStraightLines() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let m = store.mapModel(scope: .all)
  #expect(!m.routes.isEmpty && m.measuredCount == 0)
  #expect(m.routes.allSatisfy { !$0.measured && $0.points.count == 2 })
  #expect(m.pins.filter { if case .anchor = $0.kind { return true }; return false }.count == 8)
  #expect(m.pins.allSatisfy { !$0.a11y.isEmpty })
}

/// 使用中の手段が測れたレグだけ実線(3 点以上)。公共交通が使用中のレグは答えがあっても破線。
@Test @MainActor func onlyLegsWhoseModeInUseWasMeasuredBecomeSolid() async {
  let store = await enrichedSample(FakeRouteProvider(), taxiOnFirstLeg: true)
  let m = store.mapModel(scope: .all)
  #expect(m.measuredCount >= 1 && m.measuredCount == m.routes.filter(\.measured).count)
  var checked = 0
  for (dayIndex, day) in store.bundle!.plan.days.enumerated() {
    for (index, leg) in day.legs.enumerated() {
      let key = routeLegKey(leg.from.id, leg.to.id)
      let mode = store.edit.legModeOverrides[key] ?? leg.comparison.recommended.mode
      let route = m.routes.first { $0.id == "leg:\(dayIndex):\(index)" }!
      var geometry = false
      for (r, o) in store.liveRoutes where r.legKey == key && r.mode == mode { if case .measured(_, _, let g?, _) = o { geometry = g.count >= 2 } }
      let live = leg.comparison.options.first { $0.mode == mode }?.source == .live
      #expect(route.measured == (geometry && live))
      #expect(route.measured ? route.points.count >= 3 : route.points.count == 2)
      checked += 1
    }
  }
  #expect(checked > 0)
}

/// 実測経路の端が地点から 300 m 以上離れていれば、短い破線で橋渡しする。
@Test @MainActor func aFarStartingPointGetsADashedBridge() async {
  struct Offset: RouteProvider {
    func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome {
      let start = GeoPoint(latitude: request.from.latitude + 0.01, longitude: request.from.longitude)   // 約 1.1 km 北
      return .measured(minutes: request.mode == .transit ? 20 : 4, distanceMeters: 1000, geometry: request.mode == .transit ? nil : [start, request.to], expectedDeparture: nil)
    }
  }
  let store = await enrichedSample(Offset(), taxiOnFirstLeg: true)
  let m = store.mapModel(scope: .all)
  let solid = m.routes.filter(\.measured)
  #expect(!solid.isEmpty)
  for route in solid {
    let bridge = m.routes.first { $0.id == route.id + ":bridge-start" }
    #expect(bridge?.measured == false && bridge?.points.count == 2)
    #expect(m.routes.first { $0.id == route.id + ":bridge-end" } == nil)
  }
}
```

```swift
// TimelineRowsTests.swift — 追記
/// 測れたレグの根拠行は「Apple Maps の経路」、推定のままのレグは「所要時間は目安です」。
@Test @MainActor func measuredLegsNameAppleMapsAndEstimatedLegsSayEstimated() async {
  let store = await enrichedSample(FakeRouteProvider(), taxiOnFirstLeg: true)
  var measured = 0, estimated = 0
  for day in 0..<4 {
    for case .movement(let m) in store.timelineRows(day) {
      if m.evidenceLine == AppCopy.for(store.request.locale).appleRouteEvidence { measured += 1 }
      else if m.evidenceLine == Copy.for(store.request.locale).estimated { estimated += 1 }
      else { Issue.record("unexpected evidence line \(String(describing: m.evidenceLine))") }
    }
  }
  #expect(measured > 0 && estimated > 0)   // 山のレグは推定のまま
  #expect(store.routeProgressLine == nil)
}
```

`AppCopyTests.swift`: 配列に `c.routesUpdatedToast, c.appleRouteEvidence` と `c.routesFetching(settled: 3, total: 12), c.routesEstimatedRemaining(count: 1), c.routesEstimatedRemaining(count: 2), c.mapMeasuredRoutesValue(count: 1), c.mapMeasuredRoutesValue(count: 2)` を足し、`#expect(checked == 460)`(+7 × 2)。内訳コメントに「+ Routes spec の 2 と引数つき 5」を足す。

- [ ] **Step 2: 赤を確認** — Run: `cd apple && tools/verify-kit.sh --filter "MapModelTests|TimelineRowsTests|AppCopyTests"` → Expected: `has no member 'measuredCount'`、`has no member 'appleRouteEvidence'`。

- [ ] **Step 3: 実装**

```swift
// Store/PlannerStore+Map.swift:48-61 を置き換え
      for (index, leg) in day.legs.enumerated() {
        let id = "leg:\(dayIndex):\(index)"
        let from = GeoPoint(latitude: leg.from.latitude, longitude: leg.from.longitude)
        let to = GeoPoint(latitude: leg.to.latitude, longitude: leg.to.longitude)
        if let geometry = measuredGeometry(for: leg), let head = geometry.first, let tail = geometry.last, geometry.count >= 2 {
          // 実測経路の端が地点から遠ければ、その区間は「知らない」ので破線で橋渡し(Web と同じ)。
          if straightLineDistanceKm(from, head) * 1000 >= Self.bridgeThresholdMeters {
            routes.append(MapRoute(id: id + ":bridge-start", dayIndex: dayIndex, points: [from, head], measured: false, selected: selected))
          }
          routes.append(MapRoute(id: id, dayIndex: dayIndex, points: geometry, measured: true, selected: selected))
          if straightLineDistanceKm(tail, to) * 1000 >= Self.bridgeThresholdMeters {
            routes.append(MapRoute(id: id + ":bridge-end", dayIndex: dayIndex, points: [tail, to], measured: false, selected: selected))
          }
        } else {
          routes.append(MapRoute(id: id, dayIndex: dayIndex, points: [from, to], measured: false, selected: selected))
        }
      }

// 同ファイル末尾に追記
extension PlannerStore {
  static let bridgeThresholdMeters = 300.0

  /// 使用中の手段の回答にジオメトリがあり、**プランがその手段の live 値を既に消費している**レグだけ。
  /// 取得が終わっただけで置換前の地図が実線になることはない。
  func measuredGeometry(for leg: BuiltPlanLeg) -> [GeoPoint]? {
    let key = routeLegKey(leg.from.id, leg.to.id)
    let mode = edit.legModeOverrides[key] ?? leg.comparison.recommended.mode
    guard leg.comparison.options.first(where: { $0.mode == mode })?.source == .live else { return nil }
    for (request, outcome) in liveRoutes where request.legKey == key && request.mode == mode {
      if case .measured(_, _, let geometry?, _) = outcome { return geometry }
    }
    return nil
  }
}
```

`Map/MapModel.swift`: 頭の注記(:4-16)を「実線は `MapRoute.measured` が真の区間だけ。真にできるのは `PlannerStore.measuredGeometry(for:)` —— 使用中の手段が Apple Maps で測れ、プランがその値を消費している区間」に、`measured` の doc(:83-86)の「鍵ゼロでは常に偽」を「提供元が無いビルドでは常に偽」に改め、`MapModel` に `public var measuredCount: Int { routes.filter(\.measured).count }` を足す。

```swift
// Store/PlannerStore+Timeline.swift:219-260 — movementRow(差し替えるのは :227 の `selected` の直後に `shown` を足し、:229-232 の注記と `boarding`、:258-259 の `evidenceLine`)
    let selected = edit.legModeOverrides[legKey] ?? recommended.mode
    let shown = leg.comparison.options.first { $0.mode == selected } ?? recommended
    // 乗車の 1 行は提供元の経路情報からしか作れない。Apple の transit は ETA だけなので常に nil。
    let boarding: TransitLegBoarding? = nil
    …
      evidenceLine: TimelinePresentation.transitBoardingText(boarding, locale: locale)
        ?? (shown.source == .live ? AppCopy.for(locale).appleRouteEvidence : Copy.for(locale).estimated)
```

```swift
// Store/PlannerStore+Routes.swift — 追記
extension PlannerStore {
  /// 統計行の横の 1 行。取得中は「実経路を取得中 12/38」、完了して推定が残れば「N 区間は推定のまま」
  /// (次のビルドまで残る)、全部測れたら nil(行そのものが消える)。
  public var routeProgressLine: String? {
    guard let progress = routeProgress else { return nil }
    let app = AppCopy.for(request.locale)
    if !progress.isComplete { return app.routesFetching(settled: progress.settled, total: progress.requested) }
    return progress.estimatedRemaining > 0 ? app.routesEstimatedRemaining(count: progress.estimatedRemaining) : nil
  }
}
```

```swift
// Presentation/AppCopy.swift — MARK: - 実経路(Routes spec §6)。String 鍵は String 群の末尾、閉包は閉包群の末尾。
  public let appleRouteEvidence: String
  private let routesFetchingText: @Sendable (Int, Int) -> String
  private let routesEstimatedRemainingText: @Sendable (Int) -> String
  private let mapMeasuredRoutesValueText: @Sendable (Int) -> String
  // init の引数(閉包群の末尾): routesFetching: @escaping @Sendable (Int, Int) -> String,
  //   routesEstimatedRemaining: @escaping @Sendable (Int) -> String, mapMeasuredRoutesValue: @escaping @Sendable (Int) -> String
  public func routesFetching(settled: Int, total: Int) -> String { routesFetchingText(settled, total) }
  public func routesEstimatedRemaining(count: Int) -> String { routesEstimatedRemainingText(count) }
  public func mapMeasuredRoutesValue(count: Int) -> String { mapMeasuredRoutesValueText(count) }
  // ja
    appleRouteEvidence: "Apple Maps の経路",
    routesFetching: { "実経路を取得中 \($0)/\($1)" },
    routesEstimatedRemaining: { "\($0)区間は推定のまま" },
    mapMeasuredRoutesValue: { "実経路 \($0)区間" }
  // en
    appleRouteEvidence: "Apple Maps route",
    routesFetching: { "Fetching routes \($0)/\($1)" },
    routesEstimatedRemaining: { "\($0) leg\($0 == 1 ? "" : "s") still estimated" },
    mapMeasuredRoutesValue: { "\($0) measured leg\($0 == 1 ? "" : "s")" }
```

- [ ] **Step 4: 緑を確認** — Run: `cd apple && tools/verify-kit.sh` → Expected: 全件 passed。`TimelineRowsTests.walkOptionOnlyUpToNinetyMinutes` は不変(`walk.minutes == m.walkMinutes` は live 値でも成り立つ)。`AppCopyTests` が `460`。

- [ ] **Step 5: Commit**

```bash
git add apple/Packages/TripCheckKit/Sources/TripCheckAppCore apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests
git commit -m "The map draws a solid line only where the plan already rides a measured route, and the card says whose route it is

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J"
```

---

### Task 8: アプリ — `RouteProgressLine`、注入、配置、地図の区間数、手段ピルの識別子

**Files:**
- Create: `apple/TripCheck/Screens/Plan/RouteProgressLine.swift`
- Modify: `apple/TripCheck/App/TripCheckApp.swift:49-58`、`apple/TripCheck/Screens/Plan/PlanScreen.swift:38-41`、`apple/TripCheck/Screens/Plan/MovementCard.swift:56-62`、`apple/TripCheck/Map/TripMapView.swift:29`(`let app`)/`:64-71`(凡例の inset)
- `MovementCard.swift:63-71` の根拠行は**変更なし**(`model.evidenceLine` を描くだけ。文言は T7 の store 側)。

**Interfaces:**
- Consumes: `PlannerStore.routeProgressLine`、`MapModel.measuredCount`、`AppCopy.mapMeasuredRoutesValue(count:)`、`AppleRouteProvider()`、`CannedRouteProvider()`、`IconView(.signal, size:color:)`、`Tokens.Color.muted/ink2`、`.tcFont(.label)`。
- Produces: 識別子 `plan.routeProgress`、`plan.movement.mode.<walk|transit|taxi>`、`map.measuredCount`(実経路の区間数。0 のときは出ない)。

- [ ] **Step 1: `RouteProgressLine`**

```swift
// Screens/Plan/RouteProgressLine.swift
import SwiftUI

/// 統計行の横の小さな進捗。文言は `PlannerStore.routeProgressLine` が決め、ここは描くだけ(`SpareLine` と同じ作り)。
/// 全部測れたら store が nil を返し、この行そのものが消える。
struct RouteProgressLine: View {
  let text: String

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 4) {
      IconView(.signal, size: 11, color: Tokens.Color.muted)
      Text(text)
        .tcFont(.label)
        .foregroundStyle(Tokens.Color.muted)
        .fixedSize(horizontal: false, vertical: true)
    }
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("plan.routeProgress")
  }
}
```

- [ ] **Step 2: 配置・注入・識別子**

```swift
// Screens/Plan/PlanScreen.swift:38-41 — 統計行(`Text(store.statsLine)` の 4 行)を HStack に。:37 の `SpareLine` はそのまま
              HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(store.statsLine)
                  .tcFont(.stats)
                  .foregroundStyle(Tokens.Color.ink2)
                  .accessibilityIdentifier("plan.stats")
                Spacer(minLength: 0)
                if let progress = store.routeProgressLine { RouteProgressLine(text: progress) }
              }
              .animation(reduceMotion ? nil : .easeInOut(duration: 0.2), value: store.routeProgressLine)

// App/TripCheckApp.swift:49-58 — 最後の引数(:57 の `initialLocale:` の後ろ)。三項の両枝は型が違うので `any RouteProvider` に揃える
      initialLocale: PlannerStore.systemLocale,
      // UI テストは通信しない決定的な提供元で同じ画面遷移を踏む。
      routeProvider: isUITesting ? CannedRouteProvider() as any RouteProvider : AppleRouteProvider()
    ))

// Screens/Plan/MovementCard.swift:56-62 — SegmentedPills に identifier を足す
            disabled: Set(model.options.filter { !$0.enabled }.map(\.mode)),
            identifier: { "plan.movement.mode.\($0.rawValue)" }
          )

// Map/TripMapView.swift — :29 の隣に `let app = AppCopy.for(store.request.locale)`、:64-71 の inset の中身を VStack に
    .safeAreaInset(edge: .bottom, alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 6) {
        if model.measuredCount > 0 {
          Text(app.mapMeasuredRoutesValue(count: model.measuredCount))
            .tcFont(.label)
            .foregroundStyle(Tokens.Color.ink2)
            .accessibilityIdentifier("map.measuredCount")
        }
        MapLegend(days: model.legendDays, scope: $store.view.mapScope)
      }
      // …既存の padding / viewSwitchBarHeight の余白はそのまま…
    }
```

- [ ] **Step 3: ビルドと目視** — Run: `cd apple && tools/verify-app.sh` → Expected: `BUILD SUCCEEDED`、`exit=0`。シミュレータで「見本を見る」→ 統計行の右に「実経路を取得中 n/N」→ 消える → トースト「実経路で更新しました 余裕 ±N分」→ 移動カードで車を選ぶ → 地図タブで実線、左下に「実経路 N区間」。Wi-Fi を切ると「N区間は推定のまま」が残る。

- [ ] **Step 4: アプリ単体テスト** — Run: `cd apple && tools/verify-app.sh test` → Expected: `CopyBoundaryTests` 3 本 passed(新ファイルに日本語リテラルも 12 字以上の `Text("…")` も無い)、`IconCoverageTests` 6 本、UI テスト 4 本 passed。

- [ ] **Step 5: Commit**

```bash
git add apple/TripCheck
git commit -m "The plan screen shows the routes arriving, and the map counts the legs it can vouch for

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J"
```

---

### Task 9: 保存・共有の除外テスト、日付入力後の公共交通、UI テスト、検証値

**Files:**
- Modify: `…/Tests/TripCheckAppCoreTests/PersistenceFlowTests.swift:69-80` の隣、`…/ShareFlowTests.swift` 末尾、`…/RouteEnrichmentTests.swift` 末尾、`apple/TripCheckUITests/PlannerFlowTests.swift:57` の後、`apple/README.md:52-57` と `:70-83`

**Interfaces:**
- Consumes: `store.persistedPayload()`、`UserTripPayload.normalizedKey` / `forbiddenKeys`、`store.shareableInput()`、T6 の `enrichedSample`、T8 の識別子。
- Produces: テストのみ。README の検証値。

- [ ] **Step 1: テストを書く**

```swift
// PersistenceFlowTests.swift — 追記
/// 実測を持つ store でも、保存 payload に live* / ジオメトリ / routes の鍵は出ない。
@Test @MainActor func aStoreWithMeasuredRoutesPersistsNoneOfThem() async throws {
  let store = await enrichedSample(FakeRouteProvider())
  #expect(!store.liveRoutes.isEmpty)
  let payload = try store.persistedPayload()
  func walk(_ v: JSONValue) -> [String] { if case .object(let o) = v { return o.keys.map { UserTripPayload.normalizedKey($0) } + o.values.flatMap(walk) }; if case .array(let a) = v { return a.flatMap(walk) }; return [] }
  let keys = Set(walk(payload.jsonValue))
  #expect(!keys.isEmpty && keys.isDisjoint(with: UserTripPayload.forbiddenKeys))
  #expect(keys.allSatisfy { !$0.hasPrefix("live") && !$0.contains("geometry") && !$0.contains("polyline") && $0 != "routes" })
}

// ShareFlowTests.swift — 追記
/// 共有コードは request と edit だけから作る。実測は 1 バイトも入らない。
@Test @MainActor func theShareCodeIgnoresMeasuredRoutes() async {
  let plain = PlannerStore(resolvers: [CatalogResolver()], store: nil); plain.loadSample(.switzerland); await plain.build()
  let measured = await enrichedSample(FakeRouteProvider())
  #expect(!measured.liveRoutes.isEmpty)
  #expect(plain.shareableInput() == measured.shareableInput())
  let mirror = String(describing: measured.shareableInput()).lowercased()
  #expect(!mirror.contains("live") && !mirror.contains("geometry"))
}

// RouteEnrichmentTests.swift — 追記
/// 日付未定では公共交通を取りに行かず、日付を入れて組み直すと公共交通を 1 回だけ取って 1 回置換。
@Test @MainActor func transitIsFetchedOnceTheDateIsKnown() async {
  let provider = FakeRouteProvider()
  let store = await enrichedSample(provider)
  let undated = await provider.log.requests
  #expect(undated.allSatisfy { $0.mode != .transit } && store.routeReplacements == 1)
  store.request.tripStartDate = Destinations.localDateIn(timeZone: Destinations.byId(.switzerland).timeZone).adding(days: 10).description
  await store.build()
  await store.awaitRouteEnrichment()
  let transit = await provider.log.requests.filter { $0.mode == .transit }
  #expect(!transit.isEmpty && transit.allSatisfy { $0.departure != nil } && Set(transit).count == transit.count)
  #expect(store.routeReplacements == 2)
  #expect(store.bundle!.plan.days.flatMap(\.legs).contains { $0.comparison.options.contains { $0.mode == .transit && $0.source == .live } })
  #expect(store.tripRequest().context.liveTransitAbsentLegs == nil)
}
```

```swift
// TripCheckUITests/PlannerFlowTests.swift — 追記
  /// 見本 → 進捗が消える → 車を選ぶ → 地図に実経路の区間がある(`-uiTesting` は `CannedRouteProvider`)。
  @MainActor
  func testSampleFetchesRoutesAndTheMapShowsAMeasuredLeg() {
    let app = launch()
    app.buttons["start.seeExample"].tap()
    XCTAssertTrue(app.staticTexts["plan.hero"].waitForExistence(timeout: 30))
    // `RouteProgressLine` は `.combine` した 1 要素なので型(staticText / otherElement)を決め打ちしない。
    let progress = app.descendants(matching: .any).matching(identifier: "plan.routeProgress").firstMatch
    XCTAssertTrue(progress.waitForNonExistence(timeout: 30))
    // 見本は日付未定で公共交通が使用中のまま(破線)。車を選ぶと、先に測ってあった車の経路が実線になる。
    // `plan.movement` は `MovementCard` の外側の VStack に付いている(`MovementCard.swift:78`。ボタンではない)。
    let movement = app.descendants(matching: .any).matching(identifier: "plan.movement").firstMatch
    XCTAssertTrue(movement.waitForExistence(timeout: 5))
    movement.tap()
    let taxi = app.buttons["plan.movement.mode.taxi"]
    XCTAssertTrue(taxi.waitForExistence(timeout: 5))
    taxi.tap()
    if app.alerts.firstMatch.waitForExistence(timeout: 2) { app.alerts.buttons.element(boundBy: 1).tap() }
    XCTAssertTrue(app.otherElements["toast"].waitForExistence(timeout: 10))
    app.buttons["plan.view.map"].tap()
    XCTAssertTrue(app.otherElements["map"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["map.measuredCount"].waitForExistence(timeout: 10))
  }
```

1 日目の最初の移動カードのレグが条件付きアクセス(車の経路が無い)なら `element(boundBy: 1)` にする —— `RouteRequestsTests.enumeratesDayAndHotelLegsAndSkipsConditionalAccessLegs` が除外レグの存在を示す。

- [ ] **Step 2: 赤/緑を確認** — Run: `cd apple && tools/verify-kit.sh --filter "PersistenceFlowTests|ShareFlowTests|RouteEnrichmentTests"` → Expected: 3 ファイルの全件(新しい 3 本を含む)passed。`transitIsFetchedOnceTheDateIsKnown` が `routeReplacements == 2` で赤なら、T5 の `build()` 内 `invalidateRoutes(keepCache: true)`(`attemptedRoutes` を空にする)の位置を直す。

- [ ] **Step 3: 全部を回す** — Run: `cd apple && tools/verify-kit.sh && tools/verify-app.sh test` → Expected: Kit `exit=0`(追加本数: T1 3 / T2 2 / T3 4 / T4 4 / T5 4 / T6 6 / T7 3(MapModelTests は 1 本書き換え + 2 本、TimelineRowsTests 1 本。AppCopyTests は本数不変)/ T9 3 = **+29**、795 → 824 = TripCheckKitTests 581 + TripCheckAppCoreTests 243)。アプリ `TEST SUCCEEDED`(UI テスト 5 本 = `PlannerFlowTests` 4 + `LaunchUITests` 1、単体 9 本)。**`git status -- apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures` が空**。

- [ ] **Step 4: README の検証値** — `apple/README.md:52-57` を「**824 本すべて passed / `exit=0`**。内訳は `TripCheckKitTests` 581 と `TripCheckAppCoreTests` 243。前者は Plan 1 の 563 + `PreTripTimelineTests` 13 + Routes spec の `LiveRouteMergeTests` 3 と `EvidenceSourceTests` 2」に、`:57` を「Routes spec は Kit の既存テストに触らず、フィクスチャも不変(G1 500/500、G3 差分ゼロ)」に。`:70-77` を `TripCheckUITests` 5(`PlannerFlowTests` 4 + `LaunchUITests` 1)、日付を実行日に。`:79` の走査ファイル数は `verify-app.sh test` のログから読んで更新(新規 7 ファイルで 74 → 81)。スクリーンショット表に「スイス見本: 実線と置換トースト」「東京 3 日(日付あり): 公共交通の数字が置き換わる」「Wi-Fi なし: N区間は推定のまま」の 3 枚を `tools/screenshot.sh` で足す。

- [ ] **Step 5: Commit**

```bash
git add apple/Packages/TripCheckKit/Tests apple/TripCheckUITests apple/README.md
git commit -m "Nothing measured is saved or shared, transit waits for a date, and the phone proves a solid line on screen

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J"
```

---

## 自己レビュー記録

**Spec 網羅(§ → Task)**

| Spec | Task |
| --- | --- |
| §0 決定(全手段・推定先行・静かな置換・日付未定は徒歩/車のみ・失敗は推定のまま・absent に入れない・Apple は estimated 止まり) | T1(absent/transfer に書かない)、T3(transit 3 条件)、T6(静かな置換)、T2/T5(出典 apple、`routeEvidenceByFactId` nil) |
| §1.2-1 verify 緑・フィクスチャ不変 / -2 実機 / -3 verified にならない / -4 保存・共有 | T2 Step 4・T9 Step 3 / T8 Step 3 / T2 テスト + T5 `BuildRunner` / T9 |
| §2 構成、§3.1 `RouteProvider`/`LiveRouteMerge`、§3.2 型、§3.3 加法的 3 編集 | ファイル構成、T1、T1、T2 |
| §4.1 状態・init 引数・`tripRequest` の不変条件 | T5 |
| §4.2 列挙(日・ホテル・空港・条件付き除外)、候補手段、transit 3 条件 | T3 |
| §4.3 出発日時・30 分バケット・無効化 | T3(`departure`/`bucket`)、T5(`invalidateRoutes`)、T6(`liveRoutes.filter` で鍵が変わった分を自然に再取得) |
| §4.4 同時 4・優先順・タイムアウト 8/12・締切 40・上限 120・スロットル 1/2/4 × 3 | T6 `RouteFetcher`、T3 優先順と `limit`、T4 タイムアウトと再試行 |
| §4.5 置換 1〜6 と `routeGeneration` を進める事象 | T6;T5(`reset`/`cancelBuild`/`build`/`setDestination`、`openTrip`/`importShare` は `reset()` 経由)、T6(`adoptPending`/`adoptHistoryPresent` → `startRouteEnrichment` が進める) |
| §5 `AppleRouteProvider`(Directing / CancelHandle / 手段ごとの呼び分け / MKMapItem 1 か所 / polyline → GeoPoint / Douglas–Peucker / 分類 / 0 分)、`FakeDirecting` | T4 |
| §6.1 進捗行・トースト・根拠行・ピッカー不変 | T8 / T6 / T7 / T7(`walkOptionOnlyUpToNinetyMinutes` 不変) |
| §6.2 地図(使用中手段・300 m 橋渡し・`TripMapView` の実線切替は既存) | T7、T8(区間数の見出しのみ追加) |
| §6.3 印刷・共有・保存 / §6.4 文言規則 | T9 / T6+T7(`AppCopyTests` 460) |
| §6.4 統合仕様 §13.2 の送信先の表 | **対象外**: `docs/tripcheck-specification-2026-08-21.md` は本ブランチ未追跡(`?? docs/…`)。足す行は「Apple Maps 経路: 座標の組・出発日時・手段のみ。場所名・旅程本文は送らない」。望めば T9 のコミットに入れる |
| §7 エラー処理の表 | T4(分類・再試行)、T6(締切・世代・保留・連鎖・provider nil) |
| §8 テスト表 | Kit: T1/T2。AppCore: T3・T4・T6・T7・T9。アプリ: T8(走査)、T9(UI 1 本) |
| §9 差分 21〜28 / §10 リスク | 設計どおり / 優先順と進捗(T3/T8)、二重ガード(T5/T6)、`expectedTravelTime` 採用(T4)、非 Sendable 型の隔離(T4) |

**プレースホルダ走査**: 「TBD」「TODO」「similar to」「同様に」「適宜」「エラー処理を足す」は本文に無い。各 Task にテストコード・RED コマンドと期待する失敗・実装コード・GREEN コマンド・コミットがある。フックの「各 1 行」は挿入位置と行をそのまま書いてある。

**型の一貫性**:
- `RouteRequest(legKey:from:to:mode:departure:)`、`RouteOutcome.measured(minutes:distanceMeters:geometry:expectedDeparture:)` は T1 で定義し T3〜T9 で同じラベル順。
- `PlannerStore.init` の新引数名は `routeProvider`(T5)。T6〜T9 のテストと `TripCheckApp` が同じラベルで渡す。
- `RouteRequests.requests(plan:context:overrides:selectedDay:now:limit:)` / `legs(plan:overrides:)` / `contenders(for:plan:context:)` は T3 で定義し T6/T7/T9 で同じ。
- `RouteProgress(requested:settled:estimatedRemaining:)` + `isComplete` は T5 で定義、T6/T7/T8 が読む。
- `startRouteEnrichment(chainDepth:)` / `replaceWithLiveRoutes(chainDepth:)` / `resumeDeferredRouteReplacement()` / `awaitRouteEnrichment()` / `liveRoutesAreAdopted` / `invalidateRoutes(keepCache:)` / `measuredGeometry(for:)` の名前は T5/T6/T7/T9 で一致。`enrichedSample(_:taxiOnFirstLeg:)` は T6 で定義(ファイル内 `@MainActor func`、private ではない)し T7/T9 が使う。
- `AppCopy` の 5 鍵(`routesUpdatedToast`, `appleRouteEvidence`, `routesFetching(settled:total:)`, `routesEstimatedRemaining(count:)`, `mapMeasuredRoutesValue(count:)`)は T6/T7/T8/T9 で同じ。
- `DirectionsFailure.{throttled, notFound, other}` は T4 の Fake と provider で一致。再試行は `AppleRouteProvider` の中 —— spec §4.4 は「コーディネータが再試行」と書くが `RouteOutcome`(§3.1 で固定)に throttle の印が無いので、`MKError` を見られる提供元側で 1/2/4 秒 × 3 回を行う。回数・間隔・テスト(§8)は同じ。
- `EvidenceSnapshotOptions.init` の新ラベル `liveRouteSource` は T2 で最後尾、T5 の `BuildRunner` が同じラベルで渡す。
- 空港の出発レグの出発時刻は spec が定義していないので最終日の `finishTime`(T3 のコード中に明記)。
- 置換前に地図が実線にならないよう、`measuredGeometry(for:)` は「同じ手段の option が `.live`」を条件にする(T7)。spec §6.2 の「回答にジオメトリがあれば」に「プランが消費済み」を足した形。
- 見本(スイス)は日付未定で長距離レグが多く、使用中の手段は公共交通に留まる(`pickRecommended` の非対称規則)。実線・根拠行のテストと UI テストは、最初の直行レグに車の上書き(`legModeOverrides`)を置いてから確かめる(T6 `taxiOnFirstLeg`、T9 UI)。
