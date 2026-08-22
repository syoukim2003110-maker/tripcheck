import Foundation
import MapKit
import Testing
@testable import TripCheckAppCore
import TripCheckKit

/*
 * 端末の地図が答えた場所は「見つけた」であって「確かめた」ではない —— 出どころの URL も
 * 確認時刻も無いので、Kit がそれを検証済みとして描かないよう、証拠の欄は空のまま
 * `provider: .apple` / `confidence: .medium` で運ぶ(統合仕様 §4.2)。
 */

@Test func appleHitsBecomeEstimatedCandidatesNeverVerified() async {
  // 入力と完全一致する名前を置かない(一致が 1 件なら ResolutionPipeline.autoAccept が confirmed にする)
  let fake = FakeSearch(hits: ["Bern": [.init(name: "Old Town of Bern", address: "Bern, Switzerland", latitude: 46.948, longitude: 7.447, countryCode: "CH", category: "tourist_attraction"),
                                        .init(name: "Bern Historical Museum", address: "Bern", latitude: 46.943, longitude: 7.449, countryCode: "CH", category: "museum")]])
  let r = await ApplePlaceResolver(search: fake).resolve([PlaceQuery(inputIndex: 0, input: "Bern", pinnedProviderRef: nil)], destination: .auto, locale: .en)
  guard case .review(let c)? = r[0] else { Issue.record("expected review (2 candidates)"); return }
  #expect(c.count == 2); #expect(c.allSatisfy { $0.stop.provider == .apple })
  #expect(c[0].stop.confidence == .medium)
  #expect(c.allSatisfy { $0.stop.verifiedAt.isEmpty && $0.stop.userProvidedCoordinates != true })
}

@Test func exactAppleMatchIsConfirmedDirectly() async {
  let fake = FakeSearch(hits: ["senso-ji": [.init(name: "Senso-ji", address: "Asakusa", latitude: 35.7148, longitude: 139.7967, countryCode: "JP", category: "place_of_worship")]])
  let r = await ApplePlaceResolver(search: fake).resolve([PlaceQuery(inputIndex: 0, input: "senso-ji", pinnedProviderRef: nil)], destination: .auto, locale: .en)
  guard case .confirmed(let s)? = r[0] else { Issue.record("expected confirmed"); return }
  #expect(s.countryCode == "JP")
}

@Test func singleUniversityHitGoesToReview() async {
  let fake = FakeSearch(hits: ["Bern": [.init(name: "Universität Bern", address: "Bern", latitude: 46.95, longitude: 7.44, countryCode: "CH", category: "university")]])
  let r = await ApplePlaceResolver(search: fake).resolve([PlaceQuery(inputIndex: 0, input: "Bern", pinnedProviderRef: nil)], destination: .auto, locale: .en)
  guard case .review(let c)? = r[0] else { Issue.record("non-touristic single hit must ask"); return }
  #expect(c.count == 1); #expect(c[0].isTouristic == false)   // ResolutionPipeline.isNonTouristic(name:category:)
}

@Test func timeoutYieldsUnresolvedNotCrash() async {
  let r = await ApplePlaceResolver(search: HangingSearch(), timeout: .milliseconds(20)).resolve([PlaceQuery(inputIndex: 0, input: "X", pinnedProviderRef: nil)], destination: .auto, locale: .en)
  guard case .unresolved? = r[0] else { Issue.record("expected unresolved"); return }
  #expect(r.count == 1)
}

/// 証拠の欄そのもの。**id が `google-` / `hotel-` で始まらない**ことまで留めるのは、Kit の
/// 表示側がその前置きで「提供元が確かめた場所」を見分けるから(統合仕様 §4.2)。
@Test func appleStopsCarryNoProviderEvidence() async {
  let fake = FakeSearch(hits: ["Bern": [.init(name: "Old Town of Bern", address: "Bern, Switzerland", latitude: 46.948, longitude: 7.447, countryCode: "CH", category: "tourist_attraction"),
                                        .init(name: "Bern Historical Museum", address: "Bern, Switzerland", latitude: 46.943, longitude: 7.449, countryCode: "CH", category: "museum")]])
  let r = await ApplePlaceResolver(search: fake).resolve([PlaceQuery(inputIndex: 3, input: "Bern")], destination: .auto, locale: .en)
  guard case .review(let candidates)? = r[3] else { Issue.record("expected review"); return }
  var checked = 0
  for candidate in candidates {
    #expect(candidate.stop.providerRef == nil)
    #expect(candidate.stop.sourceUrl.isEmpty)
    #expect(candidate.stop.verifiedAt.isEmpty)
    #expect(candidate.stop.confidence == .medium)
    #expect(candidate.stop.provider == .apple)
    #expect(candidate.stop.inputIndex == 3)
    #expect(candidate.stop.input == "Bern")
    #expect(candidate.stop.id.hasPrefix("apple-3-"))
    #expect(!candidate.stop.id.hasPrefix("google-"))
    #expect(!candidate.stop.id.hasPrefix("hotel-"))
    checked += 1
  }
  #expect(checked == 2)
}

