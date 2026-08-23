import Testing
@testable import TripCheckAppCore
import TripCheckKit

/*
 * 守られた編集 —— まず試し、それから訊く。
 *
 * ここで確かめるのは 4 つ:害の無い編集はその場で通って Undo 1 回で消えること、重い結果の
 * 出る編集は**先に問いかける**こと、日数の変更が同じエンジンをもう一度回すこと(数だけ
 * 書き換えた複製を作らない)、そして問いかけを断ったときに旅程が 1 ミリも動かないこと。
 */

@Test @MainActor func harmlessEditAppliesAndIsOneUndo() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let id = store.bundle!.plan.days[0].stops[0].stop.id
  await store.setStayMinutes(stopId: id, minutes: 120)
  #expect(store.edit.userStayMinutes[id] == 120); #expect(store.view.toast != nil); #expect(store.canUndo)
  if let detail = VerdictCopy.bufferToastDetail(-30, locale: .ja) { #expect(detail == VerdictCopy.bufferDeltaLine(-30, locale: .ja)) }   // トースト文は Kit から。手書きの「余裕 -30分」は書かない
  await store.undo()
  #expect(store.edit.userStayMinutes[id] == nil); #expect(store.canRedo)
}

@Test @MainActor func removingAMustStopAsksFirst() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland)
  store.request.entries[0].priority = .must
  await store.build()
  let id = store.bundle!.plan.days.flatMap(\.stops).first { $0.priority == .must }!.stop.id
  await store.removeStop(id: id)
  guard case .edit(let conflicts, let extra, let title)? = store.view.pendingHardEdit else { Issue.record("a must stop must be asked about"); return }
  #expect(conflicts.isEmpty)        // 外す本人の must は allowDropStopId で数えない(Kit hardEditConflicts)
  #expect(extra.count == 1)         // 「…は必須に指定されています」(AppCopy.mustRemovalNote)
  #expect(PlannerEdits.confirmTitle(conflicts: conflicts, extraConflicts: extra, fallback: title, locale: .ja) == title)
  #expect(!store.edit.removedStops.contains { $0.id == id })
  await store.confirmPendingEdit()
  #expect(store.edit.removedStops.contains { $0.id == id })
}

@Test @MainActor func changingDaysReRunsTheSameEngineNotACopy() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  await store.changeTripDays(5)
  #expect(store.bundle?.plan.days.count == 5); #expect(store.bundle?.request.days == 5); #expect(store.request.tripDays == 5)
}

/// 日数の問いかけは**向き**で変わる。伸ばすほうも関所を通る(日が増えると日ごとの締切の
/// 位置が付け替わり、予約や最終入場が新たに割れる)が、片方の文で済ませると、4 日を 6 日に
/// した旅行者が「6日に短縮しますか？」と訊かれ、押した覚えのない操作を確かめさせられる。
///
/// 選ぶところだけを直に踏むのは、伸ばす向きで**必ず**問いかけが出る旅程を見本から作れない
/// ため —— 出ない日に何も表明しないテストになるより、選択そのものを毎回踏むほうがよい。
@Test @MainActor func theTripLengthQuestionFollowsTheDirection() {
  for locale in [PlannerLocale.ja, .en] {
    let app = AppCopy.for(locale)
    #expect(PlannerStore.tripDaysQuestion(next: 6, current: 4, locale: locale) == app.extendTripQuestion(days: 6))
    #expect(PlannerStore.tripDaysQuestion(next: 3, current: 4, locale: locale) == app.shortenTripQuestion(days: 3))
    #expect(app.extendTripQuestion(days: 6) != app.shortenTripQuestion(days: 6), "\(locale)")
  }
}

/// 日数は `request` と `edit` の**両方**に居る(R6:`tripRequest()` は
/// `request.tripDays ?? edit.tripDays`)。片方だけ戻す Undo は、旅程は 4 日なのに次の
/// 組み立てが 5 日で走る画面を作る。
@Test @MainActor func undoingADayChangePutsBothCopiesOfTheDayCountBack() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  #expect(store.request.tripDays == 4)
  await store.changeTripDays(5)
  #expect(store.edit.tripDays == 5)
  await store.undo()
  #expect(store.request.tripDays == 4)
  #expect(store.edit.tripDays == 4)
  #expect(store.bundle?.plan.days.count == 4)
  #expect(store.tripRequest().days == 4)
}

