import XCTest
@testable import TripCheckAppCore

final class FreshVoicesModelsTests: XCTestCase {
  func testDecodesResultIgnoringDroppedFields() throws {
    let json = #"""
    {"provider":"anthropic_web_search","checkedAt":"2026-08-26T00:00:00Z","intent":"place","depth":"quick",
     "summary":"Buzzing after a recent festival.","searchCount":3,
     "findings":[
       {"title":"Night market reopens","url":"https://news.example/x","note":"Crowds returned this week.",
        "age":"3 days ago","isRecent":true,"sourceKind":"news","evidenceLevel":"cited_claim","urlSignature":"sig123"}
     ]}
    """#
    let r = try JSONDecoder().decode(FreshVoicesResult.self, from: Data(json.utf8))
    XCTAssertEqual(r.provider, "anthropic_web_search")
    XCTAssertEqual(r.intent, "place")
    XCTAssertEqual(r.depth, "quick")
    XCTAssertEqual(r.summary, "Buzzing after a recent festival.")
    XCTAssertEqual(r.findings.count, 1)
    let f = try XCTUnwrap(r.findings.first)
    XCTAssertEqual(f.title, "Night market reopens")
    XCTAssertEqual(f.url, "https://news.example/x")
    XCTAssertEqual(f.note, "Crowds returned this week.")
    XCTAssertEqual(f.age, "3 days ago")
    XCTAssertEqual(f.isRecent, true)
    XCTAssertEqual(f.sourceKind, "news")
  }

  func testDecodesNullAgeAndRecencyAndMissingOptionals() throws {
    let json = #"""
    {"provider":"anthropic_web_search","checkedAt":"t","intent":"place","depth":"quick","summary":"",
     "findings":[
       {"title":"A blog post","url":"https://blog.example/y","note":"","age":null,"isRecent":null,"sourceKind":"blog"}
     ]}
    """#
    let r = try JSONDecoder().decode(FreshVoicesResult.self, from: Data(json.utf8))
    XCTAssertTrue(r.summary.isEmpty)
    let f = try XCTUnwrap(r.findings.first)
    XCTAssertNil(f.age)
    XCTAssertNil(f.isRecent)
    XCTAssertEqual(f.sourceKind, "blog")
  }

  func testDecodesEmptyFindings() throws {
    let json = #"{"provider":"anthropic_web_search","checkedAt":"t","intent":"place","depth":"quick","summary":"","findings":[]}"#
    let r = try JSONDecoder().decode(FreshVoicesResult.self, from: Data(json.utf8))
    XCTAssertTrue(r.findings.isEmpty)
  }

  func testEncodesPayload() throws {
    let payload = FreshVoicesRequestPayload(name: "Kaffee", area: "1 Bahnhofstrasse, Bern", languageCode: "ja",
      destination: "auto", intent: "place", depth: "quick")
    let obj = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any]
    XCTAssertEqual(obj?["name"] as? String, "Kaffee")
    XCTAssertEqual(obj?["area"] as? String, "1 Bahnhofstrasse, Bern")
    XCTAssertEqual(obj?["languageCode"] as? String, "ja")
    XCTAssertEqual(obj?["destination"] as? String, "auto")
    XCTAssertEqual(obj?["intent"] as? String, "place")
    XCTAssertEqual(obj?["depth"] as? String, "quick")
  }
}
