import Foundation

/// 鍵ゼロで答えられる分だけを答える解決器(spec §4.2、統合仕様 §6.6 の「ローカルカタログは
/// 鍵ゼロの認識に使う」)。持ち物は東京 18 地点(`Geo/Catalog.swift`、TS
/// `lib/route-optimizer.ts:60-284`)とスイス 8 地点(`Geo/SwissSample.swift`、TS
/// `lib/destinations.ts:284-293` のサンプルを `app/components/planner/hooks/usePlanBuild.tsx:808-822`
/// と同じ欄で組んだもの)。
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
public struct CatalogResolver: PlaceResolver {
  public init() {}

  public func resolve(
    _ queries: [PlaceQuery],
    destination: DestinationChoice,
    locale: PlannerLocale
  ) async -> [Int: PlaceResolution] {
    // 名前表はロケールごとに 1 度だけ組む(問い合わせ 1 件ごとに 26 地点を正規化し直さない)。
    let index = NameIndex(locale: locale)
    var results: [Int: PlaceResolution] = [:]
    for query in queries {
      // 旅行者が既にプロバイダの候補を選んでいる問い合わせには**手を出さない**。その id を
      // 発行した解決器だけが厳密 id 取得で同一性を確かめられる(TS `fetchGoogleResolvedPlaceById`
      // `lib/google-place-resolver.ts:268-270`)。ここで名前が似た別の場所を confirmed に
      // してしまうと、旅行者の選択が黙って捨てられる。
      guard query.pinnedProviderRef == nil else { continue }
      guard let stop = index.confirmedStop(for: query) else { continue }
      results[query.inputIndex] = .confirmed(stop)
    }
    return results
  }

  /// カタログの `RouteStop` を、問い合わせに紐づく `ResolvedStop` にする。`address` は
  /// カタログが住所を持たないので地区名(TS の `areaFromAddress` が住所から取り出すのと同じ
  /// 粒度の値が、カタログでは最初から `area` に入っている)。`countryCode` は付けない ——
  /// TS の `resolveKnownStops` も国コードを持たず、国は `DestinationVote` が座標で決める。
  fileprivate static func resolved(_ stop: RouteStop, query: PlaceQuery) -> ResolvedStop {
    ResolvedStop(
      routeStop: stop,
      input: query.input,
      inputIndex: query.inputIndex,
      address: stop.area,
      provider: .catalog
    )
  }
}

extension CatalogResolver {
  /// 1 回の `resolve` の間だけ使う、正規化済み(NFKC・小文字化・記号除去)の名前表。
  struct NameIndex {
    private let locale: PlannerLocale
    private let tokyo: [(names: [String], poi: CatalogPoi)]
    private let swiss: [(names: [String], stop: ResolvedStop)]

    init(locale: PlannerLocale) {
      self.locale = locale
      tokyo = Catalog.pois.map { poi in
        (names: poi.name.values.map { ResolutionPipeline.normalizePlaceName($0) }, poi: poi)
      }
      // `zip` で組にするので、サンプルと `SwissSample` の並びがずれても添字で落ちない。
      swiss = zip(Destinations.byId(.switzerland).sampleStops ?? [], SwissSample.resolvedStops(locale: locale))
        .map { sample, stop in
          (names: sample.names.values.map { ResolutionPipeline.normalizePlaceName($0) }, stop: stop)
        }
    }

    /// 名前の完全一致を先に、カタログの別名一致を後に見る。
    ///
    /// 完全一致を先に見るのは、別名が**行の中の部分一致**だから(TS の alias は
    /// `resolveKnownStops` が 1 行に対して走らせる正規表現で、「浅草寺と浅草」の 2 件を拾える
    /// 作りになっている)。1 件の場所を尋ねられているこの場では、その名前そのものである地点が
    /// 部分一致より先に立つ。
    func confirmedStop(for query: PlaceQuery) -> ResolvedStop? {
      let normalized = ResolutionPipeline.normalizePlaceName(query.input)
      guard !normalized.isEmpty else { return nil }

      // 1. 東京カタログの名前(ja/en 両方)との完全一致。
      if let entry = tokyo.first(where: { $0.names.contains(normalized) }) {
        return CatalogResolver.resolved(Catalog.toStop(entry.poi, locale: locale, line: query.input), query: query)
      }

      // 2. スイスのサンプル 8 地点の名前(ja/en 両方)との完全一致。停留所そのものは
      //    `SwissSample` から採る —— id・滞在時間・座標を 1 か所に保つため。
      if let entry = swiss.first(where: { $0.names.contains(normalized) }) {
        var stop = entry.stop
        stop.input = query.input
        stop.inputIndex = query.inputIndex
        return stop
      }

      // 3. 東京カタログの別名(4 言語の正規表現)。
      guard let stop = Catalog.resolveKnownStops(query.input, locale: locale).first else { return nil }
      return CatalogResolver.resolved(stop, query: query)
    }
  }
}