/// 断ったら**何も起きない**。問いかけを出した時点では旅程も編集も一切動いていないので、
/// 「やめる」は状態を戻すのではなく、置いてあった候補を捨てるだけで済む。
@Test @MainActor func cancellingTheQuestionLeavesThePlanUntouched() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland)
  store.request.entries[0].priority = .must
  await store.build()
  let before = store.bundle!.plan
  let id = store.bundle!.plan.days.flatMap(\.stops).first { $0.priority == .must }!.stop.id
  await store.removeStop(id: id)
  #expect(store.view.pendingHardEdit != nil)
  store.cancelPendingEdit()
  #expect(store.view.pendingHardEdit == nil)
  #expect(store.edit.removedStops.isEmpty)
  #expect(store.bundle?.plan == before)
  #expect(!store.canUndo)
  #expect(store.view.toast == nil)
}

/// 返事を待っている間に旅程が動いたら、その候補は捨てる。端末を振って 1 つ前に戻した直後に
/// 「進める」を押すと、**戻す前の旅程から組んだ**候補が採用されてしまう。
@Test @MainActor func aQuestionDoesNotSurviveAnUndo() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland)
  store.request.entries[0].priority = .must
  await store.build()
  let id = store.bundle!.plan.days.flatMap(\.stops).first { $0.priority == .must }!.stop.id
  await store.setStayMinutes(stopId: id, minutes: 240)   // 戻せるものを 1 つ積む
  await store.removeStop(id: id)
  #expect(store.view.pendingHardEdit != nil)

  await store.undo()
  #expect(store.view.pendingHardEdit == nil)   // 問いは旅程ごと消える
  await store.confirmPendingEdit()
  #expect(store.edit.removedStops.isEmpty)     // 遅れて届いた「進める」は何も適用しない
  #expect(store.edit.userStayMinutes[id] == nil)
}

/// 編集 2 回 = Undo 2 回。1 回の編集が履歴に 2 つ積まれると、旅行者は 2 度押して初めて
/// 1 つ前に戻ることになる。Redo は積んだ順にたどり直す。
@Test @MainActor func eachEditIsExactlyOneStepOfHistory() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let stops = store.bundle!.plan.days.flatMap(\.stops)
  let first = stops[0].stop.id
  let second = stops[1].stop.id
  await store.setStayMinutes(stopId: first, minutes: 120)
  await store.setStayMinutes(stopId: second, minutes: 45)
  #expect(store.edit.userStayMinutes[first] == 120)
  #expect(store.edit.userStayMinutes[second] == 45)

  await store.undo()
  #expect(store.edit.userStayMinutes[first] == 120)
  #expect(store.edit.userStayMinutes[second] == nil)
  await store.undo()
  #expect(store.edit.userStayMinutes[first] == nil)
  #expect(!store.canUndo)

  await store.redo()
  #expect(store.edit.userStayMinutes[first] == 120)
  #expect(store.edit.userStayMinutes[second] == nil)
  await store.redo()
  #expect(store.edit.userStayMinutes[second] == 45)
  #expect(!store.canRedo)
}

/// 関所を通らない変更が `edit` に入ったら、そこまでの台帳は畳む。「入力にもどる」で歩く
/// 速さを変えて組み直した旅程には、積んである「1 つ前」がもう存在しない —— 畳まないと、
/// その「元に戻す」は**歩く速さの変更ごと**捨てて、旅行者が一度も見ていない旅程へ跳ぶ。
@Test @MainActor func aRebuildOutsideTheGuardClosesTheOldHistory() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let id = store.bundle!.plan.days[0].stops[0].stop.id
  await store.setStayMinutes(stopId: id, minutes: 120)
  #expect(store.canUndo)

  store.setPace(.relaxed)   // Start 画面の設定は関所を通らない
  #expect(!store.canUndo)   // 組み直す前から、もう戻れる先は無い

  await store.build()
  #expect(!store.canUndo)
  #expect(!store.canRedo)

  let settled = store.edit
  await store.undo()        // 押しても何も起きない
  #expect(store.edit == settled)
  #expect(store.edit.pace == .relaxed)
  #expect(store.edit.userStayMinutes[id] == 120)
}

