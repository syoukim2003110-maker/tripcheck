import Testing
@testable import TripCheckAppCore
import TripCheckKit

/*
 * 確認画面の裏側 —— 候補を選ぶ・候補を断る・地図に自分で置く・もう一度探す・進む。
 *
 * 3 件ずつしか尋ねないのは、確認画面が「作業表」になった瞬間に旅行者が全部いい加減に
 * 押すから(Web `ResolveScreen.tsx:218-219`)。抑止は表示の飾りではなく、順位そのものを
 * `ResolutionPipeline.attentionRanks` から出す。
 */

@Test @MainActor func resolveRowsGateFourthAttentionItem() async {
  let store = PlannerStore(resolvers: [FakeResolver(review: ["A", "B", "C", "D"])], store: nil)   // E は confirmed(Fakes.swift の契約)
  for n in ["A", "B", "C", "D", "E"] { await store.addEntry(text: n, suggestion: nil) }
  store.request.tripDays = 2
  await store.requestBuildFromStart()
  let rows = store.resolveRows
  #expect(rows.filter { $0.state == .review }.count == 4)
  #expect(rows.filter { $0.suppressed }.count == 1)        // attentionRanks の rank 3 = D
  #expect(rows.allSatisfy { $0.candidates.count <= ResolutionPipeline.reviewShortlistLimit })
  #expect(!store.canContinue)
}

@Test @MainActor func manualPinIsUserProvidedAndUnblocks() async {
  let store = PlannerStore(resolvers: [FakeResolver(unresolved: ["Nowhere"])], store: nil)
  await store.addEntry(text: "Nowhere", suggestion: nil); store.request.tripDays = 1
  await store.requestBuildFromStart()
  store.setManualPin(entryId: store.request.entries[0].id, name: "Nowhere", address: "", latitude: 1, longitude: 2)
  #expect(store.request.entries[0].pinned?.stop.userProvidedCoordinates == true)
  #expect(store.canContinue)
}

/// 1 件片付けると次の 1 件が窓に入る。抑止が固定された順位ではなく「残り」から出ている、
/// ということ。
@Test @MainActor func settlingOneRowUnlocksTheNext() async {
  let store = PlannerStore(resolvers: [FakeResolver(review: ["A", "B", "C", "D"])], store: nil)
  for n in ["A", "B", "C", "D"] { await store.addEntry(text: n, suggestion: nil) }
  await store.requestBuildFromStart()
  #expect(store.resolveRows.last?.suppressed == true)

  guard case .review(let candidates)? = store.request.resolutions[store.request.entries[0].id] else {
    Issue.record("A は候補待ちのはず"); return
  }
  store.chooseCandidate(entryId: store.request.entries[0].id, candidate: candidates[0])

  #expect(store.resolveRows[0].state == .confirmed)
  #expect(store.resolveRows.allSatisfy { !$0.suppressed })
  #expect(store.request.entries[0].pinned?.stop.name == "A Old Town")
}

/// 候補を選んだ 1 件は行に固定される —— 固定しないと座標がエンジンへ渡らない。
@Test @MainActor func choosingACandidatePinsItAndUnblocksTheBuild() async {
  let store = PlannerStore(resolvers: [FakeResolver(review: ["Bern"])], store: nil)
  await store.addEntry(text: "Bern", suggestion: nil)
  await store.requestBuildFromStart()
  #expect(!store.canContinue)

  guard case .review(let candidates)? = store.request.resolutions[store.request.entries[0].id] else {
    Issue.record("候補待ちのはず"); return
  }
  store.chooseCandidate(entryId: store.request.entries[0].id, candidate: candidates[1])

  #expect(store.request.entries[0].pinned?.stop.id == candidates[1].stop.id)
  #expect(store.canContinue)
}

