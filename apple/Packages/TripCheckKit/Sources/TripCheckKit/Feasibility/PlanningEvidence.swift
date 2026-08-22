import Foundation

/*
 * 旅行者が読める、はっきりした証拠だけを、小さな日程の余白に変える。
 *
 * 営業状態や "closed" のような一般語は **わざと** 無視する:利用可否の硬い判断は確認済みの
 * 営業時間の仕事で、この道具の仕事ではない。
 *
 * 移植元:`lib/planning-evidence.ts:1-93`。
 */

/// TS `SoftDurationReason`(`lib/planning-evidence.ts:4`)。
public enum SoftDurationReason: String, Codable, Sendable, CaseIterable {
  case crowd, queue, sold_out, early_close, detour
}

/// TS `StopPlanningEvidence["sourceCounts"]`(`:10-13`)。
public struct PlanningEvidenceSourceCounts: Equatable, Sendable, Codable {
  public var googleReviews: Int
  public var publicWeb: Int

  public init(googleReviews: Int = 0, publicWeb: Int = 0) {
    self.googleReviews = googleReviews
    self.publicWeb = publicWeb
  }
}

/// TS `StopPlanningEvidence`(`:6-14`)。
public struct StopPlanningEvidence: Equatable, Sendable, Codable {
  /// 0 / 15 / 30 のみ。
  public var bufferMinutes: Int
  public var evidenceCount: Int
  public var reasons: [SoftDurationReason]
  public var sourceCounts: PlanningEvidenceSourceCounts

  public init(
    bufferMinutes: Int,
    evidenceCount: Int,
    reasons: [SoftDurationReason],
    sourceCounts: PlanningEvidenceSourceCounts
  ) {
    self.bufferMinutes = bufferMinutes
    self.evidenceCount = evidenceCount
    self.reasons = reasons
    self.sourceCounts = sourceCounts
  }
}

/// 証拠 1 件。TS は `PlaceIntelligenceResult` / `FreshVoicesResult` をそのまま受けるが、
/// 提供元との通信は Kit の外なので、`deriveStopPlanningEvidence`(`:55-93`)が実際に読む
/// 3 つ —— 文、どこから来たか、出典だけの結果かどうか —— に絞る。
public struct PlanningEvidenceMention: Equatable, Sendable {
  public enum Source: String, Sendable, CaseIterable {
    case googleReviews, publicWeb
  }

  public var text: String
  public var source: Source
  /// TS `finding.evidenceLevel === "source_only"`(`:68`)—— 検索が出典を見つけただけの結果を、
  /// 日程の主張に変えない。
  public var isSourceOnly: Bool

  public init(text: String, source: Source = .googleReviews, isSourceOnly: Bool = false) {
    self.text = text
    self.source = source
    self.isSourceOnly = isSourceOnly
  }
}

public enum PlanningEvidence {

  /// TS `explicitPatterns`(`:22-28`)。
  static let explicitPatterns: [(SoftDurationReason, JSRegex)] = [
    (.crowd, try! JSRegex(
      "(?:かなり|とても|非常に|すごく)?\\s*混(?:雑|んで|み合)|人(?:が|で)?\\s*(?:多すぎ|いっぱい)|大混雑|packed|overcrowded|very\\s+busy|extremely\\s+busy",
      options: [.caseInsensitive]
    )),
    (.queue, try! JSRegex(
      "行列|長蛇|待ち時間|\\d+\\s*分待ち|並んで|queue|queued|long\\s+line|wait(?:ed|ing)?\\s+(?:for\\s+)?\\d+",
      options: [.caseInsensitive]
    )),
    (.sold_out, try! JSRegex(
      "売り切れ|売切れ|完売|品切れ|整理券(?:が)?終了|sold\\s*out|ran\\s*out|no\\s+tickets?\\s+left",
      options: [.caseInsensitive]
    )),
    (.early_close, try! JSRegex(
      "早じまい|早仕舞い|予定より早く(?:閉|終了)|営業時間より早く(?:閉|終了)|受付(?:が)?早めに終了|最終受付|closes?\\s+early|closed\\s+earlier|earlier\\s+than\\s+(?:posted|listed)|early\\s+cutoff|last\\s+(?:entry|admission)",
      options: [.caseInsensitive]
    )),
    (.detour, try! JSRegex(
      "迂回|遠回り|回り道|入口(?:が|は)?(?:分かり|わかり)にく|detour|long\\s+way\\s+around|hard\\s+to\\s+find\\s+(?:the\\s+)?entrance",
      options: [.caseInsensitive]
    )),
  ]

