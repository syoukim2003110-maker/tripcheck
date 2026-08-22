import Testing
@testable import TripCheckAppCore
import TripCheckKit

/*
 * 検索窓の候補。端末の地図(`MKLocalSearchCompleter`)は `SuggestionCompleting` の後ろに
 * いるので、ここで走るのは全部フェイク —— `swift test` は macOS で走り、Apple には一度も
 * 尋ねない。見ているのは「いつ尋ねるか」の規則そのものである。
 *
 * **待ち方**: 「尋ねた」ことは実時計ではなく `waitUntil` で待つ(この suite は 594 本を
 * 並列で回すので、固定の `sleep` は機械の忙しさで答えが変わる)。逆に「尋ねない」ことは
 * 待たずに確かめられる —— 2 文字未満とキャッシュ命中は `schedule()` が同期で片付けるので、
 * 代入した次の行でもう答えが出ている。
 */

/// 尋ねるたびに失敗する端末。`state` が `.unavailable` に落ちても、入力欄は使えたままで
/// なければならない(旅行者は打った名前をそのまま足せる)。
@MainActor private final class FailingCompleter: SuggestionCompleting {
  struct Unavailable: Error {}
  var calls = 0
  func complete(_ query: String, region: GeoBounds?) async throws -> [PlaceSuggestion] {
    calls += 1
    throw Unavailable()
  }
}

/// 条件が満たされるまで待つ。満たされた瞬間に戻るので、遅い機械でも速い機械でも同じ答え。
@MainActor private func waitUntil(_ condition: () -> Bool) async throws {
  var spins = 0
  while !condition(), spins < 2_000 {
    try await Task.sleep(for: .milliseconds(1))
    spins += 1
  }
}

/// 「`calls` 回尋ねて、その答えが画面に入った」ところまで待つ。`ready` まで待つのは、
/// 答えを覚える(キャッシュに入れる)のがその直前だから。
@MainActor private func settle(_ suggestions: AppleSuggestions, calls: Int, on fake: FakeCompleter) async throws {
  try await waitUntil { fake.calls == calls && suggestions.state == .ready }
}

@Test @MainActor func suggestionsWaitForTwoCharsAndDebounce() async throws {
  let fake = FakeCompleter()
  let s = AppleSuggestions(debounce: .milliseconds(10), completer: fake)

  s.query = "S"
  #expect(fake.calls == 0)          // 2 文字未満は尋ねる予定すら立てない
  #expect(s.state == .idle)

  s.query = "Se"
  try await settle(s, calls: 1, on: fake)
  #expect(fake.calls == 1)

  // 続けて打った途中の "Sen" は潰れる —— 2 つの代入の間に中断点が無いので、"Sen" の
  // タスクは一度も走らないまま取り消される。
  s.query = "Sen"; s.query = "Sens"
  try await settle(s, calls: 2, on: fake)
  #expect(fake.calls == 2)
}

/// 1 文字に戻したら、前の候補は消える。消さないと「Se」の候補が「S」の答えとして残る。
@Test @MainActor func shorteningTheQueryClearsTheOldSuggestions() async throws {
  let fake = FakeCompleter()
  let s = AppleSuggestions(debounce: .milliseconds(10), completer: fake)
  s.query = "Se"
  try await settle(s, calls: 1, on: fake)

  s.query = "S"
  #expect(fake.calls == 1)          // 2 文字未満は尋ねない
  #expect(s.results.isEmpty)
  #expect(s.state == .idle)
}

/// 同じ文字列をもう一度打ったら、端末には尋ねない。打ち直し(1 文字消して戻す)は
/// よくある動きで、そのたびに地図へ尋ねると候補が点滅する。
@Test @MainActor func askingTheSameQueryTwiceIsAnsweredFromTheCache() async throws {
  let fake = FakeCompleter()
  let s = AppleSuggestions(debounce: .milliseconds(10), completer: fake)
  s.query = "Bern"
  try await settle(s, calls: 1, on: fake)
  s.query = "Ber"
  try await settle(s, calls: 2, on: fake)

  s.query = "Bern"
  #expect(fake.calls == 2)          // 覚えているので、待たずにその場で答えが出る
  #expect(s.state == .ready)
}

/// 行き先の国を選ぶと探す箱が変わるので、同じ文字列でも尋ね直す —— キャッシュの鍵は
/// (文字列, 箱)。ここを文字列だけにすると、国を選んだのに候補が変わらない。
@Test @MainActor func choosingACountryMakesTheSameQueryAskAgain() async throws {
  let fake = FakeCompleter()
  let s = AppleSuggestions(debounce: .milliseconds(10), completer: fake)
  s.query = "Bern"
  try await settle(s, calls: 1, on: fake)

  s.setRegion(Destinations.byId(.switzerland).bounds)
  try await settle(s, calls: 2, on: fake)
  #expect(fake.calls == 2)
}

/// 端末が答えられないときは候補を消して `.unavailable` を出すだけ。打った名前で進める道は
/// 塞がない(`PlaceSearchField` は Return でそのまま足せる)。
@Test @MainActor func aCompleterThatFailsLeavesTheFieldUsable() async throws {
  let failing = FailingCompleter()
  let s = AppleSuggestions(debounce: .milliseconds(10), completer: failing)
  s.query = "Bern"
  try await waitUntil { s.state == .unavailable }

  #expect(failing.calls == 1)
  #expect(s.state == .unavailable)
  #expect(s.results.isEmpty)
}

/// キャッシュは無限には持たない。60 件を超えたら古いものから捨てる —— 捨てた鍵は
/// もう一度尋ねに行き、残っている鍵はその場で答える。
@Test @MainActor func theCacheForgetsItsOldestEntries() async throws {
  let fake = FakeCompleter()
  let s = AppleSuggestions(debounce: .milliseconds(1), completer: fake)
  for index in 0..<(AppleSuggestions.cacheLimit + 1) {
    s.query = "q\(index)"
    try await settle(s, calls: index + 1, on: fake)
  }
  #expect(fake.calls == AppleSuggestions.cacheLimit + 1)

  s.query = "q0"                                 // いちばん古い = もう覚えていない
  try await settle(s, calls: AppleSuggestions.cacheLimit + 2, on: fake)
  #expect(fake.calls == AppleSuggestions.cacheLimit + 2)

  s.query = "q\(AppleSuggestions.cacheLimit)"    // いちばん新しい = 覚えている
  #expect(fake.calls == AppleSuggestions.cacheLimit + 2)
  #expect(s.state == .ready)
}
