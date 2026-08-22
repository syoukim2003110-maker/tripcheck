import Testing
@testable import TripCheckKit

// MARK: - カタログ解決器

@Test func catalogResolverConfirmsKnownTokyoPlaces() async {
  let r = await CatalogResolver().resolve([PlaceQuery(inputIndex: 0, input: "浅草寺", pinnedProviderRef: nil)], destination: .auto, locale: .ja)
  guard case .confirmed(let s) = r[0] else { Issue.record("expected confirmed"); return }
  #expect(s.id == "sensoji")
  #expect(s.provider == .catalog)
}

/// 東京 18 の隣に置いたスイス 8(`Destinations.byId(.switzerland).sampleStops`)も同じ規則で
/// 確定する。そして**解決できなかった問い合わせは辞書に入らない** —— 次の解決器の出番だから。
@Test func catalogResolverConfirmsSwissSampleAndReturnsNothingForUnknownInput() async {
  let queries = [
    PlaceQuery(inputIndex: 0, input: "ゴルナーグラート", pinnedProviderRef: nil),
    PlaceQuery(inputIndex: 1, input: "Bern Old Town", pinnedProviderRef: nil),
    PlaceQuery(inputIndex: 2, input: "Acme Insurance Inc.", pinnedProviderRef: nil),
  ]
  let r = await CatalogResolver().resolve(queries, destination: .destination(.switzerland), locale: .en)
  guard case .confirmed(let gornergrat) = r[0] else { Issue.record("expected confirmed"); return }
  // ja で書かれた入力でも en の停留所が返る(問い合わせのロケールが名前を決める)。
  #expect(gornergrat.name == "Gornergrat")
  #expect(gornergrat.input == "ゴルナーグラート")
  #expect(gornergrat.inputIndex == 0)
  #expect(gornergrat.provider == .catalog)
  guard case .confirmed(let bern) = r[1] else { Issue.record("expected confirmed"); return }
  #expect(bern.name == "Bern Old Town")
  // スイスのサンプルは Web のデモ投入と同じ欄(`usePlanBuild.tsx:808-822`)。
  #expect(bern.id == "sample-switzerland-7")
  #expect(bern.verifiedAt == "")
  #expect(!bern.isAnchor)
  #expect(r[2] == nil)
  #expect(r.count == 2)
}

/// 旅行者が既にプロバイダの候補を選んでいる行には、カタログは手を出さない —— その id の
/// 同一性を確かめられるのは、id を発行した解決器だけだから(TS `:268-270`)。
@Test func catalogResolverAbstainsOnPinnedProviderChoices() async {
  let queries = [
    PlaceQuery(inputIndex: 0, input: "Senso-ji", pinnedProviderRef: "ChIJ8T1GpMGOGGARDYGSgpooDWw"),
    PlaceQuery(inputIndex: 1, input: "Senso-ji", pinnedProviderRef: nil),
  ]
  let r = await CatalogResolver().resolve(queries, destination: .auto, locale: .en)
  #expect(r[0] == nil)
  guard case .confirmed(let stop) = r[1] else { Issue.record("expected confirmed"); return }
  #expect(stop.id == "sensoji")
  #expect(r.count == 1)
}

// MARK: - 自動採用の規則

@Test func exactMatchIsAutoAcceptedEvenAmongSiblings() {
  let gornergrat = TestStops.candidate(name: "Gornergrat", category: "mountain_peak")
  let railway = TestStops.candidate(name: "Gornergrat Bahn", category: "train_station")
  #expect(ResolutionPipeline.autoAccept(input: "gornergrat", candidates: [railway, gornergrat])?.stop.name == "Gornergrat")
}

@Test func singleNonTouristicCandidateGoesToReview() {
  let uni = TestStops.candidate(name: "Universität Bern", category: "university")
  #expect(ResolutionPipeline.autoAccept(input: "Bern", candidates: [uni]) == nil)
  #expect(ResolutionPipeline.isNonTouristic(name: "Acme Insurance Inc.", category: nil))
  #expect(!ResolutionPipeline.isNonTouristic(name: "Bern Old Town", category: "tourist_attraction"))
}

/// 完全一致が 2 件なら「完全一致」は答えではない(TS `exactNameCandidate` は `length === 1` だけを
/// 返す)。候補が複数で完全一致が無いときも、旅行者に選んでもらう。
@Test func autoAcceptStaysSilentWhenTheShortlistIsGenuinelyAmbiguous() {
  let one = TestStops.candidate(name: "Bern", category: "locality")
  let two = TestStops.candidate(name: "BERN", category: "locality")
  #expect(ResolutionPipeline.autoAccept(input: "bern", candidates: [one, two]) == nil)
  let oldTown = TestStops.candidate(name: "Bern Old Town", category: "tourist_attraction")
  let cathedral = TestStops.candidate(name: "Bern Minster", category: "church")
  #expect(ResolutionPipeline.autoAccept(input: "Bern", candidates: [oldTown, cathedral]) == nil)
  #expect(ResolutionPipeline.autoAccept(input: "Bern", candidates: []) == nil)
  // 非観光の候補を除くと 1 件だけ残る、が自動採用の 2 つ目の道。
  let uni = TestStops.candidate(name: "Universität Bern", category: "university")
  #expect(ResolutionPipeline.autoAccept(input: "Bern", candidates: [uni, oldTown])?.stop.name == "Bern Old Town")
}

