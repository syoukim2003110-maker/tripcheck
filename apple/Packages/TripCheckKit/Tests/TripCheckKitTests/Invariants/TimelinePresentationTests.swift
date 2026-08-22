import Foundation
import Testing
@testable import TripCheckKit

/*
 * `lib/presentation/timeline-presentation.ts` と `lib/presentation/trip-presentation.ts` の
 * 移植テスト —— ブリーフ Step 1 の該当分 + `tests/timeline-presentation.test.ts`(21 本)。
 */

// MARK: - ブリーフ Step 1

@Test func estimatedAndVerifiedStayLinesAreNeverTheSameSentence() {
  for minutes in [30, 45, 60, 90, 120, 150, 180, 240] {
    let estimatedJa = TimelinePresentation.stayLine(minutes: minutes, status: .estimated, locale: .ja)
    let verifiedJa = TimelinePresentation.stayLine(minutes: minutes, status: .verified, locale: .ja)
    #expect(estimatedJa != verifiedJa)
    #expect(estimatedJa.contains("目安"))
    #expect(!verifiedJa.contains("目安"))
    let estimatedEn = TimelinePresentation.stayLine(minutes: minutes, status: .estimated, locale: .en)
    #expect(estimatedEn.lowercased().contains("about") || estimatedEn.contains("~"))
  }
}

/// ブリーフの `transportModeLabel(mode:minutes:source:transfers:locale:)` は TS には無い —— TS の
/// `transportModeLabel`(`lib/presentation/timeline-presentation.ts:17-21`)は手段の名前だけを返し、
/// 「電車 95分・乗換1回」という 1 行を組むのは `MovementCard.tsx:56-63`。TS が正なので、Kit は
/// 名前を返す関数と、その組み立て(`legHeadline`)を分けて持つ。
///
/// 「実測は『約』なし」も TS の形のまま —— この行には推定側にも「約」が無い(「約」が付くのは
/// ホテル発着の行 `hotelDepartRow` / `hotelReturnRow` だけ)。
@Test func measuredLegsDropTheApproximationWord() {
  #expect(TimelinePresentation.legHeadline(mode: .transit, minutes: 95, transferCount: 1, travelPreference: .auto, locale: .ja)
    == "電車 95分・乗換1回")
  #expect(TimelinePresentation.legHeadline(mode: .transit, minutes: 60, transferCount: nil, travelPreference: .auto, locale: .ja)
    == "電車 60分")
  #expect(TimelinePresentation.legHeadline(mode: .transit, minutes: 95, transferCount: 1, travelPreference: .auto, locale: .en)
    == "Train 95 min · 1 transfer")
  #expect(TimelinePresentation.legHeadline(mode: .transit, minutes: 95, transferCount: 2, travelPreference: .auto, locale: .en)
    == "Train 95 min · 2 transfers")
  #expect(!TimelinePresentation.legHeadline(mode: .transit, minutes: 95, transferCount: 1, travelPreference: .auto, locale: .ja).contains("約"))
  // 乗換の数は transit のときだけ付く。
  #expect(TimelinePresentation.legHeadline(mode: .walk, minutes: 12, transferCount: 3, travelPreference: .auto, locale: .ja) == "徒歩 12分")
}

@Test func spareDaysReplaceSlackAndNeverLengthenTheLine() {
  let (plan, fit) = TestStops.planWithSpareDay()
  let totals = TripPresentation.tripStatsTotals(plan: plan, fit: fit)
  #expect(totals.spareDays == 1)
  let line = TripPresentation.tripStatsLine(totals, locale: .ja)
  #expect(line.contains("1日分の空き"))
  #expect(!line.contains("余裕"))
  var noSpare = totals
  noSpare.spareDays = nil
  #expect(line.count <= TripPresentation.tripStatsLine(noSpare, locale: .ja).count)
}