/// 一方、`edit` を 1 ミリも動かさない再組み立て(計算量オーバーの警告行「もう一度試す」、
/// `WarningLine.swift` の `.retryBuild` → `store.build()`)は台帳をそのまま残す —— 畳むと、
/// 計算が重かっただけの旅程で守られた編集の「元に戻す」が急に効かなくなる。
@Test @MainActor func aRetryBuildWithoutDriftKeepsTheUndoHistory() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let id = store.bundle!.plan.days[0].stops[0].stop.id
  await store.setStayMinutes(stopId: id, minutes: 120)
  #expect(store.canUndo)

  await store.build()   // edit は動いていない(退避先が無い再試行)
  #expect(store.canUndo)

  await store.undo()
  #expect(store.edit.userStayMinutes[id] == nil)
}

/// Undo は**組み直す**。数だけ戻して旅程を古いままにすると、画面の滞在時間と到着時刻が
/// 食い違う(統合仕様 §5.1)。
@Test @MainActor func undoRebuildsThePlanAndSaysNothingInAToast() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let original = store.bundle!.plan
  let id = store.bundle!.plan.days[0].stops[0].stop.id
  await store.setStayMinutes(stopId: id, minutes: 240)
  #expect(store.bundle?.plan != original)
  await store.undo()
  #expect(store.bundle?.plan == original)
  #expect(store.view.toast == nil)   // 元に戻す操作は自分のトーストを出さない
}

/// トーストの文は Kit から来る:見出し(何をしたか)と余裕の差の 2 つだけで、差が 0 の
/// ときは「±0」を出さない。
@Test @MainActor func theToastCarriesTheLabelAndTheKitBufferLine() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let id = store.bundle!.plan.days[0].stops[0].stop.id
  let before = store.bundle!
  await store.setStayMinutes(stopId: id, minutes: 240)
  guard let toast = store.view.toast, let after = store.bundle else {
    Issue.record("an applied edit must say so"); return
  }
  #expect(toast.kind == .edit)
  #expect(toast.canUndo)
  #expect(toast.text.hasPrefix(AppCopy.for(.ja).editedToast))
  // 余裕の差は**同じ 2 つの旅程**から測る。トーストが自前の数を持たないことがここの主題。
  let delta = TripScenarios.totalPlanBufferMinutes(plan: after.plan, context: after.request.context)
    - TripScenarios.totalPlanBufferMinutes(plan: before.plan, context: before.request.context)
  if let detail = VerdictCopy.bufferToastDetail(delta, locale: .ja) {
    #expect(toast.text == "\(AppCopy.for(.ja).editedToast) \(detail)")
  } else {
    #expect(toast.text == AppCopy.for(.ja).editedToast)   // 差が 0 なら「±0」を足さない
  }
}

/// トーストは 1 度に 1 つ。2 つ目が出たら 1 つ目は消え、`元に戻す` を押した後も残らない。
/// (6 秒の自動消去そのものは実時計に依るのでここでは見ない —— 見ると、機械の忙しさで
/// 答えが変わるテストになる。)
@Test @MainActor func onlyTheLatestToastIsOnScreen() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let stops = store.bundle!.plan.days.flatMap(\.stops)
  await store.setStayMinutes(stopId: stops[0].stop.id, minutes: 120)
  guard let first = store.view.toast else { Issue.record("the first edit must say so"); return }
  await store.setStayMinutes(stopId: stops[1].stop.id, minutes: 45)
  guard let second = store.view.toast else { Issue.record("the second edit must say so"); return }
  #expect(second.id != first.id)
  #expect(PlannerStore.toastDuration == .seconds(6))
  store.dismissToast()
  #expect(store.view.toast == nil)
}

