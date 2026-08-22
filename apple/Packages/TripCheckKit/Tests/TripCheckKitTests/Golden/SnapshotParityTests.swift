import Foundation
import Testing
@testable import TripCheckKit

/*
 * G3 — the strongest parity proof available to this port: the same scenarios are run through the
 * TypeScript engine (`node --experimental-strip-types scripts/export-golden-snapshots.mjs`, which
 * calls `buildTripFromWishlist → assessTripFit → createPlannerEvidenceSnapshot →
 * deriveFeasibilityResult` exactly as `tests/golden-feasibility.test.ts:60-67` does) and through
 * this engine, and every field of `plan`, `fit`, `evidence` and `result` is compared.
 *
 * Two corpora, because they prove different things:
 *
 * - `ts-snapshots.v1.json` — the golden 500. Every one of those scenarios is one day, one stop,
 *   balanced pace, `en`; they exercise the verdict ladder exhaustively and the *builder* barely at
 *   all.
 * - `ts-builder-snapshots.v1.json` — `builder-scenarios.v1.json`, hand-written for this test, where
 *   multi-day assignment, ordering, trimming, bases, airports, opening windows, live transit,
 *   overrides and locked orders are what is actually under measurement.
 *
 * Regenerate both after any change to `builder-scenarios.v1.json`:
 *
 *   node --experimental-strip-types scripts/export-golden-snapshots.mjs \
 *     --out apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/ts-snapshots.v1.json \
 *     tests/fixtures/golden-feasibility.v1.json
 *   node --experimental-strip-types scripts/export-golden-snapshots.mjs \
 *     --out apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/ts-builder-snapshots.v1.json \
 *     apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/builder-scenarios.v1.json
 */

/// The exporter's output file (`scripts/export-golden-snapshots.mjs`).
struct TSSnapshotFile: Decodable {
  var schemaVersion: Int
  var generatedFrom: String
  var snapshots: [TSSnapshot]

  static func load(_ resource: String) throws -> TSSnapshotFile {
    guard let url = Bundle.module.url(forResource: resource, withExtension: "json", subdirectory: "Fixtures") else {
      throw SnapshotLoadError.missingFixture(resource)
    }
    return try JSONDecoder().decode(TSSnapshotFile.self, from: Data(contentsOf: url))
  }
}

struct TSSnapshot: Decodable {
  var id: String
  var plan: JSONValue
  var fit: JSONValue
  var evidence: JSONValue
  var result: JSONValue

  var tree: JSONValue { .object(["plan": plan, "fit": fit, "evidence": evidence, "result": result]) }
}

enum SnapshotLoadError: Error {
  case missingFixture(String)
}

/// `Tests/TripCheckKitTests/Fixtures/builder-scenarios.v1.json` — the same `{id, trip, evidence}`
/// shape the golden corpus uses, without the oracle: G3 diffs against the TypeScript engine, so
/// the TypeScript engine *is* the oracle and a hand-written expectation would only add a third
/// opinion to disagree with.
struct BuilderCorpus: Decodable {
  var schemaVersion: Int
  var corpusId: String
  var description: String
  var realWorldAccuracyClaim: Bool
  var providerCallsAllowed: Bool
  var scenarios: [BuilderScenario]

  static func load() throws -> BuilderCorpus {
    guard let url = Bundle.module.url(forResource: "builder-scenarios.v1", withExtension: "json", subdirectory: "Fixtures") else {
      throw SnapshotLoadError.missingFixture("builder-scenarios.v1")
    }
    return try JSONDecoder().decode(BuilderCorpus.self, from: Data(contentsOf: url))
  }
}

struct BuilderScenario: Decodable {
  var id: String
  var covers: String
  var trip: GoldenTrip
  var evidence: EvidenceSnapshotOptions
}

private struct SnapshotRun: Encodable {
  var plan: BuiltTripPlan
  var fit: TripFitAssessment
  var evidence: PlannerEvidenceSnapshot
  var result: FeasibilityResult
}

private func snapshotTree(_ run: GoldenRun) throws -> JSONValue {
  try JSONValue.encoding(
    SnapshotRun(plan: run.plan, fit: run.fit, evidence: run.evidence, result: run.result)
  )
}

