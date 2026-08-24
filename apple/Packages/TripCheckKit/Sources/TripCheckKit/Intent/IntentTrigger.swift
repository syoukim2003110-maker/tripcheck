// Sources/TripCheckKit/Intent/IntentTrigger.swift
import Foundation

/// 「文らしい」かの決定的判定。LLM は使わない —— 毎キー入力で評価されるので、
/// ここは純粋・即答・無料でなければならない(spec §4.1)。誤発火のコストは行が1つ
/// 増えるだけなので、出す側に倒してある。
public enum IntentTrigger {
  static let markers = ["泊", "日間", "日帰り", "したい", "行きたい", "旅", "。", "、"]

  public static func looksLikeTripSentence(_ text: String) -> Bool {
    let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard t.count >= 4 else { return false }
    if markers.contains(where: { t.contains($0) }) { return true }
    return t.contains(where: \.isWhitespace) && t.count >= 12
  }
}
