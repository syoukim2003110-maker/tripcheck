import Foundation

/// web `POST /api/place-suggestions` へ送るペイロード。単数 `query`(解決の複数 `queries` と違う)。
public struct PlaceSuggestionRequestPayload: Encodable, Sendable {
  public let query: String        // 2–120 文字
  public let languageCode: String // "ja" | "en"
  public let destination: String  // "auto" or 目的地 id(DestinationChoice.rawValue)
  public init(query: String, languageCode: String, destination: String) {
    self.query = query
    self.languageCode = languageCode
    self.destination = destination
  }
}

/// web の autocomplete 予測 1 行の写し。使わない付随フィールドはデコードで無視される。
public struct WorkerPlaceSuggestion: Decodable, Sendable, Identifiable, Equatable {
  public let providerRef: String   // Google Place ID(一覧内の一意鍵)
  public let primaryText: String
  public let secondaryText: String
  public let fullText: String      // タップ時に入力欄へ入れるテキスト
  public var id: String { providerRef }
  public init(providerRef: String, primaryText: String, secondaryText: String, fullText: String) {
    self.providerRef = providerRef
    self.primaryText = primaryText
    self.secondaryText = secondaryText
    self.fullText = fullText
  }
}

/// web `{ provider, suggestions }` の写し。
public struct PlaceSuggestionResult: Decodable, Sendable {
  public let provider: String
  public let suggestions: [WorkerPlaceSuggestion]
  public init(provider: String, suggestions: [WorkerPlaceSuggestion]) {
    self.provider = provider
    self.suggestions = suggestions
  }
}
