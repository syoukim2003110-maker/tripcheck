import Foundation
import Testing
@testable import TripCheckKit

/*
 * `lib/coverage-profile.ts` / `lib/planning-evidence.ts` / `lib/trip-scope.ts` の移植テスト ——
 * ブリーフ Step 1 の該当分 + `tests/coverage-profile.test.ts`(5)、
 * `tests/planning-evidence.test.ts`(5)、`tests/trip-scope.test.ts`(8)。
 */

// 夏時間に左右されないよう、TS と同じ固定の瞬間で比べる(`tests/trip-scope.test.ts:6`)。
private let scopeReference = Date(timeIntervalSince1970: 1_786_492_800) // 2026-08-12T00:00:00Z

// MARK: - ブリーフ Step 1

@Test func coverageGradesAndTokyoBox() {
  #expect(CoverageProfile.isTokyo(lat: 35.68, lng: 139.76))
  #expect(!CoverageProfile.isTokyo(lat: 34.69, lng: 135.50))
  #expect(CoverageProfile.forLocation(
    destination: .japan,
    countryCode: "JP",
    coordinate: GeoPoint(latitude: 35.68, longitude: 139.76)
  ).id == .tokyo)
  #expect(CoverageProfile.hasUnknownRegionalCoverage(
    CoverageProfile.forLocation(destination: .worldwide, countryCode: "BR", coordinate: nil)
  ))
}

@Test func softEvidenceBufferIsZeroFifteenThirty() {
  #expect(PlanningEvidence.softBufferMinutes(mentions: []) == 0)
  #expect(PlanningEvidence.softBufferMinutes(mentions: ["long queue at the gate"]) == 15)
  #expect(PlanningEvidence.softBufferMinutes(mentions: ["sold out", "packed"]) == 30)
  // 否定形は除外。
  #expect(PlanningEvidence.softBufferMinutes(mentions: ["no queue at all"]) == 0)

  // ブリーフの例は `["sold out", "very crowded"]` で 30 を期待するが、TS の混雑の語彙
  // (`lib/planning-evidence.ts:23`)に "very crowded" は入っていない —— あるのは "packed" /
  // "overcrowded" / "very busy" / "extremely busy"。TS が正なので、この組は証拠 1 件で 15。
  #expect(PlanningEvidence.softBufferMinutes(mentions: ["sold out", "very crowded"]) == 15)
  #expect(PlanningEvidence.classify("very crowded").isEmpty)
  #expect(PlanningEvidence.classify("very busy") == [.crowd])
}

/// TS `normalizeEvidenceText`(`lib/planning-evidence.ts:40-42`)は JS の 3 つの道具
/// —— `normalize("NFKC")` / `replace(/\s+/g, " ")` / `trim()` —— でできている。3 つとも
/// `Foundation` の既定と食い違うので、食い違う点をそれぞれ固定する(期待値は
/// JavaScriptCore で実測)。
@Test func evidenceTextIsFoldedTheWayJavaScriptFoldsIt() {
  // `normalize("NFKC")` —— 半角の「ﾊﾟ」は 1 文字の U+30D1 まで畳む。`String` の `==` は正準
  // 等価で較べて差を隠すのでスカラ列で見る(`precomposedStringWithCompatibilityMapping`
  // だけでは U+30CF U+309A の 2 文字で止まる)。
  #expect(
    PlanningEvidence.normalize("ﾊﾟﾚｰﾄ").unicodeScalars.map(\.value) == [0x30D1, 0x30EC, 0x30FC, 0x30C8]
  )

  // U+FEFF は JS の空白 —— `\s+` で潰れ `trim()` で落ちる。ICU の `\s` も
  // `.whitespacesAndNewlines` も U+FEFF を空白と見ない。
  #expect(
    PlanningEvidence.normalize("\u{FEFF}大混雑\u{FEFF}").unicodeScalars.map(\.value) == [0x5927, 0x6DF7, 0x96D1]
  )

  // U+0085 は JS の空白ではない —— そのまま残る。ICU の `\s` と `.whitespacesAndNewlines` は
  // どちらも空白として扱ってしまう。
  #expect(
    PlanningEvidence.normalize("大\u{85}混雑").unicodeScalars.map(\.value) == [0x5927, 0x85, 0x6DF7, 0x96D1]
  )
}

