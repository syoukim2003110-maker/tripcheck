import Foundation

/// lib/wishlist-parser.ts:10 — `WishlistPriority`
public enum WishlistPriority: String, Equatable, Sendable {
  case must, optional, normal
}

/// lib/wishlist-parser.ts:12 — `WishlistTimeOfDay`. `Codable` added for Task 9's
/// `WishlistStopConstraint.timeOfDay` (`lib/trip-builder.ts:169`); no other consumer needed it yet.
public enum WishlistTimeOfDay: String, Equatable, Sendable, Codable {
  case morning, evening, night
}

/// lib/wishlist-parser.ts:14-22 — `ParsedWishlistPlace`
public struct ParsedWishlistPlace: Equatable, Sendable {
  public var name: String
  public var day: Int?
  public var time: String?
  public var timeOfDay: WishlistTimeOfDay?
  public var isReservation: Bool
  public var priority: WishlistPriority
  public var stayMinutes: Int?

  public init(
    name: String,
    day: Int?,
    time: String?,
    timeOfDay: WishlistTimeOfDay?,
    isReservation: Bool,
    priority: WishlistPriority,
    stayMinutes: Int?
  ) {
    self.name = name
    self.day = day
    self.time = time
    self.timeOfDay = timeOfDay
    self.isReservation = isReservation
    self.priority = priority
    self.stayMinutes = stayMinutes
  }
}

/// lib/wishlist-parser.ts:29-33 — `ParsedWishlistLine`
public enum ParsedWishlistLine: Equatable, Sendable {
  case empty(raw: String)
  case heading(raw: String, day: Int)
  case unparsed(raw: String)
  case place(raw: String, places: [ParsedWishlistPlace])
}

/// lib/wishlist-parser.ts — 共有ウィッシュリストリーダー。パース結果はコンポーザーのプレビュー、
/// Google 場所解決クエリ、トリップビルダーが共通で消費するので、ユーザーに見える認識結果と
/// 実際に計画される内容が常に一致する。マーカー語は行のどこにあっても検出されるが(日本語は
/// 空白を使わないことが多いため)、安全な境界にある場合にのみ場所名から取り除かれる。
public enum WishlistParser {
  private enum Meridiem { case am, pm }

