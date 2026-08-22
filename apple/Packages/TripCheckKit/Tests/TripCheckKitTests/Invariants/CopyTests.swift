import Foundation
import Testing
@testable import TripCheckKit

/*
 * `lib/presentation/planner-copy.ts` の移植テスト —— ブリーフ Step 1 の該当分 +
 * `tests/planner-copy.test.ts` の移せるケース。
 */

// MARK: - ブリーフ Step 1

@Test func copyTablesHaveTheSameKeysInBothLanguages() {
  #expect(Copy.ja.keys == Copy.en.keys)
  // `sed -n '20,316p' lib/presentation/planner-copy.ts | grep -cE '^    [a-zA-Z]+:'` = 267
  // (en ブロック `sed -n '318,616p' … | grep -cE …` も 267、キー列は diff で一致)。
  #expect(Copy.ja.keys.count == 267)
  // 並びも TS の挿入順のまま(`Mirror` は宣言順を返す)。両端と入れ子の 4 つを留める。
  #expect(Copy.ja.keys.first == "brandNote")
  #expect(Copy.ja.keys.last == "close")
  #expect(Copy.ja.keys.filter { ["buildSteps", "move", "freshSource", "crowd"].contains($0) }
    == ["buildSteps", "move", "freshSource", "crowd"])
}

@Test func everyCopyStringPassesBannedTerms() {
  for (key, value) in Copy.ja.allStaticStrings + Copy.en.allStaticStrings {
    #expect(BannedTerms.violations(in: value).isEmpty, "\(key): \(value)")
  }
}

@Test func heroSentenceNamesTheDaysAndTheState() {
  let request = TestStops.swissRequest(days: 4)
  let plan = TripBuilder.build(request)
  let fit = TripScenarios.assessTripFit(request, plan: plan)
  let result = Feasibility.derive(
    plan: plan,
    fit: fit,
    evidence: Feasibility.snapshot(
      plan: plan,
      options: .init(dateWasProvided: false, baseWasProvided: false, dayEndWasProvided: false)
    )
  )
  let hero = VerdictCopy.hero(result: result, fit: fit, plan: plan, locale: .ja)
  #expect(hero.contains("4日"))
  #expect(BannedTerms.violations(in: hero).isEmpty)
}

@Test func computationLimitHasItsOwnSentence() {
  let (plan, fit, result) = TestStops.timedOutTriple()
  let hero = VerdictCopy.hero(result: result, fit: fit, plan: plan, locale: .ja)
  #expect(!hero.contains("最短"))
  #expect(hero.contains("計算") || hero.contains("確認"))
}

// MARK: - `tests/planner-copy.test.ts` の移植

/// TS `test("solverTimedOut surfaces as the distinct COMPUTATION_LIMIT cause, not a generic unknown")`
/// (`tests/planner-copy.test.ts:44-71`)の、この課題に関わる部分。
@Test func solverTimedOutSurfacesAsTheDistinctComputationLimitCause() {
  let (_, _, result) = TestStops.timedOutTriple()
  #expect(result.state == .UNKNOWN)
  #expect(result.unknownCause == .COMPUTATION_LIMIT)
}

/// TS `test("the LIMIT cause renders one cause and the reduce-places action in both locales")`
/// (`:73-86`)。
@Test func theLimitCauseRendersOneCauseAndTheReducePlacesAction() {
  let (_, _, result) = TestStops.timedOutTriple()

  let ja = VerdictCopy.minimumDaysCopy(result, locale: .ja)
  #expect(ja.contains("計算の上限"))
  #expect(ja.contains("場所を15件以下にしてください"))
  // 原因は 1 つだけ —— 未解決の場所・日指定・固定条件と混ぜない。
  #expect(!ja.contains("未解決"))
  #expect(!ja.contains("日指定"))
  #expect(!ja.contains("固定条件"))

  let en = VerdictCopy.minimumDaysCopy(result, locale: .en)
  #expect(en.lowercased().contains("computation limit"))
  #expect(en.contains("Remove optional places"))
  #expect(en.contains("15 or fewer"))
  #expect(!en.lowercased().contains("unresolved"))
  #expect(!en.lowercased().contains("day pin"))
  #expect(!en.lowercased().contains("fixed constraint"))
}

