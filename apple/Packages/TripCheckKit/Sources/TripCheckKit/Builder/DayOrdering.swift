import Foundation

/*
 * 1 日ぶんの停留所をどの順に回るか。予約・営業時間という硬い制約を最優先し、書かれた希望や
 * 食事の時間帯は柔らかい罰点として効かせ、最後に移動分・経過分・id で決定的に決める。
 *
 * lib/trip-builder.ts:1284-1300 (`ScheduleOrderScore`, `compareScheduleOrderScore`)、
 * :1301-1386 (`scheduleOrderScore`)、:1387-1505 (`orderForReservations`)。
 */

/// TS `ScheduleOrderScore` (`lib/trip-builder.ts:1284-1291`) — 6 項の辞書式タプル。
///
/// 硬い制約は自分だけのスロットを持つ。どれだけ大きな柔らかい点数でも、予約や営業時間の違反
/// 1 件を数値的に上回れてはいけない。最後の id キーは完全同点を決定的にするためだけにある。
public struct ScheduleOrderScore: Comparable, Hashable, Sendable {
  public var hardViolationCount: Int
  public var hardViolationMinutes: Int
  public var softPenalty: Int
  public var travelMinutes: Int
  public var elapsedMinutes: Int
  public var idKey: String

  public init(
    hardViolationCount: Int,
    hardViolationMinutes: Int,
    softPenalty: Int,
    travelMinutes: Int,
    elapsedMinutes: Int,
    idKey: String
  ) {
    self.hardViolationCount = hardViolationCount
    self.hardViolationMinutes = hardViolationMinutes
    self.softPenalty = softPenalty
    self.travelMinutes = travelMinutes
    self.elapsedMinutes = elapsedMinutes
    self.idKey = idKey
  }

  /// TS `compareScheduleOrderScore` (`lib/trip-builder.ts:1293-1300`) — 先頭 5 項を数値で、
  /// 最後の 1 項を文字列比較で。
  public static func < (left: Self, right: Self) -> Bool {
    if left.hardViolationCount != right.hardViolationCount { return left.hardViolationCount < right.hardViolationCount }
    if left.hardViolationMinutes != right.hardViolationMinutes { return left.hardViolationMinutes < right.hardViolationMinutes }
    if left.softPenalty != right.softPenalty { return left.softPenalty < right.softPenalty }
    if left.travelMinutes != right.travelMinutes { return left.travelMinutes < right.travelMinutes }
    if left.elapsedMinutes != right.elapsedMinutes { return left.elapsedMinutes < right.elapsedMinutes }
    return jsStringLess(left.idKey, right.idKey)
  }
}

public enum DayOrdering {
  /// 営業時間の違反 1 件が背負う分数。TS `:1332` の `24 * 60`。
  private static let openingViolationMinutes = 24 * 60

