import Foundation

/*
 * 地理でまとめただけの日割りを、実際に組んでみた 1 日の姿で採点し直し、良くなる限り
 * 停留所を隣の日へ移す/交換する段。
 *
 * 採点は 11 項の辞書式で、「事実」→「快適さ」→「経路」の順に並ぶ。営業時間や予約の
 * 破れ(=事実)は、どれだけ移動が短くなっても覆せない。空の日と痩せた日(=快適さ)は
 * 移動時間より上に置く — 空の日はホテル往復ごと消えるので、素の移動時間だけで比べると
 * 「全部を 1 日に詰め込む」が常に勝ってしまうから。
 *
 * 探索は有界。停留所が 12 を超える入力には手を出さず、評価は 600 回で打ち切る。打ち切った
 * 時点の最良解をそのまま返すので、上限に当たっても答えは常に「初期解以上」。
 *
 * 移植元:
 *   lib/trip-builder.ts:1702-1703 `MAX_DAY_ASSIGNMENT_STOPS` / `MAX_DAY_ASSIGNMENT_EVALUATIONS`
 *                                 (Swift では `EngineConstants` に集約済み)
 *   lib/trip-builder.ts:1705-1717 `DayAssignmentScore`
 *   lib/trip-builder.ts:1719-1725 `compareDayAssignmentScore`
 *   lib/trip-builder.ts:1727-1730 `DayAssignmentLimits`
 *   lib/trip-builder.ts:1732-1734 `dayAssignmentSignature`
 *   lib/trip-builder.ts:1736-1806 `scoreDayAssignment`
 *   lib/trip-builder.ts:1807-1904 `optimizeDayAssignments`
 */

/// TS `DayAssignmentScore` (`lib/trip-builder.ts:1705-1717`)。TS は 11 要素のタプルで、
/// 添字の意味はコメント付きのラベルにしか書かれていない。Swift では名前付きの構造体にして、
/// 比較(`compareDayAssignmentScore`、`:1719-1725`)を `Comparable` として持たせる。
///
/// **小さいほど良い**。10 個の数値を TS の順に比べ、すべて同値なら最後に署名の照合順で決める。
public struct DayAssignmentScore: Comparable, Sendable {
  /// 営業時間の破れ + 予約の遅刻 + 締切超過の日数。事実の破れの「件数」。
  public var hardViolationCount: Int
  /// 同じく事実の破れの「大きさ」。営業時間の破れ 1 件を 24 時間(=どんな遅刻より重い)と
  /// 数え、予約の遅刻分と締切の超過分を足す。
  public var hardViolationMagnitude: Int
  public var overrunDayCount: Int
  public var totalOverrunMinutes: Int
  /// 予定が 1 つも入らなかった日の数。停留所が日数以上あるときだけ数える。
  public var emptyDayCount: Int
  /// 件数超過 1 件につき 240 分 + 1 日の分数予算の超過分。
  public var overloadMinutes: Int
  /// 床(`min(240, 予算の 45%)`)に届かなかった滞在分の**二乗和**。
  public var underfillMinutes: Int
  public var travelMinutes: Int
  public var maximumDayMinutes: Int
  /// 一番長い日と一番短い日の差。
  public var loadSpreadMinutes: Int
  /// 決定的タイブレーク(= `DayAssignment.signature`)。同点の日割りが実行のたびに入れ替わらない
  /// ようにするためだけの項。
  public var tieBreak: String

  public init(
    hardViolationCount: Int,
    hardViolationMagnitude: Int,
    overrunDayCount: Int,
    totalOverrunMinutes: Int,
    emptyDayCount: Int,
    overloadMinutes: Int,
    underfillMinutes: Int,
    travelMinutes: Int,
    maximumDayMinutes: Int,
    loadSpreadMinutes: Int,
    tieBreak: String
  ) {
    self.hardViolationCount = hardViolationCount
    self.hardViolationMagnitude = hardViolationMagnitude
    self.overrunDayCount = overrunDayCount
    self.totalOverrunMinutes = totalOverrunMinutes
    self.emptyDayCount = emptyDayCount
    self.overloadMinutes = overloadMinutes
    self.underfillMinutes = underfillMinutes
    self.travelMinutes = travelMinutes
    self.maximumDayMinutes = maximumDayMinutes
    self.loadSpreadMinutes = loadSpreadMinutes
    self.tieBreak = tieBreak
  }

  /// TS のタプルと同じ並び。`compare` はこの順に走査する。
  var numericComponents: [Int] {
    [
      hardViolationCount,
      hardViolationMagnitude,
      overrunDayCount,
      totalOverrunMinutes,
      emptyDayCount,
      overloadMinutes,
      underfillMinutes,
      travelMinutes,
      maximumDayMinutes,
      loadSpreadMinutes,
    ]
  }

