import Foundation

/// lib/planner-app-state.ts:190-200 (`addCalendarDays`) — 1970-01-01 からの日数(epochDay)を基準に、
/// JS の `Date.UTC` と同じ算術を行う。文字列表現は "YYYY-MM-DD"。
public struct CalendarDate: Hashable, Sendable, Comparable, CustomStringConvertible, Codable {
  public var year: Int
  public var month: Int
  public var day: Int

  public init?(year: Int, month: Int, day: Int) {
    guard (1...12).contains(month), day >= 1, day <= CalendarDate.daysIn(month: month, year: year) else { return nil }
    self.year = year
    self.month = month
    self.day = day
  }

  /// "YYYY-MM-DD" のみ(TS `addDaysToIsoDate` の `/^\d{4}-\d{2}-\d{2}$/`。`\d` は ASCII の 0–9 のみ、
  /// "+"/"-" つきの `Int(_:)` 成功を弾く)
  public init?(_ text: String) {
    let p = text.split(separator: "-")
    guard p.count == 3, p[0].count == 4, p[1].count == 2, p[2].count == 2,
          p[0].allSatisfy(Self.isAsciiDigit), p[1].allSatisfy(Self.isAsciiDigit), p[2].allSatisfy(Self.isAsciiDigit),
          let y = Int(p[0]), let m = Int(p[1]), let d = Int(p[2]) else { return nil }
    self.init(year: y, month: m, day: d)
  }

  private static func isAsciiDigit(_ c: Character) -> Bool { c.isASCII && c.isNumber }

  static func isLeap(_ y: Int) -> Bool { (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 }

  static func daysIn(month: Int, year: Int) -> Int {
    [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  }

  /// 1970-01-01 = 0(Howard Hinnant の days_from_civil)
  public var epochDay: Int {
    let y = month <= 2 ? year - 1 : year
    let era = (y >= 0 ? y : y - 399) / 400
    let yoe = y - era * 400
    let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
    return era * 146097 + doe - 719468
  }

  /// civil_from_days
  public init(epochDay z0: Int) {
    let z = z0 + 719468
    let era = (z >= 0 ? z : z - 146096) / 146097
    let doe = z - era * 146097
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
    let y = yoe + era * 400
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
    let mp = (5 * doy + 2) / 153
    day = doy - (153 * mp + 2) / 5 + 1
    month = mp + (mp < 10 ? 3 : -9)
    year = y + (month <= 2 ? 1 : 0)
  }

  public func adding(days: Int) -> CalendarDate { CalendarDate(epochDay: epochDay + days) }

  /// 0 = 日曜(JS `getUTCDay()`)
  public var weekday: Int { ((epochDay % 7 + 4) % 7 + 7) % 7 }

  public var description: String { String(format: "%04d-%02d-%02d", year, month, day) }

  public static func < (l: Self, r: Self) -> Bool { l.epochDay < r.epochDay }

  public init(from decoder: Decoder) throws {
    let s = try decoder.singleValueContainer().decode(String.self)
    guard let v = CalendarDate(s) else {
      throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "bad date \(s)"))
    }
    self = v
  }

  public func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    try c.encode(description)
  }
}
