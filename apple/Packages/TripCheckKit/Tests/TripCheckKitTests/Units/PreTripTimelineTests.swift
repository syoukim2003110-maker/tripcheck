import Foundation
import Testing
@testable import TripCheckKit

/*
 * The dated half of "before you go", ported from `lib/pre-trip-timeline.ts`.
 *
 * Every case below is taken from the TS rules rather than from the Swift we are about to
 * write: a passport that is valid but not valid ENOUGH, a waiver whose window this trip
 * falls outside of, an authorisation that cannot be filed early, and the three shapes a
 * deadline can take (overdue · due soon · scheduled). The point of the port is that the
 * iPhone tells a traveller exactly what the web told them on the same day.
 */

// Task 10 brief §Step 1 tests (verbatim).

@Test func schengenPassportShortByTwoWeeksIsOverdue() {
  let items = PreTripTimeline.build(tripStartDate: CalendarDate("2026-10-13"), tripEndDate: CalendarDate("2026-10-16"),
                                    authority: nil, passportRule: Destinations.passportRule(Destinations.byId(.switzerland)),
                                    passportExpiry: CalendarDate("2027-01-01"), today: CalendarDate("2026-08-23")!)
  #expect(items.map(\.id) == ["passport"])
  #expect(items[0].urgency == .overdue)                       // 出国日 + 3 か月 = 2027-01-16 > 期限
  #expect(items[0].label[.ja]?.contains("パスポート") == true)
}

@Test func monthArithmeticClampsToEndOfMonth() {
  #expect(CalendarDate("2026-01-31")!.adding(months: 1) == CalendarDate("2026-02-28")!)
  #expect(CalendarDate("2026-11-30")!.adding(months: 3) == CalendarDate("2027-02-28")!)
}

@Test func ketaWaiverPastItsDateChangesTheLabelNotTheDetail() {
  let items = PreTripTimeline.build(tripStartDate: CalendarDate("2027-02-01"), tripEndDate: CalendarDate("2027-02-03"),
                                    authority: Destinations.entryAuthority(Destinations.byId(.korea)), passportRule: nil, passportExpiry: nil, today: CalendarDate("2026-08-23")!)
  guard let keta = items.first(where: { $0.id.hasPrefix("authority-") }) else { Issue.record("no authority item"); return }
  #expect(keta.urgency == .info)
  #expect(keta.label[.ja]?.contains("期間外") == true)         // detail は summary のまま(「…まで免除」を含む)
}

// The rest of the TS rules.

/// The leap-year and short-month edges of `addMonthsUtc`, plus the negative direction the
/// clamp shares (`Date.UTC` accepts a month index outside 0…11 and rolls the year).
@Test func monthArithmeticCrossesYearsAndLeapDays() {
  #expect(CalendarDate("2028-01-31")!.adding(months: 1) == CalendarDate("2028-02-29")!)   // 2028 is a leap year
  #expect(CalendarDate("2026-08-23")!.adding(months: 6) == CalendarDate("2027-02-23")!)
  #expect(CalendarDate("2026-03-31")!.adding(months: -1) == CalendarDate("2026-02-28")!)
  #expect(CalendarDate("2026-01-15")!.adding(months: -1) == CalendarDate("2025-12-15")!)
  #expect(CalendarDate("2026-05-17")!.adding(months: 0) == CalendarDate("2026-05-17")!)
}

/// Thailand measures its six months from ENTRY, and its arrival card cannot be filed more
/// than three days out — so the same trip yields one blocker and one calendar note.
@Test func thailandNeedsSixMonthsAtEntryAndAWindowedArrivalCard() {
  let destination = Destinations.byId(.thailand)
  let items = PreTripTimeline.build(
    tripStartDate: CalendarDate("2026-10-13"),
    tripEndDate: CalendarDate("2026-10-16"),
    authority: Destinations.entryAuthority(destination),
    passportRule: Destinations.passportRule(destination),
    passportExpiry: CalendarDate("2027-03-01"),
    today: CalendarDate("2026-08-23")!
  )
  // 2026-10-13 + 6 months = 2027-04-13, and the passport dies on 2027-03-01.
  #expect(items.map(\.id) == ["passport", "authority-TDAC"])   // overdue sorts above scheduled
  #expect(items[0].urgency == .overdue)
  #expect(items[0].label[.ja]?.contains("2027-04-13") == true)
  #expect(items[1].urgency == .scheduled)
  #expect(items[1].dueDate == CalendarDate("2026-10-13"))
  #expect(items[1].opensDate == CalendarDate("2026-10-10"))    // opensDaysBefore = 3
  #expect(items[1].label[.ja]?.contains("2026-10-10") == true)
}

