import Testing
@testable import TripCheckKit

@Test func clockTimeRoundTrips() throws {
  let t = try #require(ClockTime("09:05"))
  #expect(t.minutes == 545)
  #expect(t.description == "09:05")
  #expect(ClockTime("24:00") == nil)
  #expect(ClockTime("9:05")?.minutes == 545)          // TS の clockMinutes は 1 桁時を受ける
  #expect(ClockTime(minutes: 1445).description == "00:05") // 翌日跨ぎは 1440 で畳む(TS clock())
}

@Test func calendarDateArithmetic() throws {
  let d = try #require(CalendarDate("2026-10-13"))
  #expect(d.adding(days: 19).description == "2026-11-01")
  #expect(d.weekday == 2)                               // 火曜 = JS の getUTCDay() と同じ 0=日
  #expect(CalendarDate("2026-02-30") == nil)
  #expect(CalendarDate("2026-03-08").map { $0.epochDay - CalendarDate("2026-03-07")!.epochDay } == 1)
}

@Test func clockTimeAndCalendarDateRejectNonDigitComponents() {
  // TS の `\d` は ASCII 0–9 のみ。Swift の `Int(_:)` は先頭の "+" を受理してしまうため、
  // 桁ごとに ASCII 数字だけであることを別途検証する必要がある。
  #expect(ClockTime("+9:05") == nil)
  #expect(ClockTime("09:+5") == nil)
  #expect(ClockTime("9:5") == nil)                      // 分は \d{2} で 1 桁不可
  #expect(ClockTime("09:05")?.minutes == 545)           // 通常入力は引き続き通る
  #expect(CalendarDate("2026-+1-01") == nil)
  #expect(CalendarDate("2026-1-01") == nil)             // 月は \d{2} で 1 桁不可
  #expect(CalendarDate("2026-01-01") != nil)            // 通常入力は引き続き通る
}

@Test func haversineMatchesTypeScriptConstant() {
  let a = GeoPoint(latitude: 35.6655, longitude: 139.7708)   // 築地
  let b = GeoPoint(latitude: 35.7148, longitude: 139.7967)   // 浅草寺
  #expect(abs(straightLineDistanceKm(a, b) - 5.95) < 0.05)   // 半径 6371km
}

@Test func jsStringOrderUsesUTF16() {
  #expect(jsStringLess("a", "b"))
  #expect(jsStringLess("Z", "a"))          // 大文字が先
  #expect(jsStringLess("日", "𠮷") == true) // サロゲートペアは UTF-16 単位で比較
}

@Test func regexSupportsLookbehindAndGlobal() throws {
  let re = try JSRegex("(?:(?<=^)|(?<=[\\s、]))must(?=$|[\\s、])", options: [.caseInsensitive])
  #expect(re.matches(in: "Tokyo must、must").count == 2)
  #expect(re.replacingAll(in: "a must b", with: "") == "a  b")
}

@Test func engineConstantsMatchSpec() {
  #expect(EngineConstants.defaultDayEnd.description == "22:00")
  #expect(EngineConstants.maxDayAssignmentEvaluations == 600)
  #expect(EngineConstants.maxDayAssignmentStops == 12)
}
