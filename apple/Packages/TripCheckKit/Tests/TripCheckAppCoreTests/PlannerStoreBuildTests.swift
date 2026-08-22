import Testing
@testable import TripCheckAppCore
import TripCheckKit

@Test @MainActor func tripRequestNeverReadsViewState() async {
  // コンパイル時の保証に加えて、view を変えても TripRequest が同一であること
  let store = PlannerStore(resolvers: [], store: nil)
  store.loadSample(.switzerland)
  let a = store.tripRequest()
  store.view.selectedDay = 3
  store.view.mobileView = .map
  store.view.verdictExpanded = true
  #expect(store.tripRequest() == a)
  #expect(a.days == 4)   // loadSample の request.tripDays が edit.tripDays(.empty の 3)に勝つ
}

/// `tripRequest()` は `request` と `edit` の 2 か所からエンジンの文脈を組む。どちらの欄が
/// どこへ行くかは以降のタスク(条件 UI・編集・共有)が全部この対応に乗るので、代表的な欄を
/// 名指しで留めておく。
@Test @MainActor func tripRequestCarriesRequestAndEditIntoTheEngineContext() async {
  let store = PlannerStore(resolvers: [], store: nil)
  store.loadSample(.switzerland)
  store.edit.pace = .fast
  store.edit.hotelQuery = "ルツェルン駅の近く"
  store.edit.transferBufferMinutes = 30
  store.edit.travelPreference = .car
  store.edit.removedStops = [PlannerRemovedStop(id: "sample-switzerland-1", name: "リギ山")]
  store.request.departureAirport = "ZRH"   // 到着側は空のまま = 指定なし
  let req = store.tripRequest()
  #expect(req.pace == .fast)
  #expect(req.locale == .ja)
  #expect(req.context.hotelQuery == "ルツェルン駅の近く")
  #expect(req.context.transferBufferMinutes == 30)
  #expect(req.context.travelPreference == .car)
  #expect(req.context.excludedStopIds == ["sample-switzerland-1"])
  #expect(req.context.arrivalAirport == nil)        // 空文字は番兵。nil に畳む
  #expect(req.context.departureAirport == "ZRH")
  #expect(req.context.destination == .destination(.switzerland))
  #expect(req.context.defaultDayStart == "09:00")
  // loadSample が固定したカタログの 8 地点がそのまま文脈に載る
  #expect(req.context.resolvedStops?.count == 8)
  #expect(req.raw.contains("ユングフラウヨッホ — 必須"))
}

@Test @MainActor func staleBuildsAreDropped() async {
  let store = PlannerStore(resolvers: [], store: nil)
  store.loadSample(.switzerland)
  async let first: Void = store.build()
  store.request.tripDays = 2          // 変更 → 世代が進む
  await store.build()
  await first
  #expect(store.bundle?.request.days == 2)
  #expect(store.edit.tripDays == 2)   // commit が edit.tripDays を追従させる
  #expect(store.view.screen == .plan)
}

/// 上の `staleBuildsAreDropped` は「入力を変えてから組み直したら、新しい入力の旅程が残る」と
/// いう**結果**を見る。それだけだと、先に始まったほうが世代を取る前に入力が変わってしまい、
/// 2 回とも同じ日数で組んで「捨てる」場面が一度も起きないことがある(実測した)。
///
/// こちらは古い世代を確実に作る:先に始まった組み立てが世代を取り切る(= 4 日の
/// `TripRequest` を掴む)まで待ってから入力を 2 日に変える。4 日ぶんの答えは後から返るので、
/// 世代ガードが無ければ 2 日の旅程を上書きしてしまう。
@Test @MainActor func anOlderBuildLandingLateCannotOverwriteTheNewerOne() async {
  let store = PlannerStore(resolvers: [], store: nil)
  store.loadSample(.switzerland)   // 4 日
  let before = store.buildGeneration
  async let stale: Void = store.build()
  var spins = 0
  while store.buildGeneration == before, spins < 1_000 {
    await Task.yield()
    spins += 1
  }
  // 世代を取った時点で、その組み立ては既に 4 日の TripRequest を掴んで計算に入っている
  // (`build()` は世代を進めてから `tripRequest()` を読み、次の中断点まで一気に走る)。
  #expect(store.buildGeneration == before + 1)

  store.request.tripDays = 2
  await store.build()
  #expect(store.bundle?.request.days == 2)

  await stale
  #expect(store.bundle?.request.days == 2)   // 4 日ぶんの答えは返ってきたが、世代が違うので捨てられた
  #expect(store.edit.tripDays == 2)
  #expect(store.view.screen == .plan)
}

