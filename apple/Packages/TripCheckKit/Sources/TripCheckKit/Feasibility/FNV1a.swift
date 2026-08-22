import Foundation

/*
 * The deterministic hash that binds one verdict to one evidence set, plus the key-sorted
 * serializer it hashes.
 *
 * lib/feasibility-result.ts:207-223 (`stableStringify`, `hashEvidenceFacts`).
 */

/// TS `hashEvidenceFacts` (`lib/feasibility-result.ts:215-223`) — 32-bit FNV-1a over the UTF-16
/// code units of the key-sorted serialization, printed as `fnv1a-` + 8 lowercase hex digits.
///
/// TS runs the mixing on a JS number narrowed to *signed* 32 bits (`^=` and `Math.imul`) and only
/// widens with `>>> 0` at the end; XOR and truncating multiplication have the same bit pattern in
/// either signedness, so `UInt32` wrapping arithmetic reproduces it exactly.
public enum FNV1a {
  public static func hash32(_ string: String) -> String {
    var hash: UInt32 = 0x811c_9dc5
    for unit in string.utf16 {
      hash ^= UInt32(unit)
      hash = hash &* 0x0100_0193
    }
    let hex = String(hash, radix: 16)
    return "fnv1a-" + String(repeating: "0", count: max(0, 8 - hex.count)) + hex
  }

  /// TS `hashEvidenceFacts(facts)` (`:215-216`) — the whole entry point over a fact array.
  public static func hashEvidenceFacts(_ facts: [CriticalFact]) -> String {
    hash32(StableJSON.stringify(facts))
  }
}

/// TS `stableStringify` (`lib/feasibility-result.ts:207-212`) — `JSON.stringify` with every object's
/// keys sorted, so two runs that build the same facts in a different key order hash the same.
///
/// Hand-written rather than `JSONEncoder`-based: TS writes `JSON.stringify` semantics (JS number
/// formatting, JS string escaping, `Array.prototype.sort()`'s UTF-16 key order), and `JSONEncoder`
/// matches none of the three by contract.
///
/// **Deviation from TS, deliberate.** TS's `fact()` helper spreads an `extra` object whose optional
/// keys are often *present with an `undefined` value* (`{ fetchedAt: undefined, providerRef: … }`),
/// and `stableStringify` writes those as the literal text `undefined` — invalid JSON that only a JS
/// template literal can produce. `Evidence` cannot represent "present but undefined", so a `nil`
/// metadata field is simply omitted here, and a `nil` `value` is written as `null`. The hash is only
/// ever compared against another Swift-produced hash (it appears in no fixture and crosses no
/// engine boundary), so the difference is unobservable; the property TS relies on — same facts ⇒
/// same string ⇒ same hash — is preserved.
///
/// **Consequence for the G3 parity diff: exclude `providerSnapshotHash` from it.** Two inputs to
/// this string differ from TS by construction — the `undefined`-valued keys described above, and
/// the `dateSpecific`/`dateSpecificDates` that TS's `{ ...hoursEvidence }` spread
/// (`lib/feasibility-result.ts:441`, `:556`) drags into an `Evidence<T>` that declares neither
/// (see `EvidenceSnapshot.swift`). Every other field of a `FeasibilityResult` is expected to match
/// TS byte for byte; this one field is expected **not** to, and a diff that flags it is reading a
/// known divergence, not a bug.
enum StableJSON {
  static func stringify(_ facts: [CriticalFact]) -> String {
    "[" + facts.map(stringify(_:)).joined(separator: ",") + "]"
  }

  static func stringify(_ fact: CriticalFact) -> String {
    object([
      ("id", string(fact.id)),
      ("kind", string(fact.kind.rawValue)),
      ("label", string(fact.label)),
      ("evidence", stringify(fact.evidence)),
    ])
  }

  static func stringify(_ evidence: Evidence<JSONValue>) -> String {
    var entries: [(String, String)] = [
      ("value", stringify(evidence.value)),
      ("status", string(evidence.status.rawValue)),
      ("source", string(evidence.source.rawValue)),
    ]
    if let fetchedAt = evidence.fetchedAt { entries.append(("fetchedAt", string(fetchedAt))) }
    if let expiresAt = evidence.expiresAt { entries.append(("expiresAt", string(expiresAt))) }
    if let providerRef = evidence.providerRef { entries.append(("providerRef", string(providerRef))) }
    if let explanation = evidence.explanation { entries.append(("explanation", string(explanation))) }
    return object(entries)
  }

  static func stringify(_ value: JSONValue?) -> String {
    guard let value else { return "null" }
    switch value {
    case .null: return "null"
    case .bool(let flag): return flag ? "true" : "false"
    case .string(let text): return string(text)
    case .number(let number): return self.number(number)
    case .array(let items): return "[" + items.map { stringify($0) }.joined(separator: ",") + "]"
    case .object(let fields): return object(fields.map { ($0.key, stringify($0.value)) })
    }
  }

  /// `Object.keys(object).sort()` — JS's default sort is UTF-16 code-unit order on the keys.
  private static func object(_ entries: [(String, String)]) -> String {
    let sorted = stableSorted(entries) { jsStringLess($0.0, $1.0) }
    return "{" + sorted.map { "\(string($0.0)):\($0.1)" }.joined(separator: ",") + "}"
  }

  /// `JSON.stringify` of a number: `NaN`/`±Infinity` serialize as `null`, and an integral value
  /// never grows a `.0` (JS has one number type, so `JSON.stringify(1.0) === "1"`). Only integers
  /// and `null` reach this engine's fact values — durations, minute counts, transfer counts — so
  /// the fractional branch exists for completeness, using Swift's shortest round-tripping form.
  private static func number(_ value: Double) -> String {
    guard value.isFinite else { return "null" }
    if value == value.rounded(.towardZero), abs(value) < 1e21, let exact = Int64(exactly: value.rounded()) {
      return String(exact)
    }
    return "\(value)"
  }

  /// `JSON.stringify` of a string.
  private static func string(_ value: String) -> String {
    var result = "\""
    for scalar in value.unicodeScalars {
      switch scalar {
      case "\"": result += "\\\""
      case "\\": result += "\\\\"
      case "\u{08}": result += "\\b"
      case "\u{0C}": result += "\\f"
      case "\n": result += "\\n"
      case "\r": result += "\\r"
      case "\t": result += "\\t"
      default:
        if scalar.value < 0x20 {
          result += String(format: "\\u%04x", scalar.value)
        } else {
          result.unicodeScalars.append(scalar)
        }
      }
    }
    return result + "\""
  }
}