/// 畳んだ文がそのまま証拠の同一性の鍵になる(TS `new Map(...)`、`lib/planning-evidence.ts:74-79`)
/// ので、上の 3 点は「証拠が何件か」= 余白の分に出る。
@Test func foldingDifferencesShowUpInTheEvidenceCount() {
  // BOM 付きと素の文は TS では同じ鍵 → 証拠 1 件 → 15 分。
  #expect(PlanningEvidence.softBufferMinutes(mentions: ["\u{FEFF}大混雑", "大混雑"]) == 15)
  // U+0085 は空白に潰れないので、空白入りの文とは別の鍵 → 証拠 2 件 → 30 分。
  #expect(PlanningEvidence.softBufferMinutes(mentions: ["大\u{85}混雑", "大 混雑"]) == 30)
}

/// ブリーフは `TripScope.warnings(plan:destination:)` と書くが、TS が正 —— 国コードを持つのは
/// 解決済みの停留所(`ResolvedInputStop`)であって `BuiltTripPlan` の `RouteStop` ではないので、
/// TS の `tripScopeWarnings(stops, transitSteps, reference)` の形をそのまま移してある。
@Test func timezoneWarningOnlyWhenOffsetsDiffer() {
  let warnings = TripScope.warnings(stops: TestStops.parisRomeStops(), transitSteps: [], reference: scopeReference)
  #expect(warnings.contains { $0.kind == .timezone } == false)
  #expect(warnings.map(\.kind) == [.border])
}

// MARK: - `tests/coverage-profile.test.ts` の移植

/// TS `test("defines explicit regional grades without mixing them with fact coverage")`(`:13-34`)。
@Test func definesExplicitRegionalGradesWithoutMixingThemWithFactCoverage() {
  #expect(CoverageProfile.profiles[.tokyo]?.grades == CoverageGrades(routes: .A, poi: .A, hours: .B, transit: .A))
  #expect(CoverageProfile.profiles[.japan_other]?.grades == CoverageGrades(routes: .A, poi: .A, hours: .B, transit: .B))
  #expect(CoverageProfile.profiles[.switzerland]?.grades == CoverageGrades(routes: .A, poi: .A, hours: .B, transit: .A))
  #expect(CoverageProfile.profiles[.europe]?.grades == CoverageGrades(routes: .B, poi: .B, hours: .C, transit: .C))
  #expect(CoverageProfile.profiles[.usa]?.grades == CoverageGrades(routes: .B, poi: .B, hours: .C, transit: .C))
  #expect(CoverageProfile.profiles[.unsupported]?.grades
    == CoverageGrades(routes: .unknown, poi: .unknown, hours: .unknown, transit: .unknown))
  // TS の `Object.freeze` / `kind: "regional_capability"` に当たるものは Swift では型そのもの ——
  // `RegionalCoverageProfile` は値型で、事実の集計(`CriticalFactCounts`)とは別の型。
  #expect(CoverageProfile.profiles.count == CoverageProfileId.allCases.count)
  for id in CoverageProfileId.allCases {
    #expect(CoverageProfile.profiles[id]?.id == id)
  }
}

/// TS `test("separates Tokyo from the safer Japan-outside-Tokyo fallback")`(`:36-43`)。
@Test func separatesTokyoFromTheSaferJapanOutsideTokyoFallback() {
  #expect(CoverageProfile.isTokyo(lat: 35.6812, lng: 139.7671))
  #expect(!CoverageProfile.isTokyo(lat: 35.0116, lng: 135.7681))
  #expect(CoverageProfile.forLocation(.init(destination: "japan", latitude: 35.6812, longitude: 139.7671)).id == .tokyo)
  #expect(CoverageProfile.forLocation(.init(destination: "japan", latitude: 35.0116, longitude: 135.7681)).id == .japan_other)
  #expect(CoverageProfile.forLocation(.init(destination: "japan")).id == .japan_other)
  #expect(CoverageProfile.forLocation(.init(countryCode: "JP", regionHint: "東京")).id == .tokyo)
}

