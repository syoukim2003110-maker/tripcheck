import Foundation

/*
 * `JSON.parse` と `JSON.stringify` の、順序を落とさない最小の写し。
 *
 * 共有コード(`Share/ShareCodec.swift`)は Web が出すバイト列と**同一**でなければならない。
 * URL の `#t=` は同じ 1 本の文字列として端末から端末へ渡るもので、「同じ意味の JSON」では
 * 足りない —— 受け取った側が再び共有すれば、両者のバイトが一致するかどうかがそのまま
 * 「同じリンクか」の判定になるからだ。
 *
 * `Foundation` の `JSONEncoder`/`JSONSerialization` は使えない:
 *
 * 1. **鍵の順が保証されない。** JS のオブジェクトは自分の鍵の並びを覚えていて、
 *    `JSON.stringify` はその並びのまま書く。`JSONEncoder` の並びは規定されていない。
 * 2. **数の書き方が違う。** JS は `Number::toString` の最短往復表記(`1e-7`、`0.30000000000000004`、
 *    `90`)、`JSONEncoder` は `Double` の別表記(`1e-07`)を出す。
 * 3. **`Object.entries` の順が意味を持つ。** `lib/share-link.ts` の掃除役は `.slice(0, 80)` の
 *    ように**先頭 N 件**だけを残すので、どの鍵が残るかが並び順で決まる。
 *
 * そこでこの層は JS の「オブジェクトは順序付き」という意味論をそのまま持つ:
 * `ShareJSONObject` は挿入順を保ち、JS の**整数添字の鍵が昇順で先**という規則
 * (ECMAScript `OrdinaryOwnPropertyKeys`)も再現する。
 */

// MARK: - 値

/// 順序付きの JSON 値。`Core/JSONValue.swift` は `[String: JSONValue]`(順序なし)なので、
/// バイト同一が要る場所では使えない —— あちらは「型が付くまでの入れ物」、こちらは「線の上の形」。
enum ShareJSON {
  case string(String)
  case number(Double)
  case bool(Bool)
  case null
  case array([ShareJSON])
  case object(ShareJSONObject)

  /// TS `typeof value === "string"`
  var asString: String? {
    if case .string(let value) = self { return value }
    return nil
  }

  /// TS `typeof value === "number"`。
  ///
  /// **有限とは限らない。** JSON の文法に `Infinity` は無いが、`1e999` と書けば `JSON.parse` は
  /// `Infinity` を返す(`Double("1e999")` も `+∞`)。TS 側はそのために `Number.isFinite` を
  /// 別に置いているので、こちらも `typeof` だけを写して、有限かどうかは `asFiniteNumber` で
  /// 訊く —— そうしないと「拒む」ところが「上限に丸める」に化ける。
  var asNumber: Double? {
    if case .number(let value) = self { return value }
    return nil
  }

  /// TS `typeof value === "number" && Number.isFinite(value)`
  var asFiniteNumber: Double? {
    guard let value = asNumber, value.isFinite else { return nil }
    return value
  }

  /// TS `value === true`
  var isTrue: Bool {
    if case .bool(let value) = self { return value }
    return false
  }

  /// TS `Array.isArray(value)`
  var asArray: [ShareJSON]? {
    if case .array(let value) = self { return value }
    return nil
  }

  /// TS `value && typeof value === "object" && !Array.isArray(value)` —— `null` も配列も外れる。
  var asObject: ShareJSONObject? {
    if case .object(let value) = self { return value }
    return nil
  }
}

/// 鍵と値の組。`[(String, ShareJSON)]` のタプル配列にすると、`ShareJSON` → `ShareJSONObject`
/// → タプル → `ShareJSON` の配置が循環しているとコンパイラが判断する(`Array` の間接参照を
/// タプル越しには見てくれない)。名前の付いた構造体にすると同じ形が通る。
struct ShareJSONMember {
  var key: String
  var value: ShareJSON
}

/// JS のオブジェクト:鍵の並びを覚えている連想配列。
struct ShareJSONObject {
  /// TS `Object.entries(value)` が返す並び。
  private(set) var entries: [ShareJSONMember] = []
  private var indexByKey: [String: Int] = [:]

  init() {}

  init(_ entries: [ShareJSONMember]) {
    for entry in entries { self[entry.key] = entry.value }
  }

