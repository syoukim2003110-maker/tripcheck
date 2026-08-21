import Foundation

/// TS `Record<number, X>` serializes as a JSON object with string keys (e.g. `{"0": ...}`), never
/// an array. Swift's default `Dictionary<Int, X>: Codable` conformance instead encodes as a flat
/// `[key0, value0, key1, value1, ...]` array, so a field typed `[Int: X]` would silently produce
/// the wrong wire shape. This wrapper restores the TS object shape: a keyed container whose keys
/// are `Int`-parsed strings, used for `dayStartTimes`, `dayEndTimes`, `lockedOrderByDay`,
/// `nightBases`, and the inner dictionary of `openingWindowsByDay` (`lib/trip-builder.ts:186-243`).
public struct IntKeyedDictionary<Value: Codable & Equatable & Sendable>: Equatable, Sendable {
  public var values: [Int: Value]

  public init(_ values: [Int: Value] = [:]) {
    self.values = values
  }

  public subscript(key: Int) -> Value? {
    get { values[key] }
    set { values[key] = newValue }
  }
}

extension IntKeyedDictionary: ExpressibleByDictionaryLiteral {
  public init(dictionaryLiteral elements: (Int, Value)...) {
    self.values = Dictionary(uniqueKeysWithValues: elements)
  }
}

extension IntKeyedDictionary: Codable {
  /// Accepts *every* string as a key — unlike a `CodingKey` whose `init?(stringValue:)` returns
  /// `nil` for non-integer input, which would make `allKeys` silently drop those keys rather than
  /// report them. `init(from:)` below does the actual integer validation itself, so a malformed
  /// key throws instead of vanishing.
  private struct AnyStringKey: CodingKey {
    let stringValue: String
    let intValue: Int?

    init(stringValue: String) {
      self.stringValue = stringValue
      self.intValue = Int(stringValue)
    }

    init?(intValue: Int) {
      self.stringValue = String(intValue)
      self.intValue = intValue
    }
  }

  private static func isAsciiDigit(_ c: Character) -> Bool { c.isASCII && c.isNumber }

  /// TS `Record<number, X>` keys are always `String(someInteger)` — ASCII digits with an optional
  /// leading `-`, nothing else. `Int(_:)` alone is too permissive (it also accepts a leading `+`
  /// and other locale-ish forms), so validate digit-by-digit first, the same approach
  /// `ClockTime`/`CalendarDate` already use for the same reason.
  private static func strictInt(_ value: String) -> Int? {
    let digits = value.hasPrefix("-") ? value.dropFirst() : Substring(value)
    guard !digits.isEmpty, digits.allSatisfy(isAsciiDigit) else { return nil }
    return Int(value)
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: AnyStringKey.self)
    var result: [Int: Value] = [:]
    for key in container.allKeys {
      guard let intKey = Self.strictInt(key.stringValue) else {
        throw DecodingError.dataCorrupted(
          .init(codingPath: container.codingPath + [key], debugDescription: "non-integer key \"\(key.stringValue)\"")
        )
      }
      result[intKey] = try container.decode(Value.self, forKey: key)
    }
    self.values = result
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: AnyStringKey.self)
    for (key, value) in values {
      try container.encode(value, forKey: AnyStringKey(intValue: key)!)
    }
  }
}