  /// TS `compareDayAssignmentScore` (`lib/trip-builder.ts:1719-1725`)。
  /// 数値 10 項を順に引き算し、差が出た時点で決める。全部同値なら署名を `localeCompare`。
  static func compare(_ left: DayAssignmentScore, _ right: DayAssignmentScore) -> Int {
    let leftNumbers = left.numericComponents
    let rightNumbers = right.numericComponents
    for index in leftNumbers.indices {
      let difference = leftNumbers[index] - rightNumbers[index]
      if difference != 0 { return difference < 0 ? -1 : 1 }
    }
    return jsLocaleCompare(left.tieBreak, right.tieBreak)
  }

  public static func < (left: DayAssignmentScore, right: DayAssignmentScore) -> Bool {
    compare(left, right) < 0
  }

  /// `==` も同じ比較子で定義する。フィールドごとの合成 `==` にすると、照合順では同値でも
  /// 文字列としては異なる署名(正規化違いなど)で `<` とも `>` とも言えない組が生まれ、
  /// `Comparable` の全順序が壊れる。
  public static func == (left: DayAssignmentScore, right: DayAssignmentScore) -> Bool {
    compare(left, right) == 0
  }
}

/// TS `DayAssignmentLimits` (`lib/trip-builder.ts:1727-1730`)。ペースから来る 1 日の件数上限と
/// 分数予算(`EngineConstants.paceStopsPerDay` / `paceDayBudgetMinutes`)。
public struct DayAssignmentLimits: Equatable, Sendable {
  public var paceCapacity: Int
  public var dayBudgetMinutes: Int

  public init(paceCapacity: Int, dayBudgetMinutes: Int) {
    self.paceCapacity = paceCapacity
    self.dayBudgetMinutes = dayBudgetMinutes
  }
}

public enum DayAssignment {

  // MARK: - 署名

  /// TS `dayAssignmentSignature` (`lib/trip-builder.ts:1732-1734`)。
  ///
  /// 日ごとに id を昇順へ並べて `U+0000` で継ぎ、日どうしを `U+0001` で継ぐ。**日内の順序は
  /// 署名に入らない** — 日割り探索が動かすのは「どの日か」だけで、日内の並びは `DayClock` が
  /// 決め直すから。これがメモ化の鍵になり、同じ配り方に二度と点を付けずに済む。
  public static func signature(_ clusters: [[RouteStop]]) -> String {
    clusters
      .map { cluster in
        // TS の `Array.prototype.sort()`(比較関数なし)は文字列化した UTF-16 順。
        stableSorted(cluster.map(\.id)) { jsStringLess($0, $1) }.joined(separator: "\u{0}")
      }
      .joined(separator: "\u{1}")
  }

  // MARK: - 採点

