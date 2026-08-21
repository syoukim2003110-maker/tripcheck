import Testing
@testable import TripCheckKit

@Test func exactOrderingBeatsGreedyUpToTenStops() {
  let stops = TestStops.ring(count: 8)
  let out = RouteOrdering.optimize(stops, preserveFirst: false)
  #expect(out.exact)
  #expect(RouteOrdering.openPathDistanceKm(out.stops) <= RouteOrdering.openPathDistanceKm(stops) + 1e-9)
  let eleven = TestStops.ring(count: 11)
  #expect(RouteOrdering.optimize(eleven, preserveFirst: false).exact == false)
}

@Test func googleMapsUrlCapsWaypointsAtTen() {
  let url = GoogleMapsUrl.build(TestStops.ring(count: 13), travelMode: .transit)
  #expect(url.hasPrefix("https://www.google.com/maps/dir/?api=1"))
  #expect(url.components(separatedBy: "%7C").count <= 9) // waypoints は先頭 9 + 最終
}

@Test func preserveFirstKeepsTheGivenStartEvenWhenNotOptimal() {
  let stops = TestStops.ring(count: 8)
  let out = RouteOrdering.optimize(stops, preserveFirst: true)
  #expect(out.stops.first?.id == stops.first?.id)
  #expect(out.exact)
}

@Test func heldKarpRespectsAnchorRelativeOrder() {
  // 2 つの isAnchor な停留所は、入力に現れた相対順を Held-Karp が崩してはいけない(TS :362-366)。
  var farAnchor = TestStops.point(id: "anchor-far", lat: 35.9, lng: 139.9)
  farAnchor.isAnchor = true
  var nearAnchor = TestStops.point(id: "anchor-near", lat: 35.69, lng: 139.70)
  nearAnchor.isAnchor = true
  let start = TestStops.point(id: "start", lat: 35.681236, lng: 139.767125)
  let filler = TestStops.point(id: "filler", lat: 35.66, lng: 139.75)

  let stops = [start, farAnchor, nearAnchor, filler]
  let out = RouteOrdering.optimize(stops, preserveFirst: true)
  #expect(out.exact)
  let anchorIds = out.stops.filter(\.isAnchor).map(\.id)
  #expect(anchorIds == ["anchor-far", "anchor-near"])
}

@Test func heuristicPathAlsoRespectsAnchorOrderAboveTenStops() {
  var stops = TestStops.ring(count: 12)
  // 4 番目と 9 番目(id 基準)を anchor にして、探索後もその相対順(id の出現順)を保つか確認する。
  guard let firstAnchorIndex = stops.firstIndex(where: { $0.id == "ring-4" }),
        let secondAnchorIndex = stops.firstIndex(where: { $0.id == "ring-9" }) else {
    Issue.record("fixture missing expected ids")
    return
  }
  stops[firstAnchorIndex].isAnchor = true
  stops[secondAnchorIndex].isAnchor = true
  let inputAnchorOrder = stops.filter(\.isAnchor).map(\.id)

  let out = RouteOrdering.optimize(stops, preserveFirst: true)
  #expect(out.exact == false)
  #expect(out.stops.filter(\.isAnchor).map(\.id) == inputAnchorOrder)
  #expect(RouteOrdering.openPathDistanceKm(out.stops) <= RouteOrdering.openPathDistanceKm(stops))
}

// MARK: - tests/route-optimizer.test.ts の残りケース
//
// TS の `optimizeItineraryRoute` (lib/route-optimizer.ts:453-499、テキストを日ごとに分割して
// 各日を最適化する合成関数)は Task 7 の移植範囲外(brief は :3-452 まで、Produces にも無い)。
// 3 本の TS テストは全てこの関数を通す。以下の 2 本は、その関数が組み立てるのと同じ入力を
// `Catalog.resolveKnownStops` + `RouteOrdering.optimize` + `GoogleMapsUrl.build` で直接組み立てて
// 同じ意図(最短化・先頭固定・Google Maps ハンドオフの形)を検証する。3 本目
// ("does not claim a route when fewer than two known stops exist") は、複数行にまたがる
// 「日」の組み立てと「2 件未満なら日として成立させない」というフィルタ自体が
// `optimizeItineraryRoute` 側の判断であり、この層に相当する概念が無いため移植しない。

