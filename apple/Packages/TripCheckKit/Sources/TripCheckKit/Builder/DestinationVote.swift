import Foundation

/// TS `resolveContextDestination` (`lib/trip-builder.ts:1905-1937`).
///
/// この計画の背後にある国。明示の指定は常に勝つ。"auto" のときは、計画に**実際に入った**
/// 停留所が投票する —— Google の国コードがあればそれで、無ければ座標で —— ので、1 件の
/// 誤解決が旅程まるごとを別の大陸へ引きずることはない。
///
/// 混在した国、および未対応の国コードは、片方の空港・入国規則・通貨・食事時間を継承して
/// よい場所ではない。**過半数**を要求し、同数または未対応の国コードが 1 件でもあれば、
/// 旅行者が明示的に選ぶまで「何も仮定しない」プロファイル(worldwide)に留まる。
public enum DestinationVote {
  public static func resolve(context: PlannerContext, stops: [RouteStop]) -> Destination {
    let choice = context.destination ?? .auto
    // TS `:1906-1907` — "auto" 以外はそのまま引く。
    guard case .auto = choice else {
      if case .destination(let id) = choice { return Destinations.byId(id) }
      return Destinations.byId(.worldwide)
    }

    // TS `:1908-1911` — `new Map(entries)` は同じ id が二度来たら**後**が勝つ。
    // 解決済み停留所 → 解決済み拠点 の順に上書きする。
    var countryById: [String: String] = [:]
    for stop in context.resolvedStops ?? [] {
      if let code = stop.countryCode, !code.isEmpty { countryById[stop.id] = code }
    }
    if let base = context.resolvedBase, let code = base.countryCode, !code.isEmpty {
      countryById[base.id] = code
    }

    // TS の `Map` は挿入順を保つ。Swift の `Dictionary` は保たないので、最初に票が入った順を
    // 別に持っておき、`stableSorted` で TS の安定ソートを再現する(同数の先頭は勝てないので
    // 結果は変わらないが、逐語性のため)。
    var votes: [DestinationId: Int] = [:]
    var voteOrder: [DestinationId] = []
    var hasUnsupportedProviderCountry = false
    for stop in stops {
      let code = countryById[stop.id]
      // プロバイダの国コードは、おおまかな矩形の座標フォールバックより上位。その国が未対応
      // なら、隣国の通貨・空港・入国規則を継承するのではなく worldwide に留まる(`:1915-1918`)。
      let hasCode = !(code ?? "").isEmpty
      let match = hasCode
        ? Destinations.forCountryCode(code!)
        : Destinations.forCoordinate(stop.latitude, stop.longitude)
      if hasCode, match == nil { hasUnsupportedProviderCountry = true }
      if let match {
        if votes[match.id] == nil { voteOrder.append(match.id) }
        votes[match.id] = (votes[match.id] ?? 0) + 1
      }
    }

    if hasUnsupportedProviderCountry { return Destinations.byId(.worldwide) }
    let ranked = stableSorted(voteOrder.map { ($0, votes[$0] ?? 0) }) { $0.1 > $1.1 }
    let totalVotes = ranked.reduce(0) { $0 + $1.1 }
    guard let winner = ranked.first, winner.1 * 2 > totalVotes else {
      return Destinations.byId(.worldwide)
    }
    return Destinations.byId(winner.0)
  }
}
