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
  private struct IntCodingKey: CodingKey {
    let intValue: Int?
    let stringValue: String

    init?(stringValue: String) {
      guard let intValue = Int(stringValue) else { return nil }
      self.intValue = intValue
      self.stringValue = stringValue
    }

    init?(intValue: Int) {
      self.intValue = intValue
      self.stringValue = String(intValue)
    }
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: IntCodingKey.self)
    var result: [Int: Value] = [:]
    for key in container.allKeys {
      result[key.intValue!] = try container.decode(Value.self, forKey: key)
    }
    self.values = result
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: IntCodingKey.self)
    for (key, value) in values {
      try container.encode(value, forKey: IntCodingKey(intValue: key)!)
    }
  }
}
