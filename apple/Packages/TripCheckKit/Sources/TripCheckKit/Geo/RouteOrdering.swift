import Foundation

/// lib/route-optimizer.ts:330-435 — `EngineConstants.heldKarpLimit`(10)点までは Held-Karp の
/// 厳密解、それを超えたら最近傍法 + 2-opt の近似解。
public enum RouteOrdering {
  /// lib/route-optimizer.ts:340-352 — `optimizeKnownStopOrder`。
  /// `preserveFirst == false` は先頭固定を外し、どの停留所を始点にするのが最短かを総当たりで探す
  /// (各候補は依然として「選んだ始点から動かない open path」として最適化される)。
  public static func optimize(_ stops: [RouteStop], preserveFirst: Bool) -> (stops: [RouteStop], exact: Bool) {
    guard stops.count > 1 else { return (stops, true) }
    let exact = stops.count <= EngineConstants.heldKarpLimit

    func optimizeFromFirst(_ candidate: [RouteStop]) -> [RouteStop] {
      exact ? exactOpenPath(candidate) : heuristicOpenPath(candidate)
    }

    if preserveFirst {
      return (optimizeFromFirst(stops), exact)
    }

    var best = optimizeFromFirst(stops)
    var bestDistance = openPathDistanceKm(best)
    for index in 1..<stops.count {
      var candidateInput = [stops[index]]
      candidateInput.append(contentsOf: stops[0..<index])
      candidateInput.append(contentsOf: stops[(index + 1)...])
      let candidate = optimizeFromFirst(candidateInput)
      let candidateDistance = openPathDistanceKm(candidate)
      if candidateDistance < bestDistance {
        best = candidate
        bestDistance = candidateDistance
      }
    }
    return (best, exact)
  }

  /// lib/route-optimizer.ts:334-336 — `routeDistance`(open path の合計距離)
  public static func openPathDistanceKm(_ stops: [RouteStop]) -> Double {
    guard stops.count > 1 else { return 0 }
    var total = 0.0
    for index in 1..<stops.count {
      total += distanceKm(stops[index - 1], stops[index])
    }
    return total
  }

  static func distanceKm(_ a: RouteStop, _ b: RouteStop) -> Double {
    straightLineDistanceKm(
      GeoPoint(latitude: a.latitude, longitude: a.longitude),
      GeoPoint(latitude: b.latitude, longitude: b.longitude)
    )
  }

  /// lib/route-optimizer.ts:353-395 — Held-Karp DP。先頭(index 0)を始点に固定した open path の
  /// 厳密解。`isAnchor` な停留所は、カタログ/入力に現れた相対順を崩せない
  /// (先行する anchor が未訪問なら、後続の anchor にはまだ進めない)。2 点以上を前提とする。
  static func exactOpenPath(_ stops: [RouteStop]) -> [RouteStop] {
    let count = stops.count
    let fullMask = (1 << count) - 1
    var distanceTable = Array(repeating: Array(repeating: Double.infinity, count: count), count: 1 << count)
    var previous = Array(repeating: Array(repeating: -1, count: count), count: 1 << count)
    let anchorIndices = stops.indices.filter { stops[$0].isAnchor }
    distanceTable[1][0] = 0

    for mask in 1...fullMask {
      guard mask & 1 == 1 else { continue }
      for last in 0..<count {
        guard mask & (1 << last) != 0, distanceTable[mask][last].isFinite else { continue }
        for next in 1..<count {
          guard mask & (1 << next) == 0 else { continue }
          if let anchorPosition = anchorIndices.firstIndex(of: next), anchorPosition > 0 {
            let priorAnchorMissing = anchorIndices[0..<anchorPosition].contains { mask & (1 << $0) == 0 }
            if priorAnchorMissing { continue }
          }
          let nextMask = mask | (1 << next)
          let candidate = distanceTable[mask][last] + distanceKm(stops[last], stops[next])
          if candidate < distanceTable[nextMask][next] {
            distanceTable[nextMask][next] = candidate
            previous[nextMask][next] = last
          }
        }
      }
    }

    var last = 0
    for index in 1..<count {
      if distanceTable[fullMask][index] < distanceTable[fullMask][last] { last = index }
    }

    var order: [Int] = []
    var maskCursor = fullMask
    var cursor = last
    while cursor >= 0 {
      order.append(cursor)
      let parent = previous[maskCursor][cursor]
      maskCursor ^= 1 << cursor
      cursor = parent
    }

    return order.reversed().map { stops[$0] }
  }

