# TripCheck WeatherKit 天気表示 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iOS アプリに初めて天気を足す。WeatherKit で各日の天気(アイコン+最高/最低℃+降水%)を PlanScreen 日ヘッダーに表示し、Apple Weather 帰属を必ず添える。表示専用・feasibility 不介入・Kit 不可侵。

**Architecture:** 天気はエンジンに入らない表示専用なので、他のプロバイダ(RouteProvider/PlaceResolver/IntentParser=Kit にプロトコル)と違い、**型もプロトコルも AppCore** に置く(Kit は CoreLocation/WeatherKit を持ち込まない既存規則)。`WeatherProviding`(protocol)+`AppleWeatherProvider`(WeatherKit)+`CannedWeatherProvider`+可用性は composition root のみ、の既存パターン(IntentAvailability/WorkerAvailability)の写し。`PlannerStore` がプラン構築後に非同期取得し世代ガードで古い応答を捨てる(route/intent と同じ規律)。

**Tech Stack:** Swift 6 strict concurrency、WeatherKit(iOS 16+)、CoreLocation ブリッジ(既存 `GeoPoint.clLocation`)。

**Spec:** `docs/superpowers/specs/2026-08-25-tripcheck-weatherkit-design.md`

## Global Constraints

- **TripCheckKit(`Sources/TripCheckKit/`)は 1 行も変えない。** 追加は `Sources/TripCheckAppCore/Weather/` と アプリ本体 `apple/TripCheck/`、テスト、`project.yml`/entitlements のみ。
- AppCore は additive(既存 public API 変更禁止)。`PlannerCopy` 267 キー不変。fixtures バイト同一。
- Swift 6 strict concurrency・**新規警告ゼロ**。日本語文リテラルは `AppCopy.swift` のみ(CopyBoundaryTests)。絵文字禁止・自作 SVG アイコンのみ。
- **天気を `verified`/CriticalFact/feasibility に絶対に入れない**(表示専用)。web(`lib/` `app/` `tests/`)は不変。
- 座標・天気結果・帰属 URL をログ/永続化に不要に残さない。UserDefaults に天気を書かない。
- WeatherKit 呼び出しは `#if canImport(WeatherKit)` + `@available(iOS 16.0, macOS 13.0, *)` で囲む(DeviceCheck と同じ流儀)。可用性判定は composition root のみ。
- コミット末尾に必ず 2 行トレーラ(空行を挟む):

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J
```

`git push` はしない(ユーザーが行う)。

## File Structure

**AppCore 新規(`apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Weather/`):** `WeatherModels.swift`(値型+`WeatherProviding`)、`CannedWeatherProvider.swift`、`AppleWeatherProvider.swift`(WeatherKit+pure helpers)、`WeatherAvailability.swift`。
**AppCore 変更:** `Store/PlannerStore.swift`(init に `weatherProvider` 追加、天気状態プロパティ)、`Store/PlannerStore+Weather.swift`(新規 extension: 取得ロジック)、`Store/PlannerStore+ViewModel.swift`(日→天気の導出)、`Presentation/AppCopy.swift`(文言)。
**アプリ本体 変更/新規:** `TripCheck/Screens/Plan/DayHeaderRow.swift`(チップ+帰属)、`TripCheck/Screens/Plan/WeatherChip.swift`(新規)、`TripCheck/App/TripCheckApp.swift`(注入)、`TripCheck/Resources/TripCheck.entitlements`(weatherkit キー)。
**テスト:** AppCore `Tests/.../WeatherProviderTests.swift`、`Tests/.../PlannerStoreWeatherTests.swift`、`Support/Fakes.swift`(追記)、`apple/TripCheckUITests/PlannerFlowTests.swift`(1 本追記)。手順書 `apple/docs/weatherkit-check.md`。

---

## Task 1: 天気の値型・プロトコル・Canned・Fake

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Weather/WeatherModels.swift`, `.../Weather/CannedWeatherProvider.swift`
- Modify: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/Support/Fakes.swift`(末尾に追記)
- Test: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WeatherModelsTests.swift`

**Interfaces:**
- Consumes: Kit の `GeoPoint`(`latitude/longitude: Double`)、`CalendarDate`(`year/month/day: Int`、`init?(_ text:)`)、`PlannerLocale`。
- Produces: `WeatherKind`, `WeatherDay`, `WeatherAttribution`, `WeatherResult`, `WeatherDayRequest`, `protocol WeatherProviding`, `CannedWeatherProvider`, テスト用 `FakeWeatherProvider`。

- [ ] **Step 1: `WeatherModels.swift` を作る**