/// Paths that are known to differ and are recorded in
/// `docs/superpowers/specs/2026-08-21-tripcheck-swift-v1-design.md` 付録 A. Every entry names one
/// field, never a subtree; array positions collapse to `[]` so one line covers a field wherever it
/// appears in a list (see `JSONDiff.paths`).
let snapshotParityIgnoredPaths: [String] = [
  // 付録 A A-1 — time-based, differs on every run by construction.
  "evidence.capturedAt",
  // 付録 A A-2 — Task 16 chose a different hash pre-image (omits `undefined`-valued keys and the
  // spread `dateSpecific*` keys); the hash is an opaque cache token, never a verdict input. It is
  // computed once and copied, so the snapshot's copy and the result's copy differ together.
  "evidence.providerSnapshotHash",
  "result.providerSnapshotHash",
  // 付録 A A-3 — TypeScript's structural typing lets a `ResolvedInputStop` sit in a `RouteStop`
  // field with its four extra keys still attached at runtime. Swift's `RouteStop` is a distinct
  // type from `ResolvedStop`, so those keys are dropped on the way in. Pure input echo: the
  // builder never reads them off a `RouteStop`.
  "plan.baseRecommendations[].base.address",
  "plan.baseRecommendations[].base.countryCode",
  "plan.baseRecommendations[].base.input",
  "plan.baseRecommendations[].base.inputIndex",
  "plan.selectedBase.address",
  "plan.selectedBase.countryCode",
  "plan.selectedBase.input",
  "plan.selectedBase.inputIndex",
  "plan.deferredOptionalStops[].address",
  "plan.deferredOptionalStops[].countryCode",
  "plan.deferredOptionalStops[].input",
  "plan.deferredOptionalStops[].inputIndex",
  "plan.deferredUnavailableStops[].address",
  "plan.deferredUnavailableStops[].countryCode",
  "plan.deferredUnavailableStops[].input",
  "plan.deferredUnavailableStops[].inputIndex",
  "plan.days[].endBase.address",
  "plan.days[].endBase.countryCode",
  "plan.days[].endBase.input",
  "plan.days[].endBase.inputIndex",
  "plan.days[].startBase.address",
  "plan.days[].startBase.countryCode",
  "plan.days[].startBase.input",
  "plan.days[].startBase.inputIndex",
  "plan.days[].legs[].from.address",
  "plan.days[].legs[].from.countryCode",
  "plan.days[].legs[].from.input",
  "plan.days[].legs[].from.inputIndex",
  "plan.days[].legs[].to.address",
  "plan.days[].legs[].to.countryCode",
  "plan.days[].legs[].to.input",
  "plan.days[].legs[].to.inputIndex",
  "plan.days[].stops[].stop.address",
  "plan.days[].stops[].stop.countryCode",
  "plan.days[].stops[].stop.input",
  "plan.days[].stops[].stop.inputIndex",
  "result.scheduledDays[].endBase.address",
  "result.scheduledDays[].endBase.countryCode",
  "result.scheduledDays[].endBase.input",
  "result.scheduledDays[].endBase.inputIndex",
  "result.scheduledDays[].startBase.address",
  "result.scheduledDays[].startBase.countryCode",
  "result.scheduledDays[].startBase.input",
  "result.scheduledDays[].startBase.inputIndex",
  "result.scheduledDays[].legs[].from.address",
  "result.scheduledDays[].legs[].from.countryCode",
  "result.scheduledDays[].legs[].from.input",
  "result.scheduledDays[].legs[].from.inputIndex",
  "result.scheduledDays[].legs[].to.address",
  "result.scheduledDays[].legs[].to.countryCode",
  "result.scheduledDays[].legs[].to.input",
  "result.scheduledDays[].legs[].to.inputIndex",
  "result.scheduledDays[].stops[].stop.address",
  "result.scheduledDays[].stops[].stop.countryCode",
  "result.scheduledDays[].stops[].stop.input",
  "result.scheduledDays[].stops[].stop.inputIndex",
  // 付録 A A-4 — the same structural leak one level down: `createPlannerEvidenceSnapshot` spreads the
  // caller's whole `openingEvidenceByStop` entry into the fact's `Evidence`
  // (`lib/feasibility-result.ts:440`, `:556`), so two keys `Evidence` never declares ride along.
  // Swift's `Evidence` carries only the declared fields, the decision Task 16 recorded.
  "evidence.facts[].evidence.dateSpecific",
  "evidence.facts[].evidence.dateSpecificDates",
]

