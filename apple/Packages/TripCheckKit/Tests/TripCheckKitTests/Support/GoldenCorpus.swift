import Foundation
@testable import TripCheckKit

/// SYNTHETIC CONTRACT FIXTURE ONLY — mirrors `tests/golden-feasibility.test.ts:15-60`'s
/// `GoldenScenario`/`GoldenCorpus` types over `Tests/TripCheckKitTests/Fixtures/golden-feasibility.v1.json`
/// (500 scenarios, copied byte-for-byte from `tests/fixtures/golden-feasibility.v1.json`).
///
/// `evidence` stays a raw `JSONValue` until Task 16 ports `EvidenceSnapshotOptions` and its
/// `deriveFeasibilityResult` consumers; `oracle`'s conflict-code fields stay `String` until that
/// same task has a ported `ConflictCode`/`FeasibilityState`/`CriticalFactKind` enum to check them
/// against.
struct GoldenCorpus: Decodable {
  var schemaVersion: Int
  var corpusId: String
  var description: String
  var generatedBy: String
  var rootSeed: Int
  var realWorldAccuracyClaim: Bool
  var providerCallsAllowed: Bool
  var fixedAt: String
  var regionQuotas: [String: Int]
  var scenarios: [GoldenScenario]

  enum LoadError: Error {
    case missingFixture
  }

  /// `Bundle.module` resolves the fixture the test target copied verbatim into its resource
  /// bundle (`Package.swift`'s `resources: [.copy("Fixtures")]`).
  static func load() throws -> GoldenCorpus {
    guard let url = Bundle.module.url(forResource: "golden-feasibility.v1", withExtension: "json", subdirectory: "Fixtures") else {
      throw LoadError.missingFixture
    }
    let data = try Data(contentsOf: url)
    return try JSONDecoder().decode(GoldenCorpus.self, from: data)
  }
}

/// tests/golden-feasibility.test.ts:25-47 — `GoldenScenario`
struct GoldenScenario: Decodable {
  var id: String
  var region: String
  var archetype: String
  var seed: Int
  var pairId: String?
  var realWorldAccuracyClaim: Bool
  var providerCallsAllowed: Bool
  var trip: GoldenTrip
  var evidence: JSONValue
  var oracle: GoldenOracle
  var provenance: GoldenProvenance
}

/// tests/golden-feasibility.test.ts:33-39 — `GoldenScenario["trip"]`
struct GoldenTrip: Decodable {
  var raw: String
  var days: Int
  var pace: Pace
  var locale: PlannerLocale
  var context: PlannerContext
}

/// tests/golden-feasibility.test.ts:15-23 — `GoldenOracle`
struct GoldenOracle: Decodable {
  var hardConflictExpected: Bool
  var expectedStateOneOf: [String]
  var requiredConflictCodes: [String]
  var forbiddenConflictCodes: [String]
  var mustScheduledIds: [String]
  var expectedUnknownKinds: [String]?
  var solverTimedOut: Bool?
}

/// tests/golden-feasibility.test.ts:42-46 — `GoldenScenario["provenance"]`
struct GoldenProvenance: Decodable {
  var kind: String
  var generatorVersion: String
  var realWorldAccuracyClaim: Bool
}
