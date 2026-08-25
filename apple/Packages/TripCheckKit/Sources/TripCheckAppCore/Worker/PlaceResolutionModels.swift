import Foundation

/// web `POST /api/place-resolution` へ送るペイロード。MVP は queries と言語・行き先のみ。
public struct PlaceResolutionRequestPayload: Encodable, Sendable {
  public let queries: [String]
  public let languageCode: String   // "ja" | "en"
  public let destination: String    // "auto" or a pinned destination id
  public init(queries: [String], languageCode: String, destination: String) {
    self.queries = queries
    self.languageCode = languageCode
    self.destination = destination
  }
}

/// web `ResolvedInputStop` の写し。使わない付随フィールド(openingHoursApplicable 等)は
/// デコードで無視される。confidence は文字列で受けて後段で Confidence に写す(境界で緩く)。
public struct WorkerResolvedStop: Decodable, Sendable {
  public let id: String
  public let providerRef: String?
  public let name: String
  public let area: String
  public let latitude: Double
  public let longitude: Double
  public let sourceUrl: String
  public let verifiedAt: String
  public let confidence: String
  public let planningDurationMinutes: Int
  public let isAnchor: Bool
  public let placeTypes: [String]?
  public let address: String
  public let countryCode: String?
  public let input: String
  public let inputIndex: Int?
}

public struct WorkerAmbiguousResolution: Decodable, Sendable {
  public let input: String
  public let candidates: [WorkerResolvedStop]
}

public struct PlaceResolutionResult: Decodable, Sendable {
  public let provider: String
  public let fetchedAt: String
  public let places: [WorkerResolvedStop]
  public let hotel: WorkerResolvedStop?
  public let ambiguous: [WorkerAmbiguousResolution]
}
