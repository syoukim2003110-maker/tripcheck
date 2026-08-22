import Foundation
import Testing
@testable import TripCheckKit

/*
 * `tests/banned-terms.test.ts` のうち Kit 側に来る分 —— パターン自体の検査(`:134-152`)と
 * ja/en の表の走査(`:154-164`)。
 *
 * TS の残り 2 本(`:166-176` のアプリのソース走査と `:193-217` の 推定/確認/指定 バッジの
 * 置き場所の検査)はアプリのファイルを読むので、Plan 2 のアプリ側テストの担当。
 */

/// TS `test("the patterns themselves still catch each banned class")`(`:134-152`)。
@Test func thePatternsThemselvesStillCatchEachBannedClass() {
  let seeded: [(String, String)] = [
    ("実測 (measurement jargon)", "ホテルまでの実測ではありません"),
    ("判定保留 (internal-state jargon)", "判定を保留しています"),
    ("判定保留 (internal-state jargon)", "判定は保留になります"),
    ("判定保留 (internal-state jargon)", "条件付きまたは判定保留と表示します"),
    ("対応品質/地域品質 (coverage-grade jargon)", "地域別の対応品質"),
    ("provider-internal API naming", "Uses the Places API for lookup"),
  ]
  for (name, sample) in seeded {
    let rule = BannedTerms.rules.first { $0.name == name }
    #expect(rule?.pattern.test(sample) == true, "\(name) must match \(sample)")
    #expect(BannedTerms.violations(in: sample).contains(name))
  }

  // 許可された出典表示と、画面に出ない API のトークンは当たってはいけない。
  let api = BannedTerms.rules.first { $0.name == "provider-internal API naming" }
  for allowed in ["Google Maps経路データ", "Rakuten Travel", "Open-Meteo", "Claude", "/api/place-photo", "?api=1", "GOOGLE_MAPS_API_KEY"] {
    #expect(api?.pattern.test(allowed) == false, "\(allowed) must stay allowed")
    #expect(BannedTerms.violations(in: allowed).isEmpty, "\(allowed) must stay allowed")
  }

  #expect(BannedTerms.patterns.count == 4)
  #expect(BannedTerms.violations(in: "ふつうの一行").isEmpty)
}

/// TS `test("the ja/en ui copy table carries no banned technical terms")`(`:154-164`)。
/// TS は `collectStrings` で表を歩いて 100 件超であることを確かめる —— Swift 側は
/// `PlannerCopy.allStaticStrings` が同じ歩き方をする。
@Test func theJaEnUiCopyTableCarriesNoBannedTechnicalTerms() {
  let strings = Copy.ja.allStaticStrings + Copy.en.allStaticStrings
  #expect(strings.count > 100, "ui table walk looks too small: \(strings.count) strings")
  // 233 の文字列キー × 2 言語 + 入れ子の 4 オブジェクト(3 + 3 + 4 + 4 = 14)× 2 言語。
  #expect(strings.count == (233 + 14) * 2)
  for (key, value) in strings {
    #expect(BannedTerms.violations(in: value).isEmpty, "\(key): \(value)")
  }
}

/// 関数値のキーは引数を入れないと文字列にならない —— TS は「planner-copy.ts のソース走査が
/// 見る」と書いている(`:131`)。Swift 側はソースを読めないので、代表的な引数で実際に呼んで
/// 出来上がった文を検査する。
@Test func theParameterisedCopyAlsoPassesBannedTerms() {
  let built: [String] = [
    Copy.ja.brandNote("東京"), Copy.en.brandNote(""),
    Copy.ja.optionCount(3), Copy.en.optionCount(1),
    Copy.ja.previewHeading(8), Copy.en.previewHeading(1),
    Copy.ja.previewDay(2), Copy.en.previewDay(2),
    Copy.ja.previewStay(90), Copy.en.previewStay(90),
    Copy.ja.curfewOver("22:00"), Copy.en.curfewOver("22:00"),
    Copy.ja.recentDays(4), Copy.en.recentDays(4),
    Copy.ja.routeIdeasDistance(1_450), Copy.en.routeIdeasDistance(320),
    Copy.ja.hotelDepartRow("電車", 20), Copy.en.hotelDepartRow("Train", 20),
    Copy.ja.hotelReturnRow("電車", 20), Copy.en.hotelReturnRow("Train", 20),
    Copy.ja.travelTotal(120), Copy.en.travelTotal(120),
    Copy.ja.precipitation(40), Copy.en.precipitation(40),
    Copy.ja.holidayNote("山の日"), Copy.en.holidayNote("Mountain Day"),
    Copy.ja.beforeBookedAt("10:00"), Copy.en.beforeBookedAt("10:00"),
    Copy.ja.minutes(30), Copy.en.minutes(30),
    Copy.ja.gapRecoLabel(45), Copy.en.gapRecoLabel(45),
    Copy.ja.detourLine(12), Copy.en.detourLine(12),
    Copy.ja.foodFresh(5), Copy.en.foodFresh(5),
    Copy.ja.hotelSavesTravel(80), Copy.en.hotelSavesTravel(80),
    Copy.ja.nightLabel(2), Copy.en.nightLabel(2),
    Copy.ja.rakutenTag(4.3, 1234), Copy.en.rakutenTag(4.3, 1234),
    Copy.ja.distanceFrom("2.5km"), Copy.en.distanceFrom("2.5km"),
    Copy.ja.tonightHotel("Hotel A"), Copy.en.tonightHotel("Hotel A"),
    Copy.ja.lateBy(15), Copy.en.lateBy(15),
    Copy.ja.lateShort(15), Copy.en.lateShort(15),
    Copy.ja.dayTimelineLabel("1日目"), Copy.en.dayTimelineLabel("Day 1"),
    Copy.ja.fitDaysValue(4), Copy.en.fitDaysValue(1),
    Copy.ja.deadlineOver("18:00"), Copy.en.deadlineOver("18:00"),
    Copy.ja.resolveRemoveAria("Senso-ji"), Copy.en.resolveRemoveAria("Senso-ji"),
    Copy.ja.dayHours("09:00–17:00"), Copy.en.dayHours("09:00–17:00"),
  ]
  for line in built {
    #expect(BannedTerms.violations(in: line).isEmpty, "\(line)")
  }
}

