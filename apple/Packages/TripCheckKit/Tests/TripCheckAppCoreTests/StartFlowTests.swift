import Testing
@testable import TripCheckAppCore
import TripCheckKit

/*
 * Start 画面の裏側 —— 行きたい場所を 1 件ずつ足し、上限で止め、CTA を押したときに
 * 「そのまま組む」か「確認画面へ回す」かを決めるところ。
 */

/// 手で置いた 1 点。国コードだけが要るときの最短の材料。
@MainActor private func manualStop(id: String, name: String, country: String, latitude: Double, longitude: Double) -> ResolvedStop {
  ResolvedStop(id: id, name: name, area: "", latitude: latitude, longitude: longitude,
               sourceUrl: "", verifiedAt: "", confidence: .medium, planningDurationMinutes: 60,
               isAnchor: true, input: name, address: "", countryCode: country, provider: .user)
}

@Test @MainActor func thirteenthEntryIsRefused() async {
  let store = PlannerStore(resolvers: [], store: nil)
  for i in 0..<12 { await store.addEntry(text: "Place \(i)", suggestion: nil) }
  #expect(!store.canAddEntry)
  await store.addEntry(text: "Place 12", suggestion: nil)
  #expect(store.request.entries.count == 12)
  #expect(store.view.toast?.kind == .limit)
}

@Test @MainActor func startCtaNeedsPlacesAndGoesToResolveWhenAmbiguous() async {
  let store = PlannerStore(resolvers: [FakeResolver(review: ["Bern"])], store: nil)
  #expect(store.startCTA.enabled == false)
  await store.addEntry(text: "Bern", suggestion: nil); store.request.tripDays = 2
  #expect(store.startCTA.enabled)
  await store.requestBuildFromStart()
  #expect(store.view.screen == .resolve)
}

/// 全部きれいに決まったら確認画面は挟まない —— 旅行者は場所を打っただけで旅程に着く。
@Test @MainActor func placesThatAllResolveGoStraightToThePlan() async {
  let store = PlannerStore(resolvers: [FakeResolver()], store: nil)
  await store.addEntry(text: "Bern", suggestion: nil)
  await store.addEntry(text: "Thun", suggestion: nil)
  store.request.tripDays = 2

  await store.requestBuildFromStart()

  #expect(store.view.screen == .plan)
  #expect(store.bundle != nil)
  // 決まった場所は entry に固定される。固定しないと座標がエンジンへ渡らない。
  #expect(store.request.entries.allSatisfy { $0.pinned != nil })
  #expect(store.request.resolutions.count == 2)
  #expect(store.isResolvingPlaces == false)
}

/// 1 件でも見つからなければ、その 1 件だけのために確認画面へ回す(残りは決まったまま)。
@Test @MainActor func oneUnresolvedPlaceSendsTheWholeListToResolve() async {
  let store = PlannerStore(resolvers: [FakeResolver(unresolved: ["Nowhere"])], store: nil)
  await store.addEntry(text: "Bern", suggestion: nil)
  await store.addEntry(text: "Nowhere", suggestion: nil)

  await store.requestBuildFromStart()

  #expect(store.view.screen == .resolve)
  #expect(store.bundle == nil)
  let nowhere = store.request.entries[1]
  #expect(store.request.resolutions[nowhere.id] == .unresolved(reason: ResolutionPipeline.notFoundReason))
  #expect(store.request.entries[0].pinned != nil)   // 決まったほうは決まったまま
  #expect(nowhere.pinned == nil)
}

/// 場所が 2 か国にまたがったら、全部決まっていても組まない —— どちらの国の旅かで
/// 営業時間も祝日も変わるので、先に旅行者へ聞く(Web `usePlanBuild.tsx:1090-1105`)。
@Test @MainActor func placesInTwoCountriesStopAtTheResolveScreen() async {
  let store = PlannerStore(resolvers: [], store: nil)
  store.request.entries = [
    WishlistEntry(text: "ベルン", pinned: .manual(manualStop(id: "a", name: "ベルン", country: "CH", latitude: 46.94, longitude: 7.44))),
    WishlistEntry(text: "浅草寺", pinned: .manual(manualStop(id: "b", name: "浅草寺", country: "JP", latitude: 35.71, longitude: 139.79))),
  ]

  await store.requestBuildFromStart()

  #expect(store.request.mixedCountryCodes == ["CH", "JP"])
  #expect(store.view.screen == .resolve)
  #expect(store.bundle == nil)
}

/// 国を選ぶのは、その曖昧さに旅行者が答えたということ。跨ぎの報せは消し、検索の箱は
/// その国に寄せる(auto と worldwide は箱を持たない)。
@Test @MainActor func choosingACountryClearsTheMixedFlagAndNarrowsTheSearchBox() async {
  let store = PlannerStore(resolvers: [], store: nil)
  store.request.mixedCountryCodes = ["CH", "JP"]
  #expect(store.destinationBounds == nil)          // auto

  store.setDestination(.destination(.switzerland))
  #expect(store.request.destination == .destination(.switzerland))
  #expect(store.request.mixedCountryCodes.isEmpty)
  #expect(store.destinationBounds == Destinations.byId(.switzerland).bounds)
  #expect(store.destinationBounds != nil)

  store.setDestination(.destination(.worldwide))
  #expect(store.destinationBounds == nil)          // 世界中に箱は無い
}

