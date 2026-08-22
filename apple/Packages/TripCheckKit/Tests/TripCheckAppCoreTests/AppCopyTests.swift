import Testing
@testable import TripCheckAppCore
import TripCheckKit

@Test func appCopyPassesBannedTermsInBothLanguages() {
  var checked = 0
  for locale in [PlannerLocale.ja, .en] {
    let c = AppCopy.for(locale)
    for s in [c.startTitle, c.startHelpShort, c.placeFieldPlaceholder, c.addPlaceLabel, c.suggestionsUnavailable,
              c.placeLimitToast, c.priorityNormal, c.pasteText, c.daysQuestion, c.daysUndecided, c.daysOther,
              c.daysOtherLabel, c.daysUndecidedNote, c.dateDisclosure, c.dateUndecided, c.destinationHint,
              c.customDisclosure, c.buildCTA, c.checkingPlacesCTA, c.buildingCTA,
              c.timelineTab, c.mapTab, c.mapScopeAll, c.mapScopeDay] + c.diffLabels
              + [c.daysValue(1), c.daysValue(4), c.priorityLabel(name: "X"), c.removeStopQuestion(name: "X"), c.mustRemovalNote(name: "X"), c.reservationRemovalNote(name: "X"), c.removedStopToast(name: "X")] {
      #expect(BannedTerms.violations(in: s).isEmpty, "\(locale): \(s)")
      #expect(!s.isEmpty, "\(locale): empty copy")
      checked += 1
    }
  }
  #expect(checked == 74)   // ja/en それぞれ 24 + diffLabels 6 + 引数を取る 7(daysValue は 2 通り)
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
