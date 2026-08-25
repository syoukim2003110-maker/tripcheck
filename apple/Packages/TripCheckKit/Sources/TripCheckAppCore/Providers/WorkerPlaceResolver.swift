import Foundation
import TripCheckKit

/// 解決チェーンの先頭に立つ Google 優先リゾルバ。Worker が検証した場所を `google-` 接頭辞・
/// `provider:.google`・非空の `sourceUrl`/`verifiedAt` を持つ **検証済み** 停留所に写す。
/// 未認証・オフライン・失敗・タイムアウトは空辞書を返し、`ResolutionPipeline` が次の
/// リゾルバ(Apple → Catalog)に委ねる — オンデバイス解決が下限なので壊れない。
public struct WorkerPlaceResolver: PlaceResolver {
  private let client: any WorkerAuthenticating
  private let timeout: Duration
  public init(client: any WorkerAuthenticating, timeout: Duration = .seconds(6)) {
    self.client = client
    self.timeout = timeout
  }

  public func resolve(_ queries: [PlaceQuery], destination: DestinationChoice, locale: PlannerLocale) async -> [Int: PlaceResolution] {
    guard !queries.isEmpty else { return [:] }
    let payload = PlaceResolutionRequestPayload(
      queries: queries.map(\.input),
      languageCode: locale.rawValue,
      destination: destination.rawValue
    )
    guard let result = await resolveWithinTimeout(payload) else { return [:] }

    var out: [Int: PlaceResolution] = [:]
    for place in result.places {
      for query in queries where query.input == place.input {
        out[query.inputIndex] = .confirmed(mapStop(place, query: query))
      }
    }
    for group in result.ambiguous {
      for query in queries where query.input == group.input && out[query.inputIndex] == nil {
        out[query.inputIndex] = .review(group.candidates.map { PlaceCandidate(stop: mapStop($0, query: query)) })
      }
    }
    return out
  }

  /// 探す側と時計を競争させる。ネットワークが黙っても resolve が返らない、を防ぐ。
  /// 打ち切り(または解決失敗)は nil を返し、呼び手はローカルへ代替する。
  private func resolveWithinTimeout(_ payload: PlaceResolutionRequestPayload) async -> PlaceResolutionResult? {
    let client = self.client
    let limit = timeout
    return await withTaskGroup(of: PlaceResolutionResult?.self) { group in
      group.addTask { await client.resolvePlaces(payload) }
      group.addTask {
        try? await Task.sleep(for: limit)
        return nil
      }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first
    }
  }

  /// web の `ResolvedInputStop` を iOS の検証済み `ResolvedStop` に写す。id は Apple と同じ
  /// 決定的スキームだが `google-` 接頭辞(Kit ではこれが「検証済み」を意味する)。
  private func mapStop(_ raw: WorkerResolvedStop, query: PlaceQuery) -> ResolvedStop {
    ResolvedStop(
      id: "google-\(query.inputIndex)-\(FNV1a.hash32("\(raw.name)|\(raw.latitude)|\(raw.longitude)"))",
      providerRef: raw.providerRef,
      name: raw.name,
      area: raw.area,
      latitude: raw.latitude,
      longitude: raw.longitude,
      sourceUrl: raw.sourceUrl,
      verifiedAt: raw.verifiedAt,
      confidence: Confidence(rawValue: raw.confidence) ?? .medium,
      planningDurationMinutes: raw.planningDurationMinutes,
      isAnchor: raw.isAnchor,
      placeTypes: raw.placeTypes,
      input: query.input,
      inputIndex: query.inputIndex,
      address: raw.address,
      countryCode: raw.countryCode,
      provider: .google
    )
  }
}
