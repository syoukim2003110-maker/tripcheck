import Foundation

/// Swift のソースを、コメント・地の文・文字列リテラルの 3 つに切り分けるだけの走査
/// (`CopyBoundaryTests` が読む)。扱うのはこの木に実際に出てくる形だけ ——
/// `//`・`/* */`(入れ子)・`"…"`(`\"` の逃がしと `\(…)` の差し込み、その中の文字列も)。
///
/// 素朴に正規表現でやると **`ApplePlaceResolver` の 1 行で崩れる**:
/// `"apple-\(query.inputIndex)-\(FNV1a.hash32("\(hit.name)|…"))"` は差し込みの中に別の
/// 文字列を持っていて、引用符を数えるだけの読み手はそこで文字列と地の文を取り違える ——
/// 以降のファイル全体が「文字列の中」に見え、走査は何も見つけないまま緑を返す。
enum SwiftSource {

  /// 文字列リテラル 1 つ。`context` は開き引用符の直前にあった地の文(末尾 64 文字)で、
  /// その文字列が**何のために書かれたか**を言い当てるのに使う。
  struct Literal {
    let text: String
    let context: String

    /// 正規表現の素。文ではなく文法なので、日本語が入っていても文言の表には移せない。
    var isRegexSource: Bool { context.hasSuffix("JSRegex(") }
  }

  /// コメントを空白に置き換えたソース(行は動かさない)。
  static func withoutComments(_ text: String) -> String {
    var output = ""
    scan(text, onCode: { output.append($0) }, onComment: { output.append($0.isNewline ? $0 : " ") })
    return output
  }

  /// 文字列リテラルの中身(引用符と差し込みは除く)。差し込みの中の文字列も 1 本と数える。
  static func stringLiterals(_ text: String) -> [Literal] {
    var found: [Literal] = []
    var open: [(body: String, context: String)] = []
    scan(
      text,
      onCode: { _ in },
      onComment: { _ in },
      onLiteralStart: { context in open.append((body: "", context: context)) },
      onLiteral: { piece in
        guard !open.isEmpty else { return }
        open[open.count - 1].body += piece
      },
      onLiteralEnd: {
        guard let done = open.popLast() else { return }
        if !done.body.isEmpty { found.append(Literal(text: done.body, context: done.context)) }
      }
    )
    return found
  }

  /// いま読んでいる場所。
  private enum Where {
    case string
    /// `\(…)` の中。数えているのは、閉じ括弧が差し込みの終わりか式の一部かを見分けるための
    /// 括弧の深さ。
    case interpolation(depth: Int)
  }

  /// 1 文字ずつの走査。
  private static func scan(
    _ text: String,
    onCode: (Character) -> Void,
    onComment: (Character) -> Void,
    onLiteralStart: (String) -> Void = { _ in },
    onLiteral: (String) -> Void = { _ in },
    onLiteralEnd: () -> Void = {}
  ) {
    let characters = Array(text)
    var index = 0
    var stack: [Where] = []
    /// 直前の地の文(末尾 64 文字)。開き引用符のときにリテラルへ渡す。
    var trailingCode = ""

    func code(_ character: Character) {
      onCode(character)
      trailingCode.append(character)
      if trailingCode.count > 64 { trailingCode.removeFirst(trailingCode.count - 64) }
    }

    func peek(_ offset: Int) -> Character? {
      let position = index + offset
      return position < characters.count ? characters[position] : nil
    }

    while index < characters.count {
      let character = characters[index]

      if case .string = stack.last {
        if character == "\\", peek(1) == "(" {
          onLiteral(" ")                       // 差し込みは中身ではない
          stack.append(.interpolation(depth: 0))
          index += 2
          continue
        }
        if character == "\\" {                  // `\"` `\\` `\n` …
          let unescaped = peek(1).map { escaped($0) } ?? " "
          onLiteral(String(unescaped))
          code(unescaped)
          index += 2
          continue
        }
        if character == "\"" {
          stack.removeLast()
          onLiteralEnd()
          code("\"")
          index += 1
          continue
        }
        onLiteral(String(character))
        code(character)
        index += 1
        continue
      }

      if character == "/", peek(1) == "/" {
        while index < characters.count, characters[index] != "\n" {
          onComment(characters[index])
          index += 1
        }
        continue
      }

      if character == "/", peek(1) == "*" {
        var depth = 0
        while index < characters.count {
          if characters[index] == "/", peek(1) == "*" {
            depth += 1; onComment(" "); onComment(" "); index += 2; continue
          }
          if characters[index] == "*", peek(1) == "/" {
            depth -= 1; onComment(" "); onComment(" "); index += 2
            if depth == 0 { break }
            continue
          }
          onComment(characters[index])
          index += 1
        }
        continue
      }

      if character == "\"" {
        onLiteralStart(trailingCode)
        stack.append(.string)
        code("\"")
        index += 1
        continue
      }

      if case .interpolation(let depth) = stack.last {
        if character == "(" {
          stack[stack.count - 1] = .interpolation(depth: depth + 1)
        } else if character == ")" {
          if depth == 0 {
            stack.removeLast()                 // 差し込みが閉じ、外の文字列へ戻る
            code(")")
            index += 1
            continue
          }
          stack[stack.count - 1] = .interpolation(depth: depth - 1)
        }
      }

      code(character)
      index += 1
    }

    // 閉じていないリテラルも取りこぼさない(壊れたソースでも読めたところまでを返す)。
    while case .some(.string) = stack.last {
      stack.removeLast()
      onLiteralEnd()
    }
  }

  /// 逃がした 1 文字。`\n` は改行そのものではなく空白に畳む —— リテラルの中身として読む
  /// ぶんには、そこに何かが在ったことだけ分かればよい。
  private static func escaped(_ character: Character) -> Character {
    switch character {
    case "n", "t", "r", "0": " "
    default: character
    }
  }
}
