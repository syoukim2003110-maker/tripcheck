// Sources/TripCheckAppCore/Intent/FoundationModelsIntentParser.swift
import Foundation
import FoundationModels
import TripCheckKit

/// 端末内 LLM(Foundation Models)の聞き取り係。写経だけをさせる ——「本文の表記のまま」を
/// instructions と @Guide の両方で縛り、暦・泊数の計算は Kit の `IntentResolution` に渡す。
///
/// パースごとに新品セッション:セッションは履歴を持ち、使い回すと前回の答えが単語入力に
/// 混入する(spec §8-4 で実測)。temperature 0(解釈に賭けは要らない)。
/// 番犬は `AppleRouteProvider.race` と同じ withTaskGroup + Task.sleep。SDK 側のネイティブ
/// キャンセルは公開されていないので、負けた生成は答えを捨てるだけ(結果は世代検査で守る)。
@available(iOS 26.0, macOS 26.0, *)
public struct FoundationModelsIntentParser: IntentParser {
  static let instructions =
    "旅行の希望を書いた文から条件を抜き出す。値は必ず本文に書かれた表記のまま写す。本文に無い情報は決して補わない。"

  @Generable
  struct GeneratedIntent {
    @Guide(description: "旅の行き先の地名。本文の表記のまま。無ければ空文字。")
    var destination: String
    @Guide(description: "泊数・日数の表現を本文の表記のまま。例:「2泊」「3日間」「2泊3日」。無ければ空文字。")
    var durationText: String
    @Guide(description: "時期・日付の表現を本文の表記のまま。例:「9月」「10月3日から」「来週末」。無ければ空文字。")
    var whenText: String
    @Guide(description: "やりたいこと・食べたいもの・行きたい場所の項目。本文に書かれたものだけ。")
    var wishes: [String]
  }

  let timeout: Duration

  public init(timeout: Duration = .seconds(20)) {
    self.timeout = timeout
  }

  public func prewarm() {
    LanguageModelSession(instructions: Self.instructions).prewarm()
  }

  public func parse(_ text: String, locale: PlannerLocale) async -> IntentOutcome {
    let timeout = self.timeout
    return await withTaskGroup(of: IntentOutcome.self) { group in
      group.addTask {
        do {
          let session = LanguageModelSession(instructions: Self.instructions)
          let response = try await session.respond(
            to: text, generating: GeneratedIntent.self,
            options: GenerationOptions(temperature: 0.0))
          let g = response.content
          let intent = TripIntent(
            destination: g.destination.trimmingCharacters(in: .whitespacesAndNewlines),
            durationText: g.durationText,
            whenText: g.whenText,
            wishes: g.wishes
              .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
              .filter { !$0.isEmpty })
          return intent.isEmpty ? .failed : .parsed(intent)
        } catch {
          return .failed
        }
      }
      group.addTask {
        try? await Task.sleep(for: timeout)
        return .failed
      }
      let first = await group.next() ?? .failed
      group.cancelAll()
      return first
    }
  }
}
