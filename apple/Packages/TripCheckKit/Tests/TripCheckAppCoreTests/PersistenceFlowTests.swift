import Foundation
import Testing
@testable import TripCheckAppCore
import TripCheckKit

/*
 * 端末内保存 —— 何が書かれ、何が書かれず、閉じて開き直したときに何が戻るか。
 *
 * 保存してよいのは**旅行者が書いたもの**(入力と編集)だけで、プロバイダの応答も組み上がった
 * 旅程も書かない(R11)。`UserTripPayload.validate` は入れ子の全鍵を禁止キーと照合するので、
 * うっかり Kit の `ResolvedStop` を符号化すると保存が毎回落ちる —— その落とし穴を最初の
 * テストが見張る。
 */

/// 保存の場所は 1 件ごとに使い捨て。既定の場所を共有すると、並列で走る別のテストが置いた
/// 旅程をこちらが読む。
private func temporaryDirectory() -> URL {
  FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
}

/// 自動保存が届くまで待つ。**固定の待ち時間にしない** —— 待つ長さを決め打ちにすると、
/// `swift test --parallel` の忙しさで答えが変わる(実際に 50 ミリ秒では落ちた)。
///
/// `until` を渡すのは、記録が**最後の状態**になるまで待つため:1 回の旅で書かれる記録は
/// 常に同じ 1 枚なので、「何か書かれている」だけを見ると、まだ届いていない編集を待たずに
/// 途中の姿を読んでしまう。
@MainActor
private func waitForSavedTrip(
  _ store: PlannerStore,
  until isReady: (StoredTripRecord) -> Bool = { _ in true }
) async -> StoredTripRecord? {
  for _ in 0..<250 {
    await store.loadRecent()
    if let first = store.recentTrips.first, isReady(first) { return first }
    try? await Task.sleep(for: .milliseconds(20))
  }
  return nil
}

/// 保存された編集の中の 1 つの数(荷物は型の無い JSON なので、読むところで形を確かめる)。
private func savedTripDays(_ record: StoredTripRecord) -> Int? {
  guard case .number(let days)? = record.payload.edits["tripDays"] else { return nil }
  return Int(days)
}

/// 外した場所が保存に載っているか。
private func savedRemovedStopCount(_ record: StoredTripRecord) -> Int {
  guard case .array(let removed)? = record.payload.edits["removedStops"] else { return 0 }
  return removed.count
}

/// 保存された `hotelQuery`。
private func savedHotelQuery(_ record: StoredTripRecord) -> String? {
  guard case .string(let value)? = record.payload.edits["hotelQuery"] else { return nil }
  return value
}

/// 待たせてある自動保存が実際に予約されるまで待つ。`autosaveTask` は internal だが
/// `@testable import` なので覗ける —— タイミングに頼らず、「まだ書かれていない予約」が
/// 確実にある状態を作るため(削除が本当にその予約を破ったかを見るテストのため)。
@MainActor
private func waitForPendingAutosave(_ store: PlannerStore) async {
  for _ in 0..<250 {
    if store.autosaveTask != nil { return }
    try? await Task.sleep(for: .milliseconds(4))
  }
}

@Test @MainActor func persistedPayloadNeverCarriesForbiddenKeys() async throws {
  let store = PlannerStore(resolvers: [], store: nil); store.loadSample(.switzerland)
  let apple = ResolvedStop(id: "apple-0-1", name: "Bern", area: "Bern", latitude: 46.9, longitude: 7.4, sourceUrl: "", verifiedAt: "", confidence: .medium, planningDurationMinutes: 60, isAnchor: true, input: "Bern", inputIndex: 0, address: "Bern", countryCode: "CH", provider: .apple)
  store.request.entries[0].pinned = .apple(providerRef: nil, stop: apple)
  store.setManualPin(entryId: store.request.entries[1].id, name: "Somewhere", address: "", latitude: 1, longitude: 2)
  let payload = try store.persistedPayload()                       // UserTripPayload.validate(input:edits:) を通る
  func walk(_ v: JSONValue) -> [String] { if case .object(let o) = v { return o.keys.map { UserTripPayload.normalizedKey($0) } + o.values.flatMap(walk) }; if case .array(let a) = v { return a.flatMap(walk) }; return [] }
  let keys = walk(payload.jsonValue)
  #expect(!keys.isEmpty)
  #expect(Set(keys).isDisjoint(with: UserTripPayload.forbiddenKeys))
  #expect(payload.edits["resolvedStops"] == nil); #expect(payload.edits["resolvedBase"] == nil)
}