```swift
import Foundation
import TripCheckKit

/// web の 7 種(`lib/weather.ts` WeatherKind)に合わせた天気の畳み込み。
public enum WeatherKind: String, Sendable, Codable, CaseIterable {
  case clear, partly, cloudy, fog, rain, snow, storm
}

/// 1 日ぶんの天気。web の `TripWeatherDay` を踏襲(Apple は WMO code を返さないので code は持たない)。
public struct WeatherDay: Equatable, Sendable {
  public let index: Int
  public let date: CalendarDate
  public let kind: WeatherKind
  public let temperatureMaxC: Int
  public let temperatureMinC: Int
  public let precipitationPercent: Int?
  public init(index: Int, date: CalendarDate, kind: WeatherKind, temperatureMaxC: Int, temperatureMinC: Int, precipitationPercent: Int?) {
    self.index = index
    self.date = date
    self.kind = kind
    self.temperatureMaxC = temperatureMaxC
    self.temperatureMinC = temperatureMinC
    self.precipitationPercent = precipitationPercent
  }
}

/// Apple 必須の帰属。`legalPageURL` が土台、ロゴ URL は任意の上乗せ。
public struct WeatherAttribution: Equatable, Sendable {
  public let legalPageURL: URL
  public let markLightURL: URL?
  public let markDarkURL: URL?
  public init(legalPageURL: URL, markLightURL: URL? = nil, markDarkURL: URL? = nil) {
    self.legalPageURL = legalPageURL
    self.markLightURL = markLightURL
    self.markDarkURL = markDarkURL
  }
}

public struct WeatherResult: Equatable, Sendable {
  public let provider: String
  public let days: [WeatherDay]
  public let attribution: WeatherAttribution?
  public init(provider: String = "apple_weather", days: [WeatherDay], attribution: WeatherAttribution?) {
    self.provider = provider
    self.days = days
    self.attribution = attribution
  }
  /// 天気が出せないときの共通の空。チップも帰属も出さない。
  public static let empty = WeatherResult(days: [], attribution: nil)
}

/// 1 日の要求。web の `buildWeatherPayload` と同じく、日 index + 日付 + その日の停留所座標の平均(2桁丸め)。
public struct WeatherDayRequest: Equatable, Sendable {
  public let index: Int
  public let date: CalendarDate
  public let coordinate: GeoPoint
  public init(index: Int, date: CalendarDate, coordinate: GeoPoint) {
    self.index = index
    self.date = date
    self.coordinate = coordinate
  }
}

/// 天気の提供元。Kit は知らない(表示専用なので AppCore に置く)。
public protocol WeatherProviding: Sendable {
  func weather(for requests: [WeatherDayRequest], locale: PlannerLocale) async -> WeatherResult
}
```

- [ ] **Step 2: `CannedWeatherProvider.swift` を作る**

```swift
import Foundation
import TripCheckKit

/// UI テスト/プレビュー用。決定的な天気を返す。時刻は読まない。
public struct CannedWeatherProvider: WeatherProviding {
  public init() {}
  public func weather(for requests: [WeatherDayRequest], locale: PlannerLocale) async -> WeatherResult {
    let kinds: [WeatherKind] = [.clear, .partly, .cloudy, .rain, .snow, .storm, .fog]
    let days = requests.enumerated().map { offset, request in
      WeatherDay(
        index: request.index,
        date: request.date,
        kind: kinds[offset % kinds.count],
        temperatureMaxC: 20 - offset,
        temperatureMinC: 12 - offset,
        precipitationPercent: (offset * 15) % 100
      )
    }
    let attribution = WeatherAttribution(
      legalPageURL: URL(string: "https://weatherkit.apple.com/legal-attribution.html")!
    )
    return days.isEmpty ? .empty : WeatherResult(days: days, attribution: attribution)
  }
}
```

- [ ] **Step 3: `Support/Fakes.swift` 末尾にテスト用フェイクを追記**(既存定義は変えない)

```swift
// MARK: - 天気のフェイク(spec 2026-08-25)

struct FakeWeatherProvider: WeatherProviding {
  /// 返す固定の日々(index はテストが要求に合わせて渡す)。
  var days: [WeatherDay] = []
  var attribution: WeatherAttribution? = WeatherAttribution(
    legalPageURL: URL(string: "https://weatherkit.apple.com/legal-attribution.html")!
  )
  /// 呼ばれた要求を記録(世代ガードやスキップ判定の検証用)。
  final class Recorder: @unchecked Sendable {
    private let lock = NSLock()
    private(set) var lastRequests: [WeatherDayRequest] = []
    func record(_ r: [WeatherDayRequest]) { lock.withLock { lastRequests = r } }
  }
  var recorder = Recorder()
  func weather(for requests: [WeatherDayRequest], locale: PlannerLocale) async -> WeatherResult {
    recorder.record(requests)
    let mapped = requests.compactMap { req in days.first { $0.index == req.index } }
    return mapped.isEmpty ? .empty : WeatherResult(days: mapped, attribution: attribution)
  }
}
```

- [ ] **Step 4: `WeatherModelsTests.swift` を書く**

```swift
import XCTest
import Foundation
@testable import TripCheckAppCore
import TripCheckKit

final class WeatherModelsTests: XCTestCase {
  private func req(_ index: Int) -> WeatherDayRequest {
    WeatherDayRequest(index: index, date: CalendarDate(year: 2026, month: 9, day: 1 + index), coordinate: GeoPoint(latitude: 35.0, longitude: 139.0))
  }

  func testCannedReturnsADayPerRequestWithAttribution() async {
    let result = await CannedWeatherProvider().weather(for: [req(0), req(1), req(2)], locale: .ja)
    XCTAssertEqual(result.days.count, 3)
    XCTAssertEqual(result.provider, "apple_weather")
    XCTAssertNotNil(result.attribution)
    XCTAssertEqual(result.days.map(\.index), [0, 1, 2])
  }

  func testCannedWithNoRequestsIsEmptyAndUnattributed() async {
    let result = await CannedWeatherProvider().weather(for: [], locale: .ja)
    XCTAssertTrue(result.days.isEmpty)
    XCTAssertNil(result.attribution)
  }
}
```

- [ ] **Step 5: ビルド + テスト**