  subscript(key: String) -> ShareJSON? {
    get { indexByKey[key].map { entries[$0].value } }
    set {
      guard let newValue else {
        guard let index = indexByKey.removeValue(forKey: key) else { return }
        entries.remove(at: index)
        for (other, otherIndex) in indexByKey where otherIndex > index { indexByKey[other] = otherIndex - 1 }
        return
      }
      // JS の代入と同じ:既にある鍵は**位置を変えずに**値だけ差し替わる。
      if let index = indexByKey[key] {
        entries[index].value = newValue
      } else {
        indexByKey[key] = entries.count
        entries.append(ShareJSONMember(key: key, value: newValue))
      }
    }
  }

  var keys: [String] { entries.map(\.key) }

  /// ECMAScript `OrdinaryOwnPropertyKeys` —— **配列添字になれる鍵**(正準な十進表記の
  /// 0…2^32−2)が数として昇順で先に並び、残りが挿入順で続く。`JSON.parse` が作った
  /// オブジェクトにもこの規則が効くので、`{"a":1,"10":2,"2":3}` の `Object.entries` は
  /// `2, 10, a` の順になる。掃除役の `.slice(0, N)` はこの並びの上で数えている。
  func jsOrdered() -> ShareJSONObject {
    var indexed: [(index: UInt32, entry: ShareJSONMember)] = []
    var named: [ShareJSONMember] = []
    for entry in entries {
      if let index = ShareJSONObject.arrayIndex(entry.key) {
        indexed.append((index: index, entry: entry))
      } else {
        named.append(entry)
      }
    }
    indexed.sort { $0.index < $1.index }
    var result = ShareJSONObject()
    result.entries = indexed.map(\.entry) + named
    result.indexByKey = Dictionary(uniqueKeysWithValues: result.entries.enumerated().map { ($0.element.key, $0.offset) })
    return result
  }

  /// 配列添字になれる鍵か。先頭の `0` や `+`、空白のある表記は正準ではないので**添字ではない**
  /// (`"07"` は普通の文字列の鍵)。上限は 2^32−2。
  static func arrayIndex(_ key: String) -> UInt32? {
    if key == "0" { return 0 }
    guard let first = key.unicodeScalars.first, first != "0", key.unicodeScalars.allSatisfy({ $0 >= "0" && $0 <= "9" }) else {
      return nil
    }
    guard let value = UInt32(key), value != UInt32.max else { return nil }
    return value
  }
}

// MARK: - JSON.stringify

extension ShareJSON {
  /// `JSON.stringify(value)`(第 2・第 3 引数なし)。空白を入れず、`/` を逃がさず、非 ASCII は
  /// UTF-8 のまま書き、制御文字だけを小文字 16 進の `\u00xx` にする。
  var serialized: String {
    var out = ""
    write(into: &out)
    return out
  }

  private func write(into out: inout String) {
    switch self {
    case .string(let value): ShareJSON.writeString(value, into: &out)
    case .number(let value): out += JSText.numberString(value)
    case .bool(let value): out += value ? "true" : "false"
    case .null: out += "null"
    case .array(let values):
      out += "["
      for (index, value) in values.enumerated() {
        if index > 0 { out += "," }
        value.write(into: &out)
      }
      out += "]"
    case .object(let object):
      out += "{"
      for (index, entry) in object.entries.enumerated() {
        if index > 0 { out += "," }
        ShareJSON.writeString(entry.key, into: &out)
        out += ":"
        entry.value.write(into: &out)
      }
      out += "}"
    }
  }

  /// `QuoteJSONString`(ECMA-262)。`"` と `\` と C0 制御文字だけが逃げる —— `/` も
  /// U+2028/U+2029 も非 ASCII もそのまま(JS の**文字列リテラル**とは違い、`JSON.stringify` は
  /// 行区切りを逃がさない)。Swift の `String` に単独のサロゲートは存在しないので、
  /// ECMA-262 の孤立サロゲート規則(`\udXXX`)に相当する枝は現れない。
  private static func writeString(_ value: String, into out: inout String) {
    out += "\""
    for scalar in value.unicodeScalars {
      switch scalar {
      case "\"": out += "\\\""
      case "\\": out += "\\\\"
      case "\u{08}": out += "\\b"
      case "\u{09}": out += "\\t"
      case "\u{0A}": out += "\\n"
      case "\u{0C}": out += "\\f"
      case "\u{0D}": out += "\\r"
      default:
        if scalar.value < 0x20 {
          out += String(format: "\\u%04x", scalar.value)
        } else {
          out.unicodeScalars.append(scalar)
        }
      }
    }
    out += "\""
  }
}

// MARK: - JSON.parse