/// 行きたい場所の 1 行を足す・優先度を変える・外す。`addEntrySync` が返す id が
/// そのまま行の取っ手になる(以降のタスクの編集シートが引く鍵)。
@Test @MainActor func entriesCanBePrioritisedAndRemovedById() async {
  let store = PlannerStore(resolvers: [], store: nil)
  let bern = store.addEntrySync(text: "ベルン")
  let thun = store.addEntrySync(text: "トゥーン")
  #expect(store.request.entries.map(\.id) == [bern, thun])

  store.setPriority(id: bern, .must)
  #expect(store.request.entries[0].priority == .must)
  #expect(store.request.entries[1].priority == .normal)

  store.removeEntry(id: bern)
  #expect(store.request.entries.map(\.text) == ["トゥーン"])
  #expect(store.canAddEntry)
}

/// ビルド前の条件は `edit` にだけ書く。`request` に写しを作らないので、`tripRequest()` が
/// 読む値と画面が書く値がずれない。
@Test @MainActor func preBuildConditionsAreWrittenToTheEditState() async {
  let store = PlannerStore(resolvers: [], store: nil)
  store.setPace(.fast)
  store.setTravelPreference(.car)
  store.setTransferBufferMinutes(20)
  store.setHotelQuery("ルツェルン駅の近く")

  #expect(store.edit.pace == .fast)
  #expect(store.edit.travelPreference == .car)
  #expect(store.edit.transferBufferMinutes == 20)
  #expect(store.edit.hotelQuery == "ルツェルン駅の近く")

  let req = store.tripRequest()
  #expect(req.pace == .fast)
  #expect(req.context.travelPreference == .car)
  #expect(req.context.transferBufferMinutes == 20)
  #expect(req.context.hotelQuery == "ルツェルン駅の近く")
}

/// CTA の文は 3 つとも別の文で、どれも空でない —— 押せない理由が「まだ場所が無い」のか
/// 「いま調べている」のかが読めなければ、旅行者は同じボタンを二度押す。
@Test @MainActor func theCtaLabelSaysWhichOfTheThreeStatesItIsIn() async {
  let store = PlannerStore(resolvers: [], store: nil)
  let app = AppCopy.for(store.request.locale)
  #expect(store.startCTA == (label: app.buildCTA, enabled: false))

  _ = store.addEntrySync(text: "ベルン")
  #expect(store.startCTA == (label: app.buildCTA, enabled: true))

  #expect(Set([app.buildCTA, app.checkingPlacesCTA, app.buildingCTA]).count == 3)
}

// MARK: - 行を外した後の並び

/*
 * 固定された行より**前**の行を外すと、以降の場所は行 1 つぶんずれて貼り付いていた ——
 * `ResolvedStop.inputIndex` が決まった時刻の並びで凍っており、`TripBuilder` は行と場所を
 * まずその番号で突き合わせるからである。最初にずれた行は場所を失ってカタログ送りになり
 * (`unknownEntries`)、最後の場所は旅程から黙って消え、行から読んだ制約は別の場所に効いた。
 * 外す道は 3 本(Start の行・行編集シート・確認画面)あり、どれも普通に押される。
 */

/// 3 件決めてから 1 行目を外す。残った 2 件は残った 2 行のまま組み上がる。
@Test @MainActor func removingTheFirstRowKeepsEveryRemainingPlaceOnItsOwnLine() async {
  let store = PlannerStore(resolvers: [FakeResolver()], store: nil)
  for name in ["Alpha Place", "Beta Place", "Gamma Place"] { await store.addEntry(text: name, suggestion: nil) }
  store.request.tripDays = 1
  await store.requestBuildFromStart()
  #expect(store.request.entries.allSatisfy { $0.pinned != nil })

  store.removeEntry(id: store.request.entries[0].id)
  await store.build()

  let planned = Set((store.bundle?.plan.days ?? []).flatMap { $0.stops.map(\.stop.name) })
  #expect(planned.isSuperset(of: ["Beta Place", "Gamma Place"]))
  #expect(planned.contains("Alpha Place") == false)
  #expect(store.bundle?.plan.unknownEntries.isEmpty == true)
  // エンジンへ渡る番号は、いまの並びそのもの。
  #expect(store.tripRequest().context.resolvedStops?.compactMap(\.inputIndex) == [0, 1])
}