Run: `cd /Users/muraoshoki/Documents/Codex/2026-07-15/new-chat/.claude/worktrees/<wt>/apple && swift test --package-path Packages/TripCheckKit --filter WeatherModelsTests`
Expected: pass、`swift build --package-path Packages/TripCheckKit` は警告ゼロ。

- [ ] **Step 6: コミット**

```bash
cd apple
git add Packages/TripCheckKit/Sources/TripCheckAppCore/Weather/WeatherModels.swift Packages/TripCheckKit/Sources/TripCheckAppCore/Weather/CannedWeatherProvider.swift Packages/TripCheckKit/Tests/TripCheckAppCoreTests/Support/Fakes.swift Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WeatherModelsTests.swift
git commit -m "The shapes of a forecast: a day, a kind, an attribution the engine never sees"
```

## Task 2: AppleWeatherProvider(WeatherKit)+ pure helpers + 可用性

**Files:**
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Weather/AppleWeatherProvider.swift`, `.../Weather/WeatherAvailability.swift`
- Test: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WeatherProviderTests.swift`

**Interfaces:**
- Consumes: Task 1 の型、Kit の `GeoPoint.clLocation`(`Map/GeoPoint+MapKit.swift`)、`CalendarDate`。
- Produces: `AppleWeatherProvider`(`WeatherProviding`)、`WeatherConditionMapping`(WeatherKit-結合、guarded)、pure helpers `WeatherMath`(temp/precip/日付突合、WeatherKit 非依存)、`WeatherAvailability.makeDefaultProvider(uiTesting:)`。

- [ ] **Step 1: pure helpers（WeatherKit 非依存、常にテスト可能）を `AppleWeatherProvider.swift` の冒頭に置く**

```swift
import Foundation
import TripCheckKit
#if canImport(WeatherKit)
import WeatherKit
#endif
#if canImport(CoreLocation)
import CoreLocation
#endif

/// WeatherKit に触れない純関数群。ここだけは常に単体テストできる。
enum WeatherMath {
  /// 摂氏の生値(Measurement から取り出した Double)を四捨五入して Int に。
  static func celsius(_ value: Double) -> Int { Int(value.rounded()) }

  /// 降水確率 0...1 を 0...100 の Int に(範囲外は丸めてクランプ)。
  static func precipitationPercent(_ chance: Double) -> Int {
    min(100, max(0, Int((chance * 100).rounded())))
  }

  /// 予報の Date を、注入した TimeZone の暦日に落として (年,月,日) を返す。
  static func calendarDay(of date: Date, in timeZone: TimeZone) -> (year: Int, month: Int, day: Int) {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let c = calendar.dateComponents([.year, .month, .day], from: date)
    return (c.year ?? 0, c.month ?? 0, c.day ?? 0)
  }

  /// 予報 Date が要求の暦日(CalendarDate)と一致するか。
  static func matches(_ date: Date, _ request: CalendarDate, in timeZone: TimeZone) -> Bool {
    let d = calendarDay(of: date, in: timeZone)
    return d.year == request.year && d.month == request.month && d.day == request.day
  }
}
```

- [ ] **Step 2: WeatherKit 結合の畳み込み + プロバイダ本体を同ファイルに続ける**

```swift
#if canImport(WeatherKit)
/// WeatherKit の `WeatherCondition` を web の 7 種へ畳む。表外・@unknown は中立の cloudy。
@available(iOS 16.0, macOS 13.0, *)
enum WeatherConditionMapping {
  static func kind(for condition: WeatherCondition) -> WeatherKind {
    switch condition {
    case .clear, .mostlyClear, .hot: return .clear
    case .partlyCloudy: return .partly
    case .cloudy, .mostlyCloudy, .windy, .breezy, .blowingDust, .smoky: return .cloudy
    case .foggy, .haze: return .fog
    case .drizzle, .rain, .heavyRain, .sunShowers, .freezingDrizzle, .freezingRain: return .rain
    case .snow, .heavySnow, .flurries, .sleet, .hail, .wintryMix, .blizzard, .blowingSnow, .frigid: return .snow
    case .thunderstorms, .isolatedThunderstorms, .scatteredThunderstorms, .strongStorms, .tropicalStorm, .hurricane: return .storm
    @unknown default: return .cloudy
    }
  }
}

/// 端末から WeatherKit を叩く実物。表示専用・失敗は空。座標・結果をログに残さない。
@available(iOS 16.0, macOS 13.0, *)
public struct AppleWeatherProvider: WeatherProviding {
  private let timeZone: TimeZone
  public init(timeZone: TimeZone = .current) { self.timeZone = timeZone }

  public func weather(for requests: [WeatherDayRequest], locale: PlannerLocale) async -> WeatherResult {
    guard !requests.isEmpty else { return .empty }
    let service = WeatherService.shared

    // 帰属が取れなければ天気自体を出さない(Apple 必須)。
    guard let attribution = try? await service.attribution else { return .empty }
    let mapped = WeatherAttribution(
      legalPageURL: attribution.legalPageURL,
      markLightURL: attribution.combinedMarkLightURL,
      markDarkURL: attribution.combinedMarkDarkURL
    )

    // 座標ごとに日次予報を引き、要求日に一致する DayWeather を拾う。1 座標の失敗は捨てる。
    var days: [WeatherDay] = []
    await withTaskGroup(of: WeatherDay?.self) { group in
      for request in requests {
        let tz = timeZone
        group.addTask {
          let location = CLLocation(latitude: request.coordinate.latitude, longitude: request.coordinate.longitude)
          guard let daily = try? await service.weather(for: location, including: .daily) else { return nil }
          guard let match = daily.forecast.first(where: { WeatherMath.matches($0.date, request.date, in: tz) }) else { return nil }
          return WeatherDay(
            index: request.index,
            date: request.date,
            kind: WeatherConditionMapping.kind(for: match.condition),
            temperatureMaxC: WeatherMath.celsius(match.highTemperature.converted(to: .celsius).value),
            temperatureMinC: WeatherMath.celsius(match.lowTemperature.converted(to: .celsius).value),
            precipitationPercent: WeatherMath.precipitationPercent(match.precipitationChance)
          )
        }
      }
      for await day in group { if let day { days.append(day) } }
    }
    let sorted = days.sorted { $0.index < $1.index }
    return sorted.isEmpty ? .empty : WeatherResult(days: sorted, attribution: mapped)
  }
}
#endif
```

