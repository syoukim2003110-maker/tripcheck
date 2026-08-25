import XCTest
import Foundation
@testable import TripCheckAppCore
import TripCheckKit

/// 組み上がった答えを `commit` の直前で止めておく関所(`PlannerStore.buildGate` に差す)。
/// `PlannerStoreBuildTests.swift` の同名 actor と同じ形(`private` なのでファイルをまたげない
/// —— ここに複製する)。詳細な理由はそちらのコメントを参照。
private actor BuildGate {
  private var held = false
  private var opened = false
  private var arrivals: [CheckedContinuation<Void, Never>] = []
  private var departures: [CheckedContinuation<Void, Never>] = []

  /// 組み立て側。着いたことを知らせ、`open()` が来るまで待つ。
  func hold() async {
    held = true
    for waiter in arrivals { waiter.resume() }
    arrivals.removeAll()
    guard !opened else { return }
    await withCheckedContinuation { departures.append($0) }
  }

  /// テスト側。組み立てが関所に着く(= 答えが出来た)まで待つ。
  func waitUntilHeld() async {
    guard !held else { return }
    await withCheckedContinuation { arrivals.append($0) }
  }

  /// テスト側。留めていた答えを先へ通す。
  func open() {
    opened = true
    for waiter in departures { waiter.resume() }
    departures.removeAll()
  }
}

final class PlannerStoreWeatherTests: XCTestCase {

  // MARK: - Pure helpers

  @MainActor
  func testAveragedCoordinateRoundsToTwoDecimals() async {
    let c = PlannerStore.averagedCoordinate([
      GeoPoint(latitude: 35.001, longitude: 139.004),
      GeoPoint(latitude: 35.019, longitude: 139.016),
    ])
    XCTAssertEqual(c?.latitude, 35.01)
    XCTAssertEqual(c?.longitude, 139.01)
    XCTAssertNil(PlannerStore.averagedCoordinate([]))
  }

  @MainActor
  func testHorizonAcceptsTodayToPlusTenOnly() async {
    let today = CalendarDate(year: 2026, month: 9, day: 1)!
    XCTAssertTrue(PlannerStore.withinHorizon(today, from: today, days: 10))
    XCTAssertTrue(PlannerStore.withinHorizon(CalendarDate(year: 2026, month: 9, day: 11)!, from: today, days: 10))
    XCTAssertFalse(PlannerStore.withinHorizon(CalendarDate(year: 2026, month: 9, day: 12)!, from: today, days: 10))
    XCTAssertFalse(PlannerStore.withinHorizon(CalendarDate(year: 2026, month: 8, day: 31)!, from: today, days: 10))
  }

  // MARK: - Fetch against a built plan (mirrors RouteEnrichmentTests' plan-build setup)

  /// スイスの見本を、ホライズン内の日付で組み立てる。`loadSample` 自体は `tripStartDate` を
  /// 置かないので(見本は日付未定のまま組める)、天気を取りに行かせるにはここで入れる。
  @MainActor
  private func buildSwissSampleWithDate(weatherProvider: any WeatherProviding) async -> PlannerStore {
    let store = PlannerStore(resolvers: [], store: nil, weatherProvider: weatherProvider)
    store.loadSample(.switzerland)
    let today = Destinations.localDateIn(timeZone: TimeZone.current.identifier)
    store.request.tripStartDate = today.adding(days: 1).description   // 4 日とも十分にホライズン内
    await store.build()
    return store
  }

  private func fakeDays(count: Int) -> [WeatherDay] {
    (0..<count).map { index in
      WeatherDay(
        index: index, date: CalendarDate(year: 2026, month: 1, day: 1)!, kind: .clear,
        temperatureMaxC: 20 - index, temperatureMinC: 10 - index, precipitationPercent: 10
      )
    }
  }

  /// プランが建った直後に天気が取れて、日ごとの表示に埋まる。
  @MainActor
  func testWeatherFillsAfterBuildWhenProviderIsInjected() async {
    let provider = FakeWeatherProvider(days: fakeDays(count: 4))
    let store = await buildSwissSampleWithDate(weatherProvider: provider)
    await store.awaitWeatherEnrichment()

    XCTAssertEqual(store.bundle?.plan.days.count, 4)
    XCTAssertFalse(store.weatherByDay.isEmpty)
    XCTAssertNotNil(store.weatherAttribution)
    // 4 日とも stops を持つ見本なので、要求した日ぶんだけ答えが埋まる。
    XCTAssertEqual(store.weatherByDay.count, provider.recorder.lastRequests.count)
  }

