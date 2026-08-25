import Foundation

/// web `POST /api/place-intelligence/fresh` へ送る。基底の場所詳細が `.loaded` になった後の
/// 2 度目の展開でだけ投げる —— name/area は解決済みの `place.name`/`place.address` から組む。
/// depth は "quick"(1 unit)で固定、intent は "place"(StopInspector の場所カード限定)。
public struct FreshVoicesRequestPayload: Encodable, Sendable {
  public let name: String
  public let area: String
  public let languageCode: String   // "ja" | "en"
  public let destination: String    // DestinationChoice.rawValue
  public let intent: String         // "place" | "food" | "hotel" —— このスライスは "place" 固定
  public let depth: String          // "quick" | "deep" —— このスライスは "quick" 固定(1 unit)
  public init(name: String, area: String, languageCode: String, destination: String, intent: String, depth: String) {
    self.name = name; self.area = area; self.languageCode = languageCode
    self.destination = destination; self.intent = intent; self.depth = depth
  }
}

/// web `FreshFinding`(`lib/fresh-voices.ts:29-43`)のテキスト部分。`evidenceLevel`/`urlSignature`
/// はデコードで無視(前者はバッジ非対象、後者は画像プロキシ用の署名で iOS の `URLSession` からは
/// 構造的に届かない —— 基底カードが写真を落としたのと同じ理由)。
public struct FreshFinding: Decodable, Sendable, Equatable {
  public let title: String
  public let url: String
  public let note: String
  public let age: String?         // 例 "3 days ago"、web の page_age 素通し
  public let isRecent: Bool?
  public let sourceKind: String   // "social" | "news" | "blog" | "web"
  public init(title: String, url: String, note: String, age: String?, isRecent: Bool?, sourceKind: String) {
    self.title = title; self.url = url; self.note = note
    self.age = age; self.isRecent = isRecent; self.sourceKind = sourceKind
  }
}

/// web `FreshVoicesResult`(`lib/fresh-voices.ts:45-53`)の写し。`searchCount` はデコードで無視
/// (表示しない —— out of scope)。表示に使うのは `summary` と `findings` だけ。
public struct FreshVoicesResult: Decodable, Sendable, Equatable {
  public let provider: String       // "anthropic_web_search"
  public let checkedAt: String      // ISO 8601、サーバが刻む
  public let intent: String         // "place" | "food" | "hotel"
  public let depth: String          // "quick" | "deep"
  public let summary: String        // 候補ゼロなら ""
  public let findings: [FreshFinding]
  public init(provider: String, checkedAt: String, intent: String, depth: String, summary: String, findings: [FreshFinding]) {
    self.provider = provider; self.checkedAt = checkedAt; self.intent = intent
    self.depth = depth; self.summary = summary; self.findings = findings
  }
}
