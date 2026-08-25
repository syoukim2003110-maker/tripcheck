import XCTest
@testable import TripCheckAppCore

final class FoodRecommendationModelsTests: XCTestCase {
  func testDecodesCandidatesIgnoringRichFields() throws {
    let json = #"""
    {"provider":"google_maps","ranking":"evidence_weighted","fetchedAt":"t","candidates":[
      {"id":"c1","name":"Trattoria","address":"1 Via Roma","type":"italian_restaurant","googleMapsUrl":"https://maps.google/x",
       "latitude":1.0,"longitude":2.0,"distanceMeters":240,"rating":4.4,"userRatingCount":812,"openNow":true,
       "hours":["Mon 11-22"],"businessStatus":"OPERATIONAL","paymentEvidence":[],"reviewSnippets":[],
       "websiteUrl":"https://t.example","photoName":"places/x/photos/y","photoSignature":"sig"}
    ]}
    """#
    let result = try JSONDecoder().decode(FoodRecommendationResult.self, from: Data(json.utf8))
    XCTAssertEqual(result.candidates.count, 1)
    let c = try XCTUnwrap(result.candidates.first)
    XCTAssertEqual(c.id, "c1")
    XCTAssertEqual(c.name, "Trattoria")
    XCTAssertEqual(c.type, "italian_restaurant")
    XCTAssertEqual(c.distanceMeters, 240)
    XCTAssertEqual(c.rating, 4.4)
    XCTAssertEqual(c.userRatingCount, 812)
    XCTAssertEqual(c.openNow, true)
    XCTAssertEqual(c.websiteUrl, "https://t.example")
  }

  func testDecodesNullNumericFields() throws {
    let json = #"{"candidates":[{"id":"c2","name":"X","address":"","type":"cafe","googleMapsUrl":"u","distanceMeters":null,"rating":null,"userRatingCount":null,"openNow":null,"websiteUrl":null}]}"#
    let result = try JSONDecoder().decode(FoodRecommendationResult.self, from: Data(json.utf8))
    let c = try XCTUnwrap(result.candidates.first)
    XCTAssertNil(c.distanceMeters); XCTAssertNil(c.rating); XCTAssertNil(c.openNow); XCTAssertNil(c.websiteUrl)
  }

  func testEncodesPayloadWithNullQueryAndNoVisitPair() throws {
    let payload = FoodRecommendationRequestPayload(latitude: 1.5, longitude: 2.5, area: "Bern", mealKind: "lunch",
      query: nil, languageCode: "ja", destination: "auto", routePolyline: nil)
    let obj = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any]
    XCTAssertEqual(obj?["mealKind"] as? String, "lunch")
    XCTAssertEqual(obj?["area"] as? String, "Bern")
    XCTAssertTrue(obj?["query"] is NSNull)              // nil → JSON null(server は queryMissing で既定語)
    XCTAssertTrue(obj?["routePolyline"] is NSNull)
    XCTAssertNil(obj?["visitDate"]); XCTAssertNil(obj?["visitTime"])   // フィールド自体が無い
  }
}
