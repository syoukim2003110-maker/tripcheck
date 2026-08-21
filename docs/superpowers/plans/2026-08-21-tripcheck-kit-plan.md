# TripCheckKit(決定論エンジンの Swift 移植)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `lib/` の決定論エンジン(パーサ・目的地・日割り・順序・時計・移動手段・食事枠・成立判定・最短日数・反実仮想・編集ガード・共有・保存)を Swift Package **TripCheckKit** に移植し、golden 500 / パーサ 500 / 不変条件テストで TS 実装と同じ答えを出すことを証明する。

**Architecture:** `apple/Packages/TripCheckKit` は Foundation のみに依存する純粋な Swift Package。アルゴリズム・定数・タイブレークは TS に忠実に、型は Swift の値型 + `enum: String`(raw value は TS の文字列と同一)。全関数は同期・決定論・I/O なし。`swift test` が Mac 上で Xcode なしに回る。

**Tech Stack:** Swift 6.3(language mode 6、strict concurrency)、SwiftPM(tools 6.0)、Swift Testing(`import Testing`)、`NSRegularExpression`(ICU。JS 正規表現の lookbehind/`u` フラグ相当)。

**Spec:** `docs/superpowers/specs/2026-08-21-tripcheck-swift-v1-design.md`(以下「spec」)。統合仕様は `docs/tripcheck-specification-2026-08-21.md`(以下「統合仕様」)。**移植元の TS ファイルそのものが最も詳細な仕様**であり、各タスクに行範囲を記す。

## Global Constraints

- Kit のソースは `import Foundation` 以外を import しない(UIKit / SwiftUI / MapKit / CoreLocation 禁止。Task 25 のテストが走査する)
- `Package.swift`: `swift-tools-version: 6.0`、`platforms: [.iOS(.v17), .macOS(.v14)]`、`swiftLanguageModes: [.v6]`
- `enum` の raw value は TS のユニオン文字列と**完全一致**(例 `"INFEASIBLE_HARD_CONFLICT"`, `"user_provided"`, `"transit_first"`)
- 時刻は `"HH:MM"`、日付は `"YYYY-MM-DD"` の文字列表現を `Codable` で保ち、算術は自前(TS と同じ)。`Date`/`Calendar` は `TimeZone` のオフセット計算にだけ使う
- 丸めは TS と同じ関数(`Math.ceil` → `.rounded(.up)`、`Math.round` → `.rounded(.toNearestOrAwayFromZero)` ※ JS の `Math.round(-0.5) === -0` だが本エンジンでは負数を丸めない)。`%` は `((x % n) + n) % n`
- 並び替えは全て明示的な比較関数 + 最後のタイブレークに `id` の辞書順(`<` は UTF-16 コード単位比較 = JS と同じにするため `String.utf16` の `lexicographicallyPrecedes` を使う)
- 定数は `EngineConstants.swift` に集約(統合仕様 §7.2 の表)。別ファイルに数値リテラルで再定義しない
- 既存テストの削除・緩和はゼロ。golden フィクスチャ JSON は**バイト変更禁止**(コピーのみ)
- コミットは 1 タスク 1 コミット以上。メッセージは本リポジトリの散文体(例 `The parser reads a pasted wishlist the way the web one does`)+ 末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 検証コマンド: `cd apple/Packages/TripCheckKit && swift test 2>&1 | tail -30`(全タスク共通)

---

## 型リファレンス(全タスク共通の名前)

後続タスクはこの名前を使う。定義するタスクを括弧で示す。

```swift
// Core (Task 2)
public enum PlannerLocale: String, Codable, Sendable { case ja, en }
public struct ClockTime: Hashable, Codable, Sendable, Comparable { public var minutes: Int }   // "HH:MM"
public struct CalendarDate: Hashable, Codable, Sendable, Comparable { public var year, month, day: Int } // "YYYY-MM-DD"
public struct GeoPoint: Hashable, Codable, Sendable { public var latitude, longitude: Double }
public func straightLineDistanceKm(_ a: GeoPoint, _ b: GeoPoint) -> Double

// Parser (Task 3–5)
public enum WishlistPriority: String, Codable, Sendable { case must, optional, normal }
public enum WishlistTimeOfDay: String, Codable, Sendable { case morning, evening, night }
public struct ParsedWishlistPlace: Equatable, Codable, Sendable { name, day: Int?, time: String?, timeOfDay, isReservation: Bool, priority, stayMinutes: Int? }
public enum ParsedWishlistLine: Equatable, Sendable { case empty(raw:), heading(raw:, day: Int), unparsed(raw:), place(raw:, places: [ParsedWishlistPlace]) }
public enum WishlistParser { static func parse(_ raw: String) -> [ParsedWishlistLine]; static func places(_ raw: String) -> [ParsedWishlistPlace] }
public enum WishlistSerializer { static func formatPlaces(_:[ParsedWishlistPlace], languageCode:) -> String; static func formatLines(_ raw:, languageCode:) -> String;
  static func removePlace(raw:, occurrenceIndex:) -> String; static func setPriority(raw:, occurrenceIndex:, priority:) -> String; static func updateConstraints(raw:, occurrenceIndex:, patch:) -> String }

// Destinations (Task 6)
public enum DestinationId: String, Codable, CaseIterable, Sendable { case worldwide, japan, switzerland, korea, taiwan, hongkong, singapore, thailand, vietnam, indonesia, uae, france, italy, spain, portugal, uk, germany, austria, netherlands, iceland, norway, usa, canada, australia, newzealand }
public enum DestinationChoice: Codable, Hashable, Sendable { case auto, destination(DestinationId) }  // Codable は "auto" / id 文字列
public enum MobilityProfile: String, Codable, Sendable { case transit_first, balanced, car_first }
public struct Destination: Sendable { id, names: [PlannerLocale: String], countryCodes: [String], regionCode: String?, querySuffix: String?, timeZone: String, currency: (code, bandGlyph), center: GeoPoint, overviewZoom: Int, bounds: GeoBounds?, mobility, meals: (lunch: MealWindow, dinner: MealWindow), hotelFacts: String?, sundayClosing: Bool, airports: [DestinationAirport], cuisine, notes, sample, sampleStops }
public enum Destinations { static let all: [Destination]; static func byId(_:) -> Destination; static func forCountryCode(_:) -> Destination?; static func forCoordinate(_:_:) -> Destination?; static func placeQuery(_ input:, destination:, languageCode:) -> String; static func utcOffsetMinutes(at: Date, timeZone: String) -> Int; static func localDateIn(timeZone:, at:) -> CalendarDate }

// Geo / Catalog (Task 7)
public struct RouteStop: Hashable, Codable, Sendable { id, providerRef: String?, name, area, latitude, longitude, sourceUrl, verifiedAt, confidence: Confidence, planningDurationMinutes: Int, isAnchor: Bool, placeTypes: [String]?, openingHoursApplicable: Bool?, isUserEntered: Bool?, userProvidedCoordinates: Bool? }
public struct ResolvedStop: Hashable, Codable, Sendable { ...RouteStop のフィールド全部..., input: String, inputIndex: Int?, address: String, countryCode: String?, provider: ResolvedStopProvider? }
public enum ResolvedStopProvider: String, Codable, Sendable { case catalog, user, apple, google }
public enum Catalog { static func resolveKnownStops(_ line: String, locale:) -> [RouteStop]; static func optimizeKnownStopOrder(_ stops: [RouteStop], preserveFirst: Bool) -> (stops: [RouteStop], exact: Bool); static func googleMapsUrl(_ stops: [RouteStop], travelMode:) -> String }

// Travel (Task 8)
public enum TransportMode: String, Codable, Sendable { case walk, transit, taxi }
public enum TravelPreference: String, Codable, Sendable { case auto, car }
public struct ModeEstimate: Codable, Sendable, Equatable { mode, minutes: Int, source: ModeSource /* estimate|live */, transferCount: Int?, unroutable: Bool? }
public struct ModeComparison: Codable, Sendable, Equatable { options: [ModeEstimate], fastest: TransportMode, recommended: TransportMode, distanceKm: Double }
public enum TravelEstimates { static func estimate(distanceKm:, preference:, mobility:, live: LiveLegEvidence, allowedModes: [TransportMode]?, override: TransportMode?) -> ModeComparison }
public enum StayEstimates { static func estimateStayMinutes(name:, placeTypes: [String]?) -> Int; static func isDayAnchorStay(_ minutes: Int) -> Bool; static func isFoodPlaceTypes(_:) -> Bool }

// Builder (Task 9–15)
public enum Pace: String, Codable, Sendable { case relaxed, balanced, fast }
public enum StopPriority: String, Codable, Sendable { case must, normal, optional }
public enum MealPlan: String, Codable, Sendable { case all, dinner, none }
public enum MealKind: String, Codable, Sendable { case lunch, dinner }
public struct VisitWindow: Codable, Hashable, Sendable { openMinutes, closeMinutes: Int, lastEntryMinutes: Int? }
public struct PlannerContext: Codable, Sendable, Equatable { TS の TripPlannerContext と同じフィールド名(全て Optional) }
public struct BuiltPlanStop, BuiltPlanLeg, BuiltPlanDay, BuiltTripPlan, TripBase, BaseRecommendation, AirportConstraint, FoodRecommendationSlot, MobilityPolicy: Codable, Sendable, Equatable  // フィールド名は TS と同一
public struct TripRequest: Codable, Sendable { raw, days, pace, locale, context }
public enum TripBuilder { static func build(_ request: TripRequest) -> BuiltTripPlan }
public enum EngineConstants { static let defaultDayEnd = ClockTime(22*60); static let maxDayAssignmentStops = 12; static let maxDayAssignmentEvaluations = 600; static let exactOrderingLimit = 7; static let heldKarpLimit = 10; static let trimLegMinutes = 35; static let maxScenarioDays = 14; static let tripFitTimeout: Duration = .seconds(1); static let tightBufferMinutes = 60; static let cutCandidateLimit = 6; static let counterfactualLimit = 3 }

// Feasibility (Task 16)
public enum EvidenceStatus: String, Codable { case user_provided, verified, estimated, unknown, failed }
public enum EvidenceSource: String, Codable { case user, google, tripcheck_catalog, derived, other }
public struct Evidence<Value: Codable & Sendable & Equatable>: Codable, Sendable, Equatable { value: Value?, status, source, fetchedAt: String?, expiresAt: String?, providerRef: String?, explanation: String? }
public enum FeasibilityState: String, Codable { case VERIFIED_FEASIBLE, PROVISIONAL_FEASIBLE, FEASIBLE_IF_ASSUMPTIONS, INFEASIBLE_HARD_CONFLICT, UNKNOWN }
public enum ConflictCode: String, Codable { case AIRPORT_CUTOFF, FIXED_BOOKING_LATE, CLOSED_ON_FIXED_DAY, LAST_ENTRY_CONFLICT, OPENING_HOURS_CONFLICT, PLACE_UNAVAILABLE, DAY_END_OVERRUN, DAY_CAPACITY }
public enum CriticalFactKind: String, Codable { case place_identity, stay_duration, opening_hours, last_entry, route_leg, mobility_policy, day_window, base, airport_boundary }
public struct EvidenceSnapshotOptions: Codable, Sendable  // TS の EvidenceSnapshotOptions と同じ(golden の "evidence" をデコード)
public enum Feasibility { static func snapshot(plan:, options:) -> PlannerEvidenceSnapshot; static func derive(plan:, fit:, evidence:) -> FeasibilityResult }

// Scenarios (Task 17)
public struct TripFitAssessment: Codable, Sendable, Equatable { status: TripFitStatus, minimumDays: Int?, partialMinimumDays: Int?, spareDays: Int?, additionalDaysNeeded: Int, days: [TripFitDay], cutCandidates: [TripCutCandidate], suggestedCutCount, solverTimedOut: Bool, assumptions: MinimumDaysAssumptions ... }
public enum TripScenarios { static func assessTripFit(_ request:, plan:, options:) -> TripFitAssessment; static func counterfactuals(_ request:, plan:, fit:) -> [TripCounterfactual]; static func totalPlanBufferMinutes(plan:, context:) -> Int }

// Edits (Task 20)
public struct PlannerEditState: Codable, Equatable, Sendable  // TS と同じ 16 フィールド
public struct PlannerHistory<State: Equatable & Sendable>: Sendable { past: [State], present: State, future: [State], limit: Int }
public enum HardEditConflictKind: String, Codable { case booking_late, must_drop, airport_cutoff, day_end_missed, opening_closed, last_entry_missed }
public enum HardEditDecision: Equatable { case apply(bufferDeltaMinutes: Int), confirm([PlannerHardEditConflict]) }
public enum PlannerEdits { static func hardEditConflicts(before: BuiltTripPlan, after: BuiltTripPlan) -> [PlannerHardEditConflict]; static func evaluate(before:, after:, context:) -> HardEditDecision }

// Share (Task 22)
public struct ShareableTripInput: Codable, Equatable, Sendable   // TS と同じ
public enum ShareCodec { static func encode(_ input: ShareableTripInput) -> String; static func decode(_ code: String) -> ShareableTripInput? }
public enum ShareScope { static func scoped(_ input:, scope: ShareScopeOptions) -> ScopedShareResult }

// Persistence (Task 24)
public actor TripStore { init(directory: URL); func list() async -> [StoredTripRecord]; func save(_:) async throws; func delete(id:) async throws }
```

---

## ファイル構成(作成するもの)

```
apple/
├ .gitignore                       (.build/, *.xcodeproj, DerivedData/, xcuserdata/)
├ tools/verify-kit.sh              swift test をログ付きで回す
└ Packages/TripCheckKit/
   ├ Package.swift
   ├ Sources/TripCheckKit/
   │  ├ Core/ClockTime.swift, CalendarDate.swift, GeoPoint.swift, PlannerLocale.swift, Regex.swift(NSRegularExpression の薄いラッパ), Sorting.swift(utf16 比較), EngineConstants.swift
   │  ├ Parser/WishlistParser.swift, WishlistPatterns.swift, WishlistSerializer.swift
   │  ├ Destinations/Destination.swift, DestinationData.swift(25 件), DestinationEssentials.swift, DestinationTime.swift
   │  ├ Geo/RouteStop.swift, Catalog.swift(東京 18), SwissSample.swift, RouteOrdering.swift(Held-Karp/2-opt), GoogleMapsUrl.swift
   │  ├ Builder/BuilderTypes.swift, PlannerContext.swift, StayEstimates.swift, TravelEstimates.swift, PoiAccess.swift, VisitWindows.swift, DayOrdering.swift, DayClock.swift, Clustering.swift, DayAssignment.swift, Bases.swift, Airports.swift, AirportComparison.swift, MealSlots.swift, CrowdOutlook.swift, DestinationVote.swift, TripBuilder.swift
   │  ├ Feasibility/Evidence.swift, FeasibilityTypes.swift, EvidenceSnapshot.swift, FeasibilityResult.swift, FNV1a.swift, CoverageProfile.swift, PlanningEvidence.swift, TripScope.swift
   │  ├ Scenarios/TripFit.swift, Counterfactuals.swift, ProvisionalTripLength.swift
   │  ├ Gaps/GapDetection.swift
   │  ├ Edits/PlannerEditState.swift, PlannerHistory.swift, HardEdits.swift
   │  ├ Resolution/PlaceResolver.swift, CatalogResolver.swift, ResolutionPipeline.swift
   │  ├ Share/ShareCodec.swift, ShareScope.swift
   │  ├ Presentation/Copy.swift, CopyJa.swift, CopyEn.swift, TimelinePresentation.swift, TripPresentation.swift, DayPalette.swift, BannedTerms.swift
   │  └ Persistence/TripStore.swift, UserTripPayload.swift
   └ Tests/TripCheckKitTests/
      ├ Fixtures/golden-feasibility.v1.json, share-vectors.json, ts-snapshots.v1.json(G3 のみ)
      ├ Support/GoldenCorpus.swift(デコード), ParserCorpusGenerator.swift, TestStops.swift(共通フィクスチャ)
      ├ Golden/GoldenParityTests.swift, ParserCorpusTests.swift, SnapshotParityTests.swift
      ├ Invariants/*.swift(タスクごと)
      └ Units/*.swift(タスクごと)
```

---

### Task 1: パッケージの骨組みと検証スクリプト

**Files:**
- Create: `apple/.gitignore`, `apple/Packages/TripCheckKit/Package.swift`, `apple/Packages/TripCheckKit/Sources/TripCheckKit/TripCheckKit.swift`, `apple/Packages/TripCheckKit/Tests/TripCheckKitTests/SmokeTests.swift`, `apple/tools/verify-kit.sh`

**Interfaces:**
- Produces: `TripCheckKit.version == "0.1.0"`(スモーク用)

- [ ] **Step 1: Package.swift を書く**

```swift
// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "TripCheckKit",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [.library(name: "TripCheckKit", targets: ["TripCheckKit"])],
  targets: [
    .target(name: "TripCheckKit", swiftSettings: [.swiftLanguageMode(.v6)]),
    .testTarget(
      name: "TripCheckKitTests",
      dependencies: ["TripCheckKit"],
      resources: [.copy("Fixtures")],
      swiftSettings: [.swiftLanguageMode(.v6)]
    ),
  ]
)
```

- [ ] **Step 2: ソースとスモークテストを書く**

```swift
// Sources/TripCheckKit/TripCheckKit.swift
public enum TripCheckKit { public static let version = "0.1.0" }
```

```swift
// Tests/TripCheckKitTests/SmokeTests.swift
import Testing
@testable import TripCheckKit

@Test func packageLoads() { #expect(TripCheckKit.version == "0.1.0") }
```

`Tests/TripCheckKitTests/Fixtures/.gitkeep` を置く(resources ディレクトリが空だとビルドが落ちるため)。

- [ ] **Step 3: .gitignore と verify スクリプト**

```
# apple/.gitignore
.build/
*.xcodeproj
DerivedData/
xcuserdata/
.swiftpm/
```

```bash
#!/bin/zsh
# apple/tools/verify-kit.sh — swift test をログに落として exit code を素通しする
set -u
cd "$(dirname "$0")/../Packages/TripCheckKit"
LOG=${TMPDIR:-/tmp}/tripcheck-kit-test.log
swift test "$@" > "$LOG" 2>&1; CODE=$?
tail -40 "$LOG"; echo "exit=$CODE log=$LOG"; exit $CODE
```

- [ ] **Step 4: 実行して緑を確認**

Run: `chmod +x apple/tools/verify-kit.sh && apple/tools/verify-kit.sh`
Expected: `Test run with 1 test passed`、`exit=0`

- [ ] **Step 5: Commit**

```bash
git add apple/
git commit -m "The Swift port gets a package to live in"
```

---

### Task 2: Core 型(ClockTime / CalendarDate / GeoPoint / 正規表現ラッパ / ソート規約 / 定数)

**Files:**
- Create: `Sources/TripCheckKit/Core/{PlannerLocale,ClockTime,CalendarDate,GeoPoint,Regex,Sorting,EngineConstants}.swift`
- Test: `Tests/TripCheckKitTests/Units/CoreTests.swift`
- 参照: `lib/trip-builder.ts:349-374`(`clock`, `clockMinutes`, `addDaysToIsoDate`)、`lib/planner-app-state.ts:190-200`(`addCalendarDays`, `clampTripDays`)、`lib/route-optimizer.ts:318-333`(`straightLineDistanceKm`)、`lib/destinations.ts:1591-1640`(TZ 関数は Task 6)

**Interfaces:**
- Produces: 型リファレンスの Core 節 + `enum JSRegex { init(_ pattern:, options:) ; func matches(in:) -> [Match]; func replacingAll(in:, with:) }`、`func jsStringLess(_ a: String, _ b: String) -> Bool`、`EngineConstants`

- [ ] **Step 1: 失敗するテストを書く**

```swift
import Testing
@testable import TripCheckKit

@Test func clockTimeRoundTrips() throws {
  let t = try #require(ClockTime("09:05"))
  #expect(t.minutes == 545)
  #expect(t.description == "09:05")
  #expect(ClockTime("24:00") == nil)
  #expect(ClockTime("9:05")?.minutes == 545)          // TS の clockMinutes は 1 桁時を受ける
  #expect(ClockTime(minutes: 1445).description == "00:05") // 翌日跨ぎは 1440 で畳む(TS clock())
}

@Test func calendarDateArithmetic() throws {
  let d = try #require(CalendarDate("2026-10-13"))
  #expect(d.adding(days: 19).description == "2026-11-01")
  #expect(d.weekday == 2)                               // 火曜 = JS の getUTCDay() と同じ 0=日
  #expect(CalendarDate("2026-02-30") == nil)
  #expect(CalendarDate("2026-03-08").map { $0.epochDay - CalendarDate("2026-03-07")!.epochDay } == 1)
}

@Test func haversineMatchesTypeScriptConstant() {
  let a = GeoPoint(latitude: 35.6655, longitude: 139.7708)   // 築地
  let b = GeoPoint(latitude: 35.7148, longitude: 139.7967)   // 浅草寺
  #expect(abs(straightLineDistanceKm(a, b) - 5.95) < 0.05)   // 半径 6371km
}

@Test func jsStringOrderUsesUTF16() {
  #expect(jsStringLess("a", "b"))
  #expect(jsStringLess("Z", "a"))          // 大文字が先
  #expect(jsStringLess("日", "𠮷") == true) // サロゲートペアは UTF-16 単位で比較
}

@Test func regexSupportsLookbehindAndGlobal() throws {
  let re = try JSRegex("(?:(?<=^)|(?<=[\\s、]))must(?=$|[\\s、])", options: [.caseInsensitive])
  #expect(re.matches(in: "Tokyo must、must").count == 2)
  #expect(re.replacingAll(in: "a must b", with: "") == "a  b")
}

@Test func engineConstantsMatchSpec() {
  #expect(EngineConstants.defaultDayEnd.description == "22:00")
  #expect(EngineConstants.maxDayAssignmentEvaluations == 600)
  #expect(EngineConstants.maxDayAssignmentStops == 12)
}
```