/// TS `test("maps supported destination families to their regional profile")`(`:45-52`)。
@Test func mapsSupportedDestinationFamiliesToTheirRegionalProfile() {
  #expect(CoverageProfile.forLocation(.init(destination: "switzerland")).id == .switzerland)
  #expect(CoverageProfile.forLocation(.init(countryCode: "CH")).id == .switzerland)
  #expect(CoverageProfile.forLocation(.init(destination: "france")).id == .europe)
  #expect(CoverageProfile.forLocation(.init(countryCode: "DE")).id == .europe)
  #expect(CoverageProfile.forLocation(.init(destination: "usa")).id == .usa)
  #expect(CoverageProfile.forLocation(.init(countryCode: "US")).id == .usa)
}

/// TS `test("fails closed for unsupported, malformed, or contradictory locations")`(`:54-68`)。
@Test func failsClosedForUnsupportedMalformedOrContradictoryLocations() {
  let unsupported = CoverageProfile.unsupported
  #expect(CoverageProfile.forLocation() == unsupported)
  #expect(CoverageProfile.forLocation(.init(destination: "korea")) == unsupported)
  #expect(CoverageProfile.forLocation(.init(destination: "auto")) == unsupported)
  #expect(CoverageProfile.forLocation(.init(destination: "switzerland", countryCode: "US")) == unsupported)
  #expect(CoverageProfile.forLocation(.init(destination: "switzerland", latitude: 35.6812, longitude: 139.7671)) == unsupported)
  #expect(CoverageProfile.forLocation(.init(destination: "japan", latitude: .nan, longitude: 139.7)) == CoverageProfile.japanOther)
  #expect(CoverageProfile.byId("future_region") == unsupported)
  #expect(CoverageProfile.byId(nil) == unsupported)
  #expect(CoverageProfile.grade(nil, .routes) == .unknown)
  #expect(CoverageProfile.grade(CoverageProfile.tokyo, "future_dimension") == .unknown)
  #expect(CoverageProfile.hasUnknownRegionalCoverage(unsupported))
  #expect(!CoverageProfile.hasUnknownRegionalCoverage(CoverageProfile.tokyo))
  // scope.beta の 1 行を出すかどうか(`isDeepCoverageProfile`)。
  #expect(CoverageProfile.isDeep(CoverageProfile.tokyo))
  #expect(!CoverageProfile.isDeep(CoverageProfile.europe))
  #expect(!CoverageProfile.isDeep(nil))
}

/// TS `test("exposes dated, cautious public copy and uses English as the safe locale fallback")`
/// (`:70-84`)。
@Test func exposesDatedCautiousPublicCopyAndUsesEnglishAsTheSafeFallback() {
  let datePattern = try! JSRegex("^\\d{4}-\\d{2}-\\d{2}$")
  for profile in CoverageProfileId.allCases.compactMap({ CoverageProfile.profiles[$0] }) where profile.id != .unsupported {
    #expect(datePattern.test(profile.lastValidatedAt ?? ""))
    #expect((profile.publicCopy[.en] ?? "").count > 40)
    #expect((profile.publicCopy[.ja] ?? "").count > 20)
  }
  #expect(CoverageProfile.unsupported.lastValidatedAt == nil)
  let unsupportedEn = CoverageProfile.publicCopy(CoverageProfile.unsupported, locale: .en)
  #expect(unsupportedEn.contains("not validated") || unsupportedEn.contains("provisional"))
  let unsupportedJa = CoverageProfile.publicCopy(CoverageProfile.unsupported, locale: .ja)
  #expect(unsupportedJa.contains("検証していません") || unsupportedJa.contains("暫定"))
  // TS はロケール文字列を受けて "ko" を英語に落とす。Swift の `PlannerLocale` は 2 つしか無いので、
  // 「ja でなければ英語」という同じ規則をそのまま確かめる。
  #expect(CoverageProfile.publicCopy(CoverageProfile.switzerland, locale: .en) == CoverageProfile.switzerland.publicCopy[.en])
  #expect(CoverageProfile.publicCopy(nil, locale: .en) == CoverageProfile.unsupported.publicCopy[.en])
}

