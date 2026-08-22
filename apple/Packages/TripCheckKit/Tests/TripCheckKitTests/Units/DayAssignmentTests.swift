import Testing
@testable import TripCheckKit

// task-13-brief.md §Step 1 tests. brief から動かした 2 本は、それぞれの直前に理由を書いた。
// (brief の `swissFourDaySampleLeavesNoEmptyDay` は `TripBuilder.build` = Task 15 待ちなので
//  ここには置かない。同じ契約のテストは Task 15 側に存在する。)

@Test func emptyDaysAndUnderfillOutrankTravel() {
  let a = DayAssignmentScore(hardViolationCount: 0, hardViolationMagnitude: 0, overrunDayCount: 0, totalOverrunMinutes: 0, emptyDayCount: 1, overloadMinutes: 0, underfillMinutes: 0, travelMinutes: 0, maximumDayMinutes: 0, loadSpreadMinutes: 0, tieBreak: "")
  let b = DayAssignmentScore(hardViolationCount: 0, hardViolationMagnitude: 0, overrunDayCount: 0, totalOverrunMinutes: 0, emptyDayCount: 0, overloadMinutes: 0, underfillMinutes: 0, travelMinutes: 9999, maximumDayMinutes: 999, loadSpreadMinutes: 999, tieBreak: "")
  #expect(b < a)
}

/// 採点の 3 つの式 — 件数超過 1 件 = 240 分、不足の**二乗**、そして空の日を数える門 —
/// を実際に組んだ日で踏む。`emptyDaysAndUnderfillOutrankTravel` は比較子だけを見ていて、
/// これらの算術には 1 行も触れない。TS `lib/trip-builder.ts:1760-1785`。
@Test func scorePenalizesOverCapacityPerStopAndSquaresTheUnderfillDeficit() {
  let stops = TestStops.line(ids: ["a", "b", "c", "d", "e"], stayMinutes: 60)
  let clusters = [[stops[0], stops[1], stops[2], stops[3]], [stops[4]]]
  let days = clusters.enumerated().map { TestStops.buildPlainDay($0.element, index: $0.offset) }
  let score = DayAssignment.score(days: days, clusters: clusters, limits: .init(paceCapacity: 2, dayBudgetMinutes: 570))
  // 定員 2 に 4 件 = 2 件超過 → 480 分。日の合計は 330 分 / 60 分で、分数予算 570 は超えない。
  #expect(score.overloadMinutes == 480)
  // 床 = min(240, round(570 × 0.45) = 257) = 240。1 日目は滞在 4 × 60 = 240 でちょうど不足なし、
  // 2 日目は 60 なので不足 180 → 二乗して 32400。線形和なら 180 のままで、再配分しても
  // 変わらない = 探索が動けない。
  #expect(score.underfillMinutes == 180 * 180)
  #expect(score.tieBreak == "a\u{0}b\u{0}c\u{0}d\u{1}e")

  // 空の日を数えるのは「停留所が日数以上ある」ときだけ(`:1761`)。材料が足りない日程で
  // 空の日を罰すると、置く物がないのに違反が立つ。
  let tooThin = [[stops[0]], [stops[1]], []]
  let thinDays = tooThin.enumerated().map { TestStops.buildPlainDay($0.element, index: $0.offset) }
  #expect(DayAssignment.score(days: thinDays, clusters: tooThin, limits: .init(paceCapacity: 2, dayBudgetMinutes: 570)).emptyDayCount == 0)
  let enough = [[stops[0], stops[1]], [stops[2]], []]
  let enoughDays = enough.enumerated().map { TestStops.buildPlainDay($0.element, index: $0.offset) }
  #expect(DayAssignment.score(days: enoughDays, clusters: enough, limits: .init(paceCapacity: 2, dayBudgetMinutes: 570)).emptyDayCount == 1)
}

/// brief からの変更点は 2 つ。どちらも「上限そのものを踏む」ために要る。
///
/// 1. 日数を 4 → 8 に。ring(12) × 4 日は 502 評価で**自然に収束**してしまい、600 の枝を
///    一度も通らない(実測)。12 停留所 × 8 日なら 1 パスの候補だけで数百手あり、収束より
///    先に上限へ届く。
/// 2. 数える対象を `build` の回数から**評価の回数**へ。上限が数えるのは「1 つの日割りへの
///    採点」で、`build` はその内側で日数ぶん呼ばれる(TS `:1827` の `clusters.map(build)`)。
///    `build` の回数で 600 を測ると、日数を掛けた数(8 日なら 4800)と比べることになり、
///    brief の `600 + 4` は決して成り立たない。
@Test func searchStopsAtSixHundredEvaluations() {
  var evaluations = 0
  var dayBuilds = 0
  let stops = TestStops.ring(count: 12)
  let clusters = Clustering.clusterStops(stops, requestedDays: 8)
  _ = DayAssignment.optimize(initial: clusters, constraints: [:], lockedDayByStop: [:], build: { c, i in
    dayBuilds += 1
    if i == 0 { evaluations += 1 }   // 1 評価につき index 0 の日はちょうど 1 回組まれる
    return TestStops.buildPlainDay(c, index: i)
  }, limits: .init(paceCapacity: 4, dayBudgetMinutes: 570))
  // 初期解の採点も同じカウンタを進める(TS `:1838` → `:1826`)ので、上限を跨ぐことはなく
  // ぴったり 600 で止まる。「初期評価のぶん超える」ことは起きない。
  #expect(evaluations == EngineConstants.maxDayAssignmentEvaluations)
  #expect(dayBuilds == EngineConstants.maxDayAssignmentEvaluations * clusters.count)
}

