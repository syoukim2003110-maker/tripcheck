import Foundation
import Testing
@testable import TripCheckAppCore
import TripCheckKit

/*
 * 言語の切り替え。
 *
 * 守るのは 3 つ。**組んだ旅程を捨てない**(切り替えは表示の話で、旅の中身の話ではない)、
 * **選んだ言語は端末に残る**(次に開いたときに訊き直さない)、そして**走っている組み立ての
 * 答えは捨てる**(切り替える前の言葉で組まれた束が、切り替えた後の画面に着かない)。
 */

@Test @MainActor func changingTheLanguageKeepsThePlanAndFlipsTheWording() async {
  let store = PlannerStore(resolvers: [], store: nil, defaults: defaults("keepsThePlan"))
  store.loadSample(.switzerland)
  await store.build()

  let japanese = store.hero.text
  let japaneseRows = store.timelineRows(0).count
  #expect(!japanese.isEmpty)
  #expect(japaneseRows > 0)
  #expect(store.view.screen == .plan)
  let built = store.bundle

  store.changeLocale(.en)

  #expect(store.request.locale == .en)
  #expect(store.bundle != nil)                        // 旅程は捨てない
  #expect(store.bundle?.plan == built?.plan)          // 組み直してもいない —— 同じ束のまま
  #expect(store.view.screen == .plan)                 // 画面も動かない
  #expect(!store.hero.text.isEmpty)
  #expect(store.hero.text != japanese)                // 見出しは新しい言葉で言い直される
  #expect(store.timelineRows(0).count == japaneseRows)

  store.changeLocale(.ja)
  #expect(store.hero.text == japanese)                // 戻せば元の 1 文に戻る
}

@Test @MainActor func theChosenLanguageComesBackNextTime() async {
  let suite = defaults("comesBack")
  let first = PlannerStore(resolvers: [], store: nil, defaults: suite)
  first.changeLocale(.en)
  #expect(suite.string(forKey: PlannerStore.localeKey) == "en")

  let reopened = PlannerStore(resolvers: [], store: nil, defaults: suite)
  #expect(reopened.request.locale == .en)

  reopened.changeLocale(.ja)
  #expect(PlannerStore(resolvers: [], store: nil, defaults: suite).request.locale == .ja)
}

/// 選んだことが無ければ**呼び出し元が渡した既定**(`initialLocale`)。`Locale.current` を
/// 読むのは合成の根(`TripCheckApp.init`)だけで、`PlannerStore.init` 自身はそれを知らない ——
/// ここが検査するのは合成そのもの:保存が無ければ `initialLocale` がそのまま答えになり、
/// 保存があれば `initialLocale` に何を渡していても保存のほうが勝つこと。読めない値を保存が
/// 持っていても起動できることも同じ 1 本で見る。
@Test @MainActor func withoutAChoiceTheDeviceLanguageDecides() async {
  let suite = defaults("noChoice")
  #expect(PlannerStore.storedLocale(in: suite) == nil)
  #expect(PlannerStore(resolvers: [], store: nil, defaults: suite, initialLocale: .en).request.locale == .en)

  suite.set("en", forKey: PlannerStore.localeKey)
  #expect(PlannerStore.storedLocale(in: suite) == .en)
  suite.set("klingon", forKey: PlannerStore.localeKey)
  #expect(PlannerStore.storedLocale(in: suite) == nil)   // 読めない値は無かったことにする
  #expect(PlannerStore(resolvers: [], store: nil, defaults: suite, initialLocale: .en).request.locale == .en)

  suite.set("ja", forKey: PlannerStore.localeKey)
  #expect(PlannerStore.storedLocale(in: suite) == .ja)
  // 保存してある選択は、渡された既定が何であっても勝つ —— `initialLocale: .en` を渡しても
  // 保存の `ja` が答えになる。
  #expect(PlannerStore(resolvers: [], store: nil, defaults: suite, initialLocale: .en).request.locale == .ja)
}

