import Testing
@testable import TripCheckAppCore
import TripCheckKit

/*
 * 「結論の詳細」が読む導出値。
 *
 * ここで守っているのは 1 つ:**代替案の差分は生の数で出る**。分を時間に見せた瞬間、
 * 「最小余白 −20分」が「0時間」になり、旅程が壊れている案が壊れていない案に見える。
 * `TripPresentation.formatDuration` は旅程の時間を読ませるための道具で、差分表の
 * 道具ではない。
 */

// Task 10 brief §Step 1 tests (verbatim).

@Test @MainActor func alternativesShowRealDiffAndApplyGoesThroughGuard() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); store.request.tripDays = 2; await store.build()
  let alts = store.verdictDetails.alternatives
  #expect(alts.count <= 3)
  guard let first = alts.first else { Issue.record("8 stops in 2 days should yield at least one alternative"); return }
  #expect(first.diff.count >= 5)                                           // 衝突・超過・移動・最小余白・訪問数/日数
  #expect(first.diff.allSatisfy { !$0.before.contains("時間") && !$0.after.contains("時間") })   // 生の分 "90分"。formatDuration の「1時間30分」ではない
  #expect(first.diff.map(\.label) == AppCopy.for(.ja).diffLabels)
  await store.applyAlternative(first.apply)
  #expect(store.canUndo || store.view.pendingHardEdit != nil)
}

// 残りの約束。

/// 日数のステッパーはエンジンの範囲そのものを名乗る。1 未満の旅も 15 日目も、組み立てが
/// 受け取らない値なので、押せるところに置かない。
@Test @MainActor func theDayStepperCarriesTheEnginesOwnRange() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland); await store.build()
  let stepper = store.verdictDetails.daysStepper
  #expect(stepper.value == 4)
  #expect(stepper.min == EngineConstants.tripDaysRange.lowerBound)
  #expect(stepper.max == EngineConstants.tripDaysRange.upperBound)
  #expect(stepper.min == 1 && stepper.max == 14)
}

/// 3 つの数は判定の `criticalFacts` そのままで、合計を作り直さない —— 別々に数えると、
/// 「12件中9件を確認」の下に 10 件の行が並ぶ。
@Test @MainActor func theThreeFactCountsComeFromTheVerdictItself() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland); await store.build()
  guard let result = store.bundle?.result else { Issue.record("the sample must build"); return }
  let counts = store.verdictDetails.factCounts
  #expect(counts.verified == result.criticalFacts.verified)
  #expect(counts.estimated == result.criticalFacts.estimated)
  #expect(counts.unknown == result.criticalFacts.unknown)
  #expect(counts.verified + counts.estimated + counts.unknown > 0)
}

/// 地域の対応は名前と「まだ測っていない領域があるか」の 2 つ。スイスは測ってある。
@Test @MainActor func coverageNamesTheRegionAndWhetherAnythingIsUnmeasured() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland); await store.build()
  let coverage = store.verdictDetails.coverage
  #expect(coverage.label == CoverageProfile.forLocation(destination: .switzerland).label[.ja])
  #expect(coverage.hasUnknown == false)
}

/// 前提と注意は Kit の文をそのまま並べる。ビューは 1 文も作らない。
@Test @MainActor func assumptionsAndAttentionsAreKitSentences() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland); store.request.tripDays = 2; await store.build()
  guard let result = store.bundle?.result else { Issue.record("the sample must build"); return }
  let details = store.verdictDetails
  #expect(details.assumptions == result.assumptions.map { VerdictCopy.assumptionCopy($0, locale: .ja) })
  var checked = 0
  for line in details.assumptions + details.attentions {
    #expect(!line.isEmpty)
    #expect(BannedTerms.violations(in: line).isEmpty, "\(line)")
    checked += 1
  }
  #expect(checked > 0, "8 stops in 2 days must raise something worth saying")
}

