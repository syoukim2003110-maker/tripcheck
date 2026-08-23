import Foundation
import Testing
import TripCheckKit
@testable import TripCheck

/*
 * 文言の境界。
 *
 * 旅行者が読む文は 1 か所にしか無い —— Kit の `PlannerCopy` / `VerdictCopy` /
 * `TimelinePresentation`、そのどれにも無いアプリ専用の文は `AppCopy`(AppCore)。ビューに
 * 直書きすると、日本語で書いた 1 行は英語に切り替えても日本語のまま残る。切り替えの錠剤は
 * Task 14 で足したので、その 1 行は**旅行者の目の前で**取り残される。
 *
 * だからここは目で見張るのをやめて、ソースそのものを読む:`apple/TripCheck` と AppCore の
 * `Sources` を歩き、文字列リテラルに日本語が居ないことと、`Text("…")` に長い文が直接
 * 座っていないことを見る。除くのは 2 つだけ —— `Design/`(色と字と絵の定数)と
 * `AppCopy.swift`(文言の表そのもの)。
 */

@Test func noViewFileContainsJapaneseSentenceLiterals() throws {
  let japanese = try JSRegex("[぀-ヿ㐀-鿿]")
  let inline = try JSRegex("Text\\(\"([^\"]{12,})\"\\)")
  var scanned = 0

  for file in try SwiftSources.underScan() {
    scanned += 1

    for literal in SwiftSource.stringLiterals(file.text) where japanese.test(literal.text) {
      // 正規表現は文ではなく**文法**である。日本の住所を切る `AppleAddress` の 2 本
      //(「北海道|東京都|…県」と「^[^\s,、市区町村]{1,8}[市区町村]」)は旅行者に見せる語では
      // なく、MapKit が返した住所の形なので、文言の表には置けない。
      guard !literal.isRegexSource else { continue }
      Issue.record("\(file.name): 日本語のリテラル \"\(literal.text)\" —— AppCopy へ移すか Kit の Copy 鍵を使う")
    }

    for match in inline.matches(in: SwiftSource.withoutComments(file.text)) {
      Issue.record("\(file.name): inline Text literal \(match.groups[0] ?? "")")
    }
  }

  #expect(scanned > 20)
}

/// `AppCopy` の ja/en 表が `BannedTerms` を通ることは AppCore の
/// `appCopyPassesBannedTermsInBothLanguages` が押さえている。こちらが見るのは**その表の外**
/// —— アプリと AppCore のソースに書かれた文字列リテラルに、社内語が紛れていないこと。
///
/// リテラルだけを読むのは、禁止語そのものが**なぜ禁止なのかを説明するコメント**の中に
/// 現れるからである(Kit の `BannedTerms.swift` の見出しがそう書いてある)。コメントごと
/// 落とすと、説明を書いたファイルが自分の説明で赤くなる。
@Test func noSourceLiteralUsesABannedTerm() throws {
  var checked = 0
  for file in try SwiftSources.underScan(includingAppCopy: true) {
    for literal in SwiftSource.stringLiterals(file.text) {
      checked += 1
      #expect(BannedTerms.violations(in: literal.text).isEmpty, "\(file.name): \(literal.text)")
    }
  }
  #expect(checked > 500)
}

/// 走査が本当に読んでいることを、走査そのものに対して確かめる。この 1 本が無いと、上の
/// 2 つは「1 件も見つからなかった」と「1 文字も読まなかった」を同じ緑で返す。
@Test func theScanReadsLiteralsAndIgnoresComments() throws {
  let japanese = try JSRegex("[぀-ヿ㐀-鿿]")
  let inline = try JSRegex("Text\\(\"([^\"]{12,})\"\\)")

  let planted = """
  // 「元に戻す」はトーストに乗る —— この行は文言ではない
  struct Bad: View {
    var body: some View { Text("この行は文言の表の外に居ます") }
  }
  """
  let literals = SwiftSource.stringLiterals(planted)
  #expect(literals.map(\.text) == ["この行は文言の表の外に居ます"])
  #expect(japanese.test(literals[0].text))
  #expect(!literals[0].isRegexSource)
  #expect(!inline.matches(in: SwiftSource.withoutComments(planted)).isEmpty)
  // コメントの中の日本語はリテラルではないし、剥がした後の地の文にも残らない。
  #expect(!japanese.test(SwiftSource.withoutComments(planted)
    .replacingOccurrences(of: "この行は文言の表の外に居ます", with: "")))

  // 正規表現の出どころは見分けられる。
  let grammar = "private static let p = try! JSRegex(\"^[市区町村]\")"
  #expect(SwiftSource.stringLiterals(grammar).allSatisfy { $0.isRegexSource })

  // 差し込みの中の文字列で崩れない(`ApplePlaceResolver` の id はこの形)。
  let nested = "let id = \"apple-\\(index)-\\(hash(\"\\(name)|\\(lat)\"))\""
  #expect(SwiftSource.stringLiterals(nested).count == 2)
  // 禁止語の検査そのものが効いている(この token 自体はテストのソースにも書かない ——
  // 「実」で始まる 2 字の語は `BannedTerms.rules` の 1 本目が持っている)。
  #expect(BannedTerms.violations(in: "この日の判定保留は解けていません").count == 1)
}

// MARK: - 走る場所

private enum SwiftSources {
  struct File { let name: String; let text: String }

  /// `apple/TripCheckTests/CopyBoundaryTests.swift` から 2 つ上がると `apple/`。
  static var apple: URL {
    URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
  }

  static func underScan(includingAppCopy: Bool = false) throws -> [File] {
    let roots = [
      apple.appendingPathComponent("TripCheck"),
      apple.appendingPathComponent("Packages/TripCheckKit/Sources/TripCheckAppCore"),
    ]
    var files: [File] = []
    for root in roots {
      for path in try FileManager.default.subpathsOfDirectory(atPath: root.path).sorted()
      where path.hasSuffix(".swift")
        && !path.contains("Design/")
        && (includingAppCopy || !path.hasSuffix("AppCopy.swift")) {
        files.append(File(
          name: path,
          text: try String(contentsOf: root.appendingPathComponent(path), encoding: .utf8)
        ))
      }
    }
    return files
  }
}