/// 「候補にない」を押した行は未解決に戻る —— 住所で指定する道(手動ピン)へ進むための
/// 状態であって、黙って先頭候補を採ることではない。
@Test @MainActor func rejectingCandidatesLeavesTheRowUnresolved() async {
  let store = PlannerStore(resolvers: [FakeResolver(review: ["Bern"])], store: nil)
  await store.addEntry(text: "Bern", suggestion: nil)
  await store.requestBuildFromStart()

  store.rejectCandidates(entryId: store.request.entries[0].id)

  #expect(store.resolveRows[0].state == .unresolved)
  #expect(store.resolveRows[0].candidates.isEmpty)
  #expect(store.request.entries[0].pinned == nil)
}

/// 「もう一度探す」は同じ 1 行だけを尋ね直す。ほかの行の答えは動かさない。
@Test @MainActor func retryResolvesOnlyThatRow() async {
  let store = PlannerStore(resolvers: [FlakyResolver()], store: nil)
  await store.addEntry(text: "Bern", suggestion: nil)
  await store.addEntry(text: "Nowhere", suggestion: nil)
  await store.requestBuildFromStart()
  #expect(store.resolveRows[1].state == .unresolved)

  await store.retryResolve(entryId: store.request.entries[1].id)

  #expect(store.resolveRows[1].state == .confirmed)   // 2 度目は答える相手
  #expect(store.resolveRows[0].state == .confirmed)
  #expect(store.isResolvingPlaces == false)
}

/// 未解決のまま進むこと自体は止めない(場所は落ちるが、旅程は組める)。ただし必須指定と
/// 予約済みは**先に尋ねる** —— 旅行者が守れと言った場所を黙って落とさない。
@Test @MainActor func continuingWithAnUnresolvedMustAsksFirst() async {
  let store = PlannerStore(resolvers: [FakeResolver(unresolved: ["Nowhere"])], store: nil)
  await store.addEntry(text: "Bern", suggestion: nil)
  await store.addEntry(text: "Nowhere", suggestion: nil)
  store.request.tripDays = 2
  await store.requestBuildFromStart()
  store.setPriority(id: store.request.entries[1].id, .must)
  #expect(store.canContinue)

  await store.continueFromResolve()
  #expect(store.view.pendingHardEdit == .mustUnresolved(names: ["Nowhere"]))
  #expect(store.view.screen == .resolve)
  #expect(store.bundle == nil)

  await store.continueFromResolve(force: true)
  #expect(store.view.pendingHardEdit == nil)
  #expect(store.bundle != nil)
}

/// 必須でも予約でもない未解決は、確認を挟まずに進む。
@Test @MainActor func continuingWithAnOrdinaryUnresolvedJustBuilds() async {
  let store = PlannerStore(resolvers: [FakeResolver(unresolved: ["Nowhere"])], store: nil)
  await store.addEntry(text: "Bern", suggestion: nil)
  await store.addEntry(text: "Nowhere", suggestion: nil)
  store.request.tripDays = 2
  await store.requestBuildFromStart()

  await store.continueFromResolve()

  #expect(store.view.pendingHardEdit == nil)
  #expect(store.bundle != nil)
  #expect(store.view.screen == .plan)
}

/// 国が混ざっているうちは進めない —— どちらの国の旅かで営業時間も祝日も変わる。国を選べば
/// その場で進めるようになる(`setDestination` が跨ぎの報せを畳む)。
@Test @MainActor func mixedCountriesBlockContinueUntilACountryIsChosen() async {
  let store = PlannerStore(resolvers: [], store: nil)
  store.request.entries = [
    WishlistEntry(text: "ベルン", pinned: .manual(pinnedStop(name: "ベルン", country: "CH", latitude: 46.94, longitude: 7.44))),
    WishlistEntry(text: "浅草寺", pinned: .manual(pinnedStop(name: "浅草寺", country: "JP", latitude: 35.71, longitude: 139.79))),
  ]
  store.request.tripDays = 2
  await store.requestBuildFromStart()
  #expect(store.view.screen == .resolve)
  #expect(!store.canContinue)

  store.setDestination(.destination(.switzerland))

  #expect(store.canContinue)
}

