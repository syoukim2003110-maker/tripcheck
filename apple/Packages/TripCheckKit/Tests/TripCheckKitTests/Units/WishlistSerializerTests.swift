import Testing
@testable import TripCheckKit

// MARK: - Step 1 (task-4-brief.md)
//
// The brief's literal example for `serializesMarkersInBothLanguages` does not match the
// real `serializeWishlistPlaceLine` (lib/wishlist-parser.ts:458-466) in three ways once you
// read the source instead of guessing (per this task's carry-over decision note):
//   1. `place.name, ...markers` is joined with a single uniform " — " between EVERY element
//      (name and each marker alike) — never " · " between markers.
//   2. The day heading is pushed as its own array entry (`output.push(...)`), i.e. its own
//      *line*, never inlined into the place's own line.
//   3. `isReservation` and `priority === "must"` share ONE marker slot
//      (`isReservation ? "booked" : priority === "must" ? "must" : null`), so a reservation
//      never shows both "booked" and "must" — booked wins and "must" is not repeated.
// This test is rewritten to the real, byte-exact TS output (still exercising every marker:
// time, booked, stay for one place; a time-of-day-label fallback and optional for another).
@Test func serializesMarkersInBothLanguages() {
  let p1 = ParsedWishlistPlace(name: "Ghibli Museum", day: 2, time: "10:00", timeOfDay: nil, isReservation: true, priority: .must, stayMinutes: 120)
  let p2 = ParsedWishlistPlace(name: "Shibuya Sky", day: nil, time: nil, timeOfDay: .evening, isReservation: false, priority: .optional, stayMinutes: nil)
  #expect(WishlistSerializer.formatPlaces([p1, p2], languageCode: .en) == "Day 2\nGhibli Museum — 10:00 — booked — stay 120 min\nShibuya Sky — evening — optional")
  #expect(WishlistSerializer.formatPlaces([p1, p2], languageCode: .ja) == "2日目\nGhibli Museum — 10:00 — 予約 — 滞在120分\nShibuya Sky — 夕方 — 時間があれば")
}

@Test func removingOnePlaceLeavesOtherLinesByteIdentical() {
  let raw = "Day 1\n- Senso-ji must\n  weird   spacing line ☆\nTokyo Tower"
  let out = WishlistSerializer.removePlace(raw: raw, occurrenceIndex: 0)
  #expect(out == "Day 1\n  weird   spacing line ☆\nTokyo Tower")
}

@Test func updatingConstraintsRewritesOnlyThatLine() {
  let raw = "Senso-ji\nTokyo Tower\nUeno Park"
  let out = WishlistSerializer.updateConstraints(raw: raw, occurrenceIndex: 1, patch: .init(time: .some("14:30"), isReservation: true))
  #expect(out.split(separator: "\n", omittingEmptySubsequences: false)[0] == "Senso-ji")
  #expect(out.split(separator: "\n", omittingEmptySubsequences: false)[2] == "Ueno Park")
  #expect(WishlistParser.places(out)[1].time == "14:30")
  #expect(WishlistParser.places(out)[1].isReservation)
}

@Test func clearingTimeWithNullRemovesItButMissingKeyKeepsIt() {
  let raw = "Tokyo Tower 14:30"
  #expect(WishlistParser.places(WishlistSerializer.updateConstraints(raw: raw, occurrenceIndex: 0, patch: .init(time: .some(nil))))[0].time == nil)
  #expect(WishlistParser.places(WishlistSerializer.updateConstraints(raw: raw, occurrenceIndex: 0, patch: .init(priority: .optional)))[0].time == "14:30")
}

// MARK: - Ported from tests/wishlist-parser.test.ts (serializer/edit cases Task 3 skipped)

