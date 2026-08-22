import Foundation
import Testing
@testable import TripCheckKit

/// SYNTHETIC CONTRACT FIXTURES — the corpus measures the engine against its own declared
/// contract, never against the real world (`tests/fixtures/golden-feasibility.v1.json`'s
/// `realWorldAccuracyClaim: false`).
///
/// Ported from `tests/golden-feasibility.test.ts`: `runScenario` (:60-67), `canonicalRun`
/// (:69-77), the corpus-shape test (:79-129), the oracle sweep (:131-186), the repair-pair
/// test (:188-208), and both halves of the determinism test (:210-224) — the full-corpus
/// double run (:211-213) and the hundred repetitions per archetype (:215-223), which are one
/// `test()` in Node and two `@Test`s here so a failure names which half broke.

/// tests/golden-feasibility.test.ts:60-67 — `runScenario`
struct GoldenRun {
  var plan: BuiltTripPlan
  var fit: TripFitAssessment
  var evidence: PlannerEvidenceSnapshot
  var result: FeasibilityResult
}

/// TS calls `buildTripFromWishlist(raw, days, pace, locale, context)` and then
/// `assessTripFit(raw, days, pace, locale, context, plan)`; both positional argument lists are
/// folded into `TripRequest` here. `deriveFeasibilityResult` is called with three arguments in
/// TS (`:66`), so `alternatives` keeps its `[]` default — the golden oracle never inspects the
/// counterfactual list.
func runGolden(_ scenario: GoldenScenario) -> GoldenRun {
  let request = TripRequest(
    raw: scenario.trip.raw,
    days: scenario.trip.days,
    pace: scenario.trip.pace,
    locale: scenario.trip.locale,
    context: scenario.trip.context
  )
  let plan = TripBuilder.build(request)
  let fit = TripScenarios.assessTripFit(request, plan: plan)
  let evidence = Feasibility.snapshot(plan: plan, options: scenario.evidence)
  return GoldenRun(
    plan: plan,
    fit: fit,
    evidence: evidence,
    result: Feasibility.derive(plan: plan, fit: fit, evidence: evidence)
  )
}

private struct GoldenCanonicalRun: Encodable {
  var plan: BuiltTripPlan
  var fit: TripFitAssessment
  var evidence: PlannerEvidenceSnapshot
  var result: FeasibilityResult
}

/// tests/golden-feasibility.test.ts:69-77 — `canonicalRun`. TS stringifies plan, fit, evidence
/// and result together; `.sortedKeys` stands in for JS insertion order, which is stable for
/// these plain records.
private func canonicalGoldenRun(_ scenario: GoldenScenario) throws -> Data {
  let run = runGolden(scenario)
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  return try encoder.encode(
    GoldenCanonicalRun(plan: run.plan, fit: run.fit, evidence: run.evidence, result: run.result)
  )
}

private func label(_ scenario: GoldenScenario) -> String {
  "\(scenario.id) [\(scenario.archetype)/\(scenario.region)]"
}

@Test func corpusShapeIsExactlyTheDeclaredFiveHundred() throws {
  let corpus = try GoldenCorpus.load()
  #expect(corpus.schemaVersion == 1)
  #expect(corpus.realWorldAccuracyClaim == false)
  #expect(corpus.providerCallsAllowed == false)
  #expect(corpus.description.range(of: "Synthetic contract fixtures", options: .caseInsensitive) != nil)
  #expect(corpus.description.range(of: "do not measure real-world", options: .caseInsensitive) != nil)
  #expect(corpus.scenarios.count == 500)
  #expect(Set(corpus.scenarios.map(\.id)).count == 500)
  #expect(corpus.regionQuotas == ["Tokyo": 250, "Kyoto-Osaka": 75, "Switzerland": 50, "Europe": 50, "US": 25, "Edge": 50])

  var regionCounts: [String: Int] = [:]
  for scenario in corpus.scenarios {
    regionCounts[scenario.region, default: 0] += 1
    #expect(scenario.realWorldAccuracyClaim == false, "\(scenario.id)")
    #expect(scenario.providerCallsAllowed == false, "\(scenario.id)")
    #expect(scenario.provenance.kind == "synthetic_contract_fixture", "\(scenario.id)")
    #expect(scenario.provenance.realWorldAccuracyClaim == false, "\(scenario.id)")
    for stop in scenario.trip.context.resolvedStops ?? [] {
      #expect(stop.sourceUrl.hasPrefix("https://example.test/golden/"), "\(scenario.id)")
      #expect(stop.providerRef == nil, "\(scenario.id) must not contain a provider identifier")
    }
  }
  #expect(regionCounts == corpus.regionQuotas)
  #expect(Set(corpus.scenarios.map(\.archetype)).sorted() == [
    "closed_on_fixed_day",
    "day_end_conflict",
    "day_end_repaired",
    "fixed_booking_late",
    "fixed_booking_repaired",
    "last_entry_conflict",
    "last_entry_repaired",
    "open_on_fixed_day",
    "solver_timeout",
    "unknown_hours",
  ])
}