/// TS `test("the exhausted-search fallback names only the fixed-constraint cause with one action")`
/// (`:88-101`)。
@Test func theExhaustedSearchFallbackNamesOnlyTheFixedConstraintCause() {
  var searched = TestStops.timedOutTriple().result
  searched.unknownCause = nil
  searched.searchedThroughDays = 14

  let ja = VerdictCopy.minimumDaysCopy(searched, locale: .ja)
  #expect(ja.contains("固定条件が競合"))
  #expect(ja.contains("見直してください"))
  #expect(!ja.contains("計算"))
  #expect(!ja.contains("上限"))
  #expect(!ja.contains("未解決"))

  let en = VerdictCopy.minimumDaysCopy(searched, locale: .en)
  #expect(en.contains("fixed constraint"))
  #expect(en.contains("Revisit one"))
  #expect(!en.lowercased().contains("computation"))
  #expect(!en.lowercased().contains("limit"))
  #expect(!en.lowercased().contains("unresolved"))
}

/// TS `test("build stages carry the three Copy Deck outcome strings")`(`:105-120`)。
@Test func buildStagesCarryTheThreeCopyDeckOutcomeStrings() {
  #expect(Copy.ja.buildSteps.grouping == "近い場所を同じ日にまとめています")
  #expect(Copy.ja.buildSteps.ordering == "回る順番を整えています")
  #expect(Copy.ja.buildSteps.enriching == "ホテルと食事の候補を探しています")
  #expect(Copy.en.buildSteps.grouping == "Grouping nearby places into days")
  #expect(Copy.en.buildSteps.ordering == "Finding a practical order")
  #expect(Copy.en.buildSteps.enriching == "Finding a practical base and meal stops")

  let stages = [
    Copy.ja.buildSteps.grouping, Copy.ja.buildSteps.ordering, Copy.ja.buildSteps.enriching,
    Copy.en.buildSteps.grouping, Copy.en.buildSteps.ordering, Copy.en.buildSteps.enriching,
  ]
  let digits = try! JSRegex("\\d")
  let providers = try! JSRegex("Google|Rakuten|楽天", options: [.caseInsensitive])
  for line in stages {
    #expect(!digits.test(line), "stage copy must carry no counts: \(line)")
    #expect(!providers.test(line), "stage copy must carry no provider names: \(line)")
  }
}

/// TS `test("conditional and infeasible state copy follow the deck with real counts only")`
/// (`:126-138`)。
@Test func conditionalAndInfeasibleStateCopyFollowTheDeck() {
  #expect(VerdictCopy.feasibilityStateCopy(.FEASIBLE_IF_ASSUMPTIONS, locale: .ja, days: 4, stops: 8, unplacedCount: 0, checkCount: 2).headline
    == "4日で回れます。2か所だけ確認が必要です")
  #expect(VerdictCopy.feasibilityStateCopy(.FEASIBLE_IF_ASSUMPTIONS, locale: .en, days: 4, stops: 8, unplacedCount: 0, checkCount: 2).headline
    == "This works in 4 days, with 2 details to check")
  #expect(VerdictCopy.feasibilityStateCopy(.FEASIBLE_IF_ASSUMPTIONS, locale: .en, days: 4, stops: 8, unplacedCount: 0, checkCount: 1).headline
    == "This works in 4 days, with 1 detail to check")
  #expect(VerdictCopy.feasibilityStateCopy(.FEASIBLE_IF_ASSUMPTIONS, locale: .ja, days: 4, stops: 8, unplacedCount: 0, checkCount: 0).headline
    == "この条件なら4日で回れます")
  #expect(VerdictCopy.feasibilityStateCopy(.FEASIBLE_IF_ASSUMPTIONS, locale: .en, days: 4, stops: 8, unplacedCount: 0, checkCount: 0).headline
    == "This works in 4 days with these assumptions")

  #expect(VerdictCopy.feasibilityStateCopy(.INFEASIBLE_HARD_CONFLICT, locale: .ja, days: 3, stops: 8, unplacedCount: 1).headline
    == "3日だと1か所外す必要があります")
  #expect(VerdictCopy.feasibilityStateCopy(.INFEASIBLE_HARD_CONFLICT, locale: .en, days: 3, stops: 8, unplacedCount: 1).headline
    == "In 3 days, one stop needs to move or be removed")
  #expect(VerdictCopy.feasibilityStateCopy(.INFEASIBLE_HARD_CONFLICT, locale: .en, days: 3, stops: 8, unplacedCount: 2).headline
    == "In 3 days, 2 stops need to move or be removed")
  #expect(VerdictCopy.feasibilityStateCopy(.INFEASIBLE_HARD_CONFLICT, locale: .ja, days: 3, stops: 8, unplacedCount: 0).headline
    == "このままだと予約・時間に間に合いません")
  #expect(VerdictCopy.feasibilityStateCopy(.INFEASIBLE_HARD_CONFLICT, locale: .en, days: 3, stops: 8, unplacedCount: 0).headline
    == "A booking or time constraint cannot be met as planned")
}

