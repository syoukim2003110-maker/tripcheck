import Foundation
import Testing
@testable import TripCheckKit

/*
 * `lib/planner-history.ts`(151 行)と `lib/planner-app-state.ts:64-111, :190-226, :457-527` の
 * 移植テスト。ブリーフはテストファイルを 2 つしか挙げていないので、`PlannerEditState` と
 * `ResolutionOverride` の単体もここに置く(どちらも「Undo の単位」を作る部品)。
 *
 * 移植しない TS の 1 本:`tests/planner-history.test.ts:116-125`
 * (「意味を失わずに直列化できない状態を拒む」)。`cloneSerializableValue` は JSON になる値だけを
 * 通すための実行時ガードで、Swift では `State: Equatable & Sendable` の値型がその役目を型で果たす
 * (関数・Date・循環参照・疎な配列はそもそも作れない)。同じ理由で「呼び出し側の変更が記録を
 * 書き換えない」は clone ではなく値意味論が保証する —— 下の `startsWithOnePresentState…` で確認する。
 */

// TS `EditState` / `state(tripDays)`(`tests/planner-history.test.ts:13-25`)。
private struct HistoryProbe: Equatable, Sendable {
  struct Settings: Equatable, Sendable {
    var start: String
    var end: String
  }

  var tripDays: Int
  var removedStopIds: [String]
  var settings: Settings
}

private func probe(_ tripDays: Int) -> HistoryProbe {
  HistoryProbe(tripDays: tripDays, removedStopIds: [], settings: .init(start: "09:00", end: "22:00"))
}

// MARK: - ブリーフの 2 本

@Test func historyKeepsTenUndosAndBaseAttachDoesNotAddEntries() {
  var h = PlannerHistory(initial: PlannerEditState.empty, limit: 10)
  for i in 1...15 {
    var s = h.present
    s.tripDays = i
    h = h.commit(s)
  }
  var undos = 0
  while h.canUndo {
    h = h.undo()
    undos += 1
  }
  #expect(undos == 10)
  let attached = h.attachingBase(TestStops.resolvedBase())
  #expect(attached.past.count == h.past.count)
  #expect(attached.present.resolvedBase != nil)
}

@Test func committingAnEqualStateIsANoOp() {
  let h = PlannerHistory(initial: PlannerEditState.empty, limit: 10)
  #expect(h.commit(PlannerEditState.empty).past.isEmpty)
}

// MARK: - `tests/planner-history.test.ts` の移植

/// TS `starts with one cloned present state and no Undo or Redo`(`:27-37`)。
@Test func startsWithOnePresentStateAndNoUndoOrRedo() {
  var initial = probe(3)
  let history = PlannerHistory(initial: initial)

  initial.settings.start = "05:00"
  #expect(history.present == probe(3))   // 呼び出し側の変更は記録を書き換えない
  #expect(history.past.isEmpty)
  #expect(history.future.isEmpty)
  #expect(!history.canUndo)
  #expect(!history.canRedo)
}

/// TS `commit, Undo and Redo restore complete edit states`(`:39-64`)。
@Test func commitUndoAndRedoRestoreCompleteEditStates() {
  let initial = PlannerHistory(initial: probe(3))
  var fourDaysState = probe(4)
  fourDaysState.removedStopIds = ["optional-cafe"]
  let fourDays = initial.commit(fourDaysState)
  var earlyStartState = fourDays.present
  earlyStartState.settings.start = "08:00"
  let earlyStart = fourDays.commit(earlyStartState)

  #expect(earlyStart.past.count == 2)
  #expect(earlyStart.future.isEmpty)
  #expect(earlyStart.canUndo)

  let undoneOnce = earlyStart.undo()
  #expect(undoneOnce.present == fourDays.present)
  #expect(undoneOnce.canRedo)

  let undoneTwice = undoneOnce.undo()
  #expect(undoneTwice.present == initial.present)
  #expect(undoneTwice.undo() == undoneTwice)   // 端での Undo は無操作

  #expect(undoneTwice.redo().present == fourDays.present)
}

/// TS `a structurally equal commit is a referential no-op`(`:66-77`)。TS はキーの並びが違う
/// 同値オブジェクトを渡す —— Swift の構造体は欄ごとの比較なので、並びという概念自体がない。
@Test func aStructurallyEqualCommitIsANoOp() {
  let history = PlannerHistory(initial: probe(3))
  #expect(history.commit(probe(3)) == history)
}

