import Foundation

/*
 * The dated half of "before you go": entry authorisations and passport validity turned into
 * concrete do-by dates computed from the trip itself.
 *
 * Generic advice ("get an ESTA at some point") is exactly what travellers already ignore; a
 * date, a fee and an official link is what stops the check-in-counter surprise.
 *
 * Ported from `lib/pre-trip-timeline.ts` — same ids, same date arithmetic, same ordering.
 * The one shape difference is the calendar: TS does everything in `Date.UTC` milliseconds,
 * which is a fixed offset from `CalendarDate.epochDay`, so day arithmetic is subtraction
 * either way and month arithmetic is the same clamp. Nothing here reads a clock: `today`
 * arrives as an argument, which is what makes every rule below testable on a fixed date.
 */

/// TS `PreTripUrgency` (`lib/pre-trip-timeline.ts:11`) — how loudly the item should be
/// shouting. `due_soon` keeps the TS spelling because it is a stored, cross-language name.
public enum PreTripUrgency: String, Equatable, Sendable {
  case overdue, due_soon, scheduled, info
}

/// TS `PreTripItem` (`:13-23`). One row of the checklist.
public struct PreTripItem: Equatable, Sendable {
  /// `"passport"`, or `"authority-<name>"` (`"authority-ESTA"`, `"authority-K-ETA"`).
  public var id: String
  /// Do-by day; `nil` when the task has no calendar deadline.
  public var dueDate: CalendarDate?
  /// Earliest day the task CAN be done, for windowed arrival cards.
  public var opensDate: CalendarDate?
  public var urgency: PreTripUrgency
  /// The verdict for this trip — the only part the dates change.
  public var label: [PlannerLocale: String]
  /// **Always the official summary.** Never the verdict: a detail that argued with the label
  /// would leave "waived until 2026" printed under a trip in 2027.
  public var detail: [PlannerLocale: String]
  public var url: String?

  public init(
    id: String,
    dueDate: CalendarDate?,
    opensDate: CalendarDate? = nil,
    urgency: PreTripUrgency,
    label: [PlannerLocale: String],
    detail: [PlannerLocale: String],
    url: String?
  ) {
    self.id = id
    self.dueDate = dueDate
    self.opensDate = opensDate
    self.urgency = urgency
    self.label = label
    self.detail = detail
    self.url = url
  }
}

extension CalendarDate {
  /// Month arithmetic with end-of-month clamping (Jan 31 + 1 month = Feb 28/29). TS
  /// `addMonthsUtc` (`lib/pre-trip-timeline.ts:54-61`), where `Date.UTC(y, m + months, 1)`
  /// accepts a month index outside 0…11 and rolls the year — the `floorDiv`/`floorMod` pair
  /// below is that rolling, in both directions.
  public func adding(months: Int) -> CalendarDate {
    let total = year * 12 + (month - 1) + months
    // Floor division, not truncation: month index −1 is December of the previous year.
    let targetYear = total >= 0 ? total / 12 : (total - 11) / 12
    let targetMonth = total - targetYear * 12 + 1
    let lastDay = CalendarDate.daysIn(month: targetMonth, year: targetYear)
    // The clamp is what makes this month arithmetic rather than day arithmetic: a passport
    // rule reading "3 months beyond 30 November" must land on 28 February, not 2 March.
    return CalendarDate(year: targetYear, month: targetMonth, day: Swift.min(day, lastDay))!
  }
}

/// TS `buildPreTripTimeline` (`lib/pre-trip-timeline.ts:66-224`).
public enum PreTripTimeline {

  /// TS `DUE_SOON_DAYS` (`:38`). A week is the window in which a traveller can still act
  /// without paying for expedited anything.
  public static let dueSoonDays = 7

  /// Orders the destination's paperwork by how loudly it should be shouting: blockers first,
  /// then dated to-dos by date, notes last (TS `:221-224`).
  ///
  /// - Parameters:
  ///   - tripStartDate: first trip day; `nil` disables date maths and every item drops to a note.
  ///   - tripEndDate: last trip day; used by passport rules measured from departure. Falls back
  ///     to `tripStartDate`, so a one-day trip needs only a start.
  ///   - authority: the destination's entry authorisation, or `nil` to leave it out entirely.
  ///   - passportRule: the destination's passport rule, or `nil` to leave it out entirely.
  ///   - passportExpiry: the traveller's own passport expiry. **Stays on their device** — this
  ///     function is the only thing that ever reads it, and it returns text, not data.
  ///   - today: the day to measure deadlines against.
  public static func build(
    tripStartDate: CalendarDate?,
    tripEndDate: CalendarDate?,
    authority: EntryAuthority?,
    passportRule: PassportRule?,
    passportExpiry: CalendarDate?,
    today: CalendarDate
  ) -> [PreTripItem] {
    let start = tripStartDate
    let end = tripEndDate ?? tripStartDate
    var items: [PreTripItem] = []
    if let authority { items.append(authorityItem(authority, start: start, today: today)) }
    if let passportRule {
      items.append(passportItem(passportRule, start: start, end: end, expiry: passportExpiry))
    }
    // Decorated so the sort is stable: JS `Array.prototype.sort` has been stable since
    // ES2019, and two notes with no due date must keep the order they were pushed in
    // (authority, then passport) rather than whatever the sort happens to do.
    return items.enumerated()
      .sorted { left, right in
        let byRank = rank(left.element.urgency) - rank(right.element.urgency)
        if byRank != 0 { return byRank < 0 }
        // TS compares the ISO strings with `"9999"` standing in for a missing date, which is
        // greater than any real "YYYY-MM-DD" — notes sink below dated to-dos of the same rank.
        let leftDue = left.element.dueDate?.description ?? "9999"
        let rightDue = right.element.dueDate?.description ?? "9999"
        if leftDue != rightDue { return leftDue < rightDue }
        return left.offset < right.offset
      }
      .map(\.element)
  }

