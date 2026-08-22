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