// MARK: - `tests/planning-evidence.test.ts` の移植

private func reviews(_ texts: [String]) -> [PlanningEvidenceMention] {
  texts.map { PlanningEvidenceMention(text: $0, source: .googleReviews) }
}

private func webFindings(_ texts: [String], sourceOnly: Bool = false) -> [PlanningEvidenceMention] {
  texts.map { PlanningEvidenceMention(text: $0, source: .publicWeb, isSourceOnly: sourceOnly) }
}

/// TS `test("returns no buffer for generic closure or unsupported inference")`(`:57-69`)。
@Test func returnsNoBufferForGenericClosureOrUnsupportedInference() {
  let result = PlanningEvidence.stopPlanningEvidence(
    reviews(["The shop was closed when I arrived.", "Access was convenient.", "混雑はなく、行列もなかった。"])
      + webFindings(["The official page lists a temporary closure."])
  )
  #expect(result == StopPlanningEvidence(
    bufferMinutes: 0,
    evidenceCount: 0,
    reasons: [],
    sourceCounts: PlanningEvidenceSourceCounts(googleReviews: 0, publicWeb: 0)
  ))
}

/// TS `test("adds fifteen minutes for one explicit queue report")`(`:71-78`)。
@Test func addsFifteenMinutesForOneExplicitQueueReport() {
  let result = PlanningEvidence.stopPlanningEvidence(reviews(["昼は長い行列で40分待ちでした。"]))
  #expect(result.bufferMinutes == 15)
  #expect(result.evidenceCount == 1)
  #expect(result.reasons == [.queue])
  #expect(result.sourceCounts == PlanningEvidenceSourceCounts(googleReviews: 1, publicWeb: 0))
}

/// TS `test("caps the soft buffer at thirty minutes and keeps deterministic reason order")`
/// (`:80-90`)。
@Test func capsTheSoftBufferAtThirtyMinutesAndKeepsDeterministicReasonOrder() {
  let result = PlanningEvidence.stopPlanningEvidence(
    reviews(["It was packed and there was a long line."])
      + webFindings(["入口が分かりにくく、迂回が必要だった。", "夕方には売り切れでした。"])
  )
  #expect(result.bufferMinutes == 30)
  #expect(result.evidenceCount == 3)
  #expect(result.reasons == [.crowd, .queue, .sold_out, .detour])
  #expect(result.sourceCounts == PlanningEvidenceSourceCounts(googleReviews: 1, publicWeb: 2))
}

/// TS `test("deduplicates identical evidence before computing the buffer")`(`:92-100`)。
@Test func deduplicatesIdenticalEvidenceBeforeComputingTheBuffer() {
  let result = PlanningEvidence.stopPlanningEvidence(webFindings(["週末は大混雑でした。", "週末は大混雑でした。"]))
  #expect(result.bufferMinutes == 15)
  #expect(result.evidenceCount == 1)
  #expect(result.reasons == [.crowd])
}

/// TS `test("does not turn a source-only search result into a schedule claim")`(`:102-109`)。
@Test func doesNotTurnASourceOnlySearchResultIntoAScheduleClaim() {
  let result = PlanningEvidence.stopPlanningEvidence(webFindings(["長い行列で売り切れたとの情報"], sourceOnly: true))
  #expect(result.bufferMinutes == 0)
  #expect(result.evidenceCount == 0)
}

// MARK: - `tests/trip-scope.test.ts` の移植

private func scopeStop(_ countryCode: String? = nil) -> TripScopeStop {
  TripScopeStop(countryCode: countryCode)
}

/// TS `test("stays silent for a single-country trip")`(`:9-11`)と
/// `test("stays silent with no stops and no evidence")`(`:13-15`)。
@Test func staysSilentForASingleCountryTripAndForNothingAtAll() {
  #expect(TripScope.warnings(stops: [scopeStop("JP"), scopeStop("JP"), scopeStop()], transitSteps: [], reference: scopeReference).isEmpty)
  #expect(TripScope.warnings(stops: [], transitSteps: nil, reference: scopeReference).isEmpty)
}