/// 走っている組み立ては切り替えで捨てる —— 切り替える前の言葉で組んだ束が、切り替えた後の
/// 画面へ遅れて着かない。捨てたまま待ち画面に取り残さないことも同じ 1 手で見る。
@Test @MainActor func changingTheLanguageAbandonsAnInFlightBuild() async {
  let store = PlannerStore(resolvers: [], store: nil, defaults: defaults("abandons"))
  store.loadSample(.switzerland)

  let gate = LocaleBuildGate()
  store.buildGate = { await gate.hold() }
  async let building: Void = store.build()
  await gate.waitUntilHeld()             // 日本語で組んだ答えは出来たが、まだ commit していない
  #expect(store.view.screen == .building)

  store.changeLocale(.en)
  await gate.open()
  await building

  #expect(store.bundle == nil)           // 遅れて届いた束は着かない
  #expect(store.view.screen == .start)   // 待ち画面には取り残さない
  #expect(store.request.locale == .en)
}

/// 言語は旅ではなく人に属する。新しい旅を始めても訊き直さない。
@Test @MainActor func theLanguageSurvivesStartingANewTrip() async {
  let store = PlannerStore(resolvers: [], store: nil, defaults: defaults("survivesReset"))
  store.changeLocale(.en)
  store.reset()
  #expect(store.request.locale == .en)
}

/// 保存した旅を開き直しても同じ道理。旅は ja で保存してあっても、開く**人**が en を選んで
/// いれば en のまま開く —— `openTrip` が保存してある `input.tripRequestState().locale`
/// (旅の言語)をそのまま採用すると、開いた瞬間に人の選択を踏みつぶす(Important 2)。
///
/// 言語を選ぶ側は `store: nil` の別の `PlannerStore`(`defaults` だけ共有)で作る —— 旅を
/// 保存した store で `changeLocale` まで呼ぶと、その変化がまた自動保存を起こして旅の記録
/// 自体が en に書き換わり、「開き直しが人の選択を勝たせている」のか「そもそも旅が en で
/// 保存されていた」のか見分けが付かなくなる。
@Test @MainActor func openingASavedTripKeepsTheTravellersStoredLanguage() async throws {
  let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  let suite = defaults("openKeepsStored")

  let saver = PlannerStore(
    resolvers: [],
    store: TripStore(directory: dir),
    autosaveDebounce: .milliseconds(10),
    defaults: suite
  )
  saver.loadSample(.switzerland)                  // ja のまま保存する
  #expect(saver.request.locale == .ja)

  var id: String?
  for _ in 0..<250 {
    await saver.loadRecent()
    if let first = saver.recentTrips.first { id = first.id; break }
    try? await Task.sleep(for: .milliseconds(20))
  }
  guard let tripId = id else { Issue.record("nothing saved"); return }

  let chooser = PlannerStore(resolvers: [], store: nil, defaults: suite)
  chooser.changeLocale(.en)                       // 人が en を選ぶ(保存には残るが旅は動かない)
  #expect(suite.string(forKey: PlannerStore.localeKey) == "en")

  let reopener = PlannerStore(resolvers: [], store: TripStore(directory: dir), defaults: suite)
  await reopener.openTrip(id: tripId)             // 保存してあった旅は ja のまま
  #expect(reopener.request.locale == .en)         // だが答えは人の選択
}

// MARK: - 支度

/// `PlannerStoreBuildTests` の関所と同じ仕掛け。あちらのものは file-private なので、こちらは
/// 自分のぶんを持つ。
private actor LocaleBuildGate {
  private var held = false
  private var opened = false
  private var arrivals: [CheckedContinuation<Void, Never>] = []
  private var departures: [CheckedContinuation<Void, Never>] = []

  func hold() async {
    held = true
    for waiter in arrivals { waiter.resume() }
    arrivals.removeAll()
    guard !opened else { return }
    await withCheckedContinuation { departures.append($0) }
  }

  func waitUntilHeld() async {
    guard !held else { return }
    await withCheckedContinuation { arrivals.append($0) }
  }

  func open() {
    opened = true
    for waiter in departures { waiter.resume() }
    departures.removeAll()
  }
}

/// テストごとに空の `UserDefaults` を配る。既定の suite を共有すると、並列で走る別の
/// テストが選んだ言語をこちらが読むことになる。
@MainActor private func defaults(_ name: String) -> UserDefaults {
  let suite = "tripcheck.tests.locale.\(name)"
  UserDefaults.standard.removePersistentDomain(forName: suite)
  return UserDefaults(suiteName: suite)!
}