- [ ] **Step 2: 失敗を確認**

Run: `apple/tools/verify-kit.sh --filter CoreTests`
Expected: コンパイルエラー(`ClockTime` 未定義)

- [ ] **Step 3: 実装**

```swift
// ClockTime.swift
public struct ClockTime: Hashable, Sendable, Comparable, CustomStringConvertible, Codable {
  public var minutes: Int
  public init(minutes: Int) { self.minutes = ((minutes % 1440) + 1440) % 1440 }
  /// TS clockMinutes(): /^(\d{1,2}):(\d{2})$/、時 0–23・分 0–59 以外は nil
  public init?(_ text: String) {
    let parts = text.split(separator: ":", omittingEmptySubsequences: false)
    guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]),
          parts[0].count <= 2, parts[1].count == 2, (0...23).contains(h), (0...59).contains(m) else { return nil }
    minutes = h * 60 + m
  }
  public var description: String { String(format: "%02d:%02d", minutes / 60, minutes % 60) }
  public static func < (l: Self, r: Self) -> Bool { l.minutes < r.minutes }
  public init(from decoder: Decoder) throws {
    let s = try decoder.singleValueContainer().decode(String.self)
    guard let v = ClockTime(s) else { throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "bad clock \(s)")) }
    self = v
  }
  public func encode(to encoder: Encoder) throws { var c = encoder.singleValueContainer(); try c.encode(description) }
}
```

```swift
// CalendarDate.swift — 1970-01-01 からの日数(epochDay)を基準に、JS の Date.UTC と同じ算術
public struct CalendarDate: Hashable, Sendable, Comparable, CustomStringConvertible, Codable {
  public var year: Int, month: Int, day: Int
  public init?(year: Int, month: Int, day: Int) {
    guard (1...12).contains(month), day >= 1, day <= CalendarDate.daysIn(month: month, year: year) else { return nil }
    self.year = year; self.month = month; self.day = day
  }
  public init?(_ text: String) {  // "YYYY-MM-DD" のみ
    let p = text.split(separator: "-")
    guard p.count == 3, p[0].count == 4, p[1].count == 2, p[2].count == 2,
          let y = Int(p[0]), let m = Int(p[1]), let d = Int(p[2]) else { return nil }
    self.init(year: y, month: m, day: d)
  }
  static func isLeap(_ y: Int) -> Bool { (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 }
  static func daysIn(month: Int, year: Int) -> Int { [31, isLeap(year) ? 29 : 28, 31,30,31,30,31,31,30,31,30,31][month - 1] }
  /// 1970-01-01 = 0(Howard Hinnant の days_from_civil)
  public var epochDay: Int {
    let y = month <= 2 ? year - 1 : year
    let era = (y >= 0 ? y : y - 399) / 400
    let yoe = y - era * 400
    let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146097 + doe - 719468
  }
  public init(epochDay z0: Int) {  // civil_from_days
    let z = z0 + 719468
    let era = (z >= 0 ? z : z - 146096) / 146097
    let doe = z - era * 146097
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
    let y = yoe + era * 400
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    let mp = (5 * doy + 2) / 153
    day = doy - (153 * mp + 2) / 5 + 1
    month = mp + (mp < 10 ? 3 : -9)
    year = y + (month <= 2 ? 1 : 0)
  }
  public func adding(days: Int) -> CalendarDate { CalendarDate(epochDay: epochDay + days) }
  /// 0 = 日曜(JS getUTCDay)
  public var weekday: Int { ((epochDay % 7 + 4) % 7 + 7) % 7 }
  public var description: String { String(format: "%04d-%02d-%02d", year, month, day) }
  public static func < (l: Self, r: Self) -> Bool { l.epochDay < r.epochDay }
  // Codable: 文字列(ClockTime と同じ形)
}
```

```swift
// GeoPoint.swift
public struct GeoPoint: Hashable, Codable, Sendable { public var latitude: Double; public var longitude: Double }
/// lib/route-optimizer.ts:318 と同じ式(半径 6371)
public func straightLineDistanceKm(_ a: GeoPoint, _ b: GeoPoint) -> Double {
  let toRad = Double.pi / 180
  let dLat = (b.latitude - a.latitude) * toRad, dLng = (b.longitude - a.longitude) * toRad
  let h = sin(dLat/2)*sin(dLat/2) + cos(a.latitude*toRad)*cos(b.latitude*toRad)*sin(dLng/2)*sin(dLng/2)
  return 2 * 6371 * atan2(sqrt(h), sqrt(1 - h))
}
```

```swift
// Regex.swift — JS の new RegExp(source, "giu") に対応する最小ラッパ
public struct JSRegex: Sendable {
  let re: NSRegularExpression
  public init(_ pattern: String, options: NSRegularExpression.Options = []) throws { re = try NSRegularExpression(pattern: pattern, options: options) }
  public struct Match { public let range: Range<String.Index>; public let groups: [String?] }
  public func matches(in s: String) -> [Match] {
    re.matches(in: s, range: NSRange(s.startIndex..., in: s)).map { m in
      Match(range: Range(m.range, in: s)!, groups: (1..<max(1, m.numberOfRanges)).map { i in
        let r = m.range(at: i); return r.location == NSNotFound ? nil : String(s[Range(r, in: s)!]) })
    }
  }
  public func firstMatch(in s: String) -> Match? { matches(in: s).first }
  public func test(_ s: String) -> Bool { re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil }
  public func replacingAll(in s: String, with template: String) -> String {
    re.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: template)
  }
}
```

```swift
// Sorting.swift
/// JS の `<` / localeCompare なし比較 = UTF-16 コード単位の辞書順
public func jsStringLess(_ a: String, _ b: String) -> Bool { a.utf16.lexicographicallyPrecedes(b.utf16) }
public func jsStringCompare(_ a: String, _ b: String) -> Int { a == b ? 0 : (jsStringLess(a, b) ? -1 : 1) }
```

```swift
// EngineConstants.swift — 統合仕様 §7.2
public enum EngineConstants {
  public static let defaultDayStart = ClockTime(minutes: 9 * 60)
  public static let defaultDayEnd = ClockTime(minutes: 22 * 60)
  public static let paceStopsPerDay: [Pace: Int] = [.relaxed: 3, .balanced: 4, .fast: 5]
  public static let paceDayBudgetMinutes: [Pace: Int] = [.relaxed: 480, .balanced: 570, .fast: 660]
  public static let maxDayAssignmentStops = 12
  public static let maxDayAssignmentEvaluations = 600
  public static let exactOrderingLimit = 7
  public static let heldKarpLimit = 10
  public static let trimLegMinutes = 35
  public static let transferBufferChoices: Set<Int> = [0, 10, 20, 30]
  public static let defaultTransferBuffer = 10
  public static let defaultMaxWalkingMinutesPerLeg = 30   // [5, 180]
  public static let defaultMaxTransfersPerLeg = 2         // [0, 8]
  public static let stayMinutesRange = 15...480
  public static let dayAnchorStayMinutes = 300
  public static let tripDaysRange = 1...14
  public static let maxScenarioDays = 14
  public static let tripFitTimeout: Duration = .seconds(1)
  public static let tightBufferMinutes = 60
  public static let cutCandidateLimit = 6
  public static let counterfactualLimit = 3
  public static let googleMapsWaypointLimit = 10
}
```

`Pace` は Task 9 で定義されるので、このタスクでは `Pace` を `Builder/BuilderTypes.swift` の先取りとして `public enum Pace: String, Codable, Sendable, CaseIterable { case relaxed, balanced, fast }` だけ作ってよい。

- [ ] **Step 4: 緑を確認**

Run: `apple/tools/verify-kit.sh --filter CoreTests`
Expected: 6 tests passed

- [ ] **Step 5: Commit**

```bash
git add apple/Packages/TripCheckKit
git commit -m "Clocks, dates and distances compute the way the web engine does"
```

---

### Task 3: WishlistParser — 行の分割・箇条書き・日見出し

**Files:**
- Create: `Sources/TripCheckKit/Parser/WishlistPatterns.swift`, `Sources/TripCheckKit/Parser/WishlistParser.swift`
- Test: `Tests/TripCheckKitTests/Units/WishlistParserTests.swift`
- 移植元: `lib/wishlist-parser.ts:35-238`(定数・`toClock`・`stripBullet`・`tidyName`・`hasCjk`・`topLevelMiddleDotCount`・`splitTopLevel`・`expandParentheticalPlace`・`splitPlaces`・見出し)、`:239-400`(`parseWishlist`)。対応する TS テスト: `tests/wishlist-parser.test.ts`

**Interfaces:**
- Produces: `WishlistParser.parse(_:) -> [ParsedWishlistLine]`, `WishlistParser.places(_:) -> [ParsedWishlistPlace]`, `ParsedWishlistPlace`, `ParsedWishlistLine`, `WishlistPriority`, `WishlistTimeOfDay`

- [ ] **Step 1: 失敗するテストを書く**(`tests/wishlist-parser.test.ts` の先頭 12 ケースを逐語で移す。以下は代表 6 件。残りは TS テストを開いて同じ入力・期待値で足す)

```swift
import Testing
@testable import TripCheckKit

@Test func splitsJapaneseListPunctuationButKeepsOfficialMiddleDot() {
  let places = WishlistParser.places("浅草寺、東京スカイツリー／上野公園\n東京ミッドタウン・日比谷")
  #expect(places.map(\.name) == ["浅草寺", "東京スカイツリー", "上野公園", "東京ミッドタウン・日比谷"])
}

@Test func readsMarkersAnywhereButStripsOnlyAtBoundaries() {
  let p = WishlistParser.places("三鷹の森ジブリ美術館 — Day 2 10:00 booked · must")[0]
  #expect(p.name == "三鷹の森ジブリ美術館")
  #expect(p.day == 2); #expect(p.time == "10:00"); #expect(p.isReservation); #expect(p.priority == .must)
  // "Mustard Museum" の must は境界にないので残る
  #expect(WishlistParser.places("Mustard Museum")[0].name == "Mustard Museum")
}

@Test func dayHeadingsKeepRealDateGaps() {
  let lines = WishlistParser.parse("2026-09-14\nSenso-ji\n2026-09-16\nUeno Park")
  guard case .heading(_, let d1) = lines[0], case .heading(_, let d3) = lines[2] else { Issue.record("headings"); return }
  #expect(d1 == 1); #expect(d3 == 3)
  #expect(WishlistParser.places("2026-09-14\nSenso-ji\n2026-09-16\nUeno Park").map(\.day) == [1, 3])
}

@Test func timeRangesAreOpeningHoursNotesNotFixedTimes() {
  let p = WishlistParser.places("東京ミッドタウン・日比谷 — 9:00-17:00")[0]
  #expect(p.time == nil)
}

@Test func stayIsClampedTo15To480() {
  #expect(WishlistParser.places("Tokyo Tower stay 5 min")[0].stayMinutes == 15)
  #expect(WishlistParser.places("Tokyo Tower 滞在900分")[0].stayMinutes == 480)
}

@Test func bulletsAndUrlsAreRemovedAndUnparsedLinesSurvive() {
  let lines = WishlistParser.parse("- Senso-ji\n1. Tokyo Tower\nhttps://example.com/list\n???")
  #expect(WishlistParser.places("- Senso-ji\n1. Tokyo Tower").map(\.name) == ["Senso-ji", "Tokyo Tower"])
  #expect(lines.contains { if case .unparsed = $0 { return true }; return false })
}

@Test func reservationWinsOverOptionalAndKoreanChineseMarkersWork() {
  #expect(WishlistParser.places("경복궁 꼭")[0].priority == .must)
  #expect(WishlistParser.places("故宫 有时间")[0].priority == .optional)
  #expect(WishlistParser.places("Shibuya Sky optional booked")[0].priority == .must)
}
```

- [ ] **Step 2: 失敗を確認**

Run: `apple/tools/verify-kit.sh --filter WishlistParserTests`
Expected: コンパイルエラー

- [ ] **Step 3: 実装**

`WishlistPatterns.swift` に TS の定数(`SEP`, `EDGE_SEP`, `boundaryToken()`, `dayTokenSource`, `mustTokenSource`, `optionalTokenSource`, `reservationTokenSource`, 時間帯 3 種, `colonTimeSource`, `kanjiTimeSource`, `anyTimeSource`, `timeRange`, `timeWithAffixes`, `staySources`, `headingLead`, `englishMonthSource`, `calendarHeadingLead`, `parentheticalLandmark`)を**文字列リテラルで逐語転記**し、`JSRegex` で生成する(`static let` で 1 回だけコンパイル)。JS の `"giu"` → `options: [.caseInsensitive]`(`g` は `matches(in:)` で全件、`u` は ICU 既定)。

`WishlistParser.swift`:

```swift
public enum WishlistParser {
  public static func parse(_ raw: String) -> [ParsedWishlistLine] {
    // TS parseWishlist: NFKC 正規化 → "～〜"→"~" → 行ごとに: 空行 / 見出し(序数・暦) / 場所行(splitPlaces → 各パートのマーカー抽出) / unparsed
    // ※ 行を跨いで currentDay を引き継ぎ、場所行に day が無ければ見出しの day を付ける
    ...
  }
  public static func places(_ raw: String) -> [ParsedWishlistPlace] {
    parse(raw).flatMap { if case .place(_, let p) = $0 { return p }; return [] }
  }
}
```

移植の注意:
- `String.normalize("NFKC")` → `raw.precomposedStringWithCompatibilityMapping`。
- `toLocaleLowerCase()` → `lowercased()`。
- `headingDay`(`:233`)は「序数見出し」と「暦見出し」を順に試す。暦見出しは `calendarEpochDay`(`:227`)で `Date.UTC` 相当 → `CalendarDate.epochDay` を使う。年省略は前の見出しを継承、逆行で +1、`0 ≤ offset < 30` のみ、範囲外は連番にフォールバック(`:216-238` と `:239-300` のロジックをそのまま)。
- `splitTopLevel`(`:129`)は括弧の深さを数えながら区切る。括弧は `()（）[]【】`。
- `tidyName`(`:90`)の置換 4 段は順序を変えない。

- [ ] **Step 4: 緑を確認**

Run: `apple/tools/verify-kit.sh --filter WishlistParserTests`
Expected: 全て passed

- [ ] **Step 5: TS テストの残りを移す**

`tests/wishlist-parser.test.ts` を開き、`parseWishlist` / `parsedWishlistPlaces` を呼ぶ全ケース(27 本中の該当分)を同じ入力・期待値で `WishlistParserTests.swift` に追加する。編集系(`remove/set/update`)のケースは Task 4 に回す。

Run: `apple/tools/verify-kit.sh --filter WishlistParserTests`
Expected: 全て passed

- [ ] **Step 6: Commit**

```bash
git add apple/Packages/TripCheckKit
git commit -m "The parser reads a pasted wishlist the way the web one does"
```

---

### Task 4: WishlistSerializer — 直列化と行単位の編集(他行バイト同一)

**Files:**
- Create: `Sources/TripCheckKit/Parser/WishlistSerializer.swift`
- Test: `Tests/TripCheckKitTests/Units/WishlistSerializerTests.swift`
- 移植元: `lib/wishlist-parser.ts:401-615`(`parsedWishlistPlaces`, `formatParsedWishlistPlaces`, `formatWishlistLines`, `serializeWishlistPlaceLine`, `removeWishlistPlace`, `setWishlistPlacePriority`, `normalizeConstraintPatch`, `updateWishlistPlaceConstraints`)

**Interfaces:**
- Produces: `WishlistSerializer.formatPlaces(_:languageCode:)`, `.formatLines(_:languageCode:)`, `.removePlace(raw:occurrenceIndex:)`, `.setPriority(raw:occurrenceIndex:priority:)`, `.updateConstraints(raw:occurrenceIndex:patch:)`, `WishlistPlaceConstraintPatch`(`priority?`, `time??`, `timeOfDay??`, `isReservation?`, `stayMinutes??` — TS の `Partial<Pick<…>>` は「キー無し」と「null」を区別するので二重 Optional)

- [ ] **Step 1: 失敗するテストを書く**

```swift
@Test func serializesMarkersInBothLanguages() {
  let p = ParsedWishlistPlace(name: "Ghibli Museum", day: 2, time: "10:00", timeOfDay: nil, isReservation: true, priority: .must, stayMinutes: 120)
  #expect(WishlistSerializer.formatPlaces([p], languageCode: .en) == "Ghibli Museum — Day 2 10:00 booked · must · stay 120 min")
  #expect(WishlistSerializer.formatPlaces([p], languageCode: .ja) == "Ghibli Museum — 2日目 10:00 予約 · 必須 · 滞在120分")
}

@Test func removingOnePlaceLeavesOtherLinesByteIdentical() {
  let raw = "Day 1\n- Senso-ji must\n  weird   spacing line ☆\nTokyo Tower"
  let out = WishlistSerializer.removePlace(raw: raw, occurrenceIndex: 0)
  #expect(out == "Day 1\n  weird   spacing line ☆\nTokyo Tower")
}

@Test func updatingConstraintsRewritesOnlyThatLine() {
  let raw = "Senso-ji\nTokyo Tower\nUeno Park"
  let out = WishlistSerializer.updateConstraints(raw: raw, occurrenceIndex: 1, patch: .init(time: .some("14:30"), isReservation: true))
  #expect(out.split(separator: "\n", omittingEmptySubsequences: false)[0] == "Senso-ji")
  #expect(out.split(separator: "\n", omittingEmptySubsequences: false)[2] == "Ueno Park")
  #expect(WishlistParser.places(out)[1].time == "14:30")
  #expect(WishlistParser.places(out)[1].isReservation)
}

@Test func clearingTimeWithNullRemovesItButMissingKeyKeepsIt() {
  let raw = "Tokyo Tower 14:30"
  #expect(WishlistParser.places(WishlistSerializer.updateConstraints(raw: raw, occurrenceIndex: 0, patch: .init(time: .some(nil))))[0].time == nil)
  #expect(WishlistParser.places(WishlistSerializer.updateConstraints(raw: raw, occurrenceIndex: 0, patch: .init(priority: .optional)))[0].time == "14:30")
}
```

- [ ] **Step 2: 失敗を確認** — Run: `apple/tools/verify-kit.sh --filter WishlistSerializerTests` → コンパイルエラー

- [ ] **Step 3: 実装**

`formatPlaces` の区切りと語彙は TS `serializeWishlistPlaceLine`(`:458`)の通り: `name — [Day N | N日目] [HH:MM] [booked|予約] · [must|必須 / optional|時間があれば] · [morning|朝 …] · [stay N min|滞在N分]`。`removePlace` / `setPriority` / `updateConstraints` は `parse` の行構造を使い、**occurrence 番目の場所を含む行だけ**を再構築(複数場所を含む行は残りを再直列化)、他の行は `raw` をそのまま連結(`:476-615`)。

- [ ] **Step 4: 緑を確認** — Run: 同上 → passed。TS `wishlist-parser.test.ts` の編集系ケースも全部移す。

- [ ] **Step 5: Commit** — `git commit -m "Editing one wishlist line leaves every other byte alone"`

---

### Task 5: G2 パーサ合成コーパス(500 件)

**Files:**
- Create: `Tests/TripCheckKitTests/Support/ParserCorpusGenerator.swift`, `Tests/TripCheckKitTests/Golden/ParserCorpusTests.swift`
- 移植元: `tests/fixtures/wishlist-parser-synthetic-fixtures.ts`(全 95 行、定数配列)、`tests/helpers/generate-wishlist-parser-corpus.ts`(全 215 行、乱数なし・index 決定)、`tests/wishlist-parser-corpus.test.ts`(閾値)

**Interfaces:**
- Produces: `ParserCorpusGenerator.generate(_ count: Int) -> [SyntheticParserCase]`

- [ ] **Step 1: 生成器を移植する**(テスト支援コード。TS と同じ `choose(values, index) = values[index % count]`、`makeCase(index)` の 10 カテゴリ、`syntheticSecondCalendarDay` は `CalendarDate.epochDay` で)

```swift
struct ExpectedSyntheticPlace { var name: String; var day: Int?; var priority: WishlistPriority?; var isReservation: Bool?; var time: String?; var stayMinutes: Int? }
struct SyntheticParserCase { var id: String; var category: String; var input: String; var expectedPlaces: [ExpectedSyntheticPlace]; var expectedHeadings: [Int] }
enum ParserCorpusGenerator {
  static let englishPlaces = ["Senso-ji","Tokyo Skytree","Meiji Jingu","Shibuya Sky","Ueno Park","Ghibli Museum","teamLab Planets","Tokyo Tower","Imperial Palace","Tsukiji Outer Market"]
  // …JAPANESE_PLACES / MUST_MARKERS / OPTIONAL_MARKERS / BOOKING_MARKERS / FIXED_TIME_MARKERS / STAY_MARKERS / BULLETS / ISO_HEADINGS / MONTH_NAME_HEADINGS を逐語転記
  static func generate(_ count: Int) -> [SyntheticParserCase] { (0..<count).map(makeCase) }
  static func makeCase(_ index: Int) -> SyntheticParserCase { /* TS :78-214 の switch をそのまま */ }
}
```

- [ ] **Step 2: 閾値テストを書く**(TS `:52-132` と同じ集計)

