import Foundation

/// lib/wishlist-parser.ts:~600 — the patch object accepted by `updateWishlistPlaceConstraints`.
/// TS models it as `Partial<Pick<ParsedWishlistPlace, "priority" | "time" | "timeOfDay" | "isReservation" | "stayMinutes">>`
/// with `time`/`timeOfDay`/`stayMinutes` also accepting an explicit `null` to clear the field. A plain
/// Swift `Optional` cannot distinguish "key absent" from "key: null", so those three fields use a
/// double `Optional`: `nil` (outer) = key absent → keep the original value; `.some(nil)` = explicit
/// null → clear the field; `.some(.some(x))` = a proposed value to validate and apply.
/// `priority` and `isReservation` have no "clear" concept in TS (they are `T | undefined` only), so
/// they stay plain Optionals.
public struct WishlistPlaceConstraintPatch: Sendable {
  public var priority: WishlistPriority?
  public var time: String??
  public var timeOfDay: WishlistTimeOfDay??
  public var isReservation: Bool?
  public var stayMinutes: Int??

  public init(
    priority: WishlistPriority? = nil,
    time: String?? = nil,
    timeOfDay: WishlistTimeOfDay?? = nil,
    isReservation: Bool? = nil,
    stayMinutes: Int?? = nil
  ) {
    self.priority = priority
    self.time = time
    self.timeOfDay = timeOfDay
    self.isReservation = isReservation
    self.stayMinutes = stayMinutes
  }
}

/// lib/wishlist-parser.ts:401-615 — serializing parsed places back to text, and editing one
/// occurrence of the textual source of truth without disturbing any other line's bytes.
public enum WishlistSerializer {
  /// lib/wishlist-parser.ts:592 — the clock-time validity check inside `normalizeConstraintPatch`.
  private static let strictClockTime = try! JSRegex("^([01]\\d|2[0-3]):[0-5]\\d$")

  /// lib/wishlist-parser.ts:615 -- blank-run collapse (three-or-more newlines to two) before the final trim.
  private static let blankRunCollapse = try! JSRegex("\\n{3,}")

  /// lib/wishlist-parser.ts:405-424 — `formatParsedWishlistPlaces`. Serializes already-reviewed
  /// places without carrying opaque/unparsed lines.
  public static func formatPlaces(_ places: [ParsedWishlistPlace], languageCode: PlannerLocale) -> String {
    var output: [String] = []
    var visibleDay: Int? = nil
    for place in places {
      if let day = place.day, day != visibleDay {
        output.append(dayHeading(day, languageCode: languageCode))
        visibleDay = day
      }
      output.append(serializeWishlistPlaceLine(place, languageCode: languageCode))
    }
    return output.joined(separator: "\n")
  }

  /// lib/wishlist-parser.ts:430-450 — `formatWishlistLines`. Converts a free-form paste into the
  /// strict one-place-per-line form shown by the UI; unparsed/private lines survive trimmed.
  public static func formatLines(_ raw: String, languageCode: PlannerLocale) -> String {
    var output: [String] = []
    var visibleDay: Int? = nil
    for line in WishlistParser.parse(raw) {
      switch line {
      case .empty, .heading:
        continue
      case .unparsed(let rawText):
        output.append(JSText.trim(rawText))
      case .place(_, let places):
        for place in places {
          if let day = place.day, day != visibleDay {
            output.append(dayHeading(day, languageCode: languageCode))
            visibleDay = day
          }
          output.append(serializeWishlistPlaceLine(place, languageCode: languageCode))
        }
      }
    }
    return output.joined(separator: "\n")
  }

  /// lib/wishlist-parser.ts:476-509 — `removeWishlistPlace` (v1.1 TC-020). Removes one occurrence
  /// from the textual source of truth. Every OTHER source line stays byte-identical — day headings,
  /// annotations, private notes and formatting all survive verbatim, taken straight from `raw`'s own
  /// lines. Only the removed occurrence's own line changes: a single-place line disappears entirely,
  /// while a multi-place line is re-serialized without the removed occurrence (re-emitting its day
  /// heading when the line itself carried the day).
  public static func removePlace(raw: String, occurrenceIndex: Int, languageCode: PlannerLocale = .en) -> String {
    guard occurrenceIndex >= 0 else { return raw }
    // parseWishlist pushes exactly one entry per source line, so entry N maps onto
    // raw.split("\n")[N] and untouched lines can be kept verbatim.
    let parsed = WishlistParser.parse(raw)
    var sourceLines = raw.components(separatedBy: "\n")
    var cursor = 0
    var contextDay: Int? = nil
    for (lineIndex, line) in parsed.enumerated() {
      switch line {
      case .heading(_, let day):
        contextDay = day
      case .empty, .unparsed:
        break
      case .place(_, let places):
        if occurrenceIndex < cursor + places.count {
          let localIndex = occurrenceIndex - cursor
          let remaining = places.enumerated().filter { $0.offset != localIndex }.map(\.element)
          var replacement: [String] = []
          var visibleDay = contextDay
          for place in remaining {
            if let day = place.day, day != visibleDay {
              replacement.append(dayHeading(day, languageCode: languageCode))
              visibleDay = day
            }
            replacement.append(serializeWishlistPlaceLine(place, languageCode: languageCode))
          }
          sourceLines.replaceSubrange(lineIndex...lineIndex, with: replacement)
          return sourceLines.joined(separator: "\n")
        }
        cursor += places.count
        // A place line can itself establish the running day for later lines.
        if let lineDay = places.last?.day {
          contextDay = lineDay
        }
      }
    }
    return raw
  }