/// TS `a new edit after Undo clears the Redo branch`(`:79-89`)。
@Test func aNewEditAfterUndoClearsTheRedoBranch() {
  let first = PlannerHistory(initial: probe(2))
  let third = first.commit(probe(3)).commit(probe(4))
  let undone = third.undo()
  #expect(undone.future.count == 1)

  let divergent = undone.commit(probe(5))
  #expect(divergent.future.isEmpty)
  #expect(divergent.redo() == divergent)
}

/// TS `keeps at most 20 previous operations`(`:91-103`)。既定の上限は台帳の天井そのもの。
@Test func keepsAtMostTwentyPreviousOperations() {
  var history = PlannerHistory(initial: probe(0))
  for value in 1...25 {
    history = history.commit(probe(value))
  }

  #expect(history.past.count == PlannerHistory<HistoryProbe>.maxEntries)
  for _ in 0..<PlannerHistory<HistoryProbe>.maxEntries {
    history = history.undo()
  }
  #expect(history.present.tripDays == 5)   // 直近 20 操作より古い状態は捨てられている
  #expect(history.undo() == history)
}

/// TS `supports a smaller bounded history limit`(`:105-114`)。`limit: 21` が `RangeError` に
/// なる行は移植していない —— Swift 側は `precondition` で、Swift Testing から観測できない。
@Test func supportsASmallerBoundedHistoryLimit() {
  var history = PlannerHistory(initial: probe(1), limit: 2)
  history = history.commit(probe(2)).commit(probe(3)).commit(probe(4))

  #expect(history.past.count == 2)
  #expect(history.undo().undo().present.tripDays == 2)
}

// MARK: - 拠点の差し替え(`lib/planner-app-state.ts:517-527`)

/// 拠点の差し替えは利用者の操作ではないので、過去・現在・未来のすべてを書き換える。
/// エントリは増えず、Undo は差し替え前の拠点に「戻す」ことをしない。
@Test func attachingABaseRewritesPastPresentAndFuture() {
  var history = PlannerHistory(initial: PlannerEditState.empty, limit: 10)
  for days in [4, 5, 6] {
    var next = history.present
    next.tripDays = days
    history = history.commit(next)
  }
  history = history.undo()   // 未来を 1 件作る
  #expect(history.past.count == 2)
  #expect(history.future.count == 1)

  let attached = history.attachingBase(TestStops.resolvedBase())
  #expect(attached.past.count == history.past.count)
  #expect(attached.future.count == history.future.count)
  #expect(attached.past.allSatisfy { $0.resolvedBase?.id == "hotel-tokyo-station" })
  #expect(attached.present.resolvedBase?.id == "hotel-tokyo-station")
  #expect(attached.future.allSatisfy { $0.resolvedBase?.id == "hotel-tokyo-station" })
  // 拠点以外は 1 欄も動かない。
  #expect(attached.past.map(\.tripDays) == history.past.map(\.tripDays))
  #expect(attached.attachingBase(nil).present.resolvedBase == nil)
}

// MARK: - `PlannerEditState`(`lib/planner-app-state.ts:457-507`)

/// TS `emptyPlannerEditState`(`:486-507`)。
@Test func theEmptyEditStateMatchesTheWebDefaults() {
  let empty = PlannerEditState.empty
  #expect(empty.tripDays == 3)
  #expect(empty.pace == .balanced)
  #expect(empty.hotelQuery.isEmpty)
  #expect(empty.resolvedBase == nil)
  #expect(empty.travelPreference == .auto)
  #expect(empty.transferBufferMinutes == 10)
  #expect(empty.userStayMinutes.isEmpty)
  #expect(empty.lastEntryTimes.isEmpty)
  #expect(empty.dayStartTimes.values.isEmpty)
  #expect(empty.dayEndTimes.values.isEmpty)
  #expect(empty.legModeOverrides.isEmpty)
  #expect(empty.dayOverrides.isEmpty)
  #expect(empty.lockedOrderByDay.values.isEmpty)
  #expect(empty.removedStops.isEmpty)
  #expect(empty.itinerary.isEmpty)
  #expect(empty.mealSelections.isEmpty)
  #expect(empty.resolvedStops.isEmpty)
  #expect(empty.resolutionOverrides.isEmpty)
  #expect(PlannerEdits.undoLimit == 10)
}