/// Groups the raw diff lines by field path so a single wrong field over 500 scenarios reads as one
/// line with a count, not 500 lines that scroll the real signal off the screen.
private func report(_ diffs: [String], corpus: String) -> String {
  var byPath: [String: (count: Int, sample: String)] = [:]
  var byScenario: [String: Int] = [:]
  var order: [String] = []
  for diff in diffs {
    byScenario[String(diff.prefix(while: { $0 != ":" })), default: 0] += 1
    // "<scenario-id>: <path>: <detail>" — the path is the second field. Array indices collapse so
    // "the same field on every day" reads as one row rather than one row per position.
    let parts = diff.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false)
    let path = JSONDiff.normalize(parts.count >= 2 ? parts[1].trimmingCharacters(in: .whitespaces) : diff)
    if byPath[path] == nil { order.append(path) }
    byPath[path, default: (0, diff)].count += 1
  }
  let ranked = order.sorted { (byPath[$0]?.count ?? 0, $1) > (byPath[$1]?.count ?? 0, $0) }
  let lines = ranked.prefix(40).map { "  ×\(byPath[$0]!.count)  \(byPath[$0]!.sample)" }
  // The remaining paths without their samples: which fields disagree is the part worth naming, and
  // 40 full sample lines is already as much as a failure message can usefully carry.
  let rest = ranked.dropFirst(40)
  let tail = rest.isEmpty ? "" : "\n  … \(rest.count) more paths: " + rest.joined(separator: ", ")
  let scenarios = byScenario
    .sorted { ($0.value, $1.key) > ($1.value, $0.key) }
    .prefix(20)
    .map { "\($0.key)=\($0.value)" }
    .joined(separator: " ")
  return "\(corpus): \(diffs.count) field diffs over \(byPath.count) distinct paths"
    + " in \(byScenario.count) scenarios (\(scenarios)):\n"
    + lines.joined(separator: "\n") + tail
}

private func diffCorpus(
  file: TSSnapshotFile,
  runs: [String: GoldenRun],
  corpus: String
) throws -> [String] {
  var diffs: [String] = []
  for snapshot in file.snapshots {
    guard let run = runs[snapshot.id] else {
      diffs.append("\(snapshot.id): no scenario with this id in the Swift-side corpus")
      continue
    }
    let mine = try snapshotTree(run)
    diffs += JSONDiff
      .paths(expected: snapshot.tree, actual: mine, ignoring: snapshotParityIgnoredPaths)
      .map { "\(snapshot.id): \($0)" }
  }
  return diffs
}

/// The golden 500, field by field against the TypeScript engine that produced them.
@Test func swiftOutputMatchesTypeScriptSnapshots() throws {
  let file = try TSSnapshotFile.load("ts-snapshots.v1")
  #expect(file.schemaVersion == 1)
  let corpus = try GoldenCorpus.load()
  #expect(file.snapshots.count == corpus.scenarios.count)
  let runs = Dictionary(uniqueKeysWithValues: corpus.scenarios.map { ($0.id, runGolden($0)) })
  let diffs = try diffCorpus(file: file, runs: runs, corpus: "golden")
  #expect(diffs.count == 0, "\(report(diffs, corpus: "golden"))")
}

/// The builder corpus — multi-day assignment, ordering, trimming, bases, airports, opening
/// windows, live transit and user overrides, none of which the golden 500 reach.
@Test func swiftBuilderOutputMatchesTypeScriptSnapshots() throws {
  let file = try TSSnapshotFile.load("ts-builder-snapshots.v1")
  #expect(file.schemaVersion == 1)
  let corpus = try BuilderCorpus.load()
  #expect(corpus.realWorldAccuracyClaim == false)
  #expect(corpus.providerCallsAllowed == false)
  #expect(file.snapshots.count == corpus.scenarios.count)
  #expect(Set(corpus.scenarios.map(\.id)).count == corpus.scenarios.count)
  let runs = Dictionary(
    uniqueKeysWithValues: corpus.scenarios.map {
      ($0.id, runPlannerScenario(trip: $0.trip, evidence: $0.evidence))
    }
  )
  let diffs = try diffCorpus(file: file, runs: runs, corpus: "builder")
  #expect(diffs.count == 0, "\(report(diffs, corpus: "builder"))")
}

/// The builder corpus is a synthetic contract fixture like the golden one: no provider identifiers,
/// no claim that any of these coordinates or durations describe the real world.
@Test func builderCorpusIsSyntheticAndProviderFree() throws {
  let corpus = try BuilderCorpus.load()
  #expect(corpus.scenarios.count >= 20)
  for scenario in corpus.scenarios {
    for stop in scenario.trip.context.resolvedStops ?? [] {
      #expect(stop.sourceUrl.hasPrefix("https://example.test/builder/"), "\(scenario.id)")
      #expect(stop.providerRef == nil, "\(scenario.id) must not contain a provider identifier")
    }
    if let base = scenario.trip.context.resolvedBase {
      #expect(base.sourceUrl.hasPrefix("https://example.test/builder/"), "\(scenario.id)")
      #expect(base.providerRef == nil, "\(scenario.id)")
    }
    #expect(!scenario.covers.isEmpty, "\(scenario.id) must say what it covers")
  }
}
