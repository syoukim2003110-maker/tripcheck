import Foundation

/*
 * 街にいられる時間の外枠。到着便は「空港に着いてから街で動き出せる時刻」、出発便は
 * 「街を出なければならない時刻」を決め、どちらも日付をまたぐことがある。
 *
 * lib/trip-builder.ts:813-833 (`airportStop`)、:835-853 (`measuredAirportTransferMinutes`)、
 * :855-870 (`measuredAirportTransferCount`)、:872-948 (`buildAirportConstraints`)。
 * 境界時刻そのものの算術は `Builder/AirportComparison.swift`(Task 8)が持っている。
 */

public enum Airports {
  /// TS `airportStop` (`lib/trip-builder.ts:813-833`)。
  ///
  /// `buildAirportConstraints` が使うのは `id`(実測経路の鍵)と座標(Google マップ URL)だけで、
  /// 名前は出力のどこにも現れない。TS が渡す `locale` は表示名にしか効かないため、
  /// task-14-brief.md の Interfaces どおり引数から落とし、既定の `.en` で組む。
  static func airportStop(_ airport: DestinationAirport, locale: PlannerLocale = .en) -> RouteStop {
    RouteStop(
      id: "airport-\(airport.code.lowercased())",
      name: (locale == .ja ? airport.names[.ja] : airport.names[.en]) ?? airport.names[.en] ?? "",
      area: airport.code,
      latitude: airport.latitude,
      longitude: airport.longitude,
      sourceUrl: airport.sourceUrl,
      verifiedAt: "2026-07-18",
      confidence: .medium,
      planningDurationMinutes: 0,
      isAnchor: true
    )
  }

  /// TS `measuredAirportTransferMinutes` (`lib/trip-builder.ts:835-853`)。
  ///
  /// 空港⇄ホテルの移送は目的地プロファイルの全国推定から始まり、このホテルについて実測された
  /// Google 経路が届いた瞬間にそれへ差し替わる。鍵は先読みが空港レグに使う id と同じで、
  /// 先に見るモードはこの旅で実際に要求したモードに合わせる。
  ///
  /// TS は `context.liveTransitMinutes` などを直接読むが、Swift 版ではそれらを束ねた
  /// `TravelInputs` を受ける(`:2069-2077` で `travel.transit = context.liveTransitMinutes`、
  /// `travel.driving = context.liveDrivingMinutes`、`travel.transfers =
  /// context.liveTransitTransferCounts`、`travel.preference = context.travelPreference ?? "auto"`
  /// と組まれるので、読む値は同一)。
  static func measuredAirportTransferMinutes(
    travel: TravelInputs,
    destination: Destination,
    airportStopId: String,
    baseId: String?,
    direction: AirportConstraintDirection
  ) -> Int? {
    guard let baseId else { return nil }
    let key = direction == .arrival ? routeLegKey(airportStopId, baseId) : routeLegKey(baseId, airportStopId)
    let preferDriving = travel.preference == .car || destination.mobility == .car_first
    let preferred = preferDriving ? travel.driving?[key] : travel.transit?[key]
    let fallback = preferDriving ? travel.transit?[key] : travel.driving?[key]
    guard let minutes = preferred ?? fallback, minutes > 0 else { return nil }
    return minutes
  }

  /// TS `measuredAirportTransferCount` (`lib/trip-builder.ts:855-870`) — 乗換数は
  /// トランジットで行くときにしか意味を持たない。
  static func measuredAirportTransferCount(
    travel: TravelInputs,
    destination: Destination,
    airportStopId: String,
    baseId: String?,
    direction: AirportConstraintDirection
  ) -> Int? {
    guard let baseId, travel.preference != .car, destination.mobility != .car_first else { return nil }
    let key = direction == .arrival ? routeLegKey(airportStopId, baseId) : routeLegKey(baseId, airportStopId)
    guard let count = travel.transfers?[key], count >= 0, count <= 100 else { return nil }
    return count
  }

  /// TS `buildAirportConstraints` (`lib/trip-builder.ts:872-948`)。
  ///
  /// この目的地の空港リストに無いコードは単に効かない: 日本の旅から残った古い `HND` が
  /// スイスの 1 日を締め上げてはならない(`:874-875`)。
  public static func buildAirportConstraints(
    context: PlannerContext,
    destination: Destination,
    base: TripBase?,
    travel: TravelInputs
  ) -> [AirportConstraint] {
    let flightKind = context.flightKind ?? .international
    let transitMode: GoogleTravelMode = destination.mobility == .car_first ? .driving : .transit

    func constraint(
      direction: AirportConstraintDirection,
      code: String?,
      time: String?
    ) -> AirportConstraint? {
      guard let selected = Destinations.airport(destination, code: code),
            let scheduled = time.flatMap({ ClockTime($0) })?.minutes
      else { return nil }
      let airport = airportStop(selected)
      let measuredTransferMinutes = measuredAirportTransferMinutes(
        travel: travel, destination: destination, airportStopId: airport.id, baseId: base?.id, direction: direction
      )
      let transferCount = measuredAirportTransferCount(
        travel: travel, destination: destination, airportStopId: airport.id, baseId: base?.id, direction: direction
      )
      guard let comparison = AirportComparison.compare(
        options: [AirportOptionInput(
          code: selected.code,
          flightTime: ClockTime(minutes: scheduled).description,
          transferMinutes: measuredTransferMinutes
        )],
        direction: direction == .arrival ? .arrival : .departure,
        flightKind: flightKind,
        destination: destination
      ).first else { return nil }
      return AirportConstraint(
        direction: direction,
        airport: selected.code,
        flightTime: ClockTime(minutes: scheduled).description,
        cityTime: comparison.cityTime,
        cityTimeDayOffset: comparison.cityTimeDayOffset,
        airportMinutes: comparison.airportMinutes,
        transferMinutes: comparison.transferMinutes,
        transferCount: transferCount,
        sourceUrl: selected.sourceUrl,
        // 到着は空港からホテルへ、出発はホテルから空港へ。TS も向きごとに端点を入れ替える
        // (`:917` は `[airport, base]`、`:944` は `[base, airport]`)。同じ順で組むと
        // 出発リンクが「空港から出発してホテルへ向かう」逆走の経路を開いてしまう。
        googleMapsUrl: base.map {
          GoogleMapsUrl.build(
            direction == .arrival ? [airport, $0.routeStop] : [$0.routeStop, airport],
            travelMode: transitMode
          )
        }
      )
    }

    return [
      constraint(direction: .arrival, code: context.arrivalAirport, time: context.arrivalTime),
      constraint(direction: .departure, code: context.departureAirport, time: context.departureTime),
    ].compactMap { $0 }
  }
}
