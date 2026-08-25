import Foundation
import TripCheckKit

/// web `POST /api/live-routes` の 1 レグ。origin/destination は GeoPoint の合成 Codable が
/// そのまま `{latitude,longitude}` に符号化される(web `LiveRouteCoordinate` と同形)。
public struct LiveRouteLegPayload: Encodable, Sendable {
  public let id: String
  public let origin: GeoPoint
  public let destination: GeoPoint
  public let departureTime: String   // ISO8601(web は全レグ必須)
  public init(id: String, origin: GeoPoint, destination: GeoPoint, departureTime: String) {
    self.id = id; self.origin = origin; self.destination = destination; self.departureTime = departureTime
  }
}

public struct LiveRoutesRequestPayload: Encodable, Sendable {
  public let legs: [LiveRouteLegPayload]
  public let languageCode: String    // "ja" | "en"
  public let travelMode: String      // "WALK" | "DRIVE" | "TRANSIT"(バッチ全体で 1 つ)
  public init(legs: [LiveRouteLegPayload], languageCode: String, travelMode: String) {
    self.legs = legs; self.languageCode = languageCode; self.travelMode = travelMode
  }
}

/// web `LiveRouteResult` の写し。表現できない付随フィールド(transferCount / transitSteps /
/// walkToStopMinutes / walkFromStopMinutes)はデコードで無視される。
public struct LiveRouteLegResult: Decodable, Sendable {
  public let id: String
  public let durationMinutes: Int?
  public let distanceMeters: Int?
  public let encodedPolyline: String?
  public let status: String          // "ok" | "unavailable"
}

public struct LiveRoutesResult: Decodable, Sendable {
  public let legs: [LiveRouteLegResult]
}
