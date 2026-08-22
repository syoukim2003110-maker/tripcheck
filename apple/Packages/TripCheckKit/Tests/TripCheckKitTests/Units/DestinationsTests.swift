import Foundation
import Testing
@testable import TripCheckKit

// Task 6 brief §Step 1 tests (verbatim).

@Test func hasTwentyFiveProfilesAndJapanFacts() throws {
  #expect(Destinations.all.count == 25)
  let jp = Destinations.byId(.japan)
  #expect(jp.mobility == .transit_first)
  #expect(jp.meals.lunch == MealWindow(start: 11 * 60, end: 14 * 60 + 30))
  #expect(jp.meals.dinner == MealWindow(start: 17 * 60 + 30, end: 21 * 60))
  let hnd = try #require(Destinations.airport(jp, code: "HND"))
  #expect(hnd.transferMinutes == 60); #expect(hnd.internationalDepartureMinutes == 180)
  #expect(Destinations.airportComparisonGroup(jp, code: "HND").map(\.code).sorted() == ["HND", "NRT"])
  #expect(Destinations.airportComparisonGroup(jp, code: "FUK").isEmpty)
}

@Test func countryCodesCoverSharedProfiles() {
  #expect(Destinations.forCountryCode("LI")?.id == .switzerland)
  #expect(Destinations.forCountryCode("VA")?.id == .italy)
  #expect(Destinations.forCountryCode("BR") == nil)
  #expect(Destinations.forCoordinate(46.9, 7.4)?.id == .switzerland)
}

@Test func spainEatsLateAndDachClosesOnSunday() {
  #expect(Destinations.byId(.spain).meals.dinner.start == 21 * 60)
  #expect(Destinations.byId(.germany).sundayClosing); #expect(!Destinations.byId(.japan).sundayClosing)
}

@Test func japaneseQueriesGetJapaneseCountrySuffix() {
  #expect(Destinations.placeQuery("ベルン旧市街", destination: Destinations.byId(.switzerland), languageCode: .ja) == "ベルン旧市街 スイス")
}

