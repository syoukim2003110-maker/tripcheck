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

  private static func distanceKm(_ a: RouteStop, _ b: RouteStop) -> Double {
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
      var nearestIndex = eligibleIndices[0]
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
}