extension ShareJSON {
  /// `JSON.parse(text)`。受け付ける文法は RFC 8259 = ECMA-262 の JSON 文法そのもので、
  /// 失敗は例外ではなく `nil`(呼び出し側の `try { } catch { return null }` に対応)。
  static func parse(_ text: String) -> ShareJSON? {
    var parser = Parser(scalars: Array(text.unicodeScalars))
    parser.skipWhitespace()
    guard let value = parser.parseValue() else { return nil }
    parser.skipWhitespace()
    guard parser.isAtEnd else { return nil }
    return value
  }

  private struct Parser {
    let scalars: [Unicode.Scalar]
    var index = 0
    private var depth = 0

    /// 入れ子の上限。共有される荷物のいちばん深いところ(`resolutionOverrides` の要素)でも 3 で、
    /// 敵意ある `#t=` は `[[[[…` だけで作れる。JS の `JSON.parse` も実装の再帰上限に当たると
    /// `RangeError` を投げ、呼び出し側の `catch` が `null` を返す —— 落ちるより、読めないと
    /// 言うほうが同じ振る舞いに近い。
    static let maxDepth = 512

    init(scalars: [Unicode.Scalar]) {
      self.scalars = scalars
    }

    var isAtEnd: Bool { index >= scalars.count }
    private var current: Unicode.Scalar? { index < scalars.count ? scalars[index] : nil }

    /// JSON の空白は 4 種類だけ(空白・水平タブ・改行・復帰)。
    mutating func skipWhitespace() {
      while let scalar = current, scalar == " " || scalar == "\t" || scalar == "\n" || scalar == "\r" {
        index += 1
      }
    }

    mutating func parseValue() -> ShareJSON? {
      guard let scalar = current else { return nil }
      switch scalar {
      case "{", "[":
        guard depth < Parser.maxDepth else { return nil }
        depth += 1
        defer { depth -= 1 }
        return scalar == "{" ? parseObject() : parseArray()
      case "\"": return parseString().map(ShareJSON.string)
      case "t": return literal("true") ? .bool(true) : nil
      case "f": return literal("false") ? .bool(false) : nil
      case "n": return literal("null") ? ShareJSON.null : nil
      default: return parseNumber()
      }
    }

    private mutating func literal(_ word: String) -> Bool {
      for scalar in word.unicodeScalars {
        guard current == scalar else { return false }
        index += 1
      }
      return true
    }

    private mutating func parseObject() -> ShareJSON? {
      index += 1  // "{"
      var object = ShareJSONObject()
      skipWhitespace()
      if current == "}" {
        index += 1
        return .object(object)
      }
      while true {
        skipWhitespace()
        guard current == "\"", let key = parseString() else { return nil }
        skipWhitespace()
        guard current == ":" else { return nil }
        index += 1
        skipWhitespace()
        guard let value = parseValue() else { return nil }
        // 重複した鍵は JS でも「後の値が、最初に現れた位置に」入る。
        object[key] = value
        skipWhitespace()
        if current == "," {
          index += 1
          continue
        }
        guard current == "}" else { return nil }
        index += 1
        return .object(object.jsOrdered())
      }
    }

    private mutating func parseArray() -> ShareJSON? {
      index += 1  // "["
      var values: [ShareJSON] = []
      skipWhitespace()
      if current == "]" {
        index += 1
        return .array(values)
      }
      while true {
        skipWhitespace()
        guard let value = parseValue() else { return nil }
        values.append(value)
        skipWhitespace()
        if current == "," {
          index += 1
          continue
        }
        guard current == "]" else { return nil }
        index += 1
        return .array(values)
      }
    }

    /// 文字列は UTF-16 コード単位で組み立てる —— `👍` のような代用対を、JS と同じく
    /// 「2 つのエスケープが 1 つの文字になる」形で受けるため。
    private mutating func parseString() -> String? {
      index += 1  // 開きの引用符
      var units: [UInt16] = []
      while let scalar = current {
        if scalar == "\"" {
          index += 1
          return String(decoding: units, as: UTF16.self)
        }
        if scalar == "\\" {
          index += 1
          guard let escape = current else { return nil }
          index += 1
          switch escape {
          case "\"": units.append(0x22)
          case "\\": units.append(0x5C)
          case "/": units.append(0x2F)
          case "b": units.append(0x08)
          case "f": units.append(0x0C)
          case "n": units.append(0x0A)
          case "r": units.append(0x0D)
          case "t": units.append(0x09)
          case "u":
            guard let unit = parseHexQuad() else { return nil }
            units.append(unit)
          default: return nil
          }
          continue
        }
        // 生の制御文字は JSON では文字列に書けない。
        if scalar.value < 0x20 { return nil }
        units.append(contentsOf: Array(String(scalar).utf16))
        index += 1
      }
      return nil
    }