/// 状態は Web と同じ JSON 形へ往復する(`Record<number, X>` はオブジェクト、配列は配列)。
@Test func theEditStateRoundTripsThroughItsWebJsonShape() throws {
  var state = PlannerEditState.empty
  state.tripDays = 5
  state.dayStartTimes = IntKeyedDictionary([0: "08:00", 1: "10:00"])
  state.lockedOrderByDay = IntKeyedDictionary([0: ["sensoji", "tokyo-skytree"]])
  state.removedStops = [PlannerRemovedStop(id: "tsukiji-market", name: "Tsukiji Outer Market")]
  state.legModeOverrides = ["sensoji|tokyo-skytree": .taxi]
  state.resolutionOverrides = [.provider(inputIndex: 0, providerRef: "places/abc")]
  state.resolvedBase = TestStops.resolvedBase()

  let encoded = try JSONEncoder().encode(state)
  let object = try #require(try JSONSerialization.jsonObject(with: encoded) as? [String: Any])
  #expect((object["dayStartTimes"] as? [String: Any])?["0"] as? String == "08:00")
  #expect(try JSONDecoder().decode(PlannerEditState.self, from: encoded) == state)
}

// MARK: - `ResolutionOverride`(`lib/share-link.ts:17-20`, `lib/planner-app-state.ts:64-110`)

/// 2 つの物証は 2 つの形。プロバイダの決定は識別子だけ、手入力の決定は本人の書いた文字と座標だけ。
@Test func resolutionOverridesRoundTripThroughTheWebObjectShapes() throws {
  let provider = ResolutionOverride.provider(inputIndex: 2, providerRef: "places/xyz")
  let manual = ResolutionOverride.manual(
    inputIndex: 3,
    name: "Grandma's kitchen",
    address: "1-2-3 Somewhere",
    latitude: 35.68123,
    longitude: 139.76712
  )

  let providerJSON = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(provider)) as? [String: Any])
  #expect(providerJSON.keys.sorted() == ["inputIndex", "providerRef"])
  let manualJSON = try #require(try JSONSerialization.jsonObject(with: JSONEncoder().encode(manual)) as? [String: Any])
  #expect(manualJSON.keys.sorted() == ["address", "inputIndex", "latitude", "longitude", "name"])

  for override in [provider, manual] {
    let encoded = try JSONEncoder().encode(override)
    #expect(try JSONDecoder().decode(ResolutionOverride.self, from: encoded) == override)
  }
  #expect(provider.inputIndex == 2)
  #expect(manual.inputIndex == 3)
}

/// TS `manualStopFromResolutionOverride`(`:73-94`)/ `withManualResolutionOverrides`(`:96-110`)。
@Test func manualOverridesReplaceTheirOccurrenceAndProviderPinsDoNot() throws {
  let manual = ResolutionOverride.manual(
    inputIndex: 1,
    name: "Grandma's kitchen",
    address: "1-2-3 Somewhere",
    latitude: 35.681236,
    longitude: 139.767125
  )
  let stop = try #require(PlannerEdits.manualStop(from: manual))
  // JS `toFixed(5)`:35.681236 の直近の double は …2359999…(切り上げて 35.68124)、
  // 139.767125 は …124999…(切り下げて 139.76712)。どちらも同点ではないので `%.5f` と一致する。
  #expect(stop.id == "manual-1-35.68124-139.76712")
  #expect(stop.input == "Grandma's kitchen")
  #expect(stop.name == "Grandma's kitchen")
  #expect(stop.area == "1-2-3 Somewhere")
  #expect(stop.address == "1-2-3 Somewhere")
  #expect(stop.confidence == .low)
  #expect(stop.isUserEntered == true)
  #expect(stop.userProvidedCoordinates == true)
  #expect(stop.sourceUrl.isEmpty)
  #expect(stop.verifiedAt.isEmpty)
  #expect(stop.planningDurationMinutes == StayEstimates.estimateStayMinutes(name: "Grandma's kitchen", placeTypes: [], fallback: 90))
  #expect(PlannerEdits.manualStop(from: .provider(inputIndex: 1, providerRef: "places/xyz")) == nil)

  let places = TestStops.tokyoResolved(["Ueno Park", "Senso-ji", "Tokyo Skytree"])
  let applied = PlannerEdits.applyManualOverrides(places, overrides: [manual, .provider(inputIndex: 0, providerRef: "places/xyz")])
  #expect(applied.count == 3)
  #expect(!applied.contains { $0.inputIndex == 1 && $0.id != stop.id })   // 差し替えられたのはその出現だけ
  #expect(applied.last?.id == stop.id)
  #expect(applied.contains { $0.name == "Ueno Park" })   // プロバイダのピンは何も置き換えない
  #expect(PlannerEdits.applyManualOverrides(places, overrides: []) == places)
}

