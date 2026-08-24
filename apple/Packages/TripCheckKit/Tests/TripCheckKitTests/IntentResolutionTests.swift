import Testing
@testable import TripCheckKit

// spec §4.3 の表そのまま。読めない表記は黙って nil —— 推測で埋めない。
@Test func nightsBecomeDaysByAddingOne() {
  #expect(IntentResolution.days(fromDurationText: "2泊") == 3)
  #expect(IntentResolution.days(fromDurationText: "2泊3日") == 3)
  #expect(IntentResolution.days(fromDurationText: "3日間") == 3)
  #expect(IntentResolution.days(fromDurationText: "3日") == 3)
  #expect(IntentResolution.days(fromDurationText: "日帰り") == 1)
  #expect(IntentResolution.days(fromDurationText: "Weekend") == nil)
  #expect(IntentResolution.days(fromDurationText: "") == nil)
}

@Test func fullWidthDigitsCount() {
  #expect(IntentResolution.days(fromDurationText: "2泊") == 3)
}

@Test func absurdDurationsClampToTheAllowedRange() {
  #expect(IntentResolution.days(fromDurationText: "30泊") == 14)
  #expect(IntentResolution.days(fromDurationText: "0日") == 1)
}

@Test func aMonthAndDayLandOnTheNextOccurrence() {
  let today = CalendarDate("2026-08-24")!
  #expect(IntentResolution.startDate(fromWhenText: "10月3日から", today: today) == "2026-10-03")
  #expect(IntentResolution.startDate(fromWhenText: "10/3", today: today) == "2026-10-03")
  // 年内で過ぎた日付は翌年へ。
  #expect(IntentResolution.startDate(fromWhenText: "3月1日", today: today) == "2027-03-01")
  // 今日ちょうどは今日。
  #expect(IntentResolution.startDate(fromWhenText: "8月24日", today: today) == "2026-08-24")
}

@Test func aFullDateIsHonoredUnlessPast() {
  let today = CalendarDate("2026-08-24")!
  #expect(IntentResolution.startDate(fromWhenText: "2026年10月3日", today: today) == "2026-10-03")
  #expect(IntentResolution.startDate(fromWhenText: "2026-10-03", today: today) == "2026-10-03")
  #expect(IntentResolution.startDate(fromWhenText: "2024-09-01", today: today) == nil)
}

@Test func vagueTimingStaysUndated() {
  let today = CalendarDate("2026-08-24")!
  #expect(IntentResolution.startDate(fromWhenText: "9月", today: today) == nil)
  #expect(IntentResolution.startDate(fromWhenText: "来週末", today: today) == nil)
  #expect(IntentResolution.startDate(fromWhenText: "", today: today) == nil)
  // 存在しない日は素直に nil(2/30 など)。
  #expect(IntentResolution.startDate(fromWhenText: "2月30日", today: today) == nil)
}
