import Foundation

/*
 * 1 区間(レグ)についての全部: 鍵、旅程が持っている移動の材料、推奨モードの決定、
 * アクセスノード経由のメタデータ、Google マップ URL、所要分、クラスタ距離。
 *
 * lib/trip-builder.ts:363-365 (`routeLegKey`)、:1108-1124 (`TravelInputs`/`defaultTravel`)、
 * :1126-1257 (`knownTransferCount` … `clusterDistanceKm`)。
 */

/// TS `routeLegKey` (`lib/trip-builder.ts:363-365`) — ライブ経路・モード指定・乗換数を引く鍵。
public func routeLegKey(_ fromId: String, _ toId: String) -> String {
  "\(fromId)::\(toId)"
}

/// TS `TravelInputs` (`lib/trip-builder.ts:1108-1122`)。辞書のキーは `routeLegKey`。
public struct TravelInputs: Equatable, Sendable {
  public var preference: TravelPreference
  /// 目的地が実際に報いるモード。他に決め手がないときにこれが効く。
  public var mobility: MobilityProfile?
  public var transit: [String: Int]?
  /// プロバイダが「そのトランジット経路は存在しない」と答えたレグ。
  public var transitAbsent: [String: Bool]?
  public var transfers: [String: Int]?
  public var walking: [String: Int]?
  public var driving: [String: Int]?
  public var overrides: [String: TransportMode]?
  public var bufferMinutes: Int?
  public var maxWalkingMinutesPerLeg: Int?
  public var maxTransfersPerLeg: Int?

  public init(
    preference: TravelPreference = .auto,
    mobility: MobilityProfile? = nil,
    transit: [String: Int]? = nil,
    transitAbsent: [String: Bool]? = nil,
    transfers: [String: Int]? = nil,
    walking: [String: Int]? = nil,
    driving: [String: Int]? = nil,
    overrides: [String: TransportMode]? = nil,
    bufferMinutes: Int? = nil,
    maxWalkingMinutesPerLeg: Int? = nil,
    maxTransfersPerLeg: Int? = nil
  ) {
    self.preference = preference
    self.mobility = mobility
    self.transit = transit
    self.transitAbsent = transitAbsent
    self.transfers = transfers
    self.walking = walking
    self.driving = driving
    self.overrides = overrides
    self.bufferMinutes = bufferMinutes
    self.maxWalkingMinutesPerLeg = maxWalkingMinutesPerLeg
    self.maxTransfersPerLeg = maxTransfersPerLeg
  }

  /// TS `defaultTravel` (`lib/trip-builder.ts:1124`)
  public static let `default` = TravelInputs(preference: .auto, bufferMinutes: EngineConstants.defaultTransferBuffer)
}

public enum Legs {
  /// TS `knownTransferCount` (`lib/trip-builder.ts:1126-1132`)。山岳アクセス経由のレグは全区間を
  /// 測れていないので、プロバイダの乗換数を「このレグの乗換数」として採用しない。
  public static func knownTransferCount(from: RouteStop, to: RouteStop, travel: TravelInputs) -> Int? {
    knownTransferCount(from: from, to: to, travel: travel, scope: PoiAccess.routeEndpoints(from: from, to: to).scope)
  }

  /// アクセス方針の解決は名前の正規化 + 正規表現を伴うので、`routeComparison` のように
  /// すでに解決済みの呼び出し元は同じ答えを渡し直せる。
  private static func knownTransferCount(from: RouteStop, to: RouteStop, travel: TravelInputs, scope: RouteEvidenceScope?) -> Int? {
    guard scope == nil else { return nil }
    guard let count = travel.transfers?[routeLegKey(from.id, to.id)], count >= 0, count <= 100 else { return nil }
    return count
  }