@Test func dayPaletteHasSevenColoursAndCycles() {
  #expect(DayPalette.colors.count == 7)
  #expect(DayPalette.color(forDayIndex: 7) == DayPalette.colors[0])
  #expect(DayPalette.color(forDayIndex: 0) == "#2563EB")
  #expect(DayPalette.color(forDayIndex: -1) == DayPalette.colors[6])
  #expect(DayPalette.colors == ["#2563EB", "#7C3AED", "#C2410C", "#15803D", "#BE185D", "#0F766E", "#A16207"])
}

// MARK: - `tests/timeline-presentation.test.ts` の移植

/// TS `test("transportModeLabel honors the car preference and falls back on null")`(`:23-29`)。
@Test func transportModeLabelHonorsTheCarPreferenceAndFallsBackOnNull() {
  #expect(TimelinePresentation.transportModeLabel(.taxi, travelPreference: .car, locale: .ja) == Copy.ja.moveCar)
  #expect(TimelinePresentation.transportModeLabel(.taxi, travelPreference: .auto, locale: .ja) == Copy.ja.move.taxi)
  #expect(TimelinePresentation.transportModeLabel(.walk, travelPreference: .car, locale: .en) == Copy.en.move.walk)
  #expect(TimelinePresentation.transportModeLabel(nil, travelPreference: .auto, locale: .en) == Copy.en.move.transit)
  #expect(TimelinePresentation.transportModeLabel(nil, travelPreference: .car, locale: .ja) == Copy.ja.moveCar)
}

/// TS `test("day tab copy states density in the traveller's language")`(`:31-40`)。
@Test func dayTabCopyStatesDensityInTheTravellersLanguage() {
  #expect(TimelinePresentation.dayTabDensityLabel(stopCount: 0, locale: .ja) == "予定なし")
  #expect(TimelinePresentation.dayTabDensityLabel(stopCount: 2, locale: .ja) == "ゆったり")
  #expect(TimelinePresentation.dayTabDensityLabel(stopCount: 5, locale: .ja) == "5か所")
  #expect(TimelinePresentation.dayTabDensityLabel(stopCount: 0, locale: .en) == "empty")
  #expect(TimelinePresentation.dayTabDensityLabel(stopCount: 1, locale: .en) == "easy")
  #expect(TimelinePresentation.dayTabDensityLabel(stopCount: 4, locale: .en) == "4 stops")
  #expect(TimelinePresentation.dayTabTitle(index: 0, locale: .ja) == "1日目")
  #expect(TimelinePresentation.dayTabTitle(index: 2, locale: .en) == "Day 3")
}

/// TS `test("dayHeaderSummary renders the deck's two-number day line")`(`:44-51`)。
@Test func dayHeaderSummaryRendersTheDecksTwoNumberDayLine() {
  #expect(TimelinePresentation.dayHeaderSummary(stopCount: 4, slackMinutes: 90, locale: .ja) == "4か所・余裕1時間30分")
  #expect(TimelinePresentation.dayHeaderSummary(stopCount: 4, slackMinutes: 90, locale: .en) == "4 stops · 1h 30m buffer")
  #expect(TimelinePresentation.dayHeaderSummary(stopCount: 3, slackMinutes: 45, locale: .en).hasSuffix("buffer"))
  #expect(!TimelinePresentation.dayHeaderSummary(stopCount: 3, slackMinutes: 45, locale: .en).lowercased().contains("spare"))
  #expect(TimelinePresentation.dayHeaderSummary(stopCount: 1, slackMinutes: 60, locale: .en) == "1 stop · 1h buffer")
}

/// TS `test("dayHeaderSummary drops the buffer claim without positive slack or stops")`(`:53-60`)。
@Test func dayHeaderSummaryDropsTheBufferClaimWithoutPositiveSlackOrStops() {
  #expect(TimelinePresentation.dayHeaderSummary(stopCount: 4, slackMinutes: 0, locale: .ja) == "4か所")
  #expect(TimelinePresentation.dayHeaderSummary(stopCount: 4, slackMinutes: -30, locale: .en) == "4 stops")
  #expect(TimelinePresentation.dayHeaderSummary(stopCount: 0, slackMinutes: 600, locale: .ja) == "0か所")
  #expect(TimelinePresentation.dayHeaderSummary(stopCount: 0, slackMinutes: 600, locale: .en) == "0 stops")
}

