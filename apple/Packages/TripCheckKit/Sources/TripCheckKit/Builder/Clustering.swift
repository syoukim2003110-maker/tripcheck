import Foundation

/*
 * 時計を一度も見ないうちに、行きたい場所を「日」へ配り終える段。
 *
 * 地理でまとめ(`clusterStops`)、予約と「N 日目」の指定を効かせ(`applyFixedDays`)、
 * 休業日を避けて動かし(`applyOpeningDays`)、ペースの件数と 1 日の分数に収まるまで
 * 末尾の任意を落とす(`trimToPaceCapacity` / `trimToDayBudget`)。テーマパーク級の
 * 停留所がある日は、同居人を近くの空いている日へ逃がす(`spreadDayAnchors`)。
 *
 * 移植元:
 *   lib/trip-builder.ts:949-984   `clusterStops`
 *   lib/trip-builder.ts:996-1043  `applyFixedDays`
 *   lib/trip-builder.ts:1045-1055 `hasUsableOpeningWindow`
 *   lib/trip-builder.ts:1057-1084 `applyOpeningDays`
 *   lib/trip-builder.ts:1086-1106 `activityDayOpeningWindows`(:1086-1091 は説明コメント)
 *   lib/trip-builder.ts:2134-2141 `buildTripFromWishlist` 内のペース定員による間引き
 *   lib/trip-builder.ts:2142-2176 同・日アンカーの分散
 *   lib/trip-builder.ts:2177-2195 同・`trimClustersToDayBudget`(:2251 で再実行)
 *   lib/trip-builder.ts:2252-2261 同・最終日の締切超過リトライ
 */
public enum Clustering {

  // MARK: - 地理クラスタリング

  /// TS `clusterStops` (`lib/trip-builder.ts:949-984`)。
  ///
  /// 種は最西端の 1 点から始め、以降は「既存の種から最も遠い点」を足す(farthest-point seeding)。
  /// 残りは「最寄りの種までの距離が遠い順」に、平均距離が最小で定員 `ceil(件数 / 実働日数)` に
  /// 空きのあるクラスタへ入れる。要求日数に足りない分は空の日として末尾に付く。
  public static func clusterStops(_ stops: [RouteStop], requestedDays: Int) -> [[RouteStop]] {
    let dayCount = max(1, requestedDays)
    let activeDayCount = min(dayCount, stops.count)
    // TS は空配列だと `stops.reduce(...)` が TypeError で落ちる(呼び出し側 `:2126` が
    // `activeStops.length > 0` で守っている)。Swift は同じ形の空の日を返して落ちない。
    guard activeDayCount >= 1 else { return Array(repeating: [], count: dayCount) }
    if activeDayCount == 1 { return [stops] + Array(repeating: [], count: dayCount - 1) }

    var seeds: [RouteStop] = [westernmost(stops)]
    while seeds.count < activeDayCount {
      let seedIds = Set(seeds.map(\.id))
      let remaining = stops.filter { !seedIds.contains($0.id) }
      // TS の `reduce` は初期値なし = 先頭が初期の best。厳密な `>` なので同値は先頭が勝つ。
      guard var farthest = remaining.first else { break }
      var farthestDistance = minimumDistanceKm(from: farthest, to: seeds)
      for stop in remaining.dropFirst() {
        let distance = minimumDistanceKm(from: stop, to: seeds)
        if distance > farthestDistance {
          farthest = stop
          farthestDistance = distance
        }
      }
      seeds.append(farthest)
    }

    let capacity = Int((Double(stops.count) / Double(activeDayCount)).rounded(.up))
    var clusters = seeds.map { [$0] }
    let seedIds = Set(seeds.map(\.id))
    // TS `:968-972` — 最寄りの種までの距離の降順。`Array.prototype.sort` は安定なので `stableSorted`。
    let remaining = stableSorted(stops.filter { !seedIds.contains($0.id) }) {
      minimumDistanceKm(from: $0, to: seeds) > minimumDistanceKm(from: $1, to: seeds)
    }
    for stop in remaining {
      // 定員の総和(capacity × 実働日数)は必ず件数以上なので空にはならない。TS もここで
      // 空配列を `reduce` すれば落ちる。落とさずに済ませるためだけの保険。
      var eligible = clusters.indices.filter { clusters[$0].count < capacity }
      if eligible.isEmpty { eligible = Array(clusters.indices) }
      var destination = eligible[0]
      var bestAverage = averageDistanceKm(from: stop, to: clusters[destination])
      for index in eligible.dropFirst() {
        let average = averageDistanceKm(from: stop, to: clusters[index])
        if average < bestAverage {
          destination = index
          bestAverage = average
        }
      }
      clusters[destination].append(stop)
    }
    return clusters + Array(repeating: [], count: dayCount - activeDayCount)
  }

