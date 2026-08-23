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

// MARK: - Task 6: 取得コーディネータ

/// 見本を組んで、取得(と連鎖)が落ち着くまで待った store を返す。
@MainActor private func enrichedSample(_ provider: some RouteProvider, taxiOnFirstLeg: Bool = false) async -> PlannerStore {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil, routeProvider: provider)
  store.loadSample(.switzerland)
  if taxiOnFirstLeg {
    let plain = PlannerStore(resolvers: [CatalogResolver()], store: nil)
    plain.loadSample(.switzerland)
    await plain.build()
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
  actor Peak {
    var inFlight = 0
    var peak = 0
    func enter() { inFlight += 1; peak = max(peak, inFlight) }
    func leave() { inFlight -= 1 }
  }
  struct Counting: RouteProvider {
    let peak: Peak
    func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome {
      await peak.enter()
      try? await Task.sleep(for: .milliseconds(30))
      await peak.leave()
      return .measured(minutes: 5, distanceMeters: nil, geometry: nil, expectedDeparture: nil)
    }
  }
  struct Hanging: RouteProvider {
    func route(_ request: RouteRequest, locale: PlannerLocale) async -> RouteOutcome {
      try? await Task.sleep(for: .seconds(30))
      return .failed
    }
  }
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
  let plain = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  plain.loadSample(.switzerland)
  await plain.build()
  let firstKey = RouteRequests.legs(plan: plain.bundle!.plan, overrides: [:])[0].legKey
  // 車の上書きを置くのは、そのレグに必ず 1 件は要求が立つようにするため(使用中の手段は必ず候補に入る)。
  let store = await enrichedSample(FakeRouteProvider(failing: [firstKey]), taxiOnFirstLeg: true)
  #expect(store.routeProgress?.isComplete == true && store.routeProgress?.estimatedRemaining == 1)
  #expect(store.attemptedRoutes.contains { $0.legKey == firstKey })
  // 表明は「live を名乗らない」ほう。1 本も測れなかったレグの選択肢は `source` を持たないまま
  // (`TravelEstimates.applyLiveTransit` は live 証拠が 1 つも無いレグを素通しする)で、
  // `.estimate` の印が付くのは同じレグの**別の手段**が測れたときだけである。
  let failedLeg = store.bundle!.plan.days.flatMap(\.legs).first { routeLegKey($0.from.id, $0.to.id) == firstKey }
  #expect(failedLeg != nil && failedLeg?.comparison.options.allSatisfy { $0.source != .live } == true)
}

/// 連鎖は 2 世代まで。3 世代目は取りに行かない。
@Test @MainActor func theChainStopsAtTheSecondGeneration() async {
  let provider = FakeRouteProvider()
  let store = await enrichedSample(provider)
  store.attemptedRoutes.removeAll()
  store.liveRoutes.removeAll()
  let before = await provider.log.requests.count
  store.startRouteEnrichment(chainDepth: PlannerStore.maximumRouteChain)
  await store.awaitRouteEnrichment()
  let after = await provider.log.requests.count
  #expect(after == before && store.routeTask == nil)
}
