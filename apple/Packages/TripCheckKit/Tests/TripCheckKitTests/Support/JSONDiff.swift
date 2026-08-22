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
  /// Every field where `expected` (the TypeScript snapshot) and `actual` (this engine) disagree,
  /// deepest-first within each container, in the order the containers are walked.
  ///
  /// `ignoring` holds paths that are known to differ and are recorded in the design spec's
  /// 付録 A. An entry matches a path when it equals it, when it is a `.`/`[`-delimited prefix of
  /// it, or when it equals the path with every array index collapsed to `[]` — so
  /// `plan.days[].stops[].stop.input` names one field across all array positions without
  /// swallowing its siblings, which a subtree-wide `plan.days` would.
  static func paths(expected: JSONValue, actual: JSONValue, ignoring: [String] = []) -> [String] {
    var diffs: [String] = []
    let ignored = Set(ignoring)
    walk(expected: expected, actual: actual, path: "", ignored: ignored, into: &diffs)
    return diffs
  }

  private static let numberTolerance = 1e-9

  private static func isIgnored(_ path: String, _ ignored: Set<String>) -> Bool {
    if ignored.isEmpty { return false }
    for candidate in [path, normalize(path)] {
      if ignored.contains(candidate) { return true }
      for prefix in ignored where candidate.hasPrefix(prefix) {
        let rest = candidate.dropFirst(prefix.count)
        if rest.first == "." || rest.first == "[" { return true }
      }
    }
    return false
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
    into diffs: inout [String]
  ) {
    if isIgnored(path, ignored) { return }

    switch (expected, actual) {
    case (.object(let lhs), .object(let rhs)):
      for key in Set(lhs.keys).union(rhs.keys).sorted() {
        walk(
          expected: member(lhs, key),
          actual: member(rhs, key),
          path: child(path, key: key),
          ignored: ignored,
          into: &diffs
        )
      }

    case (.array(let lhs), .array(let rhs)):
      if lhs.count != rhs.count {
        diffs.append("\(path): array length TS \(lhs.count) ≠ Swift \(rhs.count)")
      }
      for index in 0..<min(lhs.count, rhs.count) {
        walk(
          expected: lhs[index],
          actual: rhs[index],
          path: "\(path)[\(index)]",
          ignored: ignored,
          into: &diffs
        )
      }

    case (.number(let lhs), .number(let rhs)):
      if !(abs(lhs - rhs) < numberTolerance) {
        diffs.append("\(path): TS \(describe(expected)) ≠ Swift \(describe(actual))")
      }

    case (.string(let lhs), .string(let rhs)):
      if lhs != rhs { diffs.append("\(path): TS \(describe(expected)) ≠ Swift \(describe(actual))") }

    case (.bool(let lhs), .bool(let rhs)):
      if lhs != rhs { diffs.append("\(path): TS \(describe(expected)) ≠ Swift \(describe(actual))") }

    case (.null, .null):
      break

    default:
      diffs.append("\(path): TS \(describe(expected)) ≠ Swift \(describe(actual))")
    }
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