```swift
@Test func syntheticCorpusMeetsRegressionThresholds() {
  let corpus = ParserCorpusGenerator.generate(500)
  #expect(Set(corpus.map(\.id)).count == 500)
  var tp = 0, fp = 0, fn = 0, markerOk = 0, markerTotal = 0, headingOk = 0, headingTotal = 0, dayOk = 0, dayTotal = 0, headingFalsePositive = 0
  func norm(_ s: String) -> String { s.precomposedStringWithCompatibilityMapping.lowercased().split(separator: " ").joined(separator: " ") }
  for c in corpus {
    let lines = WishlistParser.parse(c.input)
    let actual = lines.flatMap { if case .place(_, let p) = $0 { return p }; return [] }
    let exp = c.expectedPlaces.map { norm($0.name) }, act = actual.map { norm($0.name) }
    var counts: [String: Int] = [:]; for a in act { counts[a, default: 0] += 1 }
    var hit = 0; for e in exp { if let n = counts[e], n > 0 { counts[e] = n - 1; hit += 1 } }
    tp += hit; fp += act.count - hit; fn += exp.count - hit
    let byName = Dictionary(actual.map { (norm($0.name), $0) }, uniquingKeysWith: { a, _ in a })
    for e in c.expectedPlaces {
      let a = byName[norm(e.name)]
      if let p = e.priority { markerTotal += 1; if a?.priority == p { markerOk += 1 } }
      if let r = e.isReservation { markerTotal += 1; if a?.isReservation == r { markerOk += 1 } }
      if let t = e.time { markerTotal += 1; if a?.time == t { markerOk += 1 } }
      if let s = e.stayMinutes { markerTotal += 1; if a?.stayMinutes == s { markerOk += 1 } }
      if let d = e.day { dayTotal += 1; if a?.day == d { dayOk += 1 } }
    }
    let headings = lines.compactMap { if case .heading(_, let d) = $0 { return d }; return nil }
    headingTotal += c.expectedHeadings.count
    headingOk += zip(headings, c.expectedHeadings).filter { $0 == $1 }.count
    if c.expectedHeadings.isEmpty && !headings.isEmpty { headingFalsePositive += 1 }
  }
  let precision = Double(tp) / Double(max(1, tp + fp)), recall = Double(tp) / Double(max(1, tp + fn))
  let f1 = 2 * precision * recall / max(1e-9, precision + recall)
  #expect(f1 >= 0.97); #expect(recall >= 0.99)
  #expect(Double(markerOk) / Double(max(1, markerTotal)) >= 0.99)
  #expect(Double(headingOk) / Double(max(1, headingTotal)) >= 0.99)
  #expect(Double(dayOk) / Double(max(1, dayTotal)) >= 0.99)
  #expect(headingFalsePositive == 0)
}

@Test func parserP95Under200ms() {
  let corpus = ParserCorpusGenerator.generate(500)
  for _ in 0..<4 { for c in corpus.prefix(50) { _ = WishlistParser.parse(c.input) } }   // ウォームアップ
  var samples: [Double] = []
  let clock = ContinuousClock()
  for c in corpus { let t = clock.measure { _ = WishlistParser.parse(c.input) }; samples.append(Double(t.components.attoseconds) / 1e15 + Double(t.components.seconds) * 1000) }
  samples.sort()
  #expect(samples[Int(Double(samples.count) * 0.95)] < 200)
}
```

- [ ] **Step 3: 実行** — Run: `apple/tools/verify-kit.sh --filter ParserCorpusTests`。赤なら `WishlistParser` の該当分岐を TS と突き合わせて直す(テストの閾値は変えない)。

- [ ] **Step 4: Commit** — `git commit -m "Five hundred synthetic wishlists agree with the parser"`

---

### Task 6: Destinations — 25 プロファイル・入国/旅券規則・TZ 関数

**Files:**
- Create: `Sources/TripCheckKit/Destinations/{Destination,DestinationData,DestinationEssentials,DestinationTime}.swift`
- Test: `Tests/TripCheckKitTests/Units/DestinationsTests.swift`
- 移植元: `lib/destinations.ts` 全 1,643 行(型 `:19-130`、データ `:131-929`、essentials `:930-1216`、`EntryAuthority`/`PassportRule` `:1217-1472`、関数 `:1473-1640`)。TS テスト: `tests/destinations.test.ts`

**Interfaces:**
- Produces: 型リファレンスの Destinations 節 + `DestinationAirport { code, names: (en, ja), latitude, longitude, transferMinutes, internationalDepartureMinutes, sourceUrl }`, `MealWindow { start, end }`(分), `GeoBounds { south, west, north, east }`, `Destinations.airport(_:code:) -> DestinationAirport?`, `Destinations.airportComparisonGroup(_:code:) -> [DestinationAirport]`, `Destinations.name(_:locale:)`, `Destinations.options(locale:) -> [(choice: DestinationChoice, label: String)]`(auto → A→Z → worldwide), `Destinations.essentials(_:) -> DestinationEssentials?`, `Destinations.entryAuthority(_:) -> EntryAuthority?`, `Destinations.passportRule(_:) -> PassportRule?`, `Destinations.localDateTimeWithOffset(date:time:timeZone:) -> Date?`

- [ ] **Step 1: 失敗するテストを書く**(統合仕様 §11.3 の事実 + `tests/destinations.test.ts` の全ケース)

```swift
@Test func hasTwentyFiveProfilesAndJapanFacts() throws {
  #expect(Destinations.all.count == 25)
  let jp = Destinations.byId(.japan)
  #expect(jp.mobility == .transit_first)
  #expect(jp.meals.lunch == MealWindow(start: 11*60, end: 14*60+30))
  #expect(jp.meals.dinner == MealWindow(start: 17*60+30, end: 21*60))
  let hnd = try #require(Destinations.airport(jp, code: "HND"))
  #expect(hnd.transferMinutes == 60); #expect(hnd.internationalDepartureMinutes == 180)
  #expect(Destinations.airportComparisonGroup(jp, code: "HND").map(\.code).sorted() == ["HND", "NRT"])
  #expect(Destinations.airportComparisonGroup(jp, code: "FUK").isEmpty)
}

@Test func countryCodesCoverSharedProfiles() {
  #expect(Destinations.forCountryCode("LI")?.id == .switzerland)
  #expect(Destinations.forCountryCode("VA")?.id == .italy)
  #expect(Destinations.forCountryCode("BR") == nil)
  #expect(Destinations.forCoordinate(46.9, 7.4)?.id == .switzerland)
}

@Test func spainEatsLateAndDachClosesOnSunday() {
  #expect(Destinations.byId(.spain).meals.dinner.start == 21*60)
  #expect(Destinations.byId(.germany).sundayClosing); #expect(!Destinations.byId(.japan).sundayClosing)
}

@Test func japaneseQueriesGetJapaneseCountrySuffix() {
  #expect(Destinations.placeQuery("ベルン旧市街", destination: Destinations.byId(.switzerland), languageCode: .ja) == "ベルン旧市街 スイス")
}

@Test func utcOffsetsHonourDst() throws {
  let ny = Destinations.utcOffsetMinutes(at: try #require(Destinations.localDateTimeWithOffset(date: "2026-03-07", time: "12:00", timeZone: "America/New_York")), timeZone: "America/New_York")
  let ny2 = Destinations.utcOffsetMinutes(at: try #require(Destinations.localDateTimeWithOffset(date: "2026-03-08", time: "12:00", timeZone: "America/New_York")), timeZone: "America/New_York")
  #expect(ny == -300); #expect(ny2 == -240)
}

@Test func entryAuthorityAndPassportRulesMatchTable() {
  #expect(Destinations.entryAuthority(Destinations.byId(.usa))?.status == .required)
  #expect(Destinations.entryAuthority(Destinations.byId(.france))?.status == .not_yet)
  #expect(Destinations.entryAuthority(Destinations.byId(.korea))?.statusValidUntil == "2026-12-31")
  #expect(Destinations.passportRule(Destinations.byId(.thailand))?.monthsBeyond == 6)
}

@Test func optionsAreAutoThenAlphabeticalThenWorldwide() {
  let o = Destinations.options(locale: .en)
  #expect(o.first?.choice == .auto); #expect(o.last?.choice == .destination(.worldwide)); #expect(o.count == 26)
}
```

- [ ] **Step 2: 失敗を確認** — コンパイルエラー

- [ ] **Step 3: 実装**

- `Destination.swift`: 型(TS `:19-130`)。`DestinationChoice` の `Codable`: `"auto"` ↔ `.auto`、それ以外は `DestinationId` の raw value。
- `DestinationData.swift`: `Destinations.all` に 25 件を **TS `:131-929` から手で逐語転記**(数値・URL・文言を変えない。`ko`/`zh` の名前は `names` に含めてよいが `PlannerLocale` は ja/en のみなので `namesKo/namesZh` は持たない=落とす)。転記後、`grep -c '"code":' lib/destinations.ts` 相当で空港数を数え、Swift 側の `Destinations.all.flatMap(\.airports).count` がテストで一致することを確認する(期待値は TS から `grep -o 'code: "[A-Z]\{3\}"' lib/destinations.ts | sort -u | wc -l` で数えてテストに固定)。
- `DestinationEssentials.swift`: `essentials`/`EntryAuthority`/`PassportRule` のテーブル(`:930-1472`)。
- `DestinationTime.swift`: `utcOffsetMinutesAt`(`TimeZone(identifier:)!.secondsFromGMT(for:) / 60`)、`localDateTimeWithOffset`(`DateComponents` + `TimeZone` で `Date`)、`localDateIn`。
- 関数群(`:1473-1640`): `byId`(未知は worldwide)、`forCountryCode`(大文字化)、`forCoordinate`(**最小面積**の bounds を選ぶ `:1517`)、`withinBounds`、`placeQuery`(ja は `querySuffix` の日本語名、en は英語名。TS `:1529` の分岐をそのまま)、`name`、`options`。

- [ ] **Step 4: 緑を確認** — Run: `--filter DestinationsTests` → passed

- [ ] **Step 5: Commit** — `git commit -m "Every country the web planner knows, the Swift one knows too"`

---

### Task 7: RouteStop・東京カタログ・順序最適化(Held-Karp / 2-opt)・Google Maps URL

**Files:**
- Create: `Sources/TripCheckKit/Geo/{RouteStop,Catalog,SwissSample,RouteOrdering,GoogleMapsUrl}.swift`
- Test: `Tests/TripCheckKitTests/Units/RouteOrderingTests.swift`, `Tests/TripCheckKitTests/Units/CatalogTests.swift`
- 移植元: `lib/route-optimizer.ts` 全 499 行(型 `:3-50`、カタログ 18 件 `:60-284`、`dayHeading/explicitAnchorPattern/toStop/resolveKnownStops` `:285-317`、`routeDistance/optimizeKnownStopOrder/exactOpenPath/heuristicOpenPath` `:330-435`、`buildGoogleMapsUrl` `:436-452`)。`lib/destinations.ts` の `sampleStops`(スイス 8 地点)。TS テスト: `tests/route-optimizer.test.ts`

**Interfaces:**
- Produces: `RouteStop`, `ResolvedStop`, `ResolvedStopProvider`, `Confidence: String { low, medium }`, `Catalog.resolveKnownStops(_:locale:)`, `Catalog.poiCount == 18`, `Catalog.isReservationSensitive(id:)`, `RouteOrdering.optimize(_ stops: [RouteStop], preserveFirst: Bool) -> (stops: [RouteStop], exact: Bool)`, `RouteOrdering.openPathDistanceKm(_:)`, `GoogleMapsUrl.build(_ stops: [RouteStop], travelMode: GoogleTravelMode) -> String`

- [ ] **Step 1: 失敗するテストを書く**

```swift
@Test func catalogRecognisesAliasesInFourScripts() {
  #expect(Catalog.resolveKnownStops("築地場外市場", locale: .ja).first?.id == "tsukiji-market")
  #expect(Catalog.resolveKnownStops("teamLab Planets", locale: .en).first?.planningDurationMinutes == 120)
  #expect(Catalog.resolveKnownStops("센소지", locale: .en).first?.id == "sensoji")
  #expect(Catalog.poiCount == 18)
}

@Test func exactOrderingBeatsGreedyUpToTenStops() {
  let stops = TestStops.ring(count: 8)     // Support/TestStops.swift: 円周上に等間隔の 8 点をシャッフル順で
  let out = RouteOrdering.optimize(stops, preserveFirst: false)
  #expect(out.exact)
  #expect(RouteOrdering.openPathDistanceKm(out.stops) <= RouteOrdering.openPathDistanceKm(stops) + 1e-9)
  let eleven = TestStops.ring(count: 11)
  #expect(RouteOrdering.optimize(eleven, preserveFirst: false).exact == false)
}

@Test func googleMapsUrlCapsWaypointsAtTen() {
  let url = GoogleMapsUrl.build(TestStops.ring(count: 13), travelMode: .transit)
  #expect(url.hasPrefix("https://www.google.com/maps/dir/?api=1"))
  #expect(url.components(separatedBy: "%7C").count <= 9)   // waypoints は先頭 9 + 最終
}
```

- [ ] **Step 2: 失敗を確認**

- [ ] **Step 3: 実装**

- `RouteStop.swift`: TS `:3-32` の全フィールド。`ResolvedStop` は `RouteStop` を継承できないので **フィールドを複製**し、`var routeStop: RouteStop { get }` を用意する(Builder はこれで `RouteStop` に畳む)。`Codable` キーは TS と同名。
- `Catalog.swift`: 18 件を逐語転記(`aliases` は `JSRegex`)。`resolveKnownStops` は `explicitAnchorPattern` と `dayHeading` の扱いを含めて `:285-317` の通り。
- `SwissSample.swift`: `Destinations.byId(.switzerland).sampleStops` をビルド用の `ResolvedStop` 配列に変換する `SwissSample.resolvedStops(locale:) -> [ResolvedStop]`(id は `sample-{index}`、`provider: .catalog`、`confidence: .medium`、`verifiedAt: "2026-08-09"`)。
- `RouteOrdering.swift`: `exactOpenPath`(`:353`、Held-Karp DP。TS は `preserveFirst` で始点固定の open path。≤10 点)と `heuristicOpenPath`(`:396`、最近傍 + 2-opt)。
- `GoogleMapsUrl.swift`: `:436-452`。

- [ ] **Step 4: 緑を確認** — `--filter "RouteOrderingTests|CatalogTests"`。`tests/route-optimizer.test.ts` の残りケースも移す。

- [ ] **Step 5: Commit** — `git commit -m "Eighteen Tokyo places and the shortest way through them"`

---

### Task 8: 滞在の推定・移動手段の推定と推奨・山岳アクセスノード・空港比較

**Files:**
- Create: `Sources/TripCheckKit/Builder/{StayEstimates,TravelEstimates,PoiAccess,AirportComparison}.swift`, `Sources/TripCheckKit/Builder/BuilderTypes.swift`(`Pace`, `StopPriority`, `MealPlan`, `MealKind`, `TransportMode`, `TravelPreference`, `VisitWindow`, `FlightKind`)
- Test: `Tests/TripCheckKitTests/Units/{StayEstimatesTests,TravelEstimatesTests,PoiAccessTests,AirportComparisonTests}.swift`
- 移植元: `lib/stay-estimates.ts`(67 行)、`lib/time-feasibility.ts`(145 行)、`lib/poi-access.ts`(233 行)、`lib/airport-comparison.ts`(128 行)、`lib/place-hours.ts`(31 行 → `VisitWindows.swift` の一部として Task 10)。TS テスト: `tests/travel-logic.test.ts`(15)、`tests/poi-access.test.ts`、`tests/airport-comparison.test.ts`

**Interfaces:**
- Produces: `StayEstimates.estimateStayMinutes(name:placeTypes:) -> Int`, `StayEstimates.isDayAnchorStay(_:) -> Bool`(≥300), `StayEstimates.isFoodPlaceTypes(_:)`;
  `ModeEstimate`, `ModeComparison`, `ModeSource: String { estimate, live }`, `LiveLegEvidence { transitMinutes: Int?, transitAbsent: Bool, transferCount: Int?, walkingMinutes: Int?, drivingMinutes: Int? }`, `TravelEstimates.estimate(distanceKm:preference:mobility:live:allowedModes:override:) -> ModeComparison`, `TravelEstimates.applyLiveTransit(_:minutes:) -> ModeComparison`;
  `PoiAccess.policy(for: RouteStop) -> PoiAccessPolicy?`, `PoiAccess.allowedModes(from:to:) -> [TransportMode]?`, `PoiAccess.routeEndpoints(from:to:) -> (from: PoiRouteEndpoint, to: PoiRouteEndpoint, scope: RouteEvidenceScope?, assumptions: [PoiAccessAssumption])`;
  `AirportComparison.compare(options: [AirportOptionInput], direction:, flightKind:, destination:) -> [AirportOptionResult]`

- [ ] **Step 1: 失敗するテストを書く**

```swift
@Test func stayEstimatesFollowNameThenTypeThenDefault() {
  #expect(StayEstimates.estimateStayMinutes(name: "東京ディズニーランド", placeTypes: nil) == 540)
  #expect(StayEstimates.estimateStayMinutes(name: "Some Museum", placeTypes: ["museum"]) == 120)
  #expect(StayEstimates.estimateStayMinutes(name: "Ramen Place", placeTypes: ["restaurant"]) == 45)
  #expect(StayEstimates.estimateStayMinutes(name: "Somewhere", placeTypes: ["tourist_attraction"]) == 75)
  #expect(StayEstimates.estimateStayMinutes(name: "Somewhere", placeTypes: nil) == 90)
  #expect(StayEstimates.isDayAnchorStay(300)); #expect(!StayEstimates.isDayAnchorStay(299))
}

@Test func travelEstimatesRoundUpToFiveAndRespectFloors() {
  let c = TravelEstimates.estimate(distanceKm: 1.0, preference: .auto, mobility: .transit_first, live: .none, allowedModes: nil, override: nil)
  #expect(c.options.first { $0.mode == .walk }?.minutes == 20)      // 5 + 60/4.5 = 18.3 → 20
  #expect(c.options.first { $0.mode == .transit }?.minutes == 20)   // 12 + 5.5 = 17.5 → 20
  #expect(c.options.first { $0.mode == .taxi }?.minutes == 15)      // 8 + 3 = 11 → 15
  #expect(c.recommended == .walk)                                   // 徒歩 ≤25 分
}

@Test func transitFirstKeepsMeasuredTrainAgainstUnmeasuredTaxi() {
  // ラウターブルンネン→ツェルマット: 実測鉄道 150 分 vs 推定タクシー 105 分
  let c = TravelEstimates.estimate(distanceKm: 70, preference: .auto, mobility: .transit_first,
                                   live: LiveLegEvidence(transitMinutes: 150, transitAbsent: false, transferCount: 2, walkingMinutes: nil, drivingMinutes: nil), allowedModes: nil, override: nil)
  #expect(c.recommended == .transit)
}

@Test func unroutableTransitIsNegativeEvidenceNotARecommendation() {
  let c = TravelEstimates.estimate(distanceKm: 12, preference: .auto, mobility: .transit_first,
                                   live: LiveLegEvidence(transitMinutes: nil, transitAbsent: true, transferCount: nil, walkingMinutes: nil, drivingMinutes: 25), allowedModes: nil, override: nil)
  #expect(c.recommended == .taxi)
  #expect(c.options.first { $0.mode == .transit }?.unroutable == true)
}

@Test func mountainRailwayOnlyAllowsTransit() {
  let jungfrau = RouteStop(id: "jungfraujoch", providerRef: nil, name: "Jungfraujoch", area: "Bern", latitude: 46.5475, longitude: 7.9853, sourceUrl: "", verifiedAt: "", confidence: .medium, planningDurationMinutes: 240, isAnchor: true, placeTypes: nil, openingHoursApplicable: nil, isUserEntered: nil, userProvidedCoordinates: nil)
  let interlaken = RouteStop(id: "i", providerRef: nil, name: "Interlaken", area: "Bern", latitude: 46.6863, longitude: 7.8632, sourceUrl: "", verifiedAt: "", confidence: .medium, planningDurationMinutes: 60, isAnchor: true, placeTypes: nil, openingHoursApplicable: nil, isUserEntered: nil, userProvidedCoordinates: nil)
  #expect(PoiAccess.allowedModes(from: interlaken, to: jungfrau) == [.transit])
  let ep = PoiAccess.routeEndpoints(from: interlaken, to: jungfrau)
  #expect(ep.scope == .access_node)   // Eigergletscher 駅に差し替え
}

@Test func airportBoundariesCrossMidnight() {
  let jp = Destinations.byId(.japan)
  let r = AirportComparison.compare(options: [.init(code: "HND", flightTime: "23:30")], direction: .arrival, flightKind: .international, destination: jp)
  #expect(r[0].cityTime == "02:00")          // 23:30 + 90 + 60
  #expect(r[0].cityTimeDayOffset == 1)
  #expect(r[0].airportMinutes == 90)
}
```

- [ ] **Step 2: 失敗を確認**

- [ ] **Step 3: 実装**

- `StayEstimates`: TS `:39-67`(名前パターン表 → タイプ表 → 飲食 45 → 汎用ランドマーク 75 → 既定 90)。
- `TravelEstimates`: `roundUpFive`, `tieredMinutes`, `transitEstimate`, `driveEstimate`, `pickRecommended`(`:66-95`: `preference == .car` / 徒歩 ≤25 / transit 許容 `transit_first: max(10, 25%)` `balanced: max(5, 10%)` `car_first: −15` / 非対称証拠ガード / `unroutable`)、`finalizeComparison`、`estimateTravelOptions`、`applyLiveTransitMinutes`。`LiveLegEvidence.none` を静的に用意。
- `PoiAccess`: 2 ポリシー(`jungfraujoch` → Eigergletscher、`gornergrat` → Zermatt GGB)の座標と `verifiedAt 2026-08-09` を逐語転記。`validCoordinate` が偽なら `conditional`(fail closed)。
- `AirportComparison`: `:49-128`。処理バッファ(到着 国際 90 / 国内 45、出発 国際 空港ごと `internationalDepartureMinutes` / 国内 90)、移送 `transferMinutes`、`dayOffset`。