/// 地域の対応の文も旅行者が読む(TS は `lib/coverage-profile.ts` を走査対象に入れている
/// —— `tests/banned-terms.test.ts:29-30`)。
@Test func theCoveragePublicCopyCarriesNoBannedTechnicalTerms() {
  for id in CoverageProfileId.allCases {
    guard let profile = CoverageProfile.profiles[id] else { continue }
    for locale in [PlannerLocale.ja, .en] {
      let copy = CoverageProfile.publicCopy(profile, locale: locale)
      #expect(BannedTerms.violations(in: copy).isEmpty, "\(id): \(copy)")
      #expect(BannedTerms.violations(in: profile.label[locale] ?? "").isEmpty)
    }
  }
}

/// 判定文のビルダが作る文も同じ検査を通る —— 表の外で組まれた文が抜け道にならないように。
@Test func theVerdictSentencesAlsoPassBannedTerms() {
  for state in FeasibilityState.allCases {
    for locale in [PlannerLocale.ja, .en] {
      for cause in [nil, FeasibilityUnknownCause.UNRESOLVED_PLACE, .COMPUTATION_LIMIT] as [FeasibilityUnknownCause?] {
        let copy = VerdictCopy.feasibilityStateCopy(state, locale: locale, days: 4, stops: 8, unplacedCount: 1, checkCount: 2, unknownCause: cause)
        #expect(BannedTerms.violations(in: copy.headline).isEmpty, "\(copy.headline)")
        #expect(BannedTerms.violations(in: copy.label).isEmpty, "\(copy.label)")
      }
    }
  }
  for code in ConflictCode.allCases {
    for locale in [PlannerLocale.ja, .en] {
      let sentence = VerdictCopy.conflictCopy(
        Conflict(code: code, affectedItems: ["Senso-ji"], dayIndex: 0, overrunMinutes: 20, evidenceIds: []),
        locale: locale
      )
      #expect(BannedTerms.violations(in: sentence).isEmpty, "\(sentence)")
    }
  }
  for code in AttentionCode.allCases {
    for locale in [PlannerLocale.ja, .en] {
      let sentence = VerdictCopy.attentionCopy(
        Attention(code: code, dayIndex: 0, minutes: 10, affectedItems: ["Senso-ji", "Tokyo Skytree"], transferCount: 3, transferLimit: 2),
        locale: locale
      )
      #expect(BannedTerms.violations(in: sentence).isEmpty, "\(sentence)")
    }
  }
  for code in AssumptionCode.allCases {
    for locale in [PlannerLocale.ja, .en] {
      let sentence = VerdictCopy.assumptionCopy(Assumption(code: code, count: 3, evidenceIds: []), locale: locale)
      #expect(BannedTerms.violations(in: sentence).isEmpty, "\(sentence)")
    }
  }
}

/// タイムラインと旅の合計の文も同じく。
@Test func thePresentationSentencesAlsoPassBannedTerms() {
  for locale in [PlannerLocale.ja, .en] {
    for status in EvidenceStatus.allCases {
      #expect(BannedTerms.violations(in: TimelinePresentation.stayLine(minutes: 90, status: status, locale: locale)).isEmpty)
      #expect(BannedTerms.violations(in: TimelinePresentation.stayBasisLine(status, locale: locale)).isEmpty)
      #expect(BannedTerms.violations(in: TimelinePresentation.durationSourceLabel(status, locale: locale)).isEmpty)
    }
    #expect(BannedTerms.violations(in: TimelinePresentation.evidenceDisclosureLabel(locale)).isEmpty)
    #expect(BannedTerms.violations(in: TimelinePresentation.dayHeaderSummary(stopCount: 4, slackMinutes: 90, locale: locale)).isEmpty)
    #expect(BannedTerms.violations(in: TimelinePresentation.spareCapacityLine(slackMinutes: 385, remaining: 3, locale: locale)).isEmpty)
    #expect(BannedTerms.violations(in: TripPresentation.tripStatsLine(
      TripStatsTotals(placeCount: 8, travelMinutes: 520, bufferMinutes: 250, spareDays: 1),
      locale: locale
    )).isEmpty)
  }
}