  /// TS `scheduleOrderScore` (`lib/trip-builder.ts:1301-1386`)。ある並びを実際に時計に載せて
  /// 走らせ、硬い違反・柔らかい罰点・移動分・経過分を数える。
  public static func score(
    stops ordered: [RouteStop],
    base: TripBase?,
    startMinutes: Int,
    constraints: [String: WishlistStopConstraint],
    earlyVisitStopIds: Set<String>,
    foodStopIds: Set<String>,
    openingWindows: [String: [VisitWindow]],
    meals: DestinationMeals,
    travel: TravelInputs = .default
  ) -> ScheduleOrderScore {
    var cursor = startMinutes
    var hardViolationCount = 0
    var lateMinutes = 0
    var travelMinutes = 0
    var earlyVisitPenalty = 0

    if let base, let first = ordered.first {
      // `routeTravelMinutes` は乗換バッファを 1 回含んでいる。buildDay の実際の時計と同じ。
      let minutes = Legs.routeTravelMinutes(from: base.routeStop, to: first, travel: travel)
      travelMinutes += minutes
      cursor += minutes
    }

    for (index, stop) in ordered.enumerated() {
      let constraint = constraints[stop.id]
      let fixed = constraint?.fixedTimeMinutes
      if let fixed {
        let fixedLateness = max(0, cursor - fixed)
        if fixedLateness > 0 { hardViolationCount += 1 }
        lateMinutes += fixedLateness
        cursor = max(cursor, fixed)
      }

      let fitted = fitVisitToWindow(cursor: cursor, duration: stop.planningDurationMinutes, windows: openingWindows[stop.id])
      if fitted.status == .conflict || fitted.status == .closed_day || fitted.status == .last_entry_conflict {
        hardViolationCount += 1
        lateMinutes += openingViolationMinutes
      } else {
        cursor = fitted.start
      }

      let wish = constraint?.timeOfDay
      if earlyVisitStopIds.contains(stop.id) && wish != .evening && wish != .night {
        // 売り切れ・早じまい・行列の証拠は柔らかい希望であって、予約や確認済みの営業時間の
        // 代わりにはならない。書かれた「夕暮れに」はこれより強い: 利用者の希望が勝つ。
        earlyVisitPenalty += index * 90 + max(0, cursor - 12 * 60)
      }
      // 書かれた時間帯の希望(「夕暮れに」「朝イチ」)も同じ柔らかさで並びを傾ける。
      switch wish {
      case .morning: earlyVisitPenalty += index * 90 + max(0, cursor - 12 * 60)
      case .evening: earlyVisitPenalty += max(0, 16 * 60 - cursor)
      case .night: earlyVisitPenalty += max(0, 18 * 60 - cursor)
      case nil: break
      }
      // 時刻の指定がない食事の停留所は朝 9:40 ではなく食事の窓に属する。最寄りの昼/夜までの
      // 距離を罰点にする。食事の時間は土地のもの(マドリードの 21 時は普通の夕食)なので、
      // 窓は目的地から来る。
      if fixed == nil && foodStopIds.contains(stop.id) {
        earlyVisitPenalty += min(distanceToWindow(cursor: cursor, window: meals.lunch), distanceToWindow(cursor: cursor, window: meals.dinner))
      }

      cursor += stop.planningDurationMinutes
      if index + 1 < ordered.count {
        let minutes = Legs.routeTravelMinutes(from: stop, to: ordered[index + 1], travel: travel)
        travelMinutes += minutes
        cursor += minutes
      }
    }

    if let base, let last = ordered.last {
      // 帰りのレグにバッファは足さない(TS `:1377`)。
      let minutes = Legs.routeComparison(from: last, to: base.routeStop, travel: travel).recommended.minutes
      travelMinutes += minutes
      cursor += minutes
    }

    return ScheduleOrderScore(
      hardViolationCount: hardViolationCount,
      hardViolationMinutes: lateMinutes,
      softPenalty: earlyVisitPenalty,
      travelMinutes: travelMinutes,
      elapsedMinutes: cursor - startMinutes,
      idKey: ordered.map(\.id).joined(separator: "\u{0}")
    )
  }

  /// TS `orderForReservations` (`lib/trip-builder.ts:1387-1505`)。
  public static func orderForReservations(
    stops: [RouteStop],
    base: TripBase?,
    startMinutes: Int,
    constraints: [String: WishlistStopConstraint],
    earlyVisitStopIds: Set<String>,
    foodStopIds: Set<String>,
    openingWindows: [String: [VisitWindow]],
    meals: DestinationMeals,
    travel: TravelInputs = .default,
    lockedOrder: [String] = []
  ) -> [RouteStop] {
    if !lockedOrder.isEmpty {
      // TS は `new Map(...)` なので、同じ id が二度現れたら後ろの順位が勝つ。
      var rank: [String: Int] = [:]
      for (index, stopId) in lockedOrder.enumerated() { rank[stopId] = index }
      // 途中まで編集された既存旅程には、まだ固定されていない新しい場所が混ざりうる。固定済みの
      // 訪問はその相対順のまま保ち、本当に新しい訪問だけを決定的な順で末尾に足す。固定済みの
      // 訪問のあいだに黙って割り込ませることは決してしない。
      let listed = stableSorted(stops.filter { rank[$0.id] != nil }) { rank[$0.id]! < rank[$1.id]! }
      let unlisted = stableSorted(stops.filter { rank[$0.id] == nil }) { jsStringLess($0.id, $1.id) }
      return listed + unlisted
    }

    let geographic = base.map { RouteOrdering.optimizeFromBase(stops, base: $0.routeStop) }
      ?? RouteOrdering.optimize(stops, preserveFirst: false).stops
    let hasTimedConstraint = stops.contains { constraints[$0.id]?.fixedTimeMinutes != nil }
    let hasEarlyPreference = stops.contains { earlyVisitStopIds.contains($0.id) }
    let hasOpeningConstraint = stops.contains { openingWindows[$0.id] != nil }
    let hasTimeWish = stops.contains { constraints[$0.id]?.timeOfDay != nil || foodStopIds.contains($0.id) }
    if stops.count <= 1 || (!hasTimedConstraint && !hasEarlyPreference && !hasOpeningConstraint && !hasTimeWish) {
      return geographic
    }

    func scoreOf(_ candidate: [RouteStop]) -> ScheduleOrderScore {
      score(
        stops: candidate, base: base, startMinutes: startMinutes, constraints: constraints,
        earlyVisitStopIds: earlyVisitStopIds, foodStopIds: foodStopIds,
        openingWindows: openingWindows, meals: meals, travel: travel
      )
    }

    // 8! 通りを最大 14 の TripFit シナリオぶん繰り返すと結果 UI が 1 秒近く固まる。7 までは
    // 厳密解、それを超える日は下の安定した制約つきヒューリスティクスで解く。
    if stops.count > EngineConstants.exactOrderingLimit {
      return boundedOrder(stops: stops, geographic: geographic, constraints: constraints,
                          earlyVisitStopIds: earlyVisitStopIds, openingWindows: openingWindows, scoreOf: scoreOf)
    }

    var best = geographic
    var bestScore = scoreOf(best)
    var used = Set<String>()
    var candidate: [RouteStop] = []
    func visit() {
      if candidate.count == stops.count {
        let score = scoreOf(candidate)
        if score < bestScore {
          best = candidate
          bestScore = score
        }
        return
      }
      for stop in stops {
        if used.contains(stop.id) { continue }
        used.insert(stop.id)
        candidate.append(stop)
        visit()
        candidate.removeLast()
        used.remove(stop.id)
      }
    }
    visit()
    return best
  }