  /// TS `negatedPatterns`(`:30-36`)—— 「行列はなかった」を行列の報告として数えない。
  static let negatedPatterns: [(SoftDurationReason, JSRegex)] = [
    (.crowd, try! JSRegex(
      "(?:混雑|混んで|混み合)(?:は|が|も|して|し|い)?な(?:い|かった|く)|空いていた|not\\s+(?:busy|crowded)|wasn['’]?t\\s+(?:busy|crowded)",
      options: [.caseInsensitive]
    )),
    (.queue, try! JSRegex(
      "行列(?:は|が|も)?な(?:い|かった|く)|待ち時間(?:は|が|も)?な(?:い|かった|く)|並ばず|no\\s+(?:queue|line|wait)|without\\s+(?:a\\s+)?wait",
      options: [.caseInsensitive]
    )),
    (.sold_out, try! JSRegex(
      "売り切れ(?:では|じゃ)?な(?:い|かった|く)|完売(?:では|じゃ)?な(?:い|かった|く)|not\\s+sold\\s*out",
      options: [.caseInsensitive]
    )),
    (.early_close, try! JSRegex(
      "早(?:じまい|仕舞い)(?:は|し)?な(?:い|かった|く)|didn['’]?t\\s+close\\s+early",
      options: [.caseInsensitive]
    )),
    (.detour, try! JSRegex(
      "迂回(?:は|が)?不要|遠回り(?:は|が)?不要|no\\s+detour",
      options: [.caseInsensitive]
    )),
  ]

  /// TS `reasonOrder`(`:38`)。
  public static let reasonOrder: [SoftDurationReason] = [.crowd, .queue, .sold_out, .early_close, .detour]

  /// TS の `/\s+/g`。ICU の `\s` は U+0085 を空白に数え U+FEFF を数えないので、JS の集合を
  /// `JSText.whitespaceClass` から書き下す(向きは両方とも逆)。
  static let whitespacePattern = try! JSRegex("[\(JSText.whitespaceClass)]+")

  /// TS `normalizeEvidenceText`(`:40-42`)—— NFKC で畳んでから空白を 1 つに詰める。
  ///
  /// 3 つの道具はいずれも `Foundation` の既定ではなく JS の規則を使う。`normalize("NFKC")` は
  /// `precomposedStringWithCompatibilityMapping` だけでは不動点に届かず(`JSText.normalizeNFKC`
  /// の但し書き)、`\s` と `trim()` は U+0085 / U+FEFF の扱いが `Foundation` と逆になる。
  /// ここで畳んだ文が同一性の鍵(`stopPlanningEvidence` の `seen`)になるので、差は件数に出る。
  static func normalize(_ value: String) -> String {
    let folded = JSText.normalizeNFKC(value)
    return JSText.trim(whitespacePattern.replacingAll(in: folded, with: " "))
  }

  /// TS `classify`(`:44-48`)—— 肯定形に当たり、かつ否定形に当たらない理由だけ。
  public static func classify(_ text: String) -> [SoftDurationReason] {
    reasonOrder.filter { reason in
      guard let explicit = explicitPatterns.first(where: { $0.0 == reason })?.1, explicit.test(text) else { return false }
      let negated = negatedPatterns.first(where: { $0.0 == reason })?.1
      return !(negated?.test(text) ?? false)
    }
  }

  /// TS `deriveStopPlanningEvidence`(`:55-93`)。
  public static func stopPlanningEvidence(_ mentions: [PlanningEvidenceMention]) -> StopPlanningEvidence {
    var candidates: [(reasons: [SoftDurationReason], source: PlanningEvidenceMention.Source, text: String)] = []
    for mention in mentions {
      if mention.isSourceOnly { continue }
      let text = normalize(mention.text)
      let reasons = classify(text)
      if !reasons.isEmpty { candidates.append((reasons, mention.source, text)) }
    }

    // TS `new Map(...)` は挿入順。同じ文の 2 件目は落とす。
    var seen = Set<String>()
    var evidence: [(reasons: [SoftDurationReason], source: PlanningEvidenceMention.Source, text: String)] = []
    for candidate in candidates {
      let key = candidate.text.lowercased(with: Locale(identifier: "ja_JP"))
      if seen.insert(key).inserted { evidence.append(candidate) }
    }

    let evidenceCount = evidence.count
    let reasons = reasonOrder.filter { reason in evidence.contains { $0.reasons.contains(reason) } }
    var sourceCounts = PlanningEvidenceSourceCounts()
    for item in evidence {
      switch item.source {
      case .googleReviews: sourceCounts.googleReviews += 1
      case .publicWeb: sourceCounts.publicWeb += 1
      }
    }

    return StopPlanningEvidence(
      bufferMinutes: evidenceCount == 0 ? 0 : evidenceCount == 1 ? 15 : 30,
      evidenceCount: evidenceCount,
      reasons: reasons,
      sourceCounts: sourceCounts
    )
  }

  /// ブリーフの `softBufferMinutes(mentions:)` —— 文の配列から余白の分だけを取る近道。
  public static func softBufferMinutes(mentions: [String]) -> Int {
    stopPlanningEvidence(mentions.map { PlanningEvidenceMention(text: $0) }).bufferMinutes
  }
}
