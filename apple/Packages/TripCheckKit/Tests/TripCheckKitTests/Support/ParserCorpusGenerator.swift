import Foundation
@testable import TripCheckKit

/// SYNTHETIC REGRESSION FIXTURES ONLY.
///
/// Hand-authored tokens that exercise known `WishlistParser` syntax branches
/// deterministically. They are not sampled traveller input and must never be
/// cited as real-world parser accuracy, language coverage or product
/// validation evidence.
///
/// tests/fixtures/wishlist-parser-synthetic-fixtures.ts — constant arrays (verbatim)
/// tests/helpers/generate-wishlist-parser-corpus.ts — `makeCase(index)` (verbatim, no randomness)

/// tests/helpers/generate-wishlist-parser-corpus.ts:16-24 — `ExpectedSyntheticPlace`
struct ExpectedSyntheticPlace: Equatable {
  var name: String
  var day: Int? = nil
  var priority: WishlistPriority? = nil
  var isReservation: Bool? = nil
  var time: String? = nil
  var stayMinutes: Int? = nil
}

/// tests/helpers/generate-wishlist-parser-corpus.ts:26-32 — `SyntheticParserCase`
struct SyntheticParserCase: Equatable {
  var id: String
  var category: String
  var input: String
  var expectedPlaces: [ExpectedSyntheticPlace]
  var expectedHeadings: [Int]
}

enum ParserCorpusGenerator {
  // MARK: tests/fixtures/wishlist-parser-synthetic-fixtures.ts:11-95 — verbatim constant arrays

  static let englishPlaceNames = [
    "Senso-ji",
    "Tokyo Skytree",
    "Meiji Jingu",
    "Shibuya Sky",
    "Ueno Park",
    "Ghibli Museum",
    "teamLab Planets",
    "Tokyo Tower",
    "Imperial Palace",
    "Tsukiji Outer Market",
  ]

  static let japanesePlaceNames = [
    "浅草寺",
    "東京スカイツリー",
    "明治神宮",
    "渋谷スカイ",
    "上野公園",
    "三鷹の森ジブリ美術館",
    "チームラボプラネッツ",
    "東京タワー",
    "皇居",
    "築地場外市場",
  ]

  static let mustMarkers = ["must", "must-do", "non-negotiable", "必須", "絶対行きたい", "マスト"]

  static let optionalMarkers = ["optional", "if there's time", "if time", "時間があれば", "できれば", "任意"]

  static let bookingMarkers = ["booked", "reserved", "reservation", "timed ticket", "予約", "予約済み", "要予約"]

  struct FixedTimeMarker { let text: String; let expected: String }
  static let fixedTimeMarkers = [
    FixedTimeMarker(text: "@ 08:15", expected: "08:15"),
    FixedTimeMarker(text: "14:30", expected: "14:30"),
    FixedTimeMarker(text: "pm 3:45", expected: "15:45"),
    FixedTimeMarker(text: "午後3:30", expected: "15:30"),
    FixedTimeMarker(text: "16時15分", expected: "16:15"),
    FixedTimeMarker(text: "11時半", expected: "11:30"),
  ]

  struct StayMarker { let text: String; let expected: Int }
  static let stayMarkers = [
    StayMarker(text: "stay 45 min", expected: 45),
    StayMarker(text: "stay 90 minutes", expected: 90),
    StayMarker(text: "滞在60分", expected: 60),
    StayMarker(text: "120分滞在", expected: 120),
    StayMarker(text: "滞在180分", expected: 180),
  ]

  static let bullets = ["-", "•", "*", "・", "1.", "2)", "3、"]

  static let isoHeadings = ["2026-09-14", "2026/10/03", "2027.01.08"]

  static let monthNameHeadings = ["September 14", "Monday, October 5", "Aug 9", "Sunday, December 20"]

  // MARK: tests/helpers/generate-wishlist-parser-corpus.ts:36 — `choose`

  static func choose<T>(_ values: [T], _ index: Int) -> T { values[index % values.count] }

  // MARK: tests/helpers/generate-wishlist-parser-corpus.ts:38-52 — synthetic calendar-date oracle
  //
  // Independent fixture oracle for the parser's supported 30-day trip horizon.
  // Ported onto `CalendarDate.epochDay` instead of `Date.UTC`.

  private static let syntheticMonths: [String: Int] = [
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
  ]

  private static let syntheticIsoPattern = try! JSRegex("^(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})$")
  private static let syntheticMonthNamePattern = try! JSRegex(
    "^(?:(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?,?\\s+)?([a-z]+)\\s+(\\d{1,2})$",
    options: [.caseInsensitive]
  )

  private struct SyntheticCalendarValue { var year: Int; var month: Int; var day: Int }