  /// lib/route-optimizer.ts:396-435 — 最近傍法で初期経路を作り、2-opt で改善する。
  /// anchor の相対順は構築・改善の両方で常に保つ。2 点以上を前提とする。
  static func heuristicOpenPath(_ stops: [RouteStop]) -> [RouteStop] {
    var remaining = Array(stops.dropFirst())
    var route = [stops[0]]
    let anchorOrder = stops.filter { $0.isAnchor }.map { $0.id }

    func preservesAnchorOrder(_ candidate: [RouteStop]) -> Bool {
      let candidateAnchors = candidate.filter { $0.isAnchor }.map { $0.id }
      for (index, id) in candidateAnchors.enumerated() where id != anchorOrder[index] {
        return false
      }
      return true
    }

    while !remaining.isEmpty {
      let current = route[route.count - 1]
      let nextRequiredAnchor = anchorOrder.first { id in !route.contains { $0.id == id } }
      let eligibleIndices = remaining.indices.filter {
        remaining[$0].isAnchor == false || remaining[$0].id == nextRequiredAnchor
      }
      // anchor id が重複していると、次に必要な anchor がどれとも一致せず候補が空になりうる。
      // 順序を壊すより、入力順のまま返す方が安全。
      guard var nearestIndex = eligibleIndices.first else { return stops }
      var nearestDistance = distanceKm(current, remaining[nearestIndex])
      for index in eligibleIndices.dropFirst() {
        let candidateDistance = distanceKm(current, remaining[index])
        if candidateDistance < nearestDistance {
          nearestDistance = candidateDistance
          nearestIndex = index
        }
      }
      route.append(remaining.remove(at: nearestIndex))
    }

    var improved = true
    while improved {
      improved = false
      let startUpper = route.count - 2
      guard startUpper > 1 else { break }
      for start in 1..<startUpper {
        for end in (start + 1)..<(route.count - 1) {
          var candidate = Array(route[0..<start])
          candidate.append(contentsOf: route[start...end].reversed())
          candidate.append(contentsOf: route[(end + 1)...])
          if preservesAnchorOrder(candidate) && openPathDistanceKm(candidate) + 0.001 < openPathDistanceKm(route) {
            route = candidate
            improved = true
          }
        }
      }
    }
    return route
  }

  /// TS `optimizeFromBase` (`lib/trip-builder.ts:591-637`) — ホテル(base)を出発して base に帰る
  /// 巡回として最短の訪問順を出す。`orderForReservations` (`:1413`) の地理順の種。どのタスクの
  /// brief にも現れないが、そこが唯一の呼び出し元なので Task 10 で一緒に移植した。
  public static func optimizeFromBase(_ stops: [RouteStop], base: RouteStop) -> [RouteStop] {
    guard stops.count > 1 else { return stops }
    if stops.count > EngineConstants.heldKarpLimit {
      let ordered = Array(optimize([base] + stops, preserveFirst: true).stops.dropFirst())
      return routeDistanceFromBase(ordered, base: base) <= routeDistanceFromBase(ordered.reversed(), base: base)
        ? ordered
        : ordered.reversed()
    }

    let count = stops.count
    let fullMask = (1 << count) - 1
    var distances = Array(repeating: Array(repeating: Double.infinity, count: count), count: 1 << count)
    var previous = Array(repeating: Array(repeating: -1, count: count), count: 1 << count)
    for index in 0..<count { distances[1 << index][index] = distanceKm(base, stops[index]) }

    for mask in 1...fullMask {
      for last in 0..<count {
        if mask & (1 << last) == 0 || !distances[mask][last].isFinite { continue }
        for next in 0..<count {
          if mask & (1 << next) != 0 { continue }
          let nextMask = mask | (1 << next)
          let candidate = distances[mask][last] + distanceKm(stops[last], stops[next])
          if candidate < distances[nextMask][next] {
            distances[nextMask][next] = candidate
            previous[nextMask][next] = last
          }
        }
      }
    }

    var last = 0
    var best = Double.infinity
    for index in 0..<count {
      let candidate = distances[fullMask][index] + distanceKm(stops[index], base)
      if candidate < best {
        best = candidate
        last = index
      }
    }

    var order: [Int] = []
    var mask = fullMask
    var cursor = last
    while cursor >= 0 {
      order.append(cursor)
      let parent = previous[mask][cursor]
      mask ^= 1 << cursor
      cursor = parent
    }
    return order.reversed().map { stops[$0] }
  }

  /// TS `routeDistanceFromBase` (`lib/trip-builder.ts:585-589`) — base を出て base に帰る閉路の距離。
  public static func routeDistanceFromBase(_ stops: [RouteStop], base: RouteStop) -> Double {
    guard let first = stops.first, let last = stops.last else { return 0 }
    return distanceKm(base, first) + openPathDistanceKm(stops) + distanceKm(last, base)
  }
}
