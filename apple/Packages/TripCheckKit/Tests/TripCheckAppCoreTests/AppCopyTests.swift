import Testing
@testable import TripCheckAppCore
import TripCheckKit

@Test func appCopyPassesBannedTermsInBothLanguages() {
  var checked = 0
  for locale in [PlannerLocale.ja, .en] {
    let c = AppCopy.for(locale)
    for s in [c.startTitle, c.startHelpShort, c.placeFieldPlaceholder, c.addPlaceLabel, c.suggestionsUnavailable,
              c.placeLimitToast, c.priorityNormal, c.pasteText, c.pastePlaceholder, c.pasteRead, c.pasteAdd,
              c.editEntryAction, c.entryDayLabel, c.entryDayAny, c.daysQuestion, c.daysUndecided, c.daysOther,
              c.daysOtherLabel, c.daysUndecidedNote, c.dateDisclosure, c.dateUndecided, c.destinationHint,
              c.customDisclosure, c.buildCTA, c.checkingPlacesCTA, c.buildingCTA,
              c.timelineTab, c.mapTab, c.mapScopeAll, c.mapScopeDay,
              c.resolveTitle, c.resolveEditInput, c.resolveEditName, c.resolveCountryHint, c.resolveWorldwide,
              c.resolveNoneOfThese, c.resolveDeferred, c.resolveNotFound, c.resolveSearchAgain, c.resolvePinOnMap,
              c.resolveStatusConfirmed, c.resolveStatusReview, c.resolveStatusUnresolved,
              c.manualAddressLabel, c.manualLatitude, c.manualLongitude, c.manualUsePoint, c.manualPinHint,
              c.manualPinMapLabel, c.bufferHeading, c.maxWalkingHeading, c.maxWalkingNote, c.maxWalkingDefault,
              c.maxTransfersHeading, c.maxTransfersNote, c.maxTransfersDefault, c.flightsDisclosure,
              c.airportCompareArrival, c.airportCompareDeparture, c.airportArrivalBoundary, c.airportDepartureBoundary,
              c.airportNextDay, c.airportPreviousDay, c.airportArrivalWinner, c.airportDepartureWinner,
              c.airportEstimate, c.airportUse, c.airportSelected, c.airportDisclaimer,
              c.mustUnresolvedTitle, c.mustUnresolvedContinue, c.mustUnresolvedBack] + c.diffLabels
              + [c.daysValue(1), c.daysValue(4), c.priorityLabel(name: "X"), c.removeStopQuestion(name: "X"), c.mustRemovalNote(name: "X"), c.reservationRemovalNote(name: "X"), c.removedStopToast(name: "X"), c.pasteLimitToast(count: 14)]
              + [c.resolveAllConfirmed(count: 1), c.resolveAllConfirmed(count: 4),
                 c.resolveCountryConflict(codes: ["CH", "JP"]), c.resolveCandidateQuestion(name: "X"),
                 c.resolveCandidatesLabel(name: "X"), c.resolveUnresolvedCount(count: 1), c.resolveUnresolvedCount(count: 2),
                 c.resolveAmbiguousCount(count: 1), c.resolveAmbiguousCount(count: 2),
                 c.resolveContinue(count: 1), c.resolveContinue(count: 4), c.minutesShort(10),
                 c.airportArrivalBreakdown(airportMinutes: 90, transferMinutes: 60),
                 c.airportDepartureBreakdown(airportMinutes: 120, transferMinutes: 60),
                 c.mustUnresolvedBody(names: ["X"]), c.mustUnresolvedBody(names: ["X", "Y"])] {
      #expect(BannedTerms.violations(in: s).isEmpty, "\(locale): \(s)")
      #expect(!s.isEmpty, "\(locale): empty copy")
      checked += 1
    }
  }
  // ja/en それぞれ 30 + Task 5 の 42 + diffLabels 6 + 引数を取る 8 + Task 5 の引数つき 16
  #expect(checked == 204)
}

/// 空港の内訳は 2 つの数を**別の場所**に出す —— 入れ替わると「空港内 60 分・市街地まで 90 分」が
/// 逆に読める。数の並びが言語ごとに違う(日本語は到着と出発で順が入れ替わる)ので、引数の
/// 名前だけでは守れない。
@Test func theAirportBreakdownKeepsItsTwoNumbersApart() {
  for locale in [PlannerLocale.ja, .en] {
    let c = AppCopy.for(locale)
    let arrival = c.airportArrivalBreakdown(airportMinutes: 90, transferMinutes: 45)
    let departure = c.airportDepartureBreakdown(airportMinutes: 120, transferMinutes: 45)
    #expect(arrival.contains("90") && arrival.contains("45"), "\(locale): \(arrival)")
    #expect(departure.contains("120") && departure.contains("45"), "\(locale): \(departure)")
  }
}

/// 混ざった国の報せは**どの国か**を名指しする。数だけでは、旅行者はどちらを選べばよいか
/// 決められない。
@Test func theMixedCountryWarningNamesTheCountries() {
  for locale in [PlannerLocale.ja, .en] {
    let text = AppCopy.for(locale).resolveCountryConflict(codes: ["CH", "JP"])
    #expect(text.contains("CH") && text.contains("JP"), "\(locale): \(text)")
    #expect(text.contains("2"), "\(locale): \(text)")
  }
}

/// 上限のトーストは件数を名指しする —— 「12 までです」だけでは、旅行者は自分が何件
/// 書いたのかを数え直すことになる(Web `PlacesStep.tsx:146` と同じ約束)。
@Test func thePasteLimitToastCarriesTheCount() {
  for locale in [PlannerLocale.ja, .en] {
    #expect(AppCopy.for(locale).pasteLimitToast(count: 17).contains("17"), "\(locale)")
  }
}

/// 画面下の主ボタンは 3 つの状態で別の文でなければならない —— 同じ文なら、押せない理由が
/// 「まだ場所が無い」のか「いま調べている」のか読めない。
@Test func theThreeCtaLabelsAreDistinctInBothLanguages() {
  for locale in [PlannerLocale.ja, .en] {
    let c = AppCopy.for(locale)
    #expect(Set([c.buildCTA, c.checkingPlacesCTA, c.buildingCTA]).count == 3, "\(locale)")
  }
}

/// 英語の日数は 1 日だけ単数。数字を並べるだけの表にすると "1 days" が出る。
@Test func englishDayCountsAreSingularForOne() {
  #expect(AppCopy.en.daysValue(1) == "1 day")
  #expect(AppCopy.en.daysValue(4) == "4 days")
  #expect(AppCopy.ja.daysValue(1) == "1日")
}