/// brief は f を 3 日目に置いたまま `lockedDayByStop: ["f": 0]` を渡し、`out[0]` に f が
/// いることを期待していた。TS の固定は「動かさない」だけで、指定の日へ**引き寄せはしない**
/// (`:1831-1834` は `has` しか見ない。確定先へ置くのは呼び出し側の `applyFixedDays`、`:996-1043`)。
/// そこで f を最初から 1 日目に置き、そのうえで「動かさない」ことを見る。
/// 3 日目を空にしてあるので `emptyDayCount` を下げる手が必ず存在し、最適化は必ず何かを移す。
@Test func lockedDaysNeverMove() {
  let stops = TestStops.line(ids: ["a", "b", "c", "d", "e", "f"])
  let initial = [[stops[0], stops[1], stops[5]], [stops[2], stops[3], stops[4]], []]
  let build: ([RouteStop], Int) -> BuiltPlanDay = { cluster, index in TestStops.buildPlainDay(cluster, index: index) }
  let limits = DayAssignmentLimits(paceCapacity: 4, dayBudgetMinutes: 570)

  let locked = DayAssignment.optimize(initial: initial, constraints: [:], lockedDayByStop: ["f": 0], build: build, limits: limits)
  #expect(locked[0].contains { $0.id == "f" })
  #expect(!locked[2].isEmpty)   // 空の日は、動かせる別の停留所で埋まる

  // 「N 日目」の指定(`constraints.fixedDay`)も同じ効き方をする(`:1832`)。
  let pinned = DayAssignment.optimize(
    initial: initial,
    constraints: ["f": WishlistStopConstraint(priority: .normal, fixedDay: 1, isReservation: false)],
    lockedDayByStop: [:],
    build: build,
    limits: limits
  )
  #expect(pinned[0].contains { $0.id == "f" })

  // 固定が効いていることの対照。外すと、3 日目へ移されるのは f 自身。
  let free = DayAssignment.optimize(initial: initial, constraints: [:], lockedDayByStop: [:], build: build, limits: limits)
  #expect(free[2].contains { $0.id == "f" })
}

/// レビュー(fix round 1)で見つかった取り違え。TS は候補を並べるのに `localeCompare` を使う
/// (`lib/trip-builder.ts:1856` 移動、`:1878-1879` 交換)のに、移植は UTF-16 順で並べていた。
/// 順序が変わるのは見た目の問題ではない: 600 回で打ち切ったパスでは「見られなかった候補」が
/// 変わり、11 項すべてが同点のときは勝者そのものが変わる。
@Test func candidateStopsAreConsideredInLocaleOrderNotUtf16Order() {
  // この 2 つは順が逆になる組。照合は文字を先に見て a < B、コード単位は "B"(0x42) < "a"(0x61)。
  #expect(jsLocaleCompare("a-stop", "B-stop") < 0)
  #expect(jsStringLess("B-stop", "a-stop"))

  let stops = TestStops.line(ids: ["B-stop", "a-stop", "m-stop"])
  var dayZeroPerEvaluation: [[String]] = []
  _ = DayAssignment.optimize(
    initial: [[stops[0], stops[1]], [stops[2]]],
    constraints: [:],
    lockedDayByStop: [:],
    build: { cluster, index in
      if index == 0 { dayZeroPerEvaluation.append(cluster.map(\.id)) }
      return TestStops.buildPlainDay(cluster, index: index)
    },
    limits: .init(paceCapacity: 4, dayBudgetMinutes: 570)
  )
  // 1 回目は初期解そのもの(並べ替えは候補生成にしか効かない)。
  #expect(dayZeroPerEvaluation.first == ["B-stop", "a-stop"])
  // 2 回目 = 最初の候補 = 「1 日目の動かせる**先頭**を 2 日目へ移す」。照合順の先頭は "a-stop"
  // なので 1 日目には "B-stop" が残る。UTF-16 順で並べるとここが ["a-stop"] になって落ちる。
  #expect(dayZeroPerEvaluation.dropFirst().first == ["B-stop"])
}
