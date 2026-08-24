import Foundation
import Testing
@testable import TripCheckAppCore
import TripCheckKit

// 成功:表記が決定的パーサを通ってフォームの値になり、行き先が返る。
@Test @MainActor func aParsedIntentFillsTheStartForm() async {
  let parser = FakeIntentParser(outcome: .parsed(TripIntent(
    destination: "金沢", durationText: "2泊", whenText: "10月3日から", wishes: ["海鮮", "21世紀美術館"])))
  let store = PlannerStore(resolvers: [], store: nil, intentParser: parser)
  let query = await store.readTripIntent(
    from: "10月3日から2泊で金沢", now: ISO8601DateFormatter().date(from: "2026-08-24T09:00:00+09:00")!)
  #expect(query == "金沢")
  #expect(store.request.tripDays == 3)
  #expect(store.request.tripStartDate == "2026-10-03")
  #expect(store.request.entries.map(\.text) == ["海鮮", "21世紀美術館"])
  #expect(store.intentPhase == .idle)
  #expect(store.view.toast?.text == AppCopy.for(store.request.locale).intentApplied)
}

// intent に無い欄は触らない:フォーム既定(tripDays=3・日付なし)がそのまま残る。
@Test @MainActor func missingFieldsNeverClobberTheForm() async {
  let parser = FakeIntentParser(outcome: .parsed(TripIntent(
    destination: "", durationText: "", whenText: "9月", wishes: ["温泉"])))
  let store = PlannerStore(resolvers: [], store: nil, intentParser: parser)
  store.request.tripDays = 5
  let query = await store.readTripIntent(from: "9月に温泉に行きたい")
  #expect(query == "")           // 行き先なし → 検索欄は空に戻す
  #expect(store.request.tripDays == 5)
  #expect(store.request.tripStartDate == nil)   // 「9月」は日付未定のまま
  #expect(store.request.entries.map(\.text) == ["温泉"])
}

// 重複(大文字小文字・空白違い)はスキップ、12件上限は残り枠だけ。
@Test @MainActor func wishesDedupeAndRespectThePlaceLimit() async {
  let parser = FakeIntentParser(outcome: .parsed(TripIntent(
    destination: "", durationText: "", whenText: "",
    wishes: ["Louvre", " louvre ", "海鮮", "海鮮", "凱旋門"])))
  let store = PlannerStore(resolvers: [], store: nil, intentParser: parser)
  for i in 1...10 { _ = store.addEntrySync(text: "場所\(i)") }
  _ = store.addEntrySync(text: "louvre")
  _ = await store.readTripIntent(from: "美術館めぐりがしたい")
  // 既存11件+新規1件(Louvre は既存と重複、海鮮が1枠、凱旋門は上限落ち)。
  #expect(store.request.entries.count == 12)
  #expect(store.request.entries.last?.text == "海鮮")
}

// 失敗:フォームは無傷、phase だけ .failed。新しい入力で消える。
@Test @MainActor func aFailedParseLeavesTheFormAloneAndFlagsTheRow() async {
  let store = PlannerStore(resolvers: [], store: nil, intentParser: FakeIntentParser(outcome: .failed))
  let query = await store.readTripIntent(from: "9月に2泊で金沢")
  #expect(query == nil)
  #expect(store.request.entries.isEmpty)
  #expect(store.intentPhase == .failed)
  store.intentQueryChanged()
  #expect(store.intentPhase == .idle)
}

// 読みかけ中に入力が変わったら、答えは捨てる(遅れて着いた答えがフォームを汚さない)。
@Test(.timeLimit(.minutes(2))) @MainActor func aStaleAnswerNeverLandsOnTheForm() async {
  let latch = IntentLatch()
  let store = PlannerStore(resolvers: [], store: nil, intentParser: LatchedIntentParser(latch: latch))
  async let result = store.readTripIntent(from: "9月に2泊で金沢")
  await latch.waitUntilCalled()
  store.intentQueryChanged()     // ユーザーが入力を変えた
  await latch.release()
  #expect(await result == nil)
  #expect(store.request.entries.isEmpty)
  #expect(store.intentPhase == .idle)
}

// 読取中に構築へ進んだら、遅れて着いた答えは捨てられる(Start を CTA で離れたら、
// 進行中の自由文パースを次の画面へ持ち越さない)。
@Test(.timeLimit(.minutes(2))) @MainActor func leavingStartViaTheBuildCTADropsAnInFlightIntentParse() async {
  let latch = IntentLatch()
  let store = PlannerStore(resolvers: [], store: nil, intentParser: LatchedIntentParser(latch: latch))
  store.addEntrySync(text: "Bern")
  async let result = store.readTripIntent(from: "9月に2泊で金沢")
  await latch.waitUntilCalled()
  _ = await store.requestBuildFromStart()
  await latch.release()
  #expect(await result == nil)
  #expect(store.request.entries.map(\.text) == ["Bern"])   // 遅い答えの行は足されない
  #expect(store.intentPhase == .idle)
}

// Undo トーストが出ている間は譲る(実経路 T6 の規律)。
@Test @MainActor func anUndoToastIsNeverClobberedByTheIntentToast() async {
  let parser = FakeIntentParser(outcome: .parsed(TripIntent(
    destination: "金沢", durationText: "", whenText: "", wishes: [])))
  let store = PlannerStore(resolvers: [], store: nil, intentParser: parser)
  let undo = Toast(text: "戻せます", kind: .edit, canUndo: true)
  store.view.toast = undo
  _ = await store.readTripIntent(from: "金沢に行きたい")
  #expect(store.view.toast == undo)
}

// 行の可視条件:parser の有無 × 文らしさ × phase。
@Test @MainActor func theRowShowsForSentencesAndWhileBusyOrFailed() {
  let store = PlannerStore(resolvers: [], store: nil, intentParser: FakeIntentParser())
  #expect(store.intentRowVisible(for: "9月に2泊で金沢に行きたい"))
  #expect(!store.intentRowVisible(for: "金沢"))
  store.intentPhase = .failed
  #expect(store.intentRowVisible(for: "金沢"))   // 失敗表示は入力が変わるまで残る
  let bare = PlannerStore(resolvers: [], store: nil)
  #expect(!bare.intentRowVisible(for: "9月に2泊で金沢に行きたい"))
}

// prewarm は一度だけ。
@Test @MainActor func prewarmHappensOnce() {
  let store = PlannerStore(resolvers: [], store: nil, intentParser: FakeIntentParser())
  store.prewarmIntentIfNeeded()
  store.prewarmIntentIfNeeded()
  #expect(store.intentPrewarmed)
}