/// 外した場所は戻せる。戻す操作も同じ関所を通る —— 戻ってきた訪問は分を食うので、
/// 予約に遅れることがある(Web `usePlannerEdits.tsx:521-535` と同じ理屈)。
@Test @MainActor func aRemovedStopCanComeBack() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let id = store.bundle!.plan.days[0].stops[0].stop.id
  await store.removeStop(id: id)
  #expect(store.view.pendingHardEdit == nil)   // 必須でも予約でもない場所は問いかけずに外す
  #expect(store.edit.removedStops.contains { $0.id == id })
  #expect(!store.bundle!.plan.days.flatMap(\.stops).contains { $0.stop.id == id })
  await store.restoreStop(id: id)
  #expect(store.edit.removedStops.isEmpty)
  #expect(store.bundle!.plan.days.flatMap(\.stops).contains { $0.stop.id == id })
}

/// 区間の手段・日の窓・最終入場も同じ 1 つの関所を通る。**押した場所が違っても、守られ方は
/// 同じでなければならない**(v1.1 TC-007)。
@Test @MainActor func theOtherEditsAllReachTheEngine() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let id = store.bundle!.plan.days[0].stops[0].stop.id

  await store.setDayStart(day: 0, time: "08:00")
  #expect(store.edit.dayStartTimes[0] == "08:00")
  #expect(store.bundle?.request.context.dayStartTimes?[0] == "08:00")

  await store.setDayEnd(day: 0, time: "19:30")
  #expect(store.edit.dayEndTimes[0] == "19:30")

  await store.setLastEntry(stopId: id, time: "16:00")
  #expect(store.edit.lastEntryTimes[id] == "16:00")
  await store.setLastEntry(stopId: id, time: nil)
  #expect(store.edit.lastEntryTimes[id] == nil)

  guard let leg = store.bundle!.plan.days.first(where: { !$0.legs.isEmpty })?.legs.first else {
    Issue.record("the sample trip must contain at least one leg"); return
  }
  let key = routeLegKey(leg.from.id, leg.to.id)
  await store.setLegMode(legKey: key, mode: .taxi)
  #expect(store.edit.legModeOverrides[key] == .taxi)
  // 同じ手段をもう一度選ぶと指定が外れる(自動へ戻る)。
  await store.setLegMode(legKey: key, mode: .taxi)
  #expect(store.edit.legModeOverrides[key] == nil)
}

/// 日を移した場所は、その日に居る。`dayOverrides` は 1 始まりで書く(Kit の
/// `PlannerContext.dayOverrides` がそう読む)。
@Test @MainActor func movingAStopToAnotherDayPutsItThere() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let id = store.bundle!.plan.days[0].stops[0].stop.id
  await store.moveStop(id: id, toDay: 1)
  if store.view.pendingHardEdit != nil { await store.confirmPendingEdit() }
  #expect(store.edit.dayOverrides[id] == 2)
  #expect(store.view.selectedDay == 1)
}

/// シミュレータで見つけた 2 つの形。どちらも「開いているシートの上では起きられない」ことが
/// 原因なので、開いた状態のまま編集が進んだときに何が閉じるかを留めておく。
///
///   * 外した場所のシートは**白紙のまま残った**。その下に出たトーストの「元に戻す」に
///     手が届かない。
///   * 問いかけは**一度も出なかった**。開いたシートの上に確認ダイアログは提示できない。
@Test @MainActor func anOpenSheetGetsOutOfTheWayWhenItsStopLeavesThePlan() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let id = store.bundle!.plan.days[0].stops[0].stop.id
  store.openInspector(.stop(id))
  #expect(store.view.inspector == .stop(id))
  await store.removeStop(id: id)
  #expect(store.view.inspector == nil)
  #expect(store.view.toast != nil)
}

