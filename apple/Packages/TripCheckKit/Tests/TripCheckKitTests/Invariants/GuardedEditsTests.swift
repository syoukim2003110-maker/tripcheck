import Foundation
import Testing
@testable import TripCheckKit

/*
 * `lib/planner-app-state.ts:247-456`(編集ガード)の移植テスト。
 *
 * ブリーフの 6 本 + `tests/planner-guarded-edits.test.ts` の 12 本のうち移植できる 10 本。
 * 移植しない 2 本(`:99-167`「stay/last-entry/day-window/leg-mode がガード経路に結線されている」と
 * `:171-193`「ホテル交換と CHANGE_BASE がガードを通る」)は Web のフック
 * (`app/components/planner/hooks/usePlannerEdits.tsx`)のソースを正規表現で読む結線テストで、
 * Kit には対応するソースが存在しない —— Plan 2 の `PlannerStore.applyGuardedEdit` が同じ契約を
 * 引き受ける(spec §5.1)。
 */

// MARK: - ブリーフの 6 本

@Test func harmlessEditAppliesWithBufferDelta() {
  let (before, after, ctx) = TestStops.stayEdit(from: 90, to: 120)   // 衝突を作らない滞在延長
  guard case .apply(let delta) = PlannerEdits.evaluate(before: before, after: after, context: ctx) else {
    Issue.record("expected apply")
    return
  }
  #expect(delta == -30)
}

@Test func newBookingDelayAsksForConfirmation() {
  let (before, after, ctx) = TestStops.bookingLateEdit()
  guard case .confirm(let conflicts) = PlannerEdits.evaluate(before: before, after: after, context: ctx) else {
    Issue.record("expected confirm")
    return
  }
  #expect(conflicts.first?.kind == .booking_late)
  #expect(conflicts.first?.message.contains("分") == true)
}

@Test func airportOverrunIsNotNettedAgainstCurfewImprovement() {
  let (before, after, _) = TestStops.airportWorseCurfewBetter()   // 門限 +90 分改善、空港 −30 分悪化
  let c = PlannerEdits.hardEditConflicts(before: before, after: after)
  #expect(c.contains { $0.kind == .airport_cutoff })
  // 実際に組んだ 2 日計画が TS のリテラルと同じ数字であることを固定しておく。
  #expect(before.days.map(\.deadlineOverrunMinutes) == [90, 0])
  #expect(after.days.map(\.deadlineOverrunMinutes) == [0, 30])
  #expect(c.first { $0.kind == .airport_cutoff }?.minutes == 30)
  #expect(!c.contains { $0.kind == .day_end_missed })
}

@Test func differentDaysAndKindsNeverCancel() {
  let (before, after, _) = TestStops.dayOneWorseDayTwoBetter()
  #expect(!PlannerEdits.hardEditConflicts(before: before, after: after).isEmpty)
  // 前 [0, 120, 0] → 後 [20, 0, 15]:合計は 85 分の改善だが、悪くなった 2 件はそのまま報告される。
  #expect(before.days.map(\.deadlineOverrunMinutes) == [0, 120, 0])
  #expect(after.days.map(\.deadlineOverrunMinutes) == [20, 0, 15])
  #expect(
    PlannerEdits.hardEditConflicts(before: before, after: after).map(\.kind).sorted { $0.rawValue < $1.rawValue }
      == [.airport_cutoff, .day_end_missed]
  )
}

@Test func unknownOpeningWindowsNeverPromoteToConflict() {
  let (before, after, _) = TestStops.dayStartPastUnknownHours()
  #expect(!PlannerEdits.hardEditConflicts(before: before, after: after).contains { $0.kind == .opening_closed })
}

@Test func existingViolationsAreNotReportedAgain() {
  let (before, after, _) = TestStops.sameViolationBothSides()
  #expect(PlannerEdits.hardEditConflicts(before: before, after: after).isEmpty)
}

// MARK: - `tests/planner-guarded-edits.test.ts` の移植

/// TS `a stay-minutes edit that makes a booked stop late queues a confirmation instead of
/// committing`(`:21-44`)。
@Test func aStayEditThatMakesABookedStopLateQueuesAConfirmation() {
  let (before, after, ctx) = TestStops.bookingLateEdit()
  #expect(before.days[0].stops.allSatisfy { $0.reservationLateMinutes == 0 })   // 出発点は間に合っている

  let evaluation = PlannerEdits.evaluate(before: before, after: after, context: ctx, locale: .en)
  guard case .confirm(let messages) = evaluation else {
    Issue.record("new booking lateness must queue a confirmation")
    return
  }
  #expect(messages.contains { $0.message.contains("late for “teamLab Planets”") })

  let conflicts = PlannerEdits.hardEditConflicts(before: before, after: after, locale: .en)
  #expect(conflicts.count == 1)
  #expect(conflicts.first?.kind == .booking_late)
  #expect((conflicts.first?.minutes ?? 0) > 0)
}

