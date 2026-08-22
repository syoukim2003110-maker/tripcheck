import Foundation

/// 鍵ゼロで答えられる分だけを答える解決器(spec §4.2、統合仕様 §6.6 の「ローカルカタログは
/// 鍵ゼロの認識に使う」)。持ち物は東京 18 地点(`Geo/Catalog.swift`、TS
/// `lib/route-optimizer.ts:60-284`)とスイス 8 地点(`Destinations.byId(.switzerland).sampleStops`、
/// TS `lib/destinations.ts:284-293`)。
///
/// 名前が当たれば `confirmed`、当たらなければ**辞書に入れない** —— 候補を並べて見せる材料も、
/// 「無かった」と言い切る根拠も持っていないから。次の解決器(Plan 2 の `ApplePlaceResolver`、
/// 次 spec の `GooglePlaceResolver`)の出番になる。
///
/// TS の対応物は 1 つの関数ではなく、画面が場所解決の結果とは**別に**行ごとに引いている
/// `resolveKnownStops(row.place.name, locale)[0] ?? null`
/// (`app/components/planner/hooks/useTripDomainModel.tsx:1192-1194`、
/// `app/components/planner/hooks/usePlanBuild.tsx:887` と `:914-919`)。複数当たったときに
/// 先頭を採るのも TS のその `[0]` に合わせている。
///
/// `destination` は読まない —— TS の `resolveKnownStops` も行き先に関係なく引かれ、行き先の箱で
/// 落とす `withinBounds` はプロバイダの結果にしか掛からない(`lib/google-place-resolver.ts:181`)。
/// カタログの外に出ない範囲では、行き先を跨いだ名前が当たること自体が起きにくい。
public struct CatalogResolver: PlaceResolver {
  public init() {}

  public func resolve(
    _ queries: [PlaceQuery],
    destination: DestinationChoice,
    locale: PlannerLocale
  ) async -> [Int: PlaceResolution] {
    var results: [Int: PlaceResolution] = [:]
    for query in queries {
      guard let stop = Self.confirmedStop(for: query, locale: locale) else { continue }
      results[query.inputIndex] = .confirmed(stop)
    }
    return results
  }

  /// 名前の完全一致(NFKC・小文字化・記号除去)を先に、カタログの別名一致を後に見る。
  ///
  /// 完全一致を先に見るのは、別名が**行の中の部分一致**だから(TS の alias は
  /// `resolveKnownStops` が 1 行に対して走らせる正規表現で、「浅草寺と浅草」の 2 件を拾える
  /// 作りになっている)。1 件の場所を尋ねられているこの場では、その名前そのものである地点が
  /// 部分一致より先に立つ。
  static func confirmedStop(for query: PlaceQuery, locale: PlannerLocale) -> ResolvedStop? {
    let normalized = ResolutionPipeline.normalizePlaceName(query.input)
    guard !normalized.isEmpty else { return nil }

    // 1. 東京カタログの名前(ja/en 両方)との完全一致。
    if let poi = Catalog.pois.first(where: { poi in
      poi.name.values.contains { ResolutionPipeline.normalizePlaceName($0) == normalized }
    }) {
      return Self.resolved(Catalog.toStop(poi, locale: locale, line: query.input), query: query)
    }

    // 2. スイスのサンプル 8 地点の名前(ja/en 両方)との完全一致。停留所そのものは
    //    `SwissSample` から採る —— id・滞在時間・座標・`verifiedAt` を 1 か所に保つため。
    //    `SwissSample` は同じ配列の 1 対 1 の写しだが、添字での参照が将来の変更で落ちないよう
    //    境界も見る(合わなければ別名一致へ落ちる)。
    let sampleStops = Destinations.byId(.switzerland).sampleStops ?? []
    let localizedSamples = SwissSample.resolvedStops(locale: locale)
    if let index = sampleStops.firstIndex(where: { sample in
      sample.names.values.contains { ResolutionPipeline.normalizePlaceName($0) == normalized }
    }), index < localizedSamples.count {
      var stop = localizedSamples[index]
      stop.input = query.input
      stop.inputIndex = query.inputIndex
      return stop
    }

    // 3. 東京カタログの別名(4 言語の正規表現)。
    guard let stop = Catalog.resolveKnownStops(query.input, locale: locale).first else { return nil }
    return Self.resolved(stop, query: query)
  }

  /// カタログの `RouteStop` を、問い合わせに紐づく `ResolvedStop` にする。`address` は
  /// カタログが住所を持たないので地区名(TS の `areaFromAddress` が住所から取り出すのと同じ
  /// 粒度の値が、カタログでは最初から `area` に入っている)。`countryCode` は付けない ——
  /// TS の `resolveKnownStops` も国コードを持たず、国は `DestinationVote` が座標で決める。
  private static func resolved(_ stop: RouteStop, query: PlaceQuery) -> ResolvedStop {
    ResolvedStop(
      routeStop: stop,
      input: query.input,
      inputIndex: query.inputIndex,
      address: stop.area,
      provider: .catalog
    )
  }
}
