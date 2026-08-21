import Foundation

/// JS の `new RegExp(source, "giu")` に対応する最小ラッパ(`NSRegularExpression` = ICU、
/// lookbehind/`u` フラグ相当をそのまま扱える)。`matches`/`replacingAll` は常に全件を対象にする(JS の `g` 相当)。
public struct JSRegex: Sendable {
  let re: NSRegularExpression

  public init(_ pattern: String, options: NSRegularExpression.Options = []) throws {
    re = try NSRegularExpression(pattern: pattern, options: options)
  }

  /// `groups[0]` は正規表現のキャプチャグループ 1 に対応する(NSRegularExpression の range 0 は全体マッチ)
  public struct Match {
    public let range: Range<String.Index>
    public let groups: [String?]
  }

  public func matches(in s: String) -> [Match] {
    re.matches(in: s, range: NSRange(s.startIndex..., in: s)).map { m in
      Match(
        range: Range(m.range, in: s)!,
        groups: (1..<max(1, m.numberOfRanges)).map { i in
          let r = m.range(at: i)
          return r.location == NSNotFound ? nil : String(s[Range(r, in: s)!])
        }
      )
    }
  }

  public func firstMatch(in s: String) -> Match? { matches(in: s).first }

  public func test(_ s: String) -> Bool {
    re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
  }

  public func replacingAll(in s: String, with template: String) -> String {
    re.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: template)
  }
}