  /// TS `:954` の `reduce` — 厳密な `<` なので同経度なら先に現れたほうが種になる。
  private static func westernmost(_ stops: [RouteStop]) -> RouteStop {
    var west = stops[0]
    for stop in stops.dropFirst() where stop.longitude < west.longitude { west = stop }
    return west
  }

  /// TS `Math.min(...seeds.map((seed) => straightLineDistanceKm(seed, stop)))`。
  private static func minimumDistanceKm(from stop: RouteStop, to seeds: [RouteStop]) -> Double {
    seeds.reduce(Double.infinity) { min($0, RouteOrdering.distanceKm($1, stop)) }
  }

  /// TS `:976-978` — クラスタの各点までの距離の平均(重心までの距離ではない)。
  private static func averageDistanceKm(from stop: RouteStop, to cluster: [RouteStop]) -> Double {
    guard !cluster.isEmpty else { return .nan }   // TS の 0/0 = NaN。比較は常に false になる。
    return cluster.reduce(0.0) { $0 + RouteOrdering.distanceKm($1, stop) } / Double(cluster.count)
  }

  // MARK: - 固定日

  /// TS `applyFixedDays` (`lib/trip-builder.ts:996-1043`)。
  ///
  /// 予約や「2 日目」の指定を持つ停留所を、まずその日へ動かす。そのままだと地理で撒いた
  /// 普通の訪問がその日に山積みになるので、`ceil(件数 / 日数)` を超えた日から**固定でない**
  /// 訪問だけを退避させる。退避先は 元のクラスタ → 小さいクラスタ → 近いクラスタ → id 順。
  ///
  /// `constraintOrder` は TS の `Map` の挿入順(= 停留所が `knownStops` に最初に入った順 =
  /// 入力順、`:2004`)。Swift の `Dictionary` に順序はないので、TS と 1 バイト単位で揃えたい
  /// 呼び出し側はここに入力順の id を渡す。既定の空配列はクラスタを平坦化した順で代用する
  /// (同じ日に 2 件以上ピン留めされたときだけ、その日の中の並びが TS と変わりうる)。
  public static func applyFixedDays(
    _ clusters: [[RouteStop]],
    constraints: [String: WishlistStopConstraint],
    constraintOrder: [String] = []
  ) -> [[RouteStop]] {
    var assigned = clusters
    var originalDayByStop: [String: Int] = [:]
    for (dayIndex, cluster) in clusters.enumerated() {
      for stop in cluster { originalDayByStop[stop.id] = dayIndex }
    }

    var visited = Set<String>()
    let order = constraintOrder.isEmpty ? clusters.flatMap { $0.map(\.id) } : constraintOrder
    for stopId in order where visited.insert(stopId).inserted {
      guard let constraint = constraints[stopId], let fixedDay = constraint.fixedDay,
            fixedDay >= 1, fixedDay <= assigned.count else { continue }
      var moved: RouteStop?
      // TS `:1006-1009` は全クラスタを走査し、各クラスタの最初の一致を抜く(最後に抜けたものが残る)。
      for dayIndex in assigned.indices {
        if let index = assigned[dayIndex].firstIndex(where: { $0.id == stopId }) {
          moved = assigned[dayIndex].remove(at: index)
        }
      }
      if let moved { assigned[fixedDay - 1].append(moved) }
    }

    let stopCount = assigned.reduce(0) { $0 + $1.count }
    let targetSize = assigned.isEmpty ? 0 : Int((Double(stopCount) / Double(assigned.count)).rounded(.up))
    for dayIndex in assigned.indices {
      while assigned[dayIndex].count > targetSize {
        let movable = assigned[dayIndex].filter { constraints[$0.id]?.fixedDay == nil }
        let destinations = assigned.indices.filter { $0 != dayIndex && assigned[$0].count < targetSize }
        if movable.isEmpty || destinations.isEmpty { break }
        let candidates = movable.flatMap { stop in
          destinations.map { index in
            FixedDayMove(
              stop: stop,
              destination: index,
              original: originalDayByStop[stop.id],
              destinationSize: assigned[index].count,
              distanceKm: Legs.clusterDistanceKm(stop: stop, cluster: assigned[index])
            )
          }
        }
        guard let choice = stableSorted(candidates, by: isBetterFixedDayMove).first else { break }
        assigned[dayIndex].removeAll { $0.id == choice.stop.id }
        assigned[choice.destination].append(choice.stop)
      }
    }
    return assigned
  }