/// 見本(8 か所)の 1 行目を外して組む。残る 7 か所が全部旅程に入り、不明な行は 1 つも出ない
/// —— 直す前は「リギ山」が不明になり、「ベルン旧市街」が旅程から消えていた。
@Test @MainActor func theSampleMinusItsFirstRowStillPlansTheOtherSeven() async {
  let store = PlannerStore(resolvers: [], store: nil)
  store.loadSample(.switzerland)
  let dropped = store.request.entries[0].text
  store.removeEntry(id: store.request.entries[0].id)
  #expect(store.request.entries.count == 7)

  await store.build()

  let planned = Set((store.bundle?.plan.days ?? []).flatMap { $0.stops.map(\.stop.name) })
  #expect(store.bundle?.plan.unknownEntries.isEmpty == true)
  #expect(planned.contains(dropped) == false)
  #expect(planned.isSuperset(of: store.request.entries.map { $0.pinned?.stop.name ?? $0.text }))
}

// MARK: - 検索窓で選んだ 1 件

/// 候補を選んで足した行は、その場で固定される(spec §5.2)。固定しないと、CTA の解決が
/// 同じ文字列でもう一度地図に尋ね、旅行者が目で見て選んだ 1 件が別の場所に化けうる。
@Test @MainActor func choosingASuggestionPinsThatVeryPlace() async {
  let hit = LocalSearchHit(
    name: "Bahnhof Bern", address: "Bahnhofplatz 10, 3011 Bern, Schweiz",
    latitude: 46.9490, longitude: 7.4390, countryCode: "CH", category: "museum"
  )
  let store = PlannerStore(
    resolvers: [ApplePlaceResolver(search: FakeSearch(hits: ["Bahnhof Bern": [hit]]))],
    store: nil
  )

  await store.addEntry(text: "Bahnhof Bern", suggestion: fakeSuggestion("Bahnhof Bern", subtitle: "Bern"))

  guard case .apple(let providerRef, let stop)? = store.request.entries.first?.pinned else {
    Issue.record("選んだ候補が行に固定されていない")
    return
  }
  #expect(providerRef == nil)          // MapKit の識別子は Web にとって別の提供元の番号なので持たない
  #expect(stop.name == "Bahnhof Bern")
  #expect(stop.latitude == 46.9490)
  #expect(stop.id.hasPrefix("apple-"))
  #expect(stop.sourceUrl.isEmpty)      // 「見つけた」であって「確かめた」ではない
  #expect(stop.verifiedAt.isEmpty)
  #expect(stop.confidence == .medium)
  #expect(stop.provider == .apple)
  #expect(store.resolveRows.first?.state == .confirmed)
}

/// 引き当てられなかったとき(打ち切り・通信の失敗)は、行が固定されないまま残るだけ ——
/// 落ちないし、行も消えない。CTA の解決が普通に尋ね直す。
@Test @MainActor func aSuggestionThatCannotBeLookedUpLeavesTheRowUnpinned() async {
  let store = PlannerStore(resolvers: [ApplePlaceResolver(search: FailingSearch())], store: nil)

  await store.addEntry(text: "Bahnhof Bern", suggestion: fakeSuggestion("Bahnhof Bern", subtitle: "Bern"))

  #expect(store.request.entries.count == 1)
  #expect(store.request.entries.first?.pinned == nil)
  #expect(store.request.entries.first?.text == "Bahnhof Bern")
}

// MARK: - Start で国を選び直す

/// 旅程を組んだ後に「入力にもどる」で帰ってくると、行は全部固定されている。そこで国を選び
/// 直したら、新しい箱の外に出た場所の固定は外れる —— 外れないと、`requestBuildFromStart` は
/// 固定済みの行を尋ね直さないので、日本の場所のままスイスの旅程が組み上がる(しかも跨ぎの
/// 報せは「国を選んだ」ことで消えている)。旅行者が地図に自分で置いた点だけは動かさない。
@Test @MainActor func choosingACountryOnStartDropsThePinsThatFellOutsideIt() async {
  let store = PlannerStore(resolvers: [], store: nil)
  store.request.entries = [
    WishlistEntry(text: "浅草寺", pinned: .catalog(manualStop(id: "jp-1", name: "浅草寺", country: "JP", latitude: 35.7148, longitude: 139.7967))),
    WishlistEntry(text: "東京駅", pinned: .apple(providerRef: nil, stop: manualStop(id: "jp-2", name: "東京駅", country: "JP", latitude: 35.6812, longitude: 139.7671))),
    WishlistEntry(text: "山小屋", pinned: .manual(manualStop(id: "own", name: "山小屋", country: "JP", latitude: 35.36, longitude: 138.72))),
  ]
  store.request.resolutions[store.request.entries[0].id] = .confirmed(store.request.entries[0].pinned!.stop)

  store.setDestination(.destination(.switzerland))

  #expect(store.request.entries[0].pinned == nil)     // カタログの決定は箱の外なので外れる
  #expect(store.request.entries[1].pinned == nil)     // 端末の地図の決定も同じ
  #expect(store.request.resolutions[store.request.entries[0].id] == nil)
  guard case .manual? = store.request.entries[2].pinned else {
    Issue.record("旅行者が自分で置いた点は、箱の外でも動かさない")
    return
  }
  #expect(store.request.mixedCountryCodes.isEmpty)
}
