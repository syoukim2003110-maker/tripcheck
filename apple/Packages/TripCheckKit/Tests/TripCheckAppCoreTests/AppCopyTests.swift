import Testing
@testable import TripCheckAppCore
import TripCheckKit

@Test func appCopyPassesBannedTermsInBothLanguages() {
  var checked = 0
  for locale in [PlannerLocale.ja, .en] {
    let c = AppCopy.for(locale)
    for s in [c.startTitle, c.startHelpShort, c.pasteText, c.dateDisclosure, c.customDisclosure, c.timelineTab, c.mapTab, c.mapScopeAll, c.mapScopeDay] + c.diffLabels + [c.removeStopQuestion(name: "X"), c.mustRemovalNote(name: "X"), c.reservationRemovalNote(name: "X"), c.removedStopToast(name: "X")] {
      #expect(BannedTerms.violations(in: s).isEmpty, "\(locale): \(s)")
      #expect(!s.isEmpty, "\(locale): empty copy")
      checked += 1
    }
  }
  #expect(checked == 38)   // ja/en それぞれ 9 + diffLabels 6 + 名前を取る 4
}
