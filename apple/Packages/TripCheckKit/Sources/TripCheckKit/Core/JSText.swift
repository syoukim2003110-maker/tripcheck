import Foundation

/*
 * JS の「表記」の規則 —— 数の書き方、丸め、空白の集合、UTF-16 での長さと切り方、NFKC。
 *
 * `Core/JSMath.swift` が「JS と同じ**値**が出るか」を担うのに対し、こちらは「JS と同じ
 * **文字**が出るか」を担う。要るのは何より共有コード(`Share/`)が Web とバイト同一である
 * ためだが、NFKC だけは折り畳みの語彙として `Parser/` や `Resolution/` も同じものを通す
 * —— 同じ「ﾊﾟ」が場所によって 1 文字にも 2 文字にもなると、Swift 同士の比較は正準等価に
 * 救われても、線の上では割れる(`normalizeNFKC` の但し書き)。
 */
enum JSText {

  /// `Number::toString(10)` を経由した `JSON.stringify` の数値表記。
  ///
  /// Swift の `Double.description` は JS と同じ**最短往復**の桁を出すが、体裁が違う
  /// (`1e-07` 対 `1e-7`、`90.0` 対 `90`)。そこで桁と指数だけを借り、組み立ては
  /// ECMA-262 の `Number::toString` の手順(k 桁の s と n について 5 つの枝)でやり直す。
  static func numberString(_ value: Double) -> String {
    // JSON に非有限数は書けない。`JSON.stringify` はここで `null` を出す。
    guard value.isFinite else { return "null" }
    // `JSON.stringify(-0)` は `"0"`。
    if value == 0 { return "0" }

    let negative = value < 0
    let description = abs(value).description
    var mantissa = description
    var exponent = 0
    if let separator = description.firstIndex(where: { $0 == "e" || $0 == "E" }) {
      mantissa = String(description[description.startIndex..<separator])
      exponent = Int(description[description.index(after: separator)...]) ?? 0
    }
    var fractionDigits = 0
    if let point = mantissa.firstIndex(of: ".") {
      fractionDigits = mantissa.distance(from: mantissa.index(after: point), to: mantissa.endIndex)
      mantissa.remove(at: point)
    }
    var digits = Array(mantissa)
    while digits.count > 1, digits.first == "0" { digits.removeFirst() }
    var trailingZeros = 0
    while digits.count > 1, digits.last == "0" {
      digits.removeLast()
      trailingZeros += 1
    }
    let k = digits.count
    // value = digits × 10^(n − k)
    let n = k + exponent - fractionDigits + trailingZeros
    let s = String(digits)

    let sign = negative ? "-" : ""
    if k <= n && n <= 21 { return sign + s + String(repeating: "0", count: n - k) }
    if 0 < n && n <= 21 {
      let split = s.index(s.startIndex, offsetBy: n)
      return sign + s[s.startIndex..<split] + "." + s[split...]
    }
    if -6 < n && n <= 0 { return sign + "0." + String(repeating: "0", count: -n) + s }
    let exponentPart = "e" + (n - 1 >= 0 ? "+" : "-") + String(abs(n - 1))
    if k == 1 { return sign + s + exponentPart }
    let split = s.index(after: s.startIndex)
    return sign + s[s.startIndex..<split] + "." + s[split...] + exponentPart
  }

  /// `Math.round` —— 「一番近い整数、同点なら**大きいほう**」。Swift の
  /// `rounded(.toNearestOrAwayFromZero)` は負の同点で向きが逆になるので使えない
  /// (`Math.round(-2.5)` は `-2`、Swift は `-3`)。
  static func round(_ value: Double) -> Double {
    guard value.isFinite else { return value }
    // `floor(x + 0.5)` は 0.5 のすぐ手前の値で 1 に跳ねてしまう(0.49999999999999994 + 0.5 == 1)。
    if value > 0 && value < 0.5 { return 0 }
    if value < 0 && value >= -0.5 { return -0.0 }
    return (value + 0.5).rounded(.down)
  }

  /// JS の `WhiteSpace ∪ LineTerminator`(`\s` が `u` フラグで指す集合と同じ)。ICU の `\s` とも
  /// `Foundation` の `.whitespacesAndNewlines` とも中身が違う(U+0085 を含まず U+FEFF を含む)ので、
  /// 正規表現に混ぜずここで名前を付ける。
  static let whitespaceScalars: Set<Unicode.Scalar> = [
    "\u{09}", "\u{0A}", "\u{0B}", "\u{0C}", "\u{0D}", "\u{20}", "\u{A0}", "\u{1680}",
    "\u{2000}", "\u{2001}", "\u{2002}", "\u{2003}", "\u{2004}", "\u{2005}", "\u{2006}",
    "\u{2007}", "\u{2008}", "\u{2009}", "\u{200A}", "\u{2028}", "\u{2029}", "\u{202F}",
    "\u{205F}", "\u{3000}", "\u{FEFF}",
  ]

  /// 正規表現の中で `\s` の代わりに書く文字クラスの中身(`[` と `]` は付けない)。
  static let whitespaceClass = "\\t\\n\\u000b\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff"

  /// `String.prototype.normalize("NFKC")`。
  ///
  /// `precomposedStringWithCompatibilityMapping` だけでは足りない。互換分解で**新しく現れた**
  /// 並びを組み直さないことがあり、半角の「ﾊﾟ」(U+FF8A U+FF9F)は U+30CF U+309A の 2 文字で
  /// 止まる —— JS の `normalize("NFKC")` は U+30D1 の 1 文字にする。同じ文字が 2 通りの
  /// バイト列になるので、共有コードのバイト同一が崩れる(`String` の `==` は正準等価で
  /// 較べるため、Swift 同士の比較では見えない)。正準合成をもう一度かけて不動点まで進める。
  static func normalizeNFKC(_ value: String) -> String {
    value.precomposedStringWithCompatibilityMapping.precomposedStringWithCanonicalMapping
  }

  /// `String.prototype.trim()`。
  static func trim(_ value: String) -> String {
    var scalars = Array(value.unicodeScalars)
    var start = 0
    var end = scalars.count
    while start < end, whitespaceScalars.contains(scalars[start]) { start += 1 }
    while end > start, whitespaceScalars.contains(scalars[end - 1]) { end -= 1 }
    scalars = Array(scalars[start..<end])
    return String(String.UnicodeScalarView(scalars))
  }

  /// JS の `String.prototype.length` —— UTF-16 コード単位の数。Swift の `count`(書記素)とは
  /// 別物で、掃除役の `key.length > 200` はこちらで数えている。
  static func length(_ value: String) -> Int { value.utf16.count }

  /// `String.prototype.slice(0, limit)`。切り口が代用対の途中に来たときだけ JS と分かれる:
  /// JS は孤立サロゲートを残せるが Swift の `String` は残せないので、その半分を落とす。
  /// 落ちるのは「上限のちょうど境目に絵文字が跨がった」場合の 1 文字分だけで、
  /// 呼び出し側(名前 160・住所 300・行程 4,000)はいずれも境目を意味に使っていない。
  static func slice(_ value: String, _ limit: Int) -> String {
    let units = Array(value.utf16)
    guard units.count > limit else { return value }
    var cut = limit
    if cut > 0, units[cut - 1] >= 0xD800, units[cut - 1] <= 0xDBFF { cut -= 1 }
    return String(decoding: units[0..<cut], as: UTF16.self)
  }
}
