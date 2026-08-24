// Sources/TripCheckKit/Intent/TripIntent.swift
import Foundation

/// 自由文から抜き出した旅の条件。値はすべて本文の表記のまま —— 暦や泊数の計算は
/// `IntentResolution`(決定的コード)の仕事で、LLM には写すことしかさせない(spec §4.2)。
public struct TripIntent: Hashable, Sendable, Codable {
  /// 行き先の地名。無ければ ""。
  public var destination: String
  /// 「2泊」「3日間」など。無ければ ""。
  public var durationText: String
  /// 「9月」「10月3日から」など。無ければ ""。
  public var whenText: String
  /// やりたいこと・食べたいもの・行きたい場所。本文に書かれたものだけ。
  public var wishes: [String]

  public init(destination: String, durationText: String, whenText: String, wishes: [String]) {
    self.destination = destination
    self.durationText = durationText
    self.whenText = whenText
    self.wishes = wishes
  }

  /// 全欄が空 —— 埋めるものが無いので `.failed` に落とす(spec §4.2)。
  public var isEmpty: Bool {
    destination.isEmpty && durationText.isEmpty && whenText.isEmpty && wishes.isEmpty
  }
}

public enum IntentOutcome: Hashable, Sendable {
  case parsed(TripIntent)
  /// タイムアウト・モデルエラー・全欄空。どこにもキャッシュしない(spec §4.5)。
  case failed
}

/// 聞き取り係の約束。`RouteProvider` と同じ構え —— Kit は提供元を知らない。
public protocol IntentParser: Sendable {
  func parse(_ text: String, locale: PlannerLocale) async -> IntentOutcome
  /// 行が初めて見えたときに一度呼ばれる。モデル資産の先読み。既定は何もしない。
  func prewarm()
}

extension IntentParser {
  public func prewarm() {}
}