/// 実測を持つ store でも、保存 payload に live* / ジオメトリ / routes の鍵は出ない。
///
/// 測った分は `PlannerStore.liveRoutes` に住んでいて `request` / `edit` / `view` のどこにも
/// 置かれない(global constraints)。だから保存の荷物は測る前と同じ形のままである ——
/// 誰かが「便利だから」と測った分を `edit` へ写した日に、ここが赤くなる。
@Test @MainActor func aStoreWithMeasuredRoutesPersistsNoneOfThem() async throws {
  let store = await enrichedSample(FakeRouteProvider())
  #expect(!store.liveRoutes.isEmpty)
  let payload = try store.persistedPayload()
  func walk(_ v: JSONValue) -> [String] { if case .object(let o) = v { return o.keys.map { UserTripPayload.normalizedKey($0) } + o.values.flatMap(walk) }; if case .array(let a) = v { return a.flatMap(walk) }; return [] }
  let keys = Set(walk(payload.jsonValue))
  #expect(!keys.isEmpty && keys.isDisjoint(with: UserTripPayload.forbiddenKeys))
  #expect(keys.allSatisfy { !$0.hasPrefix("live") && !$0.contains("geometry") && !$0.contains("polyline") && $0 != "routes" })
}

@Test @MainActor func autosaveWritesInputAndEditsOnly() async throws {
  let dir = temporaryDirectory()
  let store = PlannerStore(resolvers: [CatalogResolver()], store: TripStore(directory: dir), autosaveDebounce: .milliseconds(10))
  store.loadSample(.switzerland); await store.build()
  guard let rec = await waitForSavedTrip(store) else { Issue.record("autosave did not write"); return }
  #expect(rec.payload.input["entries"] != nil); #expect(rec.payload.edits["tripDays"] != nil)
  #expect(rec.payload.input["plan"] == nil)
  #expect(rec.payload.edits["resolvedStops"] == nil); #expect(rec.payload.edits["resolvedBase"] == nil)
}

@Test @MainActor func reopeningRebuildsFromInputAndKeepsEdits() async throws {
  let dir = temporaryDirectory()
  let s1 = PlannerStore(resolvers: [CatalogResolver()], store: TripStore(directory: dir), autosaveDebounce: .milliseconds(10))
  s1.loadSample(.switzerland); await s1.build(); await s1.changeTripDays(5)
  guard await waitForSavedTrip(s1, until: { savedTripDays($0) == 5 }) != nil else { Issue.record("nothing saved"); return }
  let s2 = PlannerStore(resolvers: [CatalogResolver()], store: TripStore(directory: dir))
  guard let id = await waitForSavedTrip(s2)?.id else { Issue.record("nothing saved"); return }
  await s2.openTrip(id: id)
  #expect(s2.bundle?.plan.days.count == 5)
}

@Test @MainActor func storageFailureFallsBackToMemoryWithAWarning() async {
  // 起動時に書けないことが分かる —— 最初の保存まで黙っていない(init の eager な探り)
  let impossible = URL(fileURLWithPath: "/dev/null/impossible")
  let store = PlannerStore(resolvers: [], store: TripStore(directory: impossible), storageDirectory: impossible)
  #expect(store.storageUnavailable)
  store.loadSample(.switzerland); await store.build()
  #expect(store.bundle != nil); #expect(store.storageUnavailable)
}

/// 場所に貼り付いた編集(滞在時間・外した場所)は、**開き直しても同じ場所に貼り付いたまま**で
/// なければならない。`ResolvedStop.id` は解決器が作る値で保存の荷物には入らないので、保存の
/// 側で `pin-<出現>` へ揃えておかないと、開き直した瞬間に外した場所が戻り滞在時間が消える。
@Test @MainActor func reopeningKeepsEditsPinnedToTheSameStops() async throws {
  let dir = temporaryDirectory()
  let s1 = PlannerStore(resolvers: [CatalogResolver()], store: TripStore(directory: dir), autosaveDebounce: .milliseconds(10))
  s1.loadSample(.switzerland)
  await s1.build()
  let planned = s1.bundle?.plan.days.flatMap(\.stops).map(\.stop.id) ?? []
  guard planned.count >= 2 else { Issue.record("the sample did not build enough stops"); return }
  await s1.setStayMinutes(stopId: planned[0], minutes: 120)
  if s1.view.pendingHardEdit != nil { await s1.confirmPendingEdit() }
  await s1.removeStop(id: planned[1])
  if s1.view.pendingHardEdit != nil { await s1.confirmPendingEdit() }
  #expect(s1.edit.userStayMinutes[planned[0]] == 120)
  #expect(s1.edit.removedStops.count == 1)
  guard await waitForSavedTrip(s1, until: { savedRemovedStopCount($0) == 1 }) != nil else { Issue.record("nothing saved"); return }

  let s2 = PlannerStore(resolvers: [CatalogResolver()], store: TripStore(directory: dir))
  guard let id = await waitForSavedTrip(s2)?.id else { Issue.record("nothing saved"); return }
  await s2.openTrip(id: id)

  let liveIds = Set(s2.request.entries.compactMap { $0.pinned?.stop.id })
  #expect(!liveIds.isEmpty)
  #expect(s2.edit.userStayMinutes.count == 1)
  #expect(s2.edit.userStayMinutes.values.contains(120))
  #expect(s2.edit.userStayMinutes.keys.allSatisfy { liveIds.contains($0) })
  #expect(s2.edit.removedStops.count == 1)
  #expect(s2.edit.removedStops.allSatisfy { liveIds.contains($0.id) })
  // 貼り付いているだけでなく効いている —— 外した場所は組み直した旅程に居ない。
  let reopened = Set((s2.bundle?.plan.days.flatMap(\.stops) ?? []).map(\.stop.id))
  #expect(!reopened.isEmpty)
  #expect(reopened.isDisjoint(with: Set(s2.edit.removedStops.map(\.id))))
}