  /// TS `routeComparison` (`lib/trip-builder.ts:1134-1203`)。
  ///
  /// `TravelEstimates.estimate` が `estimateTravelOptions` + `applyLiveTransitMinutes` +
  /// `allowedTransportModesForLeg` フィルタ + レグ単位のモード指定までを持っている(Task 8)。
  /// ここが足すのは 3 つ:(1) どのライブ計測値を渡してよいかの判定、(2) アクセスノード経由なら
  /// 全選択肢を `estimate` 由来に落とす、(3) 徒歩上限・乗換上限のフォールバック。
  public static func routeComparison(from: RouteStop, to: RouteStop, travel: TravelInputs) -> ModeComparison {
    let key = routeLegKey(from.id, to.id)
    let mobility = travel.mobility ?? .transit_first
    let access = PoiAccess.routeEndpoints(from: from, to: to)
    // アクセスノードで終わるプロバイダの答えは経路の証拠にはなるが、山頂までの全行程ではない。
    // 山岳区間をモデル化するまで、所要時間は条件付き=推定のままにしておく。
    let fullLegProviderEvidence = access.scope == nil
    let live = fullLegProviderEvidence
      ? LiveLegEvidence(
          transitMinutes: travel.transit?[key],
          transitAbsent: travel.transitAbsent?[key] == true,
          walkingMinutes: travel.walking?[key],
          drivingMinutes: travel.driving?[key]
        )
      : .none
    let overrideMode = travel.overrides?[key]
    let measured = TravelEstimates.estimate(
      distanceKm: RouteOrdering.distanceKm(from, to),
      preference: travel.preference,
      mobility: mobility,
      live: live,
      allowedModes: PoiAccess.allowedModes(from: from, to: to),
      override: overrideMode
    )
    // TS は `source` の書き換えをモードフィルタの手前で行う(`:1152-1156`)。ここでは後ろで行うが
    // 結果は同じ: 全選択肢に一律に効くので `minutes`/`mode` は動かず、この分岐では最初からライブ
    // 証拠を 1 つも渡していないので推奨の選び方(`pickRecommended` の live 判定)も変わらない。
    let comparison = fullLegProviderEvidence ? measured : asEstimates(measured)
    // レグ単位の指定はどの自動ルールより強い。上限のフォールバックもここで止まる。
    if let overrideMode, comparison.options.contains(where: { $0.mode == overrideMode }) { return comparison }

    let maxWalk = travel.maxWalkingMinutesPerLeg
    let maxTransfers = travel.maxTransfersPerLeg
    let transferCount = knownTransferCount(from: from, to: to, travel: travel, scope: access.scope)
    var recommended = comparison.recommended

    if let maxWalk, recommended.mode == .walk, recommended.minutes > maxWalk {
      let breaksTransfers: (ModeEstimate) -> Bool = { option in
        guard let transferCount, let maxTransfers else { return false }
        return option.mode == .transit && transferCount > maxTransfers
      }
      if let alternative = comparison.options
        .filter({ $0.mode != .walk })
        .min(by: { leastBroken($0, $1, breaks: breaksTransfers) }) {
        recommended = alternative
      }
    }

    if let maxTransfers, let transferCount, transferCount > maxTransfers, recommended.mode == .transit {
      let breaksWalking: (ModeEstimate) -> Bool = { option in
        guard let maxWalk else { return false }
        return option.mode == .walk && option.minutes > maxWalk
      }
      if let alternative = comparison.options
        .filter({ $0.mode != .transit })
        .min(by: { leastBroken($0, $1, breaks: breaksWalking) }) {
        recommended = alternative
      }
    }

    if recommended == comparison.recommended { return comparison }
    return ModeComparison(options: comparison.options, fastest: comparison.fastest, recommended: recommended)
  }

  /// TS `:1153-1156` — 全選択肢の `source` を `estimate` にする(`unroutable` などは保つ)。
  private static func asEstimates(_ comparison: ModeComparison) -> ModeComparison {
    func estimated(_ option: ModeEstimate) -> ModeEstimate {
      var copy = option
      copy.source = .estimate
      return copy
    }
    return ModeComparison(
      options: comparison.options.map(estimated),
      fastest: estimated(comparison.fastest),
      recommended: estimated(comparison.recommended)
    )
  }

