import Foundation

/*
 * 場所解決の型と、解決器 1 台の約束(spec §4.2、統合仕様 §6.6)。
 *
 * 移植元は `lib/google-place-resolver.ts:7-30`(要求・上書き・曖昧結果の型)と
 * `lib/place-resolution-client.ts:20`(`PlaceReviewStatus`)。TS は「1 回の HTTP 要求」を型に
 * していて、`queries: string[]` + `providerOverrides` + `hotelQuery` が 1 つの箱に入っている。
 * Kit は**解決器を差し替えられること**が目的なので、要求を occurrence 1 件ずつの `PlaceQuery` に
 * 割り、答えは `inputIndex → PlaceResolution` の辞書で返す —— TS が `places` / `ambiguous` /
 * 「どちらにも出てこない = 未解決」の 3 つの配列に散らしている状態(`:398-412`)を、
 * 添字ごとに 1 つの値へまとめたもの。UI の 4 状態のうち `parsed`(まだ解決していない)は
 * 解決結果ではなく画面の状態なので、この列挙には無い(`place-resolution-client.ts:39-54`)。
 */

/// 解決してほしい 1 件。**occurrence ベース**(統合仕様 §6.6):同じ名前が 2 回貼られても
/// `inputIndex` が違えば別の問い合わせで、別々に直せる。
///
/// `pinnedProviderRef` は旅行者が既に選んだプロバイダ id(TS `PlaceResolutionProviderOverride`
/// `lib/google-place-resolver.ts:17-21`)。これがあるとき、その id を扱える解決器は**厳密な
/// id 取得**をして、同じ id が返らなければ何も返さない(削除・失効した選択は未解決のまま)——
/// TS `fetchGoogleResolvedPlaceById` `:268-270` の同一性検査。`CatalogResolver` は id 空間を
/// 持たないのでこの欄を読まない。
public struct PlaceQuery: Hashable, Sendable {
  public var inputIndex: Int
  public var input: String
  public var pinnedProviderRef: String?

  public init(inputIndex: Int, input: String, pinnedProviderRef: String? = nil) {
    self.inputIndex = inputIndex
    self.input = input
    self.pinnedProviderRef = pinnedProviderRef
  }
}

/// 解決器が返す候補 1 件。TS の `AmbiguousPlaceResolution.candidates`(`:24-26`)の要素は
/// `ResolvedInputStop` そのものだが、Kit は `category`(Google の `primaryType` / Apple の
/// `pointOfInterestCategory`)を別欄で持つ —— `ResolvedStop.placeTypes` は Google 由来の
/// 配列で、Apple には無いため。
public struct PlaceCandidate: Hashable, Codable, Sendable {
  public var stop: ResolvedStop
  public var category: String?
  /// 「訪れる場所」として自動採用してよいか。**既定は `category`・`stop.placeTypes`・名前の
  /// どれもが非観光の合図を出していないこと** —— TS `isPlainlyNonVisitCandidate` が
  /// `candidate.placeTypes ?? []` を見る(`lib/google-place-resolver.ts:308-318`)のと同じで、
  /// Google は `primaryType` を `types` にも並べるので、片方だけ見ると取りこぼす。
  /// 解決器がそれより良い判断を持っているとき(自前の分類器を持つ MapKit など)だけ明示的に
  /// 上書きする。`ResolutionPipeline.autoAccept` が読むのはこの欄で、規則の再計算はしない。
  public var isTouristic: Bool

  public init(stop: ResolvedStop, category: String? = nil, isTouristic: Bool? = nil) {
    self.stop = stop
    self.category = category
    self.isTouristic = isTouristic ?? !(
      ResolutionPipeline.isNonTouristic(name: stop.name, category: category)
        || (stop.placeTypes ?? []).contains { ResolutionPipeline.nonTouristicCategories.contains($0) }
    )
  }
}

/// 1 件の問い合わせに対する答え。UI の状態(`place-resolution-client.ts:20`)のうち
/// `confirmed` / `review` / `unresolved` の 3 つに対応する。
///
/// `unresolved` の `reason` は機械可読な短い語で、UI の文言ではない。パイプライン自身が使うのは
/// `ResolutionPipeline.notFoundReason`(どの解決器も答えなかった)だけで、通信の失敗を表す語は
/// TS の `PlaceResolutionError`(`place-resolution-client.ts:56-57`:`not_configured` /
/// `invalid_request` / `quota_exhausted` / `unavailable`)から解決器が選ぶ。
public enum PlaceResolution: Sendable, Equatable {
  case confirmed(ResolvedStop)
  case review([PlaceCandidate])
  case unresolved(reason: String)
}

/// 解決器 1 台。`ResolutionPipeline` が順に束ねる(`CatalogResolver` → `ApplePlaceResolver`
/// (App ターゲット、Plan 2)→ `GooglePlaceResolver`(Worker、次 spec))。
///
/// **答えられない問い合わせは辞書に入れない**のが約束。`unresolved` を返すのは「探した、
/// 無かった(理由はこれ)」と言えるときだけで、どちらにしても問い合わせは後続の解決器へ渡る ——
/// パイプラインが止まるのは `confirmed` のときだけである。違いは理由が残るかどうかで、
/// 残った理由も後続がより良い答え(`review` / `confirmed`)を出せば上書きされる。
public protocol PlaceResolver: Sendable {
  func resolve(_ queries: [PlaceQuery], destination: DestinationChoice, locale: PlannerLocale) async -> [Int: PlaceResolution]
}