- [ ] **Step 3: `WeatherAvailability.swift` を作る**

```swift
import Foundation

/// どの天気プロバイダを使うかは composition root からのこの 1 か所だけで決める(IntentAvailability と同型)。
public enum WeatherAvailability {
  public static func makeDefaultProvider(uiTesting: Bool) -> (any WeatherProviding)? {
    if uiTesting { return CannedWeatherProvider() }
    #if canImport(WeatherKit)
    if #available(iOS 16.0, macOS 13.0, *) { return AppleWeatherProvider() }
    #endif
    return nil
  }
}
```

- [ ] **Step 4: `WeatherProviderTests.swift` を書く**(pure helpers を中心に。WeatherKit 結合分は guarded)

```swift
import XCTest
import Foundation
@testable import TripCheckAppCore
import TripCheckKit
#if canImport(WeatherKit)
import WeatherKit
#endif

final class WeatherProviderTests: XCTestCase {
  private let tokyo = TimeZone(identifier: "Asia/Tokyo")!

  func testCelsiusRounds() {
    XCTAssertEqual(WeatherMath.celsius(20.4), 20)
    XCTAssertEqual(WeatherMath.celsius(20.5), 21)
    XCTAssertEqual(WeatherMath.celsius(-0.5), 0)
  }

  func testPrecipitationClampsToPercent() {
    XCTAssertEqual(WeatherMath.precipitationPercent(0.0), 0)
    XCTAssertEqual(WeatherMath.precipitationPercent(0.126), 13)
    XCTAssertEqual(WeatherMath.precipitationPercent(1.0), 100)
    XCTAssertEqual(WeatherMath.precipitationPercent(1.5), 100)
  }

  func testDateMatchUsesInjectedTimeZone() {
    // 2026-09-01T15:00Z は東京では 2026-09-02。
    let date = Date(timeIntervalSince1970: 1_788_368_400) // 2026-09-01T15:00:00Z
    XCTAssertTrue(WeatherMath.matches(date, CalendarDate(year: 2026, month: 9, day: 2), in: tokyo))
    XCTAssertFalse(WeatherMath.matches(date, CalendarDate(year: 2026, month: 9, day: 1), in: tokyo))
    XCTAssertTrue(WeatherMath.matches(date, CalendarDate(year: 2026, month: 9, day: 1), in: TimeZone(identifier: "UTC")!))
  }

  #if canImport(WeatherKit)
  @available(iOS 16.0, macOS 13.0, *)
  func testConditionMappingFoldsToSevenKinds() {
    XCTAssertEqual(WeatherConditionMapping.kind(for: .clear), .clear)
    XCTAssertEqual(WeatherConditionMapping.kind(for: .partlyCloudy), .partly)
    XCTAssertEqual(WeatherConditionMapping.kind(for: .heavyRain), .rain)
    XCTAssertEqual(WeatherConditionMapping.kind(for: .blizzard), .snow)
    XCTAssertEqual(WeatherConditionMapping.kind(for: .thunderstorms), .storm)
    XCTAssertEqual(WeatherConditionMapping.kind(for: .foggy), .fog)
    XCTAssertEqual(WeatherConditionMapping.kind(for: .windy), .cloudy)
  }
  #endif
}
```

（注: `1_788_368_400` が 2026-09-01T15:00:00Z であることを実装者は `date -u -r 1788368400` 等で確認し、ズレていれば正しい epoch に直す。UTC で 9/1、東京で 9/2 になる値であればよい。)

- [ ] **Step 5: ビルド + テスト**

Run: `cd apple && swift test --package-path Packages/TripCheckKit --filter WeatherProviderTests`
Expected: pass(WeatherKit がホストで import 不可なら `testConditionMappingFoldsToSevenKinds` は guard で不在=それ以外が pass)。`swift build` 警告ゼロ。

- [ ] **Step 6: コミット**

```bash
cd apple
git add Packages/TripCheckKit/Sources/TripCheckAppCore/Weather/AppleWeatherProvider.swift Packages/TripCheckKit/Sources/TripCheckAppCore/Weather/WeatherAvailability.swift Packages/TripCheckKit/Tests/TripCheckAppCoreTests/WeatherProviderTests.swift
git commit -m "WeatherKit answers on the device; pure helpers make the maths testable without it"
```

## Task 3: PlannerStore の天気取得(世代ガード・要求構築・非ブロッキング)

