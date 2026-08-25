import Foundation
import TripCheckKit

/*
 * 組み上がった旅程への編集 —— **まず試し、それから訊く**(統合仕様 §5.1、v1.1 TC-007)。
 *
 * 旅程を書き換える道は 11 本あるが、通る関所は 1 つしかない(`applyGuardedEdit`)。押した
 * 場所が区間の手段ピッカーでも、詳細シートの滞在時間でも、代替案のボタンでも、守られ方は
 * 同じでなければならない —— どのボタンを押したかで、予約が守られるかどうかが変わっては
 * ならないからである。
 *
 * 関所の中身は 4 手:
 *
 *   1. 候補の編集状態を作る(`edit` の複製に手を入れるだけ。まだ何も採用しない)。
 *   2. その候補で旅程を**丸ごと組み直す**(`BuildRunner.run` を本線の外で)。
 *   3. 今の旅程と候補を Kit の `PlannerEdits.evaluate` に渡し、**新しく**壊れる約束を数える。
 *   4. 何も壊れないなら即座に採用してトーストを出す。壊れるなら、採用せずに問いかけを置く。
 *
 * 3 で `context` に今の文脈、`candidateContext` に候補の文脈を渡すのが要点。日の窓を動かす
 * 編集は同じ旅程でも余裕が変わるので、片方の文脈だけで両方を測ると差が嘘になる。
 *
 * **問いかけの間、旅程も編集状態も 1 ミリも動かない。** 「やめる」は元に戻す操作ではなく、
 * 置いてあった候補を捨てるだけである(`cancelPendingEdit`)。
 */

/// 旅行者の返事を待っている編集の中身。`PlannerViewState` に置けないもの(組み上がった旅程)を
/// 抱えるので `PlannerStore` の側に住む —— あちらは `Equatable` かつ `Sendable` でいる約束。
struct PendingGuardedEdit {
  /// 採用が決まったら `edit` になるもの。
  var candidate: PlannerEditState
  /// その候補で既に組み上がっている旅程。確認の間に入力は変わらないので、組み直さずに使える。
  var bundle: BuiltPlanBundle
  /// トーストの見出し(「何をしたか」)。余裕の差は Kit が後ろに足す。
  var label: String
  var bufferDeltaMinutes: Int
  /// この候補を組んだときの組み立て世代。返事を待っている間に世代が進んだら(端末を振って
  /// 元に戻した、など)、この候補はもう「今の旅程からの 1 手」ではないので捨てる。
  var generation: Int
  /// 編集状態には入らないが、採用と**同時に**書く画面側の欄。
  var sideEffects: GuardedEditSideEffects
}

/// 旅程を組む材料ではないので候補には乗らないが、採用の瞬間に一緒に書かれるもの。
///
/// `requestTripDays` があるのは、日数だけが `request` と `edit` の両方に居るから(R6:
/// `tripRequest()` は `request.tripDays ?? edit.tripDays`)—— 片方だけ書くと、次の組み立てで
/// 旅行者が選んだ日数が黙って古い値に戻る。`selectDay` は「動かした先の日を見せる」ための
/// もので、旅程には影響しない。
struct GuardedEditSideEffects {
  var requestTripDays: Int?
  var selectDay: Int?

  static let none = GuardedEditSideEffects()
}

extension PlannerStore {

  /// トーストが出ている時間。`reduceMotion` では見た目の動きが止まるだけで、**消えるまでの
  /// 時間は変わらない** —— 読む速さは動きの好みとは別の話で、短くすると読み終える前に消える。
  public static let toastDuration: Duration = .seconds(6)

  // MARK: - 関所

