import Foundation

/*
 * TC-068 + COPY-EXTRA:社内語・技術語が旅行者の画面に出てはならない。
 *
 * `tests/banned-terms.test.ts:41-49` の 4 パターンをそのまま Kit 側の定数にする(TS では
 * テストファイルにしか無いが、Swift 側はアプリのソース走査(Plan 2)とコピー表の検査の
 * 両方が同じ定義を読む必要があるので、製品コードに置く)。
 *
 * 禁止される語と、旅行者向けの言い換え:
 *
 *   実測                       → 「Google Maps経路データ」/「確認済みの経路」
 *   判定保留 / 判定を保留 / 判定は保留 → 結果の言葉(「確認が終わるまで結論を出しません」系)
 *   対応品質 / 地域品質         → 「この地域の対応」/ "Coverage in this region"
 *   ○○API 形式の提供元内部名     → 出典の語彙だけ(Google Maps / Rakuten Travel /
 *                                Open-Meteo / Claude は出典表示として **許可**。
 *                                "Places API" のような表示は禁止のまま)
 */
public enum BannedTerms {

  /// 1 つの禁止クラス —— TS の `{ name, pattern }`(`tests/banned-terms.test.ts:41-49`)。
  public struct Rule: Sendable {
    public let name: String
    public let pattern: JSRegex

    init(_ name: String, _ pattern: String) {
      self.name = name
      // パターンは全部このファイルの中のリテラルなので、壊れていればビルド後の最初の
      // 呼び出しで必ず落ちる —— 実行時の入力に依存しない。
      self.pattern = try! JSRegex(pattern)
    }
  }

  /// TS `bannedPatterns`(`tests/banned-terms.test.ts:41-49`)。
  public static let rules: [Rule] = [
    Rule("実測 (measurement jargon)", "実測"),
    Rule("判定保留 (internal-state jargon)", "判定を保留|判定は保留|判定保留"),
    Rule("対応品質/地域品質 (coverage-grade jargon)", "対応品質|地域品質"),
    // 大文字・語境界つきの API。小文字の経路("/api/place-photo"、"?api=1")や
    // `API_KEY`(前に語境界が無い)は当たらない。表示される "Places API" は当たる。
    Rule("provider-internal API naming", "\\bAPI\\b"),
  ]

  /// ブリーフの `BannedTerms.patterns`。
  public static var patterns: [JSRegex] { rules.map(\.pattern) }

  /// `text` が踏んだ禁止クラスの名前(踏んでいなければ空)。
  public static func violations(in text: String) -> [String] {
    rules.filter { $0.pattern.test(text) }.map(\.name)
  }
}
