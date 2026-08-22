import Foundation
import Testing
@testable import TripCheckAppCore
import TripCheckKit

/*
 * 貼り付け取り込みと、行 1 つぶんの編集。
 *
 * どちらも「旅行者が書いたものを黙って捨てない」ための道具:貼り付けは 12 件を超えた分を
 * 切り捨てずに**足さないで報せ**、行の編集は「触っていない欄」と「空にした欄」を取り違えない。
 */

// MARK: - 貼り付け取り込み

@Test @MainActor func pasteAppendsUpToTwelveAndKeepsUnparsed() async {
  let store = PlannerStore(resolvers: [], store: nil)
  let r = store.importPasted((0..<14).map { "Place \($0)" }.joined(separator: "\n") + "\nhttps://x.example\n")
  #expect(r.added == 12); #expect(r.unparsed == 1); #expect(store.request.entries.count == 12)
  #expect(store.view.toast?.kind == .limit)
}

@Test @MainActor func pastedHeadingsLandInFixedDayNotInLockedOrder() async {
  let store = PlannerStore(resolvers: [], store: nil)
  _ = store.importPasted("Day 1\nUeno Park\nDay 2\nTokyo Tower")
  #expect(store.request.entries.map(\.fixedDay) == [1, 2])
  #expect(store.request.inputMode == .existing_itinerary)
  #expect(store.edit.lockedOrderByDay.values.isEmpty)
}

@Test @MainActor func entryPatchDistinguishesClearFromKeep() async {
  let store = PlannerStore(resolvers: [], store: nil)
  let id = store.addEntrySync(text: "Tokyo Tower")
  store.updateEntry(id: id, priority: nil, fixedTime: .some("14:30"), isReservation: nil, stayMinutes: nil, fixedDay: nil)
  #expect(store.request.entries[0].fixedTime == "14:30")
  store.updateEntry(id: id, priority: .optional, fixedTime: nil, isReservation: nil, stayMinutes: nil, fixedDay: nil)
  #expect(store.request.entries[0].fixedTime == "14:30"); #expect(store.request.entries[0].priority == .optional)
  store.updateEntry(id: id, priority: nil, fixedTime: .some(nil), isReservation: nil, stayMinutes: nil, fixedDay: nil)
  #expect(store.request.entries[0].fixedTime == nil)
}

/// 貼り付けは**足す**もので、入れ替えではない —— 1 件ずつ入れた場所が消えたら、旅行者は
/// 打ち直すことになる。溢れた件数のトーストは、いま何件になろうとしたのかを名指しする。
@Test @MainActor func pasteAddsToWhatIsAlreadyThereAndNamesTheCount() async {
  let store = PlannerStore(resolvers: [], store: nil)
  for i in 0..<5 { store.addEntrySync(text: "Kept \(i)") }

  let r = store.importPasted((0..<10).map { "Pasted \($0)" }.joined(separator: "\n"))

  #expect(r.added == 7)
  #expect(store.request.entries.count == PlannerStore.placeLimit)
  #expect(store.request.entries.prefix(5).map(\.text) == ["Kept 0", "Kept 1", "Kept 2", "Kept 3", "Kept 4"])
  // 5 + 10 = 15。件数を落とすと「12 までです」だけが残り、何件あったのかが読めない。
  #expect(store.view.toast?.text.contains("15") == true)
}

/// 読み取れなかった行は `request` に残る(捨てない)。2 回貼れば 2 行とも残る。
@Test @MainActor func unparsedLinesPileUpOnTheRequestInsteadOfVanishing() async {
  let store = PlannerStore(resolvers: [], store: nil)
  _ = store.importPasted("Ueno Park\nhttps://one.example")
  _ = store.importPasted("Tokyo Tower\nhttps://two.example")
  #expect(store.request.unparsedLines == ["https://one.example", "https://two.example"])
  #expect(store.request.entries.map(\.text) == ["Ueno Park", "Tokyo Tower"])
}

/// 12 件ちょうどはトーストを出さない —— 上限に**当たった**ときだけ報せる。
@Test @MainActor func exactlyTwelvePastedPlacesArriveWithoutAWarning() async {
  let store = PlannerStore(resolvers: [], store: nil)
  let r = store.importPasted((0..<12).map { "Place \($0)" }.joined(separator: "\n"))
  #expect(r.added == 12)
  #expect(store.view.toast == nil)
}

/// 表示用のモードは「いま手元にある行」から出す。日を 1 つ足せば旅程の確認、最後の 1 つを
/// 消せば行きたい場所リストへ戻る —— 正は `bundle.plan.inputMode` だが、Start の表示が
/// 手元の行と食い違ってはいけない(`WishlistSerialization.raw` が `Day N` を出す条件と同じ)。
@Test @MainActor func theDisplayedModeFollowsTheDaysActuallyOnTheEntries() async {
  let store = PlannerStore(resolvers: [], store: nil)
  _ = store.importPasted("Ueno Park\nSenso-ji")
  #expect(store.request.inputMode == .wishlist)

  let id = store.request.entries[0].id
  store.updateEntry(id: id, fixedDay: .some(2))
  #expect(store.request.inputMode == .existing_itinerary)

  store.updateEntry(id: id, fixedDay: .some(nil))
  #expect(store.request.inputMode == .wishlist)
}

/// 貼った日が既定の `plannedDays`(既定 3 日)を超えても、その日のまま届く —— 切り捨てない。
/// 行編集シートの `Picker` が選べる幅にもその日が含まれる(でなければ選ばれていることが
/// 画面にもVoiceOverにも見えなくなる)。
@Test @MainActor func aPastedDayBeyondThePlannedCountStaysItselfAndIsPickable() async {
  let store = PlannerStore(resolvers: [], store: nil)
  _ = store.importPasted("Day 5\nDaikanyama")
  let id = store.request.entries[0].id
  #expect(store.request.entries[0].fixedDay == 5)
  #expect(store.dayPickerRange(for: id).contains(5))
}