  /// 旅程を書き換える唯一の道。
  ///
  /// - Parameters:
  ///   - mutate: 候補の編集状態に手を入れる。**`edit` そのものは触らない**(複製が渡る)。
  ///   - label: 採用できたときのトーストの見出し。
  ///   - fallbackTitle: 問いかけの題。Kit が題を持つ場合(新しい損傷がちょうど 1 件の予約
  ///     遅れ)は `PlannerEdits.confirmTitle` がそちらを選ぶので、これはその控え。
  ///   - extraConflicts: Kit の判定には出ないが旅行者に伝えるべき但し書き(必須指定・予約済み)。
  ///     **1 件でもあれば必ず問いかける** —— Web `usePlannerEdits.tsx:496-513` と同じ約束。
  ///   - allowDropStopId: 「この場所が落ちるのは織り込み済み」と告げる id。外す本人の必須指定を
  ///     「必須が落ちる」と数えないために要る。
  public func applyGuardedEdit(
    _ mutate: (inout PlannerEditState) -> Void,
    label: String,
    fallbackTitle: String,
    extraConflicts: [String] = [],
    allowDropStopId: String? = nil
  ) async {
    await applyGuardedEdit(
      mutate,
      label: label,
      fallbackTitle: fallbackTitle,
      extraConflicts: extraConflicts,
      allowDropStopId: allowDropStopId,
      sideEffects: .none
    )
  }

  func applyGuardedEdit(
    _ mutate: (inout PlannerEditState) -> Void,
    label: String,
    fallbackTitle: String,
    extraConflicts: [String],
    allowDropStopId: String?,
    sideEffects: GuardedEditSideEffects
  ) async {
    // 旅行者が頼んだ組み直し。終わるまで置換は始まらず、終わったところで並んでいた置換を通す。
    rebuildsInFlight += 1
    defer {
      rebuildsInFlight -= 1
      resumeDeferredRouteReplacement()
    }
    // 比べる相手が無ければ守りようがない。旅程が組み上がる前の変更は Start 画面の仕事。
    guard let before = bundle else { return }
    var candidate = edit
    mutate(&candidate)
    guard candidate != edit else { return }   // 無操作は履歴に積まない(Undo が空振りする)

    // 台帳の現在地が `edit` からずれていたら、そこを新しい出発点にする。ずれるのは、守られた
    // 編集を通らない変更(Start 画面の `setPace` など)が `edit` に入ったときで、そのときの
    // 「1 つ前」はもう存在しない旅程である —— 戻せない場所を指した Undo を残さない。
    // 組み直しを挟んだ道は `commit` が同じことをしている(こちらは組み直さずに関所へ来た道)。
    if !historyPointsAtTheCurrentEdit {
      history = PlannerHistory(initial: edit, limit: PlannerEdits.undoLimit)
    }

    let req = tripRequest(with: candidate)
    buildGeneration += 1
    let generation = buildGeneration
    let after = await Task.detached(priority: .userInitiated) { BuildRunner.run(req) }.value
    await buildGate?()
    guard generation == buildGeneration, !Task.isCancelled else { return }

    let decision = PlannerEdits.evaluate(
      before: before.plan,
      after: after.plan,
      context: before.request.context,
      candidateContext: req.context,
      locale: req.locale,
      allowDropStopId: allowDropStopId
    )
    let conflicts: [PlannerHardEditConflict]
    let delta: Int
    switch decision {
    case .apply(let bufferDeltaMinutes):
      conflicts = []
      delta = bufferDeltaMinutes
    case .confirm(let list):
      conflicts = list
      // Kit は `.confirm` に余裕の差を載せない(載せるのは採用できるときだけ)。確認の後で
      // 出すトーストは同じ 2 つの旅程から測る —— 問いかけを経たかどうかで数が変わらない。
      delta = TripScenarios.totalPlanBufferMinutes(plan: after.plan, context: req.context)
        - TripScenarios.totalPlanBufferMinutes(plan: before.plan, context: before.request.context)
    }

    let pending = PendingGuardedEdit(
      candidate: candidate,
      bundle: after,
      label: label,
      bufferDeltaMinutes: delta,
      generation: generation,
      sideEffects: sideEffects
    )
    guard conflicts.isEmpty, extraConflicts.isEmpty else {
      // 問いかけの前にシートを閉じる。開いたシートの上に確認ダイアログは出せない
      // (UIKit は「もう何かを出している」画面からの提示を断る)—— シミュレータで、必須の
      // 場所を外そうとした手が、白紙のシートを見つめたまま何も訊かれない形になった。
      closeInspector()
      pendingApply = pending
      view.pendingHardEdit = .edit(conflicts: conflicts, extraConflicts: extraConflicts, fallbackTitle: fallbackTitle)
      return
    }
    adoptPending(pending)
  }