@Test func utcOffsetsHonourDst() throws {
  let ny = Destinations.utcOffsetMinutes(at: try #require(Destinations.localDateTimeWithOffset(date: "2026-03-07", time: "12:00", timeZone: "America/New_York")), timeZone: "America/New_York")
  let ny2 = Destinations.utcOffsetMinutes(at: try #require(Destinations.localDateTimeWithOffset(date: "2026-03-08", time: "12:00", timeZone: "America/New_York")), timeZone: "America/New_York")
  #expect(ny == -300); #expect(ny2 == -240)
}

// MARK: - tests/mandatory-edge-cases.test.ts の時刻 2 本(Task 17 で移植)

/// TS の `new Date("....Z")`。
private func instant(_ iso: String) -> Date? {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return formatter.date(from: iso)
}

/// TS の `localDateTimeWithOffset` が返す文字列("2026-03-07T09:00:00-05:00")の組み立て。
/// Swift 版は `Date?` を返す(移植メモは `Destinations/DestinationTime.swift:14-18`)ので、
/// 突き合わせる側でその瞬間を目的地のゾーンで書き出す。
private func localIso(_ moment: Date, timeZone: String) -> String? {
  guard let zone = TimeZone(identifier: timeZone) else { return nil }
  let formatter = ISO8601DateFormatter()
  formatter.timeZone = zone
  formatter.formatOptions = [.withInternetDateTime, .withColonSeparatorInTimeZone]
  return formatter.string(from: moment)
}

/// TS `test("mandatory cases: local trip dates do not inherit the device timezone")`
/// (`tests/mandatory-edge-cases.test.ts:27-35`)。同じ瞬間でも、日付は端末のゾーンではなく
/// **目的地のゾーン**で決まる。日付をまたぐ組がそれを一番はっきり見せる。
@Test func localTripDatesDoNotInheritTheDeviceTimezone() throws {
  let moment = try #require(instant("2026-01-01T10:30:00.000Z"))
  #expect(Destinations.localDateIn(timeZone: "Pacific/Auckland", at: moment).description == "2026-01-01")
  #expect(Destinations.localDateIn(timeZone: "America/Los_Angeles", at: moment).description == "2026-01-01")

  let crossing = try #require(instant("2026-01-01T23:30:00.000Z"))
  #expect(Destinations.localDateIn(timeZone: "Pacific/Auckland", at: crossing).description == "2026-01-02")
  #expect(Destinations.localDateIn(timeZone: "America/Los_Angeles", at: crossing).description == "2026-01-01")
}

/// TS `test("mandatory case: DST dates use the destination's actual UTC offset")`
/// (`tests/mandatory-edge-cases.test.ts:37-42`)。上の `utcOffsetsHonourDst` は 12:00 で同じ
/// 転換を押さえているが、TS の文字どおりの入力(09:00)と出力文字列そのものはここで突き合わせる。
@Test func dstDatesUseTheDestinationsActualUtcOffset() throws {
  let before = try #require(Destinations.localDateTimeWithOffset(date: "2026-03-07", time: "09:00", timeZone: "America/New_York"))
  let after = try #require(Destinations.localDateTimeWithOffset(date: "2026-03-08", time: "09:00", timeZone: "America/New_York"))
  #expect(localIso(before, timeZone: "America/New_York") == "2026-03-07T09:00:00-05:00")
  #expect(localIso(after, timeZone: "America/New_York") == "2026-03-08T09:00:00-04:00")
}

@Test func entryAuthorityAndPassportRulesMatchTable() {
  #expect(Destinations.entryAuthority(Destinations.byId(.usa))?.status == .required)
  #expect(Destinations.entryAuthority(Destinations.byId(.france))?.status == .not_yet)
  #expect(Destinations.entryAuthority(Destinations.byId(.korea))?.statusValidUntil == "2026-12-31")
  #expect(Destinations.passportRule(Destinations.byId(.thailand))?.monthsBeyond == 6)
}

@Test func optionsAreAutoThenAlphabeticalThenWorldwide() {
  let o = Destinations.options(locale: .en)
  #expect(o.first?.choice == .auto); #expect(o.last?.choice == .destination(.worldwide)); #expect(o.count == 26)
}

// MARK: - Transcription cross-checks (task-6-brief.md §DestinationData.swift)
//
// Expected numbers verified independently against lib/destinations.ts:
//   airports: `grep -oE '\{ code: "[A-Z]\{3\}", names:' lib/destinations.ts | sort -u | wc -l` = 61
//     (the brief's suggested `grep -o 'code: "[A-Z]\{3\}"'` also matches the 18 `currency: {
//     code: ... }` fields — 61 airports + 18 currencies = 79 — so 61 is the airport-only count)
//   sundayClosing: `grep -c 'sundayClosing: true' lib/destinations.ts` = 3
//   hotelFacts "rakuten": exactly 1 data occurrence (japan); a naive grep count of 2 also
//     matches the `hotelFacts: "rakuten" | null;` type declaration line

@Test func transcriptionMatchesTypeScriptCounts() {
  let codes = Destinations.all.flatMap { $0.airports.map(\.code) }
  #expect(Set(codes).count == 61)
  #expect(codes.count == 61) // no destination repeats another's airport code
  #expect(Destinations.all.filter(\.sundayClosing).count == 3)
  #expect(Destinations.all.filter { $0.hotelFacts == .rakuten }.count == 1)
}

// MARK: - Ported from tests/destinations.test.ts (destination-related assertions only)
//
// Skipped (exercise buildTripFromWishlist / fetchGoogleResolvedPlace / estimateTravelOptions,
// which are out of this task's scope — trip-builder, google-place-resolver and
// time-feasibility are ported in other tasks):
//   "an unsupported country with a provider country code stays worldwide"
//   "auto destination stays neutral for tied or unsupported mixed-country wishlists"
//   "a Swiss wishlist is detected, keeps Swiss airports and never suggests Japanese food"
//   "a stale Japanese airport is ignored once the trip is Swiss"
//   "an explicit country overrules where the places actually are"
//   "a pinned country rejects a same-name match on the wrong continent"
//   "the text query and region bias come from the destination"
//   "a car-first country stops recommending a train that barely exists"

@Test func everyDestinationProfileIsInternallyConsistent() throws {
  let airportCodePattern = try JSRegex("^[A-Z]{3}$")
  let currencyCodePattern = try JSRegex("^[A-Z]{3}$")
  let timeZonePattern = try JSRegex("^[A-Za-z_]+(?:/[A-Za-z_+-]+)*$")

  var ids = Set<DestinationId>()
  var airportCodes: [String: DestinationId] = [:]
  for destination in Destinations.all {
    #expect(!ids.contains(destination.id), "duplicate id \(destination.id)")
    ids.insert(destination.id)
    #expect(!(destination.names[.en] ?? "").isEmpty, "\(destination.id) needs an English name")
    #expect(!(destination.names[.ja] ?? "").isEmpty, "\(destination.id) needs a Japanese name")
    #expect(timeZonePattern.test(destination.timeZone))
    #expect(currencyCodePattern.test(destination.currency.code))
    #expect(destination.meals.lunch.start < destination.meals.lunch.end)
    #expect(destination.meals.dinner.start < destination.meals.dinner.end)
    #expect(destination.meals.lunch.end <= destination.meals.dinner.start, "\(destination.id) meal windows overlap")
    #expect(!(destination.cuisine[.en] ?? []).isEmpty && !(destination.cuisine[.ja] ?? []).isEmpty)
    if let bounds = destination.bounds {
      #expect(bounds.south < bounds.north)
      #expect(bounds.west < bounds.east)
      #expect(
        Destinations.withinBounds(bounds, latitude: destination.center.latitude, longitude: destination.center.longitude),
        "\(destination.id) centre falls outside its own bounds"
      )
    }
    for airport in destination.airports {
      #expect(airportCodePattern.test(airport.code))
      // A gateway that is not inside its own country would silently plan the wrong
      // transfer, so the bounds check is the guard rail.
      #expect(
        Destinations.withinBounds(destination.bounds, latitude: airport.latitude, longitude: airport.longitude),
        "\(airport.code) is outside \(destination.id)"
      )
      #expect(airport.transferMinutes > 0 && airport.transferMinutes <= 180)
      #expect(airport.internationalDepartureMinutes >= 90)
      #expect(airport.sourceUrl.hasPrefix("https://"))
      let owner = airportCodes[airport.code]
      #expect(owner == nil, "\(airport.code) is listed by both \(String(describing: owner)) and \(destination.id)")
      airportCodes[airport.code] = destination.id
    }
  }
  // Timezones must be real: an invalid identifier force-unwraps and crashes here.
  let instant = try #require(Destinations.localDateTimeWithOffset(date: "2026-08-06", time: "12:00", timeZone: "UTC"))
  for destination in Destinations.all { _ = Destinations.localDateIn(timeZone: destination.timeZone, at: instant) }
}

