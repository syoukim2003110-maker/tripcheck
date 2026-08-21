import Testing
@testable import TripCheckKit

/// Synthetic parser regression corpus; not real-world accuracy evidence.
///
/// tests/wishlist-parser-corpus.test.ts — thresholds and aggregation (the multiset
/// `overlapCount` logic, per-fixture heading false-positive assertion) are ported verbatim;
/// only the reporting mechanism (Swift Testing `#expect` vs. Node `assert`) differs.

private let corpusSize = 500

/// tests/wishlist-parser-corpus.test.ts:12-14 — `normalizedName`
private func normalizedName(_ value: String) -> String {
  value.precomposedStringWithCompatibilityMapping
    .lowercased()
    .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    .trimmingCharacters(in: .whitespacesAndNewlines)
}

/// tests/wishlist-parser-corpus.test.ts:16-19 — `multiset`
private func multiset(_ values: [String]) -> [String: Int] {
  var counts: [String: Int] = [:]
  for value in values { counts[value, default: 0] += 1 }
  return counts
}

private struct OverlapCounts { var truePositive: Int; var falsePositive: Int; var falseNegative: Int }

/// tests/wishlist-parser-corpus.test.ts:21-29 — `overlapCount`
private func overlapCount(_ expected: [String], _ actual: [String]) -> OverlapCounts {
  let expectedCounts = multiset(expected)
  let actualCounts = multiset(actual)
  var truePositive = 0
  for (value, count) in expectedCounts { truePositive += min(count, actualCounts[value] ?? 0) }
  return OverlapCounts(truePositive: truePositive, falsePositive: actual.count - truePositive, falseNegative: expected.count - truePositive)
}

/// tests/wishlist-parser-corpus.test.ts:31-33 — `ratio`
private func ratio(_ numerator: Int, _ denominator: Int) -> Double {
  denominator == 0 ? 1 : Double(numerator) / Double(denominator)
}

private func ratio(_ numerator: Double, _ denominator: Double) -> Double {
  denominator == 0 ? 1 : numerator / denominator
}

/// tests/wishlist-parser-corpus.test.ts:52-105 — "500-case synthetic corpus meets INP-001/002/003 regression thresholds"
@Test func syntheticCorpusMeetsRegressionThresholds() {
  let corpus = ParserCorpusGenerator.generate(corpusSize)
  #expect(corpus.count == corpusSize)
  #expect(Set(corpus.map(\.id)).count == corpusSize)
  #expect(ParserCorpusGenerator.generate(corpusSize) == corpus, "corpus generation must be deterministic")

  var candidateTruePositive = 0
  var candidateFalsePositive = 0
  var candidateFalseNegative = 0
  var markerCorrect = 0
  var markerTotal = 0
  var headingCorrect = 0
  var headingTotal = 0
  var dayCorrect = 0
  var dayTotal = 0

  for fixture in corpus {
    let parsed = WishlistParser.parse(fixture.input)
    let actualPlaces: [ParsedWishlistPlace] = parsed.flatMap { line -> [ParsedWishlistPlace] in
      if case .place(_, let places) = line { return places }
      return []
    }
    let expectedNames = fixture.expectedPlaces.map { normalizedName($0.name) }
    let actualNames = actualPlaces.map { normalizedName($0.name) }
    let candidateCounts = overlapCount(expectedNames, actualNames)
    candidateTruePositive += candidateCounts.truePositive
    candidateFalsePositive += candidateCounts.falsePositive
    candidateFalseNegative += candidateCounts.falseNegative

    // TS builds `new Map(...)`, where a later entry overwrites an earlier one for
    // the same key; reproduce with a plain last-write-wins dictionary fill.
    var actualByName: [String: ParsedWishlistPlace] = [:]
    for place in actualPlaces { actualByName[normalizedName(place.name)] = place }

    for expectedPlace in fixture.expectedPlaces {
      let actual = actualByName[normalizedName(expectedPlace.name)]
      if let priority = expectedPlace.priority {
        markerTotal += 1
        if actual?.priority == priority { markerCorrect += 1 }
      }
      if let isReservation = expectedPlace.isReservation {
        markerTotal += 1
        if actual?.isReservation == isReservation { markerCorrect += 1 }
      }
      if let time = expectedPlace.time {
        markerTotal += 1
        if actual?.time == time { markerCorrect += 1 }
      }
      if let stayMinutes = expectedPlace.stayMinutes {
        markerTotal += 1
        if actual?.stayMinutes == stayMinutes { markerCorrect += 1 }
      }
      if let day = expectedPlace.day {
        dayTotal += 1
        if actual?.day == day { dayCorrect += 1 }
      }
    }

    let actualHeadings = parsed.compactMap { line -> Int? in
      if case .heading(_, let day) = line { return day }
      return nil
    }
    let headingCounts = overlapCount(fixture.expectedHeadings.map(String.init), actualHeadings.map(String.init))
    headingCorrect += headingCounts.truePositive
    headingTotal += fixture.expectedHeadings.count
    #expect(headingCounts.falsePositive == 0, "\(fixture.id) created an unexpected heading")
  }

  let precision = ratio(candidateTruePositive, candidateTruePositive + candidateFalsePositive)
  let recall = ratio(candidateTruePositive, candidateTruePositive + candidateFalseNegative)
  let f1 = ratio(2 * precision * recall, precision + recall)
  let explicitMarkerRecall = ratio(markerCorrect, markerTotal)
  let headingRecall = ratio(headingCorrect, headingTotal)
  let dayAssignmentRecall = ratio(dayCorrect, dayTotal)

  #expect(f1 >= 0.97, "synthetic candidate-splitting F1 \(f1) is below 0.97")
  #expect(recall >= 0.99, "synthetic candidate-splitting recall \(recall) is below 0.99")
  #expect(explicitMarkerRecall >= 0.99, "synthetic explicit-marker recall \(explicitMarkerRecall) is below 0.99")
  #expect(headingRecall >= 0.99, "synthetic heading recall \(headingRecall) is below 0.99")
  #expect(dayAssignmentRecall >= 0.99, "synthetic day-assignment recall \(dayAssignmentRecall) is below 0.99")
}

/// tests/wishlist-parser-corpus.test.ts:107-124 — "synthetic per-case parser latency p95 remains below 200ms"
@Test func parserP95Under200ms() {
  let corpus = ParserCorpusGenerator.generate(corpusSize)

  // Deterministic warmup keeps one-time JIT/module work out of the per-case
  // regression number. The 200ms gate is intentionally generous for CI hosts.
  for _ in 0..<4 {
    for fixture in corpus { _ = WishlistParser.parse(fixture.input) }
  }

  let clock = ContinuousClock()
  var millisecondSamples: [Double] = []
  for fixture in corpus {
    let elapsed = clock.measure { _ = WishlistParser.parse(fixture.input) }
    let ms = Double(elapsed.components.seconds) * 1000 + Double(elapsed.components.attoseconds) / 1e15
    millisecondSamples.append(ms)
  }
  millisecondSamples.sort()
  let p95Index = Int((Double(millisecondSamples.count) * 0.95).rounded(.up)) - 1
  let p95 = millisecondSamples[max(0, p95Index)]
  #expect(p95 < 200, "synthetic parser latency p95 \(p95)ms is not below 200ms")
}
