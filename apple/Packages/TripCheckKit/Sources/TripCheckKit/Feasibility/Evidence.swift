import Foundation

/*
 * The explicit evidence model: one `CriticalFact` per thing the verdict leans on, each carrying
 * where its value came from and how sure that source is.
 *
 * lib/feasibility-result.ts:7-54.
 */

/// TS `EvidenceStatus` (`lib/feasibility-result.ts:7-12`)
public enum EvidenceStatus: String, Codable, Sendable, CaseIterable {
  case user_provided, verified, estimated, unknown, failed
}

/// TS `EvidenceSource` (`lib/feasibility-result.ts:14-19`)
public enum EvidenceSource: String, Codable, Sendable, CaseIterable {
  case user, google, tripcheck_catalog, derived, other
}

/// TS `Evidence<T>` (`lib/feasibility-result.ts:21-29`). `value` is `T | null` — a fact can exist
/// (and be counted) with nothing known in it, which is exactly what an unresolved critical fact is.
public struct Evidence<Value: Codable & Equatable & Sendable>: Equatable, Sendable {
  public var value: Value?
  public var status: EvidenceStatus
  public var source: EvidenceSource
  public var fetchedAt: String?
  public var expiresAt: String?
  public var providerRef: String?
  public var explanation: String?

  public init(
    value: Value? = nil,
    status: EvidenceStatus,
    source: EvidenceSource,
    fetchedAt: String? = nil,
    expiresAt: String? = nil,
    providerRef: String? = nil,
    explanation: String? = nil
  ) {
    self.value = value
    self.status = status
    self.source = source
    self.fetchedAt = fetchedAt
    self.expiresAt = expiresAt
    self.providerRef = providerRef
    self.explanation = explanation
  }
}

extension Evidence: Codable {
  private enum CodingKeys: String, CodingKey {
    case value, status, source, fetchedAt, expiresAt, providerRef, explanation
  }

  /// `value` is a required TS key (`T | null`, never `undefined`), so it is written even when
  /// `nil` — the synthesized encoder would use `encodeIfPresent` and drop the key, which is not
  /// the shape TS's `JSON.stringify` produces. The four optional metadata keys keep the
  /// `encodeIfPresent` behaviour, matching TS's `undefined` fields being omitted.
  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    if let value { try container.encode(value, forKey: .value) } else { try container.encodeNil(forKey: .value) }
    try container.encode(status, forKey: .status)
    try container.encode(source, forKey: .source)
    try container.encodeIfPresent(fetchedAt, forKey: .fetchedAt)
    try container.encodeIfPresent(expiresAt, forKey: .expiresAt)
    try container.encodeIfPresent(providerRef, forKey: .providerRef)
    try container.encodeIfPresent(explanation, forKey: .explanation)
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    // TS types `value` as `T | null` — required, never `undefined` — so a payload without the key
    // is malformed and must throw rather than quietly become `nil`. `decode(Value?.self, forKey:)` throws
    // `.keyNotFound` for a missing key and yields `nil` for an explicit `null`.
    self.value = try container.decode(Value?.self, forKey: .value)
    self.status = try container.decode(EvidenceStatus.self, forKey: .status)
    self.source = try container.decode(EvidenceSource.self, forKey: .source)
    self.fetchedAt = try container.decodeIfPresent(String.self, forKey: .fetchedAt)
    self.expiresAt = try container.decodeIfPresent(String.self, forKey: .expiresAt)
    self.providerRef = try container.decodeIfPresent(String.self, forKey: .providerRef)
    self.explanation = try container.decodeIfPresent(String.self, forKey: .explanation)
  }
}

/// TS `CriticalFactKind` (`lib/feasibility-result.ts:31-40`)
public enum CriticalFactKind: String, Codable, Sendable, CaseIterable {
  case place_identity, stay_duration, opening_hours, last_entry, route_leg, mobility_policy, day_window, base, airport_boundary
}

/// TS `CriticalFact` (`lib/feasibility-result.ts:42-47`). TS's `Evidence<unknown>` is type-erased
/// so facts whose values are strings, integers or booleans can share one array and hash the same
/// way; `JSONValue` is the Swift stand-in for that `unknown`.
public struct CriticalFact: Equatable, Sendable, Codable {
  public var id: String
  public var kind: CriticalFactKind
  public var label: String
  public var evidence: Evidence<JSONValue>

  public init(id: String, kind: CriticalFactKind, label: String, evidence: Evidence<JSONValue>) {
    self.id = id
    self.kind = kind
    self.label = label
    self.evidence = evidence
  }
}

/// TS `PlannerEvidenceSnapshot` (`lib/feasibility-result.ts:49-54`). `solverTimedOut` is written
/// only when true (TS `...(options.solverTimedOut ? { solverTimedOut: true } : {})`, `:675`).
public struct PlannerEvidenceSnapshot: Equatable, Sendable, Codable {
  public var facts: [CriticalFact]
  public var capturedAt: String
  public var providerSnapshotHash: String
  public var solverTimedOut: Bool?

  public init(facts: [CriticalFact], capturedAt: String, providerSnapshotHash: String, solverTimedOut: Bool? = nil) {
    self.facts = facts
    self.capturedAt = capturedAt
    self.providerSnapshotHash = providerSnapshotHash
    self.solverTimedOut = solverTimedOut
  }
}
