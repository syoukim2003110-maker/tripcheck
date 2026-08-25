import Foundation
import TripCheckKit

/// web `POST /api/hotel-recommendations` へ送る。query は送らない(自動探索=4 units)。
/// routePoints は GeoPoint の合成 Codable で `{latitude,longitude}` に符号化される。
public struct HotelRecommendationRequestPayload: Encodable, Sendable {
  public let latitude: Double
  public let longitude: Double
  public let area: String
  public let routePoints: [GeoPoint]
  public let languageCode: String   // "ja" | "en"
  public let destination: String    // DestinationChoice.rawValue
  public init(latitude: Double, longitude: Double, area: String, routePoints: [GeoPoint], languageCode: String, destination: String) {
    self.latitude = latitude; self.longitude = longitude; self.area = area
    self.routePoints = routePoints; self.languageCode = languageCode; self.destination = destination
  }
}

/// web `HotelCandidate` のテキスト部分。photo/reviews/payment/rakuten/styles/score/priceLevel/座標は無視。
public struct HotelCandidate: Decodable, Sendable, Identifiable, Equatable {
  public let id: String
  public let name: String
  public let address: String
  public let googleMapsUrl: String
  public let websiteUrl: String?
  public let rating: Double?
  public let userRatingCount: Int?
  public let distanceMeters: Double?
  public let routeBurdenMeters: Double?
}
public struct HotelRecommendationResult: Decodable, Sendable, Equatable {
  public let candidates: [HotelCandidate]
}
