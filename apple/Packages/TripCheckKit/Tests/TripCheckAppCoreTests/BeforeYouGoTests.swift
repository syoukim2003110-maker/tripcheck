import Foundation
import Testing
@testable import TripCheckAppCore
import TripCheckKit

/*
 * 出発前チェック —— Kit の `PreTripTimeline`(純関数)に、アプリだけが知っている 3 つを
 * 渡す層:旅行者が名乗った旅券の国、端末に置いた有効期限、そして今日。
 *
 * 判定の中身は Kit 側で検査済み(`PreTripTimelineTests`)なので、ここで守るのは**渡し方**
 * である。とりわけ Web と同じ門:日本のパスポート以外は**判定しない**。他国の旅券に
 * 日本向けの入国条件を当てて「不足」と言うのは、当たっていない可能性のほうが高い。
 */

// Task 10 brief §Step 1 tests (verbatim, R13 のとおり書き直したもの)。

@Test @MainActor func passportRuleOnlyJudgesJapanesePassports() async {
  let store = PlannerStore(resolvers: [], store: nil); store.loadSample(.switzerland)
  store.request.tripStartDate = "2026-10-13"   // tripDays = 4 は loadSample が置く。build() 無しでも request から start/end を導く
  store.setPassportCountry(.other); #expect(store.beforeYouGo.items.isEmpty)   // Web と同じ: JP 以外は判定しない(空)
  store.setPassportCountry(.jp); store.setPassportExpiry("2027-01-01")
  // スイス(Schengen)は出国日 2026-10-16 + 3 か月 = 2027-01-16 まで必要 → 不足
  let passport = store.beforeYouGo.items.first { $0.id == "passport" }
  #expect(passport?.urgency == .overdue)
  #expect(passport?.label.contains("パスポート") == true)
}

@Test @MainActor func etiasIsNotRequiredYetAndKEtaExpiresEndOf2026() async {
  let fr = PlannerStore(resolvers: [], store: nil); fr.setPassportCountry(.jp)
  fr.request.destination = .destination(.france); fr.request.tripStartDate = "2026-10-13"; fr.request.tripDays = 3
  #expect(fr.beforeYouGo.items.first { $0.label.contains("ETIAS") }?.urgency == .info)
  let kr = PlannerStore(resolvers: [], store: nil); kr.setPassportCountry(.jp)
  kr.request.destination = .destination(.korea); kr.request.tripStartDate = "2027-02-01"; kr.request.tripDays = 3
  let keta = kr.beforeYouGo.items.first { $0.label.contains("K-ETA") }
  #expect(keta?.urgency == .info)
  #expect(keta?.label.contains("期間外") == true)   // 免除期間(2026-12-31)を過ぎた旅行。detail は常に summary で「免除」を含むので detail には表明しない
}

// 残りの約束。

/// 国を選んでいない旅行者にも、選び直した旅行者にも、勝手な判定は出ない。
@Test @MainActor func nothingIsJudgedUntilTheTravellerNamesTheirPassport() async {
  let store = PlannerStore(resolvers: [], store: nil, defaults: defaults("unset"))
  store.loadSample(.switzerland); store.request.tripStartDate = "2026-10-13"
  #expect(store.beforeYouGo.passportCountry == .unset)
  #expect(store.beforeYouGo.items.isEmpty)
  store.setPassportCountry(.jp)
  #expect(!store.beforeYouGo.items.isEmpty)
  store.setPassportCountry(.unset)
  #expect(store.beforeYouGo.items.isEmpty)
}

/// 有効期限は端末に残り、次に開いたときも残っている。**通信には出ない** —— この 1 件を
/// 誰かのサーバに送る理由がどこにも無い。
@Test @MainActor func thePassportExpiryStaysOnTheDeviceAndComesBack() async {
  let suite = defaults("expiry")
  let first = PlannerStore(resolvers: [], store: nil, defaults: suite)
  first.setPassportCountry(.jp); first.setPassportExpiry("2029-05-04")
  #expect(first.beforeYouGo.passportExpiry == "2029-05-04")
  #expect(suite.string(forKey: PlannerStore.passportExpiryKey) == "2029-05-04")

  let reopened = PlannerStore(resolvers: [], store: nil, defaults: suite)
  #expect(reopened.beforeYouGo.passportExpiry == "2029-05-04")

  reopened.setPassportExpiry(nil)
  #expect(reopened.beforeYouGo.passportExpiry == nil)
  #expect(suite.string(forKey: PlannerStore.passportExpiryKey) == nil)
}