- [ ] **Step 4: 緑を確認**。`tests/travel-logic.test.ts` / `poi-access.test.ts` / `airport-comparison.test.ts` の残りを移す。

- [ ] **Step 5: Commit** — `git commit -m "How long a stop takes and how to get to the next one"`

---
### Task 9: Builder の型と PlannerContext(golden JSON をそのまま読めること)

**Files:**
- Create: `Sources/TripCheckKit/Builder/PlannerContext.swift`, `Sources/TripCheckKit/Builder/BuiltPlan.swift`, `Tests/TripCheckKitTests/Support/GoldenCorpus.swift`
- Copy: `tests/fixtures/golden-feasibility.v1.json` → `Tests/TripCheckKitTests/Fixtures/golden-feasibility.v1.json`(`cp` のみ。バイト変更禁止)
- Test: `Tests/TripCheckKitTests/Units/PlannerContextCodableTests.swift`
- 移植元: `lib/trip-builder.ts:39-300`(型)。golden の形は `tests/golden-feasibility.test.ts:15-58`

**Interfaces:**
- Produces: `PlannerContext`(全フィールド Optional、TS と同名: `destination: DestinationChoice?`, `tripStartDate: String?`, `hotelQuery`, `arrivalAirport`, `arrivalTime`, `departureAirport`, `departureTime`, `flightKind: FlightKind?`, `dayStartTimes: [Int: String]?`, `dayEndTimes`, `durationOverrides: [String: Int]?`, `earlyVisitStopIds: [String]?`, `liveTransitMinutes: [String: Int]?`, `liveTransitAbsentLegs: [String: Bool]?`, `liveTransitTransferCounts`, `liveWalkingMinutes`, `liveDrivingMinutes`, `travelPreference`, `legModeOverrides: [String: TransportMode]?`, `dayOverrides: [String: Int]?`, `lockedOrderByDay: [Int: [String]]?`, `optimizeExistingOrder: Bool?`, `defaultDayStart: String?`, `dayEndTarget: String?`, `transferBufferMinutes: Int?`, `excludedStopIds`, `maxWalkingMinutesPerLeg`, `maxTransfersPerLeg`, `openingWindowsByDay: [String: [Int: [VisitWindow]]]?`, `lastEntryTimes: [String: String]?`, `mealPlan`, `resolvedStops: [ResolvedStop]?`, `resolvedBase: ResolvedStop??`, `nightBases: [Int: ResolvedStop?]?`)
- `WishlistStopConstraint { priority, fixedDay: Int?, fixedTime: String?, fixedTimeMinutes: Int?, timeOfDay, isReservation, stayMinutes: Int? }`
- `BuiltPlanStop`, `BuiltPlanLeg`, `MobilityPolicy`, `BuiltPlanDay`, `TripBase`, `BaseRecommendation`, `AirportConstraint`, `FoodRecommendationSlot`, `CrowdOutlook`, `BuiltTripPlan`(TS `:39-300` と同名フィールド。`OpeningStatus: String { verified_open, unknown, conflict, closed_day, last_entry_conflict }`, `RouteEvidenceScope: String { access_node, conditional }`, `DeadlineKind: String { airport, curfew }`, `InputMode: String { wishlist, existing_itinerary }`)
- `GoldenCorpus.load() -> GoldenCorpus`(`scenarios: [GoldenScenario]`、`GoldenScenario { id, region, archetype, seed, pairId, trip: (raw, days, pace, locale, context), evidence: EvidenceSnapshotOptions(Task 16 までは `JSONValue` で保持), oracle }`)

- [ ] **Step 1: 失敗するテストを書く**

```swift
@Test func goldenContextsDecodeWithoutLoss() throws {
  let corpus = try GoldenCorpus.load()
  #expect(corpus.scenarios.count == 500)
  for s in corpus.scenarios {
    #expect(s.trip.context.resolvedStops?.isEmpty == false, "\(s.id)")
    #expect(s.trip.context.tripStartDate == "2026-10-13", "\(s.id)")
  }
  // JSON の整数キー(dayStartTimes の "0")が Int キーの辞書に入ること
  let one = corpus.scenarios[0].trip.context
  #expect(one.openingWindowsByDay?["fixture-tokyo-001-day-end"]?[0]?.first?.openMinutes == 480)
  #expect(one.durationOverrides?["fixture-tokyo-001-day-end"] == 120)
}

@Test func contextRoundTripsThroughJSON() throws {
  let corpus = try GoldenCorpus.load()
  let enc = JSONEncoder(); enc.outputFormatting = [.sortedKeys]
  for s in corpus.scenarios.prefix(50) {
    let data = try enc.encode(s.trip.context)
    let back = try JSONDecoder().decode(PlannerContext.self, from: data)
    #expect(back == s.trip.context, s.id)
  }
}
```

- [ ] **Step 2: 失敗を確認**

- [ ] **Step 3: 実装**

- `PlannerContext`: `Codable` を手書きしない。**`[Int: X]` は JSON でオブジェクト(文字列キー)**なので、`Codable` 既定だと配列形式になってしまう → `IntKeyedDictionary<Value>` ラッパ(`Codable` で文字列キー ↔ Int 変換)を `Core/IntKeyed.swift` に作り、`dayStartTimes: IntKeyedDictionary<String>?` のように持つ。等価性は中身の辞書で。
- `ResolvedStop??`(`resolvedBase?: ResolvedInputStop | null`)は `decodeIfPresent` で `null` と欠落を区別しなくてよい(TS 側も `?? null` で畳む)→ `ResolvedStop?` でよい。
- `BuiltPlan.swift`: TS `:39-300` を struct 群に。`readonly PoiAccessAssumption[]` → `[PoiAccessAssumption]`。
- `GoldenCorpus.swift`: `Bundle.module.url(forResource: "golden-feasibility.v1", withExtension: "json", subdirectory: "Fixtures")` からデコード。`oracle` は `GoldenOracle { hardConflictExpected, expectedStateOneOf: [String], requiredConflictCodes: [String], forbiddenConflictCodes: [String], mustScheduledIds: [String], expectedUnknownKinds: [String]?, solverTimedOut: Bool? }`(文字列のまま。Task 16 で enum と突き合わせる)。

- [ ] **Step 4: 緑を確認** — `--filter PlannerContextCodableTests`

- [ ] **Step 5: Commit** — `git commit -m "The five hundred golden trips load into Swift types unchanged"`

---

### Task 10: 営業窓と訪問の当てはめ・日内順序(辞書式 6 項)

**Files:**
- Create: `Sources/TripCheckKit/Builder/VisitWindows.swift`, `Sources/TripCheckKit/Builder/DayOrdering.swift`
- Test: `Tests/TripCheckKitTests/Units/DayOrderingTests.swift`
- 移植元: `lib/trip-builder.ts:1258-1300`(`fitVisitToWindow`, `distanceToWindow`)、`:1293-1505`(`compareScheduleOrderScore`, `scheduleOrderScore`, `orderForReservations`)、`lib/place-hours.ts`(31 行、`hasUsableOpeningWindow` 系)。TS テスト: `tests/trip-builder.test.ts` の順序系、`tests/place-hours.test.ts`

**Interfaces:**
- Consumes: `RouteStop`, `TripBase`, `WishlistStopConstraint`, `VisitWindow`, `MealWindow`, `TravelEstimates`, `PoiAccess`
- Produces:
  - `enum VisitFit: Equatable { case unknown(start: Int), closedDay, verifiedOpen(start: Int), lastEntryConflict(start: Int), conflict(start: Int) }` と `func fitVisitToWindow(cursor: Int, duration: Int, windows: [VisitWindow]?) -> (start: Int, status: OpeningStatus)`
  - `struct TravelInputs { preference, mobility: MobilityProfile?, transit: [String: Int]?, transitAbsent: [String: Bool]?, transfers: [String: Int]?, walking, driving, overrides: [String: TransportMode]?, bufferMinutes: Int?, maxWalkingMinutesPerLeg: Int?, maxTransfersPerLeg: Int? ; static let `default` }`
  - `func routeLegKey(_ fromId: String, _ toId: String) -> String`(TS `:363`: `"\(from)->\(to)"` — 実際の区切りは TS を見て同一に)
  - `struct ScheduleOrderScore: Comparable { hardViolationCount, hardViolationMinutes, softPenalty, travelMinutes, elapsedMinutes: Int, idKey: String }`
  - `enum DayOrdering { static func orderForReservations(stops:, base:, startMinutes:, constraints: [String: WishlistStopConstraint], earlyVisitStopIds: Set<String>, foodStopIds: Set<String>, openingWindows: [String: [VisitWindow]], meals:, travel: TravelInputs, lockedOrder: [String]) -> [RouteStop] }`
  - `enum DayOrdering.score(...) -> ScheduleOrderScore`(テスト用に公開)

- [ ] **Step 1: 失敗するテストを書く**

```swift
@Test func fitVisitDistinguishesClosedDayFromConflict() {
  #expect(fitVisitToWindow(cursor: 600, duration: 60, windows: nil).status == .unknown)
  #expect(fitVisitToWindow(cursor: 600, duration: 60, windows: []).status == .closed_day)
  #expect(fitVisitToWindow(cursor: 600, duration: 60, windows: [VisitWindow(openMinutes: 540, closeMinutes: 1080, lastEntryMinutes: nil)]).status == .verified_open)
  let late = fitVisitToWindow(cursor: 1070, duration: 60, windows: [VisitWindow(openMinutes: 540, closeMinutes: 1080, lastEntryMinutes: 1020)])
  #expect(late.status == .last_entry_conflict)
  #expect(fitVisitToWindow(cursor: 1200, duration: 60, windows: [VisitWindow(openMinutes: 540, closeMinutes: 1080, lastEntryMinutes: nil)]).status == .conflict)
  // 開店前に着いたら開店まで待つ
  #expect(fitVisitToWindow(cursor: 500, duration: 60, windows: [VisitWindow(openMinutes: 540, closeMinutes: 1080, lastEntryMinutes: nil)]).start == 540)
}

@Test func oneBookingViolationOutranksAnySoftPenalty() {
  let a = ScheduleOrderScore(hardViolationCount: 1, hardViolationMinutes: 5, softPenalty: 0, travelMinutes: 0, elapsedMinutes: 0, idKey: "a")
  let b = ScheduleOrderScore(hardViolationCount: 0, hardViolationMinutes: 0, softPenalty: 100_000, travelMinutes: 10_000, elapsedMinutes: 10_000, idKey: "b")
  #expect(b < a)
}

@Test func lockedOrderIsKeptVerbatimAndNewStopsAppendById() {
  let s = TestStops.line(ids: ["c", "a", "b", "d"])   // 東西に並ぶ 4 点
  let out = DayOrdering.orderForReservations(stops: s, base: nil, startMinutes: 540, constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], meals: TestStops.japanMeals, travel: .default, lockedOrder: ["b", "a"])
  #expect(out.map(\.id) == ["b", "a", "c", "d"])
}

@Test func eveningStopsAreNotScheduledBeforeSixteen() {
  var c: [String: WishlistStopConstraint] = [:]
  c["tower"] = WishlistStopConstraint(priority: .normal, fixedDay: nil, fixedTime: nil, fixedTimeMinutes: nil, timeOfDay: .evening, isReservation: false, stayMinutes: nil)
  let s = TestStops.line(ids: ["tower", "park", "shrine"])
  let out = DayOrdering.orderForReservations(stops: s, base: nil, startMinutes: 540, constraints: c, earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], meals: TestStops.japanMeals, travel: .default, lockedOrder: [])
  #expect(out.last?.id == "tower")
}
```

- [ ] **Step 2: 失敗を確認**

- [ ] **Step 3: 実装**

- `fitVisitToWindow`(`:1258`)と `distanceToWindow`(`:1279`)を逐語移植。
- `scheduleOrderScore`(`:1301-1386`): 各停留所で `cursor = max(cursor, fixedTime)`、時間帯(evening ≥16:00 / night ≥18:00)、`fitVisitToWindow`、hard 違反(固定時刻遅れは実分、営業 `conflict/closed_day/last_entry_conflict` は **1440 分**)、soft(早訪問/朝 `index×90 + max(0, cursor−12:00)`、夕 `max(0, 16:00−cursor)`、夜 `max(0, 18:00−cursor)`、食事停留所は目的地の食事窓までの距離)、移動分(`routeComparison` の推奨分 + buffer)、経過分、`idKey`(id を `\u{0}` 連結)。
- `orderForReservations`(`:1387-1505`): ロック順 → 制約が何も無ければ地理順(`RouteOrdering.optimize`)→ ≤7 は全順列、>7 は 3 種の種(地理 / 緊急度 / 貪欲挿入)から `min(6, n)` パスの再配置。比較は `ScheduleOrderScore <`。
- `routeComparison`(`:1134-1203`)は Task 11 で使うが、ここで `DayOrdering` から呼ぶため `Builder/Legs.swift` に先に置く(`knownTransferCount`, `endpointAsRouteStop`, `accessMetadataForLeg`, `googleMapsUrlsForLeg`, `routeTravelMinutes`, `clusterDistanceKm` も同ファイル `:1126-1257`)。

- [ ] **Step 4: 緑を確認** — `--filter DayOrderingTests`

- [ ] **Step 5: Commit** — `git commit -m "A day's stops fall into an order that keeps bookings and opening hours"`

---

### Task 11: 日の時計(buildDay)

**Files:**
- Create: `Sources/TripCheckKit/Builder/DayClock.swift`
- Test: `Tests/TripCheckKitTests/Units/DayClockTests.swift`
- 移植元: `lib/trip-builder.ts:1506-1700`(`buildDay`)、`:309-322`(`dayLabel`, `openDayLabel`)

**Interfaces:**
- Consumes: Task 10 の `DayOrdering`, `Legs`, `fitVisitToWindow`; `AirportConstraint`; `Destination`
- Produces: `enum DayClock { static func buildDay(stops: [RouteStop], index: Int, dayCount: Int, locale: PlannerLocale, startBase: TripBase?, endBase: TripBase?, airportConstraints: [AirportConstraint], constraints: [String: WishlistStopConstraint], earlyVisitStopIds: Set<String>, foodStopIds: Set<String>, openingWindows: [String: [VisitWindow]], destination: Destination, requestedStart: String?, startDate: String?, travel: TravelInputs, dayEndTarget: String?, lockedOrder: [String]) -> BuiltPlanDay }`

- [ ] **Step 1: 失敗するテストを書く**

```swift
@Test func dayStartsAtRequestedTimeUnlessArrivalFlightIsLater() {
  let s = TestStops.line(ids: ["a", "b"])
  let jp = Destinations.byId(.japan)
  let d = DayClock.buildDay(stops: s, index: 0, dayCount: 1, locale: .en, startBase: nil, endBase: nil, airportConstraints: [], constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], destination: jp, requestedStart: "08:00", startDate: nil, travel: .default, dayEndTarget: nil, lockedOrder: [])
  #expect(d.startTime == "08:00"); #expect(d.startAdjustedByArrival == false)
  let arrival = AirportConstraint(direction: .arrival, airport: "HND", flightTime: "10:00", cityTime: "12:30", cityTimeDayOffset: 0, airportMinutes: 90, transferMinutes: 60, transferCount: nil, sourceUrl: "", googleMapsUrl: nil)
  let d2 = DayClock.buildDay(stops: s, index: 0, dayCount: 1, locale: .en, startBase: nil, endBase: nil, airportConstraints: [arrival], constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], destination: jp, requestedStart: "09:00", startDate: nil, travel: .default, dayEndTarget: nil, lockedOrder: [])
  #expect(d2.startTime == "12:30"); #expect(d2.startAdjustedByArrival)
}

@Test func deadlineIsMinOfAirportAndCurfewAndOverrunIsCounted() {
  let s = TestStops.line(ids: ["a", "b", "c"], stayMinutes: 180)
  let jp = Destinations.byId(.japan)
  let dep = AirportConstraint(direction: .departure, airport: "HND", flightTime: "20:00", cityTime: "16:00", cityTimeDayOffset: 0, airportMinutes: 180, transferMinutes: 60, transferCount: nil, sourceUrl: "", googleMapsUrl: nil)
  let d = DayClock.buildDay(stops: s, index: 0, dayCount: 1, locale: .en, startBase: nil, endBase: nil, airportConstraints: [dep], constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], destination: jp, requestedStart: "09:00", startDate: nil, travel: .default, dayEndTarget: "21:30", lockedOrder: [])
  #expect(d.deadline == "16:00"); #expect(d.deadlineKind == .airport)
  #expect(d.deadlineOverrunMinutes > 0)
}

@Test func hotelRoundTripClosesTheLoopAndReturnLegHasNoBuffer() {
  let s = TestStops.line(ids: ["a", "b"])
  let base = TripBase(routeStop: TestStops.point(id: "hotel", lat: 35.69, lng: 139.70), query: "Shinjuku")
  let d = DayClock.buildDay(stops: s, index: 0, dayCount: 1, locale: .ja, startBase: base, endBase: base, airportConstraints: [], constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], destination: Destinations.byId(.japan), requestedStart: "09:00", startDate: nil, travel: .default, dayEndTarget: nil, lockedOrder: [])
  #expect(d.hotelOutboundMinutes != nil); #expect(d.hotelInboundMinutes != nil)
  #expect(d.totalMinutes == (d.hotelOutboundMinutes! + 10) + d.stops.reduce(0) { $0 + $1.stop.planningDurationMinutes } + d.legs.reduce(0) { $0 + $1.comparison.options.first { o in o.mode == $1.comparison.recommended }!.minutes + 10 } + d.hotelInboundMinutes!)
}

@Test func themeJoinsUpToThreeAreasOrSaysFreeDay() {
  let d = DayClock.buildDay(stops: [], index: 0, dayCount: 1, locale: .ja, startBase: nil, endBase: nil, airportConstraints: [], constraints: [:], earlyVisitStopIds: [], foodStopIds: [], openingWindows: [:], destination: Destinations.byId(.japan), requestedStart: nil, startDate: nil, travel: .default, dayEndTarget: nil, lockedOrder: [])
  #expect(d.theme == "自由に使える日")
}
```

- [ ] **Step 2: 失敗を確認**

- [ ] **Step 3: 実装** — `:1506-1700` を逐語移植。要点: `start = max(要求開始(既定 09:00), 到着準備完了)`(実フライトのみ)、ホテル出発レグ `+minutes +buffer`、各停留所 `cursor = max(cursor, fixedTime)` → 時間帯 → `fitVisitToWindow` → `+滞在` → `+区間推奨分 +buffer`、帰着レグはバッファなし、`deadline = min(空港締切, 門限)`、`deadlinePreviousDay`、`reservationLateMinutes`、`openingConflictCount`、`reservationConflictCount`、`theme`(最大 3 エリア `·` 連結 / ja「自由に使える日」/ en は TS の文言)、`googleMapsUrl`、`date = startDate + index`(`CalendarDate.adding`)、`label`(`dayLabel` `:309`)。

- [ ] **Step 4: 緑を確認** — `--filter DayClockTests`

- [ ] **Step 5: Commit** — `git commit -m "Each day gets a clock: start, stays, legs, buffers and a deadline"`

---

### Task 12: クラスタリングと日割りの前処理(固定日・営業日・間引き・日アンカー・予算トリム)

**Files:**
- Create: `Sources/TripCheckKit/Builder/Clustering.swift`
- Test: `Tests/TripCheckKitTests/Units/ClusteringTests.swift`
- 移植元: `lib/trip-builder.ts:949-1125`(`clusterStops`, `applyFixedDays`, `hasUsableOpeningWindow`, `applyOpeningDays`, `activityDayOpeningWindows`)、`buildTripFromWishlist` 内の間引き・日アンカー分散・日予算トリム(`:1938-2300` の該当ブロック。`trimToDayBudget` 相当の内部関数名は TS を確認して同名にする)

**Interfaces:**
- Produces: `enum Clustering { static func clusterStops(_ stops: [RouteStop], requestedDays: Int) -> [[RouteStop]]; static func applyFixedDays(_ clusters:, constraints:) -> [[RouteStop]]; static func applyOpeningDays(_ clusters:, constraints:, availability: [String: [Int: [VisitWindow]]], capacity: Int) -> (clusters: [[RouteStop]], unavailable: [RouteStop]); static func activityDayOpeningWindows(_ availability:, calendarDayOffset: Int) -> [String: [VisitWindow]]; static func spreadDayAnchors(_ clusters:, constraints:) -> [[RouteStop]]; static func trimToDayBudget(_ clusters:, constraints:, budget: Int) -> (clusters: [[RouteStop]], deferred: [RouteStop]); static func trimToPaceCapacity(_ clusters:, constraints:, capacity: Int) -> (clusters:, deferred:) }`

- [ ] **Step 1: 失敗するテストを書く**