/// TS `a harmless stay-minutes edit still applies instantly without a confirmation`(`:46-59`)。
@Test func aHarmlessStayEditAppliesInstantlyWithoutAConfirmation() {
  let (before, after, ctx) = TestStops.bookingLateEdit(stayMinutes: 100)
  guard case .apply = PlannerEdits.evaluate(before: before, after: after, context: ctx, locale: .en) else {
    Issue.record("expected apply")
    return
  }
}

/// TS `exactly one new booking delay titles the dialog with the Copy Deck delay sentence in both
/// locales`(`:61-97`)。TS は題を `evaluatePlannerHardEdit` の戻りに入れるが、Swift の
/// `HardEditDecision` は衝突そのものを運ぶ —— 題の規則(`:411-417`)は `confirmTitle` にある。
@Test func exactlyOneNewBookingDelayTitlesTheDialogInBothLocales() {
  for locale in [PlannerLocale.ja, .en] {
    let (before, after, _) = TestStops.bookingLateEdit()
    let conflicts = PlannerEdits.hardEditConflicts(before: before, after: after, locale: locale)
    #expect(conflicts.count == 1)
    #expect(conflicts.first?.kind == .booking_late)
    let minutes = conflicts.first?.minutes ?? 0

    let fallback = locale == .ja ? "「Senso-ji」の滞在時間を360分にしますか？" : "Set the stay at “Senso-ji” to 360 minutes?"
    #expect(
      PlannerEdits.confirmTitle(conflicts: conflicts, fallback: fallback, locale: locale)
        == HardEditCopy.bookingDelayTitle(minutes, locale: locale)
    )
    if locale == .ja {
      #expect(HardEditCopy.bookingDelayTitle(minutes, locale: locale) == "この変更で予約に\(minutes)分遅れます")
    } else {
      #expect(HardEditCopy.bookingDelayTitle(minutes, locale: locale) == "This change makes you \(minutes) minutes late")
    }

    // 衝突がもう 1 件でもあれば、呼び出し側の疑問形の題がそのまま残る。
    #expect(
      PlannerEdits.confirmTitle(
        conflicts: conflicts,
        extraConflicts: ["another protected promise breaks"],
        fallback: fallback,
        locale: locale
      ) == fallback
    )
  }
}

/// TS `an airport cutoff breach is never cancelled out by a curfew improvement`(`:241-255`)。
@Test func anAirportCutoffBreachIsNeverCancelledOutByACurfewImprovement() {
  // 1 日目は終了時刻を 90 分超え、便には余裕がある。
  let plan = TestStops.deadlinePlan([(.curfew, 90), (.airport, 0)])
  // 候補は長い日を直し、飛行機に 30 分遅れる。
  let candidatePlan = TestStops.deadlinePlan([(.curfew, 0), (.airport, 30)])

  let conflicts = PlannerEdits.hardEditConflicts(before: plan, after: candidatePlan, locale: .en)
  #expect(conflicts.map(\.kind) == [.airport_cutoff])
  #expect(conflicts.first?.minutes == 30)
  guard case .confirm = PlannerEdits.evaluate(before: plan, after: candidatePlan, context: PlannerContext(), locale: .en) else {
    Issue.record("a 60-minute net improvement must not buy a missed flight")
    return
  }
}

/// TS `an airport cutoff that improves is an improvement, and one that appears is damage`
/// (`:257-270`)。
@Test func anAirportCutoffThatImprovesIsAnImprovementAndOneThatAppearsIsDamage() {
  let missing30 = TestStops.deadlinePlan([(.airport, 30)])
  let missing10 = TestStops.deadlinePlan([(.airport, 10)])
  let onTime = TestStops.deadlinePlan([(.airport, 0)])
  let missing1 = TestStops.deadlinePlan([(.airport, 1)])

  #expect(PlannerEdits.hardEditConflicts(before: missing30, after: missing10, locale: .en).isEmpty)
  #expect(PlannerEdits.hardEditConflicts(before: missing30, after: missing30, locale: .en).isEmpty)
  #expect(PlannerEdits.hardEditConflicts(before: onTime, after: missing1, locale: .en).map(\.kind) == [.airport_cutoff])
}