/// TS `test("tripStatsLine renders places, travel and buffer in the deck's form")`(`:63-71`)。
@Test func tripStatsLineRendersPlacesTravelAndBufferInTheDecksForm() {
  let totals = TripStatsTotals(placeCount: 8, travelMinutes: 520, bufferMinutes: 250)
  #expect(TripPresentation.tripStatsLine(totals, locale: .ja) == "8か所・移動8時間40分・余裕4時間10分")
  #expect(TripPresentation.tripStatsLine(totals, locale: .en) == "8 places · 8h 40m travel · 4h 10m buffer")
  #expect(TripPresentation.tripStatsLine(TripStatsTotals(placeCount: 1, travelMinutes: 0, bufferMinutes: 0), locale: .en)
    == "1 place · 0m travel · 0m buffer")
}

/// TS `test("dayDateLabel uses the calendar date only after the user set one")`(`:73-79`)。
@Test func dayDateLabelUsesTheCalendarDateOnlyAfterTheUserSetOne() {
  #expect(TimelinePresentation.dayDateLabel(date: "2026-08-15", label: "Day 2", weekdayLabel: "土", tripDateTouched: true, locale: .ja)
    == "2026-08-15（土）")
  #expect(TimelinePresentation.dayDateLabel(date: "2026-08-15", label: "Day 2", weekdayLabel: "Sat", tripDateTouched: true, locale: .en)
    == "2026-08-15 (Sat)")
  #expect(TimelinePresentation.dayDateLabel(date: "2026-08-15", label: "Day 2", weekdayLabel: "Sat", tripDateTouched: false, locale: .en)
    == "Day 2")
  #expect(TimelinePresentation.dayDateLabel(date: nil, label: "Day 2", weekdayLabel: nil, tripDateTouched: true, locale: .ja) == "Day 2")
}

/// TS `test("durationSourceLabel treats unknown and failed evidence as estimates")`(`:81-88`)。
@Test func durationSourceLabelTreatsUnknownAndFailedEvidenceAsEstimates() {
  #expect(TimelinePresentation.durationSourceLabel(.user_provided, locale: .ja) == "指定")
  #expect(TimelinePresentation.durationSourceLabel(.verified, locale: .ja) == "確認")
  #expect(TimelinePresentation.durationSourceLabel(.estimated, locale: .ja) == "推定")
  #expect(TimelinePresentation.durationSourceLabel(.unknown, locale: .ja) == "推定")
  #expect(TimelinePresentation.durationSourceLabel(.failed, locale: .en) == "estimated")
  #expect(TimelinePresentation.durationSourceLabel(.verified, locale: .en) == "confirmed")
}

/// TS `test("an estimated stay says so in the words, not in a badge")`(`:90-100`)。
@Test func anEstimatedStaySaysSoInTheWordsNotInABadge() {
  #expect(TimelinePresentation.stayLine(minutes: 90, status: .estimated, locale: .ja) == "滞在の目安 1時間30分")
  #expect(TimelinePresentation.stayLine(minutes: 90, status: .unknown, locale: .ja) == "滞在の目安 1時間30分")
  #expect(TimelinePresentation.stayLine(minutes: 90, status: .failed, locale: .ja) == "滞在の目安 1時間30分")
  #expect(TimelinePresentation.stayLine(minutes: 90, status: .verified, locale: .ja) == "滞在 1時間30分")
  #expect(TimelinePresentation.stayLine(minutes: 90, status: .user_provided, locale: .ja) == "滞在 1時間30分")
  #expect(TimelinePresentation.stayLine(minutes: 90, status: .estimated, locale: .en) == "Stay about 1h 30m")
  #expect(TimelinePresentation.stayLine(minutes: 90, status: .verified, locale: .en) == "Stay 1h 30m")
}

