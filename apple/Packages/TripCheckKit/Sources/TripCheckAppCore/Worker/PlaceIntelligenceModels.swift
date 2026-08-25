import Foundation

/// web `POST /api/place-intelligence` へ送る。providerRef と scope は **送らない**
/// （両方省くと web はリッチな field mask=rating/reviews/analysis を返す。1.5km 検査で保護）。
public struct PlaceIntelligenceRequestPayload: Encodable, Sendable {
  public let name: String
  public let area: String
  public let latitude: Double
  public let longitude: Double
  public let languageCode: String    // "ja" | "en"
  public let destination: String     // DestinationChoice.rawValue
  public init(name: String, area: String, latitude: Double, longitude: Double, languageCode: String, destination: String) {
    self.name = name; self.area = area; self.latitude = latitude; self.longitude = longitude
    self.languageCode = languageCode; self.destination = destination
  }
}

/// web `PlaceIntelligenceResult["place"]` の写し。payment/photo* はデコードで無視。
public struct PlaceIntelligencePlace: Decodable, Sendable {
  public let name: String
  public let address: String
  public let googleMapsUrl: String
  public let businessStatus: String?
  public let rating: Double?
  public let userRatingCount: Int?
  public let openNow: Bool?
  public let hours: [String]
}

/// web `PlaceReviewEvidence` の抜粋(本文フィールドは web で `text`)。
public struct PlaceIntelligenceReview: Decodable, Sendable, Identifiable {
  public let text: String?
  public let rating: Double?
  public var id: String { (text ?? "") + "|\(rating ?? 0)" }
}

public struct PlaceIntelligenceAnalysis: Decodable, Sendable {
  public let summary: String
  public let confidence: String
}

public struct PlaceIntelligenceResult: Decodable, Sendable {
  public let place: PlaceIntelligencePlace
  public let reviews: [PlaceIntelligenceReview]
  public let analysis: PlaceIntelligenceAnalysis
}