  /// 問いかけに「進める」と答えたとき。候補はもう組み上がっているので、ここでは組み直さない
  /// —— 確認の間に入力は変わらないし、組み直すと画面が一瞬止まる。
  public func confirmPendingEdit() async {
    guard let pending = pendingApply else { return }
    pendingApply = nil
    view.pendingHardEdit = nil
    // 返事を待っている間に旅程が動いていたら、この候補は捨てる —— 端末を振って元に戻した
    // 直後に「進める」を押すと、戻す前の旅程から組んだ候補が採用されてしまう。
    guard pending.generation == buildGeneration else { resumeDeferredRouteReplacement(); return }
    // 採用するなら、保留していた置換は要らない —— `adoptPending` → `startRouteEnrichment()` が
    // 新しい旅程から測り直す。残すと置換が 2 本走る。
    deferredRouteReplacement = nil
    adoptPending(pending)
  }

  /// 問いかけに「やめる」と答えたとき。**何も戻さない** —— 何も進めていないから。
  public func cancelPendingEdit() {
    pendingApply = nil
    view.pendingHardEdit = nil
    resumeDeferredRouteReplacement()
  }

  /// 候補を本物にする。順番に意味がある:編集状態 → 旅程(`adopt` が `edit.tripDays` を
  /// 実際の日数へ揃える)→ 台帳。台帳に積むのが最後なのは、**揃った後の編集状態**が
  /// 「1 つ前」として戻される値でなければならないため。
  private func adoptPending(_ pending: PendingGuardedEdit) {
    edit = pending.candidate
    if let days = pending.sideEffects.requestTripDays { request.tripDays = days }
    adopt(pending.bundle)
    history = history.commit(edit)
    if let day = pending.sideEffects.selectDay { selectDay(day) }
    closeInspectorIfItPointsAtNothing()
    showEditToast(label: pending.label, bufferDeltaMinutes: pending.bufferDeltaMinutes)
    startRouteEnrichment()
    // 編集後の旅程で測り直す。天気も表示専用のまま新しい日割りに追従する。
    startWeatherEnrichment()
    // 食事の候補も同じ場所で世代を進める(lazy なので、ここでは前の候補を捨てるだけ)。
    invalidateFoodRecommendations()
    invalidateHotelRecommendations()
    invalidatePlaceIntelligence()
  }

  /// 開いているシートが指す先が旅程から消えていたら閉じる。
  ///
  /// シミュレータで見つけた形:「予定から外す」を押した旅行者は、外れた場所の**白紙のシート**を
  /// 見つめることになり、その下に出たトーストの「元に戻す」に手が届かなかった。日数を
  /// 縮めたときに無くなる日の設定シートも同じ。
  private func closeInspectorIfItPointsAtNothing() {
    switch view.inspector {
    case .stop(let stopId) where plannedStop(stopId) == nil: closeInspector()
    case .daySettings(let day) where day >= (bundle?.plan.days.count ?? 0): closeInspector()
    default: break
    }
  }

  // MARK: - 元に戻す・やり直す

  /// 台帳の現在地が `edit` を指しているか。ずれるのは、関所を通らない変更(Start 画面の
  /// `setPace` など)が `edit` に直接入ったとき —— そのとき台帳の「1 つ前」は、旅行者が
  /// 一度も見ていない旅程を指す。**ずれている間は戻せない**と答える(組み直しが走れば
  /// `commit` が台帳を畳み直すので、この形になるのは組み直す前の一瞬だけ)。
  var historyPointsAtTheCurrentEdit: Bool { history.present == edit }

  public var canUndo: Bool { historyPointsAtTheCurrentEdit && history.canUndo }
  public var canRedo: Bool { historyPointsAtTheCurrentEdit && history.canRedo }