**Files:**
- Modify: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore.swift`(init 引数 + 状態プロパティ)
- Create: `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore+Weather.swift`
- Test: `apple/Packages/TripCheckKit/Tests/TripCheckAppCoreTests/PlannerStoreWeatherTests.swift`

**Interfaces:**
- Consumes: Task 1/2 の型・`WeatherMath`、`bundle: BuiltPlanBundle?`(`bundle.plan.days: [BuiltPlanDay]`、`BuiltPlanDay.date: String?`、`.stops[].stop.latitude/longitude: Double`)、既存の route 世代ガード(`PlannerStore+Routes.swift`)。
- Produces: `weatherByDay: [Int: WeatherDay]`, `weatherAttribution: WeatherAttribution?`, `startWeatherEnrichment(...)`, `invalidateWeather()`。

- [ ] **Step 1: `PlannerStore.swift` に状態と init 引数を additive に追加**

`routeProvider`/`routeGeneration`/`routeTask` が並ぶ `@ObservationIgnored` 群(現状 118–149 付近)に:

```swift
  @ObservationIgnored let weatherProvider: (any WeatherProviding)?
  @ObservationIgnored var weatherGeneration = 0
  @ObservationIgnored var weatherTask: Task<Void, Never>?
```

`routeProgress` 等の observable 群(150 付近)に:

```swift
  public internal(set) var weatherByDay: [Int: WeatherDay] = [:]
  public internal(set) var weatherAttribution: WeatherAttribution?
```

`init` の引数列(末尾 `intentParser: (any IntentParser)? = nil` の直後)に:

```swift
    weatherProvider: (any WeatherProviding)? = nil,
```

`init` 本体で他プロバイダの代入と同じ場所に `self.weatherProvider = weatherProvider`。

- [ ] **Step 2: `PlannerStore+Weather.swift` を作る**

route enrichment(`PlannerStore+Routes.swift` の `startRouteEnrichment`)と同じ規律。取得は非ブロッキング、世代ガードで古い応答を捨てる。**MainActor 隔離やタスクの書き方は既存 `startRouteEnrichment` に厳密に合わせる**(このファイルの `Task { [weak self] ... }` とガードの形をそのまま踏襲)。

```swift
import Foundation
import TripCheckKit

extension PlannerStore {
  /// 各日の要求を組む。日付が確定(String→CalendarDate)し、ホライズン(今日〜+N日)内で、
  /// 停留所が 1 つ以上ある日だけ。座標は停留所の平均を 2 桁丸め(地名・id は載せない)。最大 maxDays。
  func weatherRequests(now: Date, timeZone: TimeZone = .current, maxDays: Int = 10, horizonDays: Int = 10) -> [WeatherDayRequest] {
    guard let bundle else { return [] }
    let t = WeatherMath.calendarDay(of: now, in: timeZone)
    let today = CalendarDate(year: t.year, month: t.month, day: t.day)
    var out: [WeatherDayRequest] = []
    for (index, day) in bundle.plan.days.enumerated() {
      if out.count >= maxDays { break }
      guard let text = day.date, let date = CalendarDate(text) else { continue }
      guard Self.withinHorizon(date, from: today, days: horizonDays) else { continue }
      let coords = day.stops.map { GeoPoint(latitude: $0.stop.latitude, longitude: $0.stop.longitude) }
      guard let center = Self.averagedCoordinate(coords) else { continue }
      out.append(WeatherDayRequest(index: index, date: date, coordinate: center))
    }
    return out
  }

  /// 停留所座標の平均を小数 2 桁に丸める(≒1km)。空なら nil。
  static func averagedCoordinate(_ coords: [GeoPoint]) -> GeoPoint? {
    guard !coords.isEmpty else { return nil }
    let count = Double(coords.count)
    let lat = coords.reduce(0.0) { $0 + $1.latitude } / count
    let lon = coords.reduce(0.0) { $0 + $1.longitude } / count
    return GeoPoint(latitude: (lat * 100).rounded() / 100, longitude: (lon * 100).rounded() / 100)
  }

  /// date が today..today+days(両端含む)に入るか。CalendarDate を UTC の Date に落として日数差で判定。
  static func withinHorizon(_ date: CalendarDate, from today: CalendarDate, days: Int) -> Bool {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "UTC")!
    func toDate(_ c: CalendarDate) -> Date? { calendar.date(from: DateComponents(year: c.year, month: c.month, day: c.day)) }
    guard let a = toDate(today), let b = toDate(date) else { return false }
    let delta = calendar.dateComponents([.day], from: a, to: b).day ?? -1
    return delta >= 0 && delta <= days
  }

  /// プランが建った後に 1 回。route enrichment と同じ場所で呼ぶ。
  func startWeatherEnrichment(now: Date = Date(), timeZone: TimeZone = .current) {
    invalidateWeather()
    guard let provider = weatherProvider else { return }
    let requests = weatherRequests(now: now, timeZone: timeZone)
    guard !requests.isEmpty else { return }
    let generation = weatherGeneration
    let locale = request.locale
    weatherTask = Task { [weak self] in
      let result = await provider.weather(for: requests, locale: locale)
      guard let self, self.weatherGeneration == generation, !Task.isCancelled else { return }
      self.applyWeather(result)
      if self.weatherGeneration == generation { self.weatherTask = nil }
    }
  }

  /// 再構築・日付変更・reset で呼ぶ。世代を上げ、読みかけを捨て、表示を空に。
  func invalidateWeather() {
    weatherGeneration &+= 1
    weatherTask?.cancel()
    weatherTask = nil
    weatherByDay = [:]
    weatherAttribution = nil
  }

  private func applyWeather(_ result: WeatherResult) {
    // 帰属が無い、または天気ゼロなら出さない(Apple: 帰属無しで天気を見せない)。
    guard let attribution = result.attribution, !result.days.isEmpty else { return }
    var byDay: [Int: WeatherDay] = [:]
    for day in result.days { byDay[day.index] = day }
    weatherByDay = byDay
    weatherAttribution = attribution
  }
}
```

- [ ] **Step 3: 呼び出しと無効化の配線**

`startRouteEnrichment()` を呼んでいる箇所(プラン構築完了時)の直後で `startWeatherEnrichment()` を呼ぶ。
`routeGeneration` を上げてルートを無効化している箇所(再構築・reset・日付変更)と同じ場所で `invalidateWeather()` を呼ぶ。**既存の route の呼び出し/無効化点をそのまま鏡にする**(新しい発火点を作らない)。

- [ ] **Step 4: `PlannerStoreWeatherTests.swift` を書く**

pure helpers は直接、取得系は Fake + 構築済みプランで(**プラン構築のセットアップは既存の route enrichment テストを鏡にする**)。

```swift
import XCTest
import Foundation
@testable import TripCheckAppCore
import TripCheckKit