// tests/wishlist-parser.test.ts:27-50 — only the `formatWishlistLines` line-count assertion;
// the name-splitting assertion is already ported in WishlistParserTests.
@Test func pastedMiddleDotAndSlashListFormatsToEighteenLines() {
  let input = "清水寺・伏見稲荷大社・金閣寺・嵐山（渡月橋・竹林）・祇園/花見小路・二条城・天橋立（丹後）\n大阪城・道頓堀/心斎橋・USJ・新世界（通天閣）・海遊館・万博記念公園"
  let lines = WishlistSerializer.formatLines(input, languageCode: .ja).split(separator: "\n", omittingEmptySubsequences: false)
  #expect(lines.count == 18)
}

// tests/wishlist-parser.test.ts:147-160
@Test func chipUICanChangePriorityWhileKeepingOneTextualSourceOfTruth() {
  let raw = "Day 1\nSenso-ji\nhttps://example.com/private-note\nTokyo Skytree — optional\nteamLab Planets — 15:30 booked"
  let must = WishlistSerializer.setPriority(raw: raw, occurrenceIndex: 0, priority: .must, languageCode: .en)
  #expect(WishlistParser.places(must)[0].priority == .must)
  #expect(must.contains("Senso-ji — must"))
  #expect(must.contains("https://example.com/private-note"), "unparsed input survives a chip edit")

  let normal = WishlistSerializer.setPriority(raw: must, occurrenceIndex: 0, priority: .normal, languageCode: .en)
  #expect(WishlistParser.places(normal)[0].priority == .normal)
  #expect(!normal.contains("Senso-ji — must"))

  let booked = WishlistSerializer.setPriority(raw: raw, occurrenceIndex: 2, priority: .optional, languageCode: .en)
  #expect(WishlistParser.places(booked)[2].priority == .must, "bookings stay protected")
}

// tests/wishlist-parser.test.ts:162-186
@Test func conditionControlsCanEditOneOccurrenceWithoutLosingPrivateLines() {
  let raw = "Day 1\nMuseum\nhttps://example.com/private-note\nMuseum — optional"
  let booked = WishlistSerializer.updateConstraints(
    raw: raw,
    occurrenceIndex: 1,
    patch: .init(time: .some("14:30"), isReservation: true, stayMinutes: .some(95)),
    languageCode: .en
  )
  let places = WishlistParser.places(booked)

  #expect(places[0] == ParsedWishlistPlace(name: "Museum", day: 1, time: nil, timeOfDay: nil, isReservation: false, priority: .normal, stayMinutes: nil))
  #expect(places[1].time == "14:30", "the second same-name occurrence is the only edited visit")
  #expect(places[1].isReservation == true)
  #expect(places[1].priority == .must, "a fixed booking is always protected")
  #expect(places[1].stayMinutes == 95)
  #expect(booked.contains("https://example.com/private-note"))
}

// tests/wishlist-parser.test.ts:187-195 — `stayMinutes: Number.NaN` has no Int equivalent
// (Int cannot represent NaN), so the "invalid value present" half of that TS case is instead
// covered by the "key absent" branch below: both leave the original stayMinutes untouched.
@Test func invalidConditionEditsAreIgnoredAndStayDurationsStayInRange() {
  let raw = "Senso-ji — 09:00 — stay 45 min"
  let invalid = WishlistSerializer.updateConstraints(raw: raw, occurrenceIndex: 0, patch: .init(time: .some("25:99")), languageCode: .en)
  #expect(WishlistParser.places(invalid)[0].time == "09:00")
  #expect(WishlistParser.places(invalid)[0].stayMinutes == 45)

  let bounded = WishlistSerializer.updateConstraints(raw: raw, occurrenceIndex: 0, patch: .init(stayMinutes: .some(900)), languageCode: .en)
  #expect(WishlistParser.places(bounded)[0].stayMinutes == 480)
}