```swift
@Test func clustersSeedWestmostThenFarthestPointWithCapacityCeil() {
  let stops = TestStops.twoClusters()   // 東京駅周辺 4 点 + 吉祥寺周辺 4 点
  let c = Clustering.clusterStops(stops, requestedDays: 2)
  #expect(c.count == 2)
  #expect(c.map(\.count) == [4, 4])
  #expect(c[0].first?.id == stops.min { $0.longitude < $1.longitude }?.id)   // 種 = 最西端
}

@Test func fixedDaysMoveOnlyPinnedStops() {
  let stops = TestStops.line(ids: ["a", "b", "c", "d"])
  var cons: [String: WishlistStopConstraint] = [:]
  cons["d"] = WishlistStopConstraint(priority: .normal, fixedDay: 1, fixedTime: nil, fixedTimeMinutes: nil, timeOfDay: nil, isReservation: false, stayMinutes: nil)
  let c = Clustering.applyFixedDays(Clustering.clusterStops(stops, requestedDays: 2), constraints: cons)
  #expect(c[0].contains { $0.id == "d" })
  #expect(c.flatMap { $0 }.count == 4)
}

@Test func stopsClosedAllDaysBecomeUnavailableOptionalOnesDeferred() {
  let stops = TestStops.line(ids: ["a", "b"])
  let avail: [String: [Int: [VisitWindow]]] = ["b": [0: [], 1: []]]   // 全日 closed_day
  let r = Clustering.applyOpeningDays([[stops[0]], [stops[1]]], constraints: [:], availability: avail, capacity: 4)
  #expect(r.unavailable.map(\.id) == ["b"])
}

@Test func dayBudgetTrimDropsUnpinnedOptionalsOnly() {
  let stops = TestStops.line(ids: ["a", "b", "c", "d"], stayMinutes: 200)   // 4×200 + 3×35 = 905 > 570
  var cons: [String: WishlistStopConstraint] = [:]
  cons["c"] = WishlistStopConstraint(priority: .optional, fixedDay: nil, fixedTime: nil, fixedTimeMinutes: nil, timeOfDay: nil, isReservation: false, stayMinutes: nil)
  cons["d"] = WishlistStopConstraint(priority: .optional, fixedDay: 1, fixedTime: nil, fixedTimeMinutes: nil, timeOfDay: nil, isReservation: false, stayMinutes: nil)
  let r = Clustering.trimToDayBudget([stops], constraints: cons, budget: 570)
  #expect(r.deferred.map(\.id) == ["c"])          // 日固定の任意 d は残して正直に超過表示
  #expect(r.clusters[0].map(\.id) == ["a", "b", "d"])
}

@Test func themeParkAnchorsStartTheDayAndPushNeighboursOut() {
  let stops = TestStops.line(ids: ["disney", "a", "b"], stayMinutes: 90)
  var cons: [String: WishlistStopConstraint] = [:]
  cons["disney"] = WishlistStopConstraint(priority: .normal, fixedDay: nil, fixedTime: nil, fixedTimeMinutes: nil, timeOfDay: nil, isReservation: false, stayMinutes: 540)
  let r = Clustering.spreadDayAnchors([stops], constraints: cons)
  #expect(r[0].first?.id == "disney")
}
```

- [ ] **Step 2: 失敗を確認**

- [ ] **Step 3: 実装** — `:949-1125` と `buildTripFromWishlist` の前処理ブロックを逐語移植。決定的タイブレーク(元クラスタ優先→最小クラスタ→距離→id)を崩さない。`trimToDayBudget` は `Σ滞在 + (n−1)×EngineConstants.trimLegMinutes > budget` のあいだピン無しの任意を**末尾から**外す。

- [ ] **Step 4: 緑を確認** — `--filter ClusteringTests`

- [ ] **Step 5: Commit** — `git commit -m "Places group into days before anyone looks at a clock"`

---

### Task 13: 日割りの局所探索(辞書式 11 項、600 評価)

**Files:**
- Create: `Sources/TripCheckKit/Builder/DayAssignment.swift`
- Test: `Tests/TripCheckKitTests/Units/DayAssignmentTests.swift`
- 移植元: `lib/trip-builder.ts:1702-1904`

**Interfaces:**
- Produces: `struct DayAssignmentScore: Comparable { hardViolationCount, hardViolationMagnitude, overrunDayCount, totalOverrunMinutes, emptyDayCount, overloadMinutes, underfillMinutes, travelMinutes, maximumDayMinutes, loadSpreadMinutes: Int; tieBreak: String }`(`<` は項を順に比較、最後は `jsLocaleCompare`= `String.compare(_:locale: Locale(identifier: "en"))`。TS は `localeCompare`)、`struct DayAssignmentLimits { paceCapacity, dayBudgetMinutes }`、`enum DayAssignment { static func score(days: [BuiltPlanDay], clusters: [[RouteStop]], limits:) -> DayAssignmentScore; static func signature(_ clusters:) -> String; static func optimize(initial: [[RouteStop]], constraints:, lockedDayByStop: [String: Int], build: ([RouteStop], Int) -> BuiltPlanDay, limits:) -> [[RouteStop]] }`

- [ ] **Step 1: 失敗するテストを書く**

```swift
@Test func emptyDaysAndUnderfillOutrankTravel() {
  let a = DayAssignmentScore(hardViolationCount: 0, hardViolationMagnitude: 0, overrunDayCount: 0, totalOverrunMinutes: 0, emptyDayCount: 1, overloadMinutes: 0, underfillMinutes: 0, travelMinutes: 0, maximumDayMinutes: 0, loadSpreadMinutes: 0, tieBreak: "")
  let b = DayAssignmentScore(hardViolationCount: 0, hardViolationMagnitude: 0, overrunDayCount: 0, totalOverrunMinutes: 0, emptyDayCount: 0, overloadMinutes: 0, underfillMinutes: 0, travelMinutes: 9999, maximumDayMinutes: 999, loadSpreadMinutes: 999, tieBreak: "")
  #expect(b < a)
}

@Test func searchStopsAtSixHundredEvaluations() {
  var evaluations = 0
  let stops = TestStops.ring(count: 12)
  let clusters = Clustering.clusterStops(stops, requestedDays: 4)
  _ = DayAssignment.optimize(initial: clusters, constraints: [:], lockedDayByStop: [:], build: { c, i in
    evaluations += 1
    return TestStops.buildPlainDay(c, index: i)
  }, limits: .init(paceCapacity: 4, dayBudgetMinutes: 570))
  #expect(evaluations <= EngineConstants.maxDayAssignmentEvaluations + 4)   // +初期評価
}

@Test func lockedDaysNeverMove() {
  let stops = TestStops.line(ids: ["a", "b", "c", "d", "e", "f"])
  let out = DayAssignment.optimize(initial: [[stops[0], stops[1]], [stops[2], stops[3]], [stops[4], stops[5]]], constraints: [:], lockedDayByStop: ["f": 0], build: { c, i in TestStops.buildPlainDay(c, index: i) }, limits: .init(paceCapacity: 4, dayBudgetMinutes: 570))
  #expect(out[0].contains { $0.id == "f" })
}

@Test func swissFourDaySampleLeavesNoEmptyDay() {
  let plan = TripBuilder.build(TestStops.swissRequest(days: 4))   // Task 15 完了後に通る。ここでは赤のまま残してよい
  #expect(plan.days.allSatisfy { !$0.stops.isEmpty })
}
```

- [ ] **Step 2: 失敗を確認**

- [ ] **Step 3: 実装** — `:1719-1904`。`scoreDayAssignment` の各項(`overloadMinutes` = 件数超過 ×240 + 予算超過、`underfillMinutes` = 不足の二乗和、床 `min(240, 45% of budget)`、`emptyDayCount` は件数 ≥ 日数のときだけ)。`optimize` は全単一移動 + 全クロス日スワップを各パスで評価、署名でメモ化、**移動先の定員ガードは置かない**。

- [ ] **Step 4: 緑を確認** — `--filter DayAssignmentTests`(`swissFourDaySample…` は Task 15 で緑になる)

- [ ] **Step 5: Commit** — `git commit -m "Days trade stops until none is empty and none is overloaded"`

---

### Task 14: 拠点(ホテル)・空港境界・食事枠・混雑見込み

**Files:**
- Create: `Sources/TripCheckKit/Builder/{Bases,Airports,MealSlots,CrowdOutlook}.swift`
- Test: `Tests/TripCheckKitTests/Units/{BasesTests,AirportsTests,MealSlotsTests}.swift`
- 移植元: `lib/trip-builder.ts:375-459`(`buildCrowdOutlook`)、`:460-583`(`foodIdeasForArea`, `buildFoodRecommendationSlots`)、`:584-812`(`routeDistanceFromBase`, `optimizeFromBase`, `buildBase`, `resolveTripBase`, `stableEntryId`, `resolveUserFoodReservation`, `recommendBases`, `meanPoint`, `geoDistanceKm`, `balancedGeoCenter`, `maximumPairDistanceKm`, `hotelRouteContextForDraft`, `hotelAnchorForDraft`)、`:813-948`(`airportStop`, `measuredAirportTransferMinutes`, `measuredAirportTransferCount`, `buildAirportConstraints`)、`baseDefinitions`(東京 5 拠点 `:302-308` 付近)

**Interfaces:**
- Produces: `enum Bases { static let tokyoDefinitions: [BaseDefinition]; static func resolveTripBase(query:, resolved: ResolvedStop?, locale:) -> TripBase?; static func recommendBases(clusters:, destination:, locale:) -> [BaseRecommendation]; static func balancedGeoCenter(_ points: [GeoPoint]) -> GeoPoint?; static func hotelRouteContext(for plan: BuiltTripPlan) -> HotelRouteContext?; static func hotelAnchor(for plan:) -> (GeoPoint, area: String)? }`、`enum Airports { static func buildAirportConstraints(context:, destination:, base: TripBase?, travel:) -> [AirportConstraint] }`、`enum MealSlots { static func build(days: [BuiltPlanDay], destination:, mealPlan:, locale:) -> [FoodRecommendationSlot] }`、`enum CrowdOutlooks { static func build(stop:, arrival:, date:) -> CrowdOutlook? }`、`func resolveUserFoodReservation(_ place: ParsedWishlistPlace, ...) -> RouteStop?`(`user-food-*`、75 分、`isAnchor true`)

- [ ] **Step 1: 失敗するテストを書く**

```swift
@Test func weiszfeldIsNotDraggedByOneFarTrip() {
  let near = (0..<5).map { GeoPoint(latitude: 35.68 + Double($0) * 0.001, longitude: 139.76) }
  let far = GeoPoint(latitude: 36.5, longitude: 140.5)
  let c = Bases.balancedGeoCenter(near + [far])!
  #expect(abs(c.latitude - 35.682) < 0.01)
}

@Test func tokyoBaseDefinitionsAreFive() { #expect(Bases.tokyoDefinitions.count == 5) }

@Test func dinnerSlotDisappearsWhenDeadlineIsBeforeDinnerStart() {
  let day = TestStops.buildPlainDay(TestStops.line(ids: ["a", "b"]), index: 0, deadline: "16:00")
  let slots = MealSlots.build(days: [day], destination: Destinations.byId(.japan), mealPlan: .all, locale: .ja)
  #expect(slots.contains { $0.kind == .lunch })
  #expect(!slots.contains { $0.kind == .dinner })
}

@Test func lunchSlotAnchorsOnLastStopReachedBeforeLunchEnd() {
  let day = TestStops.buildPlainDay(TestStops.line(ids: ["a", "b", "c"], stayMinutes: 90), index: 0)   // 09:00 開始
  let lunch = MealSlots.build(days: [day], destination: Destinations.byId(.japan), mealPlan: .all, locale: .ja).first { $0.kind == .lunch }!
  #expect(lunch.displayTime >= "11:00" && lunch.displayTime <= "14:30")
  #expect(lunch.id == "food-0-lunch")
}

@Test func midnightArrivalPushesActivityDayToNextDate() {
  var ctx = PlannerContext(); ctx.arrivalAirport = "HND"; ctx.arrivalTime = "23:30"; ctx.flightKind = .international; ctx.tripStartDate = "2026-10-13"
  let c = Airports.buildAirportConstraints(context: ctx, destination: Destinations.byId(.japan), base: nil, travel: .default)
  #expect(c[0].cityTimeDayOffset == 1)
  #expect(c[0].cityTime == "02:00")
}
```

- [ ] **Step 2: 失敗を確認**

- [ ] **Step 3: 実装** — 各関数を逐語移植。`balancedGeoCenter` は Weiszfeld ≤48 反復・ε 0.001km。`recommendBases` は各クラスタの閉路距離合計で上位 3、全国モードは `area` ごとに動的拠点。`buildFoodRecommendationSlots`: 昼は `firstArrival > lunch.end || lastDeparture < lunch.start` ならなし、夕は `deadline < dinner.start` ならなし / 締切が無いときだけ `lastDeparture < dinner.start − 120` / 経路が夕食窓全体を覆うならなし。`positionAtMealTime` で検索中心。空港: 到着 `cityBoundary = 到着 + 処理 + 移送`、出発 `= 出発 − 処理 − 移送`、日跨ぎ `cityDayOffset ±1`、実測移送(`liveTransitMinutes` の `airport→base` キー)優先。

- [ ] **Step 4: 緑を確認**

- [ ] **Step 5: Commit** — `git commit -m "Hotels, airports and meal slots take their places around the day"`

---

### Task 15: TripBuilder.build — 入口の統合(wishlist / existing_itinerary、国の投票、解決、パイプライン全体)

**Files:**
- Create: `Sources/TripCheckKit/Builder/{DestinationVote,TripBuilder}.swift`, `Tests/TripCheckKitTests/Support/TestStops.swift`(`swissRequest(days:)` を含む完成形)
- Test: `Tests/TripCheckKitTests/Invariants/TripBuilderInvariantTests.swift`
- 移植元: `lib/trip-builder.ts:323-348`(`constraintFromParsedPlace`, `mergeConstraints`)、`:1905-1937`(`resolveContextDestination`)、`:1938-2300`(`buildTripFromWishlist`)。TS テスト: `tests/trip-builder.test.ts`(56)、`tests/itinerary-domain.test.ts`、`tests/mandatory-edge-cases.test.ts`

**Interfaces:**
- Produces: `TripRequest`, `TripBuilder.build(_:) -> BuiltTripPlan`, `DestinationVote.resolve(context:, stops:) -> Destination`(明示 > 国コード投票 > 最小外接箱、未対応コードがあれば worldwide、過半数でなければ worldwide)

- [ ] **Step 1: 失敗するテストを書く**(`tests/trip-builder.test.ts` の名前付き不変条件を移す。代表 8 件)

```swift
@Test func swissSampleFillsFourDaysWithNoEmptyDay() {
  let plan = TripBuilder.build(TestStops.swissRequest(days: 4))
  #expect(plan.days.count == 4)
  #expect(plan.days.allSatisfy { !$0.stops.isEmpty })
  #expect(plan.destination == .switzerland)
  #expect(plan.scheduledStopCount == 8)
}

@Test func intercityLegsDoNotAllBecomeTaxis() {
  let plan = TripBuilder.build(TestStops.swissRequest(days: 4))
  let legs = plan.days.flatMap(\.legs)
  #expect(legs.contains { $0.comparison.recommended == .transit })
}

@Test func mountainRailwayLegsNeverRecommendWalkOrTaxi() {
  let plan = TripBuilder.build(TestStops.swissRequest(days: 4))
  for leg in plan.days.flatMap(\.legs) where leg.to.id.contains("jungfrau") || leg.to.id.contains("gornergrat") {
    #expect(leg.comparison.recommended == .transit)
  }
}

@Test func existingItineraryModeKeepsPastedOrderAsHardConstraint() {
  let raw = "Day 1\nUeno Park\nSenso-ji\nTokyo Skytree"
  var ctx = PlannerContext(); ctx.resolvedStops = TestStops.tokyoResolved(["Ueno Park", "Senso-ji", "Tokyo Skytree"])
  let plan = TripBuilder.build(TripRequest(raw: raw, days: 1, pace: .balanced, locale: .en, context: ctx))
  #expect(plan.inputMode == .existing_itinerary)
  #expect(plan.days[0].stops.map(\.stop.name) == ["Ueno Park", "Senso-ji", "Tokyo Skytree"])
}

@Test func autoDestinationNeedsStrictMajorityElseWorldwide() {
  var ctx = PlannerContext()
  ctx.resolvedStops = TestStops.mixed(["JP", "JP", "CH", "CH"])
  let plan = TripBuilder.build(TripRequest(raw: TestStops.rawFor(ctx), days: 2, pace: .balanced, locale: .en, context: ctx))
  #expect(plan.destination == .worldwide)
  ctx.resolvedStops = TestStops.mixed(["JP", "JP", "JP", "CH"])
  #expect(TripBuilder.build(TripRequest(raw: TestStops.rawFor(ctx), days: 2, pace: .balanced, locale: .en, context: ctx)).destination == .japan)
}

@Test func tripDateDoesNotInheritDeviceTimeZone() {
  // Auckland の 2026-10-13 と LA の 2026-10-13 は同じ暦日として扱う(端末 TZ を見ない)
  let a = TripBuilder.build(TestStops.swissRequest(days: 2, startDate: "2026-10-13"))
  #expect(a.days[0].date == "2026-10-13"); #expect(a.days[1].date == "2026-10-14")
}

@Test func thirteenthStopIsRefusedNotSilentlyDropped() {
  // ビルダー自身は 13 件を受け取らない前提(UI が止める)。受け取った場合は recognizedStopCount に正直に出す
  let plan = TripBuilder.build(TestStops.ringRequest(count: 13, days: 3))
  #expect(plan.recognizedStopCount == 13)
}

@Test func sameInputSameOutputAHundredTimes() throws {
  let enc = JSONEncoder(); enc.outputFormatting = [.sortedKeys]
  let first = try enc.encode(TripBuilder.build(TestStops.swissRequest(days: 4)))
  for _ in 0..<100 { #expect(try enc.encode(TripBuilder.build(TestStops.swissRequest(days: 4))) == first) }
}
```

- [ ] **Step 2: 失敗を確認**

- [ ] **Step 3: 実装** — `buildTripFromWishlist`(`:1938-2300`)を逐語移植。順序: モード検出 → `WishlistParser.parse` → 制約(`constraintFromParsedPlace` + `mergeConstraints`、`durationOverrides` / `lastEntryTimes` / `dayOverrides` / `excludedStopIds` を反映)→ 解決(`resolvedStops` → `Catalog.resolveKnownStops` → 未知は `unknownEntries`)→ `DestinationVote` → 拠点(`Bases.resolveTripBase`、`nightBases`)→ 空港 → クラスタ(Task 12 の前処理を**最適化の前後で 2 回**)→ `DayAssignment.optimize`(`build` クロージャは `DayClock.buildDay`)→ 最終日の空港超過で末尾の任意を外して再構築 → 食事枠 → `baseRecommendations` → `BuiltTripPlan`。`TestStops.swissRequest` は `SwissSample.resolvedStops` と `Destinations.byId(.switzerland).sample` の ja/en 文字列から作る。

- [ ] **Step 4: 緑を確認** — `--filter "TripBuilderInvariantTests|DayAssignmentTests"`。`tests/trip-builder.test.ts` の残り(56 本)を全部移し、緑にする。TS の期待値と食い違ったら **Swift 側を直す**(テストを変えない)。

- [ ] **Step 5: Commit** — `git commit -m "A wishlist becomes a built trip, the same trip the web builds"`

---
### Task 16: Feasibility — Evidence・重要事実スナップショット・5 状態の導出

**Files:**
- Create: `Sources/TripCheckKit/Feasibility/{Evidence,FeasibilityTypes,FNV1a,EvidenceSnapshot,FeasibilityResult}.swift`
- Test: `Tests/TripCheckKitTests/Units/FeasibilityTests.swift`
- 移植元: `lib/feasibility-result.ts` 全 907 行(型 `:5-206`、`stableStringify`/`hashEvidenceFacts`/`statusCounts`/`fact` `:207-255`、`createPlannerEvidenceSnapshot` `:256-678`、`collectConflicts` `:679-754`、`collectAssumptions` `:755-776`、`deriveFeasibilityResult` `:777-891`、`createPlanSnapshot` `:892-`)。TS テスト: `tests/feasibility-result.test.ts`(20)

**Interfaces:**
- Consumes: `BuiltTripPlan`, `TripFitAssessment`(Task 17。本タスクでは `TripFitAssessment` の型だけ先に `Scenarios/TripFitTypes.swift` に置く)
- Produces: 型リファレンスの Feasibility 節 + `Conflict { code, affectedItems: [String], dayIndex: Int?, overrunMinutes: Int?, evidenceIds: [String] }`, `AttentionCode: String { LOW_BUFFER, UNVERIFIED_FACTS, WALKING_LIMIT_EXCEEDED, TRANSFER_LIMIT_EXCEEDED, TRANSIT_NON_CONVERGED }`, `Attention`, `AssumptionCode`(14)、`Assumption { code, count, evidenceIds }`, `FeasibilityUnknownCause: String { UNRESOLVED_PLACE, COMPUTATION_LIMIT }`, `CriticalFactCounts`, `FeasibilityResult`(TS と同名フィールド)、`PlanSnapshot`, `RouteFactEvidence`, `EvidenceSnapshotOptions`(golden の `evidence` をデコード。`userDurationStopIds: [String]?`、`dayStartTimes: IntKeyedDictionary<String>?` など)、`ENGINE_VERSION = "tripcheck-feasibility-v0.1"`、`FNV1a.hash32(_ string:) -> String`(TS `hashEvidenceFacts` と同じ出力形式。TS の実装 `:215-224` を見て 16 進桁数・接頭辞を合わせる)、`Feasibility.snapshot(plan:options:)`, `Feasibility.derive(plan:fit:evidence:)`, `Feasibility.planSnapshot(plan:result:seed:createdAt:)`

- [ ] **Step 1: 失敗するテストを書く**