/// 貼った日が `EngineConstants.tripDaysRange`(1〜14)の外でも、上限に畳んで受け取る ——
/// 畳まずに載せると `Picker` に対応するタグが無い値になり、共有すれば Web が読めない見出し
/// がそのまま出る。Kit の `WishlistParser` 自体は見出しの日を 1〜30 までしか読まない
/// (`headingDay`)ので、20 という「Kit は読むが `tripDaysRange` の外」の値で試す ——
/// 99 は Kit 側で見出しとして読めず、この行自体が `contextDay` を進めないまま終わる。
@Test @MainActor func aPastedDayPastTheEnginesRangeClampsToTheUpperBound() async {
  let store = PlannerStore(resolvers: [], store: nil)
  _ = store.importPasted("Day 20\nOdaiba")
  #expect(store.request.entries[0].fixedDay == EngineConstants.tripDaysRange.upperBound)
}

/// `updateEntry` も同じ範囲へ両端畳む —— 貼り付けを介さず、シートから直接 99 を送っても
/// 結果は同じでなければならない。
@Test @MainActor func updatingAnEntrysDayClampsToTheEnginesRange() async {
  let store = PlannerStore(resolvers: [], store: nil)
  let id = store.addEntrySync(text: "Ueno Park")
  store.updateEntry(id: id, fixedDay: .some(99))
  #expect(store.request.entries[0].fixedDay == EngineConstants.tripDaysRange.upperBound)
}

/// 外したときも同じ —— 日の付いた最後の 1 行が消えれば、旅程の確認ではなくなる。
@Test @MainActor func removingTheLastDayedEntryPutsTheModeBack() async {
  let store = PlannerStore(resolvers: [], store: nil)
  _ = store.importPasted("Day 1\nUeno Park\nSenso-ji")
  #expect(store.request.inputMode == .existing_itinerary)

  for entry in store.request.entries { store.removeEntry(id: entry.id) }

  #expect(store.request.entries.isEmpty)
  #expect(store.request.inputMode == .wishlist)
}

// MARK: - 行 1 つぶんの編集

/// 欄ごとに独立していること。予約と滞在を別々に触っても、触っていない欄は動かない。
@Test @MainActor func eachFieldOfAnEntryMovesOnItsOwn() async {
  let store = PlannerStore(resolvers: [], store: nil)
  let id = store.addEntrySync(text: "teamLab Planets")

  store.updateEntry(id: id, fixedTime: .some("15:30"), isReservation: true)
  store.updateEntry(id: id, stayMinutes: .some(90))

  let entry = store.request.entries[0]
  #expect(entry.fixedTime == "15:30")
  #expect(entry.isReservation)
  #expect(entry.stayMinutes == 90)
  #expect(entry.priority == .normal)
  #expect(entry.fixedDay == nil)
}

/// 滞在時間はエンジンが受け取れる幅(`EngineConstants.stayMinutesRange`)に収める。
@Test @MainActor func stayMinutesAreHeldInsideTheRangeTheEngineAccepts() async {
  let store = PlannerStore(resolvers: [], store: nil)
  let id = store.addEntrySync(text: "Ueno Park")

  store.updateEntry(id: id, stayMinutes: .some(5))
  #expect(store.request.entries[0].stayMinutes == EngineConstants.stayMinutesRange.lowerBound)

  store.updateEntry(id: id, stayMinutes: .some(900))
  #expect(store.request.entries[0].stayMinutes == EngineConstants.stayMinutesRange.upperBound)
}

/// 時刻として読めない字はエンジンへ渡さない。`WishlistSerialization.raw` が吐く行は
/// 必ず Kit のパーサが読み戻せる形でなければならない(貼り付け → 編集 → 共有の往復)。
@Test @MainActor func aTimeThatIsNotAClockClearsInsteadOfReachingTheSerialiser() async {
  let store = PlannerStore(resolvers: [], store: nil)
  let id = store.addEntrySync(text: "Ueno Park")
  store.updateEntry(id: id, fixedTime: .some("14:30"))

  store.updateEntry(id: id, fixedTime: .some("25:99"))

  #expect(store.request.entries[0].fixedTime == nil)
  #expect(!WishlistSerialization.raw(from: store.request.entries, locale: .en).contains("25:99"))
}

/// 知らない id は黙って何もしない —— シートが閉じる途中で届いた更新で落ちない。
@Test @MainActor func updatingAnEntryThatIsGoneChangesNothing() async {
  let store = PlannerStore(resolvers: [], store: nil)
  store.addEntrySync(text: "Ueno Park")
  let before = store.request.entries

  store.updateEntry(id: UUID(), priority: .must, fixedTime: .some("09:00"))

  #expect(store.request.entries == before)
}

/// 編集した行は Web と同じテキストに戻る(共有・保存の往復が壊れない)。
@Test @MainActor func anEditedEntryStillSerialisesToTheWebsBytes() async {
  let store = PlannerStore(resolvers: [], store: nil)
  let id = store.addEntrySync(text: "Ghibli Museum")
  store.updateEntry(id: id, priority: .normal, fixedTime: .some("10:00"), isReservation: true, stayMinutes: .some(120), fixedDay: .some(2))

  let raw = WishlistSerialization.raw(from: store.request.entries, locale: .en)

  #expect(raw == "Day 2\nGhibli Museum — 10:00 — booked — stay 120 min")
  #expect(WishlistSerialization.entries(fromPasted: raw).entries[0].stayMinutes == 120)
}
