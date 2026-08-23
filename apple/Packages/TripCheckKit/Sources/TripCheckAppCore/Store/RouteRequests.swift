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
    // 日付は空港レグの前提ではない: 日付未定の旅でも徒歩・車は測れる(spec §4.2)。
    if let base = plan.selectedBase?.routeStop {
      let firstDate = plan.days.first?.date.flatMap({ CalendarDate($0) })
      for constraint in plan.airportConstraints {
        guard let airport = Destinations.airport(destination, code: constraint.airport) else { continue }
        let airportStop = RouteStop(id: "airport-\(airport.code.lowercased())", name: airport.code, area: airport.code, latitude: airport.latitude, longitude: airport.longitude, sourceUrl: airport.sourceUrl, verifiedAt: "", confidence: .medium, planningDurationMinutes: 0, isAnchor: true)
        let mode: TransportMode = preferDriving ? .taxi : .transit
        if constraint.direction == .arrival {
          // 到着便の出発時刻 = 便時刻 + 空港所要分(spec §4.2)。`cityTime` は入国も移送も済んだ
          // 「街にいられる時刻」(`Builder/AirportComparison.swift:104-106`)なので、そこから空港を出る
          // 道のりを測ると入国と移送を二重に数える。
          //
          // 日付は便の暦日に戻してから数える: `plan.days[0].date` は
          // `tripStartDate + max(0, cityTimeDayOffset)`(`Builder/TripBuilder.swift:268-271`)なので、
          // 深夜着はそこから offset を引くと便の日に戻る。空港を出るのが翌日になるぶんは
          // `minutes / 1440` が改めて足す。
          let flightDate = firstDate?.adding(days: -max(0, constraint.cityTimeDayOffset))
          let minutes = (ClockTime(constraint.flightTime)?.minutes ?? 0) + constraint.airportMinutes
          add(airportStop, base, dayIndex: nil, date: flightDate?.adding(days: minutes / 1440), clock: ClockTime(minutes: minutes).description, fallback: mode)
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
    func minutes(_ mode: TransportMode) -> Int? { comparison.options.first { $0.mode == mode }?.minutes }
    // 推定を持たないモード(アクセス方針で刈られたとき)は「遠すぎて選べない」と同じ扱いにする。
    let walk = minutes(.walk) ?? Int.max
    var modes: [TransportMode]
    if plan.travelPreference == .car {
      modes = walk <= 15 ? [.taxi, .walk] : [.taxi]
    } else {
      modes = [.transit]
      if walk <= 35 { modes.append(.walk) }
      let km = straightLineDistanceKm(GeoPoint(latitude: leg.from.latitude, longitude: leg.from.longitude), GeoPoint(latitude: leg.to.latitude, longitude: leg.to.longitude))
      if km >= 4, let taxi = minutes(.taxi), let transit = minutes(.transit), taxi <= transit + 5 { modes.append(.taxi) }
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
    guard planned < now else { return planned }
    // 予定の時刻が過ぎていたら「今」に寄せる。**寄せた値は切り上げる** —— 呼び手はこの後
    // `bucket` で切り捨てるので、そのまま渡すと最大 29 分前の出発を尋ねることになり、
    // 地図はもう出てしまった便の時刻表で答える。切り上げた値は既にバケットの境目なので、
    // 呼び手の切り捨てを通しても動かない。
    return bucketUp(now)
  }

  public static func bucket(_ date: Date) -> Date {
    Date(timeIntervalSince1970: (date.timeIntervalSince1970 / bucketSeconds).rounded(.down) * bucketSeconds)
  }

  /// 次のバケットの境目(既に境目ならそのまま)。過ぎた出発を「今」へ寄せるときだけ使う。
  static func bucketUp(_ date: Date) -> Date {
    Date(timeIntervalSince1970: (date.timeIntervalSince1970 / bucketSeconds).rounded(.up) * bucketSeconds)
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