@Test @MainActor func anOpenSheetGetsOutOfTheWayBeforeTheQuestion() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland)
  store.request.entries[0].priority = .must
  await store.build()
  let id = store.bundle!.plan.days.flatMap(\.stops).first { $0.priority == .must }!.stop.id
  store.openInspector(.stop(id))
  await store.removeStop(id: id)
  #expect(store.view.inspector == nil)
  #expect(store.view.pendingHardEdit != nil)
}

/// 日数を縮めると消える日の設定シートも、開いたままにしない。
@Test @MainActor func theDaySheetClosesWhenItsDayIsGone() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  store.openInspector(.daySettings(3))
  await store.changeTripDays(2)
  if store.view.pendingHardEdit != nil { await store.confirmPendingEdit() }
  #expect(store.bundle?.plan.days.count == 2)
  #expect(store.view.inspector == nil)
}

// MARK: - 詳細シートの中身

/// 滞在時間が誰の言い分かは**物証の一覧**が決める(`duration:<id>`)。`edit.userStayMinutes`
/// から導くと、指定した直後のまだ組み直していない旅程に「滞在」と書いてしまう。
@Test @MainActor func theInspectorReadsItsStayStatusFromTheEvidence() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let id = store.bundle!.plan.days[0].stops[0].stop.id
  guard let before = store.inspector(for: id) else { Issue.record("a planned stop must have a sheet"); return }
  #expect(before.stayStatus == .estimated)
  #expect(before.stayHeadline == TimelinePresentation.stayLine(minutes: before.currentStay, status: .estimated, locale: .ja))
  #expect(before.stayBasisLine == TimelinePresentation.stayBasisLine(.estimated, locale: .ja))
  #expect(before.stayOverride == nil)

  await store.setStayMinutes(stopId: id, minutes: 120)
  guard let after = store.inspector(for: id) else { Issue.record("the stop must still have a sheet"); return }
  #expect(after.stayStatus == .user_provided)
  #expect(after.currentStay == 120)
  #expect(after.stayOverride == 120)
  #expect(after.stayHeadline == TimelinePresentation.stayLine(minutes: 120, status: .user_provided, locale: .ja))
}

/// 根拠の行はその場所の事実だけを集める(場所・滞在・営業時間・最終入場)。**他の場所の
/// 事実が混ざらない**ことが、シートの読み手にとっての正しさそのもの。
@Test @MainActor func theInspectorEvidenceOnlyNamesItsOwnStop() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let id = store.bundle!.plan.days[0].stops[0].stop.id
  guard let model = store.inspector(for: id) else { Issue.record("a planned stop must have a sheet"); return }
  #expect(!model.evidenceLines.isEmpty)
  let allowed = store.bundle!.evidence.facts.filter {
    $0.id == "place:\(id)" || $0.id == "duration:\(id)" || $0.id.hasPrefix("hours:\(id):") || $0.id.hasPrefix("last-entry:\(id):")
  }
  #expect(model.evidenceLines.count == allowed.count)
  var checked = 0
  for line in model.evidenceLines {
    #expect(!line.label.isEmpty)
    #expect(!line.status.isEmpty)
    checked += 1
  }
  #expect(checked > 0)
  #expect(model.canRemove)
  #expect(model.dayOptions == Array(0..<store.bundle!.plan.days.count))
  #expect(model.stayOptions.first == Int?.none)   // 先頭は「自動」
  // 最終入場は決めていない(`nil`)。倒したときの初期値はこの停留所を出る時刻そのもので、
  // 倒しただけでは旅程が 1 分も動かない。
  #expect(model.lastEntry == nil)
  #expect(model.lastEntryDefault == store.bundle!.plan.days[0].stops[0].departure)
}

