// Sources/TripCheckKit/Intent/IntentResolution.swift
import Foundation

/// 表記(「2泊」「10月3日から」)を値へ落とす決定的パーサ。LLM に暦をやらせると年も日も
/// 捏造する(spec §8-1)ので、計算はぜんぶここ。読めない表記は黙って nil。
public enum IntentResolution {
  /// 「N泊」→N+1、「N泊M日」→M、「N日間/N日」→N、「日帰り」→1。範囲は 1...14 にクランプ。
  public static func days(fromDurationText text: String) -> Int? {
    let t = normalized(text)
    if t.contains("日帰り") { return clamp(1) }
    if let m = t.firstMatch(of: /([0-9]+)泊([0-9]+)日/), let d = Int(m.2) { return clamp(d) }
    if let m = t.firstMatch(of: /([0-9]+)泊/), let n = Int(m.1) { return clamp(n + 1) }
    if let m = t.firstMatch(of: /([0-9]+)日/), let d = Int(m.1) { return clamp(d) }
    return nil
  }

  /// 月+日が揃った表記だけ日付になる。年無しは today 以降の直近(過ぎていれば翌年)、
  /// 年ありは過去なら nil。「9月」「来週末」は nil = 日付未定の旅(spec §4.3)。
  public static func startDate(fromWhenText text: String, today: CalendarDate) -> String? {
    let t = normalized(text)
    if let m = t.firstMatch(of: /([0-9]{4})[年-]([0-9]{1,2})[月-]([0-9]{1,2})日?/),
       let y = Int(m.1), let mo = Int(m.2), let d = Int(m.3) {
      guard let date = CalendarDate(year: y, month: mo, day: d), date >= today else { return nil }
      return date.description
    }
    if let m = t.firstMatch(of: /([0-9]{1,2})[月\/]([0-9]{1,2})日?/),
       let mo = Int(m.1), let d = Int(m.2) {
      guard let thisYear = CalendarDate(year: today.year, month: mo, day: d) else { return nil }
      if thisYear >= today { return thisYear.description }
      return CalendarDate(year: today.year + 1, month: mo, day: d)?.description
    }
    return nil
  }

  private static func clamp(_ d: Int) -> Int {
    min(max(d, EngineConstants.tripDaysRange.lowerBound), EngineConstants.tripDaysRange.upperBound)
  }

  /// 全角数字→半角。他の文字はそのまま。
  private static func normalized(_ text: String) -> String {
    String(text.map { ch in
      guard ch.unicodeScalars.count == 1, let v = ch.unicodeScalars.first?.value,
            (0xFF10...0xFF19).contains(v), let scalar = UnicodeScalar(v - 0xFF10 + 0x30) else { return ch }
      return Character(scalar)
    })
  }
}
