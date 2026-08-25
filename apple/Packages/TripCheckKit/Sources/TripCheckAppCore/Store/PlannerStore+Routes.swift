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
    if chainDepth == 0 {
      // 深さ 0 は「この旅程を一から測り直す」宣言。走っている取得を畳み(連鎖は自分の中から
      // 呼ばれるので自分は畳まない)、**印も保留も捨てる**。
      //
      // 印を残すと実際に起きるのは:12/38 まで測ったところで旅行者が滞在時間を変える →
      // ここが走る → 残り 26 件は「試したが答えが無い」ままなので `pending` が空 → 行が消えて、
      // 旅程は推定のまま「N 区間は推定のまま」すら出さない。次の `build()` まで直らない。
      // 印の役目は 1 回の取得の中で同じ要求を二度立てないことで、旅程が変わった後まで効かせない。
      routeTask?.cancel()
      attemptedRoutes.removeAll()
      // 並んでいた置換もここで捨てる。この pass 自体が測り直して置換するか、下の
      // `pending.isEmpty` の枝でその場で置換を積むので、古い保留は二重に走るだけになる。
      deferredRouteReplacement = nil
    }
    routeGeneration += 1
    let generation = routeGeneration
    // 連鎖の前の世代が残した「1 本も測れなかったレグ」の数。深さ 0 は数え直しなので 0 から。
    let carriedEstimates = chainDepth == 0 ? 0 : (routeProgress?.estimatedRemaining ?? 0)
    let requests = RouteRequests.requests(
      plan: bundle.plan, context: bundle.request.context, overrides: edit.legModeOverrides,
      selectedDay: view.selectedDay, now: Date())
    // 今の旅程に無い鍵(古いバケット・消えたレグ)は捨てる。同じレグ×手段の答えは 1 つだけ残る。
    let current = Set(requests)
    liveRoutes = liveRoutes.filter { current.contains($0.key) }
    let pending = requests.filter { liveRoutes[$0] == nil && !attemptedRoutes.contains($0) }
    guard !pending.isEmpty else {
      // 数え終わる前に畳んだ取得の進捗は消す。**残すと二度と進まない行が居座る** ——
      // 取りに行くものが無いのに `settled < requested` の行が出ていたら、それは今しがた
      // 畳んだ取得のもので、もう誰も数えない。数え終わった行(「N 区間は推定のまま」)は
      // 次のビルドまで残す。
      if routeProgress?.isComplete == false { routeProgress = nil }
      // 取りに行くものは無い。旅程がキャッシュを既に消費していれば仕事そのものが無い ——
      // 世代はもう進めてあるので、外側の task の末尾は触らない。ここで自分で畳む。
      if liveRoutesAreAdopted { routeTask = nil } else { scheduleRouteReplacement(chainDepth: chainDepth) }
      return
    }
    attemptedRoutes.formUnion(pending)
    routeProgress = RouteProgress(requested: pending.count, settled: 0, estimatedRemaining: carriedEstimates)
    let locale = request.locale
    routeTask = Task { [weak self] in
      let answers = await RouteFetcher.fetch(pending, provider: routeProvider, locale: locale) { [weak self] _, _ in
        guard let self, routeGeneration == generation else { return }
        routeProgress?.settled += 1
      }
      guard let self, routeGeneration == generation, !Task.isCancelled else { return }
      for (request, outcome) in answers {
        // **`.failed` は覚えない。** それは「答えが無かった」であって答えではない ——
        // 機内モードの間に全部落ちたものを溜め込むと、`build()` はキャッシュを残すので
        // (`invalidateRoutes(keepCache: true)`)、電波が戻った後も二度と尋ね直さない
        // (spec §4.4「このビルドでは諦める」)。1 回の取得の中で二度立てないほうは
        // `attemptedRoutes` が見ている。
        if case .failed = outcome { continue }
        liveRoutes[request] = outcome
      }
      let measured = Set(answers.compactMap { entry -> String? in
        if case .measured = entry.value { return entry.key.legKey }
        return nil
      })
      // 全部測れたら進捗そのものを消す(行が消える)。残れば「N 区間は推定のまま」の材料として
      // 次のビルドまで残る。連鎖の先で測れたぶんが前の世代の失敗を消してはいけないので、
      // 持ち越した数と大きいほうを採る —— 消すと「N 区間は推定のまま」が実際より少なく名乗る。
      let remaining = max(Set(pending.map(\.legKey)).subtracting(measured).count, carriedEstimates)
      routeProgress = remaining == 0 ? nil : RouteProgress(requested: pending.count, settled: pending.count, estimatedRemaining: remaining)
      // 新しい測定があるか、**旅程がまだキャッシュを消費していない**なら組み直す。後者が要るのは、
      // 日付や開始時刻が動いて鍵が振り直された直後 —— 古いバケットの分は上の filter で消えたのに、
      // 新しいバケットが 1 件も測れないと、旅程は消えた値を畳んだままになる(spec §4.5.1)。
      if !measured.isEmpty || !liveRoutesAreAdopted { await replaceWithLiveRoutes(chainDepth: chainDepth) }
      if routeGeneration == generation { routeTask = nil }
    }
  }

  /// 取りに行くものは無いが、キャッシュをまだ旅程が消費していないときの置換。世代を進めて
  /// この task を `routeTask` の持ち主にする(連鎖の外側の task の末尾に畳まれないため)。
  private func scheduleRouteReplacement(chainDepth: Int) {
    routeTask?.cancel()   // 上書きする前に畳む。持ち主が替わる合図は世代だが、走らせ続ける理由は無い
    routeGeneration += 1
    let generation = routeGeneration
    routeTask = Task { [weak self] in
      guard let self, routeGeneration == generation, !Task.isCancelled else { return }
      await replaceWithLiveRoutes(chainDepth: chainDepth)
      guard routeGeneration == generation else { return }
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
    // 問いかけが開いている間は保留する。**旅行者が頼んだ組み直しが走っている間も同じ** ——
    // あちらも「世代を進めてから待つ」形なので、ここで世代を進めると、返ってきた答えが
    // あちらの世代ガードで落ちて、押した手が何も起こさずに消える(spec §4.5.2)。
    if pendingApply != nil || rebuildsInFlight > 0 { deferredRouteReplacement = chainDepth; return }
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
    // **知らせは「元に戻す」に道を譲る**(spec §4.5.5)。差し出されている取り消しの上に
    // 取り消せないトーストを重ねると、消したばかりの場所を戻す手が画面から消える ——
    // 旅行者は自分が押したことの結果を待っているので、その 1 行のほうが後から来た測定より重い。
    // 譲るのは知らせだけで、旅程はもう新しい値になっている(この上の `adopt`)。
    if view.toast?.canUndo != true {
      let text = [AppCopy.for(request.locale).routesUpdatedToast, VerdictCopy.bufferToastDetail(delta, locale: request.locale)]
        .compactMap { $0 }.joined(separator: " ")
      showToast(Toast(text: text, kind: .info, canUndo: false))
    }
    startRouteEnrichment(chainDepth: chainDepth + 1)   // 日割りが変わって新しいレグが出ていれば次の世代で
    // 静かな置換も日割りを変えうる(上の `adopt` がそれ)。天気は日 index で引くので、
    // 入れ替わった日割りのまま古い天気を残さない —— ここで測り直す。
    startWeatherEnrichment()
    // 食事の候補も同じ場所で世代を進める(lazy なので、ここでは前の候補を捨てるだけ)。
    invalidateFoodRecommendations()
    invalidatePlaceIntelligence()
  }

  /// 保留した置換を通す。ダイアログが閉じたとき(`confirmPendingEdit` の捨てる枝 /
  /// `cancelPendingEdit`)と、旅行者の組み直しが終わったとき(3 本の `defer`)に呼ぶ。
  func resumeDeferredRouteReplacement() {
    guard let depth = deferredRouteReplacement else { return }
    deferredRouteReplacement = nil
    // 待っている間に済んでいることがある —— この関所が捕まえるのは**組み直しが始まる前に
    // 積まれた保留**で、その旅程はもう測った分を消費している。同じものをもう一度組んで
    // 「実経路で更新しました」を出す理由は無い(走っている取得を畳むのも無駄)。
    //
    // 組み直しの `await` の最中に着いた答えはここでは拾わない —— 3 本の組み直しはどれも
    // 待つ前に `req` を掴むので、その `tripRequest()` に後から来た測定は入らない。そちらは
    // 組み直しの末尾の `startRouteEnrichment()` が改めて拾う。
    guard !liveRoutesAreAdopted else { return }
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

extension PlannerStore {
  /// 統計行の横の 1 行。取得中は「実経路を取得中 12/38」、完了して推定が残れば「N 区間は推定のまま」
  /// (次のビルドまで残る)、全部測れたら nil(行そのものが消える)。
  public var routeProgressLine: String? {
    guard let progress = routeProgress else { return nil }
    let app = AppCopy.for(request.locale)
    if !progress.isComplete { return app.routesFetching(settled: progress.settled, total: progress.requested) }
    return progress.estimatedRemaining > 0 ? app.routesEstimatedRemaining(count: progress.estimatedRemaining) : nil
  }
}