/// tests/golden-feasibility.test.ts:131-186 — every oracle clause, collected rather than
/// short-circuited so one run names every disagreement at once.
@Test func everyScenarioSatisfiesItsOracle() throws {
  let corpus = try GoldenCorpus.load()
  var failures: [String] = []
  var expectedHardConflictCount = 0
  var falseNegativeCount = 0

  for scenario in corpus.scenarios {
    let run = runGolden(scenario)
    let oracle = scenario.oracle
    let codes = Set(run.result.conflicts.map(\.code.rawValue))
    let evidenceIds = Set(run.evidence.facts.map(\.id))
    let scheduled = Set(run.plan.days.flatMap { $0.stops.map(\.stop.id) })

    if !oracle.expectedStateOneOf.contains(run.result.state) {
      failures.append("\(label(scenario)): state \(run.result.state.rawValue) ∉ \(oracle.expectedStateOneOf.map(\.rawValue)) (conflicts=\(codes.sorted()))")
    }
    for required in oracle.requiredConflictCodes where !codes.contains(required.rawValue) {
      failures.append("\(label(scenario)): missing \(required.rawValue) (conflicts=\(codes.sorted()))")
    }
    for forbidden in oracle.forbiddenConflictCodes where codes.contains(forbidden.rawValue) {
      failures.append("\(label(scenario)): forbidden \(forbidden.rawValue) present")
    }
    for must in oracle.mustScheduledIds where !scheduled.contains(must) {
      failures.append("\(label(scenario)): Must stop \(must) was dropped")
    }
    // tests/golden-feasibility.test.ts:158-161 — a conflict without live evidence is not a verdict.
    for conflict in run.result.conflicts {
      if conflict.evidenceIds.isEmpty {
        failures.append("\(label(scenario)): \(conflict.code.rawValue) has no evidence")
      }
      if !conflict.evidenceIds.allSatisfy({ evidenceIds.contains($0) }) {
        failures.append("\(label(scenario)): \(conflict.code.rawValue) has dangling evidence")
      }
    }
    // tests/golden-feasibility.test.ts:162-167 — `failed` counts as unknown for this clause.
    for kind in oracle.expectedUnknownKinds ?? [] {
      let matched = run.evidence.facts.contains { fact in
        fact.kind == kind && (fact.evidence.status == .unknown || fact.evidence.status == .failed)
      }
      if !matched {
        failures.append("\(label(scenario)): expected unknown \(kind.rawValue)")
      }
    }
    // tests/golden-feasibility.test.ts:168-170
    if run.result.criticalFacts.unknown > 0 && run.result.state == .VERIFIED_FEASIBLE {
      failures.append("\(label(scenario)): unknown evidence was upgraded to verified")
    }
    // tests/golden-feasibility.test.ts:172-177
    if oracle.hardConflictExpected {
      expectedHardConflictCount += 1
      if run.result.state != .INFEASIBLE_HARD_CONFLICT {
        falseNegativeCount += 1
        failures.append("\(label(scenario)): expected hard conflict, got \(run.result.state.rawValue)")
      }
    } else if run.result.state == .INFEASIBLE_HARD_CONFLICT {
      failures.append("\(label(scenario)): repaired/non-hard scenario became hard-infeasible (conflicts=\(codes.sorted()))")
    }
    // The oracle's `solverTimedOut` is the snapshot's fact, not the searcher's: the fixture hands
    // `evidence.solverTimedOut: true` to `createPlannerEvidenceSnapshot` rather than making the
    // one-second search actually expire (`lib/feasibility-result.ts:675`). Checking the snapshot
    // proves the plumbing that turns the flag into `UNKNOWN` / `COMPUTATION_LIMIT`.
    if let timedOut = oracle.solverTimedOut, (run.evidence.solverTimedOut ?? false) != timedOut {
      failures.append("\(label(scenario)): snapshot solverTimedOut \(String(describing: run.evidence.solverTimedOut)) ≠ \(timedOut)")
    }
  }

  // tests/golden-feasibility.test.ts:180-184
  #expect(expectedHardConflictCount >= 200, "the corpus must contain a substantial positive hard-conflict set")
  #expect(falseNegativeCount == 0, "\(falseNegativeCount)/\(expectedHardConflictCount) expected hard conflicts were missed")
  let report = "\(failures.count) failures:\n" + failures.prefix(40).joined(separator: "\n")
  // Compare the count, not the array: Swift Testing expands the tested expression, and a
  // 200-entry array would bury the readable report below it.
  #expect(failures.count == 0, "\(report)")
}