```swift
@Test func stateDerivationFollowsThePriorityLadder() {
  let plan = TripBuilder.build(TestStops.swissRequest(days: 4))
  let fit = TripScenarios.assessTripFit(TestStops.swissRequest(days: 4), plan: plan, options: .init())
  var opts = EvidenceSnapshotOptions(dateWasProvided: true, baseWasProvided: false, dayEndWasProvided: false)
  let r1 = Feasibility.derive(plan: plan, fit: fit, evidence: Feasibility.snapshot(plan: plan, options: opts))
  #expect(r1.state == .FEASIBLE_IF_ASSUMPTIONS || r1.state == .PROVISIONAL_FEASIBLE)   // 営業時間 unknown があれば IF_ASSUMPTIONS
  opts.solverTimedOut = true
  let r2 = Feasibility.derive(plan: plan, fit: fit, evidence: Feasibility.snapshot(plan: plan, options: opts))
  #expect(r2.state == .UNKNOWN); #expect(r2.unknownCause == .COMPUTATION_LIMIT)
}

@Test func openingConflictsNeedVerifiedEvidenceToBeHard() {
  // 週次パターン(推定)だけの営業衝突は provisional 止まり、日付付き(verified)なら hard
  let (plan, fit) = TestStops.tokyoClosedOnFixedDay()
  let estimatedOnly = Feasibility.derive(plan: plan, fit: fit, evidence: Feasibility.snapshot(plan: plan, options: .init(dateWasProvided: true, baseWasProvided: false, dayEndWasProvided: true)))
  #expect(!estimatedOnly.conflicts.contains { $0.code == .CLOSED_ON_FIXED_DAY })
  var opts = EvidenceSnapshotOptions(dateWasProvided: true, baseWasProvided: false, dayEndWasProvided: true)
  opts.openingEvidenceByStop = [plan.days[0].stops[0].stop.id: .init(fetchedAt: "2026-08-09T00:00:00.000Z", providerRef: nil, dateSpecific: true, dateSpecificDates: ["2026-10-13"])]
  let verified = Feasibility.derive(plan: plan, fit: fit, evidence: Feasibility.snapshot(plan: plan, options: opts))
  #expect(verified.conflicts.contains { $0.code == .CLOSED_ON_FIXED_DAY })
  #expect(verified.state == .INFEASIBLE_HARD_CONFLICT)
}

@Test func conflictWeightsOrderThePrimaryConflict() {
  #expect(ConflictCode.AIRPORT_CUTOFF.weight == 7); #expect(ConflictCode.FIXED_BOOKING_LATE.weight == 6)
  #expect(ConflictCode.CLOSED_ON_FIXED_DAY.weight == 5); #expect(ConflictCode.LAST_ENTRY_CONFLICT.weight == 5)
  #expect(ConflictCode.OPENING_HOURS_CONFLICT.weight == 4); #expect(ConflictCode.PLACE_UNAVAILABLE.weight == 3)
  #expect(ConflictCode.DAY_END_OVERRUN.weight == 2); #expect(ConflictCode.DAY_CAPACITY.weight == 1)
}

@Test func attentionsAreExclusiveAndOrderedAndSilentWhenConflicting() {
  let (plan, fit) = TestStops.tokyoLowBuffer()
  let r = Feasibility.derive(plan: plan, fit: fit, evidence: Feasibility.snapshot(plan: plan, options: .init(dateWasProvided: true, baseWasProvided: false, dayEndWasProvided: true)))
  #expect(r.primaryAttention?.code == .LOW_BUFFER || r.primaryAttention?.code == .UNVERIFIED_FACTS)
  #expect(r.conflicts.isEmpty || r.primaryAttention == nil)
}

@Test func snapshotHashIsStableAcrossKeyOrder() {
  let plan = TripBuilder.build(TestStops.swissRequest(days: 4))
  let a = Feasibility.snapshot(plan: plan, options: .init(dateWasProvided: true, baseWasProvided: false, dayEndWasProvided: false, capturedAt: "2026-08-09T00:00:00.000Z"))
  let b = Feasibility.snapshot(plan: plan, options: .init(dateWasProvided: true, baseWasProvided: false, dayEndWasProvided: false, capturedAt: "2026-08-09T00:00:00.000Z"))
  #expect(a.providerSnapshotHash == b.providerSnapshotHash)
  #expect(a.facts.count == b.facts.count)
}
```

- [ ] **Step 2: 失敗を確認**

- [ ] **Step 3: 実装**

- `Evidence<Value>`: TS `:21-29`。`value: Value?`。
- `EvidenceSnapshot.swift`: `createPlannerEvidenceSnapshot`(`:256-678`)。重要事実 9 種、ID 形式(`hours:{stopId}:{date}`、`route:{day}:{from}:{to}` 等)、経路事実が `verified` になる 6 条件、日付が無ければ乗換事実を作らない、`undatedEstimate`。`stableStringify` は **キーをソートした JSON**(Swift 側は `JSONEncoder` ではなく TS と同じ手書き直列化。数値は JS の `JSON.stringify` と同じ表現 — 整数は `"12"`、小数は最短表現。本エンジンで hash に入るのは文字列・整数・真偽値のみであることを確認し、小数が混ざるなら `String(describing:)` ではなく `"\(Double)"` の最短表現で揃える)。
- `FeasibilityResult.swift`: `collectConflicts`(`:679`、**日付限定の規則**: 営業時間系は `verified`(最終入場は `user_provided` も可)でなければ hard にしない)、`collectAssumptions`、`deriveFeasibilityResult`(`:777`、状態導出の順・注意の排他順・`primaryConflict` は weight 降順→dayIndex→id)。`ConflictCode.weight` を `extension` で定義。
- `FNV1a.swift`: 32-bit FNV-1a、出力形式は TS `:215-224` に合わせる(例: 8 桁小文字 16 進。TS を開いて確認)。

- [ ] **Step 4: 緑を確認** — `--filter FeasibilityTests`。`tests/feasibility-result.test.ts` の 20 本を移す。

- [ ] **Step 5: Commit** — `git commit -m "Every fact carries its evidence and the verdict follows the ladder"`

---

### Task 17: Scenarios — TripFit・最短日数・見直し候補・反実仮想・(日数, 拠点)不動点

**Files:**
- Create: `Sources/TripCheckKit/Scenarios/{TripFitTypes,TripFit,Counterfactuals,ProvisionalTripLength}.swift`
- Test: `Tests/TripCheckKitTests/Invariants/TripScenariosTests.swift`
- 移植元: `lib/trip-scenarios.ts` 全 706 行(`paceCapacity` `:141`、`dayWindow` `:145`、`totalPlanBufferMinutes` `:193`、`evaluateCapacity` `:202`、`suggestedCutCount` `:217`、`cutCandidates` `:227`、`minimumDaysAssumptions` `:278`、`assessTripFit` `:325-429`、`scenarioMetrics` `:430`、`improvementBetween` `:448`、`qualifiesHotelBaseChange` `:464`、`improvesFeasibility` `:477`、`shiftClock` `:486`、`generateTripCounterfactuals` `:498-706`)、`lib/provisional-trip-length.ts`(93 行)。TS テスト: `tests/trip-scenarios.test.ts`(23)、`tests/days-undecided-complete-context.test.ts`(8)、`tests/mandatory-edge-cases.test.ts`(4)

**Interfaces:**
- Produces: `TripFitStatus: String { fits, tight, needs_change, incomplete, timed_out }`, `TripFitLimit: String { airport, curfew }`, `TripFitDay`, `TripCutCandidate`, `TripFitAssessment`, `MinimumDaysAssumptions`, `TripFitSearchOptions { timeout: Duration = EngineConstants.tripFitTimeout, clock: any Clock = ContinuousClock() }`, `TripScenarioMetrics`, `CounterfactualKind: String { CHANGE_DAYS, START_EARLIER, END_LATER, REMOVE_OPTIONAL, CHANGE_BASE, CHANGE_MODE, OPTIMIZE_ORDER }`, `TripCounterfactual`(TS `TripCounterfactualAlternative` と同形。`change` は Optional フィールドの struct)、`LossKind: String { OPTIONAL_STOP, TRANSPORT_TRADEOFF, ORIGINAL_ORDER }`, `TripScenarios.assessTripFit(_:plan:options:)`, `TripScenarios.counterfactuals(_:plan:fit:) -> [TripCounterfactual]`, `TripScenarios.totalPlanBufferMinutes(plan:context:) -> Int`, `TripScenarios.qualifiesHotelBaseChange(before:after:) -> Bool`, `ProvisionalTripLength.resolve(request:, recommendBase: (BuiltTripPlan) -> ResolvedStop?) -> (days: Int, base: ResolvedStop?, rounds: Int)`(≤3 ラウンド)

- [ ] **Step 1: 失敗するテストを書く**

```swift
@Test func onlyTheClockCanMakeADayImpossible() {
  // ペース超過(件数)だけの日は needs_change にならず、時計が入らないときだけ needs_change
  let req = TestStops.ringRequest(count: 6, days: 1, pace: .relaxed, stayMinutes: 30)   // 件数 6 > relaxed 3 だが時間は入る
  let plan = TripBuilder.build(req)
  let fit = TripScenarios.assessTripFit(req, plan: plan, options: .init())
  #expect(fit.status == .fits || fit.status == .tight)
}

@Test func minimumDaysSearchStopsAtTheFirstFittingCount() {
  let req = TestStops.swissRequest(days: 2)
  let plan = TripBuilder.build(req)
  let fit = TripScenarios.assessTripFit(req, plan: plan, options: .init())
  #expect((fit.minimumDays ?? 0) >= 2)
  #expect(fit.spareDays == nil || fit.spareDays! >= 0)
  #expect(fit.additionalDaysNeeded == max(0, (fit.minimumDays ?? 2) - 2))
}

@Test func timeoutYieldsNullMinimumNotAPartialAnswer() {
  let req = TestStops.ringRequest(count: 12, days: 2)
  let plan = TripBuilder.build(req)
  let fit = TripScenarios.assessTripFit(req, plan: plan, options: .init(timeout: .zero))
  #expect(fit.status == .timed_out); #expect(fit.minimumDays == nil); #expect(fit.solverTimedOut)
}

@Test func unresolvedInputKeepsStateIncompleteButNamesPartialMinimum() {
  let req = TestStops.swissRequest(days: 4, extraUnresolvedLines: ["Somewhere Nobody Knows"])
  let plan = TripBuilder.build(req)
  let fit = TripScenarios.assessTripFit(req, plan: plan, options: .init())
  #expect(fit.status == .incomplete); #expect(fit.partialMinimumDays != nil); #expect(fit.minimumDays == nil)
}

@Test func cutCandidatesExcludeMustBookedAndFixedTime() {
  let (req, plan) = TestStops.overloadedDay()   // 1 日に 6 件、うち 1 件 must・1 件 予約・1 件 optional
  let fit = TripScenarios.assessTripFit(req, plan: plan, options: .init())
  #expect(!fit.cutCandidates.contains { $0.priority == .must })
  #expect(fit.cutCandidates.first?.priority == .optional)
  #expect(fit.cutCandidates.count <= EngineConstants.cutCandidateLimit)
}

@Test func counterfactualsAreRealRebuildsAndCappedAtThree() {
  let (req, plan) = TestStops.overloadedDay()
  let fit = TripScenarios.assessTripFit(req, plan: plan, options: .init())
  let alts = TripScenarios.counterfactuals(req, plan: plan, fit: fit)
  #expect(alts.count <= 3)
  #expect(alts.contains { $0.kind == .CHANGE_DAYS })
  for a in alts { #expect(a.improvement.hardConflictsRemoved > 0 || a.improvement.overrunMinutesReduced > 0 || (a.improvement.slackMinutesGained ?? 0) > 0 || a.improvement.travelMinutesReduced > 0) }
}

@Test func hotelChangeQualifiesOnlyWithRealImprovement() {
  let base = TripScenarioMetrics(hardConflictCount: 0, overrunMinutes: 0, minimumSlackMinutes: 60, scheduledStopCount: 8, dayCount: 4, travelMinutes: 400)
  #expect(TripScenarios.qualifiesHotelBaseChange(before: base, after: .init(hardConflictCount: 0, overrunMinutes: 0, minimumSlackMinutes: 60, scheduledStopCount: 8, dayCount: 4, travelMinutes: 340)))   // ≥60 分
  #expect(TripScenarios.qualifiesHotelBaseChange(before: base, after: .init(hardConflictCount: 0, overrunMinutes: 0, minimumSlackMinutes: 60, scheduledStopCount: 8, dayCount: 4, travelMinutes: 340)) == true)
  #expect(TripScenarios.qualifiesHotelBaseChange(before: base, after: .init(hardConflictCount: 0, overrunMinutes: 0, minimumSlackMinutes: 60, scheduledStopCount: 8, dayCount: 4, travelMinutes: 370)) == false)   // 30 分 = 7.5% は不足
}

@Test func daysUndecidedFixedPointAgreesWithItself() {
  let req = TestStops.swissRequest(days: 1)   // 未定扱いで探索
  let r = ProvisionalTripLength.resolve(request: req, recommendBase: { plan in TestStops.asResolved(plan.baseRecommendations.first?.base) })
  #expect(r.rounds <= 3)
  var ctx = req.context; ctx.resolvedBase = r.base
  let plan = TripBuilder.build(TripRequest(raw: req.raw, days: r.days, pace: req.pace, locale: req.locale, context: ctx))
  let fit = TripScenarios.assessTripFit(TripRequest(raw: req.raw, days: r.days, pace: req.pace, locale: req.locale, context: ctx), plan: plan, options: .init())
  #expect(fit.minimumDays == r.days)   // 提示日数 = 計画の日数
}
```

- [ ] **Step 2: 失敗を確認**

- [ ] **Step 3: 実装** — `trip-scenarios.ts` を逐語移植。`dayWindow`: `availableMinutes = max(0, min(通常終了(既定 22:00), 締切) − 開始)`。状態 `timed_out > incomplete > needs_change > tight(余裕 0–59) > fits`。最短日数探索は `minimumPinnedDay` 〜 `min(14, max(要求, 14))`、各候補で `TripBuilder.build` を実行し最初に `fitsAllKnownStops`。タイムアウトは `options.clock.now` で測る(`ContinuousClock`)。反実仮想 7 種は全て実再構築、`improvesFeasibility`(衝突↓→超過↓→最小余裕↑→移動↓)、上位 3 に最小完全修復と OPTIMIZE_ORDER を強制挿入。`ProvisionalTripLength`: `PROVISIONAL_TRIP_LENGTH_ROUNDS = 3`。

- [ ] **Step 4: 緑を確認** — `--filter TripScenariosTests`。`tests/trip-scenarios.test.ts` / `days-undecided-complete-context.test.ts` / `mandatory-edge-cases.test.ts` を移す。

- [ ] **Step 5: Commit** — `git commit -m "The trip says how many days it really needs and what could give"`

---

### Task 18: G1 — golden 500 の照合と決定性

**Files:**
- Create: `Tests/TripCheckKitTests/Golden/GoldenParityTests.swift`
- 移植元: `tests/golden-feasibility.test.ts:60-200`(`runScenario`, `canonicalRun`, オラクル検査、100 回反復)

**Interfaces:**
- Consumes: `GoldenCorpus`(Task 9)、`TripBuilder`、`TripScenarios`、`Feasibility`

- [ ] **Step 1: テストを書く**

```swift
import Testing
@testable import TripCheckKit

struct GoldenRun { let plan: BuiltTripPlan; let fit: TripFitAssessment; let evidence: PlannerEvidenceSnapshot; let result: FeasibilityResult }

func runGolden(_ s: GoldenScenario) -> GoldenRun {
  let req = TripRequest(raw: s.trip.raw, days: s.trip.days, pace: s.trip.pace, locale: s.trip.locale, context: s.trip.context)
  let plan = TripBuilder.build(req)
  let fit = TripScenarios.assessTripFit(req, plan: plan, options: .init())
  let evidence = Feasibility.snapshot(plan: plan, options: s.evidence)
  return GoldenRun(plan: plan, fit: fit, evidence: evidence, result: Feasibility.derive(plan: plan, fit: fit, evidence: evidence))
}

@Test func corpusShapeIsExactlyTheDeclaredFiveHundred() throws {
  let c = try GoldenCorpus.load()
  #expect(c.scenarios.count == 500)
  #expect(Set(c.scenarios.map(\.id)).count == 500)
  var regions: [String: Int] = [:]; for s in c.scenarios { regions[s.region, default: 0] += 1 }
  #expect(regions == ["Tokyo": 250, "Kyoto-Osaka": 75, "Switzerland": 50, "Europe": 50, "US": 25, "Edge": 50])
  #expect(Set(c.scenarios.map(\.archetype)).sorted() == ["closed_on_fixed_day","day_end_conflict","day_end_repaired","fixed_booking_late","fixed_booking_repaired","last_entry_conflict","last_entry_repaired","open_on_fixed_day","solver_timeout","unknown_hours"])
}

@Test func everyScenarioSatisfiesItsOracle() throws {
  let c = try GoldenCorpus.load()
  var failures: [String] = []
  for s in c.scenarios {
    let run = runGolden(s)
    let o = s.oracle
    let codes = Set(run.result.conflicts.map(\.code.rawValue))
    if !o.expectedStateOneOf.contains(run.result.state.rawValue) { failures.append("\(s.id): state \(run.result.state.rawValue) ∉ \(o.expectedStateOneOf)") }
    if o.hardConflictExpected != !run.result.conflicts.isEmpty { failures.append("\(s.id): hardConflictExpected \(o.hardConflictExpected) but conflicts=\(codes)") }
    for r in o.requiredConflictCodes where !codes.contains(r) { failures.append("\(s.id): missing \(r)") }
    for f in o.forbiddenConflictCodes where codes.contains(f) { failures.append("\(s.id): forbidden \(f)") }
    let scheduled = Set(run.plan.days.flatMap { $0.stops.map(\.stop.id) })
    for m in o.mustScheduledIds where !scheduled.contains(m) { failures.append("\(s.id): must \(m) not scheduled") }
    if let kinds = o.expectedUnknownKinds {
      let unknownKinds = Set(run.evidence.facts.filter { $0.evidence.status == .unknown }.map(\.kind.rawValue))
      for k in kinds where !unknownKinds.contains(k) { failures.append("\(s.id): expected unknown kind \(k)") }
    }
    if let t = o.solverTimedOut, t != run.fit.solverTimedOut { failures.append("\(s.id): solverTimedOut \(run.fit.solverTimedOut) ≠ \(t)") }
  }
  #expect(failures.isEmpty, "\(failures.count) failures:\n" + failures.prefix(40).joined(separator: "\n"))
}

@Test func eachArchetypeIsDeterministicOverAHundredRuns() throws {
  let c = try GoldenCorpus.load()
  let enc = JSONEncoder(); enc.outputFormatting = [.sortedKeys]
  var seen = Set<String>()
  for s in c.scenarios where seen.insert(s.archetype).inserted {
    let first = try enc.encode(runGolden(s).result)
    for _ in 0..<100 { #expect(try enc.encode(runGolden(s).result) == first, s.id) }
  }
}
```

`solver_timeout` アーキタイプは TS 側で `evidence.solverTimedOut: true` を渡してオラクルを満たす(実際に 1 秒を使い切らない)。`EvidenceSnapshotOptions.solverTimedOut` が `Feasibility.snapshot` → `derive` で `UNKNOWN / COMPUTATION_LIMIT` になることを Task 16 で確認済み。

- [ ] **Step 2: 実行** — `apple/tools/verify-kit.sh --filter GoldenParityTests`

- [ ] **Step 3: 赤を潰す** — 失敗一覧を読み、シナリオ id ごとに TS(`node` が無いので**コードリーディング**で)と Swift の分岐を突き合わせる。よくある差: (a) `Int` キー辞書のデコード漏れ、(b) 丸め、(c) タイブレーク、(d) `fitVisitToWindow` の `[]` vs `nil`、(e) 日付限定の hard 昇格規則。**オラクル・フィクスチャ・閾値は変えない**。

- [ ] **Step 4: 緑を確認** — 500/500、決定性 10 アーキタイプ × 100

- [ ] **Step 5: Commit** — `git commit -m "Five hundred golden trips get the same verdict from Swift"`

---

### Task 19: G3 — TS スナップショット照合(Node が取れる場合のみ)

**Files:**
- Create: `scripts/export-golden-snapshots.mjs`(TS 側。`lib/` は変更しない)、`Tests/TripCheckKitTests/Fixtures/ts-snapshots.v1.json`、`Tests/TripCheckKitTests/Golden/SnapshotParityTests.swift`、`docs/superpowers/specs/2026-08-21-tripcheck-swift-v1-design.md` の末尾に「付録 A: G3 の差分記録」

**Interfaces:**
- Consumes: Task 18 の `runGolden`

- [ ] **Step 1: Node を用意する**(無ければこのタスク全体を「未実施」として spec 付録 A に記録し Task 20 へ)

```bash
# scratchpad に Node 22 を展開(ネットワークが要る)
cd "$SCRATCHPAD" && curl -fsSLO https://nodejs.org/dist/v22.18.0/node-v22.18.0-darwin-arm64.tar.gz && tar xzf node-v22.18.0-darwin-arm64.tar.gz
export PATH="$SCRATCHPAD/node-v22.18.0-darwin-arm64/bin:$PATH"; node --version   # v22.18.0
```

- [ ] **Step 2: エクスポータを書く**(`tests/golden-feasibility.test.ts:60-80` の `runScenario` と同じ呼び出し)

