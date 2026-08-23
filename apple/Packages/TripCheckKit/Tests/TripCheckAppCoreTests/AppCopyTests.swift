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
              c.timelineTab, c.mapTab, c.mapScopeAll, c.mapScopeDay, c.mapScopeLabel,
              c.mapPinHotel, c.mapPinManual, c.mapPinWarning,
              c.resolveTitle, c.resolveEditInput, c.resolveEditName, c.resolveCountryHint, c.resolveWorldwide,
              c.resolveNoneOfThese, c.resolveDeferred, c.resolveNotFound, c.resolveSearchAgain, c.resolvePinOnMap,
              c.resolveStatusConfirmed, c.resolveStatusReview, c.resolveStatusUnresolved,
              c.manualAddressLabel, c.manualLatitude, c.manualLongitude, c.manualUsePoint, c.manualPinHint,
              c.manualPinMapLabel, c.bufferHeading, c.maxWalkingHeading, c.maxWalkingNote, c.maxWalkingDefault,
              c.maxTransfersHeading, c.maxTransfersNote, c.maxTransfersDefault, c.flightsDisclosure,
              c.airportCompareArrival, c.airportCompareDeparture, c.airportArrivalBoundary, c.airportDepartureBoundary,
              c.airportNextDay, c.airportPreviousDay, c.airportArrivalWinner, c.airportDepartureWinner,
              c.airportEstimate, c.airportUse, c.airportSelected, c.airportDisclaimer,
              c.mustUnresolvedTitle, c.mustUnresolvedContinue, c.mustUnresolvedBack,
              c.chooseCountryAction, c.chooseCandidateAction, c.retryBuildAction, c.viewSwitchLabel,
              c.planErrorMessage,
              c.editedToast, c.revertedToast, c.baseClearedToast, c.clearBaseQuestion, c.openAppleMaps,
              c.stopConditionsDisclosure, c.lastEntryLabel, c.daySettingsTitle,
              c.customTimeLabel, c.hardEditConfirm, c.hardEditCancel, c.undoAction, c.redoAction,
              c.moreActions, c.undoneAnnouncement, c.redoneAnnouncement, c.evidenceNoValue,
              c.evidencePlaceLabel, c.evidenceHoursLabel, c.evidenceHoursOpen, c.evidenceStatusUnknown,
              c.verdictDetailsTitle, c.factVerified, c.factEstimated, c.factUnknown, c.coverageHeading,
              c.comparisonHeading, c.comparisonOriginal, c.comparisonOriginalDetail, c.comparisonMinimalRepair,
              c.comparisonMinimalImprovement, c.comparisonShortest, c.comparisonNoRepair,
              c.comparisonNoRepairNeeded, c.comparisonNoShortest, c.alternativesHeading,
              c.diffBefore, c.diffAfter, c.applyAlternative, c.assumptionsNone, c.attentionsHeading,
              c.passportUnsetShort,
              c.backToPlan, c.recentTripsTitle, c.openTripAction, c.deleteTripAction,
              c.storageUnavailableNote,
              c.shareAction, c.shareSheetTitle, c.shareSheetSubtitle, c.shareIncludeHeading,
              c.shareScopeDates, c.shareScopeHotel, c.shareScopeAirports, c.shareScopeReservations,
              c.shareReservationsIncluded, c.shareTooLong, c.shareNoPlaces, c.shareCopyLink,
              c.shareAppLink, c.shareImportFailed] + c.diffLabels
              + [c.daysValue(1), c.daysValue(4), c.priorityLabel(name: "X"), c.removeStopQuestion(name: "X"), c.mustRemovalNote(name: "X"), c.reservationRemovalNote(name: "X"), c.removedStopToast(name: "X"), c.pasteLimitToast(count: 14)]
              + [c.resolveAllConfirmed(count: 1), c.resolveAllConfirmed(count: 4),
                 c.resolveCountryConflict(codes: ["CH", "JP"]), c.resolveCandidateQuestion(name: "X"),
                 c.resolveCandidatesLabel(name: "X"), c.resolveUnresolvedCount(count: 1), c.resolveUnresolvedCount(count: 2),
                 c.resolveAmbiguousCount(count: 1), c.resolveAmbiguousCount(count: 2),
                 c.resolveContinue(count: 1), c.resolveContinue(count: 4), c.minutesShort(10),
                 c.airportArrivalBreakdown(airportMinutes: 90, transferMinutes: 60),
                 c.airportDepartureBreakdown(airportMinutes: 120, transferMinutes: 60),
                 c.mustUnresolvedBody(names: ["X"]), c.mustUnresolvedBody(names: ["X", "Y"])]
              + [c.planUnresolvedWarning(names: ["X"]), c.planUnresolvedWarning(names: ["X", "Y", "Z"]),
                 c.planAmbiguousWarning(names: ["X"]), c.planAmbiguousWarning(names: ["X", "Y", "Z"]),
                 c.planDeferredAnchors(names: ["X"]), c.planDeferredAnchors(names: ["X", "Y", "Z"]),
                 c.dayTimeBarLabel(visit: "1", travel: "2", slack: "3", available: "4", reservations: 0, conflicts: 0),
                 c.dayTimeBarLabel(visit: "1", travel: "2", slack: "3", available: "4", reservations: 1, conflicts: 2)]
              + [c.hotelLegDepart("徒歩 5分"), c.hotelLegReturn("徒歩 5分")]
              + [c.mapPinLabel(name: "ツェルマット", kind: c.mapPinWarning)]
              + [c.restoredStopToast(name: "X"), c.movedToDayToast(day: 2), c.tripDaysToast(days: 1),
                 c.tripDaysToast(days: 4), c.baseSetToast(name: "X"), c.moveStopQuestion(name: "X", day: 2),
                 c.moveStopAutoQuestion(name: "X"), c.shortenTripQuestion(days: 1),
                 c.shortenTripQuestion(days: 3), c.extendTripQuestion(days: 1),
                 c.extendTripQuestion(days: 6), c.changeBaseQuestion(name: "X")]
              + [c.issuesHeading(count: 1), c.issuesHeading(count: 3),
                 c.assumptionsHeading(count: 1), c.assumptionsHeading(count: 3)]
              + [c.deleteTripQuestion(title: "X")]
              + [c.shareRedactedReservations(count: 1), c.shareRedactedReservations(count: 2),
                 c.shareOmittedLines(count: 1), c.shareOmittedLines(count: 3)] {
      #expect(BannedTerms.violations(in: s).isEmpty, "\(locale): \(s)")
      #expect(!s.isEmpty, "\(locale): empty copy")
      checked += 1
    }
  }
  // ja/en それぞれ 30 + Task 5 の 42 + Task 6 の 5 + Task 8 の 4 + Task 9 の 21 + diffLabels 6
  // + Task 10 の 21 + 引数を取る 8 + Task 5 の引数つき 16 + Task 6 の引数つき 8
  // + Task 7 の引数つき 2 + Task 8 の引数つき 1 + Task 9 の引数つき 12
  // + Task 10 の引数つき 4(件数の 2 つは 1 と複数の両方を見る)+ Task 11 の 5 と引数つき 1
  // + Task 12 の 14 と引数つき 4(件数の 2 つは 1 と複数の両方を見る)
  #expect(checked == 408)
}