@Test @MainActor func cancellingABuildDiscardsItsAnswer() async {
  let store = PlannerStore(resolvers: [], store: nil)
  store.loadSample(.switzerland)
  let before = store.buildGeneration
  async let running: Void = store.build()
  var spins = 0
  while store.buildGeneration == before, spins < 1_000 {
    await Task.yield()
    spins += 1
  }
  #expect(store.view.screen == .building)

  store.cancelBuild()
  await running
  #expect(store.bundle == nil)           // 計算は最後まで走るが、受け取る側が居ない
  #expect(store.view.screen == .start)   // まだ旅程が無いので入力画面へ戻す
}

@Test @MainActor func resetClearsTheTripAndTheUndoLedger() async {
  let store = PlannerStore(resolvers: [], store: nil)
  store.loadSample(.switzerland)
  await store.build()
  #expect(store.bundle != nil)

  store.reset()
  #expect(store.bundle == nil)
  #expect(store.request.entries.isEmpty)
  #expect(store.request.tripDays == 3)     // TripRequestState.initial の既定
  #expect(store.request.destination == .auto)
  #expect(store.request.locale == .ja)     // ロケールは端末の設定なので引き継ぐ
  #expect(store.edit == .empty)
  #expect(store.view.screen == .start)
  #expect(store.history.canUndo == false)
  #expect(store.history.present == .empty)
}

@Test @MainActor func sampleBuildsWithZeroKeys() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland)
  await store.build()
  #expect(store.bundle?.plan.days.count == 4)
  #expect(store.bundle?.plan.days.allSatisfy { !$0.stops.isEmpty } == true)
  #expect(store.bundle?.result.alternatives.count == store.bundle?.counterfactuals.count)   // derive に counterfactuals を渡している
  #expect(store.view.screen == .plan)
}

/// 見本は「鍵ゼロで最後まで通る」ことの証明なので、8 か所ぜんぶが座標つきで固定され、
/// 組み上がった旅程に不明な行が 1 つも残らないところまで見る。
@Test @MainActor func sampleArrivesFullyPinnedAndNothingIsLeftUnknown() async {
  let store = PlannerStore(resolvers: [], store: nil)
  store.loadSample(.switzerland)
  #expect(store.request.entries.count == 8)
  #expect(store.request.entries.allSatisfy { $0.pinned != nil })
  #expect(store.request.entries.first { $0.text == "ユングフラウヨッホ" }?.priority == .must)
  #expect(store.request.inputMode == .wishlist)   // 見本に日の見出しは無い
  #expect(store.request.destination == .destination(.switzerland))

  await store.build()
  #expect(store.bundle?.plan.unknownEntries.isEmpty == true)
  #expect(store.bundle?.plan.inputMode == .wishlist)
  #expect(store.view.announcement?.isEmpty == false)   // 結論の見出しを読み上げに載せている
}

/// 日数「未定」の枝(`build()` の `daysUndecided`)。日数と拠点は互いに依存するので不動点を
/// 回すが、**旅行者が自分で決めたホテルはその中で動かない** —— Kit の `baseFor` は
/// `resolvedHotel ?? recommendBase(candidate)`(`Scenarios/ProvisionalTripLength.swift:79-81`)で、
/// 既定の `contextFor` は毎ラウンド `resolvedBase` を書き換える。`resolvedHotel:` を渡し忘れると
/// 「未定」を選んだだけでホテルが推薦の拠点に黙って差し替わる。
@Test @MainActor func undecidedLengthKeepsTheTravellersOwnHotel() async {
  let store = PlannerStore(resolvers: [], store: nil)
  store.loadSample(.switzerland)
  let hotel = SwissSample.resolvedStops(locale: .ja)[2]   // インターラーケン
  store.edit.resolvedBase = hotel
  store.request.tripDays = nil   // 「未定」——(日数, 拠点)の不動点が走る

  await store.build()

  #expect((store.bundle?.request.days ?? 0) > 0)   // 不動点が日数を決めた
  #expect(store.bundle?.request.context.resolvedBase?.id == hotel.id)   // 推薦ではなく旅行者のホテル
  #expect(store.edit.tripDays == store.bundle?.request.days)
  #expect(store.view.screen == .plan)
}