/// 非観光の合図は `category` だけでなく `placeTypes` からも来る —— Google は `primaryType` を
/// `types` にも並べるので、片方しか見ないと取りこぼす(TS `:308-318`)。
@Test func placeTypesAloneCanSendACandidateToReview() {
  let clinic = TestStops.candidate(name: "Bern Center", placeTypes: ["point_of_interest", "hospital"])
  #expect(!clinic.isTouristic)
  #expect(ResolutionPipeline.autoAccept(input: "Bern Center", candidates: [clinic]) == nil)
  let park = TestStops.candidate(name: "Bern Center", placeTypes: ["point_of_interest", "park"])
  #expect(park.isTouristic)
  #expect(ResolutionPipeline.autoAccept(input: "Bern Center", candidates: [park])?.stop.name == "Bern Center")
  // 解決器が自分の分類を持っているときは、明示的な上書きが勝つ。
  #expect(PlaceCandidate(stop: TestStops.resolved("Kyoto University Museum"), category: "university", isTouristic: true).isTouristic)
}

/// 企業名パターンは名前だけを見る(TS の 12 種のタイプ + `corporateQualifierPattern` を逐語)。
@Test func nonTouristicCoversTheTypeListAndTheCorporateNamePattern() {
  #expect(ResolutionPipeline.nonTouristicCategories.count == 12)
  for category in ["university", "school", "primary_school", "secondary_school", "hospital", "doctor"] {
    #expect(ResolutionPipeline.isNonTouristic(name: "Somewhere", category: category))
  }
  for name in ["東京海上日動 本社", "アクメ株式会社", "Zurich Insurance", "Acme Ltd.", "Acme Corporate Center", "Global Headquarters", "The Post Office"] {
    #expect(ResolutionPipeline.isNonTouristic(name: name, category: nil), "\(name) should read as non-touristic")
  }
  // 語境界つき —— 「officer」や地名の一部は捕まえない。
  #expect(!ResolutionPipeline.isNonTouristic(name: "Officers Club Museum", category: "museum"))
  #expect(!ResolutionPipeline.isNonTouristic(name: "Gornergrat", category: nil))
  // JS の `\b` は ASCII 基準なので、漢字・かなの隣でも当たる。ICU の `\b` は当たらない ——
  // ASCII の前後読みに書き換えて JS と同じ位置で当てる(`ResolutionPipeline` の当該コメント)。
  for name in ["東京office", "Officeビル", "浅草寺office", "東京inc", "アクメltd"] {
    #expect(ResolutionPipeline.isNonTouristic(name: name, category: nil), "\(name) should read as non-touristic")
  }
  // TS の `corporateQualifierPattern.test("Post Office Museum")` も true。ただし TS が
  // このパターンを見るのは 12 種か `service` 型の候補だけ(`:316-324`)なので、TS 全体の答えは
  // 「観光地」。Kit はカテゴリを問わず名前で判定する = **TS より広い**(逸脱として記録済み)。
  #expect(ResolutionPipeline.isNonTouristic(name: "Post Office Museum", category: "museum"))
}

// MARK: - 解決器の連結

@Test func pipelineStopsAtFirstConfirmedResolver() async {
  struct Never: PlaceResolver {
    func resolve(_ q: [PlaceQuery], destination: DestinationChoice, locale: PlannerLocale) async -> [Int: PlaceResolution] {
      Issue.record("must not be called")
      return [:]
    }
  }
  let r = await ResolutionPipeline.resolve([PlaceQuery(inputIndex: 0, input: "Senso-ji", pinnedProviderRef: nil)], destination: .auto, locale: .en, resolvers: [CatalogResolver(), Never()])
  guard case .confirmed = r[0] else { Issue.record("expected confirmed"); return }
}

/// 一部だけが確定したとき:次の解決器は**残りの問い合わせだけ**を受け取る。
@Test func laterResolversOnlySeeWhatIsStillUnsettled() async {
  let log = QueryLog()
  let queries = [
    PlaceQuery(inputIndex: 0, input: "Senso-ji", pinnedProviderRef: nil),
    PlaceQuery(inputIndex: 1, input: "Somewhere nobody knows", pinnedProviderRef: nil),
  ]
  let stub = StubResolver([1: .confirmed(TestStops.resolved("late"))], log: log)
  let r = await ResolutionPipeline.resolve(queries, destination: .auto, locale: .en, resolvers: [CatalogResolver(), stub])
  let seen = await log.seen
  #expect(seen == [[1]])
  guard case .confirmed(let sensoji) = r[0] else { Issue.record("expected confirmed"); return }
  #expect(sensoji.id == "sensoji")
  guard case .confirmed(let late) = r[1] else { Issue.record("expected confirmed"); return }
  #expect(late.id == "late")
}