/// TS `upsertResolutionOverride`(`:64-71`)—— 1 出現につき 1 件、`inputIndex` 昇順、最大 12 件。
@Test func upsertKeepsOneOverridePerOccurrenceSortedAndCapped() {
  var overrides: [ResolutionOverride] = []
  for index in [3, 1, 2] {
    overrides = PlannerEdits.upsertResolutionOverride(overrides, .provider(inputIndex: index, providerRef: "places/\(index)"))
  }
  #expect(overrides.map(\.inputIndex) == [1, 2, 3])

  overrides = PlannerEdits.upsertResolutionOverride(overrides, .provider(inputIndex: 2, providerRef: "places/replaced"))
  #expect(overrides.count == 3)
  #expect(overrides[1] == .provider(inputIndex: 2, providerRef: "places/replaced"))

  for index in 4...20 {
    overrides = PlannerEdits.upsertResolutionOverride(overrides, .provider(inputIndex: index, providerRef: "places/\(index)"))
  }
  #expect(overrides.count == 12)
  #expect(overrides.map(\.inputIndex) == Array(1...12))
}

// MARK: - `clampTripDays`(`lib/planner-app-state.ts:198-200`)

@Test func clampTripDaysStaysInsideOneToFourteen() {
  #expect(PlannerEdits.clampTripDays(0) == 1)
  #expect(PlannerEdits.clampTripDays(-4) == 1)
  #expect(PlannerEdits.clampTripDays(3) == 3)
  #expect(PlannerEdits.clampTripDays(14) == 14)
  #expect(PlannerEdits.clampTripDays(15) == 14)
}

// MARK: - 時間帯の中の訪問(`lib/planner-app-state.ts:421-441`)

/*
 * 期待値は TS 本体を Node 22.18 で回して取ったもの(`clockRangeContainsVisit` を同じ 17 組に
 * 通した結果)。日を跨ぐ窓と、読めない窓の扱いがこの述語の全部。
 */

/// 窓の中の訪問は中にある。両端はどちらも含む(`:440` は `>=` と `<=`)。
@Test func aVisitInsideTheRangeIsInsideIt() {
  #expect(PlannerEdits.clockRangeContainsVisit(range: "11:00–14:30", arrival: "12:00", departure: "13:00"))
  #expect(PlannerEdits.clockRangeContainsVisit(range: "11:00–14:30", arrival: "11:00", departure: "14:30"))
}

/// 窓より前の訪問は「翌日の同じ窓」へ繰り上がるので、終わりが窓を越えて `false`(`:438-439`)。
@Test func aVisitBeforeOrAfterTheRangeIsOutsideIt() {
  #expect(!PlannerEdits.clockRangeContainsVisit(range: "11:00–14:30", arrival: "09:00", departure: "10:00"))
  #expect(!PlannerEdits.clockRangeContainsVisit(range: "11:00–14:30", arrival: "15:00", departure: "16:00"))
  // 始まりは中でも、終わりがはみ出せば入っていない。
  #expect(!PlannerEdits.clockRangeContainsVisit(range: "11:00–14:30", arrival: "13:00", departure: "15:00"))
}

/// 日を跨ぐ窓(`:437` の `end += 1440`)。深夜 01:00 の訪問は 22:00–02:00 の中にある。
@Test func aRangeThatCrossesMidnightStillContainsALateVisit() {
  #expect(PlannerEdits.clockRangeContainsVisit(range: "22:00–02:00", arrival: "01:00", departure: "01:30"))
  #expect(PlannerEdits.clockRangeContainsVisit(range: "22:00–02:00", arrival: "22:30", departure: "23:30"))
  // 日付を跨ぐ訪問そのもの(23:00 着 → 00:30 発)も中にある。
  #expect(PlannerEdits.clockRangeContainsVisit(range: "22:00–02:00", arrival: "23:00", departure: "00:30"))
  #expect(!PlannerEdits.clockRangeContainsVisit(range: "22:00–02:00", arrival: "03:00", departure: "04:00"))
}

