import XCTest
@testable import TripCheckAppCore

final class PlaceResolutionModelsTests: XCTestCase {
  func testDecodesAGooglePlaceResolutionResponse() throws {
    let json = #"""
    {"provider":"google_maps","fetchedAt":"2026-08-25T00:00:00Z",
     "places":[{"id":"g1","providerRef":"ChIJ_123","name":"Tokyo Tower","area":"Minato",
       "latitude":35.6586,"longitude":139.7454,"sourceUrl":"https://maps.google/x",
       "verifiedAt":"2026-08-25T00:00:00Z","confidence":"medium","planningDurationMinutes":60,
       "isAnchor":true,"placeTypes":["tourist_attraction"],"address":"4-2-8 Shibakoen",
       "countryCode":"JP","input":"Tokyo Tower","inputIndex":0}],
     "hotel":null,"ambiguous":[]}
    """#
    let result = try JSONDecoder().decode(PlaceResolutionResult.self, from: Data(json.utf8))
    XCTAssertEqual(result.places.count, 1)
    XCTAssertEqual(result.places[0].providerRef, "ChIJ_123")
    XCTAssertEqual(result.places[0].confidence, "medium")
    XCTAssertNil(result.hotel)
  }
}
