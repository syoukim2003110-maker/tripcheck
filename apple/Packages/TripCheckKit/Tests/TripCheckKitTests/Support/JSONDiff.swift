import Foundation
@testable import TripCheckKit

/// A recursive field-by-field comparison of two JSON trees, reporting `a.b[2].c`-shaped paths
/// rather than "the two blobs differ" — G3's whole point is naming *which* field the Swift port
/// disagrees with the TypeScript engine about.
///
/// Three deliberate equalities, all of them consequences of how the two sides serialize:
///
/// - **Absent == null.** Swift's synthesized `Codable` writes an unset `Optional` by omitting the
///   key; TS's `JSON.stringify` omits `undefined`-valued keys but writes `null` for a field the
///   engine set to `null` on purpose. Both are "nothing is here", so a missing key and an explicit
///   `null` compare equal in either direction. (`Evidence.value`, which TS types as `T | null` and
///   Swift encodes with an explicit `encodeNil`, is the same "nothing" under this rule too.)
/// - **Numbers within 1e-9.** JavaScript has one number type and Swift has several; the two sides
///   print the same `Double` slightly differently often enough that exact string equality would
///   report noise. 1e-9 is far below any minute, kilometre or coordinate this engine computes and
///   far above `Double` round-tripping error.
/// - **Nothing else.** String, bool, array order and array length are compared exactly.
enum JSONDiff {
  /// One disagreement: the field's path and a one-line rendering of the two values. Kept as a pair
  /// rather than a formatted string so callers can group by path without parsing it back out —
  /// a route-leg key such as `tk-a::tk-b` appears inside real paths, and splitting on `:` cut them
  /// in half.
  struct Difference {
    var path: String
    var detail: String
  }

  /// The diff plus the bookkeeping needed to keep the `ignoring` list honest.
  struct Report {
    var differences: [Difference]
    /// The `ignoring` entries that actually suppressed a disagreement on this run. An entry absent
    /// from this set earned nothing and should be deleted or given a scenario that needs it.
    var ignoresThatSuppressedSomething: Set<String>
  }

  /// Every field where `expected` (the TypeScript snapshot) and `actual` (this engine) disagree,
  /// deepest-first within each container, in the order the containers are walked.
  ///
  /// `ignoring` holds paths that are known to differ and are recorded in the design spec's
  /// 付録 A. An entry matches a path when it equals it, when it is a `.`/`[`-delimited prefix of
  /// it, or when it equals the path with every array index collapsed to `[]` — so
  /// `plan.days[].stops[].stop.input` names one field across all array positions without
  /// swallowing its siblings, which a subtree-wide `plan.days` would.
  static func compare(expected: JSONValue, actual: JSONValue, ignoring: [String] = []) -> Report {
    var report = Report(differences: [], ignoresThatSuppressedSomething: [])
    walk(expected: expected, actual: actual, path: "", ignored: Set(ignoring), into: &report)
    return report
  }

  /// The formatted form, for callers that only want to read the list.
  static func paths(expected: JSONValue, actual: JSONValue, ignoring: [String] = []) -> [String] {
    compare(expected: expected, actual: actual, ignoring: ignoring)
      .differences.map { "\($0.path): \($0.detail)" }
  }

  private static let numberTolerance = 1e-9

  /// The `ignoring` entry covering `path`, or `nil` when the path is not excluded.
  private static func ignoreEntry(for path: String, in ignored: Set<String>) -> String? {
    if ignored.isEmpty { return nil }
    for candidate in [path, normalize(path)] {
      if ignored.contains(candidate) { return candidate }
      for prefix in ignored where candidate.hasPrefix(prefix) {
        let rest = candidate.dropFirst(prefix.count)
        if rest.first == "." || rest.first == "[" { return prefix }
      }
    }
    return nil
  }

  /// Whether two trees disagree at all, under the same equalities `walk` applies but with nothing
  /// excluded. Used only to decide whether an `ignoring` entry earned its place on this run.
  private static func differs(_ expected: JSONValue, _ actual: JSONValue) -> Bool {
    switch (expected, actual) {
    case (.object(let lhs), .object(let rhs)):
      return Set(lhs.keys).union(rhs.keys).contains { differs(member(lhs, $0), member(rhs, $0)) }
    case (.array(let lhs), .array(let rhs)):
      if lhs.count != rhs.count { return true }
      return zip(lhs, rhs).contains { differs($0, $1) }
    case (.number(let lhs), .number(let rhs)): return !(abs(lhs - rhs) < numberTolerance)
    case (.string(let lhs), .string(let rhs)): return lhs != rhs
    case (.bool(let lhs), .bool(let rhs)): return lhs != rhs
    case (.null, .null): return false
    default: return true
    }
  }

