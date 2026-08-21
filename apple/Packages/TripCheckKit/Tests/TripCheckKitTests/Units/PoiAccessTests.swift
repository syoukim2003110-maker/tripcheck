import Testing
@testable import TripCheckKit

// task-8-brief.md §Step 1 test (verbatim).

@Test func mountainRailwayOnlyAllowsTransit() {
  let jungfrau = RouteStop(id: "jungfraujoch", providerRef: nil, name: "Jungfraujoch", area: "Bern", latitude: 46.5475, longitude: 7.9853, sourceUrl: "", verifiedAt: "", confidence: .medium, planningDurationMinutes: 240, isAnchor: true, placeTypes: nil, openingHoursApplicable: nil, isUserEntered: nil, userProvidedCoordinates: nil)
  let interlaken = RouteStop(id: "i", providerRef: nil, name: "Interlaken", area: "Bern", latitude: 46.6863, longitude: 7.8632, sourceUrl: "", verifiedAt: "", confidence: .medium, planningDurationMinutes: 60, isAnchor: true, placeTypes: nil, openingHoursApplicable: nil, isUserEntered: nil, userProvidedCoordinates: nil)
  #expect(PoiAccess.allowedModes(from: interlaken, to: jungfrau) == [.transit])
  let ep = PoiAccess.routeEndpoints(from: interlaken, to: jungfrau)
  #expect(ep.scope == .access_node)   // Eigergletscher 駅に差し替え
}

// MARK: - Ported from tests/poi-access.test.ts

private func poiStop(_ name: String) -> RouteStop {
  TestStops.point(id: name, lat: 0, lng: 0)
}

@Test func mountainRailDestinationsNeverExposeDirectWalkingOrTaxiModes() {
  // tests/poi-access.test.ts:15-19
  #expect(PoiAccess.allowedModes(from: poiStop("Zermatt"), to: poiStop("Gornergrat")) == [.transit])
  #expect(PoiAccess.allowedModes(from: poiStop("Interlaken"), to: poiStop("ユングフラウヨッホ")) == [.transit])
  #expect(PoiAccess.allowedModes(from: poiStop("Gornergrat"), to: poiStop("Zermatt")) == [.transit])
}

@Test func ordinaryPlacesKeepEverySupportedMode() {
  // tests/poi-access.test.ts:21-23 — TS asserts an explicit `["walk","transit","taxi"]`; the Swift
  // `allowedModes` returns `nil` for "no policy restricts this leg" instead (see PoiAccess.swift's
  // doc comment on `allowedModes`), which is the unrestricted no-op `TravelEstimates.estimate` expects.
  #expect(PoiAccess.allowedModes(from: poiStop("Kapellbrücke"), to: poiStop("Lion Monument")) == nil)
}

@Test func accessPoliciesKeepAnOfficialSourceAndRuntimeAccessNodeQuery() throws {
  // tests/poi-access.test.ts:25-34
  let policy = try #require(PoiAccess.policy(for: poiStop("Jungfraujoch – Top of Europe")))
  #expect(policy.id == .jungfraujoch)
  #expect(policy.accessNode.providerQuery.contains("Eigergletscher"))
  #expect(policy.accessNode.id == "didok-8507361")
  #expect(policy.accessNode.coordinate == GeoPoint(latitude: 46.5748, longitude: 7.974861))
  #expect(policy.accessNode.coordinateSourceUrl?.contains("data.sbb.ch") == true)
  #expect(policy.sourceUrl.hasPrefix("https://www.jungfrau.ch/"))
  #expect(policy.confidence == .high)
}

@Test func aMountainLegResolvesADistinctAccessEndpointWithoutReplacingTheSummit() {
  // tests/poi-access.test.ts:36-53
  let from = TestStops.point(id: "zermatt", lat: 46.0207, lng: 7.7491)
  var summit = TestStops.point(id: "gornergrat", lat: 45.9834, lng: 7.7847)
  summit.name = "Gornergrat"
  let resolution = PoiAccess.routeEndpoints(from: from, to: summit)

  #expect(resolution.scope == .access_node)
  #expect(resolution.from?.id == "zermatt")
  #expect(resolution.to?.id == "access-node:gornergrat:didok-8501690")
  #expect(resolution.to?.coordinate == GeoPoint(latitude: 46.023889, longitude: 7.748889))
  #expect(resolution.assumptions.first?.mountainStopId == summit.id)
  #expect(resolution.assumptions.first?.endpointRole == .destination)
  // The itinerary POI remains the summit — the leg's own `to` (not the redirected access node)
  // still carries the summit's original name and coordinates.
  #expect(summit.name == "Gornergrat")
  #expect(summit.latitude == 45.9834)
  #expect(summit.longitude == 7.7847)
}

@Test func missingAccessNodeCoordinatesFailConditionalInsteadOfReusingSummitCoordinates() throws {
  // tests/poi-access.test.ts:55-76
  let source = try #require(PoiAccess.policy(for: poiStop("Gornergrat")))
  let missingCoordinatePolicy = PoiAccessPolicy(
    id: source.id,
    labels: source.labels,
    accessNode: PoiAccessNode(id: "future-node", name: "Future verified station", providerQuery: "Future verified station"),
    allowedModes: source.allowedModes,
    note: source.note,
    sourceUrl: source.sourceUrl,
    verifiedAt: source.verifiedAt,
    confidence: source.confidence
  )
  let resolution = PoiAccess.routeEndpoints(
    from: TestStops.point(id: "zermatt", lat: 46.0207, lng: 7.7491, stayMinutes: 60).withName("Zermatt"),
    to: TestStops.point(id: "gornergrat", lat: 45.9834, lng: 7.7847, stayMinutes: 60).withName("Gornergrat"),
    policies: [missingCoordinatePolicy]
  )

  #expect(resolution.scope == .conditional)
  #expect(resolution.from == nil)
  #expect(resolution.to == nil)
  #expect(resolution.assumptions.first?.coordinate == nil)
}

private extension RouteStop {
  func withName(_ name: String) -> RouteStop {
    var copy = self
    copy.name = name
    return copy
  }
}
