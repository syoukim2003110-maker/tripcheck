import XCTest
@testable import TripCheckAppCore
import TripCheckKit

final class LiveRouteModelsTests: XCTestCase {
  func testDecodesResponseAndIgnoresRichTransitFields() throws {
    let json = #"""
    {"provider":"google_maps","fetchedAt":"t","travelMode":"TRANSIT","legs":[
      {"id":"L1","durationMinutes":34,"distanceMeters":12000,"encodedPolyline":"abc",
       "transferCount":1,"transitSteps":[{"lineName":"IC 61"}],"walkToStopMinutes":4,"walkFromStopMinutes":3,"status":"ok"}
    ]}
    """#
    let result = try JSONDecoder().decode(LiveRoutesResult.self, from: Data(json.utf8))
    XCTAssertEqual(result.legs.count, 1)
    let leg = try XCTUnwrap(result.legs.first)
    XCTAssertEqual(leg.id, "L1")
    XCTAssertEqual(leg.durationMinutes, 34)
    XCTAssertEqual(leg.distanceMeters, 12000)
    XCTAssertEqual(leg.encodedPolyline, "abc")
    XCTAssertEqual(leg.status, "ok")
  }

  func testEncodesRequestWithGeoPointCoordinates() throws {
    let payload = LiveRoutesRequestPayload(
      legs: [LiveRouteLegPayload(id: "L1", origin: GeoPoint(latitude: 1.5, longitude: 2.5),
                                 destination: GeoPoint(latitude: 3.5, longitude: 4.5), departureTime: "2026-08-25T00:00:00Z")],
      languageCode: "ja", travelMode: "WALK")
    let obj = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as? [String: Any]
    XCTAssertEqual(obj?["languageCode"] as? String, "ja")
    XCTAssertEqual(obj?["travelMode"] as? String, "WALK")
    let legs = obj?["legs"] as? [[String: Any]]
    let origin = legs?.first?["origin"] as? [String: Any]
    XCTAssertEqual(origin?["latitude"] as? Double, 1.5)
    XCTAssertEqual(origin?["longitude"] as? Double, 2.5)
  }
}