  /// TS `scoreDayAssignment` (`lib/trip-builder.ts:1736-1806`)。
  ///
  /// `days` は `clusters` を実際に組み立てた結果で、両方を受け取るのは意図的 — 件数の上限や
  /// 空の日は「配り方」の性質(`clusters`)、超過分や移動時間は「組み上がった日」の性質(`days`)。
  public static func score(
    days: [BuiltPlanDay],
    clusters: [[RouteStop]],
    limits: DayAssignmentLimits
  ) -> DayAssignmentScore {
    let openingViolations = days.reduce(0) { $0 + $1.openingConflictCount }
    let reservationViolations = days.reduce(0) { $0 + $1.reservationConflictCount }
    let reservationLateMinutes = days.reduce(0) { sum, day in
      sum + day.stops.reduce(0) { $0 + $1.reservationLateMinutes }
    }
    let overrunDays = days.filter { $0.deadlineOverrunMinutes > 0 }
    let totalOverrunMinutes = overrunDays.reduce(0) { $0 + $1.deadlineOverrunMinutes }
    let travelMinutes = days.reduce(0) { sum, day in
      sum + (day.hotelTravelMinutes ?? 0) + day.legs.reduce(0) { $0 + $1.comparison.recommended.minutes }
    }
    let loads = days.map(\.totalMinutes)
    // TS `Math.max(...[])` は `-Infinity` になるので `:1752-1753` は空を明示的に 0 に落とす。
    let maximumDayMinutes = loads.max() ?? 0
    let minimumDayMinutes = loads.min() ?? 0
    // 日を空にすると、その日のホテル往復が丸ごと `travelMinutes` から消える。だから素の移動時間
    // だけで比べると「全部を 1〜2 日に詰め込む」が常に勝ってしまう。要求された日数を使い切る
    // だけの材料があるとき、空の日は移動時間より上位の快適さの破れとして数える。件数や分数の
    // 予算を超えた日も同じ扱い(`:1754-1759`)。
    let totalStops = clusters.reduce(0) { $0 + $1.count }
    let emptyDayCount = totalStops >= clusters.count
      ? clusters.filter(\.isEmpty).count
      : 0
    let overloadMinutes = days.enumerated().reduce(0) { sum, entry in
      // TS `clusters[index]?.length ?? 0` — `days` のほうが長い呼び出しでも落ちない。
      let clusterCount = entry.offset < clusters.count ? clusters[entry.offset].count : 0
      return sum
        + max(0, clusterCount - limits.paceCapacity) * 240
        + max(0, entry.element.totalMinutes - limits.dayBudgetMinutes)
    }
    // 詰め込んだ日の隣にある 2 時間の「日」は、要求された 1 日を捨てているのと同じ。材料が
    // 日数より多いとき、空でない日は最低限の**中身**を持つべき — 経過時間ではなく滞在分で
    // 数えるので、無駄な横断移動で日を「埋める」ことはできない。不足は**二乗**する: 線形和は
    // 全日が床より下にある限り再配分で不変で、1 停留所の局所最適から抜け出せなくなる。凸に
    // すると均す手が必ず改善になる。overload より下に置いて「均したら違反が生まれる」を防ぎ、
    // 移動時間より上に置いて「ホテル往復 1 本の節約」で日を空洞化させない(`:1766-1775`)。
    let underfillFloor = min(240, Int((Double(limits.dayBudgetMinutes) * 0.45).rounded(.toNearestOrAwayFromZero)))
    let underfillMinutes = totalStops > clusters.count
      ? clusters.reduce(0) { sum, cluster in
        if cluster.isEmpty { return sum }
        let deficit = max(0, underfillFloor - cluster.reduce(0) { $0 + $1.planningDurationMinutes })
        return sum + deficit * deficit
      }
      : 0
    // 事実の破れと締切の超過は、経路や快適さのどの好みよりも先に比べる。営業時間の破れは
    // 「その日が短くなった」ことでは隠せない(`:1786-1788`)。
    return DayAssignmentScore(
      hardViolationCount: openingViolations + reservationViolations + overrunDays.count,
      hardViolationMagnitude: openingViolations * 24 * 60 + reservationLateMinutes + totalOverrunMinutes,
      overrunDayCount: overrunDays.count,
      totalOverrunMinutes: totalOverrunMinutes,
      emptyDayCount: emptyDayCount,
      overloadMinutes: overloadMinutes,
      underfillMinutes: underfillMinutes,
      travelMinutes: travelMinutes,
      maximumDayMinutes: maximumDayMinutes,
      loadSpreadMinutes: maximumDayMinutes - minimumDayMinutes,
      tieBreak: signature(clusters)
    )
  }

  // MARK: - 局所探索