/// The same windowed card once the window is open, and once the arrival day is behind us.
@Test func theArrivalCardBecomesADoNowThenOverdue() {
  let thailand = Destinations.entryAuthority(Destinations.byId(.thailand))
  func urgency(today: String) -> PreTripUrgency? {
    PreTripTimeline.build(tripStartDate: CalendarDate("2026-10-13"), tripEndDate: CalendarDate("2026-10-16"),
                          authority: thailand, passportRule: nil, passportExpiry: nil,
                          today: CalendarDate(today)!).first?.urgency
  }
  #expect(urgency(today: "2026-10-09") == .scheduled)
  #expect(urgency(today: "2026-10-10") == .due_soon)   // the day it opens
  #expect(urgency(today: "2026-10-13") == .due_soon)   // the arrival day itself still counts
  #expect(urgency(today: "2026-10-14") == .overdue)
}

/// A plain deadline (ESTA: have it 3 days before departure) is "due soon" for exactly the
/// last seven days before that deadline, and overdue only once the deadline is behind us.
@Test func aDeadlineIsDueSoonForSevenDaysAndNotAnHourLonger() {
  let esta = Destinations.entryAuthority(Destinations.byId(.usa))
  func item(today: String) -> PreTripItem? {
    PreTripTimeline.build(tripStartDate: CalendarDate("2026-10-13"), tripEndDate: CalendarDate("2026-10-16"),
                          authority: esta, passportRule: nil, passportExpiry: nil,
                          today: CalendarDate(today)!).first
  }
  #expect(PreTripTimeline.dueSoonDays == 7)
  #expect(item(today: "2026-08-23")?.dueDate == CalendarDate("2026-10-10"))   // 13th − 3 days
  #expect(item(today: "2026-10-02")?.urgency == .scheduled)                   // 8 days out
  #expect(item(today: "2026-10-03")?.urgency == .due_soon)                    // 7 days out
  #expect(item(today: "2026-10-10")?.urgency == .due_soon)
  #expect(item(today: "2026-10-11")?.urgency == .overdue)
  #expect(item(today: "2026-10-03")?.label[.ja]?.contains("2026-10-10までに申請") == true)
}

/// ETIAS has not launched. It must never read as a to-do with a date, in either language.
@Test func etiasIsANoteUntilItLaunches() {
  for id in [DestinationId.switzerland, .france, .italy] {
    let items = PreTripTimeline.build(
      tripStartDate: CalendarDate("2026-10-13"), tripEndDate: CalendarDate("2026-10-16"),
      authority: Destinations.entryAuthority(Destinations.byId(id)), passportRule: nil, passportExpiry: nil,
      today: CalendarDate("2026-08-23")!
    )
    #expect(items.count == 1)
    #expect(items[0].id == "authority-ETIAS")
    #expect(items[0].urgency == .info)
    #expect(items[0].dueDate == nil)
    #expect(items[0].label[.ja]?.contains("現時点では不要") == true)
    #expect(items[0].label[.en]?.contains("not required yet") == true)
    #expect(items[0].url == "https://travel-europe.europa.eu/etias_en")
  }
}

/// Inside its window the waiver reads as a waiver, and the detail is the official summary
/// either way — the label is the only thing the date changes.
@Test func theKoreanWaiverStillCoversTripsInsideItsWindow() {
  let korea = Destinations.byId(.korea)
  let items = PreTripTimeline.build(
    tripStartDate: CalendarDate("2026-11-01"), tripEndDate: CalendarDate("2026-11-04"),
    authority: Destinations.entryAuthority(korea), passportRule: Destinations.passportRule(korea),
    passportExpiry: CalendarDate("2030-01-01"), today: CalendarDate("2026-08-23")!
  )
  let keta = items.first { $0.id == "authority-K-ETA" }
  #expect(keta?.urgency == .info)
  #expect(keta?.label[.ja]?.contains("現在免除") == true)
  #expect(keta?.detail[.ja] == Destinations.entryAuthority(korea)?.summary[.ja])
  // Valid-for-the-stay rule, met: the passport line says so rather than staying silent.
  #expect(items.first { $0.id == "passport" }?.urgency == .info)
  #expect(items.first { $0.id == "passport" }?.label[.ja]?.contains("OK") == true)
}