  /// 1 つ前の編集状態へ。**旅程は組み直す** —— 数だけ戻して旅程を古いままにすると、画面の
  /// 滞在時間と到着時刻が食い違う。
  public func undo() async {
    guard canUndo else { return }
    // 並んでいた置換はここで捨てる。**戻す操作の後ろに置換を並べない** —— 下の組み直しは
    // `tripRequest()` を通るので測った分は自分で畳み込むし、置換を通すと戻した直後に
    // 「実経路で更新しました」が出て、開いていたシートを閉じる手当ても飛ばされる。
    deferredRouteReplacement = nil
    // 訊きかけの問いは、その答えが指す旅程ごと消える。
    cancelPendingEdit()
    history = history.undo()
    await adoptHistoryPresent()
  }

  public func redo() async {
    guard canRedo else { return }
    deferredRouteReplacement = nil   // `undo()` と同じ理由
    cancelPendingEdit()
    history = history.redo()
    await adoptHistoryPresent()
  }

  /// 台帳の現在地を旅程に反映する。**トーストは出さない** —— 元に戻す操作にもう一度
  /// 「元に戻す」を差し出すと、どちらへ動いているのか分からなくなる。読み上げの 1 文は
  /// 押した側(ツールバーとシェイク)が出す:同じ状態へ 2 度戻ったときにも必ず鳴るように、
  /// 文の変化ではなく操作そのものに紐づける。
  private func adoptHistoryPresent() async {
    // 旅行者が頼んだ組み直し。終わるまで置換は始まらず、終わったところで並んでいた置換を通す。
    rebuildsInFlight += 1
    defer {
      rebuildsInFlight -= 1
      resumeDeferredRouteReplacement()
    }
    dismissToast()
    edit = history.present
    // 日数は `request` にも居る(R6)。片方だけ戻すと、旅程は 3 日なのに次の組み立てが
    // 5 日で走る。
    if request.tripDays != nil { request.tripDays = edit.tripDays }
    buildGeneration += 1
    let generation = buildGeneration
    let req = tripRequest()
    let result = await Task.detached(priority: .userInitiated) { BuildRunner.run(req) }.value
    await buildGate?()
    guard generation == buildGeneration, !Task.isCancelled else { return }
    adopt(result)
    closeInspectorIfItPointsAtNothing()
    startRouteEnrichment()
    // 元に戻す/やり直すで日割りが変わることもあるので、天気も同じ場所で測り直す。
    startWeatherEnrichment()
    // 食事の候補も同じ場所で世代を進める(lazy なので、ここでは前の候補を捨てるだけ)。
    invalidateFoodRecommendations()
    invalidateHotelRecommendations()
    invalidatePlaceIntelligence()
  }

  // MARK: - トースト

  /// 旅程を書き換えたことを 1 行で言う。文は 2 つの部品だけ:見出し(何をしたか)と、Kit の
  /// 余裕の差。差が 0 のときは `bufferToastDetail` が `nil` を返すので「±0」が出ない。
  private func showEditToast(label: String, bufferDeltaMinutes: Int) {
    let detail = VerdictCopy.bufferToastDetail(bufferDeltaMinutes, locale: request.locale)
    showToast(Toast(
      text: [label, detail].compactMap { $0 }.joined(separator: " "),
      kind: .edit,
      canUndo: true
    ))
  }

  /// トーストを出して、6 秒後に自分で消す。**前の約束は破る** —— 破らないと、2 つ目の
  /// トーストが 1 つ目の時計で早く消える。
  func showToast(_ toast: Toast) {
    toastDismissTask?.cancel()
    view.toast = toast
    let id = toast.id
    toastDismissTask = Task { [weak self] in
      try? await Task.sleep(for: PlannerStore.toastDuration)
      guard !Task.isCancelled, let self, view.toast?.id == id else { return }
      view.toast = nil
    }
  }

  /// 旅行者が読み終える前に消す唯一の道(「元に戻す」を押した後)。
  public func dismissToast() {
    toastDismissTask?.cancel()
    toastDismissTask = nil
    view.toast = nil
  }

