import Testing
@testable import TripCheckKit

@Test func catalogRecognisesAliasesInFourScripts() {
  #expect(Catalog.resolveKnownStops("築地場外市場", locale: .ja).first?.id == "tsukiji-market")
  #expect(Catalog.resolveKnownStops("teamLab Planets", locale: .en).first?.planningDurationMinutes == 120)
  #expect(Catalog.resolveKnownStops("센소지", locale: .en).first?.id == "sensoji")
  #expect(Catalog.poiCount == 18)
}

@Test func resolveKnownStopsDisambiguatesOverlappingAliases() {
  // shibuya-sky の alias が shibuya の negative lookahead を通らないようにする(TS :204/:220)。
  #expect(Catalog.resolveKnownStops("Shibuya Sky observation deck", locale: .en).map(\.id) == ["shibuya-sky"])
  #expect(Catalog.resolveKnownStops("渋谷スカイから見る夜景", locale: .ja).map(\.id) == ["shibuya-sky"])
  // sensoji の alias(浅草寺)は asakusa の negative lookahead(浅草(?!寺))を止める。
  #expect(Catalog.resolveKnownStops("浅草寺と浅草の街並み", locale: .ja).map(\.id) == ["sensoji", "asakusa"])
}

@Test func resolveKnownStopsOrdersByFirstOccurrenceAndSetsAnchorFromLine() {
  let stops = Catalog.resolveKnownStops("新宿から東京駅へ", locale: .ja)
  #expect(stops.map(\.id) == ["shinjuku", "tokyo-station"])
  // 通常の行は isAnchor = false。
  #expect(stops.allSatisfy { $0.isAnchor == false })
  // 明示的な予約語(要予約)は isAnchor を立てる(TS :299 explicitAnchorPattern)。
  #expect(Catalog.resolveKnownStops("築地場外市場(要予約)", locale: .ja).first?.isAnchor == true)
  #expect(Catalog.resolveKnownStops("秋葉原 must-do", locale: .en).first?.isAnchor == true)
  // teamLab Planets はカタログ上 reservationSensitive のため、予約語が無くても isAnchor = true。
  #expect(Catalog.resolveKnownStops("teamLab Planets", locale: .en).first?.isAnchor == true)
}

@Test func isReservationSensitiveMatchesCatalogFlags() {
  #expect(Catalog.isReservationSensitive(id: "teamlab-planets"))
  #expect(Catalog.isReservationSensitive(id: "shibuya-sky"))
  #expect(Catalog.isReservationSensitive(id: "ghibli-museum"))
  #expect(!Catalog.isReservationSensitive(id: "shinjuku"))
  #expect(!Catalog.isReservationSensitive(id: "unknown-poi-id"))
}

/// 欄は Web のデモ投入(`app/components/planner/hooks/usePlanBuild.tsx:808-822`)と同じ値で
/// 固定する —— 同じサンプルが Web とアプリで別物になると、共有リンクと golden が食い違う。
@Test func swissSampleBuildsResolvedStopsForBuilderFixtures() {
  let stops = SwissSample.resolvedStops(locale: .en)
  #expect(stops.count == 8)
  // TS `id: `sample-${demoDestination.id}-${index}``(`usePlanBuild.tsx:809`)
  #expect(stops.map(\.id) == (0..<8).map { "sample-switzerland-\($0)" })
  // TS `sourceUrl: ""` / `verifiedAt: ""` / `confidence: "medium"` / `isAnchor: false`(`:817-821`)
  #expect(stops.allSatisfy {
    $0.provider == .catalog && $0.confidence == .medium && $0.verifiedAt == "" && !$0.isAnchor && $0.sourceUrl == ""
  })
  #expect(stops[0].name == "Lucerne Chapel Bridge")
  #expect(stops[0].input == stops[0].name)
  #expect(stops[0].inputIndex == 0)
  #expect(stops[0].address == stops[0].area)
  #expect(stops[0].openingHoursApplicable == false) // 広場は営業時間の概念が無い(TS :285 openingHoursApplicable: false)
  #expect(stops[3].name == "Jungfraujoch")
  // TS は `openingHoursApplicable === false` のときだけ欄を置く(`:822`)—— 既定は欄ごと無い。
  #expect(stops[3].openingHoursApplicable == nil)

  let ja = SwissSample.resolvedStops(locale: .ja)
  #expect(ja[3].name == "ユングフラウヨッホ")
  #expect(ja[3].id == "sample-switzerland-3") // id はロケールに依存しない
}