  /// tests/helpers/generate-wishlist-parser-corpus.ts:41-46 — `syntheticCalendarDate`
  private static func syntheticCalendarDate(_ value: String) -> SyntheticCalendarValue? {
    if let m = syntheticIsoPattern.firstMatch(in: value),
       let y = m.groups[0].flatMap(Int.init),
       let mo = m.groups[1].flatMap(Int.init),
       let d = m.groups[2].flatMap(Int.init) {
      return SyntheticCalendarValue(year: y, month: mo, day: d)
    }
    if let m = syntheticMonthNamePattern.firstMatch(in: value),
       let monthText = m.groups[0], let dayText = m.groups[1], let d = Int(dayText),
       let month = syntheticMonths[String(monthText.prefix(3)).lowercased()] {
      return SyntheticCalendarValue(year: 2000, month: month, day: d)
    }
    return nil
  }

  /// tests/helpers/generate-wishlist-parser-corpus.ts:48-56 — `syntheticSecondCalendarDay`
  static func syntheticSecondCalendarDay(_ first: String, _ second: String) -> Int {
    guard let anchor = syntheticCalendarDate(first), var candidate = syntheticCalendarDate(second) else { return 2 }
    let secondStartsWithYear = second.range(of: "^\\d{4}", options: .regularExpression) != nil
    if !secondStartsWithYear,
       candidate.month < anchor.month || (candidate.month == anchor.month && candidate.day < anchor.day) {
      candidate.year += 1
    }
    guard let anchorDate = CalendarDate(year: anchor.year, month: anchor.month, day: anchor.day),
          let candidateDate = CalendarDate(year: candidate.year, month: candidate.month, day: candidate.day)
    else { return 2 }
    let offset = candidateDate.epochDay - anchorDate.epochDay
    return offset >= 0 && offset < 30 ? offset + 1 : 2
  }

  // MARK: tests/helpers/generate-wishlist-parser-corpus.ts:58-64 — sample helpers

  private static func englishPlaces(_ index: Int, count: Int) -> [String] {
    (0..<count).map { offset in choose(englishPlaceNames, index + offset * 3) }
  }

  private static func japanesePlaces(_ index: Int, count: Int) -> [String] {
    (0..<count).map { offset in choose(japanesePlaceNames, index + offset * 3) }
  }

  /// tests/helpers/generate-wishlist-parser-corpus.ts:66-68 — `expected`
  private static func expected(
    _ names: [String],
    day: Int? = nil,
    priority: WishlistPriority? = nil,
    isReservation: Bool? = nil,
    time: String? = nil,
    stayMinutes: Int? = nil
  ) -> [ExpectedSyntheticPlace] {
    names.map {
      ExpectedSyntheticPlace(
        name: $0, day: day, priority: priority, isReservation: isReservation, time: time, stayMinutes: stayMinutes
      )
    }
  }

  // MARK: tests/helpers/generate-wishlist-parser-corpus.ts:78-214 — `makeCase`

