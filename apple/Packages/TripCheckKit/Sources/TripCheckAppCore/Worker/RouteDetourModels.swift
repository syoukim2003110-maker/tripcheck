import Foundation
import TripCheckKit

/// web `POST /api/route-recommendations` へ送る。routePoints は実ルート形状の標本(≤12)。
/// excludedPlaceIds/excludedNames はローカル重複除去のみに使い、Google へは送らない。
public struct RouteRecommendationRequestPayload: Encodable, Sendable {
  public let routePoints: [GeoPoint]
  public let excludedPlaceIds: [String]
  public let excludedNames: [String]
  public let languageCode: String   // "ja" | "en"
  public let destination: String    // DestinationChoice.rawValue
  public let suggestionKinds: [String]
  public init(routePoints: [GeoPoint], excludedPlaceIds: [String], excludedNames: [String], languageCode: String, destination: String, suggestionKinds: [String]) {
    self.routePoints = routePoints; self.excludedPlaceIds = excludedPlaceIds; self.excludedNames = excludedNames
    self.languageCode = languageCode; self.destination = destination; self.suggestionKinds = suggestionKinds
  }
}

/// web `RouteRecommendation` のテキスト部分。providerRef/座標/photoName 等はデコードで無視。
public struct RouteRecommendation: Decodable, Sendable, Identifiable, Equatable {
  public let id: String
  public let name: String
  public let address: String
  public let type: String
  public let googleMapsUrl: String
  public let rating: Double?
  public let userRatingCount: Int?
  public let routeDistanceMeters: Double?
  public init(id: String, name: String, address: String, type: String, googleMapsUrl: String, rating: Double?, userRatingCount: Int?, routeDistanceMeters: Double?) {
    self.id = id; self.name = name; self.address = address; self.type = type; self.googleMapsUrl = googleMapsUrl
    self.rating = rating; self.userRatingCount = userRatingCount; self.routeDistanceMeters = routeDistanceMeters
  }
}

public struct RouteRecommendationResult: Decodable, Sendable, Equatable {
  public let candidates: [RouteRecommendation]
  public init(candidates: [RouteRecommendation]) {
    self.candidates = candidates
  }
}