// tests/wishlist-parser.test.ts:197-214 — only the `formatWishlistLines` assertion; the day
// gap assertion is already ported in WishlistParserTests.
@Test func calendarDateHeadingsFormatWithPreservedGaps() {
  let raw = "2026-09-14\nSenso-ji\n2026-09-16\nTokyo Skytree\nSep 18: Shibuya Sky"
  #expect(WishlistSerializer.formatLines(raw, languageCode: .en) == "Day 1\nSenso-ji\nDay 3\nTokyo Skytree\nDay 5\nShibuya Sky")
}

// tests/wishlist-parser.test.ts:239-248 (v1.1 TC-020)
@Test func removingOnePlaceKeepsEveryOtherLineByteIdenticalIncludingHeadersAndAnnotations() {
  let raw = "1日目\n浅草寺 9:00\nチームラボプラネッツ 15:30 予約\nhttps://example.com/notes\n\n2日目\n三鷹の森ジブリ美術館 必須\n渋谷スカイ 時間があれば"
  let next = WishlistSerializer.removePlace(raw: raw, occurrenceIndex: 0, languageCode: .ja)
  #expect(next == "1日目\nチームラボプラネッツ 15:30 予約\nhttps://example.com/notes\n\n2日目\n三鷹の森ジブリ美術館 必須\n渋谷スカイ 時間があれば")
  let summary = WishlistParser.places(next).map { "\($0.name):\($0.day ?? -1):\($0.priority.rawValue)" }
  #expect(summary == ["チームラボプラネッツ:1:must", "三鷹の森ジブリ美術館:2:must", "渋谷スカイ:2:optional"])
}

// tests/wishlist-parser.test.ts:250-254
@Test func removingLastPlaceOfASectionKeepsSectionHeadingVerbatim() {
  let raw = "Day 1\nSenso-ji 9:00\nGhibli Museum must\nShibuya Sky optional"
  let next = WishlistSerializer.removePlace(raw: raw, occurrenceIndex: 1, languageCode: .en)
  #expect(next == "Day 1\nSenso-ji 9:00\nShibuya Sky optional")
}

// tests/wishlist-parser.test.ts:256-265
@Test func removingOneOccurrenceFromAMultiPlaceLineKeepsOtherPlacesAndMarkers() {
  let raw = "銀閣寺・金閣寺・清水寺 必須\n伏見稲荷大社"
  let next = WishlistSerializer.removePlace(raw: raw, occurrenceIndex: 1, languageCode: .ja)
  #expect(next == "銀閣寺 — 必須\n清水寺 — 必須\n伏見稲荷大社")
  let summary = WishlistParser.places(next).map { "\($0.name):\($0.priority.rawValue)" }
  #expect(summary == ["銀閣寺:must", "清水寺:must", "伏見稲荷大社:normal"])
}

// tests/wishlist-parser.test.ts:267-276
@Test func removingFromAMultiPlaceLineThatCarriesItsOwnDayReEmitsThatDay() {
  let raw = "1日目\n浅草寺\n2日目 銀閣寺・金閣寺・清水寺"
  let next = WishlistSerializer.removePlace(raw: raw, occurrenceIndex: 2, languageCode: .ja)
  #expect(next == "1日目\n浅草寺\n2日目\n銀閣寺\n清水寺")
  let summary = WishlistParser.places(next).map { "\($0.name):\($0.day ?? -1)" }
  #expect(summary == ["浅草寺:1", "銀閣寺:2", "清水寺:2"])
}

// tests/wishlist-parser.test.ts:278-283 — the `0.5` (non-integer) case has no Swift equivalent
// since `occurrenceIndex` is typed `Int` and cannot hold a fractional value.
@Test func outOfRangeRemovalIndexLeavesInputUntouched() {
  let raw = "Senso-ji\nGhibli Museum"
  #expect(WishlistSerializer.removePlace(raw: raw, occurrenceIndex: 2, languageCode: .en) == raw)
  #expect(WishlistSerializer.removePlace(raw: raw, occurrenceIndex: -1, languageCode: .en) == raw)
}