  static func makeCase(_ index: Int) -> SyntheticParserCase {
    let category = index % 10
    let variant = index / 10
    let en = englishPlaces(variant, count: 3)
    let ja = japanesePlaces(variant, count: 3)
    let must = choose(mustMarkers, variant)
    let optional = choose(optionalMarkers, variant)
    let booking = choose(bookingMarkers, variant)
    let fixedTime = choose(fixedTimeMarkers, variant)
    let stay = choose(stayMarkers, variant)
    let day = variant % 7 + 1

    switch category {
    case 0:
      return SyntheticParserCase(
        id: "synthetic-\(index)-newline",
        category: "newline",
        input: "\(en[0])\n\(en[1])\n\(en[2])",
        expectedPlaces: expected(en),
        expectedHeadings: []
      )
    case 1:
      return SyntheticParserCase(
        id: "synthetic-\(index)-comma-must",
        category: "japanese-comma-and-must",
        input: "\(ja.joined(separator: variant % 2 == 0 ? "、" : "，")) — \(must)",
        expectedPlaces: expected(ja, priority: .must),
        expectedHeadings: []
      )
    case 2:
      return SyntheticParserCase(
        id: "synthetic-\(index)-slash-optional",
        category: "japanese-slash-and-optional",
        input: "\(ja.joined(separator: variant % 2 == 0 ? "/" : "／")) — \(optional)",
        expectedPlaces: expected(ja, priority: .optional),
        expectedHeadings: []
      )
    case 3:
      // Japanese list punctuation is normally unspaced. A single middle dot
      // inside an official name is covered separately by the noisy family.
      return SyntheticParserCase(
        id: "synthetic-\(index)-middle-dot-booking",
        category: "japanese-middle-dot-booking-time-stay",
        input: "\(ja.joined(separator: "・")) — \(booking) — \(fixedTime.text) — \(stay.text)",
        expectedPlaces: expected(
          ja, priority: .must, isReservation: true, time: fixedTime.expected, stayMinutes: stay.expected
        ),
        expectedHeadings: []
      )
    case 4:
      let bulletsForLine = [choose(bullets, variant), choose(bullets, variant + 2), choose(bullets, variant + 4)]
      return SyntheticParserCase(
        id: "synthetic-\(index)-bullets",
        category: "mixed-bullets-and-markers",
        input: """
          \(bulletsForLine[0]) \(en[0]) — \(must)
          \(bulletsForLine[1]) \(en[1]) — \(optional)
          \(bulletsForLine[2]) \(en[2]) — \(booking) — \(fixedTime.text) — \(stay.text)
          """,
        expectedPlaces: [
          ExpectedSyntheticPlace(name: en[0], priority: .must),
          ExpectedSyntheticPlace(name: en[1], priority: .optional),
          ExpectedSyntheticPlace(
            name: en[2], priority: .must, isReservation: true, time: fixedTime.expected, stayMinutes: stay.expected
          ),
        ],
        expectedHeadings: []
      )
    case 5:
      return SyntheticParserCase(
        id: "synthetic-\(index)-day-heading",
        category: "english-day-heading",
        input: """
          Day \(day)
          \(en[0]) — \(must)
          \(en[1]) — \(optional)
          """,
        expectedPlaces: [
          ExpectedSyntheticPlace(name: en[0], day: day, priority: .must),
          ExpectedSyntheticPlace(name: en[1], day: day, priority: .optional),
        ],
        expectedHeadings: [day]
      )
    case 6:
      return SyntheticParserCase(
        id: "synthetic-\(index)-japanese-day-heading",
        category: "japanese-day-heading",
        input: """
          \(day)日目
          \(ja[0]) — \(booking) — \(fixedTime.text)
          \(ja[1]) — \(stay.text)
          """,
        expectedPlaces: [
          ExpectedSyntheticPlace(name: ja[0], day: day, priority: .must, isReservation: true, time: fixedTime.expected),
          ExpectedSyntheticPlace(name: ja[1], day: day, stayMinutes: stay.expected),
        ],
        expectedHeadings: [day]
      )
    case 7:
      let firstHeading = choose(isoHeadings, variant)
      let secondHeading = choose(isoHeadings, variant + 1)
      let secondDay = syntheticSecondCalendarDay(firstHeading, secondHeading)
      return SyntheticParserCase(
        id: "synthetic-\(index)-iso-heading",
        category: "iso-date-headings",
        input: """
          \(firstHeading)
          \(en[0]) — \(must)
          \(secondHeading)
          \(en[1]) — \(optional)
          """,
        expectedPlaces: [
          ExpectedSyntheticPlace(name: en[0], day: 1, priority: .must),
          ExpectedSyntheticPlace(name: en[1], day: secondDay, priority: .optional),
        ],
        expectedHeadings: [1, secondDay]
      )
    case 8:
      let firstHeading = choose(monthNameHeadings, variant)
      let secondHeading = choose(monthNameHeadings, variant + 1)
      let secondDay = syntheticSecondCalendarDay(firstHeading, secondHeading)
      return SyntheticParserCase(
        id: "synthetic-\(index)-month-heading",
        category: "month-name-date-headings",
        input: """
          \(firstHeading)
          \(en[0]) — \(booking) — \(fixedTime.text)
          \(secondHeading)
          \(en[1]) — \(stay.text)
          """,
        expectedPlaces: [
          ExpectedSyntheticPlace(name: en[0], day: 1, priority: .must, isReservation: true, time: fixedTime.expected),
          ExpectedSyntheticPlace(name: en[1], day: secondDay, stayMinutes: stay.expected),
        ],
        expectedHeadings: [1, secondDay]
      )
    default:
      let officialMiddleDotName = "東京ミッドタウン・日比谷"
      return SyntheticParserCase(
        id: "synthetic-\(index)-mixed-noise",
        category: "mixed-and-noisy",
        input: "\n\(choose(bullets, variant)) \(ja[0])、\(ja[1]) — \(booking) — \(fixedTime.text) — \(stay.text)"
          + "\nhttps://example.com/saved-list/\(variant)"
          + "\nDay \(day) — \(en[0]) — \(optional)"
          + "\n\(officialMiddleDotName) — 9:00-17:00\n",
        expectedPlaces: [
          ExpectedSyntheticPlace(
            name: ja[0], priority: .must, isReservation: true, time: fixedTime.expected, stayMinutes: stay.expected
          ),
          ExpectedSyntheticPlace(
            name: ja[1], priority: .must, isReservation: true, time: fixedTime.expected, stayMinutes: stay.expected
          ),
          ExpectedSyntheticPlace(name: en[0], day: day, priority: .optional),
          ExpectedSyntheticPlace(name: officialMiddleDotName, day: day),
        ],
        expectedHeadings: []
      )
    }
  }

  /// tests/helpers/generate-wishlist-parser-corpus.ts:216-219 — `generateSyntheticWishlistParserCorpus`
  static func generate(_ count: Int) -> [SyntheticParserCase] { (0..<count).map(makeCase) }
}