final class PlannerStoreWeatherTests: XCTestCase {
  func testAveragedCoordinateRoundsToTwoDecimals() {
    let c = PlannerStore.averagedCoordinate([
      GeoPoint(latitude: 35.001, longitude: 139.004),
      GeoPoint(latitude: 35.019, longitude: 139.016),
    ])
    XCTAssertEqual(c?.latitude, 35.01)
    XCTAssertEqual(c?.longitude, 139.01)
    XCTAssertNil(PlannerStore.averagedCoordinate([]))
  }

  func testHorizonAcceptsTodayToPlusTenOnly() {
    let today = CalendarDate(year: 2026, month: 9, day: 1)
    XCTAssertTrue(PlannerStore.withinHorizon(today, from: today, days: 10))
    XCTAssertTrue(PlannerStore.withinHorizon(CalendarDate(year: 2026, month: 9, day: 11), from: today, days: 10))
    XCTAssertFalse(PlannerStore.withinHorizon(CalendarDate(year: 2026, month: 9, day: 12), from: today, days: 10))
    XCTAssertFalse(PlannerStore.withinHorizon(CalendarDate(year: 2026, month: 8, day: 31), from: today, days: 10))
  }

  // 構築済みプランに対する取得・世代ガード・帰属無しスキップは、既存の route enrichment テスト
  // (PlannerStore+Routes 系テスト)のプラン構築ヘルパを鏡にして書く:
  //  - FakeWeatherProvider に in-horizon の dated 日ぶんの WeatherDay を仕込み、startWeatherEnrichment
  //    → await → weatherByDay/weatherAttribution が埋まる
  //  - startWeatherEnrichment 実行直後に invalidateWeather() で世代を上げると、遅れて届いた結果が
  //    weatherByDay に載らない(世代ガード)
  //  - attribution = nil の Fake は weatherByDay を空のままにする(帰属無しは出さない)
  // ※ プラン構築の詳細(TripStore/日付投入)はこのリポジトリの既存 route テストと同じ形にする。
}
```

（実装者へ: 上記コメントの 3 ケースは、既存 route enrichment テストのプラン構築セットアップを流用して実テストとして書き起こすこと。プラン構築 API がテストから使えない形なら、`weatherRequests` を構築済み `bundle` を注入した store で叩く最小テストに落としてよい —— その場合も「世代ガードで遅延結果を捨てる」1 本は必須。）

- [ ] **Step 5: ビルド + テスト**

Run: `cd apple && swift test --package-path Packages/TripCheckKit --filter PlannerStoreWeatherTests`
その後 `swift test --package-path Packages/TripCheckKit`(全 AppCore が緑・既存を壊さない)。警告ゼロ。

- [ ] **Step 6: コミット**

```bash
cd apple
git add Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore.swift Packages/TripCheckKit/Sources/TripCheckAppCore/Store/PlannerStore+Weather.swift Packages/TripCheckKit/Tests/TripCheckAppCoreTests/PlannerStoreWeatherTests.swift
git commit -m "The plan fetches its forecast after it is built, and forgets it the moment it rebuilds"
```

## Task 4: UI(天気チップ+帰属)・AppCopy・合成の根・entitlement・UIテスト・手順書

**Files:**
- Create: `apple/TripCheck/Screens/Plan/WeatherChip.swift`, `apple/docs/weatherkit-check.md`
- Modify: `apple/TripCheck/Screens/Plan/DayHeaderRow.swift`, `apple/Packages/TripCheckKit/Sources/TripCheckAppCore/Presentation/AppCopy.swift`, `apple/TripCheck/App/TripCheckApp.swift`, `apple/TripCheck/Resources/TripCheck.entitlements`, `apple/TripCheckUITests/PlannerFlowTests.swift`

**Interfaces:**
- Consumes: Task 1–3(`WeatherDay`/`WeatherKind`/`WeatherAttribution`、`store.weatherByDay`/`store.weatherAttribution`、`WeatherAvailability.makeDefaultProvider`)、既存 `IconView`/`tcFont`/`Tokens`/`Link`/`AppCopy.for(_:)`。

- [ ] **Step 1: AppCopy に 3 項目を追記(5 サイト + 1 アクセサ)**

`AppCopy.swift` の既存の並び(`workerDiagnostics*` の後など、末尾の文言群)に、既存の平文フィールド 2 つとクロージャ 1 つを、`daysValue`/`pasteLimitToast` と**同じ様式**で足す:

- フィールド宣言:
```swift
  /// Apple Weather 商標(翻訳しない・両言語同一)。
  public let weatherBrand: String
  /// 帰属バッジのアクセシビリティ読み上げ。
  public let weatherAttributionLabel: String
  private let weatherPrecipitationText: @Sendable (Int) -> String