/// 日付を入れていない旅にも門は開く —— 期限のある宿題は出ないが、「何が要るか」は読める。
/// 日付の無い旅程が持たないのは**締切**であって、入国条件そのものではない。
@Test @MainActor func anUndatedTripStillShowsWhatThePaperworkIs() async {
  let store = PlannerStore(resolvers: [], store: nil, defaults: defaults("undated"))
  store.request.destination = .destination(.usa)
  store.request.tripStartDate = nil
  store.setPassportCountry(.jp)
  let items = store.beforeYouGo.items
  #expect(items.count == 2)
  #expect(items.allSatisfy { $0.urgency == .info })
  #expect(items.contains { $0.id == "authority-ESTA" })
}

/// 旅程が組み上がっていれば、日付は**旅程の日**から取る —— 入力欄の開始日と、実際に
/// 組み上がった 1 日目がずれる旅(到着便が深夜に着く旅)で、締切が 1 日ずれない。
@Test @MainActor func theDatesComeFromThePlanOnceItExists() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil, defaults: defaults("plan"))
  store.loadSample(.switzerland)
  store.request.tripStartDate = "2026-10-13"
  await store.build()
  store.setPassportCountry(.jp); store.setPassportExpiry("2027-01-10")
  guard let dates = store.bundle?.plan.days.compactMap(\.date), let last = dates.last else {
    Issue.record("the sample builds four dated days"); return
  }
  #expect(last == "2026-10-16")
  // 出国日 + 3 か月 = 2027-01-16。期限 2027-01-10 では 6 日足りない。
  #expect(store.beforeYouGo.items.first { $0.id == "passport" }?.urgency == .overdue)
}

/// リンクは URL として渡す —— ビューが文字列から `URL` を組み立てる口を持つと、壊れた
/// リンクがボタンの形をしたまま画面に残る。
@Test @MainActor func officialLinksArriveAsRealUrls() async {
  let store = PlannerStore(resolvers: [], store: nil, defaults: defaults("links"))
  store.request.destination = .destination(.korea)
  store.request.tripStartDate = "2027-02-01"
  store.setPassportCountry(.jp)
  var checked = 0
  for item in store.beforeYouGo.items {
    #expect(item.url != nil, "\(item.id)")
    #expect(item.url?.scheme == "https", "\(item.id)")
    #expect(!item.detail.isEmpty)
    checked += 1
  }
  #expect(checked == 2)
}

/// 薬と国ごとの基本情報は、旅券の国とは無関係に出る —— どの国の旅券でも、電源プラグの形も
/// 救急番号も同じである。入国条件だけが日本の旅券に閉じている。
@Test @MainActor func medicineAndBasicsDoNotDependOnThePassport() async {
  let store = PlannerStore(resolvers: [], store: nil, defaults: defaults("basics"))
  store.request.destination = .destination(.switzerland)
  let model = store.beforeYouGo
  #expect(model.medicineLines == [Copy.for(.ja).beforeMedication, Copy.for(.ja).beforeMedicationNote])
  let labels = model.essentials.map(\.label)
  #expect(labels.contains(Copy.for(.ja).essentialsPlug))
  #expect(labels.contains(Copy.for(.ja).essentialsEmergency))
  #expect(labels.contains(Copy.for(.ja).essentialsPass))          // スイストラベルパス
  #expect(!labels.contains(Copy.for(.ja).essentialsEntry))        // 入国は日本の旅券のときだけ
  store.setPassportCountry(.jp)
  #expect(store.beforeYouGo.essentials.map(\.label).contains(Copy.for(.ja).essentialsEntry))
  #expect(store.beforeYouGo.essentials.allSatisfy { !$0.value.isEmpty })
}

/// 国内旅行に薬の持ち込みの話は要らない(Web と同じ門)。
@Test @MainActor func aTripInsideJapanDropsTheMedicineLines() async {
  let store = PlannerStore(resolvers: [], store: nil, defaults: defaults("japan"))
  store.request.destination = .destination(.japan)
  #expect(store.beforeYouGo.medicineLines.isEmpty)
  store.request.destination = .destination(.thailand)
  #expect(store.beforeYouGo.medicineLines.count == 2)
}

/// 行き先を決めていない旅には、まだ言えることが無い。
@Test @MainActor func anUnknownDestinationSaysNothingRatherThanGuessing() async {
  let store = PlannerStore(resolvers: [], store: nil, defaults: defaults("auto"))
  store.setPassportCountry(.jp)
  #expect(store.request.destination == .auto)
  #expect(store.beforeYouGo.items.isEmpty)
  #expect(store.beforeYouGo.essentials.isEmpty)
}

/// テストごとに空の `UserDefaults` を配る。既定の suite を共有すると、並列で走る別の
/// テストが置いた有効期限をこちらが読むことになる。
@MainActor private func defaults(_ name: String) -> UserDefaults {
  let suite = "tripcheck.tests.beforeyougo.\(name)"
  UserDefaults.standard.removePersistentDomain(forName: suite)
  return UserDefaults(suiteName: suite)!
}