/// 読めない窓・読めない時刻は `false`(`:436`)。区切りはエンダッシュだけで、内側の時刻は
/// 時も 2 桁必須 —— `clockToMinutes` より厳しいことが**この関数の中でだけ**効く。
@Test func anUnreadableRangeOrClockIsNeverContained() {
  #expect(!PlannerEdits.clockRangeContainsVisit(range: "11:00-14:30", arrival: "12:00", departure: "13:00"))   // ASCII ハイフン
  #expect(!PlannerEdits.clockRangeContainsVisit(range: "9:00–14:30", arrival: "12:00", departure: "13:00"))    // 時が 1 桁
  #expect(!PlannerEdits.clockRangeContainsVisit(range: "11:00–14:30", arrival: "9:00", departure: "13:00"))
  #expect(!PlannerEdits.clockRangeContainsVisit(range: "11:00–14:30", arrival: "12:00", departure: "1:00"))
  #expect(!PlannerEdits.clockRangeContainsVisit(range: "11:00–", arrival: "12:00", departure: "13:00"))
  #expect(!PlannerEdits.clockRangeContainsVisit(range: "", arrival: "12:00", departure: "13:00"))
  #expect(!PlannerEdits.clockRangeContainsVisit(range: "24:00–25:00", arrival: "12:00", departure: "13:00"))
  // TS の分割代入は 3 つ目以降を捨てるので、これは "11:00"–"14:30" として読まれる(= true)。
  #expect(PlannerEdits.clockRangeContainsVisit(range: "11:00–14:30–17:00", arrival: "12:00", departure: "13:00"))
}

/// TS `clockToMinutes`(`:421-424`)を移植しない根拠:`ClockTime(_:)` が同じ集合を受ける。
@Test func clockToMinutesIsTheClockTimeParser() {
  #expect(ClockTime("9:00")?.minutes == 540)     // 時 1 桁は通る(`[01]?\d`)
  #expect(ClockTime("09:00")?.minutes == 540)
  #expect(ClockTime("0:00")?.minutes == 0)
  #expect(ClockTime("23:59")?.minutes == 1439)
  #expect(ClockTime("24:00") == nil)
  #expect(ClockTime("9:5") == nil)               // 分は 2 桁必須(`[0-5]\d`)
  #expect(ClockTime("1:0") == nil)
  #expect(ClockTime("+9:00") == nil)             // ASCII 数字のみ
}

// MARK: - ホテルの陳腐化(`lib/planner-app-state.ts:445-450`)

/// 署名は日ごとの停留所の**集合**。順番は最適化で動くので、id を UTF-16 順に並べ替えてから畳む
/// (TS の比較関数なしの `.sort()`)—— 大文字が小文字より先に来ることまで同じ。
@Test func theHotelSignatureIsTheSetOfStopsPerDayNotTheirOrder() {
  #expect(PlannerEdits.hotelPlanSignature(nil).isEmpty)

  let (before, after, _) = TestStops.airportWorseCurfewBetter()
  #expect(PlannerEdits.hotelPlanSignature(before) == "0:sensoji,tokyo-skytree|1:akihabara,ueno-park")
  // 滞在時間だけを動かした候補は同じ集合 = ホテルは古くならない。
  #expect(PlannerEdits.hotelPlanSignature(after) == PlannerEdits.hotelPlanSignature(before))
  // 停留所が 1 件消えれば署名は変わる。
  let (_, dropped, _) = TestStops.mustStopDropped()
  #expect(PlannerEdits.hotelPlanSignature(dropped) != PlannerEdits.hotelPlanSignature(before))

  // 空の日は空のまま、大文字の id は小文字より前(TS の既定 sort と同じ UTF-16 順)。
  let mixed = TestStops.planWithStopIds([["tokyo-skytree", "sensoji"], ["ueno-park", "Akihabara"], []])
  #expect(PlannerEdits.hotelPlanSignature(mixed) == "0:sensoji,tokyo-skytree|1:Akihabara,ueno-park|2:")
}