/// tests/golden-feasibility.test.ts:188-208 — declared repair pairs flip hard feasibility while
/// preserving the synthetic trip identity.
@Test func declaredRepairPairsFlipHardFeasibility() throws {
  let corpus = try GoldenCorpus.load()
  var pairs: [String: [GoldenScenario]] = [:]
  for scenario in corpus.scenarios {
    guard let pairId = scenario.pairId else { continue }
    pairs[pairId, default: []].append(scenario)
  }
  #expect(pairs.count >= 190)
  var failures: [String] = []
  for (pairId, scenarios) in pairs.sorted(by: { $0.key < $1.key }) {
    guard scenarios.count == 2,
      let hard = scenarios.first(where: { $0.oracle.hardConflictExpected }),
      let repaired = scenarios.first(where: { !$0.oracle.hardConflictExpected })
    else {
      failures.append("\(pairId): expected one hard and one repaired member, got \(scenarios.map(\.id))")
      continue
    }
    if hard.trip.raw != repaired.trip.raw { failures.append("\(pairId): the repair must preserve raw input") }
    if hard.trip.context.resolvedStops != repaired.trip.context.resolvedStops {
      failures.append("\(pairId): the repair must preserve place identity")
    }
    if runGolden(hard).result.state != .INFEASIBLE_HARD_CONFLICT {
      failures.append("\(pairId): \(hard.id) was expected to be hard-infeasible")
    }
    if runGolden(repaired).result.state == .INFEASIBLE_HARD_CONFLICT {
      failures.append("\(pairId): \(repaired.id) was expected to escape hard infeasibility")
    }
  }
  let report = "\(failures.count) failures:\n" + failures.prefix(40).joined(separator: "\n")
  // Compare the count, not the array: Swift Testing expands the tested expression, and a
  // 200-entry array would bury the readable report below it.
  #expect(failures.count == 0, "\(report)")
}

/// tests/golden-feasibility.test.ts:211-213 — every scenario, built twice, byte-equal. The
/// hundred-repetition test below only covers ten representatives; this covers the other 490,
/// where a stray dictionary or set iteration order would show up first.
@Test func everyScenarioReproducesItselfExactly() throws {
  let corpus = try GoldenCorpus.load()
  var failures: [String] = []
  for scenario in corpus.scenarios where try canonicalGoldenRun(scenario) != canonicalGoldenRun(scenario) {
    failures.append("\(label(scenario)): the second build did not match the first")
  }
  let report = "\(failures.count) failures:\n" + failures.prefix(40).joined(separator: "\n")
  #expect(failures.count == 0, "\(report)")
}

/// tests/golden-feasibility.test.ts:215-223 — one representative per archetype, 100 repetitions.
@Test func eachArchetypeIsDeterministicOverAHundredRuns() throws {
  let corpus = try GoldenCorpus.load()
  var seen = Set<String>()
  for scenario in corpus.scenarios where seen.insert(scenario.archetype).inserted {
    let expected = try canonicalGoldenRun(scenario)
    for repetition in 0..<100 {
      #expect(try canonicalGoldenRun(scenario) == expected, "\(scenario.id): nondeterministic repetition \(repetition + 1)")
    }
  }
}
