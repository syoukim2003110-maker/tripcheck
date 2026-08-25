import Foundation

/// web `POST /api/food-recommendations` へ送る。visitDate/visitTime は持たない
/// (= 常に未送信 = web の hasNoVisitPair を満たす)。query が nil のとき JSON は null になり、
/// server 側は queryMissing と見て既定の探索語を補う。
public struct FoodRecommendationRequestPayload: Encodable, Sendable {
  public let latitude: Double
  public let longitude: Double
  public let area: String
  public let mealKind: String        // "lunch" | "dinner"
  public let query: String?          // 1–120 or nil
  public let languageCode: String    // "ja" | "en"
  public let destination: String     // DestinationChoice.rawValue
  public let routePolyline: String?  // 10–10000 or nil
  public init(latitude: Double, longitude: Double, area: String, mealKind: String, query: String?, languageCode: String, destination: String, routePolyline: String?) {
    self.latitude = latitude; self.longitude = longitude; self.area = area; self.mealKind = mealKind
    self.query = query; self.languageCode = languageCode; self.destination = destination; self.routePolyline = routePolyline
  }

  private enum CodingKeys: String, CodingKey {
    case latitude, longitude, area, mealKind, query, languageCode, destination, routePolyline
  }

  // 合成 Encodable は Optional を encodeIfPresent で扱い、nil のときキーごと省く。
  // web の queryMissing 判定はキー自体ではなく値が null であることを見るため、明示的に null を書く。
  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(latitude, forKey: .latitude)
    try container.encode(longitude, forKey: .longitude)
    try container.encode(area, forKey: .area)
    try container.encode(mealKind, forKey: .mealKind)
    if let query { try container.encode(query, forKey: .query) } else { try container.encodeNil(forKey: .query) }
    try container.encode(languageCode, forKey: .languageCode)
    try container.encode(destination, forKey: .destination)
    if let routePolyline { try container.encode(routePolyline, forKey: .routePolyline) } else { try container.encodeNil(forKey: .routePolyline) }
  }
}

/// web `FoodCandidate` の写し。写真・評価片・決済・hours 等はデコードで無視。
public struct FoodCandidate: Decodable, Sendable, Identifiable, Equatable {
  public let id: String
  public let name: String
  public let address: String
  public let type: String
  public let googleMapsUrl: String
  public let distanceMeters: Int?
  public let rating: Double?
  public let userRatingCount: Int?
  public let openNow: Bool?
  public let websiteUrl: String?
}

public struct FoodRecommendationResult: Decodable, Sendable {
  public let candidates: [FoodCandidate]
}