  /// lib/wishlist-parser.ts:239-399 — `parseWishlist`
  public static func parse(_ raw: String) -> [ParsedWishlistLine] {
    var lines: [ParsedWishlistLine] = []
    var contextDay: Int? = nil
    var calendarHeadingCount = 0
    var calendarAnchorEpochDay: Int? = nil
    var previousCalendarDate: (year: Int, month: Int, day: Int)? = nil

    for rawLine in raw.components(separatedBy: "\n") {
      let original = rawLine.trimmingCharacters(in: .whitespacesAndNewlines)
      if original.isEmpty {
        lines.append(.empty(raw: rawLine))
        continue
      }

      var text = stripBullet(
        original.precomposedStringWithCompatibilityMapping
          .replacingOccurrences(of: "～", with: "~")
          .replacingOccurrences(of: "〜", with: "~")
      )

      var lineDay: Int? = nil
      var heading: JSRegex.Match? = nil
      if let m = WishlistPatterns.headingLead.firstMatch(in: text) {
        heading = m
        if let day = headingDay(m) {
          contextDay = day
          let rest = String(text[m.range.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
          if rest.isEmpty {
            lines.append(.heading(raw: original, day: day))
            continue
          }
          lineDay = day
          text = rest
        }
      }

      if heading == nil, let calMatch = WishlistPatterns.calendarHeadingLead.firstMatch(in: text) {
        let parts = parsedCalendarHeadingDate(calMatch)
        var calendarDay: Int? = nil
        if let parts {
          var year = parts.year ?? previousCalendarDate?.year ?? 2000
          if parts.year == nil, let prev = previousCalendarDate,
             parts.month < prev.month || (parts.month == prev.month && parts.day < prev.day) {
            year += 1
          }
          if let cd = CalendarDate(year: year, month: parts.month, day: parts.day) {
            let epochDay = cd.epochDay
            if calendarAnchorEpochDay == nil { calendarAnchorEpochDay = epochDay }
            let offset = epochDay - calendarAnchorEpochDay!
            if offset >= 0, offset < 30 {
              calendarDay = offset + 1
              previousCalendarDate = (year: year, month: parts.month, day: parts.day)
            }
          }
        }
        // Retain the legacy sequential fallback only for malformed, backwards,
        // or out-of-range headings. Valid supported dates never lose gaps.
        calendarHeadingCount += 1
        let day = calendarDay ?? calendarHeadingCount
        contextDay = day
        calendarHeadingCount = max(calendarHeadingCount, day)
        let rest = String(text[calMatch.range.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
        if rest.isEmpty {
          lines.append(.heading(raw: original, day: day))
          continue
        }
        lineDay = day
        text = rest
      }

      if lineDay == nil, let inlineDay = WishlistPatterns.dayAnywhere.firstMatch(in: text) {
        let dayText = inlineDay.groups[0] ?? inlineDay.groups[1] ?? inlineDay.groups[2] ?? inlineDay.groups[3]
        if let dayText, let day = Int(dayText), (1...30).contains(day) {
          lineDay = day
        }
        text = WishlistPatterns.dayToken.replacingAll(in: text, with: " ")
      }

      // Opening-hours style ranges ("9:00-17:00", "9時~17時") are notes, not a
      // requested visit time; drop them and never pin a time from this line.
      let hadRange = WishlistPatterns.timeRange.test(text)
      if hadRange {
        text = WishlistPatterns.timeRange.replacingAll(in: text, with: " ")
      }

      var stayMinutes: Int? = nil
      for pattern in WishlistPatterns.stayPatterns {
        if let m = pattern.firstMatch(in: text) {
          // Each entry in `stayPatterns` has exactly one capture group, so `groups` always
          // has length 1 here — indexing past [0] would trap.
          let valueText = m.groups[0]
          if let valueText, let value = Int(valueText) {
            stayMinutes = min(480, max(15, value))
          }
          text = pattern.replacingAll(in: text, with: " ")
        }
      }

      var time: String? = nil
      var timeWasReservation = false
      if !hadRange, let m = WishlistPatterns.timeWithAffixes.firstMatch(in: text) {
        let matched = String(text[m.range])
        let lowerMatched = matched.lowercased()
        let meridiem: Meridiem? = matched.contains("午後") || lowerMatched.contains("pm") ? .pm
          : matched.contains("午前") || lowerMatched.contains("am") ? .am
          : nil
        if let colon = m.groups[0] {
          let parts = colon.split(separator: ":", omittingEmptySubsequences: false)
          if parts.count == 2, let hour = Int(parts[0]), let minute = Int(parts[1]) {
            time = toClock(hour: hour, minute: minute, meridiem: meridiem)
          }
        } else if let kanjiHour = m.groups[1], let hour = Int(kanjiHour) {
          let minute: Int
          if m.groups[2] != nil {
            minute = 30
          } else if let minuteText = m.groups[3], let value = Int(minuteText) {
            minute = value
          } else {
            minute = 0
          }
          time = toClock(hour: hour, minute: minute, meridiem: meridiem)
        }
        if time != nil {
          timeWasReservation = matched.contains("@") || matched.contains("予約")
          text = String(text[text.startIndex..<m.range.lowerBound]) + " " + String(text[m.range.upperBound...])
        }
      }

      let isReservation = WishlistPatterns.reservationAnywhere.test(text) || timeWasReservation
      let isMust = WishlistPatterns.mustAnywhere.test(text)
      let isOptional = !isMust && WishlistPatterns.optionalAnywhere.test(text)

      var timeOfDay: WishlistTimeOfDay? = nil
      if time == nil {
        let candidates: [(JSRegex, WishlistTimeOfDay)] = [
          (WishlistPatterns.eveningToken, .evening),
          (WishlistPatterns.nightToken, .night),
          (WishlistPatterns.morningToken, .morning),
        ]
        for (token, value) in candidates {
          if token.test(text) {
            timeOfDay = value
            text = token.replacingAll(in: text, with: " ")
            break
          }
        }
      }

      text = WishlistPatterns.reservationToken.replacingAll(in: text, with: " ")
      text = WishlistPatterns.mustToken.replacingAll(in: text, with: " ")
      text = WishlistPatterns.optionalToken.replacingAll(in: text, with: " ")
      text = WishlistPatterns.urlPattern.replacingAll(in: text, with: " ")

      let day = lineDay ?? contextDay
      let priority: WishlistPriority = (isMust || isReservation) ? .must : (isOptional ? .optional : .normal)
      let names = splitPlaces(tidyName(text))
      if names.isEmpty {
        lines.append(.unparsed(raw: original))
        continue
      }
      let places = names.map {
        ParsedWishlistPlace(
          name: $0,
          day: day,
          time: time,
          timeOfDay: timeOfDay,
          isReservation: isReservation,
          priority: priority,
          stayMinutes: stayMinutes
        )
      }
      lines.append(.place(raw: original, places: places))
    }

    return lines
  }

  /// lib/wishlist-parser.ts:401-403 — `parsedWishlistPlaces`
  public static func places(_ raw: String) -> [ParsedWishlistPlace] {
    parse(raw).flatMap { line -> [ParsedWishlistPlace] in
      if case .place(_, let places) = line { return places }
      return []
    }
  }

  // MARK: - Helpers (lib/wishlist-parser.ts:75-238)

  /// lib/wishlist-parser.ts:75-81 — `toClock`
  private static func toClock(hour hourRaw: Int, minute minuteRaw: Int, meridiem: Meridiem?) -> String? {
    var hour = hourRaw
    if meridiem == .pm, hour < 12 { hour += 12 }
    if meridiem == .am, hour == 12 { hour = 0 }
    if hour > 23 { return nil }
    return String(format: "%02d:%02d", hour, minuteRaw)
  }

  /// lib/wishlist-parser.ts:83-88 — `stripBullet`
  private static func stripBullet(_ line: String) -> String {
    var value = WishlistPatterns.bulletLead.replacingAll(in: line, with: "")
    value = WishlistPatterns.numberedLead.replacingAll(in: value, with: "")
    return value.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// lib/wishlist-parser.ts:90-106 — `tidyName`
  private static func tidyName(_ value: String) -> String {
    var result = value
    result = WishlistPatterns.parenResidue.replacingAll(in: result, with: "")
    result = WishlistPatterns.emptyQuotes.replacingAll(in: result, with: "")
    result = WishlistPatterns.separatorRun.replacingAll(in: result, with: " ")
    result = WishlistPatterns.edgeSepLeading.replacingAll(in: result, with: "")
    result = WishlistPatterns.edgeSepTrailing.replacingAll(in: result, with: "")
    result = WishlistPatterns.multiSpace.replacingAll(in: result, with: " ")
    return result.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  /// lib/wishlist-parser.ts:108-110 — `hasCjk`
  private static func hasCjk(_ value: String) -> Bool {
    WishlistPatterns.cjkPattern.test(value)
  }

  /// lib/wishlist-parser.ts:112-121 — `topLevelMiddleDotCount`
  private static func topLevelMiddleDotCount(_ value: String) -> Int {
    var depth = 0
    var count = 0
    for character in value {
      if character == "(" || character == "[" || character == "【" {
        depth += 1
      } else if character == ")" || character == "]" || character == "】" {
        depth = max(0, depth - 1)
      } else if depth == 0, character == "・" {
        count += 1
      }
    }
    return count
  }

  /// lib/wishlist-parser.ts:129-166 — `splitTopLevel`
  private static func splitTopLevel(_ value: String, forceMiddleDot: Bool = false) -> [String] {
    var pieces: [String] = []
    var current = ""
    var depth = 0
    let middleDotIsList = forceMiddleDot
      || topLevelMiddleDotCount(value) >= 2
      || WishlistPatterns.middleDotSpacing.test(value)
    let slashParts = value.components(separatedBy: CharacterSet(charactersIn: "/／")).filter { !$0.isEmpty }
    let slashIsList = slashParts.allSatisfy { hasCjk($0) }

    func flush() {
      let clean = tidyName(current)
      if !clean.isEmpty { pieces.append(clean) }
      current = ""
    }

    for character in value {
      if character == "(" || character == "[" || character == "【" {
        depth += 1
        current.append(character)
        continue
      }
      if character == ")" || character == "]" || character == "】" {
        depth = max(0, depth - 1)
        current.append(character)
        continue
      }
      let separator = depth == 0 && (
        character == "、"
          || character == "，"
          || (character == "," && hasCjk(value))
          || ((character == "/" || character == "／") && slashIsList)
          || (character == "・" && middleDotIsList)
      )
      if separator {
        flush()
      } else {
        current.append(character)
      }
    }
    flush()
    return pieces
  }

  /// lib/wishlist-parser.ts:170-184 — `expandParentheticalPlace`
  private static func expandParentheticalPlace(_ value: String) -> [String] {
    guard let match = WishlistPatterns.parenGroupPattern.firstMatch(in: value),
          let baseRaw = match.groups[0], let detailRaw = match.groups[1] else { return [value] }
    let base = tidyName(baseRaw)
    let detail = tidyName(detailRaw)
    if base.isEmpty || detail.isEmpty { return [value] }
    let detailPieces = splitTopLevel(detail, forceMiddleDot: true)
    if detailPieces.count > 1 {
      return [base] + detailPieces.map { piece in
        piece.utf16.count <= 2 || piece == "竹林" ? "\(base) \(piece)" : piece
      }
    }
    if WishlistPatterns.parentheticalLandmark.test(detail) { return [base, detail] }
    // A short regional qualifier such as 天橋立（丹後） should guide Google,
    // not become a second, vague stop of its own.
    return ["\(base) \(detail)"]
  }

  /// lib/wishlist-parser.ts:186-191 — `splitPlaces`
  private static func splitPlaces(_ name: String) -> [String] {
    splitTopLevel(name)
      .flatMap { expandParentheticalPlace($0) }
      .map { tidyName($0) }
      .filter { !$0.isEmpty }
  }

  /// lib/wishlist-parser.ts:233-237 — `headingDay`
  private static func headingDay(_ match: JSRegex.Match) -> Int? {
    guard let text = match.groups[0] ?? match.groups[1] ?? match.groups[2] ?? match.groups[3],
          let day = Int(text), (1...30).contains(day) else { return nil }
    return day
  }

  private struct CalendarHeadingDate {
    let year: Int?
    let month: Int
    let day: Int
  }

  /// lib/wishlist-parser.ts:216-225 — `parsedCalendarHeadingDate`
  private static func parsedCalendarHeadingDate(_ match: JSRegex.Match) -> CalendarHeadingDate? {
    let isoYear = match.groups[0].flatMap { Int($0) }
    let isoMonth = match.groups[1].flatMap { Int($0) }
    let isoDay = match.groups[2].flatMap { Int($0) }
    let japaneseYear = match.groups[3].flatMap { Int($0) }
    let japaneseMonth = match.groups[4].flatMap { Int($0) }
    let japaneseDay = match.groups[5].flatMap { Int($0) }
    let englishMonthName = match.groups[6]
    let englishDay = match.groups[7].flatMap { Int($0) }
    let englishYear = match.groups[8].flatMap { Int($0) }

    let monthName = englishMonthName.map { String($0.prefix(3)).lowercased() }
    let month = isoMonth ?? japaneseMonth ?? monthName.flatMap { WishlistPatterns.englishMonths[$0] }
    let day = isoDay ?? japaneseDay ?? englishDay
    guard let month, let day, (1...12).contains(month), (1...31).contains(day) else { return nil }
    return CalendarHeadingDate(year: isoYear ?? japaneseYear ?? englishYear, month: month, day: day)
  }
}
