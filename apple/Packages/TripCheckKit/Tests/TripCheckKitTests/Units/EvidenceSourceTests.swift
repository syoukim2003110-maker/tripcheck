import Testing
@testable import TripCheckKit

/// live の公共交通レグに `RouteFactEvidence` が無いとき、出典は既定で `google`(TS と同じ)、
/// `liveRouteSource: .apple` を渡したときだけ `apple`。状態はどちらも `estimated` 止まり。
@Test func liveTransitWithoutConvergenceIsGoogleByDefaultAndAppleOnRequest() {
  let raw = "Senso-ji\nteamLab Planets"
  let leg = TripBuilder.build(TestStops.tokyoRequest(raw, days: 1)).days[0].legs[0]
  var context = PlannerContext()
  context.liveTransitMinutes = [routeLegKey(leg.from.id, leg.to.id): 17]
  let plan = TripBuilder.build(TestStops.tokyoRequest(raw, days: 1, context: context))
  let factId = "route:\(plan.days[0].label):\(leg.from.id):\(leg.to.id)"
  #expect(plan.days[0].legs[0].comparison.recommended.source == .live)

  let byDefault = Feasibility.snapshot(plan: plan, options: .init(dateWasProvided: true, baseWasProvided: false, dayEndWasProvided: false))
  let fromApple = Feasibility.snapshot(plan: plan, options: .init(dateWasProvided: true, baseWasProvided: false, dayEndWasProvided: false, liveRouteSource: .apple))
  #expect(byDefault.facts.first { $0.id == factId }?.evidence.source == .google)
  #expect(fromApple.facts.first { $0.id == factId }?.evidence.source == .apple)
  #expect(fromApple.facts.first { $0.id == factId }?.evidence.status == .estimated)
  #expect(byDefault.facts.count == fromApple.facts.count)
}

/// `apple` は Swift 限定の加法(spec §9-25)。raw 値と既存 5 件の順が不変。
@Test func evidenceSourceGainsAppleAdditively() {
  #expect(EvidenceSource.apple.rawValue == "apple")
  #expect(EvidenceSource.allCases == [.user, .google, .tripcheck_catalog, .derived, .other, .apple])
}
