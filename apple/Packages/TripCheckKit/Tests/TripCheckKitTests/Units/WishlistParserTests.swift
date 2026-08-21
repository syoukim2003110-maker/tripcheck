import Testing
@testable import TripCheckKit

@Test func splitsJapaneseListPunctuationButKeepsOfficialMiddleDot() {
  let places = WishlistParser.places("浅草寺、東京スカイツリー／上野公園\n東京ミッドタウン・日比谷")
  #expect(places.map(\.name) == ["浅草寺", "東京スカイツリー", "上野公園", "東京ミッドタウン・日比谷"])
}

@Test func readsMarkersAnywhereButStripsOnlyAtBoundaries() {
  let p = WishlistParser.places("三鷹の森ジブリ美術館 — Day 2 10:00 booked · must")[0]
  #expect(p.name == "三鷹の森ジブリ美術館")
  #expect(p.day == 2); #expect(p.time == "10:00"); #expect(p.isReservation); #expect(p.priority == .must)
  // "Mustard Museum" の must は境界にないので残る
  #expect(WishlistParser.places("Mustard Museum")[0].name == "Mustard Museum")
}

@Test func dayHeadingsKeepRealDateGaps() {
  let lines = WishlistParser.parse("2026-09-14\nSenso-ji\n2026-09-16\nUeno Park")
  guard case .heading(_, let d1) = lines[0], case .heading(_, let d3) = lines[2] else { Issue.record("headings"); return }
  #expect(d1 == 1); #expect(d3 == 3)
  #expect(WishlistParser.places("2026-09-14\nSenso-ji\n2026-09-16\nUeno Park").map(\.day) == [1, 3])
}

@Test func timeRangesAreOpeningHoursNotesNotFixedTimes() {
  let p = WishlistParser.places("東京ミッドタウン・日比谷 — 9:00-17:00")[0]
  #expect(p.time == nil)
}

@Test func stayIsClampedTo15To480() {
  #expect(WishlistParser.places("Tokyo Tower stay 5 min")[0].stayMinutes == 15)
  #expect(WishlistParser.places("Tokyo Tower 滞在900分")[0].stayMinutes == 480)
}

@Test func bulletsAndUrlsAreRemovedAndUnparsedLinesSurvive() {
  let lines = WishlistParser.parse("- Senso-ji\n1. Tokyo Tower\nhttps://example.com/list\n???")
  #expect(WishlistParser.places("- Senso-ji\n1. Tokyo Tower").map(\.name) == ["Senso-ji", "Tokyo Tower"])
  #expect(lines.contains { if case .unparsed = $0 { return true }; return false })
}

@Test func reservationWinsOverOptionalAndKoreanChineseMarkersWork() {
  #expect(WishlistParser.places("경복궁 꼭")[0].priority == .must)
  #expect(WishlistParser.places("故宫 有时间")[0].priority == .optional)
  #expect(WishlistParser.places("Shibuya Sky optional booked")[0].priority == .must)
}

// MARK: - Step 5: tests/wishlist-parser.test.ts の残りのケース(remove/set/update は Task 4 送り)

// tests/wishlist-parser.test.ts:7-11
@Test func dayHeadingWithContentKeepsThePlaceInsteadOfDroppingTheLine() {
  let line = WishlistParser.places("1日目: 浅草寺")[0]
  #expect(line.name == "浅草寺")
  #expect(line.day == 1)
}

// tests/wishlist-parser.test.ts:13-20
@Test func dayHeadingBindsTheFollowingLinesToThatDay() {
  let places = WishlistParser.places("1日目\n浅草寺\n東京スカイツリー\n2日目\n明治神宮")
  #expect(places.map { "\($0.name):\($0.day ?? -1)" } == ["浅草寺:1", "東京スカイツリー:1", "明治神宮:2"])
}

// tests/wishlist-parser.test.ts:22-25
@Test func commaSeparatedPlacesOnOneLineBecomeIndependentStops() {
  let places = WishlistParser.places("浅草寺、東京スカイツリー、上野公園")
  #expect(places.map(\.name) == ["浅草寺", "東京スカイツリー", "上野公園"])
}

// tests/wishlist-parser.test.ts:27-50 (formatWishlistLines の行数アサートは Task 4 送り)
@Test func pastedJapaneseMiddleDotAndSlashListBecomesIndividualEditablePlaces() {
  let input = "清水寺・伏見稲荷大社・金閣寺・嵐山（渡月橋・竹林）・祇園/花見小路・二条城・天橋立（丹後）\n大阪城・道頓堀/心斎橋・USJ・新世界（通天閣）・海遊館・万博記念公園"
  let names = WishlistParser.places(input).map(\.name)
  #expect(names == [
    "清水寺", "伏見稲荷大社", "金閣寺", "嵐山", "渡月橋", "嵐山 竹林", "祇園", "花見小路",
    "二条城", "天橋立 丹後", "大阪城", "道頓堀", "心斎橋", "USJ", "新世界", "通天閣", "海遊館", "万博記念公園",
  ])
}

// tests/wishlist-parser.test.ts:52-54
@Test func singleMiddleDotCanRemainPartOfOfficialPlaceName() {
  #expect(WishlistParser.places("東京ミッドタウン・日比谷").map(\.name) == ["東京ミッドタウン・日比谷"])
}

// tests/wishlist-parser.test.ts:56-59
@Test func asciiCommaKeepsEnglishAreaQualifierTogether() {
  #expect(WishlistParser.places("Blue Bottle Coffee, Shibuya").map(\.name) == ["Blue Bottle Coffee, Shibuya"])
}