/// A trip without dates cannot have deadlines. Every item drops to a note, and nothing
/// invents a date from today.
@Test func anUndatedTripHasNoDeadlinesAtAll() {
  let switzerland = Destinations.byId(.switzerland)
  let items = PreTripTimeline.build(
    tripStartDate: nil, tripEndDate: nil,
    authority: Destinations.entryAuthority(Destinations.byId(.usa)),
    passportRule: Destinations.passportRule(switzerland),
    passportExpiry: CalendarDate("2027-01-01"), today: CalendarDate("2026-08-23")!
  )
  #expect(items.count == 2)
  #expect(items.allSatisfy { $0.urgency == .info })
  #expect(items.allSatisfy { $0.dueDate == nil })
  #expect(items.first { $0.id == "passport" }?.label[.ja]?.contains("残り何ヶ月か") == true)
  #expect(items.first { $0.id == "authority-ESTA" }?.label[.ja]?.contains("渡航前に取得が必要") == true)
}

/// The Schengen rule has a second condition this product cannot see (issued within the last
/// ten years). When the expiry clears, the item says what is still unchecked instead of
/// declaring the passport fine.
@Test func aMetExpiryStillNamesTheConditionWeCannotCheck() {
  let items = PreTripTimeline.build(
    tripStartDate: CalendarDate("2026-10-13"), tripEndDate: CalendarDate("2026-10-16"),
    authority: nil, passportRule: Destinations.passportRule(Destinations.byId(.switzerland)),
    passportExpiry: CalendarDate("2030-01-01"), today: CalendarDate("2026-08-23")!
  )
  #expect(items[0].urgency == .info)
  #expect(items[0].label[.ja]?.contains("10年以内") == true)
  #expect(items[0].label[.en]?.contains("issued within the last 10 years") == true)
}

/// The order is the whole point of the list: blockers, then dated to-dos by date, notes last.
@Test func loudestFirstThenByDateThenNotes() {
  let overdue = PreTripTimeline.build(
    tripStartDate: CalendarDate("2026-10-13"), tripEndDate: CalendarDate("2026-10-16"),
    authority: Destinations.entryAuthority(Destinations.byId(.usa)),
    passportRule: Destinations.passportRule(Destinations.byId(.usa)),
    passportExpiry: CalendarDate("2026-10-01"), today: CalendarDate("2026-08-23")!
  )
  // The US rule is valid-for-the-stay: an expiry inside the trip is a blocker, the ESTA is
  // a dated to-do, and the blocker comes first even though the ESTA has the earlier date.
  #expect(overdue.map(\.urgency) == [.overdue, .scheduled])
  #expect(overdue.map(\.id) == ["passport", "authority-ESTA"])
  #expect(overdue[0].dueDate == nil)     // a blocker has no do-by day; it sorts on rank alone
}

/// The detail is ALWAYS the official summary — the label carries the verdict. A rule that
/// let the verdict leak into the detail would leave "waived until 2026" sitting under a
/// trip in 2027.
@Test func theDetailIsAlwaysTheOfficialSummary() {
  let korea = Destinations.byId(.korea)
  let items = PreTripTimeline.build(
    tripStartDate: CalendarDate("2027-02-01"), tripEndDate: CalendarDate("2027-02-03"),
    authority: Destinations.entryAuthority(korea), passportRule: Destinations.passportRule(korea),
    passportExpiry: CalendarDate("2027-01-01"), today: CalendarDate("2026-08-23")!
  )
  var checked = 0
  for item in items {
    #expect(item.detail[.ja]?.isEmpty == false)
    #expect(item.detail[.en]?.isEmpty == false)
    checked += 1
  }
  #expect(checked == 2)
  #expect(items.first { $0.id == "authority-K-ETA" }?.detail[.ja]?.contains("免除") == true)
  #expect(items.first { $0.id == "passport" }?.detail[.ja] == Destinations.passportRule(korea)?.summary[.ja])
  #expect(items.first { $0.id == "passport" }?.url == Destinations.passportRule(korea)?.sourceUrl)
}