/// 二つの候補が同じ id を持つと、確認画面の並びが id で潰れて 1 件になる。
@Test func twoHitsForOneInputGetDifferentIds() async {
  let fake = FakeSearch(hits: ["Bahnhof": [.init(name: "Bahnhof", address: "Bern, Switzerland", latitude: 46.948, longitude: 7.439, countryCode: "CH", category: nil),
                                           .init(name: "Bahnhof", address: "Zürich, Switzerland", latitude: 47.378, longitude: 8.540, countryCode: "CH", category: nil)]])
  let r = await ApplePlaceResolver(search: fake).resolve([PlaceQuery(inputIndex: 0, input: "Bahnhof")], destination: .auto, locale: .en)
  guard case .review(let candidates)? = r[0] else { Issue.record("expected review"); return }
  #expect(Set(candidates.map(\.stop.id)).count == 2)
}

/// MapKit の分類は Kit の Google 型文字列に写す。写せていれば `StayEstimates` の表が当たる
/// (美術館は 120 分)—— rawValue のまま入れると、どの型にも当たらず 90 分の既定になる。
@Test func mappedCategoriesReachTheStayTable() async {
  #expect(ApplePlaceResolver.googlePlaceType(.museum) == "museum")
  #expect(ApplePlaceResolver.googlePlaceType(.amusementPark) == "amusement_park")
  #expect(ApplePlaceResolver.googlePlaceType(.theater) == "performing_arts_theater")
  #expect(ApplePlaceResolver.googlePlaceType(.store) == "department_store")
  #expect(ApplePlaceResolver.googlePlaceType(.brewery) == nil)

  let fake = FakeSearch(hits: ["Kunstmuseum": [.init(name: "Kunstmuseum Bern", address: "Bern, Switzerland", latitude: 46.949, longitude: 7.442, countryCode: "CH", category: "museum")]])
  let r = await ApplePlaceResolver(search: fake).resolve([PlaceQuery(inputIndex: 0, input: "Kunstmuseum")], destination: .auto, locale: .en)
  guard case .confirmed(let stop)? = r[0] else { Issue.record("one touristic hit is the answer"); return }
  #expect(stop.planningDurationMinutes == 120)
  #expect(stop.placeTypes == ["museum"])
}

/// 住所の中の市区だけを短い地名にする。TS `areaFromAddress` の縮小版で、通し方が変わると
/// 停留所の下に街路名や国名が出る。
@Test func theAreaLabelIsTheTownNotTheCountry() async {
  let fake = FakeSearch(hits: [
    "Gornergrat": [.init(name: "Gornergrat", address: "3920 Zermatt, Switzerland", latitude: 45.983, longitude: 7.784, countryCode: "CH", category: nil)],
    "浅草": [.init(name: "浅草寺前", address: "日本、〒111-0032 東京都台東区浅草2-3-1", latitude: 35.7148, longitude: 139.7967, countryCode: "JP", category: nil)],
  ])
  let r = await ApplePlaceResolver(search: fake).resolve(
    [PlaceQuery(inputIndex: 0, input: "Gornergrat"), PlaceQuery(inputIndex: 1, input: "浅草")],
    destination: .auto,
    locale: .ja
  )
  guard case .confirmed(let swiss)? = r[0] else { Issue.record("expected confirmed"); return }
  guard case .confirmed(let japan)? = r[1] else { Issue.record("expected confirmed"); return }
  #expect(swiss.area == "Zermatt")
  #expect(japan.area == "東京都台東区")
}

