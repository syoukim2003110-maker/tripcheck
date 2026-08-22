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
              c.timelineTab, c.mapTab, c.mapScopeAll, c.mapScopeDay] + c.diffLabels
              + [c.daysValue(1), c.daysValue(4), c.priorityLabel(name: "X"), c.removeStopQuestion(name: "X"), c.mustRemovalNote(name: "X"), c.reservationRemovalNote(name: "X"), c.removedStopToast(name: "X"), c.pasteLimitToast(count: 14)] {
      #expect(BannedTerms.violations(in: s).isEmpty, "\(locale): \(s)")
      #expect(!s.isEmpty, "\(locale): empty copy")
      checked += 1
    }
  }
  #expect(checked == 88)   // ja/en それぞれ 30 + diffLabels 6 + 引数を取る 8(daysValue は 2 通り)
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