  /// TS `:1183-1189` / `:1195-1201` の比較子: 上限を破る方を後ろへ、次に所要分、最後にモード名。
  /// TS の `localeCompare` はここでは ASCII 小文字 3 語しか受け取らないので、コード単位順と一致する。
  private static func leastBroken(_ left: ModeEstimate, _ right: ModeEstimate, breaks: (ModeEstimate) -> Bool) -> Bool {
    let leftBreaks = breaks(left)
    let rightBreaks = breaks(right)
    if leftBreaks != rightBreaks { return !leftBreaks }
    if left.minutes != right.minutes { return left.minutes < right.minutes }
    return jsStringLess(left.mode.rawValue, right.mode.rawValue)
  }

  /// TS `endpointAsRouteStop` (`lib/trip-builder.ts:1205-1213`)。
  public static func endpointAsRouteStop(_ original: RouteStop, _ endpoint: PoiRouteEndpoint) -> RouteStop {
    guard endpoint.kind != .poi else { return original }
    var stop = original
    stop.id = endpoint.id
    stop.name = endpoint.name
    stop.latitude = endpoint.coordinate.latitude
    stop.longitude = endpoint.coordinate.longitude
    return stop
  }

  /// TS `accessMetadataForLeg` (`lib/trip-builder.ts:1215-1223`)。TS は direct のとき空オブジェクト
  /// を返す(= `BuiltPlanLeg` の 2 フィールドが現れない)ので、ここでは両方 `nil` を返す。
  public static func accessMetadataForLeg(
    from: RouteStop,
    to: RouteStop
  ) -> (routeEvidenceScope: RouteEvidenceScope?, accessAssumptions: [PoiAccessAssumption]?) {
    let access = PoiAccess.routeEndpoints(from: from, to: to)
    guard let scope = access.scope else { return (nil, nil) }
    return (scope, access.assumptions)
  }

  /// TS `googleMapsUrlsForLeg` (`lib/trip-builder.ts:1225-1247`)。キーは `TransportMode.rawValue`
  /// (`BuiltPlanLeg.googleMapsUrls` と同じ形)。座標が確定できないレグはリンクを出さない。
  public static func googleMapsUrlsForLeg(from: RouteStop, to: RouteStop) -> [String: String] {
    let access = PoiAccess.routeEndpoints(from: from, to: to)
    guard access.scope != .conditional, let origin = access.from, let destination = access.to else {
      return [TransportMode.walk.rawValue: "", TransportMode.transit.rawValue: "", TransportMode.taxi.rawValue: ""]
    }
    if access.scope == .access_node {
      let route = [endpointAsRouteStop(from, origin), endpointAsRouteStop(to, destination)]
      return [
        TransportMode.walk.rawValue: "",
        TransportMode.transit.rawValue: GoogleMapsUrl.build(route, travelMode: .transit),
        TransportMode.taxi.rawValue: "",
      ]
    }
    return [
      TransportMode.walk.rawValue: GoogleMapsUrl.build([from, to], travelMode: .walking),
      TransportMode.transit.rawValue: GoogleMapsUrl.build([from, to], travelMode: .transit),
      TransportMode.taxi.rawValue: GoogleMapsUrl.build([from, to], travelMode: .driving),
    ]
  }

  /// TS `routeTravelMinutes` (`lib/trip-builder.ts:1249-1251`) — 推奨モードの分 + 乗換バッファ 1 回分。
  public static func routeTravelMinutes(from: RouteStop, to: RouteStop, travel: TravelInputs) -> Int {
    routeComparison(from: from, to: to, travel: travel).recommended.minutes
      + (travel.bufferMinutes ?? EngineConstants.defaultTransferBuffer)
  }

  /// TS `clusterDistanceKm` (`lib/trip-builder.ts:1253-1257`) — 停留所からクラスタ重心までの直線距離。
  /// 空のクラスタは TS の `Number.MAX_SAFE_INTEGER`(= 「どこよりも遠い」)。
  public static func clusterDistanceKm(stop: RouteStop, cluster: [RouteStop]) -> Double {
    guard !cluster.isEmpty else { return Double(jsMaxSafeInteger) }
    let centroid = GeoPoint(
      latitude: cluster.reduce(0) { $0 + $1.latitude } / Double(cluster.count),
      longitude: cluster.reduce(0) { $0 + $1.longitude } / Double(cluster.count)
    )
    return straightLineDistanceKm(GeoPoint(latitude: stop.latitude, longitude: stop.longitude), centroid)
  }
}