@Test func countryCodeOrCoordinateNamesTheDestination() {
  #expect(Destinations.forCountryCode("CH")?.id == .switzerland)
  #expect(Destinations.forCountryCode("jp")?.id == .japan)
  // Ireland must never inherit UK currency, airports or ETA rules.
  #expect(Destinations.forCountryCode("IE") == nil)
  #expect(Destinations.forCountryCode("GB")?.id == .uk)
  #expect(Destinations.forCountryCode("ZZ") == nil)

  #expect(Destinations.forCoordinate(46.0207, 7.7491)?.id == .switzerland)
  #expect(Destinations.forCoordinate(35.6595, 139.7005)?.id == .japan)
  // Mid-ocean belongs to nobody, and that is reported as unknown, not guessed.
  #expect(Destinations.forCoordinate(0, -140) == nil)
  #expect(Destinations.forCoordinate(.nan, 0) == nil)
}

@Test func unknownOrMissingIdsDegradeToWorldwide() {
  // `DestinationId` is a closed Swift enum, so "narnia" cannot be constructed as one; the TS
  // `destinationById("narnia")` / `destinationById(undefined)` behaviour maps to a raw string
  // that fails `DestinationId(rawValue:)`, and to `byId(nil)`, respectively.
  #expect(Destinations.byId(DestinationId(rawValue: "narnia")).id == .worldwide)
  #expect(Destinations.byId(nil).id == .worldwide)
  #expect(Destinations.byId(.switzerland).id == .switzerland)
  #expect(DestinationChoice(rawValue: "auto") == .auto)
  #expect(DestinationChoice(rawValue: "switzerland") == .destination(.switzerland))
  #expect(DestinationChoice(rawValue: "narnia") == nil)
}

@Test func placeQueriesPriceBandsAndAirportsFollowDestination() {
  let swiss = Destinations.byId(.switzerland)
  let anywhere = Destinations.byId(.worldwide)
  #expect(Destinations.placeQuery("Old Town", destination: swiss) == "Old Town Switzerland")
  // With no country chosen, nothing is appended — a guess would be worse.
  #expect(Destinations.placeQuery("Old Town", destination: anywhere) == "Old Town")

  #expect(Destinations.priceBandSymbols(Destinations.byId(.japan)) == ["¥", "¥¥", "¥¥¥", "¥¥¥¥"])
  #expect(Destinations.priceBandSymbols(swiss) == ["₣", "₣₣", "₣₣₣", "₣₣₣₣"])

  #expect(Destinations.airport(swiss, code: "ZRH")?.code == "ZRH")
  #expect(Destinations.airport(swiss, code: "none") == nil)
  // A code left over from another trip does not apply here.
  #expect(Destinations.airport(swiss, code: "HND") == nil)
}

@Test func pickerOffersAutoFirstAndEveryCountryByName() {
  let options = Destinations.options(locale: .en)
  #expect(options.first?.choice == .auto)
  #expect(options.last?.choice == .destination(.worldwide))
  #expect(options.contains { $0.choice == .destination(.switzerland) && $0.label == "Switzerland" })
  #expect(Destinations.options(locale: .ja).contains { $0.label == "スイス" })
}

// MARK: - Additional coverage for functions the brief tests don't exercise directly

@Test func essentialsCarryTravellerFacts() throws {
  let jp = try #require(Destinations.essentials(Destinations.byId(.japan)))
  #expect(jp.plug == "A · 100V")
  #expect(jp.pass?.url == "https://japanrailpass.net/")
  #expect(Destinations.essentials(Destinations.byId(.worldwide)) == nil)
}