  // MARK: - 11 の編集

  /// 予定から外す。必須・予約済みの場所は**必ず先に問いかける**(Web
  /// `usePlannerEdits.tsx:496-513`)—— Kit の判定は「外す本人」を数えないので
  /// (`allowDropStopId`)、その但し書きはアプリ側が足すしかない。
  public func removeStop(id: String) async {
    guard let built = plannedStop(id), !edit.removedStops.contains(where: { $0.id == id }) else { return }
    let app = AppCopy.for(request.locale)
    let name = built.stop.name
    var extra: [String] = []
    if built.priority == .must {
      extra = [app.mustRemovalNote(name: name)]
    } else if built.isReservation {
      extra = [app.reservationRemovalNote(name: name)]
    }
    let authored = authoredName(for: built)
    await applyGuardedEdit(
      { $0.removedStops.append(PlannerRemovedStop(id: id, name: authored)) },
      label: app.removedStopToast(name: name),
      fallbackTitle: app.removeStopQuestion(name: name),
      extraConflicts: extra,
      allowDropStopId: id
    )
  }

  /// 外した場所を戻す。戻す操作も同じ関所を通る —— 戻ってきた訪問は分を食うので、予約に
  /// 遅れることも空港の締切を割ることもある(Web `usePlannerEdits.tsx:521-535`)。
  public func restoreStop(id: String) async {
    guard let removed = edit.removedStops.first(where: { $0.id == id }) else { return }
    await applyGuardedEdit(
      { $0.removedStops.removeAll { $0.id == id } },
      label: AppCopy.for(request.locale).restoredStopToast(name: removed.name),
      fallbackTitle: VerdictCopy.HardEditTitles.restoreStop(removed.name, locale: request.locale)
    )
  }

  /// 別の日へ動かす。いま居る日をもう一度選ぶと指定が外れて自動配置に戻る(Web
  /// `usePlannerEdits.tsx:544-568`)。`dayOverrides` は **1 始まり**で書く(Kit の
  /// `PlannerContext.dayOverrides` がそう読む)。
  public func moveStop(id: String, toDay day: Int) async {
    guard let built = plannedStop(id) else { return }
    let app = AppCopy.for(request.locale)
    let name = built.stop.name
    if day == plannedDayIndex(of: id) {
      guard edit.dayOverrides[id] != nil else { return }
      await applyGuardedEdit(
        { $0.dayOverrides[id] = nil },
        label: app.revertedToast,
        fallbackTitle: app.moveStopAutoQuestion(name: name),
        extraConflicts: [],
        allowDropStopId: nil,
        sideEffects: .none
      )
      return
    }
    await applyGuardedEdit(
      { $0.dayOverrides[id] = day + 1 },
      label: app.movedToDayToast(day: day + 1),
      fallbackTitle: app.moveStopQuestion(name: name, day: day + 1),
      extraConflicts: [],
      allowDropStopId: nil,
      sideEffects: GuardedEditSideEffects(selectDay: day)
    )
  }

  /// 旅の長さを変えたときの問いかけ。**向きで文が違う。** 伸ばすほうも関所を通る —— 日が
  /// 増えると日ごとの締切の位置が付け替わり、予約や最終入場が新たに割れることがあるので、
  /// 問いかけ自体は両方向にある。片方の文で済ませると、4 日を 6 日にした旅行者が
  /// 「6日に短縮しますか？」と訊かれ、押した覚えのない操作を確かめさせられる。
  static func tripDaysQuestion(next: Int, current: Int, locale: PlannerLocale) -> String {
    let app = AppCopy.for(locale)
    return next > current ? app.extendTripQuestion(days: next) : app.shortenTripQuestion(days: next)
  }