/// 後の解決器の「見つからない」は、先の解決器が集めた候補を消さない。同じ順位どうしなら
/// **束ねた順が信頼の順**で先が残り、誰も答えなかった問い合わせだけがパイプライン自身の
/// `unresolved` になる。
@Test func aLaterBlankNeverErasesAnEarlierShortlist() async {
  let queries = (0...3).map { PlaceQuery(inputIndex: $0, input: "input \($0)", pinnedProviderRef: nil) }
  let shortlist = [TestStops.candidate(name: "Bern Old Town", category: "tourist_attraction")]
  let otherShortlist = [TestStops.candidate(name: "Bern Minster", category: "church")]
  let first = StubResolver([0: .review(shortlist), 1: .unresolved(reason: "unavailable"), 3: .review(shortlist)])
  let second = StubResolver([0: .unresolved(reason: "quota_exhausted"), 1: .review(shortlist), 3: .review(otherShortlist)])
  let r = await ResolutionPipeline.resolve(queries, destination: .auto, locale: .en, resolvers: [first, second])
  #expect(r[0] == PlaceResolution.review(shortlist))
  #expect(r[1] == PlaceResolution.review(shortlist))
  #expect(r[2] == PlaceResolution.unresolved(reason: "not_found"))
  #expect(r[3] == PlaceResolution.review(shortlist))
}

/// 確認へ回る候補は 3 件まで(TS `:403` の `slice(0, 3)`)。切るのは表示ではなく結果の側。
@Test func reviewShortlistsAreCutToThree() async {
  #expect(ResolutionPipeline.reviewShortlistLimit == 3)
  let four = ["Bern Old Town", "Bern Minster", "Bern Bear Park", "Bern Museum"]
    .map { TestStops.candidate(name: $0, category: "tourist_attraction") }
  let query = [PlaceQuery(inputIndex: 0, input: "Bern", pinnedProviderRef: nil)]
  let r = await ResolutionPipeline.resolve(query, destination: .auto, locale: .en, resolvers: [StubResolver([0: .review(four)])])
  guard case .review(let shown) = r[0] else { Issue.record("expected review"); return }
  #expect(shown.map(\.stop.name) == ["Bern Old Town", "Bern Minster", "Bern Bear Park"])
}

// MARK: - 混在国と「3 件ずつ」

@Test func mixedCountriesAreListedAndRanksComeInThrees() {
  #expect(ResolutionPipeline.mixedCountryCodes(TestStops.mixed(["JP", "CH", "JP"])) == ["CH", "JP"])
  #expect(ResolutionPipeline.mixedCountryCodes(TestStops.mixed(["JP", "JP"])).isEmpty)
  let ranks = ResolutionPipeline.attentionRanks([0: .confirmed(TestStops.resolved("a")), 1: .review([]), 2: .unresolved(reason: "x"), 3: .review([])])
  #expect(ranks == [1: 0, 2: 1, 3: 2])
}

/// 順位は**入力順**(貼られた行の順)で、辞書の並びには依らない。国コードを持たない停留所は
/// 投票にも混在判定にも参加しない(カタログ由来の停留所がまさにそれ)。
@Test func ranksFollowInputOrderAndCountrylessStopsDoNotVote() {
  let ranks = ResolutionPipeline.attentionRanks([
    9: .unresolved(reason: "x"),
    2: .review([]),
    5: .confirmed(TestStops.resolved("a")),
    0: .unresolved(reason: "x"),
  ])
  #expect(ranks == [0: 0, 2: 1, 9: 2])
  #expect(ResolutionPipeline.attentionRanks([:]).isEmpty)
  #expect(ResolutionPipeline.mixedCountryCodes([TestStops.resolved("a"), TestStops.resolved("b")]).isEmpty)
  #expect(ResolutionPipeline.mixedCountryCodes(TestStops.mixed(["FR", "CH", "JP"])) == ["CH", "FR", "JP"])
}

// MARK: - テスト用の解決器

/// どの問い合わせが渡ってきたかを記録する箱。
private actor QueryLog {
  private(set) var seen: [[Int]] = []

  func record(_ queries: [PlaceQuery]) {
    seen.append(queries.map(\.inputIndex))
  }
}

/// 決まった答えを返すだけの解決器。渡された問い合わせに含まれない添字は返さない。
private struct StubResolver: PlaceResolver {
  let answers: [Int: PlaceResolution]
  let log: QueryLog?

  init(_ answers: [Int: PlaceResolution], log: QueryLog? = nil) {
    self.answers = answers
    self.log = log
  }

  func resolve(_ queries: [PlaceQuery], destination: DestinationChoice, locale: PlannerLocale) async -> [Int: PlaceResolution] {
    await log?.record(queries)
    let asked = Set(queries.map(\.inputIndex))
    return answers.filter { asked.contains($0.key) }
  }
}
