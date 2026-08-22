import Foundation

/*
 * A handful of Swiss mountain-rail summits are not reachable on foot, by taxi,
 * or by any straight-line provider route: the traveller boards a cog railway
 * or cable car from a named valley/mid-station. These policies keep the
 * itinerary's own POI (the summit) intact while redirecting provider routing
 * to the access node that actually has a timetable.
 *
 * lib/poi-access.ts (whole file, 233 lines).
 */

/// TS `PoiAccessPolicy["id"]` (`lib/poi-access.ts:5`)
public enum PoiAccessPolicyId: String, Codable, Sendable, CaseIterable {
  case jungfraujoch, gornergrat
}

/// TS `PoiAccessPolicy["confidence"]` (`lib/poi-access.ts:20`) — the TS type is the single
/// literal `"high"`; kept as its own type rather than reusing `Confidence` (`low`/`medium`)
/// since the two enums do not share a value space.
public enum PoiAccessConfidence: String, Codable, Sendable, CaseIterable {
  case high
}

/// TS `PoiAccessPolicy["note"]` (`lib/poi-access.ts:17`)
public struct PoiAccessNote: Hashable, Codable, Sendable {
  public var en: String
  public var ja: String

  public init(en: String, ja: String) {
    self.en = en
    self.ja = ja
  }
}

/// TS `PoiAccessPolicy["accessNode"]` (`lib/poi-access.ts:7-15`). `coordinate` reuses `GeoPoint`
/// in place of TS's structurally-identical `PoiAccessCoordinate`.
public struct PoiAccessNode: Hashable, Codable, Sendable {
  /// Product-owned transport identity; never a Google Place display field.
  public var id: String
  public var name: String
  public var providerQuery: String
  /// Optional by design: a missing or invalid coordinate must fail conditional.
  public var coordinate: GeoPoint?
  public var coordinateSourceUrl: String?

  public init(id: String, name: String, providerQuery: String, coordinate: GeoPoint? = nil, coordinateSourceUrl: String? = nil) {
    self.id = id
    self.name = name
    self.providerQuery = providerQuery
    self.coordinate = coordinate
    self.coordinateSourceUrl = coordinateSourceUrl
  }
}

/// TS `PoiAccessPolicy` (`lib/poi-access.ts:4-21`)
public struct PoiAccessPolicy: Hashable, Codable, Sendable {
  public var id: PoiAccessPolicyId
  public var labels: [String]
  public var accessNode: PoiAccessNode
  public var allowedModes: [TransportMode]
  public var note: PoiAccessNote
  public var sourceUrl: String
  public var verifiedAt: String
  public var confidence: PoiAccessConfidence

  public init(
    id: PoiAccessPolicyId,
    labels: [String],
    accessNode: PoiAccessNode,
    allowedModes: [TransportMode],
    note: PoiAccessNote,
    sourceUrl: String,
    verifiedAt: String,
    confidence: PoiAccessConfidence = .high
  ) {
    self.id = id
    self.labels = labels
    self.accessNode = accessNode
    self.allowedModes = allowedModes
    self.note = note
    self.sourceUrl = sourceUrl
    self.verifiedAt = verifiedAt
    self.confidence = confidence
  }
}

/// TS `PoiAccessAssumption["endpointRole"]` (`lib/poi-access.ts:29`)
public enum PoiAccessEndpointRole: String, Codable, Sendable, CaseIterable {
  case origin, destination
}

/// TS `PoiAccessAssumption` (`lib/poi-access.ts:25-39`)
public struct PoiAccessAssumption: Hashable, Codable, Sendable {
  public var policyId: PoiAccessPolicyId
  public var mountainStopId: String
  public var mountainStopName: String
  public var endpointRole: PoiAccessEndpointRole
  public var accessNodeId: String
  public var accessNodeName: String
  public var providerQuery: String
  public var coordinate: GeoPoint?
  public var coordinateSourceUrl: String?
  public var sourceUrl: String
  public var verifiedAt: String
  public var confidence: PoiAccessConfidence
  public var note: PoiAccessNote