  /// 旅の長さを変える。`request.tripDays` と候補の `edit.tripDays` は**同時に**書かれる
  /// (R6)—— `tripRequest()` は `request.tripDays ?? edit.tripDays` なので、片方だけでは
  /// 次の組み立てが古い日数で走る。日ごとの時刻指定のうち、消える日のぶんは一緒に落とす。
  public func changeTripDays(_ days: Int) async {
    let next = PlannerEdits.clampTripDays(days)
    let current = edit.tripDays
    guard next != current else { return }
    await applyGuardedEdit(
      { candidate in
        candidate.tripDays = next
        candidate.dayStartTimes = IntKeyedDictionary(candidate.dayStartTimes.values.filter { $0.key < next })
        candidate.dayEndTimes = IntKeyedDictionary(candidate.dayEndTimes.values.filter { $0.key < next })
      },
      label: AppCopy.for(request.locale).tripDaysToast(days: next),
      fallbackTitle: Self.tripDaysQuestion(next: next, current: current, locale: request.locale),
      extraConflicts: [],
      allowDropStopId: nil,
      sideEffects: GuardedEditSideEffects(requestTripDays: next)
    )
  }

  /// この区間はこの手段で。同じ手段をもう一度選ぶと指定が外れる。手段を指定した日は
  /// 回る順を固定する —— 固定しないと、指定した手段に合わせて経路が組み替わり、旅行者が
  /// 見ていた並びが黙って変わる(Web `usePlannerEdits.tsx:611-632`)。
  public func setLegMode(legKey: String, mode: TransportMode) async {
    let releasing = edit.legModeOverrides[legKey] == mode
    let locale = request.locale
    let app = AppCopy.for(locale)
    let lockedOrder = lockedOrderAfterLegModeChange(legKey: legKey, releasing: releasing)
    await applyGuardedEdit(
      { candidate in
        candidate.legModeOverrides[legKey] = releasing ? nil : mode
        candidate.lockedOrderByDay = lockedOrder
      },
      label: releasing ? app.revertedToast : app.editedToast,
      fallbackTitle: releasing
        ? VerdictCopy.HardEditTitles.legModeAuto(locale: locale)
        : VerdictCopy.HardEditTitles.legMode(legModeLabel(mode, locale), locale: locale)
    )
  }

  /// 滞在時間を旅行者が決める。`nil` は「自動に戻す」で、エンジンの見積もりが再び効く。
  public func setStayMinutes(stopId: String, minutes: Int?) async {
    guard edit.userStayMinutes[stopId] != minutes else { return }
    let locale = request.locale
    let app = AppCopy.for(locale)
    let name = plannedStopName(stopId)
    await applyGuardedEdit(
      { $0.userStayMinutes[stopId] = minutes },
      label: minutes == nil ? app.revertedToast : app.editedToast,
      fallbackTitle: minutes.map { VerdictCopy.HardEditTitles.stayMinutes(name, $0, locale: locale) }
        ?? VerdictCopy.HardEditTitles.stayMinutesAuto(name, locale: locale)
    )
  }

  /// この場所の最終入場。`nil` で指定を外す。
  public func setLastEntry(stopId: String, time: String?) async {
    guard edit.lastEntryTimes[stopId] != time else { return }
    let locale = request.locale
    let app = AppCopy.for(locale)
    let name = plannedStopName(stopId)
    await applyGuardedEdit(
      { $0.lastEntryTimes[stopId] = time },
      label: time == nil ? app.revertedToast : app.editedToast,
      fallbackTitle: time.map { VerdictCopy.HardEditTitles.lastEntry(name, $0, locale: locale) }
        ?? VerdictCopy.HardEditTitles.lastEntryClear(name, locale: locale)
    )
  }

  /// この日の始まり。`nil` で標準に戻す。**題は 1 始まりの日**(旅行者が読む番号)。
  public func setDayStart(day: Int, time: String?) async {
    guard edit.dayStartTimes[day] != time else { return }
    let locale = request.locale
    let app = AppCopy.for(locale)
    await applyGuardedEdit(
      { $0.dayStartTimes[day] = time },
      label: time == nil ? app.revertedToast : app.editedToast,
      fallbackTitle: time.map { VerdictCopy.HardEditTitles.dayStart(day + 1, $0, locale: locale) }
        ?? VerdictCopy.HardEditTitles.dayStartAuto(day + 1, locale: locale)
    )
  }