/// 確認済みの行は住所を見せ、候補待ちの行は候補を、見つからない行は何も持たない —— 画面が
/// 状態ごとに別の的を出せるだけの材料が、1 つの行の型に揃っている。
@Test @MainActor func rowsCarryWhatEachStateNeedsToShow() async {
  let store = PlannerStore(resolvers: [FakeResolver(review: ["Bern"], unresolved: ["Nowhere"])], store: nil)
  await store.addEntry(text: "Bern", suggestion: nil)
  await store.addEntry(text: "Nowhere", suggestion: nil)
  await store.addEntry(text: "Thun", suggestion: nil)
  await store.requestBuildFromStart()

  let rows = store.resolveRows
  #expect(rows.map(\.state) == [.review, .unresolved, .confirmed])
  #expect(rows.map(\.input) == ["Bern", "Nowhere", "Thun"])
  #expect(rows[0].candidates.count == 2)
  #expect(rows[1].candidates.isEmpty)
  #expect(rows[2].name == "Thun")
  #expect(rows[2].rank == nil)                      // 順位が付くのは確認が要る行だけ
  #expect(rows[0].rank == 0 && rows[1].rank == 1)
  #expect(store.confirmedCount == 1)
}

/// 行を外したら、その行の答えも一緒に消える(`removeEntry` は Task 3 の担当だが、確認画面が
/// 読む辞書に残骸が残っていないことはここで留める)。
@Test @MainActor func removingARowRemovesItsAnswerToo() async {
  let store = PlannerStore(resolvers: [FakeResolver(unresolved: ["Nowhere"])], store: nil)
  await store.addEntry(text: "Bern", suggestion: nil)
  await store.addEntry(text: "Nowhere", suggestion: nil)
  await store.requestBuildFromStart()

  store.removeEntry(id: store.request.entries[1].id)

  #expect(store.resolveRows.count == 1)
  #expect(store.resolveRows[0].state == .confirmed)
  #expect(store.canContinue)
}

// MARK: - このファイルだけが使う相手

/// 1 度目は見つけられず、2 度目に答える解決器。「もう一度探す」が本当に尋ね直していないと
/// 状態が変わらない。
private struct FlakyResolver: PlaceResolver {
  /// 何度目の問い合わせかは呼ばれた側が覚える(`PlaceResolver` は値型なので、状態は外に置く)。
  private static let asked = AskCounter()

  func resolve(_ queries: [PlaceQuery], destination: DestinationChoice, locale: PlannerLocale) async -> [Int: PlaceResolution] {
    var out: [Int: PlaceResolution] = [:]
    for query in queries {
      let times = await Self.asked.bump(query.input)
      if query.input == "Nowhere", times == 1 {
        out[query.inputIndex] = .unresolved(reason: ResolutionPipeline.notFoundReason)
      } else {
        out[query.inputIndex] = .confirmed(pinnedStop(name: query.input, country: "CH", latitude: 46.9, longitude: 7.4, input: query.input, inputIndex: query.inputIndex))
      }
    }
    return out
  }
}

private actor AskCounter {
  private var counts: [String: Int] = [:]
  func bump(_ key: String) -> Int {
    counts[key, default: 0] += 1
    return counts[key]!
  }
}

/// 手で置いた 1 点ぶんの材料。国コードだけが要るときの最短の形。
private func pinnedStop(
  name: String,
  country: String,
  latitude: Double,
  longitude: Double,
  input: String? = nil,
  inputIndex: Int? = nil
) -> ResolvedStop {
  ResolvedStop(
    id: "test-\(name)", name: name, area: "", latitude: latitude, longitude: longitude,
    sourceUrl: "", verifiedAt: "", confidence: .medium, planningDurationMinutes: 60,
    isAnchor: true, input: input ?? name, inputIndex: inputIndex, address: "", countryCode: country, provider: .user
  )
}
