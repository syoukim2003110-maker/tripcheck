import Foundation
import TripCheckKit

/// 取得の進み具合。`requested` 件のうち `settled` 件が答え(成功・失敗・締切)を持ち、
/// `estimatedRemaining` はどの手段も測れなかった**レグ**の数(要求した鍵のうち `.measured` が 1 つも無いレグ)。
/// 全部測れたら `routeProgress` そのものが `nil` になる。
public struct RouteProgress: Equatable, Sendable {
  public var requested: Int
  public var settled: Int
  public var estimatedRemaining: Int
  public var isComplete: Bool { settled >= requested }
  public init(requested: Int, settled: Int, estimatedRemaining: Int) {
    self.requested = requested
    self.settled = settled
    self.estimatedRemaining = estimatedRemaining
  }
}

extension PlannerStore {
  /// 走っている取得を止め、世代を進める。`keepCache: false` は旅そのものが入れ替わるとき
  /// (`reset()` / 目的地の変更)。`build()` / `cancelBuild()` はキャッシュを残して再利用する。
  func invalidateRoutes(keepCache: Bool) {
    routeTask?.cancel()
    routeTask = nil
    routeGeneration += 1
    attemptedRoutes.removeAll()
    deferredRouteReplacement = nil
    routeProgress = nil
    if !keepCache { liveRoutes.removeAll() }
  }

  // MARK: - 取得コーディネータ(spec §4.4〜4.6)

  /// 置換で日割りが変わって新しいレグが出たとき、追加で取りに行ける世代の数(spec §4.5-6)。
  static let maximumRouteChain = 2

  /// `commit` / `adoptPending` / `adoptHistoryPresent` の直後に呼ぶ。`bundle.plan` から要求を列挙し、
  /// キャッシュに無く未試行のものだけ取りに行く。全部揃っていて未反映なら即置換。
  func startRouteEnrichment(chainDepth: Int = 0) {
    guard let routeProvider, let bundle, chainDepth < Self.maximumRouteChain else { return }
    if chainDepth == 0 { routeTask?.cancel() }   // 連鎖は自分の中から呼ばれるので自分を畳まない
    routeGeneration += 1
    let generation = routeGeneration
    let requests = RouteRequests.requests(
      plan: bundle.plan, context: bundle.request.context, overrides: edit.legModeOverrides,
      selectedDay: view.selectedDay, now: Date())
    // 今の旅程に無い鍵(古いバケット・消えたレグ)は捨てる。同じレグ×手段の答えは 1 つだけ残る。
    let current = Set(requests)
    liveRoutes = liveRoutes.filter { current.contains($0.key) }
    let pending = requests.filter { liveRoutes[$0] == nil && !attemptedRoutes.contains($0) }
    guard !pending.isEmpty else {
      // 取りに行くものは無い。旅程がキャッシュを既に消費していれば仕事そのものが無い ——
      // 世代はもう進めてあるので、外側の task の末尾は触らない。ここで自分で畳む。
      if liveRoutesAreAdopted { routeTask = nil } else { scheduleRouteReplacement(chainDepth: chainDepth) }
      return
    }
    attemptedRoutes.formUnion(pending)
    routeProgress = RouteProgress(requested: pending.count, settled: 0, estimatedRemaining: 0)
    let locale = request.locale
    routeTask = Task { [weak self] in
      let answers = await RouteFetcher.fetch(pending, provider: routeProvider, locale: locale) { [weak self] _, _ in
        guard let self, routeGeneration == generation else { return }
        routeProgress?.settled += 1
      }
      guard let self, routeGeneration == generation, !Task.isCancelled else { return }
      for (request, outcome) in answers { liveRoutes[request] = outcome }
      let measured = Set(answers.compactMap { entry -> String? in
        if case .measured = entry.value { return entry.key.legKey }
        return nil
      })
      let remaining = Set(pending.map(\.legKey)).subtracting(measured).count
      // 全部測れたら進捗そのものを消す(行が消える)。残れば「N 区間は推定のまま」の材料として
      // 次のビルドまで残る。
      routeProgress = remaining == 0 ? nil : RouteProgress(requested: pending.count, settled: pending.count, estimatedRemaining: remaining)
      if !measured.isEmpty { await replaceWithLiveRoutes(chainDepth: chainDepth) }
      if routeGeneration == generation { routeTask = nil }
    }
  }

  /// 取りに行くものは無いが、キャッシュをまだ旅程が消費していないときの置換。世代を進めて
  /// この task を `routeTask` の持ち主にする(連鎖の外側の task の末尾に畳まれないため)。
  private func scheduleRouteReplacement(chainDepth: Int) {
    routeGeneration += 1
    let generation = routeGeneration
    routeTask = Task { [weak self] in
      await self?.replaceWithLiveRoutes(chainDepth: chainDepth)
      guard let self, routeGeneration == generation else { return }
      routeTask = nil
    }
  }

  /// `bundle` が今の `liveRoutes` を既に消費しているか(= 置換が要らないか)。
  var liveRoutesAreAdopted: Bool {
    guard let bundle else { return true }
    let now = tripRequest().context, was = bundle.request.context
    return now.liveWalkingMinutes == was.liveWalkingMinutes
      && now.liveDrivingMinutes == was.liveDrivingMinutes
      && now.liveTransitMinutes == was.liveTransitMinutes
  }

  /// 静かな再ビルド(spec §4.5)。**`build()` は呼ばない**(`.building` を挟まず、読み上げを
  /// 再発火しない)。`history` にも触れない(編集ではない)。
  func replaceWithLiveRoutes(chainDepth: Int) async {
    guard let before = bundle else { return }
    if pendingApply != nil { deferredRouteReplacement = chainDepth; return }
    let req = tripRequest()
    buildGeneration += 1
    let generation = buildGeneration
    let after = await Task.detached(priority: .userInitiated) { BuildRunner.run(req) }.value
    await buildGate?()
    guard generation == buildGeneration, !Task.isCancelled else { return }
    adopt(after)
    routeReplacements += 1
    let delta = TripScenarios.totalPlanBufferMinutes(plan: after.plan, context: req.context)
      - TripScenarios.totalPlanBufferMinutes(plan: before.plan, context: before.request.context)
    let text = [AppCopy.for(request.locale).routesUpdatedToast, VerdictCopy.bufferToastDetail(delta, locale: request.locale)]
      .compactMap { $0 }.joined(separator: " ")
    showToast(Toast(text: text, kind: .info, canUndo: false))
    startRouteEnrichment(chainDepth: chainDepth + 1)   // 日割りが変わって新しいレグが出ていれば次の世代で
  }

  /// ダイアログが閉じたときに呼ぶ(`confirmPendingEdit` の捨てる枝 / `cancelPendingEdit`)。
  func resumeDeferredRouteReplacement() {
    guard let depth = deferredRouteReplacement else { return }
    deferredRouteReplacement = nil
    scheduleRouteReplacement(chainDepth: depth)
  }

  /// テスト用: 連鎖も含めて取得が落ち着くまで待つ。
  func awaitRouteEnrichment() async {
    while let task = routeTask {
      await task.value
      if routeTask == task { routeTask = nil }
    }
  }
}