  /// この日の終わり。`nil` で標準に戻す。
  public func setDayEnd(day: Int, time: String?) async {
    guard edit.dayEndTimes[day] != time else { return }
    let locale = request.locale
    let app = AppCopy.for(locale)
    await applyGuardedEdit(
      { $0.dayEndTimes[day] = time },
      label: time == nil ? app.revertedToast : app.editedToast,
      fallbackTitle: time.map { VerdictCopy.HardEditTitles.dayEnd(day + 1, $0, locale: locale) }
        ?? VerdictCopy.HardEditTitles.dayEndAuto(day + 1, locale: locale)
    )
  }

  /// 代替案を採る。**採ることも編集である** —— 全日程の時計を動かせば固定された予約や
  /// 最終入場が線の向こう側に落ちうるので、日ごとの時刻欄と同じ関所を通る(Web
  /// `usePlannerEdits.tsx:690-763`)。7 種のうち 3 種は既にある編集そのものなので委譲する。
  public func applyAlternative(_ alternative: TripCounterfactual) async {
    guard let plan = bundle?.plan else { return }
    let locale = request.locale
    let app = AppCopy.for(locale)
    switch alternative.kind {
    case .CHANGE_DAYS:
      guard let days = alternative.change.days else { return }
      await changeTripDays(days)
    case .START_EARLIER:
      let minutes = alternative.change.minutes ?? 60
      let times = shiftedDayTimes(plan: plan, by: -minutes, current: edit.dayStartTimes) { $0.requestedStartTime }
      await applyGuardedEdit(
        { $0.dayStartTimes = times },
        label: app.editedToast,
        fallbackTitle: VerdictCopy.HardEditTitles.startEarlier(minutes, locale: locale)
      )
    case .END_LATER:
      let minutes = alternative.change.minutes ?? 60
      let fallbackEnd = request.dayEndTarget ?? Self.defaultDayEnd
      let times = shiftedDayTimes(plan: plan, by: minutes, current: edit.dayEndTimes) { _ in fallbackEnd }
      await applyGuardedEdit(
        { $0.dayEndTimes = times },
        label: app.editedToast,
        fallbackTitle: VerdictCopy.HardEditTitles.endLater(minutes, locale: locale)
      )
    case .CHANGE_BASE:
      guard let baseId = alternative.change.baseId,
            let candidate = plan.baseRecommendations.first(where: { $0.base.id == baseId })?.base
      else { return }
      // Kit の `TripBase` を、旅行者が決めた拠点と同じ形(`ResolvedStop`)に直す。Web の
      // `{ ...candidate, input: candidate.query, address: candidate.area }` と同じ写し方が
      // Kit にある。
      await setBase(ProvisionalTripLength.provisionalBaseAsResolved(candidate))
    case .CHANGE_MODE:
      guard let legId = alternative.change.legId, let mode = alternative.change.mode else { return }
      await setLegMode(legKey: legId, mode: mode)
    case .OPTIMIZE_ORDER:
      guard let order = alternative.change.orderByDay else { return }
      await applyGuardedEdit(
        { $0.lockedOrderByDay = order },
        label: app.editedToast,
        fallbackTitle: VerdictCopy.HardEditTitles.optimizeOrder(locale: locale)
      )
    case .REMOVE_OPTIONAL:
      guard let stopId = alternative.change.stopId else { return }
      await removeStop(id: stopId)
    }
  }

  /// 拠点(ホテル)を差し替える。DoD-PLAN-5 / TC-051:拠点の交換も他の編集と同じで、
  /// 黙って予約を遅らせうる(統合仕様 §8.2 の 4 番目)。
  public func setBase(_ base: ResolvedStop?) async {
    guard edit.resolvedBase != base else { return }
    let app = AppCopy.for(request.locale)
    await applyGuardedEdit(
      { candidate in
        candidate.resolvedBase = base
        candidate.hotelQuery = base.map { $0.input.isEmpty ? $0.name : $0.input } ?? ""
      },
      label: base.map { app.baseSetToast(name: $0.name) } ?? app.baseClearedToast,
      fallbackTitle: base.map { app.changeBaseQuestion(name: $0.name) } ?? app.clearBaseQuestion
    )
  }

