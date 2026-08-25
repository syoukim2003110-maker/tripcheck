import XCTest
@testable import TripCheckAppCore
import TripCheckKit

final class RouteDetourModelsTests: XCTestCase {
  func testDecodesCandidatesIgnoringRichFields() throws {
    let json = #"""
    {"provider":"google_maps","fetchedAt":"t","candidates":[
      {"id":"g1","providerRef":"ChIJ","name":"Cafe Alpen","address":"1 Marktgasse","type":"cafe","googleMapsUrl":"https://maps.google/g",
       "latitude":46.9,"longitude":7.4,"rating":4.5,"userRatingCount":210,"routeDistanceMeters":180,"photoName":"places/x"}
    ]}
    """#
    let r = try JSONDecoder().decode(RouteRecommendationResult.self, from: Data(json.utf8))
    XCTAssertEqual(r.candidates.count, 1)
    let c = try XCTUnwrap(r.candidates.first)
    XCTAssertEqual(c.id, "g1"); XCTAssertEqual(c.name, "Cafe Alpen"); XCTAssertEqual(c.type, "cafe")
    XCTAssertEqual(c.rating, 4.5); XCTAssertEqual(c.userRatingCount, 210); XCTAssertEqual(c.routeDistanceMeters, 180)
  }
  func testDecodesNullNumerics() throws {
    let json = #"{"candidates":[{"id":"g2","name":"X","address":"","type":"park","googleMapsUrl":"u","rating":null,"userRatingCount":null,"routeDistanceMeters":0}]}"#
    let r = try JSONDecoder().decode(RouteRecommendationResult.self, from: Data(json.utf8))
    XCTAssertNil(r.candidates.first?.rating)
  }
  func testEncodesPayload() throws {
    let payload = RouteRecommendationRequestPayload(
      routePoints: [GeoPoint(latitude: 46.9, longitude: 7.4)], excludedPlaceIds: ["a"], excludedNames: ["N"],
      languageCode: "ja", destination: "auto", suggestionKinds: ["CAFE", "WALK"])
    let obj = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any]
    XCTAssertEqual((obj?["routePoints"] as? [[String: Any]])?.count, 1)
    XCTAssertEqual(obj?["excludedPlaceIds"] as? [String], ["a"])
    XCTAssertEqual(obj?["suggestionKinds"] as? [String], ["CAFE", "WALK"])
    XCTAssertEqual(obj?["languageCode"] as? String, "ja")
  }
}