  public init(
    policyId: PoiAccessPolicyId,
    mountainStopId: String,
    mountainStopName: String,
    endpointRole: PoiAccessEndpointRole,
    accessNodeId: String,
    accessNodeName: String,
    providerQuery: String,
    coordinate: GeoPoint?,
    coordinateSourceUrl: String? = nil,
    sourceUrl: String,
    verifiedAt: String,
    confidence: PoiAccessConfidence,
    note: PoiAccessNote
  ) {
    self.policyId = policyId
    self.mountainStopId = mountainStopId
    self.mountainStopName = mountainStopName
    self.endpointRole = endpointRole
    self.accessNodeId = accessNodeId
    self.accessNodeName = accessNodeName
    self.providerQuery = providerQuery
    self.coordinate = coordinate
    self.coordinateSourceUrl = coordinateSourceUrl
    self.sourceUrl = sourceUrl
    self.verifiedAt = verifiedAt
    self.confidence = confidence
    self.note = note
  }
}

/// TS `PoiRouteEndpoint["kind"]` (`lib/poi-access.ts:45`)
public enum PoiEndpointKind: String, Codable, Sendable, CaseIterable {
  case poi, access_node
}

/// TS `PoiRouteEndpoint` (`lib/poi-access.ts:41-47`)
public struct PoiRouteEndpoint: Hashable, Codable, Sendable {
  public var id: String
  public var name: String
  public var coordinate: GeoPoint
  public var kind: PoiEndpointKind
  public var providerQuery: String?

  public init(id: String, name: String, coordinate: GeoPoint, kind: PoiEndpointKind, providerQuery: String? = nil) {
    self.id = id
    self.name = name
    self.coordinate = coordinate
    self.kind = kind
    self.providerQuery = providerQuery
  }
}

/// TS `LegAccessResolution["status"]`, narrowed to the two non-"direct" cases (`lib/poi-access.ts:50`)
/// — a `nil` scope from `PoiAccess.routeEndpoints` stands in for "direct" (no policy on either end).
public enum RouteEvidenceScope: String, Codable, Sendable, CaseIterable {
  case access_node, conditional
}

public enum PoiAccess {
  // Access-node coordinates below are product-owned Swiss public-transport stop
  // facts (DiDok), not cached Google content. Timetables remain runtime provider
  // evidence; the summit POI is never replaced in the traveller's itinerary.
  // lib/poi-access.ts:62-101 — transcribed verbatim (coordinates, sourceUrl, verifiedAt).
  public static let policies: [PoiAccessPolicy] = [
    PoiAccessPolicy(
      id: .jungfraujoch,
      labels: ["jungfraujoch", "jungfrau top of europe", "ユングフラウヨッホ", "ユングフラウ トップ オブ ヨーロッパ"],
      accessNode: PoiAccessNode(
        id: "didok-8507361",
        name: "Eigergletscher station",
        providerQuery: "Eigergletscher station, Switzerland",
        coordinate: GeoPoint(latitude: 46.5748, longitude: 7.974861),
        coordinateSourceUrl: "https://data.sbb.ch/explore/dataset/dienststellen-gemass-opentransportdataswiss/table/?q=8507361"
      ),
      allowedModes: [.transit],
      note: PoiAccessNote(
        en: "Mountain transport is required via Grindelwald Terminal or Kleine Scheidegg and Eigergletscher.",
        ja: "グリンデルワルト・ターミナルまたはクライネ・シャイデックからアイガーグレッチャーを経由する山岳交通が必要です。"
      ),
      sourceUrl: "https://www.jungfrau.ch/en-gb/arriving/",
      verifiedAt: "2026-08-09",
      confidence: .high
    ),
    PoiAccessPolicy(
      id: .gornergrat,
      labels: ["gornergrat", "ゴルナーグラート"],
      accessNode: PoiAccessNode(
        id: "didok-8501690",
        name: "Zermatt GGB station",
        providerQuery: "Zermatt GGB station, Switzerland",
        coordinate: GeoPoint(latitude: 46.023889, longitude: 7.748889),
        coordinateSourceUrl: "https://data.sbb.ch/explore/dataset/dienststellen-gemass-opentransportdataswiss/table/?q=8501690"
      ),
      allowedModes: [.transit],
      note: PoiAccessNote(
        en: "Use the Gornergrat Railway from its valley station opposite Zermatt station; no direct road route is shown.",
        ja: "ツェルマット駅向かいのゴルナーグラート鉄道を利用します。山頂への直通道路としては表示しません。"
      ),
      sourceUrl: "https://www.gornergrat.ch/en/pages/timetable-gornergrat-bahn",
      verifiedAt: "2026-08-09",
      confidence: .high
    ),
  ]