@Test func matchesTsDayOptimizationKeepingFirstStopFixed() {
  // TS: "optimizes a day locally while keeping its first stop fixed"
  let lines = [
    "09:00 Tsukiji Outer Market",
    "11:00 Shibuya Sky",
    "13:00 Senso-ji",
    "15:00 Tokyo Skytree",
    "18:00 Shinjuku",
  ]
  var stops: [RouteStop] = []
  for line in lines {
    for stop in Catalog.resolveKnownStops(line, locale: .en) where !stops.contains(where: { $0.id == stop.id }) {
      stops.append(stop)
    }
  }
  #expect(stops.count == 5)

  let out = RouteOrdering.optimize(stops, preserveFirst: true)
  #expect(out.exact)
  #expect(out.stops.first?.id == "tsukiji-market")

  let originalDistanceKm = RouteOrdering.openPathDistanceKm(stops)
  let optimizedDistanceKm = RouteOrdering.openPathDistanceKm(out.stops)
  #expect(optimizedDistanceKm < originalDistanceKm)
  #expect(originalDistanceKm - optimizedDistanceKm > 5)
}

@Test func matchesTsGoogleMapsHandoffFormat() {
  // TS: "keeps separate days separate and builds an explicit Google Maps handoff"
  // (日の分離は optimizeItineraryRoute の範囲。ここでは 1 日分のハンドオフ形式のみ検証する。)
  let lines = ["明治神宮", "渋谷スカイ", "新宿"]
  var stops: [RouteStop] = []
  for line in lines {
    for stop in Catalog.resolveKnownStops(line, locale: .ja) where !stops.contains(where: { $0.id == stop.id }) {
      stops.append(stop)
    }
  }
  let out = RouteOrdering.optimize(stops, preserveFirst: true)
  let url = GoogleMapsUrl.build(out.stops)

  #expect(url.hasPrefix("https://www.google.com/maps/dir/?"))
  #expect(url.contains("travelmode=transit"))
  // 停留所は座標だけで表現されるため、地名は URL に現れない。
  #expect(!url.contains("浅草寺"))
  #expect(!url.contains("明治神宮"))
}

// MARK: - optimizeFromBase (lib/trip-builder.ts:585-637), ported alongside Task 10's
// `orderForReservations`, which is its only caller.

@Test func optimizeFromBaseLeavesAndReturnsToTheHotelTheShortWay() {
  // ばらばらに与えた一直線上の 4 点は、ホテルを出て帰る閉路として並べ直される。直線なので
  // 東行きと西行きの閉路長は必ず同じ(base の位置によらない)ため、どちらの向きも正解。
  let line = TestStops.line(ids: ["a", "b", "c", "d"])
  let scrambled = [line[2], line[0], line[3], line[1]]
  let base = TestStops.point(id: "hotel", lat: 35.681236, lng: 139.767125 - 0.02)
  let ordered = RouteOrdering.optimizeFromBase(scrambled, base: base)
  #expect(ordered.map(\.id) == ["a", "b", "c", "d"] || ordered.map(\.id) == ["d", "c", "b", "a"])
  #expect(RouteOrdering.routeDistanceFromBase(ordered, base: base)
    < RouteOrdering.routeDistanceFromBase(scrambled, base: base))
  #expect(RouteOrdering.optimizeFromBase([], base: base).isEmpty)
  #expect(RouteOrdering.optimizeFromBase([line[0]], base: base).map(\.id) == ["a"])
}

@Test func optimizeFromBaseFallsBackToTheHeuristicBeyondTheHeldKarpLimit() {
  // 11 点(> heldKarpLimit)は近似解に落ち、往路/復路の向きだけ距離で選び直す。
  let ids = (0..<11).map { "line-\($0)" }
  let stops = TestStops.line(ids: ids)
  let base = TestStops.point(id: "hotel", lat: 35.681236, lng: 139.767125 - 0.02)
  let ordered = RouteOrdering.optimizeFromBase(stops, base: base)
  #expect(ordered.count == 11)
  #expect(Set(ordered.map(\.id)) == Set(ids))
  #expect(RouteOrdering.routeDistanceFromBase(ordered, base: base)
    <= RouteOrdering.routeDistanceFromBase(ordered.reversed(), base: base))
}

@Test func aDuplicatedAnchorIdKeepsTheHeuristicFromCrashing() {
  // Task 7 の残: anchor id が重複すると次に必要な anchor がどれとも一致せず候補が空になる。
  // 順序を壊すより入力順のまま返す。
  var stops = TestStops.ring(count: 12)
  for index in stops.indices where index < 3 {
    stops[index].isAnchor = true
    stops[index].id = "same-anchor"
  }
  let out = RouteOrdering.optimize(stops, preserveFirst: true)
  #expect(out.stops.count == stops.count)
  #expect(out.exact == false)
}