  /// `plan.days[3].stops[0].stop.input` -> `plan.days[].stops[].stop.input`.
  static func normalize(_ path: String) -> String {
    var out = ""
    var index = path.startIndex
    while index < path.endIndex {
      let character = path[index]
      if character == "[" {
        guard let close = path[index...].firstIndex(of: "]") else {
          out.append(contentsOf: path[index...])
          break
        }
        out += "[]"
        index = path.index(after: close)
        continue
      }
      out.append(character)
      index = path.index(after: index)
    }
    return out
  }

  private static func child(_ path: String, key: String) -> String {
    path.isEmpty ? key : "\(path).\(key)"
  }

  /// Missing keys are read as `null` so that an absent key and an explicit `null` are the same
  /// nothing on both sides (see the type comment).
  private static func member(_ object: [String: JSONValue], _ key: String) -> JSONValue {
    object[key] ?? .null
  }

  private static func walk(
    expected: JSONValue,
    actual: JSONValue,
    path: String,
    ignored: Set<String>,
    into report: inout Report
  ) {
    if let entry = ignoreEntry(for: path, in: ignored) {
      if differs(expected, actual) { report.ignoresThatSuppressedSomething.insert(entry) }
      return
    }

    switch (expected, actual) {
    case (.object(let lhs), .object(let rhs)):
      for key in Set(lhs.keys).union(rhs.keys).sorted() {
        walk(
          expected: member(lhs, key),
          actual: member(rhs, key),
          path: child(path, key: key),
          ignored: ignored,
          into: &report
        )
      }

    case (.array(let lhs), .array(let rhs)):
      if lhs.count != rhs.count {
        report.differences.append(.init(path: path, detail: "array length TS \(lhs.count) ≠ Swift \(rhs.count)"))
      }
      for index in 0..<min(lhs.count, rhs.count) {
        walk(
          expected: lhs[index],
          actual: rhs[index],
          path: "\(path)[\(index)]",
          ignored: ignored,
          into: &report
        )
      }

    case (.number(let lhs), .number(let rhs)):
      if !(abs(lhs - rhs) < numberTolerance) { record(expected, actual, path, &report) }

    case (.string(let lhs), .string(let rhs)):
      if lhs != rhs { record(expected, actual, path, &report) }

    case (.bool(let lhs), .bool(let rhs)):
      if lhs != rhs { record(expected, actual, path, &report) }

    case (.null, .null):
      break

    default:
      record(expected, actual, path, &report)
    }
  }

  private static func record(_ expected: JSONValue, _ actual: JSONValue, _ path: String, _ report: inout Report) {
    report.differences.append(.init(path: path, detail: "TS \(describe(expected)) ≠ Swift \(describe(actual))"))
  }

  /// One short line per value — a whole subtree printed inline would bury the path that names it.
  private static func describe(_ value: JSONValue) -> String {
    switch value {
    case .null: return "absent/null"
    case .bool(let bool): return "\(bool)"
    case .number(let number):
      return number == number.rounded() && abs(number) < 1e15
        ? "\(Int(number))"
        : "\(number)"
    case .string(let string): return "\"\(string)\""
    case .array(let array): return "array(\(array.count))"
    case .object(let object): return "object{\(object.keys.sorted().prefix(6).joined(separator: ","))}"
    }
  }
}

extension JSONValue {
  /// Re-reads an `Encodable` Swift value as a plain JSON tree, so the port's output and the
  /// TypeScript export can be walked by the same code. `.sortedKeys` is irrelevant to the tree
  /// itself but keeps the intermediate bytes stable if a failure ever needs dumping.
  static func encoding<T: Encodable>(_ value: T) throws -> JSONValue {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(value)
    // Round-tripping through `JSONSerialization` first matches how the TypeScript side arrives
    // (parsed JSON, no Swift type information left) and rejects anything `JSONEncoder` produced
    // that is not a legal JSON document.
    _ = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    return try JSONDecoder().decode(JSONValue.self, from: data)
  }
}