/// 開閉や選択(`view`)は保存を起こさない —— 起こすと、旅程を眺めているだけの旅行者の記録が
/// 数秒おきに書き換わる。
@Test @MainActor func viewOnlyChangesDoNotWrite() async throws {
  let dir = temporaryDirectory()
  let store = PlannerStore(resolvers: [CatalogResolver()], store: TripStore(directory: dir), autosaveDebounce: .milliseconds(10))
  store.loadSample(.switzerland)
  guard let id = await waitForSavedTrip(store)?.id else { Issue.record("autosave did not write"); return }

  await store.deleteTrip(id: id)
  #expect(store.recentTrips.isEmpty)

  store.view.selectedDay = 1
  store.view.verdictExpanded = true
  try await Task.sleep(for: .milliseconds(300))          // 待つ側の 10 ミリ秒が 30 回ぶん
  await store.loadRecent()
  #expect(store.recentTrips.isEmpty)

  // 見張りが生きていたことをこの場で確かめる —— 生きていなければ上の「書かれていない」は
  // 何も語らない(壊れた自動保存でも同じ緑になる)。
  store.request.tripDays = 6
  #expect(await waitForSavedTrip(store) != nil)
}

/// 場所が 1 つも無い旅は書かない。書くと、一覧が名前の無い記録で埋まる。
@Test @MainActor func emptyTripsAreNeverWritten() async throws {
  let dir = temporaryDirectory()
  let store = PlannerStore(resolvers: [], store: TripStore(directory: dir), autosaveDebounce: .milliseconds(10))
  store.request.tripStartDate = "2026-09-01"
  store.request.tripDays = 4
  try await Task.sleep(for: .milliseconds(300))          // 待つ側の 10 ミリ秒が 30 回ぶん
  await store.loadRecent()
  #expect(store.recentTrips.isEmpty)

  // 場所が入れば書かれる。ここが緑でなければ、上の「書かれていない」は何も語らない。
  store.addEntrySync(text: "ベルン旧市街")
  #expect(await waitForSavedTrip(store) != nil)
}

/// 保存は 1 件の記録を**書き換え続ける**。組み立ての最中に `edit` が何度動いても、記録が
/// 増えてはいけない(10 件の枠が 1 回の旅で埋まる)。
@Test @MainActor func autosaveKeepsOneRecordPerTrip() async throws {
  let dir = temporaryDirectory()
  let store = PlannerStore(resolvers: [CatalogResolver()], store: TripStore(directory: dir), autosaveDebounce: .milliseconds(10))
  store.loadSample(.switzerland)
  await store.build()
  await store.changeTripDays(5)
  store.setPace(.relaxed)
  guard await waitForSavedTrip(store) != nil else { Issue.record("autosave did not write"); return }
  #expect(store.recentTrips.count == 1)
  #expect(store.recentTrips.first?.title.isEmpty == false)
  #expect(!store.storageUnavailable)
}