    private mutating func parseHexQuad() -> UInt16? {
      var value: UInt16 = 0
      for _ in 0..<4 {
        guard let scalar = current, let digit = scalar.hexDigitValue16 else { return nil }
        value = value << 4 | digit
        index += 1
      }
      return value
    }

    /// JSON の数の文法(`-? int frac? exp?`)を検査してから `Double` に渡す。Swift の
    /// `Double(String)` は JS の `StringNumericLiteral` と同じく最近接偶数丸めで、同じ 10 進表記
    /// からは同じ 2 進値が出る。
    private mutating func parseNumber() -> ShareJSON? {
      let start = index
      if current == "-" { index += 1 }
      guard let first = current, first >= "0", first <= "9" else { return nil }
      if first == "0" {
        index += 1
      } else {
        while let scalar = current, scalar >= "0", scalar <= "9" { index += 1 }
      }
      if current == "." {
        index += 1
        guard let scalar = current, scalar >= "0", scalar <= "9" else { return nil }
        while let scalar = current, scalar >= "0", scalar <= "9" { index += 1 }
      }
      if current == "e" || current == "E" {
        index += 1
        if current == "+" || current == "-" { index += 1 }
        guard let scalar = current, scalar >= "0", scalar <= "9" else { return nil }
        while let scalar = current, scalar >= "0", scalar <= "9" { index += 1 }
      }
      let text = String(String.UnicodeScalarView(scalars[start..<index]))
      guard let value = Double(text) else { return nil }
      return .number(value)
    }
  }
}

private extension Unicode.Scalar {
  var hexDigitValue16: UInt16? {
    switch self {
    case "0"..."9": return UInt16(value - 0x30)
    case "a"..."f": return UInt16(value - 0x61 + 10)
    case "A"..."F": return UInt16(value - 0x41 + 10)
    default: return nil
    }
  }
}


// MARK: - base64url

/// `lib/share-link.ts:82-94` の `toBase64Url` / `fromBase64Url`。
enum ShareBase64URL {
  private static let alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  private static let positionByUnit: [UInt16: Int] =
    Dictionary(uniqueKeysWithValues: Array(alphabet.utf16).enumerated().map { ($0.element, $0.offset) })

  /// `btoa(...)` を `+`→`-`、`/`→`_`、末尾の `=` 落としに直したもの。
  static func encode(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  /// `atob(value.replace(...).padEnd(...))`。`atob` は WHATWG の forgiving-base64 で、
  /// 桁数が 4 で割って 1 余る入力と、字母の外の文字を**拒む**(例外 → 呼び出し側では `null`)。
  /// `Data(base64Encoded:)` は取りこぼす端(過剰なパディングなど)があるので、手で書く。
  ///
  /// 数えるのは **UTF-16 コード単位**で、`Character`(書記素)ではない。`padEnd` が見るのは
  /// JS の `String.prototype.length` だし、何より `"\r\n"` は Swift では 1 つの `Character` に
  /// なるので、書記素で捨てようとすると `atob` が捨てる 2 文字を取りこぼす。
  static func decode(_ value: String) -> Data? {
    var units = Array(value.utf16).map { unit -> UInt16 in
      switch unit {
      case 0x2D: return 0x2B  // "-" → "+"
      case 0x5F: return 0x2F  // "_" → "/"
      default: return unit
      }
    }
    // `padEnd(Math.ceil(value.length / 4) * 4, "=")`
    let padded = (units.count + 3) / 4 * 4
    units.append(contentsOf: Array(repeating: UInt16(0x3D), count: padded - units.count))

    // atob: まず ASCII 空白(TAB LF FF CR SPACE)を捨てる。
    units.removeAll { $0 == 0x20 || $0 == 0x09 || $0 == 0x0A || $0 == 0x0C || $0 == 0x0D }
    // 末尾の `=` を最大 2 つまで落とす。
    if units.count % 4 == 0 {
      var removable = 2
      while removable > 0, units.last == 0x3D {
        units.removeLast()
        removable -= 1
      }
    }
    if units.count % 4 == 1 { return nil }

    var bits = 0
    var accumulator = 0
    var bytes: [UInt8] = []
    for unit in units {
      guard let position = positionByUnit[unit] else { return nil }
      accumulator = accumulator << 6 | position
      bits += 6
      if bits >= 8 {
        bits -= 8
        bytes.append(UInt8((accumulator >> bits) & 0xFF))
      }
    }
    // 余った 2 ないし 4 ビットは捨てる(atob と同じ)。
    return Data(bytes)
  }
}