  private struct FixedDayMove {
    var stop: RouteStop
    var destination: Int
    var original: Int?
    var destinationSize: Int
    var distanceKm: Double
  }

  /// TS `:1031-1037` の比較子。`original` が未知(TS の `undefined`)なら「元の日ではない」扱い。
  /// 最後から 2 番目の項は TS が `localeCompare` を使うが、停留所 id はカタログの slug・
  /// `google-…`・`manual-…` のような ASCII なので、コード単位順(`jsStringLess`)と一致する。
  private static func isBetterFixedDayMove(_ left: FixedDayMove, _ right: FixedDayMove) -> Bool {
    let leftAway = left.destination != left.original
    let rightAway = right.destination != right.original
    if leftAway != rightAway { return !leftAway }
    if left.destinationSize != right.destinationSize { return left.destinationSize < right.destinationSize }
    if left.distanceKm != right.distanceKm { return left.distanceKm < right.distanceKm }
    if left.stop.id != right.stop.id { return jsStringLess(left.stop.id, right.stop.id) }
    return left.destination < right.destination
  }

  // MARK: - 営業日

  /// TS `hasUsableOpeningWindow` (`lib/trip-builder.ts:1045-1055`)。
  ///
  /// `nil` = その日の営業情報を持っていない(TS の `undefined`)。`false` = 窓はあるが滞在が
  /// 入らない、または空配列 = その曜日は休業。`Number.isFinite` の 2 条件は `Int` では常に真。
  public static func hasUsableOpeningWindow(_ stop: RouteStop, _ windows: [VisitWindow]?) -> Bool? {
    guard let windows else { return nil }
    return windows.contains { window in
      min(window.closeMinutes - stop.planningDurationMinutes, window.lastEntryMinutes ?? Int.max) >= window.openMinutes
    }
  }

  /// TS `applyOpeningDays` (`lib/trip-builder.ts:1057-1084`)。
  ///
  /// その日に開いていない停留所を、開いていて空きのある最も近い日へ移す。移せなければ
  /// `unavailable` に落とす。予約と日固定は動かさない(その日に閉まっているという事実は
  /// 後段の時計が `closed_day` として正直に出す)。TS が `assigned` と呼ぶ戻り値をここでは
  /// brief に合わせて `clusters` と名づけている。
  public static func applyOpeningDays(
    _ clusters: [[RouteStop]],
    constraints: [String: WishlistStopConstraint],
    availability: [String: IntKeyedDictionary<[VisitWindow]>],
    capacity: Int
  ) -> (clusters: [[RouteStop]], unavailable: [RouteStop]) {
    var assigned = clusters
    var unavailable: [RouteStop] = []
    for dayIndex in assigned.indices {
      let snapshot = assigned[dayIndex]   // TS `[...assigned[dayIndex]]`
      for stop in snapshot {
        guard hasUsableOpeningWindow(stop, availability[stop.id]?[dayIndex]) == false else { continue }
        let constraint = constraints[stop.id] ?? .default
        if constraint.fixedDay != nil || constraint.isReservation { continue }
        let openDays = assigned.indices.filter { index in
          index != dayIndex
            && assigned[index].count < capacity
            && hasUsableOpeningWindow(stop, availability[stop.id]?[index]) == true
        }
        let destination = stableSorted(openDays) { abs($0 - dayIndex) < abs($1 - dayIndex) }.first
        assigned[dayIndex].removeAll { $0.id == stop.id }
        if let destination { assigned[destination].append(stop) }
        else { unavailable.append(stop) }
      }
    }
    return (assigned, unavailable)
  }