/// 英語の日数は 1 日だけ単数。旅の長さを名乗る 2 文にも同じ規則が要る("1 days" を出さない)。
@Test func englishTripLengthCopyIsSingularForOneDay() {
  #expect(AppCopy.en.tripDaysToast(days: 1).contains("1 day"))
  #expect(!AppCopy.en.tripDaysToast(days: 1).contains("1 days"))
  #expect(AppCopy.en.tripDaysToast(days: 4).contains("4 days"))
  #expect(!AppCopy.en.shortenTripQuestion(days: 1).contains("1 days"))
  #expect(AppCopy.en.extendTripQuestion(days: 6).contains("6 days"))
  #expect(!AppCopy.en.extendTripQuestion(days: 1).contains("1 days"))
}

/// 件数を名乗る英語の見出しも 1 件だけ単数。「1 things to check」は、数えた側が数えて
/// いないことを白状する文になる。
@Test func englishCountHeadingsAreSingularForOne() {
  #expect(AppCopy.en.issuesHeading(count: 1).contains("1 thing to check"))
  #expect(AppCopy.en.issuesHeading(count: 3).contains("3 things to check"))
  #expect(AppCopy.en.assumptionsHeading(count: 1).contains("1 assumption behind"))
  #expect(AppCopy.en.assumptionsHeading(count: 4).contains("4 assumptions behind"))
  #expect(AppCopy.ja.issuesHeading(count: 2).contains("2"))
  #expect(AppCopy.ja.assumptionsHeading(count: 2).contains("2件"))
}