/// TS `test("the verdict separates an unresolved place from the computation cap")`(`:144-161`)。
@Test func theVerdictSeparatesAnUnresolvedPlaceFromTheComputationCap() {
  #expect(VerdictCopy.feasibilityStateCopy(.UNKNOWN, locale: .ja, days: 4, stops: 8).headline == "場所を確認すると完成します")
  #expect(VerdictCopy.feasibilityStateCopy(.UNKNOWN, locale: .en, days: 4, stops: 8).headline == "Confirm the places to finish the plan")
  #expect(VerdictCopy.feasibilityStateCopy(.UNKNOWN, locale: .ja, days: 4, stops: 8, unknownCause: .UNRESOLVED_PLACE).headline
    == "場所を確認すると完成します")

  let ja = VerdictCopy.feasibilityStateCopy(.UNKNOWN, locale: .ja, days: 4, stops: 8, unknownCause: .COMPUTATION_LIMIT)
  #expect(ja.headline == "場所が多く、計算しきれませんでした")
  #expect(ja.label == "計算上限")
  let en = VerdictCopy.feasibilityStateCopy(.UNKNOWN, locale: .en, days: 4, stops: 8, unknownCause: .COMPUTATION_LIMIT)
  #expect(en.headline == "There were too many places to finish the calculation")
  #expect(en.label == "Too many places")

  // 原因が語るのは UNKNOWN のときだけ —— 成立している旅を貼り替えない。
  #expect(VerdictCopy.feasibilityStateCopy(.VERIFIED_FEASIBLE, locale: .ja, days: 4, stops: 8, unknownCause: .COMPUTATION_LIMIT).headline
    == "4日なら、無理なく回れます")
}

/// TS `test("the verdict card routes the computation cap to the issue card, not to place review")`
/// (`:165-174`)の Kit 側 —— TS はカードの JSX を走査するが、その分岐そのものは
/// `VerdictCopy.primaryWarning` が持つ。
@Test func theVerdictCardRoutesTheComputationCapToTheIssueCard() {
  let (_, _, limited) = TestStops.timedOutTriple()
  let warning = VerdictCopy.primaryWarning(result: limited, locale: .ja)
  #expect(warning?.action == .seeWhatToRemove)
  #expect(warning?.action?.label(.ja) == "減らし方を見る")
  #expect(warning?.action?.label(.en) == "See what to remove")

  var unresolved = limited
  unresolved.unknownCause = .UNRESOLVED_PLACE
  #expect(VerdictCopy.primaryWarning(result: unresolved, locale: .ja)?.action == .reviewConditions)

  var infeasible = limited
  infeasible.state = .INFEASIBLE_HARD_CONFLICT
  infeasible.unknownCause = nil
  #expect(VerdictCopy.primaryWarning(result: infeasible, locale: .ja)?.action == .seeAlternatives)

  // 直すものが何も無い旅にはボタンも警告も出さない。
  var settled = limited
  settled.state = .VERIFIED_FEASIBLE
  settled.unknownCause = nil
  settled.primaryConflict = nil
  settled.primaryAttention = nil
  #expect(VerdictCopy.primaryWarning(result: settled, locale: .ja) == nil)
}