/// 貼り付けた旅程だけが 3 つの見方を比べる。行きたい場所の一覧には「元の案」が無い ——
/// 比べる相手が無いのに 3 枚並べると、旅行者は自分が入力した覚えのない案を探すことになる。
@Test @MainActor func theThreeWayComparisonBelongsToPastedItinerariesOnly() async {
  let wishlist = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  wishlist.loadSample(.switzerland); await wishlist.build()
  #expect(wishlist.bundle?.plan.inputMode == .wishlist)
  #expect(wishlist.verdictDetails.comparison == nil)

  let pasted = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  pasted.loadSample(.switzerland)
  // 日別見出しを付けると、ビルダーは同じ 8 か所を「既存の旅程」として読む。
  for index in pasted.request.entries.indices { pasted.request.entries[index].fixedDay = index / 2 + 1 }
  await pasted.build()
  #expect(pasted.bundle?.plan.inputMode == .existing_itinerary)
  guard let comparison = pasted.verdictDetails.comparison else { Issue.record("a pasted itinerary compares three views"); return }
  #expect(comparison.original.rows.count == 3)
  #expect(comparison.original.label == AppCopy.ja.comparisonOriginal)
  #expect(!comparison.minimalRepair.detail.isEmpty)
  #expect(!comparison.shortest.detail.isEmpty)
  #expect(comparison.original.rows.allSatisfy { !$0.value.contains("時間") })
}

/// 代替案は 3 件まで。全部並べると、旅行者は「どれを選ぶか」を選ばされる。
@Test @MainActor func atMostThreeAlternativesEvenWhenTheEngineFindsMore() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland); store.request.tripDays = 1; await store.build()
  guard let result = store.bundle?.result else { Issue.record("the sample must build"); return }
  let alternatives = store.verdictDetails.alternatives
  #expect(alternatives.count == min(3, result.alternatives.count))
  #expect(alternatives.map(\.id) == result.alternatives.prefix(3).map(\.id))
  var checked = 0
  for alternative in alternatives {
    #expect(alternative.title == VerdictCopy.alternativeCopy(alternative.apply, locale: .ja).title)
    #expect(alternative.lossLine == VerdictCopy.alternativeLossCopy(alternative.apply, locale: .ja))
    #expect(alternative.diff.count == 6)
    checked += 1
  }
  #expect(checked > 0, "1 day for 8 stops must offer something")
}

/// 差分の 6 行は `TripScenarioMetrics` の 6 欄そのもの。**分は分のまま**、最小余白が無い案は
/// 「—」で、0 分に丸めない —— 「余白 0分」と「余白は測れていない」は違う話である。
@Test @MainActor func theSixDiffRowsAreRawMetricsInOrder() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.loadSample(.switzerland); store.request.tripDays = 2; await store.build()
  guard let first = store.verdictDetails.alternatives.first else { Issue.record("no alternative to read"); return }
  let metrics = first.apply.before
  #expect(first.diff[0].before == String(metrics.hardConflictCount))
  #expect(first.diff[1].before == "\(metrics.overrunMinutes)分")
  #expect(first.diff[2].before == "\(metrics.travelMinutes)分")
  #expect(first.diff[3].before == (metrics.minimumSlackMinutes.map { "\($0)分" } ?? "—"))
  #expect(first.diff[4].before == String(metrics.scheduledStopCount))
  #expect(first.diff[5].before == String(metrics.dayCount))
}

/// 英語でも同じ 6 行で、単位だけが変わる。
@Test @MainActor func theDiffSpeaksEnglishToo() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil)
  store.request.locale = .en
  store.loadSample(.switzerland); store.request.tripDays = 2; await store.build()
  guard let first = store.verdictDetails.alternatives.first else { Issue.record("no alternative to read"); return }
  #expect(first.diff.map(\.label) == AppCopy.for(.en).diffLabels)
  #expect(first.diff[2].before.hasSuffix(" min"))
  #expect(first.diff.allSatisfy { !$0.before.contains("h ") })
}

/// 旅程が組み上がる前は、詳細は空でなければならない —— 数の無い表に「0件」を並べると、
/// 「調べた結果ゼロ」に読める。
@Test @MainActor func thereIsNothingToDetailBeforeThePlanExists() async {
  let store = PlannerStore(resolvers: [], store: nil)
  let details = store.verdictDetails
  #expect(details.alternatives.isEmpty)
  #expect(details.assumptions.isEmpty)
  #expect(details.attentions.isEmpty)
  #expect(details.comparison == nil)
  #expect(details.factCounts.verified == 0)
  #expect(details.daysStepper.value == 3)   // `TripRequestState.initial` の既定
}