  /// 帰属が無い応答は出さない(Apple: 帰属無しで天気を見せない)。
  @MainActor
  func testNilAttributionKeepsWeatherEmpty() async {
    let provider = FakeWeatherProvider(days: fakeDays(count: 4), attribution: nil)
    let store = await buildSwissSampleWithDate(weatherProvider: provider)
    await store.awaitWeatherEnrichment()

    XCTAssertFalse(provider.recorder.lastRequests.isEmpty)   // 取得そのものは走った
    XCTAssertTrue(store.weatherByDay.isEmpty)
    XCTAssertNil(store.weatherAttribution)
  }

  /// provider 未注入なら何も起きない(既存の route enrichment の同じ契約)。
  @MainActor
  func testWithoutAProviderNothingIsFetched() async {
    let store = PlannerStore(resolvers: [], store: nil)
    store.loadSample(.switzerland)
    let today = Destinations.localDateIn(timeZone: TimeZone.current.identifier)
    store.request.tripStartDate = today.adding(days: 1).description
    await store.build()
    await store.awaitWeatherEnrichment()

    XCTAssertNil(store.weatherProvider)
    XCTAssertTrue(store.weatherByDay.isEmpty)
    XCTAssertNil(store.weatherAttribution)
  }

  /// 世代ガード: 取得が返る前に世代が進んだら、遅れて届いた答えは `weatherByDay` に載らない。
  @MainActor
  func testStaleWeatherResponseIsDiscardedByGenerationGuard() async {
    let provider = FakeWeatherProvider(days: fakeDays(count: 4), delay: .milliseconds(150))
    let store = await buildSwissSampleWithDate(weatherProvider: provider)
    let running = store.weatherTask
    XCTAssertNotNil(running)   // 取得は走り出している(まだ返っていない)

    store.invalidateWeather()   // 世代を進める。走っていた取得はもう誰の答えでもない
    await running?.value        // 遅れて届く答えを実際に待つ

    XCTAssertTrue(store.weatherByDay.isEmpty)
    XCTAssertNil(store.weatherAttribution)
  }

  /// Fix round 1: 実経路が揃って `replaceWithLiveRoutes` が静かに置換すると、天気も測り直す
  /// —— 置換で日割りが変わりうるので(spec のコメントどおり)、古い日 index の天気を残さない。
  @MainActor
  func testAQuietRouteReplacementRefetchesWeather() async {
    let weatherProvider = FakeWeatherProvider(days: fakeDays(count: 4))
    let store = PlannerStore(
      resolvers: [CatalogResolver()], store: nil,
      routeProvider: FakeRouteProvider(), weatherProvider: weatherProvider
    )
    store.loadSample(.switzerland)
    let today = Destinations.localDateIn(timeZone: TimeZone.current.identifier)
    store.request.tripStartDate = today.adding(days: 1).description

    await store.build()
    await store.awaitWeatherEnrichment()
    let callsAfterBuild = weatherProvider.recorder.callCount
    XCTAssertGreaterThan(callsAfterBuild, 0)

    await store.awaitRouteEnrichment()   // 実経路の取得+静かな置換が落ち着くまで待つ
    XCTAssertEqual(store.routeReplacements, 1)
    await store.awaitWeatherEnrichment()   // 置換が起こした天気の取り直しを待つ

    XCTAssertGreaterThan(weatherProvider.recorder.callCount, callsAfterBuild)   // 置換の後にもう一度呼ばれた
    XCTAssertFalse(store.weatherByDay.isEmpty)
    XCTAssertNotNil(store.weatherAttribution)
  }

  // MARK: - Cancel restores the kept plan's weather

  /// 組み直しを取り消すと、保持していたプランの天気が戻る。`build()` は頭で `invalidateWeather()`
  /// を呼び、賭けに勝ったとき(commit まで届いたとき)だけ `startWeatherEnrichment()` が測り直す
  /// —— 取り消して 1 本目のプランへ戻る側は、これまで測り直さずに欄が空のまま残っていた。
  @MainActor
  func testCancellingARebuildRestoresWeatherForTheKeptPlan() async {
    let provider = FakeWeatherProvider(days: fakeDays(count: 4))
    let store = await buildSwissSampleWithDate(weatherProvider: provider)
    await store.awaitWeatherEnrichment()
    XCTAssertFalse(store.weatherByDay.isEmpty)   // 1 本目のプランは天気が埋まっている

    let gate = BuildGate()
    store.buildGate = { await gate.hold() }
    async let running: Void = store.build()      // 2 本目。頭の invalidateWeather() が空にする
    await gate.waitUntilHeld()

    XCTAssertEqual(store.view.screen, .building)
    XCTAssertTrue(store.weatherByDay.isEmpty)    // build 開始時点で空にされている

    store.cancelBuild()   // 既定 refetchWeather: true。1 本目(保持したプラン)へ戻る

    await gate.open()
    await running
    await store.awaitWeatherEnrichment()

    XCTAssertEqual(store.view.screen, .plan)
    XCTAssertFalse(store.weatherByDay.isEmpty)   // 取り消し後、保持したプランの天気が戻る
  }
}
