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
      try? await Task.sleep(for: .seconds(300))
      return .failed
    }
  }
  let peak = Peak()
  let requests = (0..<12).map { walkRequest("s\($0)::t\($0)") }
  // 窓の広さを見る側に締切を混ぜない。既定の 40 秒は**実時計**で、`--parallel` の 800 本が
  // 走る機械では 12 件 × 30 ミリ秒の眠りがそれを追い越すことがある(実際に赤くなった)。
  // 締切そのものは下の 2 本目が測る。
  let answers = await RouteFetcher.fetch(requests, provider: Counting(peak: peak), locale: .en, deadline: .seconds(600), onSettled: { _, _ in })
  let observed = await peak.peak
  #expect(answers.count == 12 && observed == 4)
  // 締切が鳴れば、提供元が 300 秒抱え込んでいても待たずに閉じる(取り消しで解ける)。
  // 上限を 30 秒に取るのは、忙しい機械の遅れを許しても「提供元を待っていない」が言えるため。
  let clock = ContinuousClock(), start = clock.now
  let late = await RouteFetcher.fetch(requests, provider: Hanging(), locale: .en, deadline: .milliseconds(50), onSettled: { _, _ in })
  #expect(late.isEmpty && clock.now - start < .seconds(30))
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

/// 走っている取得を畳んだ後に取りに行くものが無かったら、数え終わっていない進捗は消える
/// —— 残すと二度と進まない行が画面に居座る。
@Test @MainActor func anAbandonedFetchLeavesNoProgressRowBehind() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil, routeProvider: FakeRouteProvider(delay: .seconds(30)))
  store.loadSample(.switzerland)
  await store.build()
  #expect(store.routeProgress?.isComplete == false)
  // 2 度目は取りに行くものが無い(1 度目で全部 `attemptedRoutes` に入った)。走っている
  // 取得はここで畳まれるので、その進捗はもう誰も数えない。
  store.startRouteEnrichment()
  #expect(store.routeProgress == nil && store.routeTask == nil)
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
  #expect(after == before)
}

// MARK: - Fix round 1: 置換は旅行者の組み直しに割り込まない

/// 組み上がった答えを `commit` の直前で止めておく関所(`PlannerStore.buildGate` に差す)。
/// `PlannerStoreBuildTests` の同名アクターと同じ作りで、あちらは `private` なのでここにも置く。
private actor RouteBuildGate {
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

  func open() {
    opened = true
    for waiter in departures { waiter.resume() }
    departures.removeAll()
  }
}

/// 置換は、旅行者が頼んだ組み直しの最中には始まらない。始めると、あちらの答えが世代の
/// 食い違いで黙って落ちる —— 押したのに何も起きない編集になる。
@Test @MainActor func aReplacementNeverSwallowsTheEditTheTravellerJustMade() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil, routeProvider: FakeRouteProvider(delay: .milliseconds(60)))
  store.loadSample(.switzerland)
  await store.build()   // 関所はまだ無い。ここで取得が走り出す
  let fetching = store.routeTask
  let id = store.bundle!.plan.days[0].stops[0].stop.id
  let gate = RouteBuildGate()
  store.buildGate = { await gate.hold() }

  // 旅行者の編集を、答えが出来て commit する手前で止める。その間に取得が settle する。
  async let editing: Void = store.setStayMinutes(stopId: id, minutes: 120)
  await gate.waitUntilHeld()
  await fetching?.value
  // 割り込まずに並んだ。置換はまだ 1 度も起きていない。
  #expect(store.routeReplacements == 0 && store.deferredRouteReplacement != nil)

  store.buildGate = nil
  await gate.open()
  await editing
  #expect(store.edit.userStayMinutes[id] == 120)   // 編集は飲み込まれずに着地した
  #expect(store.canUndo)
  await store.awaitRouteEnrichment()
  // 置換はちょうど 1 回(`routeReplacements` はトーストと同じ行で 1 つ増えるので、
  // 「実経路のトーストは 1 回だけ」と同じことを言っている)。
  #expect(store.routeReplacements == 1)
  #expect(store.view.toast?.kind == .info && store.view.toast?.canUndo == false)
  #expect(store.view.toast?.text.hasPrefix(AppCopy.for(store.request.locale).routesUpdatedToast) == true)
  #expect(store.routeTask == nil && store.deferredRouteReplacement == nil)
  #expect(store.bundle!.plan.days.flatMap(\.legs).contains { $0.comparison.options.contains { $0.source == .live } })
}

/// 取得の最中に組み直しが始まったら、古い答えは誰の答えでもない —— キャッシュにも入らず、
/// 遅れて届いた分で旅程が書き換わることもない。
@Test @MainActor func aRebuildStartedMidFetchDropsTheAnswersInFlight() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil, routeProvider: FakeRouteProvider(delay: .milliseconds(60)))
  store.loadSample(.switzerland)
  await store.build()
  let fetching = store.routeTask
  #expect(fetching != nil)
  let gate = RouteBuildGate()
  store.buildGate = { await gate.hold() }

  async let rebuilding: Void = store.build()   // 取得の最中に組み直す。commit の手前で止まる
  await gate.waitUntilHeld()
  await fetching?.value                        // 古い取得はここで答えを持って帰る
  #expect(store.liveRoutes.isEmpty)            // 世代が違うのでキャッシュにも入らない
  #expect(store.routeReplacements == 0 && store.routeProgress == nil)

  store.buildGate = nil
  await gate.open()
  await rebuilding
  await store.awaitRouteEnrichment()           // 組み直した旅程で測り直し、そこで初めて置換
  #expect(store.routeReplacements == 1 && store.routeTask == nil)
}

/// 元に戻す操作は、並んでいた置換を連れて来ない —— 戻した直後に「実経路で更新しました」が
/// 出ると、どちらへ動いたのか分からなくなる(戻す側の組み直しが測った分を自分で畳み込む)。
@Test @MainActor func undoDoesNotDragAParkedReplacementAlongWithIt() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil, routeProvider: FakeRouteProvider(delay: .milliseconds(40)))
  store.loadSample(.switzerland)
  await store.build()
  let id = store.bundle!.plan.days[0].stops[0].stop.id
  await store.setStayMinutes(stopId: id, minutes: 120)   // 戻せるものを 1 つ積む
  await store.awaitRouteEnrichment()
  let replacementsBefore = store.routeReplacements
  // 問いかけを開いて置換を保留させる。
  store.pendingApply = PendingGuardedEdit(candidate: store.edit, bundle: store.bundle!, label: "x", bufferDeltaMinutes: 0, generation: store.buildGeneration, sideEffects: .none)
  store.view.pendingHardEdit = .edit(conflicts: [], extraConflicts: [], fallbackTitle: "t")
  store.liveRoutes.removeAll()
  store.attemptedRoutes.removeAll()
  store.startRouteEnrichment()
  await store.awaitRouteEnrichment()
  #expect(store.deferredRouteReplacement != nil)

  await store.undo()
  await store.awaitRouteEnrichment()
  #expect(store.edit.userStayMinutes[id] == nil)   // 戻った
  #expect(store.deferredRouteReplacement == nil)
  #expect(store.routeReplacements == replacementsBefore)
  #expect(store.view.toast == nil)   // 戻す操作は自分のトーストも他人のトーストも出さない
}
