// Sources/TripCheckAppCore/Intent/CannedIntentParser.swift
import Foundation
import TripCheckKit

/// 通信しない決定的な聞き取り係。`-uiTesting` の注入先(`TripCheckApp`)。
///
/// 入力に依らず同じ答えを返す —— UI テストはこの canned 値を前提に書く。durationText は
/// 「3泊」(→4日):フォーム既定の tripDays=3 と区別できる値にして、適用が起きたことを
/// 観測可能にしてある(計画の裁定5)。
public struct CannedIntentParser: IntentParser {
  public init() {}

  public func parse(_ text: String, locale: PlannerLocale) async -> IntentOutcome {
    // 値そのもの(日本語)は走査の逃げ場である `AppCopy.swift` に置いてある(`IntentLiterals`)。
    .parsed(TripIntent(
      destination: IntentLiterals.cannedDestination,
      durationText: IntentLiterals.cannedDuration,
      whenText: "",
      wishes: IntentLiterals.cannedWishes))
  }
}