/// TS `test("a stay TripCheck guessed is never phrased like one it knows")`(`:102-123`)。
@Test func aStayTripCheckGuessedIsNeverPhrasedLikeOneItKnows() {
  for locale in [PlannerLocale.ja, .en] {
    for guessed in [EvidenceStatus.estimated, .unknown, .failed] {
      for known in [EvidenceStatus.verified, .user_provided] {
        #expect(
          TimelinePresentation.stayLine(minutes: 90, status: guessed, locale: locale)
            != TimelinePresentation.stayLine(minutes: 90, status: known, locale: locale),
          "\(locale): a \(guessed) stay reads exactly like a \(known) one"
        )
      }
    }
  }
  #expect(TimelinePresentation.stayLine(minutes: 90, status: .estimated, locale: .ja).contains("目安"))
  #expect(!TimelinePresentation.stayLine(minutes: 90, status: .verified, locale: .ja).contains("目安"))
  #expect(TimelinePresentation.stayLine(minutes: 90, status: .estimated, locale: .en).contains("about"))
  #expect(!TimelinePresentation.stayLine(minutes: 90, status: .verified, locale: .en).contains("about"))
}

/// TS `test("the evidence disclosure says who decided the stay length")`(`:125-134`)。
@Test func theEvidenceDisclosureSaysWhoDecidedTheStayLength() {
  #expect(TimelinePresentation.stayBasisLine(.user_provided, locale: .ja).contains("あなたが指定"))
  #expect(TimelinePresentation.stayBasisLine(.verified, locale: .ja).contains("確認できた"))
  #expect(TimelinePresentation.stayBasisLine(.estimated, locale: .ja).contains("目安"))
  #expect(TimelinePresentation.stayBasisLine(.unknown, locale: .en).contains("estimate"))
  let ja = Set([EvidenceStatus.user_provided, .verified, .estimated].map { TimelinePresentation.stayBasisLine($0, locale: .ja) })
  #expect(ja.count == 3)
}

/// TS `test("the evidence disclosure is labelled the way the handoff labels it")`(`:136-139`)。
@Test func theEvidenceDisclosureIsLabelledTheWayTheHandoffLabelsIt() {
  #expect(TimelinePresentation.evidenceDisclosureLabel(.ja) == "営業時間・根拠を見る")
  #expect(TimelinePresentation.evidenceDisclosureLabel(.en) == "Opening hours and evidence")
}

/// TS `test("fillerRowLabel names the slot kind")`(`:141-146`)。
@Test func fillerRowLabelNamesTheSlotKind() {
  #expect(TimelinePresentation.fillerRowLabel(.lunch, locale: .ja) == "昼食のおすすめ")
  #expect(TimelinePresentation.fillerRowLabel(.dinner, locale: .en) == "Dinner recommendation")
  #expect(TimelinePresentation.fillerRowLabel(.micro, locale: .ja) == "おすすめ")
  #expect(TimelinePresentation.fillerRowLabel(nil, locale: .en) == "Recommended")
}