/// TS `test("recommendation surfaces carry the Copy Deck strings verbatim in both locales")`
/// (`:178-205`)。
@Test func recommendationSurfacesCarryTheCopyDeckStringsVerbatim() {
  #expect(Copy.ja.mealIdeas == "この動線なら、ここが便利です")
  #expect(Copy.en.mealIdeas == "Best fit for this route")
  #expect(Copy.ja.gapRecoLabel(45) == "45分の空き時間に寄れます")
  #expect(Copy.en.gapRecoLabel(45) == "Fits your 45-minute gap")
  #expect(Copy.ja.recoAccept == "ここにする")
  #expect(Copy.en.recoAccept == "Add this")
  #expect(Copy.ja.recoAlternatives == "他を見る")
  #expect(Copy.en.recoAlternatives == "See alternatives")
  #expect(Copy.ja.hotelCandidate == "おすすめの拠点")
  #expect(Copy.en.hotelCandidate == "Recommended base")
  #expect(Copy.ja.hotelChip == "ホテルを変える")
  #expect(Copy.en.hotelChip == "Change base")
  #expect(Copy.ja.hotelSavesTravel(80) == "移動を1時間20分短縮")
  #expect(Copy.en.hotelSavesTravel(80) == "Saves 1h 20m of travel")
  #expect(Copy.ja.hotelSavesTravel(45) == "移動を45分短縮")
  #expect(Copy.en.hotelSavesTravel(45) == "Saves 45m of travel")
  #expect(Copy.ja.hotelSavesTravel(120) == "移動を2時間短縮")
  #expect(Copy.en.hotelSavesTravel(120) == "Saves 2h of travel")
  #expect(Copy.ja.detourLine(12) == "動線から約12分")
  #expect(Copy.en.detourLine(12) == "~12 min from the route")
}

/// TS `test("data, scope and share surfaces carry the Copy Deck strings verbatim")`(`:209-221`)。
@Test func dataScopeAndShareSurfacesCarryTheCopyDeckStringsVerbatim() {
  #expect(Copy.ja.estimated == "所要時間は目安です")
  #expect(Copy.en.estimated == "Travel time is estimated")
  #expect(Copy.ja.checkHours == "出発前に営業時間を確認")
  #expect(Copy.en.checkHours == "Check opening hours before you go")
  #expect(Copy.ja.betaRegion == "この地域はベータ対応です")
  #expect(Copy.en.betaRegion == "Beta coverage in this region")
  #expect(Copy.ja.shareWarning == "リンクを知っている人は旅程を見られます")
  #expect(Copy.en.shareWarning == "Anyone with the full link can view this trip")
  #expect(Copy.ja.estimatedDetail != Copy.ja.estimated)
  #expect(Copy.en.shareWarningDetail != Copy.en.shareWarning)
}

// MARK: - 数の書き方(JS の `toFixed` / `toLocaleString` に合わせる)

/// `routeIdeasDistance` と `rakutenTag` は JS の数値表記を通る —— 1 桁固定と 3 桁区切り。
@Test func numericCopyMatchesTheJavaScriptFormatting() {
  #expect(Copy.ja.routeIdeasDistance(320) == "予定経路から約320m")
  #expect(Copy.en.routeIdeasDistance(320) == "About 320m from the route")
  // JS も `"1.4"` —— 1.45 は二進で 1.45 に届かないので切り上がらない。
  #expect(Copy.ja.routeIdeasDistance(1_450) == "予定経路から約1.4km")
  #expect(Copy.en.routeIdeasDistance(1_450) == "About 1.4km from the route")
  #expect(Copy.ja.routeIdeasDistance(2_500) == "予定経路から約2.5km")
  // 4.25 はちょうど二進で表せるので同点。JS は大きいほうを採る(`%.1f` は 4.2 にしてしまう)。
  #expect(Copy.ja.rakutenTag(4.25, 1234) == "楽天トラベル ★4.3（1,234件）")
  #expect(Copy.en.rakutenTag(4.0, 12) == "Rakuten Travel ★4.0 (12)")
  #expect(Copy.en.rakutenTag(3.5, 1_234_567) == "Rakuten Travel ★3.5 (1,234,567)")
}

// MARK: - 移動手段の名前

/// TS `legModeLabel`(`:619-621`)と、代替案が使う別語彙(`:815-816`)。
@Test func modeVocabularyIsSeparateBetweenTheTimelineAndTheAlternatives() {
  #expect(legModeLabel(.transit, .ja) == "電車")
  #expect(legModeLabel(.transit, .en) == "Train")
  #expect(VerdictCopy.japaneseModeName(.transit) == "公共交通")
  #expect(VerdictCopy.englishModeName(.transit) == "transit")
}