```js
// scripts/export-golden-snapshots.mjs — 500 シナリオの plan/fit/evidence/result を JSON に出す(G3 用)
import { readFileSync, writeFileSync } from "node:fs";
const { buildTripFromWishlist } = await import("../lib/trip-builder.ts");
const { assessTripFit } = await import("../lib/trip-scenarios.ts");
const { createPlannerEvidenceSnapshot, deriveFeasibilityResult } = await import("../lib/feasibility-result.ts");
const corpus = JSON.parse(readFileSync(new URL("../tests/fixtures/golden-feasibility.v1.json", import.meta.url), "utf8"));
const out = corpus.scenarios.map((s) => {
  const { raw, days, pace, locale, context } = s.trip;
  const plan = buildTripFromWishlist(raw, days, pace, locale, context);
  const fit = assessTripFit(raw, days, pace, locale, context, plan);
  const evidence = createPlannerEvidenceSnapshot(plan, s.evidence);
  const result = deriveFeasibilityResult(plan, fit, evidence);
  return { id: s.id, plan, fit, evidence, result };
});
writeFileSync(process.argv[2] ?? "ts-snapshots.v1.json", JSON.stringify({ schemaVersion: 1, generatedFrom: "afc6c48", snapshots: out }));
```

Run: `node --experimental-strip-types scripts/export-golden-snapshots.mjs apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/ts-snapshots.v1.json`

- [ ] **Step 3: 照合テストを書く**(フィールド単位の diff。`JSONValue` 木で比較し、差分パスを列挙)

```swift
@Test func swiftOutputMatchesTypeScriptSnapshots() throws {
  guard let url = Bundle.module.url(forResource: "ts-snapshots.v1", withExtension: "json", subdirectory: "Fixtures") else {
    Issue.record("ts-snapshots.v1.json が無い(G3 未実施)。spec 付録 A を参照"); return
  }
  let ts = try JSONDecoder().decode(TSSnapshotFile.self, from: Data(contentsOf: url))
  let corpus = try GoldenCorpus.load()
  let byId = Dictionary(uniqueKeysWithValues: corpus.scenarios.map { ($0.id, $0) })
  let enc = JSONEncoder(); enc.outputFormatting = [.sortedKeys]
  var diffs: [String] = []
  for snap in ts.snapshots {
    let run = runGolden(byId[snap.id]!)
    let mine = try JSONSerialization.jsonObject(with: enc.encode(["plan": AnyEncodable(run.plan), "fit": AnyEncodable(run.fit), "result": AnyEncodable(run.result)]))
    diffs += JSONDiff.paths(expected: snap.tree, actual: mine, ignoring: ["evidence.capturedAt", "result.providerSnapshotHash"]).map { "\(snap.id): \($0)" }
  }
  #expect(diffs.isEmpty, "\(diffs.count) field diffs:\n" + diffs.prefix(60).joined(separator: "\n"))
}
```

`JSONDiff.paths` は再帰で `a.b[2].c` 形式のパスを返す(`Support/JSONDiff.swift`)。`Double` は `abs(a-b) < 1e-9` で同一扱い。

- [ ] **Step 4: 差分を潰す or 記録する** — 差分ゼロになるまで Swift を直す。直せない/直さない差(例: TS 側のバグを Swift で再現しないと決めた)は spec 付録 A に「シナリオ id / パス / TS 値 / Swift 値 / 理由」で記録し、テストの `ignoring` に**そのパスだけ**を足す。

- [ ] **Step 5: Commit** — `git commit -m "The Swift engine and the web engine agree field by field on five hundred trips"`

---

### Task 20: 編集ガード・Undo 台帳・PlannerEditState

**Files:**
- Create: `Sources/TripCheckKit/Edits/{PlannerEditState,PlannerHistory,HardEdits}.swift`
- Test: `Tests/TripCheckKitTests/Invariants/GuardedEditsTests.swift`, `Tests/TripCheckKitTests/Units/PlannerHistoryTests.swift`
- 移植元: `lib/planner-app-state.ts:190-220`(`addCalendarDays`, `clampTripDays`, `builtPlanTravelMinutes`)、`:247-456`(`PlannerHardEditConflict`, `HardConstraintFact`, `dayDeadlinePosition`, `hardConstraintSnapshot`, `plannerHardEditConflicts`, `evaluatePlannerHardEdit`, `clockToMinutes`, `clockRangeContainsVisit`)、`:457-540`(`PlannerEditState`, `PLANNER_UNDO_LIMIT`, `emptyPlannerEditState`, `attachPlannerBaseToHistory`)、`:64-111`(`upsertResolutionOverride`, `manualStopFromResolutionOverride`, `withManualResolutionOverrides`)、`lib/planner-history.ts`(151 行)。TS テスト: `tests/planner-guarded-edits.test.ts`(12)、`tests/planner-history.test.ts`

**Interfaces:**
- Produces: `PlannerEditState`(16 フィールド、`static let empty`)、`ResolutionOverride: Codable { case provider(inputIndex:, providerRef:), manual(inputIndex:, name:, address:, latitude:, longitude:) }`(TS の `ShareableResolutionOverride`)、`PlannerHistory<State>`(`init(initial:, limit: Int = 10)`, `commit(_:)`, `undo()`, `redo()`, `canUndo`, `canRedo`, `static let maxEntries = 20`)、`PlannerHistory.attachingBase(_:)`、`HardEditConflictKind`、`PlannerHardEditConflict { kind, message, minutes }`、`HardEditDecision`、`PlannerEdits.hardEditConflicts(before:after:)`、`PlannerEdits.evaluate(before:after:context:) -> HardEditDecision`、`PlannerEdits.clampTripDays(_:)`、`PlannerEdits.builtPlanTravelMinutes(_:)`、`PlannerEdits.manualStop(from: ResolutionOverride, input:) -> ResolvedStop?`、`PlannerEdits.applyManualOverrides(_ stops:, overrides:) -> [ResolvedStop]`

- [ ] **Step 1: 失敗するテストを書く**(`tests/planner-guarded-edits.test.ts` の 12 本を移す。代表 6 件)

```swift
@Test func harmlessEditAppliesWithBufferDelta() {
  let (before, after, ctx) = TestStops.stayEdit(from: 90, to: 120)   // 衝突を作らない滞在延長
  guard case .apply(let delta) = PlannerEdits.evaluate(before: before, after: after, context: ctx) else { Issue.record("expected apply"); return }
  #expect(delta == -30)
}

@Test func newBookingDelayAsksForConfirmation() {
  let (before, after, ctx) = TestStops.bookingLateEdit()
  guard case .confirm(let conflicts) = PlannerEdits.evaluate(before: before, after: after, context: ctx) else { Issue.record("expected confirm"); return }
  #expect(conflicts.first?.kind == .booking_late)
  #expect(conflicts.first?.message.contains("分") == true)
}

@Test func airportOverrunIsNotNettedAgainstCurfewImprovement() {
  let (before, after, _) = TestStops.airportWorseCurfewBetter()   // 門限 +90 分改善、空港 −30 分悪化
  let c = PlannerEdits.hardEditConflicts(before: before, after: after)
  #expect(c.contains { $0.kind == .airport_cutoff })
}

@Test func differentDaysAndKindsNeverCancel() {
  let (before, after, _) = TestStops.dayOneWorseDayTwoBetter()
  #expect(!PlannerEdits.hardEditConflicts(before: before, after: after).isEmpty)
}

@Test func unknownOpeningWindowsNeverPromoteToConflict() {
  let (before, after, _) = TestStops.dayStartPastUnknownHours()
  #expect(!PlannerEdits.hardEditConflicts(before: before, after: after).contains { $0.kind == .opening_closed })
}

@Test func existingViolationsAreNotReportedAgain() {
  let (before, after, _) = TestStops.sameViolationBothSides()
  #expect(PlannerEdits.hardEditConflicts(before: before, after: after).isEmpty)
}

@Test func historyKeepsTenUndosAndBaseAttachDoesNotAddEntries() {
  var h = PlannerHistory(initial: PlannerEditState.empty, limit: 10)
  for i in 1...15 { var s = h.present; s.tripDays = i; h = h.commit(s) }
  var undos = 0; while h.canUndo { h = h.undo(); undos += 1 }
  #expect(undos == 10)
  let attached = h.attachingBase(TestStops.resolvedBase())
  #expect(attached.past.count == h.past.count); #expect(attached.present.resolvedBase != nil)
}

@Test func committingAnEqualStateIsANoOp() {
  let h = PlannerHistory(initial: PlannerEditState.empty, limit: 10)
  #expect(h.commit(PlannerEditState.empty).past.isEmpty)
}
```

- [ ] **Step 2: 失敗を確認**

- [ ] **Step 3: 実装** — `hardConstraintSnapshot`(`:277`)は事実を**停留所・日・境界ごとにキー付け**(`booking:{stopId}`、`must:{stopId}`、`opening:{stopId}`、`last_entry:{stopId}`、`airport:{direction}`、`day_deadline:{position}`)。`plannerHardEditConflicts` はキー単位で `ok → conflict` の遷移だけを新規衝突とし、`unknown` は昇格しない。`evaluatePlannerHardEdit` は新規衝突があれば `.confirm`、無ければ `.apply(bufferDelta)`(`TripScenarios.totalPlanBufferMinutes` の差)。`PlannerHistory` は `limit` 超過で `past` の先頭を落とし、`maxEntries 20` を台帳の天井に。

- [ ] **Step 4: 緑を確認** — `--filter "GuardedEditsTests|PlannerHistoryTests"`

- [ ] **Step 5: Commit** — `git commit -m "No edit moves a booking without asking, and Undo brings the whole plan back"`

---
### Task 21: 場所解決のパイプライン(PlaceResolver プロトコル・カタログ解決器・自動採用規則・国の投票)

**Files:**
- Create: `Sources/TripCheckKit/Resolution/{PlaceResolver,CatalogResolver,ResolutionPipeline}.swift`
- Test: `Tests/TripCheckKitTests/Units/ResolutionPipelineTests.swift`
- 移植元: `lib/google-place-resolver.ts:7-30`(型)、`:91-`(`areaFromAddress`)、`app/components/planner/hooks/usePlanBuild.ts` の「完全一致は自動採用」「単独候補でも非観光タイプは確認へ」「混在国の検出」(関数名は `grep -n "exactMatch\|nonTouristic\|mixedCountry" app/components/planner/hooks/usePlanBuild.ts lib/*.ts` で特定して行範囲を本タスクの実装メモに追記する)、`lib/trip-builder.ts:1905-1937`(投票は Task 15 の `DestinationVote` を再利用)

**Interfaces:**
- Produces:
```swift
public struct PlaceQuery: Hashable, Sendable { public var inputIndex: Int; public var input: String; public var pinnedProviderRef: String? }
public struct PlaceCandidate: Hashable, Codable, Sendable { public var stop: ResolvedStop; public var category: String?; public var isTouristic: Bool }
public enum PlaceResolution: Sendable, Equatable { case confirmed(ResolvedStop), review([PlaceCandidate]), unresolved(reason: String) }
public protocol PlaceResolver: Sendable { func resolve(_ queries: [PlaceQuery], destination: DestinationChoice, locale: PlannerLocale) async -> [Int: PlaceResolution] }  // inputIndex → 結果
public struct CatalogResolver: PlaceResolver   // 東京 18 + スイス 8(完全一致・別名一致は confirmed)
public enum ResolutionPipeline {
  public static func resolve(_ queries: [PlaceQuery], destination: DestinationChoice, locale: PlannerLocale, resolvers: [any PlaceResolver]) async -> [Int: PlaceResolution]   // 先に confirmed を返した解決器で止まる
  public static func autoAccept(input: String, candidates: [PlaceCandidate]) -> PlaceCandidate?   // 完全一致 > 単独かつ観光タイプ
  public static func mixedCountryCodes(_ stops: [ResolvedStop]) -> [String]   // 2 か国以上なら全コード(昇順)
  public static func attentionRanks(_ results: [Int: PlaceResolution]) -> [Int: Int]   // review/unresolved に 0 始まりの順位(3 件ずつの抑止に使う)
  public static let nonTouristicCategories: Set<String>   // university, school, hospital, … + 企業名パターン
  public static func isNonTouristic(name: String, category: String?) -> Bool
}
```

- [ ] **Step 1: 失敗するテストを書く**

```swift
@Test func catalogResolverConfirmsKnownTokyoPlaces() async {
  let r = await CatalogResolver().resolve([PlaceQuery(inputIndex: 0, input: "浅草寺", pinnedProviderRef: nil)], destination: .auto, locale: .ja)
  guard case .confirmed(let s) = r[0] else { Issue.record("expected confirmed"); return }
  #expect(s.id == "sensoji"); #expect(s.provider == .catalog)
}

@Test func exactMatchIsAutoAcceptedEvenAmongSiblings() {
  let gornergrat = TestStops.candidate(name: "Gornergrat", category: "mountain_peak")
  let railway = TestStops.candidate(name: "Gornergrat Bahn", category: "train_station")
  #expect(ResolutionPipeline.autoAccept(input: "gornergrat", candidates: [railway, gornergrat])?.stop.name == "Gornergrat")
}

@Test func singleNonTouristicCandidateGoesToReview() {
  let uni = TestStops.candidate(name: "Universität Bern", category: "university")
  #expect(ResolutionPipeline.autoAccept(input: "Bern", candidates: [uni]) == nil)
  #expect(ResolutionPipeline.isNonTouristic(name: "Acme Insurance Inc.", category: nil))
  #expect(!ResolutionPipeline.isNonTouristic(name: "Bern Old Town", category: "tourist_attraction"))
}

@Test func pipelineStopsAtFirstConfirmedResolver() async {
  struct Never: PlaceResolver { func resolve(_ q: [PlaceQuery], destination: DestinationChoice, locale: PlannerLocale) async -> [Int: PlaceResolution] { Issue.record("must not be called"); return [:] } }
  let r = await ResolutionPipeline.resolve([PlaceQuery(inputIndex: 0, input: "Senso-ji", pinnedProviderRef: nil)], destination: .auto, locale: .en, resolvers: [CatalogResolver(), Never()])
  guard case .confirmed = r[0] else { Issue.record("expected confirmed"); return }
}

@Test func mixedCountriesAreListedAndRanksComeInThrees() {
  #expect(ResolutionPipeline.mixedCountryCodes(TestStops.mixed(["JP", "CH", "JP"])) == ["CH", "JP"])
  #expect(ResolutionPipeline.mixedCountryCodes(TestStops.mixed(["JP", "JP"])).isEmpty)
  let ranks = ResolutionPipeline.attentionRanks([0: .confirmed(TestStops.resolved("a")), 1: .review([]), 2: .unresolved(reason: "x"), 3: .review([])])
  #expect(ranks == [1: 0, 2: 1, 3: 2])
}
```

- [ ] **Step 2: 失敗を確認**

- [ ] **Step 3: 実装** — `CatalogResolver` は `Catalog.resolveKnownStops` と `SwissSample` の名前一致(ja/en、NFKC・小文字化)で `confirmed`、それ以外は返さない(辞書に含めない=次の解決器へ)。`autoAccept`: 名前の正規化比較で完全一致があればそれ、無ければ候補が 1 件かつ `!isNonTouristic` のときだけ。企業名パターンは統合仕様 §6.6 の正規表現 `株式会社|本社|insurance|\boffice\b|\binc\.?\b|…`(TS から逐語)。

- [ ] **Step 4: 緑を確認** — `--filter ResolutionPipelineTests`

- [ ] **Step 5: Commit** — `git commit -m "Places resolve through a chain, and only exact or obvious matches skip the traveller"`

---

### Task 22: gap 検出と Filler 上限(計算のみ)

**Files:**
- Create: `Sources/TripCheckKit/Gaps/GapDetection.swift`
- Test: `Tests/TripCheckKitTests/Invariants/GapDetectionTests.swift`
- 移植元: `lib/gap-detection.ts` 全 266 行。TS テスト: `tests/gap-detection.test.ts`

**Interfaces:**
- Produces: `GapKind: String { BEFORE_FIRST_ANCHOR, BETWEEN_ANCHORS, BEFORE_HOTEL_RETURN }`, `GapSizeBand: String { BELOW_MINIMUM, SHORT_30_TO_59, MEDIUM_60_TO_119, LONG_120_PLUS }`, `GapSuggestionKind: String { CAFE, BAKERY, PARK, LOOKOUT, SMALL_FACILITY, WALK, CAFE_AND_WALK, ATTRACTION }`, `ItineraryGap { id, dayIndex, kind, band, startMinutes, endMinutes, minutes, suggestionKinds: [GapSuggestionKind], center: GeoPoint, previousStopId: String?, nextStopId: String? }`, `GapDetection.classify(minutes:) -> GapSizeBand`, `GapDetection.detect(day: BuiltPlanDay, dayIndex:) -> [ItineraryGap]`, `GapDetection.primaryGap(day:dayIndex:) -> ItineraryGap?`(最大。同値は訪問順), `GapDetection.dayFillerAllowance(slackMinutes:) -> Int`(`< 120 → 1`、それ以外 `min(3, slack / 120)`), `FILLER_ALLOWANCE_MINUTES_EACH = 120`, `FILLER_ALLOWANCE_MAX = 3`

- [ ] **Step 1: 失敗するテストを書く**

```swift
@Test func bandBoundariesAreExact() {
  #expect(GapDetection.classify(minutes: 29) == .BELOW_MINIMUM); #expect(GapDetection.classify(minutes: 30) == .SHORT_30_TO_59)
  #expect(GapDetection.classify(minutes: 59) == .SHORT_30_TO_59); #expect(GapDetection.classify(minutes: 60) == .MEDIUM_60_TO_119)
  #expect(GapDetection.classify(minutes: 119) == .MEDIUM_60_TO_119); #expect(GapDetection.classify(minutes: 120) == .LONG_120_PLUS)
}

@Test func onlyLongGapsOpenAttractions() {
  let day = TestStops.dayWithGap(minutes: 120)
  #expect(GapDetection.primaryGap(day: day, dayIndex: 0)?.suggestionKinds.contains(.ATTRACTION) == true)
  #expect(GapDetection.primaryGap(day: TestStops.dayWithGap(minutes: 119), dayIndex: 0)?.suggestionKinds.contains(.ATTRACTION) == false)
}

@Test func fillerAllowanceGrowsEveryTwoHoursUpToThree() {
  #expect(GapDetection.dayFillerAllowance(slackMinutes: 0) == 1)
  #expect(GapDetection.dayFillerAllowance(slackMinutes: 119) == 1)
  #expect(GapDetection.dayFillerAllowance(slackMinutes: 240) == 2)
  #expect(GapDetection.dayFillerAllowance(slackMinutes: 385) == 3)
  #expect(GapDetection.dayFillerAllowance(slackMinutes: 1000) == 3)
}

@Test func primaryGapIsTheLargestTiesGoToVisitOrder() {
  let day = TestStops.dayWithGaps(minutes: [60, 90, 90])
  #expect(GapDetection.primaryGap(day: day, dayIndex: 0)?.minutes == 90)
  #expect(GapDetection.primaryGap(day: day, dayIndex: 0)?.kind == .BETWEEN_ANCHORS)
}
```

- [ ] **Step 2: 失敗を確認**  - [ ] **Step 3: 実装** — `:59-266` 逐語。  - [ ] **Step 4: 緑を確認**、`tests/gap-detection.test.ts` の残りも移す。  - [ ] **Step 5: Commit** — `git commit -m "The engine can name the hole in a day and how much would fit in it"`

---

### Task 23: 共有コード(Web と同じ `#t=`)とスコープ付き墨消し

**Files:**
- Create: `Sources/TripCheckKit/Share/{ShareCodec,ShareScope}.swift`, `Tests/TripCheckKitTests/Fixtures/share-vectors.json`
- Test: `Tests/TripCheckKitTests/Units/ShareCodecTests.swift`
- 移植元: `lib/share-link.ts` 全 306 行、`lib/share-scope.ts` 全 324 行。TS テスト: `tests/share-link.test.ts`、`tests/share-scope.test.ts`

**Interfaces:**
- Produces: `ShareableTripInput: Codable, Equatable`(TS と同名 27 フィールド。`resolutionOverrides: [ResolutionOverride]?`)、`ShareCodec.encode(_:) -> String`(`v: 1` を先頭キーにした JSON → UTF-8 → base64url、パディング無し)、`ShareCodec.decode(_:) -> ShareableTripInput?`(全フィールドを TS の `clean*` 関数群で検証。不正は `nil`)、`ShareScopeOptions { dates, hotel, airports, reservations: Bool }`、`ShareWarningCode: String`(6 値)、`ScopedShareResult { input, code, warnings, omittedUnparsedLines, redactedReservationCount, blocked }`、`ShareScope.scoped(_ input:, scope:) -> ScopedShareResult`、`MAX_SHARE_FRAGMENT_CHARS = 6_000`

- [ ] **Step 1: Web 互換ベクタを作る** — `tests/share-link.test.ts:20-60` の `input` オブジェクトを JSON として `share-vectors.json` に写し(`{ "vectors": [{ "name": "basic", "input": {...} }] }`)、**期待コードは Node が無いので Swift 側で生成しない**。代わりに Web 本番で生成した既知のコードを 1 本、手で取得して `expectedCode` に入れる(ユーザーの Web 版で「共有」→ URL の `#t=` 以降。取得できなければ `expectedCode: null` で往復テストのみ)。

- [ ] **Step 2: 失敗するテストを書く**