```
- 公開アクセサ(`daysValue` 等と同じ場所):
```swift
  /// 「降水 N%」。
  public func weatherPrecipitation(_ percent: Int) -> String { weatherPrecipitationText(percent) }
```
- init 引数:
```swift
    weatherBrand: String,
    weatherAttributionLabel: String,
    weatherPrecipitation: @escaping @Sendable (Int) -> String,
```
- init 代入:
```swift
    self.weatherBrand = weatherBrand
    self.weatherAttributionLabel = weatherAttributionLabel
    self.weatherPrecipitationText = weatherPrecipitation
```
- ja 値(`for(.ja)`):
```swift
    weatherBrand: "Apple Weather",
    weatherAttributionLabel: "Apple Weather の天気",
    weatherPrecipitation: { "降水 \($0)%" },
```
- en 値(`for(.en)`):
```swift
    weatherBrand: "Apple Weather",
    weatherAttributionLabel: "Weather by Apple Weather",
    weatherPrecipitation: { "\($0)% rain" },
```

（`weatherBrand` を AppCopy に置くのは、`Text("Apple Weather")`(13 文字)を直書きすると CopyBoundary の
「inline Text ≥12 文字」に触れるため。AppCopy 経由なら非リテラルで通る。）

- [ ] **Step 2: `WeatherChip.swift` を作る**

```swift
import SwiftUI
import TripCheckAppCore
import TripCheckKit

/// 1 日の天気チップ(アイコン + 最高/最低℃ + 降水%)。表示専用。
struct WeatherChip: View {
  let day: WeatherDay
  let copy: AppCopy