/// TS `deadlines on different days and of different kinds never net off`(`:272-286`)。
@Test func deadlinesOnDifferentDaysAndOfDifferentKindsNeverNetOff() {
  let plan = TestStops.deadlinePlan([(.curfew, 0), (.curfew, 120), (.airport, 0)])
  // 真ん中の日は大きく良くなる。1 日目と便はどちらも悪くなる。
  let candidatePlan = TestStops.deadlinePlan([(.curfew, 20), (.curfew, 0), (.airport, 15)])
  let kinds = PlannerEdits.hardEditConflicts(before: plan, after: candidatePlan, locale: .en)
    .map(\.kind)
    .sorted { $0.rawValue < $1.rawValue }
  #expect(kinds == [.airport_cutoff, .day_end_missed])
}

/// TS `a missed day-end target says so, instead of announcing a missed flight`(`:288-297`)。
@Test func aMissedDayEndTargetSaysSoInsteadOfAnnouncingAMissedFlight() {
  let conflicts = PlannerEdits.hardEditConflicts(
    before: TestStops.deadlinePlan([(.curfew, 0)]),
    after: TestStops.deadlinePlan([(.curfew, 45)]),
    locale: .en
  )
  #expect(conflicts.map(\.kind) == [.day_end_missed])
  #expect(conflicts.first?.message.contains("45 minutes past its end time") == true)
  #expect(conflicts.first?.message.lowercased().contains("airport") == false)
}

/// TS `a day start that breaks a verified closing time queues a confirmation`(`:305-327`)。
@Test func aDayStartThatBreaksAVerifiedClosingTimeQueuesAConfirmation() {
  let (before, after, ctx) = TestStops.dayStartPastVerifiedClosing()
  #expect(before.days[0].openingConflictCount == 0)   // 出発点は窓の中
  #expect(after.days[0].openingConflictCount > 0)     // 候補は本当に窓を破る

  #expect(PlannerEdits.hardEditConflicts(before: before, after: after, locale: .en).contains { $0.kind == .opening_closed })
  guard case .confirm = PlannerEdits.evaluate(before: before, after: after, context: ctx, locale: .en) else {
    Issue.record("expected confirm")
    return
  }
}

// MARK: - 事実のキーと余白(TS のテストが直接触れない枝)

/// must の停留所が候補計画から消えたら `must_drop`。`allowDropStopId` を渡した回だけは、
/// 「外す」と決めた本人に向かって外れることを報告しない(`:355-362`)。
@Test func droppingAMustStopIsDamageUnlessItIsTheEditItself() {
  let (before, after, _) = TestStops.mustStopDropped()
  #expect(before.days[0].stops.contains { $0.stop.id == "sensoji" && $0.priority == .must })
  #expect(!after.days.contains { $0.stops.contains { $0.stop.id == "sensoji" } })

  let conflicts = PlannerEdits.hardEditConflicts(before: before, after: after, locale: .en)
  #expect(conflicts.map(\.kind) == [.must_drop])
  #expect(conflicts.first?.message.contains("Senso-ji") == true)
  #expect(PlannerEdits.hardEditConflicts(before: before, after: after, locale: .en, allowDropStopId: "sensoji").isEmpty)
}

/// 最終入場に間に合わなくなる編集は、営業時間の衝突ではなく `last_entry_missed` として出る。
@Test func aMissedLastEntryIsItsOwnKind() {
  let (before, after, _) = TestStops.lastEntryMissedEdit()
  #expect(after.days[0].stops.contains { $0.stop.id == "tokyo-skytree" && $0.openingStatus == .last_entry_conflict })
  let conflicts = PlannerEdits.hardEditConflicts(before: before, after: after, locale: .en)
  #expect(conflicts.map(\.kind) == [.last_entry_missed])
  #expect(conflicts.first?.message.contains("last entry") == true)
}

/// 事実は辞書ではなく**挿入順**で並ぶ(TS の `Map` と同じ)。同じ入力からは毎回同じ並びが出る。
@Test func conflictOrderIsDeterministic() {
  let plan = TestStops.deadlinePlan([(.curfew, 0), (.curfew, 120), (.airport, 0)])
  let candidatePlan = TestStops.deadlinePlan([(.curfew, 20), (.curfew, 0), (.airport, 15)])
  let first = PlannerEdits.hardEditConflicts(before: plan, after: candidatePlan, locale: .en)
  for _ in 0..<50 {
    #expect(PlannerEdits.hardEditConflicts(before: plan, after: candidatePlan, locale: .en) == first)
  }
  // 日の締切は訪問順に記録されるので、1 日目の門限が便より先に来る。
  #expect(first.map(\.kind) == [.day_end_missed, .airport_cutoff])
}