  /// TS `activityDayOpeningWindows` (`lib/trip-builder.ts:1086-1106`)。
  ///
  /// 営業時間は `tripStartDate` からの暦日で取ってある。深夜着の便で街に入るのが翌日になると
  /// 活動 1 日目は暦日 1 なので、ここで一度だけ読み替えて以降の関数は日ローカルで通す。
  ///
  /// brief の Interfaces は戻り値を `[String: [VisitWindow]]` と書いていたが、TS は入力と同じ
  /// 「停留所 → 日 → 窓」の 2 段(`Record<string, Record<number, VisitWindow[]>>`)を返すので
  /// TS に合わせた。`Record<number, …>` は `IntKeyedDictionary`(`Core/IntKeyed.swift`)。
  public static func activityDayOpeningWindows(
    _ availability: [String: IntKeyedDictionary<[VisitWindow]>],
    calendarDayOffset: Int
  ) -> [String: IntKeyedDictionary<[VisitWindow]>] {
    guard calendarDayOffset != 0 else { return availability }
    return availability.mapValues { windowsByCalendarDay in
      var shifted = IntKeyedDictionary<[VisitWindow]>()
      for (calendarDay, windows) in windowsByCalendarDay.values {
        let activityDay = calendarDay - calendarDayOffset
        guard activityDay >= 0 else { continue }
        shifted[activityDay] = windows
      }
      return shifted
    }
  }

  // MARK: - 間引き

  /// TS `buildTripFromWishlist` `:2134-2141` — ペースの件数上限を超えた日から、末尾に近い
  /// 任意の停留所を外す。任意が尽きたら定員を破ったまま返す(必須は黙って落とさない)。
  public static func trimToPaceCapacity(
    _ clusters: [[RouteStop]],
    constraints: [String: WishlistStopConstraint],
    capacity: Int
  ) -> (clusters: [[RouteStop]], deferred: [RouteStop]) {
    var trimmed = clusters
    var deferred: [RouteStop] = []
    for index in trimmed.indices {
      while trimmed[index].count > capacity {
        guard let optionalIndex = trimmed[index].lastIndex(where: { constraints[$0.id]?.priority == .optional })
        else { break }
        deferred.append(trimmed[index].remove(at: optionalIndex))
      }
    }
    return (trimmed, deferred)
  }

  /// TS `buildTripFromWishlist` `:2142-2176` — テーマパーク級(滞在 ≥ 300 分)の停留所がある日は
  /// 2 件までに絞り、同居人を「アンカーのいない・空きのある」最も近い日へ逃がす。行き先が
  /// なければ任意だけ見送りに回し、必須ならその日は 3 件以上のまま残す。
  ///
  /// brief の Interfaces は `-> [[RouteStop]]` かつ定員引数なしだったが、TS はこのブロックでも
  /// `deferredOptionalStops` に積み(`:2170`)、移動先の空き判定に `paceCapacity` を使う
  /// (`:2160`)ので、どちらも落とさずに写した。
  public static func spreadDayAnchors(
    _ clusters: [[RouteStop]],
    constraints: [String: WishlistStopConstraint],
    capacity: Int
  ) -> (clusters: [[RouteStop]], deferred: [RouteStop]) {
    var spread = clusters
    var deferred: [RouteStop] = []
    guard spread.count > 1 else { return (spread, deferred) }   // TS `:2152`

    // TS `stopIsMovable` (`:2145-2150`)。時刻指定も日指定も持たない、アンカーでない停留所だけ。
    func isMovable(_ stop: RouteStop) -> Bool {
      let constraint = constraints[stop.id]
      return !StayEstimates.isDayAnchorStay(stop.planningDurationMinutes)
        && constraint?.fixedDay == nil
        && constraint?.fixedTimeMinutes == nil
    }
    func hasAnchor(_ cluster: [RouteStop]) -> Bool {
      cluster.contains { StayEstimates.isDayAnchorStay($0.planningDurationMinutes) }
    }

    for dayIndex in spread.indices {
      guard hasAnchor(spread[dayIndex]) else { continue }
      // TS `:2154` の 2 はこのブロックだけの構造(「アンカー + 同居人 1 件まで」)で、
      // 統合仕様 §7.2 の定数表には載っていないのでここに残す。
      while spread[dayIndex].count > 2 {
        // 滞在の短い順。同値は元の並び(`Array.prototype.sort` は安定)。
        guard let movable = stableSorted(spread[dayIndex].filter(isMovable), by: {
          $0.planningDurationMinutes < $1.planningDurationMinutes
        }).first else { break }
        let openDays = spread.indices.filter { index in
          index != dayIndex && spread[index].count < capacity && !hasAnchor(spread[index])
        }
        let target = stableSorted(openDays) {
          Legs.clusterDistanceKm(stop: movable, cluster: spread[$0])
            < Legs.clusterDistanceKm(stop: movable, cluster: spread[$1])
        }.first
        guard let index = spread[dayIndex].firstIndex(where: { $0.id == movable.id }) else { break }
        if let target {
          spread[dayIndex].remove(at: index)
          spread[target].append(movable)
          continue
        }
        if constraints[movable.id]?.priority == .optional {
          spread[dayIndex].remove(at: index)
          deferred.append(movable)
          continue
        }
        break
      }
    }
    return (spread, deferred)
  }