/// 0 件は「探したが無かった」。理由はパイプラインと同じ語なので、後続の解決器が上書きできる。
@Test func noHitsIsNotFoundNotUnavailable() async {
  let r = await ApplePlaceResolver(search: FakeSearch(hits: [:])).resolve([PlaceQuery(inputIndex: 0, input: "Nowhere xyz123")], destination: .auto, locale: .en)
  #expect(r[0] == .unresolved(reason: ResolutionPipeline.notFoundReason))
}

/// 旅行者が既にプロバイダの候補を選んでいる問い合わせには手を出さない —— その id を発行した
/// 解決器だけが同一性を確かめられる(`CatalogResolver` と同じ約束)。
@Test func aPinnedProviderRefIsLeftToTheResolverThatIssuedIt() async {
  let fake = FakeSearch(hits: ["Bern": [.init(name: "Bern", address: "Bern, Switzerland", latitude: 46.948, longitude: 7.447, countryCode: "CH", category: nil)]])
  let r = await ApplePlaceResolver(search: fake).resolve(
    [PlaceQuery(inputIndex: 0, input: "Bern", pinnedProviderRef: "ChIJsomething")],
    destination: .auto,
    locale: .en
  )
  #expect(r.isEmpty)
}

/// 打ち切りは 1 件ごと。遅い 1 件が、既に答えの出ている隣の行を道連れにしない。
@Test func oneSlowQueryDoesNotSinkTheOthers() async {
  let resolver = ApplePlaceResolver(search: MixedSearch(), timeout: .milliseconds(30))
  let r = await resolver.resolve(
    [PlaceQuery(inputIndex: 0, input: "slow"), PlaceQuery(inputIndex: 1, input: "Senso-ji")],
    destination: .auto,
    locale: .en
  )
  #expect(r[0] == .unresolved(reason: ApplePlaceResolver.unavailableReason))
  guard case .confirmed(let stop)? = r[1] else { Issue.record("the fast one still answers"); return }
  #expect(stop.name == "Senso-ji")
}

/// 探しに行く相手が投げたときも落ちない。理由は「探せなかった」で、`not_found` とは別の語
/// (後続の解決器はどちらでも上書きできるが、旅行者に出す文は別になる)。
@Test func aThrowingSearchIsUnavailable() async {
  let r = await ApplePlaceResolver(search: ThrowingSearch()).resolve([PlaceQuery(inputIndex: 0, input: "Bern")], destination: .auto, locale: .en)
  #expect(r[0] == .unresolved(reason: ApplePlaceResolver.unavailableReason))
}

/// 同時に尋ねる数は `concurrency` まで。12 件をまとめて渡しても、端末の地図に 12 本の
/// 問い合わせを一度に投げない。
@Test func atMostFourQueriesAreInFlight() async {
  let counter = CountingSearch()
  let queries = (0..<12).map { PlaceQuery(inputIndex: $0, input: "q\($0)") }
  let r = await ApplePlaceResolver(search: counter, concurrency: 4).resolve(queries, destination: .auto, locale: .en)
  let peak = await counter.peak
  #expect(r.count == 12)
  #expect(peak == 4)
}

/// 行き先の国を選んだら、その箱の外に落ちた候補は採らない(TS
/// `lib/google-place-resolver.ts:181` の `withinBounds`)。地図の `region` は寄せるだけの
/// 助言で、外の場所も返ってくる。
@Test func hitsOutsideTheChosenCountryAreDropped() async {
  let fake = FakeSearch(hits: ["Bern": [.init(name: "Bern", address: "Bern, Switzerland", latitude: 46.948, longitude: 7.447, countryCode: "CH", category: nil),
                                        .init(name: "Bern Township", address: "Pennsylvania", latitude: 40.55, longitude: -75.97, countryCode: "US", category: nil)]])
  let r = await ApplePlaceResolver(search: fake).resolve(
    [PlaceQuery(inputIndex: 0, input: "Bern")],
    destination: .destination(.switzerland),
    locale: .en
  )
  guard case .confirmed(let stop)? = r[0] else { Issue.record("only the Swiss one is left, so it is the answer"); return }
  #expect(stop.countryCode == "CH")
}