/// TS `test("activityFlags orders lateness over fixed time over must, then opening trouble")`
/// (`:148-164`)。
@Test func activityFlagsOrdersLatenessOverFixedTimeOverMustThenOpeningTrouble() {
  func flags(
    late: Int = 0,
    fixedTime: String? = nil,
    priority: StopPriority = .normal,
    openingStatus: OpeningStatus = .unknown,
    locale: PlannerLocale
  ) -> [ActivityFlag] {
    TimelinePresentation.activityFlags(
      reservationLateMinutes: late,
      fixedTime: fixedTime,
      priority: priority,
      openingStatus: openingStatus,
      locale: locale
    )
  }

  #expect(flags(locale: .ja).isEmpty)
  let late = flags(late: 12, fixedTime: "18:00", priority: .must, locale: .ja)
  #expect(late.count == 1)
  #expect(late[0].className == .isBooked)
  #expect(late[0].label == Copy.ja.lateShort(12))
  #expect(flags(fixedTime: "18:00", priority: .must, locale: .ja) == [ActivityFlag(className: .isBooked, label: "18:00")])
  #expect(flags(priority: .must, locale: .en) == [ActivityFlag(className: .isMust, label: Copy.en.must)])
  let both = flags(priority: .must, openingStatus: .conflict, locale: .en)
  #expect(both.count == 2)
  #expect(both[1].label == Copy.en.openingConflict)
  #expect(flags(openingStatus: .last_entry_conflict, locale: .ja) == [ActivityFlag(className: .isBooked, label: "最終入場後")])
  #expect(flags(openingStatus: .closed_day, locale: .ja) == [ActivityFlag(className: .isBooked, label: Copy.ja.openingClosedDay)])
}

/// TS `test("mealSlotsAfterStop attaches each slot to the latest stop reached by its time")`
/// (`:166-176`)。
@Test func mealSlotsAfterStopAttachesEachSlotToTheLatestStopReachedByItsTime() {
  let arrivals = ["09:00", "12:30", "16:00"]
  let slots = [
    TestStops.foodSlot(id: "dinner-1", kind: .dinner, displayTime: "19:00"),
    TestStops.foodSlot(id: "lunch-1", kind: .lunch, displayTime: "12:45"),
    TestStops.foodSlot(id: "odd", kind: .lunch, displayTime: "n/a"),
  ]
  #expect(TimelinePresentation.mealSlotsAfterStop(slots, arrivals: arrivals, stopIndex: 0).map(\.id) == [])
  #expect(TimelinePresentation.mealSlotsAfterStop(slots, arrivals: arrivals, stopIndex: 1).map(\.id) == ["lunch-1"])
  #expect(TimelinePresentation.mealSlotsAfterStop(slots, arrivals: arrivals, stopIndex: 2).map(\.id) == ["odd", "dinner-1"])
}

/// TS `test("mealSlotsAfterStop puts lunch before dinner at the same clock time")`(`:178-185`)。
@Test func mealSlotsAfterStopPutsLunchBeforeDinnerAtTheSameClockTime() {
  let slots = [
    TestStops.foodSlot(id: "d", kind: .dinner, displayTime: "12:00"),
    TestStops.foodSlot(id: "l", kind: .lunch, displayTime: "12:00"),
  ]
  #expect(TimelinePresentation.mealSlotsAfterStop(slots, arrivals: ["09:00"], stopIndex: 0).map(\.id) == ["l", "d"])
}

/// TS `test("transitBoardingText assembles a boarding line and stays null without steps")`
/// (`:187-215`)。
@Test func transitBoardingTextAssemblesABoardingLineAndStaysNilWithoutSteps() {
  #expect(TimelinePresentation.transitBoardingText(nil, locale: .ja) == nil)
  #expect(TimelinePresentation.transitBoardingText(
    TransitLegBoarding(steps: [], walkToStopMinutes: nil, walkFromStopMinutes: nil),
    locale: .ja
  ) == nil)

  let boarding = TransitLegBoarding(
    steps: [TransitStepSummary(
      lineName: "S-Bahn 3",
      headsign: "Luzern",
      departureStop: "Zürich HB",
      arrivalStop: "Luzern",
      departureTime: "09:15",
      shortName: "S3",
      stopCount: 5
    )],
    walkToStopMinutes: 4,
    walkFromStopMinutes: 3
  )
  let ja = TimelinePresentation.transitBoardingText(boarding, locale: .ja)
  #expect(ja?.contains("徒歩約4分 →") == true)
  #expect(ja?.contains("Zürich HB 09:15発") == true)
  #expect(ja?.contains("S3・Luzern行き") == true)
  #expect(ja?.contains("→ Luzern(5駅)") == true)
  #expect(ja?.contains("→ 徒歩約3分") == true)
  let en = TimelinePresentation.transitBoardingText(boarding, locale: .en)
  #expect(en?.contains("~4 min walk →") == true)
  #expect(en?.contains("Zürich HB dep 09:15") == true)
  #expect(en?.contains("S3 toward Luzern") == true)
  #expect(en?.contains("→ Luzern (5 stops)") == true)
  #expect(en?.contains("→ ~3 min walk") == true)
}