  // lib/poi-access.ts:103-105 — NFKC + lowercase + strip whitespace/punctuation/symbol runs.
  private static let stripPattern = try! JSRegex("[\\s\\p{P}\\p{S}]+")

  /// 正規化は NFKC 畳み込み + 正規表現置換で、この 2 つがアクセス方針の解決コストのほぼ全部。
  /// 入力は「方針のラベル(固定の数語)」と「停留所の名前」しかなく、日内順序の探索は同じ数語を
  /// 何千回も投げ直すので、純関数の答えをそのまま覚えておく。振る舞いは変わらない。
  private final class NormalizedLabelMemo: @unchecked Sendable {
    /// 1 プロセスで解決しうる地名の数は多くないが、無制限に伸ばさないための上限。
    private static let capacity = 4096
    private let lock = NSLock()
    private var entries: [String: String] = [:]

    func value(for key: String, compute: (String) -> String) -> String {
      lock.lock()
      if let cached = entries[key] {
        lock.unlock()
        return cached
      }
      lock.unlock()
      let computed = compute(key)
      lock.lock()
      if entries.count >= Self.capacity { entries.removeAll(keepingCapacity: true) }
      entries[key] = computed
      lock.unlock()
      return computed
    }
  }

  private static let normalizedLabels = NormalizedLabelMemo()

  private static func normalizeAccessLabel(_ value: String) -> String {
    normalizedLabels.value(for: value) { raw in
      let folded = JSText.normalizeNFKC(raw).lowercased()
      return stripPattern.replacingAll(in: folded, with: "")
    }
  }

  /// TS `poiAccessPolicyForStop` (`lib/poi-access.ts:107-118`), narrowed to the `name` field —
  /// `RouteStop` (unlike TS's structural `{ name; input? }`) carries no `input` alias to match.
  public static func policy(for stop: RouteStop, policies: [PoiAccessPolicy] = PoiAccess.policies) -> PoiAccessPolicy? {
    let normalizedName = normalizeAccessLabel(stop.name)
    return policies.first { policy in
      policy.labels.contains { label in
        let normalizedLabel = normalizeAccessLabel(label)
        return normalizedName == normalizedLabel || normalizedName.contains(normalizedLabel)
      }
    }
  }

  /// TS `allowedTransportModesForLeg` (`lib/poi-access.ts:120-127`). Unlike TS, which always
  /// returns an explicit `["walk","transit","taxi"]` when neither end carries a policy, `nil`
  /// here stands for "unrestricted" — the natural no-op input to
  /// `TravelEstimates.estimate(allowedModes:)`.
  public static func allowedModes(from: RouteStop, to: RouteStop, policies: [PoiAccessPolicy] = PoiAccess.policies) -> [TransportMode]? {
    let fromPolicy = policy(for: from, policies: policies)
    let toPolicy = policy(for: to, policies: policies)
    if fromPolicy == nil && toPolicy == nil { return nil }
    let fromModes = fromPolicy?.allowedModes ?? TransportMode.allCases
    let toModes = toPolicy?.allowedModes ?? TransportMode.allCases
    return TransportMode.allCases.filter { fromModes.contains($0) && toModes.contains($0) }
  }

