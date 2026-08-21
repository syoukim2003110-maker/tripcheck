import Foundation

/// lib/trip-builder.ts:349-360 — `clock(minutes)` / `clockMinutes(value)`
public struct ClockTime: Hashable, Sendable, Comparable, CustomStringConvertible, Codable {
  public var minutes: Int

  /// TS `clock(minutes)`: `((minutes % 1440) + 1440) % 1440` — 翌日跨ぎは 1440 で畳む
  public init(minutes: Int) { self.minutes = ((minutes % 1440) + 1440) % 1440 }

  /// TS `clockMinutes(value)`: `/^(\d{1,2}):(\d{2})$/`、時 0–23・分 0–59 以外は nil
  public init?(_ text: String) {
    let parts = text.split(separator: ":", omittingEmptySubsequences: false)
    guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]),
          parts[0].count <= 2, parts[1].count == 2, (0...23).contains(h), (0...59).contains(m) else { return nil }
    minutes = h * 60 + m
  }

  public var description: String { String(format: "%02d:%02d", minutes / 60, minutes % 60) }

  public static func < (l: Self, r: Self) -> Bool { l.minutes < r.minutes }

  public init(from decoder: Decoder) throws {
    let s = try decoder.singleValueContainer().decode(String.self)
    guard let v = ClockTime(s) else {
      throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "bad clock \(s)"))
    }
    self = v
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    try c.encode(description)
  }
}