```swift
@Test func roundTripsEveryVector() throws {
  let v = try ShareVectors.load()
  for vec in v.vectors {
    let code = ShareCodec.encode(vec.input)
    #expect(ShareCodec.decode(code) == vec.input, vec.name)
    if let expected = vec.expectedCode { #expect(code == expected, "\(vec.name): web-compatible bytes") }
  }
}

@Test func payloadIsVersionedJsonInBase64Url() throws {
  let code = ShareCodec.encode(ShareVectors.basic)
  #expect(!code.contains("=") && !code.contains("+") && !code.contains("/"))
  let json = try #require(Data(base64Encoded: code.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + String(repeating: "=", count: (4 - code.count % 4) % 4)))
  #expect(String(decoding: json, as: UTF8.self).hasPrefix("{\"v\":1,"))
}

@Test func decodeRejectsGarbageBlankItineraryAndForgedDates() {
  #expect(ShareCodec.decode("not-base64!!") == nil)
  var blank = ShareVectors.basic; blank.itinerary = "   "
  #expect(ShareCodec.decode(ShareCodec.encode(blank)) == nil)
  var forged = ShareVectors.basic; forged.tripStartDate = "2026-13-40"; forged.dateWasProvided = true
  #expect(ShareCodec.decode(ShareCodec.encode(forged))?.dateWasProvided == false)
}

@Test func scopeRedactsAndBlocksWithoutWeakening() {
  let input = ShareVectors.withReservations
  let r = ShareScope.scoped(input, scope: .init(dates: true, hotel: false, airports: false, reservations: false))
  #expect(r.redactedReservationCount > 0); #expect(r.input?.hotelQuery == ""); #expect(r.input?.arrivalAirport == "")
  #expect(!r.warnings.contains(.RESERVATION_DETAILS_INCLUDED))
  let r2 = ShareScope.scoped(input, scope: .init(dates: true, hotel: true, airports: true, reservations: true))
  #expect(r2.warnings.contains(.RESERVATION_DETAILS_INCLUDED))
  var huge = input; huge.itinerary = String(repeating: "Tokyo Tower\n", count: 2000)
  let r3 = ShareScope.scoped(huge, scope: .init(dates: true, hotel: false, airports: false, reservations: false))
  #expect(r3.blocked); #expect(r3.warnings.contains(.LINK_TOO_LONG)); #expect(r3.code == nil)
}
```

- [ ] **Step 3: 失敗を確認**

- [ ] **Step 4: 実装** — `encode`: TS `:96-108`(`{ v: 1, ...input, resolutionOverrides? }` のキー順 = TS のスプレッド順 = `ShareableTripInput` 宣言順。Swift の `JSONEncoder` はキー順を保証しないので**手書きの順序付き直列化**(`[(String, JSONValue)]` → 文字列)を使う。空白なし、`JSON.stringify` と同じエスケープ(`/` はエスケープしない、非 ASCII はそのまま UTF-8))。`decode`: `:110-306` の `clean*` を全部移植(`cleanCalendarDate`, `cleanClock`, `cleanAirport`, `cleanNumberRecord`, `cleanDayTimes`, `cleanStopTimes`, `cleanLegModes`, `cleanLockedOrder`, `cleanRemovedStops`, `cleanTravellerText`, `cleanResolutionOverrides`、`MAX_RESOLUTION_OVERRIDES`/`MAX_RESOLUTION_INPUT_INDEX 3999`)。`ShareScope.scoped`: `:44-324`(`buildResolutionRemap`、`remapRecord`、`remapLegModes`、`remapLockedOrder`、`remapRemovedStops`、警告の付与順、`MAX_SHARE_FRAGMENT_CHARS` 超過で `blocked`)。

- [ ] **Step 5: 緑を確認** → **Commit** — `git commit -m "A trip shared from the phone opens on the web, redacted the same way"`

---

### Task 24: Presentation — Copy(ja/en)・判定文・stayLine・デイパレット・地域カバレッジ・領域外警告・banned terms

**Files:**
- Create: `Sources/TripCheckKit/Presentation/{Copy,CopyJa,CopyEn,TimelinePresentation,TripPresentation,DayPalette,BannedTerms}.swift`, `Sources/TripCheckKit/Feasibility/{CoverageProfile,PlanningEvidence,TripScope}.swift`
- Test: `Tests/TripCheckKitTests/Invariants/{CopyTests,TimelinePresentationTests,BannedTermsTests,CoverageTests}.swift`
- 移植元: `lib/presentation/planner-copy.ts`(1,006 行、`ui = { ja: {...}, en: {...} }` + 判定文ビルダー)、`lib/presentation/timeline-presentation.ts`(197 行)、`lib/presentation/trip-presentation.ts`(212 行)、`lib/planner-map-model.ts` の `PLANNER_MAP_DAY_COLORS`、`lib/coverage-profile.ts`(269 行)、`lib/planning-evidence.ts`(93 行)、`lib/trip-scope.ts`(65 行)。TS テスト: `tests/planner-copy.test.ts`、`tests/timeline-presentation.test.ts`(21)、`tests/banned-terms.test.ts`、`tests/coverage-profile.test.ts`、`tests/trip-scope.test.ts`、`tests/planning-evidence.test.ts`、`tests/day-presentation.test.ts`

**Interfaces:**
- Produces: `struct PlannerCopy`(TS `ui.ja` のキーを全部プロパティに。関数値は Swift のクロージャプロパティ `let minutes: (Int) -> String`)、`Copy.ja`, `Copy.en`, `Copy.for(_ locale:) -> PlannerCopy`;
  `VerdictCopy.hero(result: FeasibilityResult, fit: TripFitAssessment, plan:, locale:) -> String`(「4日なら、無理なく回れます」等)、`VerdictCopy.primaryWarning(...) -> (text: String, action: WarningAction)?`、`VerdictCopy.conflict(_:locale:) -> String`、`VerdictCopy.assumption(_:locale:) -> String`、`VerdictCopy.alternative(_:locale:) -> String`;
  `TimelinePresentation.stayLine(minutes:, status: DurationEvidenceStatus, locale:) -> String`(estimated → 「滞在の目安 1時間30分」/ verified → 「滞在 1時間30分」)、`.stayBasisLine`, `.dayHeaderSummary(day:, fit:, locale:) -> String`(2 数字)、`.dayTabTitle`, `.transportModeLabel(mode:, minutes:, source:, transfers:, locale:) -> String`(実測は「約」なし)、`.activityFlags(stop:) -> [ActivityFlag]`(その日休み/最終入場後/予約に遅れる)、`.spareCapacityLine(slackMinutes:, allowance:, locale:) -> String`;
  `TripPresentation.formatDuration(minutes:, locale:) -> String`、`.tripStatsLine(plan:, fit:, locale:) -> String`(spareDays があれば余裕を**置換**)、`.weekdayInfo`;
  `DayPalette.colors: [String] = ["#2563EB","#7C3AED","#C2410C","#15803D","#BE185D","#0F766E","#A16207"]`, `DayPalette.color(forDayIndex:) -> String`(`% 7`);
  `CoverageProfile.forLocation(destination:, countryCode:, coordinate:) -> CoverageProfile`(tokyo/japan_other/switzerland/europe/usa/unsupported、`routes/poi/hours/transit` の等級 A/B/C/unknown、`VALIDATED_AT 2026-08-09`)、`CoverageProfile.hasUnknownRegionalCoverage(_:) -> Bool`、`CoverageProfile.isTokyo(lat:lng:)`(箱 35.45–35.90 / 139.45–140.05);
  `PlanningEvidence.softBufferMinutes(mentions: [String]) -> Int`(0/15/30)、`TripScope.warnings(plan:, destination:) -> [TripScopeWarning]`(border / timezone / ferry);
  `BannedTerms.patterns: [JSRegex]`(`実測`・`判定保留`・`対応品質|地域品質`・`\bAPI\b`)、`BannedTerms.violations(in: String) -> [String]`

- [ ] **Step 1: 失敗するテストを書く**

```swift
@Test func copyTablesHaveTheSameKeysInBothLanguages() {
  #expect(Copy.ja.keys == Copy.en.keys)          // PlannerCopy.keys は全プロパティ名の静的配列(Mirror で生成)
  #expect(Copy.ja.keys.count >= 44)
}

@Test func estimatedAndVerifiedStayLinesAreNeverTheSameSentence() {
  for m in [30, 45, 60, 90, 120, 150, 180, 240] {
    #expect(TimelinePresentation.stayLine(minutes: m, status: .estimated, locale: .ja) != TimelinePresentation.stayLine(minutes: m, status: .verified, locale: .ja))
    #expect(TimelinePresentation.stayLine(minutes: m, status: .estimated, locale: .ja).contains("目安"))
    #expect(!TimelinePresentation.stayLine(minutes: m, status: .verified, locale: .ja).contains("目安"))
    #expect(TimelinePresentation.stayLine(minutes: m, status: .estimated, locale: .en).lowercased().contains("about") || TimelinePresentation.stayLine(minutes: m, status: .estimated, locale: .en).contains("~"))
  }
}

@Test func measuredLegsDropTheApproximationWord() {
  #expect(TimelinePresentation.transportModeLabel(mode: .transit, minutes: 95, source: .live, transfers: 1, locale: .ja) == "電車 95分・乗換1回")
  #expect(TimelinePresentation.transportModeLabel(mode: .transit, minutes: 60, source: .estimate, transfers: nil, locale: .ja) == "電車 約1時間")
}

@Test func spareDaysReplaceSlackAndNeverLengthenTheLine() {
  let (plan, fit) = TestStops.planWithSpareDay()
  let line = TripPresentation.tripStatsLine(plan: plan, fit: fit, locale: .ja)
  #expect(line.contains("1日分の空き")); #expect(!line.contains("余裕"))
  var noSpare = fit; noSpare.spareDays = nil
  #expect(line.count <= TripPresentation.tripStatsLine(plan: plan, fit: noSpare, locale: .ja).count)
}

@Test func heroSentenceNamesTheDaysAndTheState() {
  let req = TestStops.swissRequest(days: 4); let plan = TripBuilder.build(req)
  let fit = TripScenarios.assessTripFit(req, plan: plan, options: .init())
  let result = Feasibility.derive(plan: plan, fit: fit, evidence: Feasibility.snapshot(plan: plan, options: .init(dateWasProvided: false, baseWasProvided: false, dayEndWasProvided: false)))
  let hero = VerdictCopy.hero(result: result, fit: fit, plan: plan, locale: .ja)
  #expect(hero.contains("4日"))
  #expect(BannedTerms.violations(in: hero).isEmpty)
}

@Test func computationLimitHasItsOwnSentence() {
  let (plan, fit, result) = TestStops.timedOutTriple()
  let hero = VerdictCopy.hero(result: result, fit: fit, plan: plan, locale: .ja)
  #expect(!hero.contains("最短")); #expect(hero.contains("計算") || hero.contains("確認"))
}

@Test func everyCopyStringPassesBannedTerms() {
  for (key, value) in Copy.ja.allStaticStrings + Copy.en.allStaticStrings {
    #expect(BannedTerms.violations(in: value).isEmpty, "\(key): \(value)")
  }
}

@Test func dayPaletteHasSevenColoursAndCycles() {
  #expect(DayPalette.colors.count == 7)
  #expect(DayPalette.color(forDayIndex: 7) == DayPalette.colors[0])
  #expect(DayPalette.color(forDayIndex: 0) == "#2563EB")
}

@Test func coverageGradesAndTokyoBox() {
  #expect(CoverageProfile.isTokyo(lat: 35.68, lng: 139.76)); #expect(!CoverageProfile.isTokyo(lat: 34.69, lng: 135.50))
  #expect(CoverageProfile.forLocation(destination: .japan, countryCode: "JP", coordinate: GeoPoint(latitude: 35.68, longitude: 139.76)).id == "tokyo")
  #expect(CoverageProfile.hasUnknownRegionalCoverage(CoverageProfile.forLocation(destination: .worldwide, countryCode: "BR", coordinate: nil)))
}

@Test func softEvidenceBufferIsZeroFifteenThirty() {
  #expect(PlanningEvidence.softBufferMinutes(mentions: []) == 0)
  #expect(PlanningEvidence.softBufferMinutes(mentions: ["long queue at the gate"]) == 15)
  #expect(PlanningEvidence.softBufferMinutes(mentions: ["sold out", "very crowded"]) == 30)
  #expect(PlanningEvidence.softBufferMinutes(mentions: ["no queue at all"]) == 0)   // 否定形は除外
}

@Test func timezoneWarningOnlyWhenOffsetsDiffer() {
  #expect(TripScope.warnings(plan: TestStops.parisRomePlan(), destination: Destinations.byId(.france)).contains { $0.kind == .timezone } == false)
}
```

- [ ] **Step 2: 失敗を確認**

- [ ] **Step 3: 実装** — `CopyJa.swift` / `CopyEn.swift` に `planner-copy.ts` の `ui.ja` / `ui.en` を**逐語転記**(1,006 行の大半。キー名は camelCase のまま)。`PlannerCopy.keys` と `allStaticStrings` は `Mirror(reflecting:)` で導出。判定文ビルダー(`feasibilityHeadline` 等、TS の後半)は `VerdictCopy` に。`timeline-presentation.ts` / `trip-presentation.ts` は関数ごとに同名で。`BannedTerms` は `tests/banned-terms.test.ts` の 4 パターンを Kit 側の定数にする(App 側の文字列走査テストは Plan 2 で使う)。

- [ ] **Step 4: 緑を確認** — TS テスト 7 ファイルの該当ケースを全部移す。

- [ ] **Step 5: Commit** — `git commit -m "Every sentence the traveller reads comes from one bilingual table"`

---

### Task 25: 端末内保存(TripStore)と保存ペイロードの検証

**Files:**
- Create: `Sources/TripCheckKit/Persistence/{UserTripPayload,TripStore}.swift`
- Test: `Tests/TripCheckKitTests/Units/TripStoreTests.swift`
- 移植元: `lib/trip-store.ts`(`UserTripPayload`, `StoredTripRecord`, `SaveTripRecord`, `validateUserTripPayload` `:188-`、`validId`/`validTitle`/`validTimestamp`、`TRIP_STORE_MAX_RECORDS 10`、`MAX_PAYLOAD_BYTES`)。TS テスト: `tests/trip-store.test.ts`

**Interfaces:**
- Produces: `UserTripPayload { input: JSONObject, edits: JSONObject }`(`JSONObject = [String: JSONValue]`、`JSONValue` は `Core/JSONValue.swift` の enum)、`StoredTripRecord { id, schemaVersion: 1, title, createdAt, updatedAt, payload }`、`TripStoreError: Error { invalidPayload(String), tooLarge, ioFailure(Error) }`、`UserTripPayload.validate(_ value: JSONValue) throws -> UserTripPayload`(`input`/`edits` の 2 キーのみ、平坦なオブジェクト、`MAX_PAYLOAD_BYTES` 以下。**禁止キー**: TS の検証に加えて spec §5.5 の「Google 表示名・営業時間・口コミ・写真・経路・ビルド済みプラン」を `forbiddenKeys: Set<String> = ["plan", "days", "openingHours", "reviews", "photos", "routes", "liveTransitMinutes", "displayName", "providerSnapshot"]` として深さ優先で拒否)、`actor TripStore { init(directory: URL, maxRecords: Int = 10); func list() -> [StoredTripRecord](updatedAt 降順); func save(_ record: SaveTripRecord) throws -> StoredTripRecord; func delete(id: String) throws; func load(id:) -> StoredTripRecord? }`(1 レコード 1 ファイル `trips/<id>.json`、11 件目で最古を削除、書き込みは一時ファイル → `replaceItem` の原子置換)

- [ ] **Step 1: 失敗するテストを書く**

```swift
@Test func payloadAcceptsOnlyInputAndEdits() {
  #expect(throws: TripStoreError.self) { try UserTripPayload.validate(.object(["input": .object([:])])) }
  #expect(throws: TripStoreError.self) { try UserTripPayload.validate(.object(["input": .object([:]), "edits": .object([:]), "plan": .object([:])])) }
  #expect(throws: Never.self) { try UserTripPayload.validate(.object(["input": .object(["itinerary": .string("Senso-ji")]), "edits": .object([:])])) }
}

@Test func payloadRejectsProviderDisplayDataAnywhere() {
  let nested: JSONValue = .object(["input": .object(["stops": .array([.object(["id": .string("x"), "openingHours": .array([])])])]), "edits": .object([:])])
  #expect(throws: TripStoreError.self) { try UserTripPayload.validate(nested) }
}

@Test func storeKeepsTenMostRecentAndSurvivesRelaunch() async throws {
  let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  let store = TripStore(directory: dir)
  for i in 0..<12 { _ = try await store.save(SaveTripRecord(id: nil, title: "Trip \(i)", payload: try UserTripPayload.validate(.object(["input": .object(["n": .number(Double(i))]), "edits": .object([:])])))) }
  let list = await store.list()
  #expect(list.count == 10); #expect(list.first?.title == "Trip 11"); #expect(!list.contains { $0.title == "Trip 0" })
  let again = TripStore(directory: dir)
  #expect(await again.list().count == 10)
  try await again.delete(id: list[0].id)
  #expect(await again.list().count == 9)
}

@Test func titleAndIdAreBounded() {
  #expect(throws: TripStoreError.self) { try StoredTripRecord.validTitle(String(repeating: "a", count: 161)) }
  #expect(throws: TripStoreError.self) { try StoredTripRecord.validId("") }
}
```

- [ ] **Step 2: 失敗を確認** → **Step 3: 実装**(上記) → **Step 4: 緑を確認**

- [ ] **Step 5: Commit** — `git commit -m "Recent trips live on the device, ten at a time, with nothing borrowed from providers"`

---

### Task 26: 境界テスト・最終検証・README

**Files:**
- Create: `Tests/TripCheckKitTests/Invariants/ImportBoundaryTests.swift`, `apple/README.md`
- Modify: `apple/tools/verify-kit.sh`(`--parallel` を既定に)、`docs/superpowers/specs/2026-08-21-tripcheck-swift-v1-design.md`(付録 A が無ければ「G3 未実施」を追記)

- [ ] **Step 1: import 境界テストを書く**

```swift
@Test func kitSourcesImportOnlyFoundation() throws {
  let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Sources/TripCheckKit")
  let files = try FileManager.default.subpathsOfDirectory(atPath: root.path).filter { $0.hasSuffix(".swift") }
  #expect(files.count > 40)
  let banned = try JSRegex("^\\s*(@testable\\s+)?import\\s+(UIKit|SwiftUI|MapKit|CoreLocation|AppKit|Combine|WebKit)\\b", options: [.anchorsMatchLines])
  for f in files {
    let text = try String(contentsOf: root.appendingPathComponent(f), encoding: .utf8)
    #expect(!banned.test(text), "\(f) imports a UI/platform framework")
  }
}

@Test func noViewStateTypeExistsInKit() throws {
  // spec §5.1: PlannerViewState はアプリ側にだけ存在し、Kit の API はそれを受け取れない
  let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Sources/TripCheckKit")
  for f in try FileManager.default.subpathsOfDirectory(atPath: root.path) where f.hasSuffix(".swift") {
    let text = try String(contentsOf: root.appendingPathComponent(f), encoding: .utf8)
    #expect(!text.contains("PlannerViewState"), f)
  }
}
```

- [ ] **Step 2: 全テストを回す** — Run: `apple/tools/verify-kit.sh`。Expected: 全 passed、`exit=0`。件数を README に記録(G1 500 / G2 500 / 不変条件 N)。

- [ ] **Step 3: README を書く**

```markdown
# apple/ — TripCheck の Swift 実装

- `Packages/TripCheckKit`: 決定論エンジン(Foundation のみ)。`tools/verify-kit.sh` で `swift test`。
- 移植元は `../lib/`。golden 500(`Tests/TripCheckKitTests/Fixtures/golden-feasibility.v1.json`)は `../tests/fixtures/` のコピー。更新は Web 側で再生成してからコピーし直す(バイト同一)。
- 設計: `../docs/superpowers/specs/2026-08-21-tripcheck-swift-v1-design.md`、計画: `../docs/superpowers/plans/`。
- 検証値(最終実行日を書く): G1 500/500、G2 F1 …、単体/不変条件 … 本。
```

- [ ] **Step 4: Commit** — `git commit -m "The Swift engine proves it matches the web engine, and says how"`

---

## 自己レビュー記録

- **Spec 網羅**: spec §3.1(API)→ Task 15/16/17/20、§3.2(型対応)→ Task 2/7/9/16、§3.3(算術)→ Global Constraints + Task 2、§3.4(モジュール表 20 本)→ Task 3–25 で全部に対応(`planning-budget.ts` は定数のみで `EngineConstants` に吸収)、§3.5(G1/G2/G3)→ Task 18/5/19、§3.6(不変条件)→ 各タスクの Step 1、§4.2(PlaceResolver)→ Task 21、§5.5(保存)→ Task 25、§7(テスト層)→ Task 26。**Apple 解決器(§4.3)と UI は Plan 2**。
- **プレースホルダ**: 「TS を見て同一に」と書いた箇所(`routeLegKey` の区切り、FNV-1a の出力形式、企業名パターン)は移植元の行番号を添えてあり、実装者が開けば一意に決まる。
- **型の一貫性**: `TripRequest` / `PlannerContext` / `BuiltTripPlan` / `TripFitAssessment` / `PlannerEvidenceSnapshot` / `FeasibilityResult` / `PlannerEditState` / `ResolvedStop` の名前を全タスクで統一した。`TestStops` のヘルパー(`ring`, `line`, `point`, `twoClusters`, `swissRequest`, `ringRequest`, `tokyoResolved`, `mixed`, `rawFor`, `buildPlainDay`, `japanMeals`, `candidate`, `resolved`, `resolvedBase`, `asResolved`, `stayEdit`, `bookingLateEdit`, `airportWorseCurfewBetter`, `dayOneWorseDayTwoBetter`, `dayStartPastUnknownHours`, `sameViolationBothSides`, `tokyoClosedOnFixedDay`, `tokyoLowBuffer`, `overloadedDay`, `dayWithGap`, `dayWithGaps`, `planWithSpareDay`, `timedOutTriple`, `parisRomePlan`)は Task 7 で `Support/TestStops.swift` を作り、各タスクで必要なものを**そのタスクの Step 1 で追加**する。
