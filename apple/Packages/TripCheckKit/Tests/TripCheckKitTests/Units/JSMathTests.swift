import Foundation
import Testing
@testable import TripCheckKit

/*
 * `JSMath` claims to be V8's `Math.cos`, `Math.sin` and `Math.asin` — not an approximation of them,
 * the same doubles. These tests hold it to that, against a table V8 itself wrote
 * (`scripts/export-js-math-vectors.mjs`, run under the Node whose V8 revision the port names).
 *
 * Regenerate after changing the builder corpus (the edge table is derived from it):
 *
 *   node --experimental-strip-types scripts/export-js-math-vectors.mjs \
 *     --out apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/js-math-vectors.v1.json \
 *     apple/Packages/TripCheckKit/Tests/TripCheckKitTests/Fixtures/builder-scenarios.v1.json
 */

struct JSMathVectors: Decodable {
  var schemaVersion: Int
  var generatedFrom: String
  var v8Version: String
  var nodeVersion: String
  var groups: Groups

  struct Group: Decodable {
    var format: String
    var entries: [String]
  }

  struct Groups: Decodable {
    var latitudeRadians: Group
    var smallSin: Group
    var asin: Group
    var corpusEdges: Group
  }

  enum LoadError: Error { case missingFixture }

  static func load() throws -> JSMathVectors {
    guard let url = Bundle.module.url(forResource: "js-math-vectors.v1", withExtension: "json", subdirectory: "Fixtures") else {
      throw LoadError.missingFixture
    }
    return try JSONDecoder().decode(JSMathVectors.self, from: Data(contentsOf: url))
  }
}

/// The fixture stores doubles as the hex of their bit pattern, which is the only encoding that
/// survives a round trip without a decimal-formatting argument in the middle.
private func double(_ hex: Substring) -> Double? {
  guard let bits = UInt64(hex, radix: 16) else { return nil }
  return Double(bitPattern: bits)
}

private func hex(_ value: Double) -> String {
  String(value.bitPattern, radix: 16)
}

/// Collected rather than asserted one by one: 85,000 `#expect`s take minutes and bury the first
/// real failure under the rest.
private func report(_ failures: [String], of total: Int, what: String) -> String {
  "\(failures.count)/\(total) \(what) differ from V8:\n" + failures.prefix(20).joined(separator: "\n")
}

@Test func jsMathMatchesV8OnEveryLatitudeInBothBands() throws {
  let vectors = try JSMathVectors.load()
  #expect(vectors.schemaVersion == 1)
  #expect(vectors.v8Version.hasPrefix("12.4.254.21"), "the port names V8 12.4.254.21; the table came from \(vectors.v8Version)")
  let entries = vectors.groups.latitudeRadians.entries
  #expect(entries.count == 45002)

  var failures: [String] = []
  for entry in entries {
    let fields = entry.split(separator: " ")
    guard fields.count == 3,
      let radians = double(fields[0]),
      let expectedCos = double(fields[1]),
      let expectedSin = double(fields[2])
    else {
      failures.append("malformed entry: \(entry)")
      continue
    }
    let actualCos = JSMath.cos(radians)
    if actualCos.bitPattern != expectedCos.bitPattern {
      failures.append("cos(\(radians)): V8 \(hex(expectedCos)) ≠ Swift \(hex(actualCos))")
    }
    let actualSin = JSMath.sin(radians)
    if actualSin.bitPattern != expectedSin.bitPattern {
      failures.append("sin(\(radians)): V8 \(hex(expectedSin)) ≠ Swift \(hex(actualSin))")
    }
  }
  #expect(failures.count == 0, "\(report(failures, of: entries.count * 2, what: "latitude cos/sin values"))")
}

/// The half-deltas the haversine actually feeds `sin`: two stops up to 400 km apart never exceed
/// 0.035 rad, so this is the range that decides a leg.
@Test func jsMathMatchesV8OnTheHaversineHalfDeltaRange() throws {
  let vectors = try JSMathVectors.load()
  let entries = vectors.groups.smallSin.entries
  #expect(entries.count == 20001)

  var failures: [String] = []
  for entry in entries {
    let fields = entry.split(separator: " ")
    guard fields.count == 2, let x = double(fields[0]), let expected = double(fields[1]) else {
      failures.append("malformed entry: \(entry)")
      continue
    }
    let actual = JSMath.sin(x)
    if actual.bitPattern != expected.bitPattern {
      failures.append("sin(\(x)): V8 \(hex(expected)) ≠ Swift \(hex(actual))")
    }
  }
  #expect(failures.count == 0, "\(report(failures, of: entries.count, what: "small-argument sines"))")
}

@Test func jsMathMatchesV8AcrossTheWholeArcsineDomain() throws {
  let vectors = try JSMathVectors.load()
  let entries = vectors.groups.asin.entries
  #expect(entries.count == 20001)

  var failures: [String] = []
  for entry in entries {
    let fields = entry.split(separator: " ")
    guard fields.count == 2, let x = double(fields[0]), let expected = double(fields[1]) else {
      failures.append("malformed entry: \(entry)")
      continue
    }
    let actual = JSMath.asin(x)
    if actual.bitPattern != expected.bitPattern {
      failures.append("asin(\(x)): V8 \(hex(expected)) ≠ Swift \(hex(actual))")
    }
  }
  #expect(failures.count == 0, "\(report(failures, of: entries.count, what: "arcsines"))")
}

/// The claim that matters to the planner: every straight-line distance the builder corpus can ask
/// for — every ordered pair of stop, base and airport coordinates in it — comes out of this engine
/// with the same bits the web engine produces. The route optimiser's strict `<` between a path and
/// its reverse is decided by exactly these numbers, so one differing edge is one day that can come
/// out backwards.
@Test func everyCorpusEdgeMatchesTheWebEngineBitForBit() throws {
  let vectors = try JSMathVectors.load()
  let entries = vectors.groups.corpusEdges.entries
  #expect(entries.count > 600, "the edge table should cover every ordered pair in the corpus")

  var failures: [String] = []
  for entry in entries {
    let fields = entry.split(separator: " ")
    guard fields.count == 5,
      let fromLatitude = Double(fields[0]),
      let fromLongitude = Double(fields[1]),
      let toLatitude = Double(fields[2]),
      let toLongitude = Double(fields[3]),
      let expected = double(fields[4])
    else {
      failures.append("malformed entry: \(entry)")
      continue
    }
    let actual = straightLineDistanceKm(
      GeoPoint(latitude: fromLatitude, longitude: fromLongitude),
      GeoPoint(latitude: toLatitude, longitude: toLongitude)
    )
    if actual.bitPattern != expected.bitPattern {
      failures.append(
        "(\(fromLatitude),\(fromLongitude)) → (\(toLatitude),\(toLongitude)): "
        + "V8 \(hex(expected)) (\(expected)) ≠ Swift \(hex(actual)) (\(actual))"
      )
    }
  }
  #expect(failures.count == 0, "\(report(failures, of: entries.count, what: "corpus edges"))")
}

/// `Math.asin` of anything above 1 is NaN, and `straightLineDistanceKm` passes `√h` straight
/// through. Clamping would be a kindness the TypeScript engine does not extend.
@Test func arcsineAboveOneIsNotANumber() {
  #expect(JSMath.asin(1.0000001).isNaN)
  #expect(JSMath.asin(2).isNaN)
  #expect(JSMath.asin(1) == Double.pi / 2)
  #expect(JSMath.asin(-1) == -Double.pi / 2)
}