/// 根拠の行は**旅行者の言葉**で出る。シミュレータで最初に出たのは「ツェルマット / 120 /
/// 推定」の 2 行で、見出しが両方とも場所の名前、中身が生の分数、そして**調べていない事実に
/// 「推定」**という札が付いていた。3 つとも直っていることを留める。
@Test @MainActor func theEvidenceRowsSpeakInWordsNotRawValues() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let id = store.bundle!.plan.days[0].stops[0].stop.id
  guard let model = store.inspector(for: id) else { Issue.record("a planned stop must have a sheet"); return }
  let app = AppCopy.for(.ja)
  let text = Copy.for(.ja)

  // 1. 見出しは種類ごとに違う語(場所の名前を 2 度並べない)
  #expect(Set(model.evidenceLines.map(\.label)).count == model.evidenceLines.count)

  // 2. 滞在時間は分数そのものではなく、画面の他の分数と同じ書式
  guard let stay = model.evidenceLines.first(where: { $0.id == "duration:\(id)" }) else {
    Issue.record("every planned stop carries a stay-duration fact"); return
  }
  #expect(stay.label == text.stayLabel)
  #expect(stay.value == TripPresentation.formatDuration(minutes: model.currentStay, locale: .ja))

  // 3. 調べていない事実は「推定」と名乗らない
  var checked = 0
  for fact in store.bundle!.evidence.facts where fact.id == "place:\(id)" {
    let line = model.evidenceLines.first { $0.id == fact.id }
    #expect(line?.label == app.evidencePlaceLabel)
    if fact.evidence.status == .unknown || fact.evidence.status == .failed {
      #expect(line?.status == app.evidenceStatusUnknown)
      #expect(line?.status != TimelinePresentation.durationSourceLabel(.estimated, locale: .ja))
    }
    checked += 1
  }
  #expect(checked > 0)

}

/// 営業時間の行は `OpeningStatus` の機械語(`verified_open` など)を出さない。スイスの見本は
/// 町や山ばかりで営業時間を持たない(`PlaceHours.requiresOpeningHours`)ので、旅程からでは
/// この 5 通りを 1 つも踏めない —— 訳す表そのものを直接引く。
@Test func theOpeningHoursRowNeverShowsAMachineWord() {
  for locale in [PlannerLocale.ja, .en] {
    var checked = 0
    for status in OpeningStatus.allCases {
      let value = PlannerStore.evidenceValue(
        CriticalFact(
          id: "hours:x:2026-08-24",
          kind: .opening_hours,
          label: "X",
          evidence: Evidence(value: .string(status.rawValue), status: .verified, source: .google)
        ),
        locale: locale
      )
      #expect(!OpeningStatus.allCases.map(\.rawValue).contains(value), "\(locale): \(value)")
      #expect(!value.isEmpty)
      checked += 1
    }
    #expect(checked == OpeningStatus.allCases.count)
    // 中身の無い営業時間の事実は「営業時間は不明」。空欄にも機械語にもしない。
    #expect(PlannerStore.evidenceValue(
      CriticalFact(id: "hours:x:2026-08-24", kind: .opening_hours, label: "X",
                   evidence: Evidence(value: nil, status: .unknown, source: .other)),
      locale: locale
    ) == Copy.for(locale).hoursUnknown)
  }
}

/// 地図の入口は 2 つとも本物の URL。Kit は文字列を返すので、組み立てに失敗したら
/// **リンクを出さない**(押しても何も起きないボタンを置かない)。
@Test @MainActor func theInspectorBuildsBothMapLinks() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let id = store.bundle!.plan.days[0].stops[0].stop.id
  guard let model = store.inspector(for: id) else { Issue.record("a planned stop must have a sheet"); return }
  #expect(model.mapsUrl?.host() == "www.google.com")
  #expect(model.appleMapsUrl?.host() == "maps.apple.com")
  #expect(model.appleMapsUrl?.query()?.contains("ll=") == true)
}

/// 日の設定シートが読む 2 つの欄。決めていない日は `nil`(「標準」)で、決めた日はその時刻。
@Test @MainActor func theDaySettingsSheetReadsTheDayWindow() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  #expect(store.dayStartTime(0) == nil)
  #expect(store.dayEndTime(0) == nil)
  await store.setDayStart(day: 0, time: "10:30")
  await store.setDayEnd(day: 0, time: "21:30")
  #expect(store.dayStartTime(0) == "10:30")
  #expect(store.dayEndTime(0) == "21:30")
  await store.setDayStart(day: 0, time: nil)
  #expect(store.dayStartTime(0) == nil)
}
