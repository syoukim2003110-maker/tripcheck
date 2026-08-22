import Testing
@testable import TripCheckAppCore
import TripCheckKit

/*
 * 結果画面が読む導出値。**ビューは計算しない**ので、5 つの問い(成立するか・いちばん重い
 * 警告 1 件・どの日がどれだけ埋まっているか・停留所・空き)の答えは全部ここで検査できる。
 */

/// 帯は使える窓の全部を表す —— 3 区間の割合が 1 に足りなければ、日の一部がどこにも
/// 属さないまま消える。
@Test @MainActor func dayTimeBarSumsToOne() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  #expect(store.dayTabs.count == 4)
  for i in 0..<4 { let b = store.dayHeader(i).bar; #expect(abs(b.visit + b.travel + b.slack - 1) < 1e-9) }
}

/// 見出しと警告は旅行者が読む文。社内語が混ざっていないこと、状態の絵が 5 つのうちの
/// 1 つであること、統計行が場所の数を持っていること。
@Test @MainActor func heroAndWarningPassBannedTerms() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  #expect(BannedTerms.violations(in: store.hero.text).isEmpty)
  #expect(["check", "signal", "spark", "close", "search"].contains(store.hero.icon))   // Icon は App 側の型。AppCore では rawValue 文字列だけを見る
  if let w = store.primaryWarning { #expect(BannedTerms.violations(in: w.text).isEmpty) }
  #expect(store.statsLine.contains("8"))
}

/// 警告は 1 件だけで、**対象を名指しする** —— 「1件が未解決です」では、旅行者はどれを
/// 直せばよいか分からない。
@Test @MainActor func onlyOneWarningAndItNamesTheTarget() async {
  let store = PlannerStore(resolvers: [FakeResolver(unresolved: ["Nowhere"])], store: nil)
  store.loadSample(.switzerland); await store.addEntry(text: "Nowhere", suggestion: nil)
  await store.requestBuildFromStart(); await store.continueFromResolve(force: true)
  #expect(store.primaryWarning?.text.contains("Nowhere") == true)
  #expect(store.primaryWarning?.action == .fixInput)
}

/// 前段の 3 つには順位がある。国が混ざっているだけなら国を選ばせ、未解決も抱えていたら
/// **未解決が勝つ** —— 場所が決まらないうちに国を選んでも、その場所は旅程に入らない。
@Test @MainActor func theFrontWarningsKeepTheirOrder() async {
  let store = PlannerStore(resolvers: [FakeResolver(unresolved: ["Nowhere"])], store: nil)
  store.loadSample(.switzerland); await store.build()

  store.request.mixedCountryCodes = ["CH", "JP"]
  #expect(store.primaryWarning?.action == .chooseCountry)
  #expect(store.primaryWarning?.text.contains("CH") == true)

  let ambiguous = store.request.entries[0]
  store.request.resolutions[ambiguous.id] = .review([])
  #expect(store.primaryWarning?.action == .chooseCountry)   // 国のほうが上

  store.request.mixedCountryCodes = []
  #expect(store.primaryWarning?.action == .chooseCandidate)
  #expect(store.primaryWarning?.text.contains(ambiguous.text) == true)
}

/// 状態 5 つと絵 5 つは 1 対 1。1 行でも取り違えると、成立した旅に赤い × が出る。
@Test func theHeroIconNamesEachVerdictState() {
  #expect(PlannerStore.heroIcon(.VERIFIED_FEASIBLE) == "check")
  #expect(PlannerStore.heroIcon(.PROVISIONAL_FEASIBLE) == "signal")
  #expect(PlannerStore.heroIcon(.FEASIBLE_IF_ASSUMPTIONS) == "spark")
  #expect(PlannerStore.heroIcon(.INFEASIBLE_HARD_CONFLICT) == "close")
  #expect(PlannerStore.heroIcon(.UNKNOWN) == "search")
  #expect(Set(FeasibilityState.allCases.map(PlannerStore.heroIcon)).count == 5)
}

/// 日タブは Kit の 3 つの関数がそのまま出す —— アプリ側で数え直すと、地図のピンと日の色が
/// ずれる。
@Test @MainActor func dayTabsCarryTheKitLabelColourAndDensity() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let plan = store.bundle?.plan
  #expect(plan != nil)
  for tab in store.dayTabs {
    #expect(tab.label == TimelinePresentation.dayTabTitle(index: tab.index, locale: .ja))
    #expect(tab.colorHex == DayPalette.color(forDayIndex: tab.index))
    #expect(tab.density == TimelinePresentation.dayTabDensityLabel(
      stopCount: plan?.days[tab.index].stops.count ?? -1,
      locale: .ja
    ))
  }
  #expect(store.dayTabs.count == 4)
}

/// 日の見出しは、旅行者が日付を入れるまで「1日目」のまま —— 決めていない日付を
/// 勝手に名乗らない。入れたら曜日つきの日付に変わる。
@Test @MainActor func theDayHeaderNamesADateOnlyOnceTheTravellerGaveOne() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland); await store.build()
  #expect(store.dayDateLabel(0) == TimelinePresentation.dayTabTitle(index: 0, locale: .ja))

  store.request.tripStartDate = "2026-08-24"
  await store.build()
  let label = store.dayDateLabel(0)
  #expect(label.contains("2026-08-24"))
  #expect(label != TimelinePresentation.dayTabTitle(index: 0, locale: .ja))
}