/// TS `test("transitBoardingText counts extra connections instead of stop counts")`(`:217-232`)。
@Test func transitBoardingTextCountsExtraConnectionsInsteadOfStopCounts() {
  let boarding = TransitLegBoarding(
    steps: [
      TransitStepSummary(lineName: "Line A", headsign: nil, departureStop: "Start", arrivalStop: "Mid", departureTime: nil, shortName: nil, stopCount: 3),
      TransitStepSummary(lineName: "Line B", headsign: nil, departureStop: "Mid", arrivalStop: "End", departureTime: nil, shortName: nil, stopCount: 2),
    ],
    walkToStopMinutes: nil,
    walkFromStopMinutes: nil
  )
  let en = TimelinePresentation.transitBoardingText(boarding, locale: .en)
  #expect(en?.contains("+1 connection") == true)
  #expect(en?.contains("→ End") == true)
  #expect(en?.contains("stops)") == false)
  #expect(TimelinePresentation.transitBoardingText(boarding, locale: .ja)?.contains("乗継ぎ1本") == true)
}

/// TS `test("tripStatsLine states whole spare days in place of the buffer figure")`(`:234-251`)。
@Test func tripStatsLineStatesWholeSpareDaysInPlaceOfTheBufferFigure() {
  let totals = TripStatsTotals(placeCount: 10, travelMinutes: 520, bufferMinutes: 1600)
  var twoSpare = totals
  twoSpare.spareDays = 2
  #expect(TripPresentation.tripStatsLine(twoSpare, locale: .ja) == "10か所・移動8時間40分・2日分の空き")
  #expect(TripPresentation.tripStatsLine(twoSpare, locale: .en) == "10 places · 8h 40m travel · 2 days spare")
  var oneSpare = totals
  oneSpare.spareDays = 1
  #expect(TripPresentation.tripStatsLine(oneSpare, locale: .en) == "10 places · 8h 40m travel · 1 day spare")
  for locale in [PlannerLocale.ja, .en] {
    #expect(
      TripPresentation.tripStatsLine(twoSpare, locale: locale).count <= TripPresentation.tripStatsLine(totals, locale: locale).count,
      "\(locale): the spare-days line grew the stats line"
    )
  }
}

/// TS `test("tripStatsLine claims no spare days when the assessment withheld a conclusion")`
/// (`:253-264`)。
@Test func tripStatsLineClaimsNoSpareDaysWhenTheAssessmentWithheldAConclusion() {
  let totals = TripStatsTotals(placeCount: 8, travelMinutes: 520, bufferMinutes: 250)
  for spareDays in [nil, 0] as [Int?] {
    var withSpare = totals
    withSpare.spareDays = spareDays
    #expect(TripPresentation.tripStatsLine(withSpare, locale: .ja) == "8か所・移動8時間40分・余裕4時間10分")
    #expect(TripPresentation.tripStatsLine(withSpare, locale: .en) == "8 places · 8h 40m travel · 4h 10m buffer")
  }
}

