import Foundation
import Testing
@testable import TripCheckKit

/*
 * Kit と端末の境目の見張り。
 *
 * 全体規約:Kit のソースが import してよいのは `Foundation` だけ(UIKit / SwiftUI / MapKit /
 * CoreLocation は端末側の都合で、エンジンには持ち込まない)。ここはソースそのものを読む数少ない
 * テストなので、同じ性質の見張りが増えたらこのファイルに足す。
 */

/// パッケージの根(`…/Packages/TripCheckKit`)。`#filePath` は
/// `…/Tests/TripCheckKitTests/Invariants/ImportBoundaryTests.swift`。
private func packageRoot(from filePath: String = #filePath) -> URL {
  URL(fileURLWithPath: filePath)
    .deletingLastPathComponent()   // …/Invariants
    .deletingLastPathComponent()   // …/TripCheckKitTests
    .deletingLastPathComponent()   // …/Tests
    .deletingLastPathComponent()   // …/TripCheckKit
}

@Test func kitSourcesImportFoundationOnly() throws {
  let sources = packageRoot().appendingPathComponent("Sources/TripCheckKit", isDirectory: true)
  // ソースの無い場所(配布されたバイナリなど)で走らせたときは何も言わない。
  guard FileManager.default.fileExists(atPath: sources.path) else { return }

  let walker = try #require(FileManager.default.enumerator(at: sources, includingPropertiesForKeys: nil))
  var scanned = 0
  for case let url as URL in walker where url.pathExtension == "swift" {
    scanned += 1
    let text = try String(contentsOf: url, encoding: .utf8)
    for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      guard trimmed.hasPrefix("import ") else { continue }
      #expect(trimmed == "import Foundation", "\(url.lastPathComponent) imports more than Foundation: \(trimmed)")
    }
  }
  #expect(scanned >= 60, "the walk must actually reach the Kit's sources")
}

/// spec §5.1 —— 画面の状態(選択中の日・開いているシート・トースト)はアプリ側の持ち物で、
/// **`PlannerViewState` を受け取る Kit API は存在しない**。エンジンへ渡せるのは `request` と
/// `edit` から作る `TripRequest` だけ、という約束を型の外側からも見張る。
///
/// 型そのものがまだ無い今は「その名前が Kit のソースに現れない」ことが検査できる全てだが、Plan 2
/// でアプリを書き始めたときに、うっかりこちら側へ引き入れる手が最初に当たるのはここになる。
@Test func noViewStateTypeExistsInKit() throws {
  let sources = packageRoot().appendingPathComponent("Sources/TripCheckKit", isDirectory: true)
  guard FileManager.default.fileExists(atPath: sources.path) else { return }

  let walker = try #require(FileManager.default.enumerator(at: sources, includingPropertiesForKeys: nil))
  var scanned = 0
  for case let url as URL in walker where url.pathExtension == "swift" {
    scanned += 1
    let text = try String(contentsOf: url, encoding: .utf8)
    #expect(!text.contains("PlannerViewState"), "\(url.lastPathComponent) names the app's view state")
  }
  #expect(scanned >= 60, "the walk must actually reach the Kit's sources")
}