/// 候補は結果の側で 3 件に切る。表示側が 4 件目を選ぶ余地は作らない。
@Test func atMostThreeCandidatesLeaveTheResolver() async {
  let hits = (0..<7).map { index in
    LocalSearchHit(name: "Bern \(index)", address: "Bern, Switzerland", latitude: 46.9 + Double(index) * 0.01, longitude: 7.4, countryCode: "CH", category: nil)
  }
  let r = await ApplePlaceResolver(search: FakeSearch(hits: ["Bern": hits])).resolve([PlaceQuery(inputIndex: 0, input: "Bern")], destination: .auto, locale: .en)
  guard case .review(let candidates)? = r[0] else { Issue.record("expected review"); return }
  #expect(candidates.count == ResolutionPipeline.reviewShortlistLimit)
  #expect(candidates.map(\.stop.name) == ["Bern 0", "Bern 1", "Bern 2"])
}

/// 打ち切りは「待つのをやめる」ことではなく「相手に手を離させる」こと —— `withTaskGroup` は
/// 子が全部畳まれるまで返らないので、負けた側が取り消しを**見なかった**場合、6 秒の時計は
/// 端末では飾りになる(`MKLocalSearch.start()` は取り消しを見ないので、これは実際に起きうる)。
/// 時計そのものは測らない —— 忙しい機械では取り消しの続きが後回しになり、秒を数えると
/// 機械の都合で落ちる。**相手は 60 秒を名乗っている**ので、この関数が返ってくること自体が
/// 「待ち続けていない」の証拠になり、`sawCancellation` が「なぜ返ってきたか」を言う。
@Test func theLoserOfTheRaceIsToldToStop() async {
  let watch = CancellationWatch()
  let r = await ApplePlaceResolver(search: WatchingSearch(watch: watch), timeout: .milliseconds(30))
    .resolve([PlaceQuery(inputIndex: 0, input: "X")], destination: .auto, locale: .en)

  #expect(r[0] == .unresolved(reason: ApplePlaceResolver.unavailableReason))
  #expect(await watch.sawCancellation == true)           // 負けた側が取り消しを受け取って解けた
}

/// `MKLocalSearchAdapter` が待ちを包む一枚。取り消しの合図が本当に外へ渡ること、そして
/// **一度しか渡らない**こと(取り消しは競争の合図と親の取り消しの 2 度来うる)。端末の地図に
/// 触らずに、`search` の中の配線そのものを検査する。
@Test func aCancelledWaitPullsTheHandle() async {
  let pulls = PullCounter()
  let handle = CancelHandle { pulls.bump() }
  let task = Task {
    await handle.relaying { try? await Task.sleep(for: .seconds(60)) }
  }
  // 待ちが立ってから取り消す(立つ前だと `withTaskCancellationHandler` が入口で引く)。
  try? await Task.sleep(for: .milliseconds(20))
  task.cancel()
  await task.value

  #expect(pulls.count == 1)
  handle.cancel()                                        // 2 度目は空振り
  #expect(pulls.count == 1)
}

// MARK: - このファイルだけが使う相手

/// 1 つの文字列にだけ永久に答えない相手。ほかは即答する。
private struct MixedSearch: LocalSearching {
  func search(query: String, region: GeoBounds?, locale: PlannerLocale) async throws -> [LocalSearchHit] {
    if query == "slow" {
      try await Task.sleep(for: .seconds(60))
      return []
    }
    return [LocalSearchHit(name: query, address: "Asakusa, Tokyo, Japan", latitude: 35.7148, longitude: 139.7967, countryCode: "JP", category: nil)]
  }
}

private struct ThrowingSearch: LocalSearching {
  struct Nope: Error {}
  func search(query: String, region: GeoBounds?, locale: PlannerLocale) async throws -> [LocalSearchHit] { throw Nope() }
}

/// 60 秒名乗っておいて、解かれた瞬間に「取り消されて解けたのか」を書き残す相手。
/// `HangingSearch` との違いはその 1 点だけ。
private struct WatchingSearch: LocalSearching {
  let watch: CancellationWatch

  func search(query: String, region: GeoBounds?, locale: PlannerLocale) async throws -> [LocalSearchHit] {
    do {
      try await Task.sleep(for: .seconds(60))
    } catch {
      await watch.note(cancelled: Task.isCancelled)
      throw error
    }
    return []
  }
}

private actor CancellationWatch {
  private(set) var sawCancellation = false
  func note(cancelled: Bool) { sawCancellation = sawCancellation || cancelled }
}

/// 取り消しの合図は本線の外から来るので、数える側にも錠が要る。
private final class PullCounter: @unchecked Sendable {
  private let lock = NSLock()
  private var pulls = 0

  var count: Int { lock.withLock { pulls } }
  func bump() { lock.withLock { pulls += 1 } }
}
