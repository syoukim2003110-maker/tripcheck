import Foundation
import Testing
@testable import TripCheckAppCore
import TripCheckKit

@MainActor private func builtSwitzerland(hotel: Bool = false) async -> (BuiltTripPlan, PlannerContext) {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  if hotel {
    store.edit.hotelQuery = "Bern"
    store.edit.resolvedBase = ResolvedStop(id: "hotel-bern", name: "Hotel Bern", area: "Bern", latitude: 46.948, longitude: 7.44, sourceUrl: "", verifiedAt: "", confidence: .medium, planningDurationMinutes: 0, isAnchor: false, input: "Bern", inputIndex: 0, address: "", countryCode: "CH", provider: .apple)
  }
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

  let (hotelPlan, _) = await builtSwitzerland(hotel: true)
  let day = hotelPlan.days[0]
  let withHotel = RouteRequests.legs(plan: hotelPlan, overrides: [:])
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

  // 使用中でも、3 時間歩く道は測らない(90 分規則が使用中の手段より後に効く)。
  let walkedTooFar = RouteRequests.Leg(legKey: "a::b", from: stop("a", 46.948, 7.447), to: stop("b", 47.05, 8.30), dayIndex: 0, date: nil, clock: "09:00", modeInUse: .walk)
  #expect(!RouteRequests.contenders(for: walkedTooFar, plan: plan, context: context).contains(.walk))

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
///
/// ホテルつきの見本で見る。ホテル無しの 4 日は直行レグが 2 本しかなく(残りは条件付きアクセス)、
/// 日付も無いので要求は 2 件 —— 上限も徒歩も、そこでは何も起きないまま黙って通ってしまう。
@Test @MainActor func requestsArePrioritisedAndCapped() async {
  let (plan, context) = await builtSwitzerland(hotel: true)
  let all = RouteRequests.requests(plan: plan, context: context, overrides: [:], selectedDay: 2, now: Date())
  #expect(!all.isEmpty && all.allSatisfy { $0.mode != .transit })
  #expect(all.contains { $0.mode == .walk })
  #expect(all.filter { $0.mode == .walk }.allSatisfy { $0.departure == nil })
  let dayOf = Dictionary(RouteRequests.legs(plan: plan, overrides: [:]).map { ($0.legKey, $0.dayIndex!) }, uniquingKeysWith: { a, _ in a })
  let days = all.map { dayOf[$0.legKey]! }
  let rest = days.drop(while: { $0 == 2 })
  #expect(days.first == 2 && !rest.contains(2) && Array(rest) == rest.sorted())
  let capped = RouteRequests.requests(plan: plan, context: context, overrides: [:], selectedDay: 0, now: Date(), limit: 3)
  #expect(capped.count == 3 && all.count > 3)
  #expect(capped.allSatisfy { dayOf[$0.legKey] == 0 })   // 切られて残るのは選択中の日
  #expect(RouteRequests.maximumPerBuild == 120)
}

/// 日付が入れば公共交通も要求する。窓(−7〜+100 日)の外にある旅は、同じ旅程でも 1 件も頼まない
/// —— 出発は 30 分バケットの上に乗る。
@Test @MainActor func aDatedPlanAsksForTransitOnTheHalfHour() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  store.request.tripStartDate = Destinations.localDateIn(timeZone: Destinations.byId(.switzerland).timeZone).adding(days: 20).description
  await store.build()
  let plan = store.bundle!.plan, context = store.bundle!.request.context
  let now = Date()
  let transit = RouteRequests.requests(plan: plan, context: context, overrides: [:], selectedDay: 0, now: now).filter { $0.mode == .transit }
  #expect(!transit.isEmpty)
  #expect(transit.allSatisfy { $0.departure.map { RouteRequests.bucket($0) == $0 } ?? false })
  let day = 86_400.0
  // 同じ旅程を窓の外から見る: 200 日前の「今」からは先すぎ、30 日後の「今」からは過ぎている。
  for shifted in [now.addingTimeInterval(-200 * day), now.addingTimeInterval(30 * day)] {
    #expect(RouteRequests.requests(plan: plan, context: context, overrides: [:], selectedDay: 0, now: shifted).allSatisfy { $0.mode != .transit })
  }
}