/// 記録の題は先頭 3 か所の名前。一覧はこれで旅を見分けるので、空にも「旅程 1」にもしない。
@Test @MainActor func theRecordTitleNamesTheFirstThreePlaces() async throws {
  let dir = temporaryDirectory()
  let store = PlannerStore(resolvers: [], store: TripStore(directory: dir), autosaveDebounce: .milliseconds(10))
  store.loadSample(.switzerland)
  guard let title = await waitForSavedTrip(store)?.title else { Issue.record("autosave did not write"); return }
  let names = store.request.entries.prefix(3).map(\.text)
  #expect(names.count == 3)
  for name in names { #expect(title.contains(name), "\(title)") }
  #expect(!title.contains(store.request.entries[3].text), "\(title)")
}

/// 開き直しでカタログの決定を引き直す相手は**カタログだけ**。解決器の列に端末の地図
/// (ここでは `FakeResolver`)が先に居ても、組み直した旅程は 1 か所も動いてはいけない ——
/// 動くと、旅行者が選んだ覚えのない場所が同じ名前で入れ替わる。
@Test @MainActor func reopeningNeverHandsCatalogPinsToAnotherResolver() async throws {
  func itinerary(_ store: PlannerStore) -> [[String]] {
    (store.bundle?.plan.days ?? []).map { $0.stops.map(\.stop.name) }
  }
  let dir = temporaryDirectory()
  let s1 = PlannerStore(
    resolvers: [FakeResolver(), CatalogResolver()],
    store: TripStore(directory: dir),
    autosaveDebounce: .milliseconds(10)
  )
  s1.loadSample(.switzerland)
  await s1.build()
  let before = itinerary(s1)
  #expect(before.flatMap { $0 }.count >= 8)
  guard await waitForSavedTrip(s1) != nil else { Issue.record("nothing saved"); return }

  let s2 = PlannerStore(resolvers: [FakeResolver(), CatalogResolver()], store: TripStore(directory: dir))
  guard let id = await waitForSavedTrip(s2)?.id else { Issue.record("nothing saved"); return }
  await s2.openTrip(id: id)
  #expect(itinerary(s2) == before)
}

/// 拠点はここでも同じ形の落とし穴を持っていた:`edit.resolvedBase` は保存していない
/// (R11)ので、開き直した側は `hotelQuery`(旅行者が書いた文字列)しか持たない。かつての
/// `reresolveBase()` はこれを `resolvers`(端末の地図が先頭)へ流していた —— `.catalog`
/// の pin と同じ理由で、これは旅行者が選んだ覚えのない拠点へ旅程を組み変えうる。
///
/// `FakeResolver` は尋ねられれば何にでも `.confirmed` を返す(`review`/`unresolved` に
/// 名を挙げていない限り)。だから「尋ねられなかった」ことは `edit.resolvedBase` が
/// `nil` のままであること、そして組み上がった拠点がセッション 1 と変わらないことで見る
/// —— 尋ねられていれば、どちらも変わっているはずである。
@Test @MainActor func reopeningNeverResolvesTheHotelThroughAnotherResolver() async throws {
  let dir = temporaryDirectory()
  let s1 = PlannerStore(
    resolvers: [FakeResolver(), CatalogResolver()],
    store: TripStore(directory: dir),
    autosaveDebounce: .milliseconds(10)
  )
  s1.loadSample(.switzerland)
  s1.edit.hotelQuery = "Hotel Bellevue Palace"
  await s1.build()
  // このセッションでも `setBase` は呼んでいない —— 拠点はビルダーの推薦任せ。
  #expect(s1.edit.resolvedBase == nil)
  let beforeBase = s1.bundle?.plan.selectedBase
  guard await waitForSavedTrip(s1, until: { savedHotelQuery($0) == "Hotel Bellevue Palace" }) != nil else {
    Issue.record("nothing saved"); return
  }

  let s2 = PlannerStore(resolvers: [FakeResolver(), CatalogResolver()], store: TripStore(directory: dir))
  guard let id = await waitForSavedTrip(s2)?.id else { Issue.record("nothing saved"); return }
  await s2.openTrip(id: id)

  #expect(s2.edit.resolvedBase == nil)
  #expect(s2.bundle?.plan.selectedBase == beforeBase)
}

/// 開いている旅を消したら、待たせてある自動保存も一緒に破る。破らないと、削除の直後に
/// 前の予約が効いて、`currentTripId` が空になった `saveNow()` が**新しい id で**同じ内容を
/// また書いてしまう —— 消したはずの旅が(別の記録として)一覧に戻る。
@Test @MainActor func deletingTheOpenTripCancelsThePendingAutosave() async throws {
  let dir = temporaryDirectory()
  let store = PlannerStore(resolvers: [CatalogResolver()], store: TripStore(directory: dir), autosaveDebounce: .milliseconds(10))
  store.loadSample(.switzerland)
  guard let id = await waitForSavedTrip(store)?.id else { Issue.record("autosave did not write"); return }

  // さらに 1 手動かして、次の自動保存を予約させておく(まだ書かれていない)。
  store.request.tripDays = 6
  await waitForPendingAutosave(store)
  #expect(store.autosaveTask != nil)

  await store.deleteTrip(id: id)
  #expect(store.autosaveTask == nil)
  #expect(store.recentTrips.isEmpty)

  try await Task.sleep(for: .milliseconds(300))          // 待つ側の 10 ミリ秒が 30 回ぶん
  await store.loadRecent()
  #expect(store.recentTrips.isEmpty)
}
