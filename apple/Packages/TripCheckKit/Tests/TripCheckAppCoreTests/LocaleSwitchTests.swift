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

/// 選んだことが無ければ端末の言語。`Locale.current` は走らせる機械の設定なので、答えそのもの
/// ではなく**引く道**を検査する —— 保存が無いときに `systemLocale` が答えになること、
/// そして読めない値を保存が持っていても起動できること。
@Test @MainActor func withoutAChoiceTheDeviceLanguageDecides() async {
  let suite = defaults("noChoice")
  #expect(PlannerStore.storedLocale(in: suite) == nil)
  #expect([PlannerLocale.ja, .en].contains(PlannerStore.systemLocale))
  #expect(PlannerStore(resolvers: [], store: nil, defaults: suite).request.locale == PlannerStore.systemLocale)

  suite.set("en", forKey: PlannerStore.localeKey)
  #expect(PlannerStore.storedLocale(in: suite) == .en)
  suite.set("klingon", forKey: PlannerStore.localeKey)
  #expect(PlannerStore.storedLocale(in: suite) == nil)   // 読めない値は無かったことにする
  #expect(PlannerStore(resolvers: [], store: nil, defaults: suite).request.locale == PlannerStore.systemLocale)
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

/// **この test target は日本語の機械を前提にしている。**
///
/// 既定の `PlannerStore(resolvers:store:)` は `defaults:` を渡されないと `UserDefaults.standard`
/// を読み、そこに選択が無ければ `systemLocale`(= `Locale.current`)で立つ。AppCore の
/// テストは 152 か所がその入口で store を作り、日本語の文言を名指しで表明している ——
/// 英語の機械で `swift test` を回すと、そこが原因の分からない 20 本超の赤になる。
///
/// この 1 本はその赤に**名前を付ける**ためだけに在る。直すなら、152 か所へ言語を渡すか、
/// test target 全体に効く Swift Testing の trait で `Locale` を固定する(どちらも Task 14 の
/// 範囲を超えるので、README の「回す」節に前提として書いてある)。
@Test @MainActor func theseTestsAssumeAJapaneseDevice() {
  #expect(
    PlannerStore.systemLocale == .ja,
    "AppCore のテストは端末の言語が日本語であることを前提にしている（システム環境設定の優先言語を日本語にして回す）"
  )
}

/// 言語は旅ではなく人に属する。新しい旅を始めても訊き直さない。
@Test @MainActor func theLanguageSurvivesStartingANewTrip() async {
  let store = PlannerStore(resolvers: [], store: nil, defaults: defaults("survivesReset"))
  store.changeLocale(.en)
  store.reset()
  #expect(store.request.locale == .en)
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