/// TS `test("the day states how much of it is free and how much more it can take")`(`:266-277`)。
/// `spareCapacityLine` は `lib/presentation/recommendation-presentation.ts:256-271` にあり、
/// そのファイル自体は次の課題の担当だが、この 1 本だけはブリーフの Interfaces にあるので移す。
@Test func theDayStatesHowMuchOfItIsFreeAndHowMuchMoreItCanTake() {
  #expect(TimelinePresentation.spareCapacityLine(slackMinutes: 385, remaining: 3, locale: .ja)
    == "この日は6時間25分空いています。あと3か所まで足せます。")
  #expect(TimelinePresentation.spareCapacityLine(slackMinutes: 385, remaining: 1, locale: .ja)
    == "この日は6時間25分空いています。あと1か所まで足せます。")
  #expect(TimelinePresentation.spareCapacityLine(slackMinutes: 385, remaining: 0, locale: .ja)
    == "この日に足せるおすすめは埋まりました。")
  #expect(TimelinePresentation.spareCapacityLine(slackMinutes: 385, remaining: 2, locale: .en)
    .contains("6h 25m of this day is free — room for 2 more stops."))
  #expect(TimelinePresentation.spareCapacityLine(slackMinutes: 120, remaining: 1, locale: .en).contains("room for 1 more stop."))
  #expect(TimelinePresentation.spareCapacityLine(slackMinutes: 0, remaining: 0, locale: .en).contains("all the suggestions it has room for"))
}

/// TS `test("a full day never invites another stop, whatever the arithmetic says")`(`:279-287`)。
@Test func aFullDayNeverInvitesAnotherStop() {
  for remaining in [0, -1, -5] {
    #expect(TimelinePresentation.spareCapacityLine(slackMinutes: 400, remaining: remaining, locale: .ja)
      == TimelinePresentation.spareCapacityLine(slackMinutes: 400, remaining: 0, locale: .ja))
    #expect(TimelinePresentation.spareCapacityLine(slackMinutes: 400, remaining: remaining, locale: .en)
      == TimelinePresentation.spareCapacityLine(slackMinutes: 400, remaining: 0, locale: .en))
  }
  #expect(!TimelinePresentation.spareCapacityLine(slackMinutes: 400, remaining: 0, locale: .ja).hasSuffix("足せます。"))
}

// MARK: - `lib/presentation/trip-presentation.ts` の残り

/// TS `formatDuration`(`lib/presentation/trip-presentation.ts:98-104`)。
@Test func formatDurationMatchesTheDeckForms() {
  #expect(TripPresentation.formatDuration(minutes: 0, locale: .ja) == "0分")
  #expect(TripPresentation.formatDuration(minutes: 0, locale: .en) == "0m")
  #expect(TripPresentation.formatDuration(minutes: 60, locale: .ja) == "1時間")
  #expect(TripPresentation.formatDuration(minutes: 60, locale: .en) == "1h")
  #expect(TripPresentation.formatDuration(minutes: 90, locale: .ja) == "1時間30分")
  #expect(TripPresentation.formatDuration(minutes: 90, locale: .en) == "1h 30m")
  // 負の値は 0 に、端数は四捨五入(TS `Math.max(0, Math.round(minutes))`)。
  #expect(TripPresentation.formatDuration(minutes: -30, locale: .ja) == "0分")
}

/// TS `weekdayInfo`(`:17-23`)—— 日付は UTC で読む。
@Test func weekdayInfoReadsTheDateInUtc() {
  #expect(TripPresentation.weekdayInfo("2026-08-15", locale: .ja)?.label == "土")
  #expect(TripPresentation.weekdayInfo("2026-08-15", locale: .en)?.label == "Sat")
  #expect(TripPresentation.weekdayInfo("2026-08-15", locale: .en)?.isWeekend == true)
  #expect(TripPresentation.weekdayInfo("2026-08-15", locale: .en)?.isSunday == false)
  #expect(TripPresentation.weekdayInfo("2026-08-16", locale: .en)?.isSunday == true)
  #expect(TripPresentation.weekdayInfo("2026-08-17", locale: .en)?.isWeekend == false)
  #expect(TripPresentation.weekdayInfo(nil, locale: .en) == nil)
  #expect(TripPresentation.weekdayInfo("not-a-date", locale: .en) == nil)
}