  /// TS `trimClustersToDayBudget` (`lib/trip-builder.ts:2177-2195`、`:2251` で再実行)。
  ///
  /// 件数の上限に加えた時間の上限。1 日は覚めている 10 時間程度なので、滞在の合計だけで
  /// `Σ滞在 + (件数 − 1) × 35 分` が予算を超える日からは、**ピン留めされていない**任意を
  /// 末尾から外す。日を指定して置かれた任意はそのまま残し、超過を正直に見せる(`:2185-2186`)。
  public static func trimToDayBudget(
    _ clusters: [[RouteStop]],
    constraints: [String: WishlistStopConstraint],
    budget: Int
  ) -> (clusters: [[RouteStop]], deferred: [RouteStop]) {
    var trimmed = clusters
    var deferred: [RouteStop] = []
    for index in trimmed.indices {
      while clusterMinutes(trimmed[index]) > budget {
        guard let optionalIndex = trimmed[index].lastIndex(where: { stop in
          let constraint = constraints[stop.id]
          return constraint?.priority == .optional && constraint?.fixedDay == nil
        }) else { break }
        deferred.append(trimmed[index].remove(at: optionalIndex))
      }
    }
    return (trimmed, deferred)
  }

  /// TS `:2182-2183` — 滞在の合計 + 区間ぶんの一律 35 分(`EngineConstants.trimLegMinutes`)。
  private static func clusterMinutes(_ cluster: [RouteStop]) -> Int {
    cluster.reduce(0) { $0 + $1.planningDurationMinutes }
      + max(0, cluster.count - 1) * EngineConstants.trimLegMinutes
  }

  /// TS `buildTripFromWishlist` `:2252-2261` — 出発便の締切を最終日が越えているあいだ、
  /// その日の末尾に近い任意を外して組み直す。ここだけは日固定の任意も対象になる
  /// (飛行機に間に合わないことのほうが強い事実なので、`trimToDayBudget` の例外は効かない)。
  ///
  /// TS は `clusters`/`days` を直接書き換えるが、Swift は値型なので更新後の 3 つを返す。
  public static func trimLastDayToDeadline(
    clusters: [[RouteStop]],
    days: [BuiltPlanDay],
    constraints: [String: WishlistStopConstraint],
    build: ([RouteStop], Int) -> BuiltPlanDay
  ) -> (clusters: [[RouteStop]], days: [BuiltPlanDay], deferred: [RouteStop]) {
    var trimmed = clusters
    var built = days
    var deferred: [RouteStop] = []
    let lastIndex = built.count - 1
    guard lastIndex >= 0, trimmed.indices.contains(lastIndex) else { return (trimmed, built, deferred) }
    while built[lastIndex].deadlineOverrunMinutes > 0 {
      guard let optionalIndex = trimmed[lastIndex].lastIndex(where: { constraints[$0.id]?.priority == .optional })
      else { break }
      deferred.append(trimmed[lastIndex].remove(at: optionalIndex))
      built[lastIndex] = build(trimmed[lastIndex], lastIndex)
    }
    return (trimmed, built, deferred)
  }
}