  // MARK: - The two rules

  /// TS `authorityItem` (`:70-142`).
  private static func authorityItem(
    _ authority: EntryAuthority,
    start: CalendarDate?,
    today: CalendarDate
  ) -> PreTripItem {
    let id = "authority-\(authority.name)"
    let name = authority.name

    func note(_ ja: String, _ en: String) -> PreTripItem {
      PreTripItem(id: id, dueDate: nil, urgency: .info, label: [.ja: ja, .en: en],
                  detail: authority.summary, url: authority.officialUrl)
    }

    switch authority.status {
    case .not_yet:
      return note(
        "\(name)：現時点では不要 — 出発前に最新状況を確認",
        "\(name): not required yet — re-check before departure"
      )
    case .waived:
      // A temporary waiver is only a waiver for trips inside its window. Which trip we are
      // asking about matters more than what day it is today, so the trip's own start date
      // wins whenever there is one.
      let validThrough = authority.statusValidUntil.flatMap { CalendarDate($0) }
      let relevant = start ?? today
      if let validThrough, relevant > validThrough {
        return note(
          "\(name)：一時免除の期間外です — 公式サイトで必要条件を再確認",
          "\(name): the temporary waiver does not cover this trip — re-check the official requirement"
        )
      }
      return note(
        "\(name)：日本のパスポートは現在免除",
        "\(name): currently waived for Japanese passports"
      )
    case .required:
      guard let start else {
        return note("\(name)：渡航前に取得が必要", "\(name): required before travel")
      }
      if let opensDaysBefore = authority.opensDaysBefore {
        // Windowed arrival cards: they cannot be filed earlier than the window opens and are
        // due by the arrival day itself. Before the window it is a calendar note; inside it,
        // a to-do now.
        let opens = start.adding(days: -opensDaysBefore)
        let urgency: PreTripUrgency = today > start ? .overdue : today >= opens ? .due_soon : .scheduled
        return PreTripItem(
          id: id,
          dueDate: start,
          opensDate: opens,
          urgency: urgency,
          label: [
            .ja: "\(name)：\(opens)から到着日までに提出",
            .en: "\(name): submit between \(opens) and arrival",
          ],
          detail: authority.summary,
          url: authority.officialUrl
        )
      }
      let due = start.adding(days: -authority.deadlineDaysBefore)
      return PreTripItem(
        id: id,
        dueDate: due,
        urgency: deadlineUrgency(due: due, today: today),
        label: [.ja: "\(name)：\(due)までに申請", .en: "\(name): apply by \(due)"],
        detail: authority.summary,
        url: authority.officialUrl
      )
    }
  }

  /// TS `passportItem` (`:144-207`).
  private static func passportItem(
    _ rule: PassportRule,
    start: CalendarDate?,
    end: CalendarDate?,
    expiry: CalendarDate?
  ) -> PreTripItem {
    func item(_ urgency: PreTripUrgency, _ ja: String, _ en: String) -> PreTripItem {
      PreTripItem(id: "passport", dueDate: nil, urgency: urgency, label: [.ja: ja, .en: en],
                  detail: rule.summary, url: rule.sourceUrl)
    }

    let reference = rule.referenceDate == .entry ? start : end
    guard let expiry, let reference else {
      return item(
        .info,
        "パスポート残存期間：期限内かではなく「残り何ヶ月か」を確認",
        "Passport validity: check the remaining months, not just the expiry"
      )
    }
    let required = reference.adding(months: rule.monthsBeyond)
    if expiry < required {
      // Not "expired" — valid, but not valid ENOUGH. The wording has to say which, because
      // a traveller who checks only the date on the cover will conclude we are wrong.
      return item(
        .overdue,
        "パスポートの残存期間がこの旅行に不足（\(required)まで必要・期限\(expiry)）— 先に更新を",
        "Passport validity is NOT enough for this trip (needs \(required), expires \(expiry)) — renew before booking"
      )
    }
    if let additional = rule.additionalCheck {
      // The expiry clears, but the rule has a second condition we cannot see (Schengen's
      // "issued within the last 10 years"). Saying "OK" here would be a guarantee we have
      // not earned.
      return item(
        .info,
        "パスポートの有効期限要件は満たしているようです（期限\(expiry)）— \(additional[.ja] ?? "")は未確認",
        "Passport expiry requirement appears met (expires \(expiry)), but \(additional[.en] ?? "") remains unchecked"
      )
    }
    return item(
      .info,
      "パスポート残存期間はこの旅行にはOK（期限\(expiry)）",
      "Passport validity OK for this trip (expires \(expiry))"
    )
  }

  // MARK: - Internals

  /// TS `deadlineUrgency` (`:63-67`).
  private static func deadlineUrgency(due: CalendarDate, today: CalendarDate) -> PreTripUrgency {
    if today > due { return .overdue }
    return due.epochDay - today.epochDay <= dueSoonDays ? .due_soon : .scheduled
  }

  /// TS `rank` (`:221`).
  private static func rank(_ urgency: PreTripUrgency) -> Int {
    switch urgency {
    case .overdue: 0
    case .due_soon: 1
    case .scheduled: 2
    case .info: 3
    }
  }
}
