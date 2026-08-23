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