/// 帯の印は帯の中にいる。0 未満・1 超のところに描くと、指した場所と時刻がずれる。
@Test @MainActor func barMarkersStayInsideTheTrack() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  var checked = 0
  for index in 0..<store.dayTabs.count {
    let bar = store.dayHeader(index).bar
    #expect(!bar.a11y.isEmpty)
    #expect(BannedTerms.violations(in: bar.a11y).isEmpty)
    for marker in bar.markers {
      #expect(marker.position >= 0 && marker.position <= 1)
      checked += 1
    }
    checked += 1
  }
  #expect(checked > 0)
}

/// 組む前でも帯は 1 に足りる(ビューは `GeometryReader` で幅を配るので、合計が 1 でない
/// モデルは黙って幅を失う)。中身が無いことは `isEmpty` が言う。
@Test @MainActor func theBarIsWholeEvenBeforeAnyBuild() async {
  let store = PlannerStore(resolvers: [], store: nil)
  let bar = store.dayHeader(0).bar
  #expect(abs(bar.visit + bar.travel + bar.slack - 1) < 1e-9)
  #expect(bar.isEmpty)
  #expect(store.dayHeader(0).summary.isEmpty)
  #expect(store.hero.text.isEmpty)
  #expect(store.statsLine.isEmpty)
  #expect(store.primaryWarning == nil)
  #expect(store.issues.isEmpty)
}

/// 空きの行は**空いている日にだけ**出す。余裕が無い日に「あと何か所」と誘わない。
@Test @MainActor func theSpareLineOnlyAppearsWhereTimeIsLeft() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  var checked = 0
  for (index, day) in (store.bundle?.fit.days ?? []).enumerated() {
    let line = store.spareCapacityLine(index)
    if day.slackMinutes > 0 {
      #expect(line != nil)
      #expect(BannedTerms.violations(in: line ?? "").isEmpty)
    } else {
      #expect(line == nil)
    }
    checked += 1
  }
  #expect(checked == 4)
  #expect(store.spareCapacityLine(99) == nil)
}

/// 課題は**種類ごとに 1 行**。同じ種類が 2 行出ると、旅行者は同じ心配を 2 回数える。
@Test @MainActor func issuesCarryEachKindAtMostOnce() async {
  let store = PlannerStore(resolvers: [FakeResolver(unresolved: ["Nowhere"])], store: nil)
  store.loadSample(.switzerland); await store.addEntry(text: "Nowhere", suggestion: nil)
  await store.requestBuildFromStart(); await store.continueFromResolve(force: true)

  let kinds = store.issues.map(\.kind)
  #expect(Set(kinds).count == kinds.count)
  #expect(kinds.contains(.unresolvedInput))
  for issue in store.issues {
    #expect(!issue.text.isEmpty)
    #expect(BannedTerms.violations(in: issue.text).isEmpty)
  }
  #expect(store.issues.first { $0.kind == .unresolvedInput }?.action == .fixInput)
}

/// 行動のラベルは Kit 由来なら Kit の文、アプリ由来なら `AppCopy`。空のラベルのボタンを
/// 出さない。
@Test func everyWarningActionHasALabel() {
  var checked = 0
  for locale in [PlannerLocale.ja, .en] {
    for action: PlanWarningAction in [.fixInput, .chooseCountry, .chooseCandidate, .openAlternatives, .openStop("s1"), .removeOptional, .retryBuild] {
      let label = action.label(locale)
      #expect(!label.isEmpty)
      #expect(BannedTerms.violations(in: label).isEmpty)
      checked += 1
    }
  }
  #expect(checked == 14)
}

/// Kit の 3 つの行動は、アプリ側の名前へ 1 対 1 で写る。`reviewConditions` だけは行き先が
/// 2 つ(特定の停留所が分かるならそこへ、分からなければ入力へ)。
@Test func theKitActionsMapOntoTheAppActions() {
  #expect(PlanWarningAction(kit: .seeAlternatives, stopId: nil) == .openAlternatives)
  #expect(PlanWarningAction(kit: .seeWhatToRemove, stopId: nil) == .removeOptional)
  #expect(PlanWarningAction(kit: .reviewConditions, stopId: "stop-7") == .openStop("stop-7"))
  #expect(PlanWarningAction(kit: .reviewConditions, stopId: nil) == .fixInput)
  let noAction: WarningAction? = nil
  #expect(PlanWarningAction(kit: noAction, stopId: "stop-7") == nil)
}

/// 日を選ぶのは 1 か所だけ。範囲の外を渡されても、無い日を選んだ画面にしない。
@Test @MainActor func selectDayStaysInsideThePlan() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  store.selectDay(2)
  #expect(store.view.selectedDay == 2)
  store.selectDay(99)
  #expect(store.view.selectedDay == 3)
  store.selectDay(-4)
  #expect(store.view.selectedDay == 0)
}
