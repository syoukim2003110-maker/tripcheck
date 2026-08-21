import Testing
@testable import TripCheckKit

// task-8-brief.md §Step 1 tests (verbatim).

@Test func stayEstimatesFollowNameThenTypeThenDefault() {
  #expect(StayEstimates.estimateStayMinutes(name: "東京ディズニーランド", placeTypes: nil) == 540)
  #expect(StayEstimates.estimateStayMinutes(name: "Some Museum", placeTypes: ["museum"]) == 120)
  #expect(StayEstimates.estimateStayMinutes(name: "Ramen Place", placeTypes: ["restaurant"]) == 45)
  #expect(StayEstimates.estimateStayMinutes(name: "Somewhere", placeTypes: ["tourist_attraction"]) == 75)
  #expect(StayEstimates.estimateStayMinutes(name: "Somewhere", placeTypes: nil) == 90)
  #expect(StayEstimates.isDayAnchorStay(300)); #expect(!StayEstimates.isDayAnchorStay(299))
}

// MARK: - Ported from tests/travel-logic.test.ts

@Test func stayEstimatesSizeAThemeParkAsADayNotACoffeeStop() {
  // tests/travel-logic.test.ts:102-110
  #expect(StayEstimates.estimateStayMinutes(name: "ユニバーサル・スタジオ・ジャパン", placeTypes: []) == 510)
  #expect(StayEstimates.estimateStayMinutes(name: "USJ", placeTypes: []) == 510)
  #expect(StayEstimates.estimateStayMinutes(name: "Nagoya Port Aquarium", placeTypes: ["aquarium"]) == 150)
  #expect(StayEstimates.estimateStayMinutes(name: "Some Museum", placeTypes: ["museum"]) == 120)
  #expect(StayEstimates.estimateStayMinutes(name: "Totally Unknown", placeTypes: []) == 90)
  #expect(StayEstimates.isDayAnchorStay(510))
  #expect(!StayEstimates.isDayAnchorStay(150))
}
