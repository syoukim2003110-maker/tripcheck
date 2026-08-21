import Foundation
import Testing
@testable import TripCheckKit

/// Code review fix (round 1): `IntKeyedDictionary.init(from:)` used to rely on
/// `container.allKeys`, which is built by calling the `CodingKey`'s `init?(stringValue:)` for
/// every JSON key and silently dropping the ones where that initializer returned `nil` — so a
/// non-integer key (`"abc"`, `""`, `"1.5"`) vanished instead of failing. These tests pin the fixed
/// behaviour: every key is inspected, and a key that isn't `-?[0-9]+` throws `DecodingError`
/// rather than being dropped.

@Test func intKeyedDictionaryRejectsNonIntegerKeys() {
  let data = Data(#"{"0":"a","abc":"b"}"#.utf8)
  #expect(throws: (any Error).self) {
    _ = try JSONDecoder().decode(IntKeyedDictionary<String>.self, from: data)
  }
}

@Test func intKeyedDictionaryRejectsFractionalKeys() {
  let data = Data(#"{"1.5":"x"}"#.utf8)
  #expect(throws: (any Error).self) {
    _ = try JSONDecoder().decode(IntKeyedDictionary<String>.self, from: data)
  }
}

@Test func intKeyedDictionaryRejectsEmptyKey() {
  let data = Data(#"{"":"x"}"#.utf8)
  #expect(throws: (any Error).self) {
    _ = try JSONDecoder().decode(IntKeyedDictionary<String>.self, from: data)
  }
}

@Test func intKeyedDictionaryRejectsLeadingPlusKey() {
  let data = Data(#"{"+1":"x"}"#.utf8)
  #expect(throws: (any Error).self) {
    _ = try JSONDecoder().decode(IntKeyedDictionary<String>.self, from: data)
  }
}

@Test func intKeyedDictionaryAcceptsNegativeKeys() throws {
  let data = Data(#"{"-1":"x"}"#.utf8)
  let decoded = try JSONDecoder().decode(IntKeyedDictionary<String>.self, from: data)
  #expect(decoded.values == [-1: "x"])
}

@Test func intKeyedDictionaryDecodesAllValidKeys() throws {
  let data = Data(#"{"0":"a","2":"c"}"#.utf8)
  let decoded = try JSONDecoder().decode(IntKeyedDictionary<String>.self, from: data)
  #expect(decoded.values == [0: "a", 2: "c"])
}

@Test func intKeyedDictionaryDecodesExplicitNullForOptionalValue() throws {
  let data = Data(#"{"1":null}"#.utf8)
  let decoded = try JSONDecoder().decode(IntKeyedDictionary<String?>.self, from: data)
  #expect(decoded.values == [1: nil])
}

@Test func intKeyedDictionaryRoundTripsThroughJSON() throws {
  let original = IntKeyedDictionary<String>([0: "a", -1: "b", 42: "c"])
  let data = try JSONEncoder().encode(original)
  let back = try JSONDecoder().decode(IntKeyedDictionary<String>.self, from: data)
  #expect(back == original)
}
