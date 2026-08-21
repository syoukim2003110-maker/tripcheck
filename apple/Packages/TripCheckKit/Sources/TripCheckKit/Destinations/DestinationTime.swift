import Foundation

/// TS timezone functions (`lib/destinations.ts:1591-1640`). Every destination's `timeZone`
/// is a validated IANA identifier, so these force-unwrap rather than threading an optional
/// through every caller for a case that should never happen with our own data — an invalid
/// identifier is a programmer error, not a runtime input to handle gracefully.
extension Destinations {
  /// UTC offset of an IANA zone at an instant, in minutes. TS `utcOffsetMinutesAt`.
  public static func utcOffsetMinutes(at instant: Date, timeZone: String) -> Int {
    TimeZone(identifier: timeZone)!.secondsFromGMT(for: instant) / 60
  }

  /// "2026-08-09" + "09:30" in Europe/Zurich → the instant that wall-clock time names,
  /// DST-aware (TS `localDateTimeWithOffset`, `lib/destinations.ts:1607-1626`). TS resolves
  /// this by iteratively refining a UTC guess against the zone's offset because JS `Date` has
  /// no "build from local components + zone" constructor; `Calendar`/`TimeZone` do this
  /// natively, so no iteration is needed here. `nil` for a malformed date/time or an unknown
  /// zone, never a wrong-zone guess.
  public static func localDateTimeWithOffset(date: String, time: String, timeZone: String) -> Date? {
    guard let calendarDate = CalendarDate(date), let clock = ClockTime(time), let zone = TimeZone(identifier: timeZone) else {
      return nil
    }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    var components = DateComponents()
    components.year = calendarDate.year
    components.month = calendarDate.month
    components.day = calendarDate.day
    components.hour = clock.minutes / 60
    components.minute = clock.minutes % 60
    components.second = 0
    return calendar.date(from: components)
  }

  /// Today's calendar date in the destination's own zone, so "tomorrow" means their
  /// tomorrow (TS `localDateIn`, `lib/destinations.ts:1633-1640`).
  public static func localDateIn(timeZone: String, at instant: Date = Date()) -> CalendarDate {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: timeZone)!
    let components = calendar.dateComponents([.year, .month, .day], from: instant)
    return CalendarDate(year: components.year!, month: components.month!, day: components.day!)!
  }
}