// tests/wishlist-parser.test.ts:61-67
@Test func kanjiClockTimesAreReadIncludingHalfHoursAndAfternoonMarks() {
  #expect(WishlistParser.places("チームラボプラネッツ 15時30分 予約")[0].time == "15:30")
  #expect(WishlistParser.places("チームラボプラネッツ 15時30分 予約")[0].isReservation == true)
  #expect(WishlistParser.places("展望台 19時半")[0].time == "19:30")
  #expect(WishlistParser.places("ランチ 午後1時")[0].time == "13:00")
  #expect(WishlistParser.places("待ち合わせ 9時")[0].time == "09:00")
}

// tests/wishlist-parser.test.ts:69-72
@Test func durationsLike3JikanAreNotMistakenForAVisitTime() {
  let place = WishlistParser.places("箱根で3時間くらい過ごす")[0]
  #expect(place.time == nil)
}

// tests/wishlist-parser.test.ts:74-79
@Test func fullWidthInputIsNormalizedBeforeParsing() {
  let places = WishlistParser.places("１日目　浅草寺　１５：３０")
  #expect(places[0].name == "浅草寺")
  #expect(places[0].day == 1)
  #expect(places[0].time == "15:30")
}

// tests/wishlist-parser.test.ts:81-86
@Test func openingHourRangesNeverPinAVisitTime() {
  let place = WishlistParser.places("国立新美術館 10:00-18:00")[0]
  #expect(place.time == nil)
  #expect(place.name == "国立新美術館")
  #expect(WishlistParser.places("温泉 9時から17時")[0].time == nil)
}

// tests/wishlist-parser.test.ts:94-98 (buildPlaceResolutionPayload を使う行は対象外)
@Test func markerOnlyAndUrlOnlyLinesAreFlaggedInsteadOfQueried() {
  let lines = WishlistParser.parse("必須\nhttps://example.com/some-place")
  let kinds = lines.map { line -> String in
    switch line {
    case .empty: return "empty"
    case .heading: return "heading"
    case .unparsed: return "unparsed"
    case .place: return "place"
    }
  }
  #expect(kinds == ["unparsed", "unparsed"])
}

// tests/wishlist-parser.test.ts:109-116
@Test func existingDashMarkerStyleStillParsesExactlyAsBefore() {
  let place = WishlistParser.places("三鷹の森ジブリ美術館 — 2日目 10:00 予約 · 必須")[0]
  #expect(place.name == "三鷹の森ジブリ美術館")
  #expect(place.day == 2)
  #expect(place.time == "10:00")
  #expect(place.isReservation == true)
  #expect(place.priority == .must)
}

// tests/wishlist-parser.test.ts:118-126
@Test func parenthesizedMarkersSetFlagsWithoutPollutingThePlaceName() {
  let must = WishlistParser.places("Senso-ji temple (must!)")[0]
  #expect(must.name == "Senso-ji temple")
  #expect(must.priority == .must)

  let ticketed = WishlistParser.places("Ghibli Museum (need tickets)")[0]
  #expect(ticketed.name == "Ghibli Museum")
  #expect(ticketed.isReservation == true)
}

// tests/wishlist-parser.test.ts:128-145
@Test func writtenTimeOfDayWishBecomesASchedulingHintNotPartOfTheName() {
  let sunset = WishlistParser.places("Shibuya Sky at sunset")[0]
  #expect(sunset.name == "Shibuya Sky")
  #expect(sunset.timeOfDay == .evening)

  let morning = WishlistParser.places("豊洲市場 朝イチ")[0]
  #expect(morning.name == "豊洲市場")
  #expect(morning.timeOfDay == .morning)

  let night = WishlistParser.places("渋谷スカイ 夜景")[0]
  #expect(night.name == "渋谷スカイ")
  #expect(night.timeOfDay == .night)

  // An explicit clock time wins; the vaguer wish is not double-read.
  let timed = WishlistParser.places("teamLab Planets 10:00")[0]
  #expect(timed.time == "10:00")
  #expect(timed.timeOfDay == nil)
}

// tests/wishlist-parser.test.ts:197-214 (formatWishlistLines のアサートは Task 4 送り)
@Test func calendarDateHeadingsPreserveRealGapsInAnExistingItinerary() {
  let places = WishlistParser.places("2026-09-14\nSenso-ji\n2026-09-16\nTokyo Skytree\nSep 18: Shibuya Sky")
  #expect(places.map { "\($0.name):\($0.day ?? -1)" } == ["Senso-ji:1", "Tokyo Skytree:3", "Shibuya Sky:5"])
}

// tests/wishlist-parser.test.ts:216-226
@Test func monthNameHeadingsPreserveCalendarGapsAcrossAYearBoundary() {
  let places = WishlistParser.places("Dec 30\nSenso-ji\nJan 2\nTokyo Skytree")
  #expect(places.map { "\($0.name):\($0.day ?? -1)" } == ["Senso-ji:1", "Tokyo Skytree:4"])
}

// tests/wishlist-parser.test.ts:228-233
@Test func systemRecommendationCanBePinnedToItsEvaluatedMealOrGapTime() {
  let place = WishlistParser.places("TripCheck recommendation lunch 1 — optional — 11:30")[0]
  #expect(place.time == "11:30")
  #expect(place.priority == .optional)
  #expect(place.isReservation == false)
}