  var body: some View {
    HStack(spacing: 4) {
      IconView(Self.icon(for: day.kind), size: 12, color: Tokens.Color.ink2)
      Text("\(day.temperatureMaxC)° / \(day.temperatureMinC)°")
        .tcFont(.label)
        .foregroundStyle(Tokens.Color.ink2)
      if let percent = day.precipitationPercent {
        Text(copy.weatherPrecipitation(percent))
          .tcFont(.label)
          .foregroundStyle(Tokens.Color.muted)
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("plan.weatherChip.\(day.index)")
  }

  static func icon(for kind: WeatherKind) -> Icon {
    switch kind {
    case .clear, .partly: return .sun
    case .cloudy: return .cloud
    case .fog: return .fog
    case .rain: return .rain
    case .snow: return .snow
    case .storm: return .storm
    }
  }
}

/// Apple 必須の帰属。テキスト商標 + 法的リンク(Link)。
struct WeatherAttributionBadge: View {
  let attribution: WeatherAttribution
  let copy: AppCopy

  var body: some View {
    Link(destination: attribution.legalPageURL) {
      HStack(spacing: 3) {
        Text(copy.weatherBrand)
          .tcFont(.label)
          .foregroundStyle(Tokens.Color.muted)
        IconView(.external, size: 10, color: Tokens.Color.muted)
      }
    }
    .accessibilityIdentifier("plan.weatherAttribution")
    .accessibilityLabel(copy.weatherAttributionLabel)
  }
}
```

- [ ] **Step 3: `DayHeaderRow.swift` にチップと帰属を差す**

`DayHeaderRow` の見出し HStack(現状 22–31 付近、日付ラベル+summary+`Spacer(minLength: 0)`+矢印)で、`Spacer` の前に、その日の天気があれば `WeatherChip` と `WeatherAttributionBadge` を出す。`copy` は body 冒頭で `AppCopy.for(store.request.locale)` を取得(既存 18 行目と同じ)。

```swift
      if let weather = store.weatherByDay[index] {
        WeatherChip(day: weather, copy: copy)
        if let attribution = store.weatherAttribution {
          WeatherAttributionBadge(attribution: attribution, copy: copy)
        }
      }
      Spacer(minLength: 0)
```

（`index` は `DayHeaderRow` の引数。`store.weatherByDay` は日 index キー。天気が無ければ何も出さない。）

- [ ] **Step 4: `TripCheckApp.swift` で注入**

`PlannerStore(...)` 呼び出しの引数末尾(`intentParser:` の次)に:

```swift
      weatherProvider: WeatherAvailability.makeDefaultProvider(uiTesting: isUITesting)
```

- [ ] **Step 5: `TripCheck.entitlements` に WeatherKit を足す**

`<dict>` 内に(既存 App Attest キーは残す):

```xml
	<key>com.apple.developer.weatherkit</key>
	<true/>
```

- [ ] **Step 6: UI テストを 1 本足す**

`PlannerFlowTests.swift` 末尾に。`-uiTesting` では `CannedWeatherProvider` が注入される。**サンプル計画の日付がホライズン内(今日〜+10日)でないと canned でもチップが出ない**点に注意 —— 実装者はアプリを実際に動かして確認し、`start.seeExample` の計画が日付を持ちホライズン内ならそのまま、そうでなければ Start 画面で今日から数日内の日付を入れてから構築するようにテストを組み、天気チップと帰属バッジの表示を assert する。

```swift
  /// 天気チップと Apple Weather 帰属が日ヘッダーに出る(canned プロバイダ)。
  @MainActor
  func testWeatherChipAndAttributionAppear() {
    let app = launch()
    // （必要なら)今日から数日内の日付を入れてから構築する導線をここに置く。
    app.buttons["start.seeExample"].tap()
    XCTAssertTrue(app.staticTexts["plan.hero"].waitForExistence(timeout: 30))
    // 天気が出ている日タブを選ぶ(0 日目で出なければ、日付が入る導線に切り替える)。
    XCTAssertTrue(app.otherElements["plan.weatherChip.0"].waitForExistence(timeout: 10)
      || app.staticTexts["plan.weatherChip.0"].waitForExistence(timeout: 1))
    XCTAssertTrue(app.buttons["plan.weatherAttribution"].waitForExistence(timeout: 5)
      || app.links["plan.weatherAttribution"].waitForExistence(timeout: 1))
  }
```

（実装者へ: `WeatherChip`/`WeatherAttributionBadge` の a11y 要素種別(staticText/otherElement/button/link)は実機の XCUIElementType に合わせて assert を確定させること。`Link` は `app.links[...]`。天気が出る導線が sample で確定できないなら、日付投入まで含めた決定的なフローにする。)

- [ ] **Step 7: 手順書 `apple/docs/weatherkit-check.md` を書く**

```markdown
# WeatherKit 確認手順

WeatherKit は有料会員の entitlement(`com.apple.developer.weatherkit`)が要る。自動テストは
CannedWeatherProvider で回るので、本物の予報はここでだけ確かめる。

## 1. capability を有効化
Apple Developer のアプリ ID に WeatherKit を有効化し、`TripCheck.entitlements` に
`com.apple.developer.weatherkit = YES`(本計画で追加済み)。Xcode の Signing で自動プロビジョニング。

## 2. Simulator / 実機で確認
- 今日から 10 日以内の日付を持つ旅程を作る(ホライズン内でないと出ない)。
- プラン画面の日ヘッダーに天気チップ(アイコン+最高/最低℃+降水%)が出る。
- 「Apple Weather」帰属バッジが出て、タップで法的ページが開く。
- 天気が無い日(日付未定・10 日超先)はチップも帰属も出ない(仕様どおり)。

## 3. うまく出ないとき
- entitlement/プロビジョニングが有効か、旅程の日付がホライズン内か、停留所が解決済みかを見る。
- Simulator の一部構成は WeatherKit 非対応 —— その場合は実機で確認。
```

- [ ] **Step 8: 全体ビルド + テスト**

Run: `cd apple && ./tools/verify-app.sh`(xcodegen generate → build → unit + UI)。長めのタイムアウト。
Expected: ビルド成功・**新規警告ゼロ**、`TripCheckTests`(CopyBoundary/BannedTerms 含む)緑、`TripCheckUITests`(既存 + 新規 `testWeatherChipAndAttributionAppear`)緑。CopyBoundary が緑 = 天気 UI に日本語直書き・12 文字以上の inline Text 無し。

- [ ] **Step 9: コミット**

```bash
cd apple
git add TripCheck/Screens/Plan/WeatherChip.swift TripCheck/Screens/Plan/DayHeaderRow.swift Packages/TripCheckKit/Sources/TripCheckAppCore/Presentation/AppCopy.swift TripCheck/App/TripCheckApp.swift TripCheck/Resources/TripCheck.entitlements TripCheckUITests/PlannerFlowTests.swift docs/weatherkit-check.md
git commit -m "The day header wears its weather, and Apple Weather signs it"
```

---

## Self-Review(計画者による確認)

- **spec 網羅**: §4 型→T1。§5 WeatherKit 呼び出し+畳み込み+pure helpers→T2。§5.1 condition→kind 表→T2。§6 取得・世代ガード・座標平均・ホライズン→T3。§7 UI チップ+帰属バッジ(テキスト Link)→T4。§8 entitlement→T4。§9 テスト→各 T。§10 落とし穴(帰属無しは出さない・TZ 注入・非対応で空)→T2/T3/T4。
- **Kit 不可侵**: 追加は AppCore の `Weather/` と `Store/` extension、アプリ本体、テストのみ。`Sources/TripCheckKit/` は触らない。
- **型整合**: `WeatherProviding`(T1)を `CannedWeatherProvider`/`AppleWeatherProvider`(T1/T2)が実装、`WeatherAvailability`(T2)が返し、`PlannerStore`(T3)が保持、`DayHeaderRow`/`WeatherChip`(T4)が消費。`WeatherMath`(T2)を T3 が使用。`bundle.plan.days[].date: String?`→`CalendarDate(_:)` でパース。
- **プレースホルダ無し**: 全 Step に実コード/実コマンド。T3 の取得系テストと T4 の UI テストは「既存 route テスト/実機に合わせて確定」と明示(環境依存の確定を実装者に委ねる箇所を限定・明記)。
- **表示専用の担保**: feasibility/verified/CriticalFact に触れない(T3 は表示状態のみ、Kit エンジン不介入)。