  /// TS `optimizeDayAssignments` (`lib/trip-builder.ts:1807-1904`)。
  ///
  /// P0 の入力範囲に絞った有界の局所探索。地理クラスタリングは種にすぎない — 滞在の長い
  /// クラスタのせいで、本当は収まる日数が「無理」に見えてしまってはいけない。移動も交換も、
  /// 返される日程とまったく同じ時計・予約・営業時間・経路の規則(`build`)で組み直してから
  /// 採点する。
  ///
  /// - Parameters:
  ///   - lockedDayByStop: 「N 日目」の指定などで既に日が確定している停留所。**値は読まない** —
  ///     TS も `has` しか見ておらず(`:1831-1834`)、確定先の日には `initial` の時点で既に
  ///     置かれている(`applyFixedDays`、`:996-1043`)。ここでの役割は「動かさない」ことだけ。
  public static func optimize(
    initial: [[RouteStop]],
    constraints: [String: WishlistStopConstraint],
    lockedDayByStop: [String: Int],
    build: ([RouteStop], Int) -> BuiltPlanDay,
    limits: DayAssignmentLimits
  ) -> [[RouteStop]] {
    let maxEvaluations = EngineConstants.maxDayAssignmentEvaluations
    let stopCount = initial.reduce(0) { $0 + $1.count }
    // 1 日しかない、動かす相手がいない、または組合せが有界探索に収まらない入力には手を出さない
    // (`:1814-1816`)。Swift の配列は値型なので TS の `[...cluster]` 複製は不要。
    if initial.count <= 1 || stopCount <= 1 || stopCount > EngineConstants.maxDayAssignmentStops {
      return initial
    }

    var scoreCache: [String: DayAssignmentScore] = [:]
    var evaluationCount = 0
    /// 署名でメモ化した採点(TS `:1821-1830`)。同じ配り方に二度と点は付けない。
    ///
    /// 上限に達したときの `nil` は TS `:1825` をそのまま写した防御で、**実際には返らない**:
    /// 呼び出し側(初期評価と 2 つのループ)はいずれも直前に `evaluationCount < maxEvaluations`
    /// を見ており、その間にカウンタは進まない。打ち切りを実際に決めているのはループ側の判定の
    /// ほう(`:1841`, `:1855`, `:1858`, `:1876`, `:1877`, `:1882`)で、この行ではない。
    func evaluate(_ clusters: [[RouteStop]]) -> DayAssignmentScore? {
      let key = signature(clusters)
      if let cached = scoreCache[key] { return cached }
      if evaluationCount >= maxEvaluations { return nil }
      evaluationCount += 1
      let value = score(
        days: clusters.enumerated().map { build($0.element, $0.offset) },
        clusters: clusters,
        limits: limits
      )
      scoreCache[key] = value
      return value
    }
    func movable(_ stop: RouteStop) -> Bool {
      constraints[stop.id]?.fixedDay == nil && lockedDayByStop[stop.id] == nil
    }
    /// TS `:1856`(移動)と `:1878-1879`(交換)の並び替え。候補を見る順を id で固定して、
    /// 600 回で打ち切ったときの答えと、全項が同点になったときの勝者を再現可能にする。
    ///
    /// TS はここで `localeCompare` を使う(`<` でも比較関数なしの `sort()` でもない)ので、
    /// Swift も `jsLocaleCompare` で照合する。UTF-16 順に落とすと "B-stop" が "a-stop" より
    /// 前に来て、打ち切りに当たったパスで**別の候補**が採用されうる。
    func movableStops(of day: [RouteStop]) -> [RouteStop] {
      stableSorted(day.filter(movable)) { jsLocaleCompare($0.id, $1.id) < 0 }
    }

    var current = initial
    guard var currentScore = evaluate(current) else { return current }

    var pass = 0
    while pass < stopCount && evaluationCount < maxEvaluations {
      var best: [[RouteStop]]?
      var bestScore = currentScore
      func consider(_ candidate: [[RouteStop]]) {
        guard let candidateScore = evaluate(candidate) else { return }
        if candidateScore < bestScore {
          best = candidate
          bestScore = candidateScore
        }
      }

      // 移動は詰め込みすぎた日をほどき、空いた日を意図して使わせる(`:1852-1871`)。
      for sourceDay in current.indices {
        if evaluationCount >= maxEvaluations { break }
        for stop in movableStops(of: current[sourceDay]) {
          for targetDay in current.indices {
            if evaluationCount >= maxEvaluations { break }
            if targetDay == sourceDay { continue }
            // ここに定員の上限は置かない。定員超過は `overloadMinutes` が既に、しかし
            // 予約・営業時間の破れ**より下**で罰している。だから「受け入れ側の停留所が
            // すべて固定されていて、そこへ入れるしか直しようがない」場合の手を残しつつ、
            // 移動時間の節約だけで満員の日へ押し込む手は決して勝てない(`:1860-1865`)。
            var candidate = current
            candidate[sourceDay].removeAll { $0.id == stop.id }
            candidate[targetDay].append(stop)
            consider(candidate)
          }
        }
      }

      // 滞在の重い地理クラスタに要るのは、もう 1 回の重心移動ではなく「長い/短い」の交換で
      // あることが多い。共有の評価上限の内側で、動かせる全ペアを試す(`:1873-1890`)。
      for leftDay in current.indices {
        if evaluationCount >= maxEvaluations { break }
        for rightDay in (leftDay + 1)..<current.count {
          if evaluationCount >= maxEvaluations { break }
          let leftStops = movableStops(of: current[leftDay])
          let rightStops = movableStops(of: current[rightDay])
          for leftStop in leftStops {
            for rightStop in rightStops {
              if evaluationCount >= maxEvaluations { break }
              var candidate = current
              candidate[leftDay] = candidate[leftDay].map { $0.id == leftStop.id ? rightStop : $0 }
              candidate[rightDay] = candidate[rightDay].map { $0.id == rightStop.id ? leftStop : $0 }
              consider(candidate)
            }
          }
        }
      }

      guard let improved = best else { break }
      current = improved
      currentScore = bestScore
      pass += 1
    }
    return current
  }
}
