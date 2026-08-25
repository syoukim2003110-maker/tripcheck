import XCTest
@testable import TripCheckAppCore
import TripCheckKit

final class HotelRecommendationModelsTests: XCTestCase {
  func testDecodesCandidatesIgnoringRichFields() throws {
    let json = #"""
    {"provider":"google_maps","fetchedAt":"t","evidenceProviders":{"rakuten":false},"candidates":[
      {"id":"h1","name":"Hotel Bern","address":"1 Bahnhofplatz","googleMapsUrl":"https://maps.google/h","websiteUrl":"https://hb.example",
       "latitude":46.9,"longitude":7.4,"rating":4.3,"userRatingCount":540,"distanceMeters":320,"routeBurdenMeters":800,"score":0.9,
       "priceLevel":"moderate","styles":["value"],"photo":null,"reviews":null,"payment":null,"rakuten":null}
    ]}
    """#
    let r = try JSONDecoder().decode(HotelRecommendationResult.self, from: Data(json.utf8))
    XCTAssertEqual(r.candidates.count, 1)
    let h = try XCTUnwrap(r.candidates.first)
    XCTAssertEqual(h.id, "h1"); XCTAssertEqual(h.name, "Hotel Bern")
    XCTAssertEqual(h.rating, 4.3); XCTAssertEqual(h.userRatingCount, 540)
    XCTAssertEqual(h.distanceMeters, 320); XCTAssertEqual(h.routeBurdenMeters, 800)
    XCTAssertEqual(h.websiteUrl, "https://hb.example")
  }
  func testDecodesNullNumerics() throws {
    let json = #"{"candidates":[{"id":"h2","name":"X","address":"","googleMapsUrl":"u","websiteUrl":null,"rating":null,"userRatingCount":null,"distanceMeters":0,"routeBurdenMeters":0}]}"#
    let r = try JSONDecoder().decode(HotelRecommendationResult.self, from: Data(json.utf8))
    XCTAssertNil(r.candidates.first?.rating); XCTAssertNil(r.candidates.first?.websiteUrl)
  }
  func testEncodesPayloadWithRoutePointsAndNoQuery() throws {
    let payload = HotelRecommendationRequestPayload(latitude: 46.9, longitude: 7.4, area: "Bern",
      routePoints: [GeoPoint(latitude: 46.9, longitude: 7.4), GeoPoint(latitude: 47.0, longitude: 7.5)],
      languageCode: "ja", destination: "auto")
    let obj = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any]
    XCTAssertEqual(obj?["area"] as? String, "Bern")
    XCTAssertNil(obj?["query"])                                  // 送らない
    let rp = obj?["routePoints"] as? [[String: Any]]
    XCTAssertEqual(rp?.count, 2)
    XCTAssertEqual(rp?.first?["latitude"] as? Double, 46.9)
  }
}