  // MARK: - 日の窓(日の設定シートが読む 2 つ)

  /// この日の開始時刻の指定。決めていなければ `nil`(標準)。
  public func dayStartTime(_ day: Int) -> String? { edit.dayStartTimes[day] }

  /// この日の終了時刻の指定。決めていなければ `nil`(標準)。
  public func dayEndTime(_ day: Int) -> String? { edit.dayEndTimes[day] }

  // MARK: - 内部

  /// 日の終わりを決めていない旅の既定。Kit の `dayEndNone`(「標準 22:00」)が名乗る時刻。
  static let defaultDayEnd = "22:00"

  /// いま旅程に載っている停留所。外した場所・入り切らなかった場所はここに居ない。
  func plannedStop(_ stopId: String) -> BuiltPlanStop? {
    bundle?.plan.days.flatMap(\.stops).first { $0.stop.id == stopId }
  }

  /// その停留所が今いる日(0 始まり)。旅程に居なければ `nil`。
  func plannedDayIndex(of stopId: String) -> Int? {
    bundle?.plan.days.firstIndex { $0.stops.contains { $0.stop.id == stopId } }
  }

  /// 問いかけに使う名前。旅程から消えている場所でも問いかけは出せなければならないので、
  /// 引き当てられないときは Kit の「この場所」に落ちる(Web `plannedStopName` `:472-475`)。
  private func plannedStopName(_ stopId: String) -> String {
    plannedStop(stopId)?.stop.name ?? edit.removedStops.first { $0.id == stopId }?.name
      ?? Copy.for(request.locale).placeFallback
  }

  /// 外した場所の一覧に残す名前は、**旅行者が書いた行**を優先する(Web
  /// `usePlannerEdits.tsx:477-494`)—— 一覧は「自分で外した場所」なので、提供元が名乗る
  /// 正式名称よりも、自分が打った言葉のほうが見つけやすい。
  private func authoredName(for built: BuiltPlanStop) -> String {
    request.entries.first { $0.pinned?.stop.id == built.stop.id }?.text ?? built.stop.name
  }

  /// 手段を指定した日の並びを固定する(指定を全部外したらその日の固定も外す)。
  private func lockedOrderAfterLegModeChange(legKey: String, releasing: Bool) -> IntKeyedDictionary<[String]> {
    var next = edit.lockedOrderByDay
    guard let plan = bundle?.plan,
          let dayIndex = plan.days.firstIndex(where: { $0.legs.contains { routeLegKey($0.from.id, $0.to.id) == legKey } })
    else { return next }
    var modes = edit.legModeOverrides
    modes[legKey] = releasing ? nil : modes[legKey] ?? .transit
    let dayLegKeys = Set(plan.days[dayIndex].legs.map { routeLegKey($0.from.id, $0.to.id) })
    if modes.keys.contains(where: { dayLegKeys.contains($0) }) {
      next[dayIndex] = plan.days[dayIndex].stops.map(\.stop.id)
    } else {
      next[dayIndex] = nil
    }
    return next
  }

  /// 全日程の時計を同じ分だけずらした表。既に指定がある日はその指定から、無い日は旅程が
  /// 使っている時刻からずらす。
  private func shiftedDayTimes(
    plan: BuiltTripPlan,
    by minutes: Int,
    current: IntKeyedDictionary<String>,
    fallback: (BuiltPlanDay) -> String
  ) -> IntKeyedDictionary<String> {
    var next = IntKeyedDictionary<String>()
    for (index, day) in plan.days.enumerated() {
      let base = current[index] ?? fallback(day)
      guard let clock = ClockTime(base) else { continue }
      next[index] = ClockTime(minutes: min(24 * 60 - 1, max(0, clock.minutes + minutes))).description
    }
    return next
  }
}