/// 共有の画面で数える 2 つの英文も 1 件だけ単数。「1 booking times are removed」は、
/// 数えた側が数えていないことを白状する文になる。
@Test func englishShareCountsAreSingularForOne() {
  #expect(AppCopy.en.shareRedactedReservations(count: 1).contains("1 booking time is"))
  #expect(AppCopy.en.shareRedactedReservations(count: 2).contains("2 booking times are"))
  #expect(AppCopy.en.shareOmittedLines(count: 1).contains("1 opaque line is"))
  #expect(AppCopy.en.shareOmittedLines(count: 3).contains("3 opaque lines are"))
  #expect(AppCopy.ja.shareRedactedReservations(count: 2).contains("2件"))
  #expect(AppCopy.ja.shareOmittedLines(count: 3).contains("3行"))
}

/// 差分表の 2 列と、比較の 3 枚の題は、**どれも別の言葉**でなければならない —— 同じ語が
/// 2 か所に立つ表は、どちらの列を読んでいるのか分からなくなる。
@Test func theComparisonLabelsAreAllDistinct() {
  for locale in [PlannerLocale.ja, .en] {
    let c = AppCopy.for(locale)
    #expect(c.diffBefore != c.diffAfter, "\(locale)")
    #expect(Set([c.comparisonOriginal, c.comparisonMinimalRepair, c.comparisonMinimalImprovement, c.comparisonShortest]).count == 4, "\(locale)")
    #expect(Set(c.diffLabels).count == 6, "\(locale)")
  }
}

/// 編集の確認と取り消しは**別の言葉**でなければならない。同じ語が 2 つ並ぶダイアログは、
/// どちらを押すと変わるのか読めない。
@Test func theHardEditAnswersAreTwoDistinctWords() {
  for locale in [PlannerLocale.ja, .en] {
    let c = AppCopy.for(locale)
    #expect(c.hardEditConfirm != c.hardEditCancel, "\(locale)")
    #expect(c.undoAction != c.redoAction, "\(locale)")
    #expect(c.editedToast != c.revertedToast, "\(locale)")
  }
}

/// 帯の読み上げは 4 つの分数を**別々の節**に置く —— 入れ替わると「訪問30分・移動6時間」が
/// 逆に読める。数の並びは言語ごとに違う(英語は数のあとに動詞が付く)ので、引数の名前だけ
/// では守れない。
@Test func theDayTimeBarLabelKeepsItsFourDurationsApart() {
  for locale in [PlannerLocale.ja, .en] {
    let text = AppCopy.for(locale).dayTimeBarLabel(
      visit: "6時間", travel: "2時間", slack: "45分", available: "9時間",
      reservations: 1, conflicts: 2
    )
    let parts = ["6時間", "2時間", "45分", "9時間"]
    var cursor = text.startIndex
    for part in parts {
      let found = text.range(of: part, range: cursor..<text.endIndex)
      #expect(found != nil, "\(locale): \(part) missing or out of order in \(text)")
      cursor = found?.upperBound ?? cursor
    }
    #expect(text.contains("1") && text.contains("2"), "\(locale): \(text)")
  }
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
