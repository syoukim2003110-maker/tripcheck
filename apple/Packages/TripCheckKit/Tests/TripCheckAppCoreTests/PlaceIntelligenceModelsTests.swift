import XCTest
@testable import TripCheckAppCore

final class PlaceIntelligenceModelsTests: XCTestCase {
  func testDecodesResultIgnoringExtraFields() throws {
    let json = #"""
    {"provider":"google_places","checkedAt":"t","analyzedBy":"rules",
     "place":{"name":"Kaffee","address":"1 Bahnhofstrasse","googleMapsUrl":"https://maps.google/x",
       "websiteUrl":"https://k.example","businessStatus":"OPERATIONAL","rating":4.6,"userRatingCount":1203,
       "openNow":true,"hours":["Mon 08-18","Tue 08-18"],"payment":{"cashOnly":false},"photoName":"places/x"},
     "reviews":[{"rating":5,"text":"Great coffee","authorName":"A","excerpt":"Great"}],
     "analysis":{"summary":"Popular cafe, open now.","confidence":"high","signals":[],"nextCheck":"t"},
     "links":{"x":"u","instagram":"u"}}
    """#
    let r = try JSONDecoder().decode(PlaceIntelligenceResult.self, from: Data(json.utf8))
    XCTAssertEqual(r.place.name, "Kaffee")
    XCTAssertEqual(r.place.rating, 4.6)
    XCTAssertEqual(r.place.userRatingCount, 1203)
    XCTAssertEqual(r.place.openNow, true)
    XCTAssertEqual(r.place.hours.count, 2)
    XCTAssertEqual(r.place.businessStatus, "OPERATIONAL")
    XCTAssertEqual(r.reviews.first?.text, "Great coffee")
    XCTAssertEqual(r.reviews.first?.rating, 5)
    XCTAssertEqual(r.analysis.summary, "Popular cafe, open now.")
    XCTAssertEqual(r.analysis.confidence, "high")
  }

  func testDecodesNullPlaceNumerics() throws {
    let json = #"{"place":{"name":"X","address":"","googleMapsUrl":"u","businessStatus":null,"rating":null,"userRatingCount":null,"openNow":null,"hours":[]},"reviews":[],"analysis":{"summary":"s","confidence":"low"}}"#
    let r = try JSONDecoder().decode(PlaceIntelligenceResult.self, from: Data(json.utf8))
    XCTAssertNil(r.place.rating); XCTAssertNil(r.place.openNow); XCTAssertNil(r.place.businessStatus)
    XCTAssertTrue(r.reviews.isEmpty)
  }

  func testEncodesRequestWithoutProviderRefOrScope() throws {
    let payload = PlaceIntelligenceRequestPayload(name: "Kaffee", area: "Bern", latitude: 46.9, longitude: 7.4,
      languageCode: "ja", destination: "auto")
    let obj = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any]
    XCTAssertEqual(obj?["name"] as? String, "Kaffee")
    XCTAssertEqual(obj?["area"] as? String, "Bern")
    XCTAssertEqual(obj?["languageCode"] as? String, "ja")
    XCTAssertEqual(obj?["destination"] as? String, "auto")
    XCTAssertNil(obj?["providerRef"])   // リッチ tier のため送らない
    XCTAssertNil(obj?["scope"])
  }
}
