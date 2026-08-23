// Sources/TripCheckKit/Routing/RecommendationSource.swift
import Foundation

/// v1 §1.3「型とプロトコルは本 spec で切る」の未履行分。実装も呼び出しも本 spec には無い。
public struct RecommendationQuery: Hashable, Sendable {
  /// `FoodRecommendationSlot.id`
  public let slotId: String
  public let latitude: Double
  public let longitude: Double
  public let radiusMeters: Int
  public let kind: MealKind
  /// `FoodRecommendationSlot.queryIdeas`
  public let queryIdeas: [String]
  public init(slotId: String, latitude: Double, longitude: Double, radiusMeters: Int, kind: MealKind, queryIdeas: [String]) {
    self.slotId = slotId; self.latitude = latitude; self.longitude = longitude
    self.radiusMeters = radiusMeters; self.kind = kind; self.queryIdeas = queryIdeas
  }
}

public struct RecommendationCandidate: Hashable, Sendable {
  public let name: String
  public let latitude: Double
  public let longitude: Double
  public let category: String?
  public let address: String?
  public init(name: String, latitude: Double, longitude: Double, category: String?, address: String?) {
    self.name = name; self.latitude = latitude; self.longitude = longitude; self.category = category; self.address = address
  }
}

public protocol RecommendationSource: Sendable {
  func candidates(for query: RecommendationQuery, locale: PlannerLocale) async -> [RecommendationCandidate]
}
