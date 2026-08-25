import XCTest
@testable import TripCheckAppCore

final class PlaceSuggestionModelsTests: XCTestCase {
  func testDecodesWebResponseAndIgnoresExtraFields() throws {
    let json = #"""
    {"provider":"google_maps","extra":"ignored","suggestions":[
      {"providerRef":"pid-1","primaryText":"Tokyo Tower","secondaryText":"Minato, Tokyo","fullText":"Tokyo Tower, Minato, Tokyo","note":"unused"}
    ]}
    """#
    let result = try JSONDecoder().decode(PlaceSuggestionResult.self, from: Data(json.utf8))
    XCTAssertEqual(result.provider, "google_maps")
    XCTAssertEqual(result.suggestions.count, 1)
    let s = try XCTUnwrap(result.suggestions.first)
    XCTAssertEqual(s.providerRef, "pid-1")
    XCTAssertEqual(s.id, "pid-1")
    XCTAssertEqual(s.primaryText, "Tokyo Tower")
    XCTAssertEqual(s.secondaryText, "Minato, Tokyo")
    XCTAssertEqual(s.fullText, "Tokyo Tower, Minato, Tokyo")
  }

  func testEncodesRequestPayload() throws {
    let payload = PlaceSuggestionRequestPayload(query: "tok", languageCode: "ja", destination: "auto")
    let data = try JSONEncoder().encode(payload)
    let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    XCTAssertEqual(obj?["query"] as? String, "tok")
    XCTAssertEqual(obj?["languageCode"] as? String, "ja")
    XCTAssertEqual(obj?["destination"] as? String, "auto")
  }
}