  /// TS `:1455-1472` — 有界探索の「緊急度順」の種。TS の比較関数と同じ順で同じだけのキーを見る:
  /// 早め訪問の証拠 → 固定時刻 → 閉店/最終入場 → id。
  ///
  /// 固定時刻の節は TS `:1462-1464` では「どちらかに時刻指定があればその場で return」なので、
  /// **両方が同じ時刻に予約されている組は同点(0)で止まり、閉店時刻も id も見ない**。
  /// 安定ソートなのでその組は入力順のまま残る。ここを落とすと種が変わり、貪欲挿入と改善パスの
  /// 出発点が TS とずれる。
  static func urgencySeed(
    stops: [RouteStop],
    constraints: [String: WishlistStopConstraint],
    earlyVisitStopIds: Set<String>,
    openingWindows: [String: [VisitWindow]]
  ) -> [RouteStop] {
    func closingKey(_ stop: RouteStop) -> Int {
      (openingWindows[stop.id] ?? []).reduce(jsMaxSafeInteger) { min($0, $1.lastEntryMinutes ?? $1.closeMinutes) }
    }
    return stableSorted(stops) { left, right in
      let leftEarly = earlyVisitStopIds.contains(left.id)
      let rightEarly = earlyVisitStopIds.contains(right.id)
      if leftEarly != rightEarly { return leftEarly }
      let leftTime = constraints[left.id]?.fixedTimeMinutes
      let rightTime = constraints[right.id]?.fixedTimeMinutes
      if leftTime != nil || rightTime != nil {
        return (leftTime ?? jsMaxSafeInteger) < (rightTime ?? jsMaxSafeInteger)
      }
      let leftClose = closingKey(left)
      let rightClose = closingKey(right)
      if leftClose != rightClose { return leftClose < rightClose }
      return jsStringLess(left.id, right.id)
    }
  }

  /// TS `:1409-1478` — 7 を超える日の有界ヒューリスティクス。3 つの種(地理順 / 緊急度順 /
  /// 貪欲挿入)から始め、`min(6, n)` パスの「1 つ抜いて入れ直す」で改善する。
  private static func boundedOrder(
    stops: [RouteStop],
    geographic: [RouteStop],
    constraints: [String: WishlistStopConstraint],
    earlyVisitStopIds: Set<String>,
    openingWindows: [String: [VisitWindow]],
    scoreOf: ([RouteStop]) -> ScheduleOrderScore
  ) -> [RouteStop] {
    let urgencyOrder = urgencySeed(
      stops: stops, constraints: constraints,
      earlyVisitStopIds: earlyVisitStopIds, openingWindows: openingWindows
    )

    var inserted: [RouteStop] = []
    for stop in urgencyOrder {
      var bestInsertion: [RouteStop]?
      var bestInsertionScore: ScheduleOrderScore?
      for position in 0...inserted.count {
        var candidate = inserted
        candidate.insert(stop, at: position)
        let score = scoreOf(candidate)
        if bestInsertionScore == nil || score < bestInsertionScore! {
          bestInsertion = candidate
          bestInsertionScore = score
        }
      }
      inserted = bestInsertion ?? [stop]
    }

    var best = geographic
    var bestScore = scoreOf(geographic)
    for candidate in [urgencyOrder, inserted] {
      let candidateScore = scoreOf(candidate)
      if candidateScore < bestScore {
        best = candidate
        bestScore = candidateScore
      }
    }
    let maxPasses = min(6, stops.count)
    for _ in 0..<maxPasses {
      var improved: [RouteStop]?
      var improvedScore = bestScore
      for from in best.indices {
        var without = best
        let moved = without.remove(at: from)
        for to in 0...without.count {
          var candidate = without
          candidate.insert(moved, at: to)
          let score = scoreOf(candidate)
          if score < improvedScore {
            improved = candidate
            improvedScore = score
          }
        }
      }
      guard let improved else { break }
      best = improved
      bestScore = improvedScore
    }
    return best
  }
}