/// TS `formatDistanceMeters`(`:25-27`)/ `formatWindowClock`(`:164-167`)/
/// `shiftPlannerClock`(`:169-176`)。
@Test func distanceAndClockFormattingFollowTheTypeScript() {
  #expect(TripPresentation.formatDistanceMeters(0) == "10m")
  #expect(TripPresentation.formatDistanceMeters(324) == "320m")
  #expect(TripPresentation.formatDistanceMeters(949) == "950m")
  // JS の `toFixed(1)` と同じ —— 0.95 / 1.45 は二進でその値に届かないので切り上がらない。
  #expect(TripPresentation.formatDistanceMeters(950) == "0.9km")
  #expect(TripPresentation.formatDistanceMeters(1_450) == "1.4km")
  #expect(TripPresentation.formatDistanceMeters(2_500) == "2.5km")

  #expect(TripPresentation.formatWindowClock(minutes: 0) == "0:00")
  #expect(TripPresentation.formatWindowClock(minutes: 545) == "9:05")
  #expect(TripPresentation.formatWindowClock(minutes: 1_440) == "0:00")
  #expect(TripPresentation.formatWindowClock(minutes: -60) == "23:00")

  #expect(TripPresentation.shiftPlannerClock("09:00", minutes: 90) == "10:30")
  #expect(TripPresentation.shiftPlannerClock("9:00", minutes: -600) == "00:00")
  #expect(TripPresentation.shiftPlannerClock("23:00", minutes: 600) == "23:59")
  #expect(TripPresentation.shiftPlannerClock("not a clock", minutes: 10) == "not a clock")
}

/// TS `priceBand`(`:68-71`)—— Google の相対価格帯を現地通貨の記号で出す。
@Test func priceBandUsesTheLocalCurrencyGlyph() {
  let japan = Destinations.byId(.japan)
  #expect(TripPresentation.priceBand(.inexpensive, destination: japan) == "¥")
  #expect(TripPresentation.priceBand(.very_expensive, destination: japan) == "¥¥¥¥")
  #expect(TripPresentation.priceBand(nil, destination: japan) == nil)
  #expect(TripPresentation.priceBand(.moderate, destination: Destinations.byId(.switzerland)) == "₣₣")
}

/// TS `airportOptionsFor`(`:75-91`)/ `airportComparisonDestination`(`:93-96`)。
@Test func airportOptionsGroupEveryGatewayBeforeACountryIsKnown() {
  let swiss = TripPresentation.airportOptionsFor(locale: .en, destination: Destinations.byId(.switzerland))
  #expect(swiss.count == 2)
  #expect(swiss[0].options.map(\.value) == ["none"])
  #expect(swiss[0].options[0].label == "Not specified")
  #expect(swiss[1].options.contains { $0.value == "ZRH" })

  let worldwide = TripPresentation.airportOptionsFor(locale: .en, destination: Destinations.worldwide)
  #expect(worldwide.count > 2)
  #expect(worldwide[0].options.map(\.value) == ["none"])
  // 国名は選ばれたロケールで A→Z。
  let labels = worldwide.dropFirst().compactMap(\.label)
  #expect(labels == labels.sorted { jsLocaleCompare($0, $1) < 0 })

  #expect(TripPresentation.airportComparisonDestination(active: Destinations.worldwide, airportCode: "ZRH").id == .switzerland)
  #expect(TripPresentation.airportComparisonDestination(active: Destinations.worldwide, airportCode: "none").id == .worldwide)
  #expect(TripPresentation.airportComparisonDestination(active: Destinations.byId(.japan), airportCode: "ZRH").id == .japan)
}

/// TS `googleMapsSearchUrl`(`:178-180`)—— `encodeURIComponent` と同じ集合でエンコードする。
@Test func googleMapsSearchUrlEncodesLikeEncodeUriComponent() {
  let stop = TestStops.point(id: "sensoji", lat: 35.7148, lng: 139.7967, area: "Asakusa & Tokyo")
  let url = TripPresentation.googleMapsSearchUrl(stop)
  #expect(url == "https://www.google.com/maps/search/?api=1&query=sensoji%20Asakusa%20%26%20Tokyo")
}