  // lib/poi-access.ts:129-138
  private static func validCoordinate(_ value: GeoPoint?) -> GeoPoint? {
    guard let value,
          value.latitude.isFinite, value.longitude.isFinite,
          value.latitude >= -90, value.latitude <= 90,
          value.longitude >= -180, value.longitude <= 180
    else { return nil }
    return value
  }

  // lib/poi-access.ts:140-160
  private static func assumption(for stop: RouteStop, policy: PoiAccessPolicy, role: PoiAccessEndpointRole) -> PoiAccessAssumption {
    PoiAccessAssumption(
      policyId: policy.id,
      mountainStopId: stop.id,
      mountainStopName: stop.name,
      endpointRole: role,
      accessNodeId: policy.accessNode.id,
      accessNodeName: policy.accessNode.name,
      providerQuery: policy.accessNode.providerQuery,
      coordinate: validCoordinate(policy.accessNode.coordinate),
      coordinateSourceUrl: policy.accessNode.coordinateSourceUrl,
      sourceUrl: policy.sourceUrl,
      verifiedAt: policy.verifiedAt,
      confidence: policy.confidence,
      note: policy.note
    )
  }

  // lib/poi-access.ts:162-179
  private static func directEndpoint(_ stop: RouteStop) -> PoiRouteEndpoint {
    PoiRouteEndpoint(id: stop.id, name: stop.name, coordinate: GeoPoint(latitude: stop.latitude, longitude: stop.longitude), kind: .poi)
  }

  private static func accessEndpoint(_ policy: PoiAccessPolicy, coordinate: GeoPoint) -> PoiRouteEndpoint {
    PoiRouteEndpoint(
      id: "access-node:\(policy.id.rawValue):\(policy.accessNode.id)",
      name: policy.accessNode.name,
      coordinate: coordinate,
      kind: .access_node,
      providerQuery: policy.accessNode.providerQuery
    )
  }

  /// TS `routeAccessEndpointsForLeg` (`lib/poi-access.ts:186-233`), reshaped into a tuple per
  /// task-8-brief.md's interface. Deviates from the brief's literal (non-optional) tuple type:
  /// TS's "conditional" branch (`:209-218`) returns `origin: null, destination: null` — coordinates
  /// unavailable must fail closed, not fall back to the POI's own coordinates — so `from`/`to` are
  /// `PoiRouteEndpoint?` here, non-nil except in that one case. `nil` scope stands for TS's
  /// `status: "direct"`. `routingEndpointKey`/`reason` are dropped; callers can derive the former
  /// from `from.id`/`to.id` and the latter is implied by `scope == .conditional`.
  public static func routeEndpoints(
    from: RouteStop,
    to: RouteStop,
    policies: [PoiAccessPolicy] = PoiAccess.policies
  ) -> (from: PoiRouteEndpoint?, to: PoiRouteEndpoint?, scope: RouteEvidenceScope?, assumptions: [PoiAccessAssumption]) {
    let fromPolicy = policy(for: from, policies: policies)
    let toPolicy = policy(for: to, policies: policies)
    if fromPolicy == nil && toPolicy == nil {
      return (directEndpoint(from), directEndpoint(to), nil, [])
    }

    var assumptions: [PoiAccessAssumption] = []
    if let fromPolicy { assumptions.append(assumption(for: from, policy: fromPolicy, role: .origin)) }
    if let toPolicy { assumptions.append(assumption(for: to, policy: toPolicy, role: .destination)) }
    if assumptions.contains(where: { $0.coordinate == nil }) {
      return (nil, nil, .conditional, assumptions)
    }

    let origin = fromPolicy.map { accessEndpoint($0, coordinate: assumptions.first { $0.endpointRole == .origin }!.coordinate!) } ?? directEndpoint(from)
    let destination = toPolicy.map { accessEndpoint($0, coordinate: assumptions.first { $0.endpointRole == .destination }!.coordinate!) } ?? directEndpoint(to)
    return (origin, destination, .access_node, assumptions)
  }
}