  /// lib/wishlist-parser.ts:511-521 — `setWishlistPlacePriority`. Applies a Must/Optional choice
  /// from the chip UI without introducing a second hidden source of truth.
  public static func setPriority(
    raw: String,
    occurrenceIndex: Int,
    priority: WishlistPriority,
    languageCode: PlannerLocale = .en
  ) -> String {
    updateConstraints(raw: raw, occurrenceIndex: occurrenceIndex, patch: .init(priority: priority), languageCode: languageCode)
  }

  /// lib/wishlist-parser.ts:590-615 — `updateWishlistPlaceConstraints`. Applies one occurrence's
  /// structured constraints while retaining a single, shareable textual source of truth.
  /// Unparsed/private lines survive (trimmed for headings, verbatim for unparsed); place lines are
  /// always re-serialized in canonical form, which is byte-identical to already-canonical input.
  public static func updateConstraints(
    raw: String,
    occurrenceIndex: Int,
    patch: WishlistPlaceConstraintPatch,
    languageCode: PlannerLocale = .en
  ) -> String {
    let parsed = WishlistParser.parse(raw)
    let placeCount = parsed.reduce(0) { count, line in
      if case .place(_, let places) = line { return count + places.count }
      return count
    }
    guard occurrenceIndex >= 0, occurrenceIndex < placeCount else { return raw }

    var output: [String] = []
    var visibleDay: Int? = nil
    var cursor = 0
    for line in parsed {
      switch line {
      case .empty:
        if output.last != "" { output.append("") }
      case .heading(let rawText, let day):
        visibleDay = day
        output.append(JSText.trim(rawText))
      case .unparsed(let rawText):
        output.append(rawText)
      case .place(_, let places):
        for original in places {
          let place = cursor == occurrenceIndex ? normalizeConstraintPatch(original, patch: patch) : original
          cursor += 1
          if let day = place.day, day != visibleDay {
            output.append(dayHeading(day, languageCode: languageCode))
            visibleDay = day
          }
          output.append(serializeWishlistPlaceLine(place, languageCode: languageCode))
        }
      }
    }
    let joined = blankRunCollapse.replacingAll(in: output.joined(separator: "\n"), with: "\n\n")
    return JSText.trim(joined)
  }

  // MARK: - Helpers (lib/wishlist-parser.ts:426-429, 458-466, 592-615)

  /// lib/wishlist-parser.ts:426-429/447-449 — the `${day}日目` / `Day ${day}` heading text.
  private static func dayHeading(_ day: Int, languageCode: PlannerLocale) -> String {
    languageCode == .ja ? "\(day)日目" : "Day \(day)"
  }

  private static func jaTimeOfDayLabel(_ value: WishlistTimeOfDay) -> String {
    switch value {
    case .morning: return "朝"
    case .evening: return "夕方"
    case .night: return "夜"
    }
  }

  /// lib/wishlist-parser.ts:458-466 — `serializeWishlistPlaceLine`. `name — [Day N | N日目] [HH:MM |
  /// morning/evening/night label] [booked|予約 / must|必須] [optional|時間があれば] [stay N min|滞在N分]`.
  private static func serializeWishlistPlaceLine(_ place: ParsedWishlistPlace, languageCode: PlannerLocale) -> String {
    let timeOfDayLabel = place.timeOfDay.map { languageCode == .ja ? jaTimeOfDayLabel($0) : $0.rawValue }
    let bookedOrMustLabel: String?
    if place.isReservation {
      bookedOrMustLabel = languageCode == .ja ? "予約" : "booked"
    } else if place.priority == .must {
      bookedOrMustLabel = languageCode == .ja ? "必須" : "must"
    } else {
      bookedOrMustLabel = nil
    }
    let optionalLabel: String? = place.priority == .optional ? (languageCode == .ja ? "時間があれば" : "optional") : nil
    let stayLabel: String?
    if let minutes = place.stayMinutes, minutes != 0 {
      stayLabel = languageCode == .ja ? "滞在\(minutes)分" : "stay \(minutes) min"
    } else {
      stayLabel = nil
    }
    let markers = [place.time ?? timeOfDayLabel, bookedOrMustLabel, optionalLabel, stayLabel].compactMap { $0 }
    return ([place.name] + markers).joined(separator: " — ")
  }

  /// lib/wishlist-parser.ts:592-615 — `normalizeConstraintPatch`. Invalid proposed values (a clock
  /// string that fails the strict `HH:MM` pattern, an out-of-range/absent-key stay) are ignored and
  /// fall back to `original`; a fixed booking always forces `priority` to `.must`; a precise clock
  /// and a broad time-of-day hint are mutually exclusive.
  private static func normalizeConstraintPatch(
    _ original: ParsedWishlistPlace,
    patch: WishlistPlaceConstraintPatch
  ) -> ParsedWishlistPlace {
    let priority = patch.priority ?? original.priority
    let isReservation = patch.isReservation ?? original.isReservation

    let time: String?
    switch patch.time {
    case .none:
      time = original.time
    case .some(.none):
      time = nil
    case .some(.some(let proposed)):
      time = strictClockTime.test(proposed) ? proposed : original.time
    }

    let timeOfDay: WishlistTimeOfDay?
    switch patch.timeOfDay {
    case .none:
      timeOfDay = original.timeOfDay
    case .some(let proposed):
      timeOfDay = proposed
    }

    let stayMinutes: Int?
    switch patch.stayMinutes {
    case .none:
      stayMinutes = original.stayMinutes
    case .some(.none):
      stayMinutes = nil
    case .some(.some(let proposed)):
      stayMinutes = min(480, max(15, proposed))
    }

    return ParsedWishlistPlace(
      name: original.name,
      day: original.day,
      time: time,
      timeOfDay: time == nil ? timeOfDay : nil,
      isReservation: isReservation,
      priority: isReservation ? .must : priority,
      stayMinutes: stayMinutes
    )
  }
}