/// TS `test("warns about a border when stops resolve into two countries")`(`:17-22`)と
/// `test("warns about a border for countries outside the destination catalogue")`(`:24-28`)。
@Test func warnsAboutABorderWhenStopsResolveIntoTwoCountries() {
  #expect(TripScope.warnings(stops: [scopeStop("JP"), scopeStop("KR")], transitSteps: [], reference: scopeReference)
    == [TripScopeWarning(kind: .border, countryCodes: ["JP", "KR"])])
  #expect(TripScope.warnings(stops: [scopeStop("BR"), scopeStop("AR")], transitSteps: [], reference: scopeReference)
    == [TripScopeWarning(kind: .border, countryCodes: ["AR", "BR"])])
}

/// TS `test("treats countries grouped into one destination profile as one territory")`(`:30-34`)。
@Test func treatsCountriesGroupedIntoOneDestinationProfileAsOneTerritory() {
  #expect(TripScope.warnings(stops: [scopeStop("IT"), scopeStop("VA")], transitSteps: [], reference: scopeReference).isEmpty)
}

/// TS `test("adds a time-zone warning only when destination clocks actually differ")`(`:36-45`)。
@Test func addsATimeZoneWarningOnlyWhenDestinationClocksActuallyDiffer() {
  #expect(TripScope.warnings(stops: [scopeStop("JP"), scopeStop("FR")], transitSteps: [], reference: scopeReference) == [
    TripScopeWarning(kind: .border, countryCodes: ["FR", "JP"]),
    TripScopeWarning(kind: .timezone, timeZones: ["Asia/Tokyo", "Europe/Paris"]),
  ])
  #expect(TripScope.warnings(stops: [scopeStop("FR"), scopeStop("IT")], transitSteps: [], reference: scopeReference)
    == [TripScopeWarning(kind: .border, countryCodes: ["FR", "IT"])])
}

/// TS `test("warns when live transit evidence contains a ferry ride")`(`:47-52`)。
@Test func warnsWhenTransitEvidenceContainsAFerryRide() {
  #expect(TripScope.warnings(
    stops: [scopeStop("JP")],
    transitSteps: [TripScopeTransitStep(vehicleType: "HEAVY_RAIL"), TripScopeTransitStep(vehicleType: "FERRY")],
    reference: scopeReference
  ) == [TripScopeWarning(kind: .ferry)])
}

/// TS `test("ignores non-ferry vehicles, unknown vehicles and missing evidence")`(`:54-57`)。
@Test func ignoresNonFerryVehiclesUnknownVehiclesAndMissingEvidence() {
  #expect(TripScope.warnings(
    stops: [scopeStop("JP")],
    transitSteps: [TripScopeTransitStep(vehicleType: "HEAVY_RAIL"), TripScopeTransitStep(vehicleType: nil)],
    reference: scopeReference
  ).isEmpty)
  #expect(TripScope.warnings(stops: [scopeStop("JP")], transitSteps: nil, reference: scopeReference).isEmpty)
}

/// TS `test("normalizes malformed country codes instead of warning on them")`(`:59-61`)。
@Test func normalizesMalformedCountryCodesInsteadOfWarningOnThem() {
  #expect(TripScope.warnings(
    stops: [scopeStop(" jp "), scopeStop("JP"), scopeStop("JPN"), scopeStop("")],
    transitSteps: [],
    reference: scopeReference
  ).isEmpty)
}

/// 警告はそのまま Copy Deck の 1 行になる(`ui.scopeBorder` / `scopeTimezone` / `scopeFerry`)。
@Test func scopeWarningsReadAsTheCopyDeckLines() {
  #expect(TripScopeWarning(kind: .border).copy(.ja) == Copy.ja.scopeBorder)
  #expect(TripScopeWarning(kind: .timezone).copy(.en) == Copy.en.scopeTimezone)
  #expect(TripScopeWarning(kind: .ferry).copy(.ja) == Copy.ja.scopeFerry)
}
