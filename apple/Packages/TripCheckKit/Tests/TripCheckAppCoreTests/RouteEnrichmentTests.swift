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
  // 出典は `.live` にならない。素の見本では `nil`(まだ誰も出典を書いていない)と `.estimate`
  // の両方が出るので、表明するのは「live を名乗るレグが 1 本も無い」ほう。
  let legs = store.bundle?.plan.days.flatMap(\.legs) ?? []
  #expect(!legs.isEmpty && legs.allSatisfy { $0.comparison.recommended.source != .live })
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