/// 同じ文が 2 度出ることはない(TS `:404` の `new Set`)。
@Test func theConfirmationNeverRepeatsTheSameSentence() {
  let (before, after, ctx) = TestStops.bookingLateEdit()
  guard case .confirm(let conflicts) = PlannerEdits.evaluate(before: before, after: after, context: ctx, locale: .en) else {
    Issue.record("expected confirm")
    return
  }
  #expect(Set(conflicts.map(\.message)).count == conflicts.count)
}

/// 6 種の文は Copy Deck の逐語(`lib/presentation/planner-copy.ts:867-903`)。Task 24 はこれを
/// 再移植せずここから使うので、両言語の全文をここで凍らせておく。TS 側の実行結果
/// (Node 22 で `plannerHardEditConflicts` を回したもの)と一致する —— 「1 minutes」の
/// 複数形の粗さも含めて TS のまま。
@Test func everyHardEditSentenceIsTheCopyDeckWording() {
  #expect(HardEditCopy.conflictSentence(.booking_late, name: "teamLab Planets", minutes: 170, locale: .ja) == "「teamLab Planets」の予約に170分遅れます")
  #expect(HardEditCopy.conflictSentence(.booking_late, name: "teamLab Planets", minutes: 170, locale: .en) == "You would be 170 minutes late for “teamLab Planets”")
  #expect(HardEditCopy.conflictSentence(.must_drop, name: "Senso-ji", minutes: 0, locale: .ja) == "必須の「Senso-ji」が日程に入らなくなります")
  #expect(HardEditCopy.conflictSentence(.must_drop, name: "Senso-ji", minutes: 0, locale: .en) == "Must-visit “Senso-ji” would no longer fit the plan")
  #expect(HardEditCopy.conflictSentence(.day_end_missed, name: "", minutes: 45, locale: .ja) == "その日の終了時刻を45分超えます")
  #expect(HardEditCopy.conflictSentence(.day_end_missed, name: "", minutes: 45, locale: .en) == "That day would run 45 minutes past its end time")
  #expect(HardEditCopy.conflictSentence(.opening_closed, name: "Senso-ji", minutes: 0, locale: .ja) == "「Senso-ji」の営業時間から外れます")
  #expect(HardEditCopy.conflictSentence(.opening_closed, name: "Senso-ji", minutes: 0, locale: .en) == "“Senso-ji” would fall outside its opening hours")
  #expect(HardEditCopy.conflictSentence(.last_entry_missed, name: "Tokyo Skytree", minutes: 0, locale: .ja) == "「Tokyo Skytree」の最終入場に間に合わなくなります")
  #expect(HardEditCopy.conflictSentence(.last_entry_missed, name: "Tokyo Skytree", minutes: 0, locale: .en) == "You would arrive after the last entry for “Tokyo Skytree”")
  #expect(HardEditCopy.conflictSentence(.airport_cutoff, name: "", minutes: 1, locale: .ja) == "空港へ向かう締切を1分超えます")
  #expect(HardEditCopy.conflictSentence(.airport_cutoff, name: "", minutes: 1, locale: .en) == "The airport cutoff would be missed by 1 minutes")
  #expect(HardEditConflictKind.allCases.count == 6)
}

/// TS `builtPlanTravelMinutes`(`:219-226`)—— ホテルの往復 2 本と各レグの推奨手段の分。
@Test func builtPlanTravelMinutesCountsHotelHopsAndEveryLeg() {
  var context = PlannerContext()
  context.resolvedBase = TestStops.resolvedBase()
  let plan = TripBuilder.build(TestStops.tokyoRequest("Senso-ji\nTokyo Skytree", days: 1, context: context))
  let day = plan.days[0]
  let expected = (day.hotelOutboundMinutes ?? 0) + (day.hotelInboundMinutes ?? 0)
    + day.legs.reduce(0) { $0 + $1.comparison.recommended.minutes }
  #expect(PlannerEdits.builtPlanTravelMinutes(plan) == expected)
  #expect(expected > 0)
  #expect((day.hotelOutboundMinutes ?? 0) > 0)
}
