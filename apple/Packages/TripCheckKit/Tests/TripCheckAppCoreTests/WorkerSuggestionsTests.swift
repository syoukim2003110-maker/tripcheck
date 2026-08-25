import Testing
@testable import TripCheckAppCore
import TripCheckKit

/// 1 メソッドだけのフェイク。`nil` は失敗/タイムアウト(覚えない)、`[]`/中身は確定答(覚える)。
@MainActor private final class FakeSuggesting: PlaceSuggesting {
  var calls = 0
  var lastQuery: String?
  var lastDestination: String?
  var lastLanguage: String?
  var answer: [WorkerPlaceSuggestion]?
  init(answer: [WorkerPlaceSuggestion]? = []) { self.answer = answer }
  func suggest(query: String, destination: String, languageCode: String) async -> [WorkerPlaceSuggestion]? {
    calls += 1
    lastQuery = query; lastDestination = destination; lastLanguage = languageCode
    return answer
  }
}

@MainActor private func waitUntil(_ condition: () -> Bool) async throws {
  var spins = 0
  while !condition(), spins < 2_000 {
    try await Task.sleep(for: .milliseconds(1))
    spins += 1
  }
}

private func row(_ id: String) -> WorkerPlaceSuggestion {
  WorkerPlaceSuggestion(providerRef: id, primaryText: id, secondaryText: "", fullText: id)
}

@Test @MainActor func belowThreeCharsNeverAsks() async {
  let fake = FakeSuggesting(answer: [row("p")])
  let s = WorkerSuggestions(debounce: .milliseconds(10), source: fake)
  s.query = "to"            // 2 文字 < 3:予定すら立てない(同期で片付く)
  #expect(fake.calls == 0)
  #expect(s.results.isEmpty)
}

@Test @MainActor func asksOnceAtThreeCharsAndCachesHit() async throws {
  let fake = FakeSuggesting(answer: [row("p")])
  let s = WorkerSuggestions(debounce: .milliseconds(10), source: fake)
  s.configure(destination: .auto, locale: .en)
  s.query = "tok"
  try await waitUntil { s.results.count == 1 }
  #expect(fake.calls == 1)
  #expect(fake.lastQuery == "tok")
  #expect(fake.lastLanguage == "en")
  s.query = "tokyo"
  try await waitUntil { fake.calls == 2 }
  s.query = "tok"                 // キャッシュ命中は同期で戻る
  #expect(s.results.count == 1)
  #expect(fake.calls == 2)        // 再問い合わせ無し
}

@Test @MainActor func failureIsNotCachedAndLeavesResultsEmpty() async throws {
  let fake = FakeSuggesting(answer: nil)   // 失敗/タイムアウトを模す
  let s = WorkerSuggestions(debounce: .milliseconds(10), source: fake)
  s.query = "tok"
  try await waitUntil { fake.calls == 1 }
  #expect(s.results.isEmpty)
  s.query = ""
  s.query = "tok"
  try await waitUntil { fake.calls == 2 }  // 覚えないので同じ文字列でも尋ね直す
  #expect(fake.calls == 2)
}

@Test @MainActor func changingLocaleReasks() async throws {
  let fake = FakeSuggesting(answer: [row("p")])
  let s = WorkerSuggestions(debounce: .milliseconds(10), source: fake)
  s.configure(destination: .auto, locale: .en)
  s.query = "tok"
  try await waitUntil { fake.calls == 1 }
  s.configure(destination: .auto, locale: .ja)
  try await waitUntil { fake.calls == 2 }
  #expect(fake.calls == 2)
  #expect(fake.lastLanguage == "ja")
}

@Test @MainActor func resetClearsQueryAndResults() async throws {
  let fake = FakeSuggesting(answer: [row("p")])
  let s = WorkerSuggestions(debounce: .milliseconds(10), source: fake)
  s.query = "tok"
  try await waitUntil { s.results.count == 1 }
  s.reset()
  #expect(s.query.isEmpty)
  #expect(s.results.isEmpty)
}
