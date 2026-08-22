import Foundation

/*
 * どこまで見せるかを決めてから作る、公開用の荷物。
 *
 * 移植元は `lib/share-scope.ts` 全 324 行:`MAX_SHARE_FRAGMENT_CHARS` `:13`、型 `:15-42`、
 * `manualStopId` `:44-49`、`providerStopId` `:51-53`、`buildResolutionRemap` `:55-123`、
 * `remapRecord` `:125-139`、`remapLegModes` `:141-163`、`remapLockedOrder` `:165-182`、
 * `remapRemovedStops` `:184-206`、`buildScopedTripShare` `:208-324`。
 *
 * 読み取れなかった行は、墨消ししたはずの URL へ**決して**写さない —— その行に予約番号や
 * メールアドレスや部屋番号が入っていないことを parser は証明できないので、落として、
 * 落としたことを旅行者に伝える。
 */

// MARK: - 型

/// TS `ShareScope`(`lib/share-scope.ts:15-20`)。Swift 側の名前空間が `ShareScope` なので
/// 選択そのものは `ShareScopeOptions`。
public struct ShareScopeOptions: Equatable, Sendable {
  public var dates: Bool
  public var hotel: Bool
  public var airports: Bool
  public var reservations: Bool

  public init(dates: Bool, hotel: Bool, airports: Bool, reservations: Bool) {
    self.dates = dates
    self.hotel = hotel
    self.airports = airports
    self.reservations = reservations
  }
}

/// TS `ShareWarningCode`(`:22-28`)
public enum ShareWarningCode: String, Equatable, Sendable, CaseIterable {
  case URL_VISIBLE_TO_RECIPIENTS
  case URL_VISIBLE_IN_BROWSER_HISTORY
  case RESERVATION_DETAILS_INCLUDED
  case UNPARSED_LINES_OMITTED
  case LINK_TOO_LONG
  case NO_SHAREABLE_PLACES
}

/// TS `ScopedShareResult`(`:30-37`)。`blocked` が真なら `code` は無い —— 壊れやすい URL を
/// 黙って作るより、作らなかったと言うほうがいい。
public struct ScopedShareResult: Equatable, Sendable {
  public var input: ShareableTripInput?
  public var code: String?
  public var warnings: [ShareWarningCode]
  public var omittedUnparsedLines: Int
  public var redactedReservationCount: Int
  public var blocked: Bool
}

// MARK: - 墨消し

public enum ShareScope {

  /// TS `MAX_SHARE_FRAGMENT_CHARS`(`:13`)
  public static let maxFragmentChars = 6_000

  /// JS の `\b`。ICU の `\b` は Unicode の語構成文字を見るが、JS の `u` フラグ付き `\b` は
  /// `\w = [A-Za-z0-9_]` のまま。日本語の行で境目がずれるので、前後読みで書き下す
  /// (`Core/JSText.swift` の `wordBoundary` が同じ綴りを持つ唯一の定義)。
  private static let wordBoundary = JSText.wordBoundary

  /// TS `:221` —— URL かメールアドレスを含む行。`\s` は ICU と中身が違うので明示する。
  private static let opaqueContactPattern = try! JSRegex(
    "https?://|\(wordBoundary)[^\(JSText.whitespaceClass)@]+@[^\(JSText.whitespaceClass)@]+\\.[^\(JSText.whitespaceClass)@]+\(wordBoundary)",
    options: [.caseInsensitive]
  )

  /// TS `:222` —— 予約番号らしきものを含む行。`\D` は ICU では Unicode の数字以外なので `[^0-9]`。
  private static let opaqueReferencePattern = try! JSRegex(
    "(?:booking|confirmation|reference|ref\\.?|pnr|reservation[\(JSText.whitespaceClass)]*(?:no|number)|予約番号|確認番号|照会番号)"
      + "[^0-9]{0,12}[A-Z0-9-]{5,}",
    options: [.caseInsensitive]
  )

  /// TS `:220-223` —— この行は「何が書いてあるか分からない」ので共有しない。
  static func isSensitiveOpaqueLine(_ raw: String) -> Bool {
    opaqueContactPattern.test(raw) || opaqueReferencePattern.test(raw)
  }

  /// TS `buildScopedTripShare`(`:214-324`)。
  public static func scoped(
    _ source: ShareableTripInput,
    scope: ShareScopeOptions,
    locale: PlannerLocale = .en
  ) -> ScopedShareResult {
    let parsed = WishlistParser.parse(source.itinerary)
    let omittedUnparsedLines = parsed.filter { line in
      switch line {
      case .unparsed: return true
      case .place(let raw, _): return isSensitiveOpaqueLine(raw)
      default: return false
      }
    }.count

    var places: [ParsedWishlistPlace] = []
    var sourceToSharedIndex: [Int: Int] = [:]
    var stableOwnership: [String: (retained: Bool, dropped: Bool)] = [:]
    var sourcePlaceIndex = 0
    for line in parsed {
      guard case .place(let raw, let linePlaces) = line else { continue }
      let omitLine = isSensitiveOpaqueLine(raw)
      for place in linePlaces {
        let sourceIndex = sourcePlaceIndex
        sourcePlaceIndex += 1
        for stop in Catalog.resolveKnownStops(place.name, locale: locale) {
          var ownership = stableOwnership[stop.id] ?? (retained: false, dropped: false)
          if omitLine { ownership.dropped = true } else { ownership.retained = true }
          stableOwnership[stop.id] = ownership
        }
        if omitLine { continue }
        sourceToSharedIndex[sourceIndex] = places.count
        places.append(place)
      }
    }

    let redactedReservationCount = scope.reservations ? 0 : places.filter(\.isReservation).count
    let sharePlaces = places.map { place -> ParsedWishlistPlace in
      guard !scope.reservations, place.isReservation else { return place }
      // 予約済みの訪問は Must として守られたまま、予約時刻と予約の印は送り主の端末に残る。
      var redacted = place
      redacted.time = nil
      redacted.isReservation = false
      redacted.priority = .must
      return redacted
    }
    let itinerary = WishlistSerializer.formatPlaces(sharePlaces, languageCode: locale)
    let retainedAuthoredNames = Set(places.map(\.name))
    // 残った出現と落とした出現が同じ安定 ID を共有していたら、その ID はもう曖昧。
    // 間違った訪問に編集を貼るくらいなら、閉じる方向で失敗する。
    let blockedStableIds = Set(stableOwnership.filter { $0.value.dropped }.map(\.key))

    var warnings: [ShareWarningCode] = [.URL_VISIBLE_TO_RECIPIENTS, .URL_VISIBLE_IN_BROWSER_HISTORY]
    if scope.reservations && places.contains(where: \.isReservation) { warnings.append(.RESERVATION_DETAILS_INCLUDED) }
    if omittedUnparsedLines > 0 { warnings.append(.UNPARSED_LINES_OMITTED) }

    if JSText.trim(itinerary).isEmpty {
      return ScopedShareResult(
        input: nil,
        code: nil,
        warnings: warnings + [.NO_SHAREABLE_PLACES],
        omittedUnparsedLines: omittedUnparsedLines,
        redactedReservationCount: redactedReservationCount,
        blocked: true
      )
    }

    let resolution = buildResolutionRemap(
      source.resolutionOverrides,
      sourceToSharedIndex: sourceToSharedIndex,
      blockedStableIds: blockedStableIds
    )
    var input = source
    input.itinerary = itinerary
    input.tripStartDate = scope.dates ? source.tripStartDate : ""
    input.dateWasProvided = scope.dates ? source.dateWasProvided : false
    input.hotelQuery = scope.hotel ? source.hotelQuery : ""
    input.arrivalAirport = scope.airports ? source.arrivalAirport : "none"
    input.arrivalTime = scope.airports ? source.arrivalTime : ""
    input.departureAirport = scope.airports ? source.departureAirport : "none"
    input.departureTime = scope.airports ? source.departureTime : ""
    input.userStayMinutes = remapRecord(source.userStayMinutes, resolution.stopId)
    input.lastEntryTimes = remapRecord(source.lastEntryTimes, resolution.stopId)
    input.dayOverrides = remapRecord(source.dayOverrides, resolution.stopId)
    input.lockedOrderByDay = remapLockedOrder(source.lockedOrderByDay, resolution.stopId)
    input.removedStops = remapRemovedStops(source.removedStops, resolution.stopId, retainedAuthoredNames)
    input.legModeOverrides = remapLegModes(source.legModeOverrides, resolution.stopId)
    input.resolutionOverrides = resolution.overrides.isEmpty ? nil : resolution.overrides
    // TS は 7 欄を分割代入で外してから作り直すので、この荷物では**その 7 欄が末尾に来る**。
    // 鍵の並びは線の上の形の一部なので、どちらで作られたかを値に覚えさせる。
    input.fieldOrder = .remapped

    let code = ShareCodec.encode(input)
    if code.count > maxFragmentChars {
      return ScopedShareResult(
        input: input,
        code: nil,
        warnings: warnings + [.LINK_TOO_LONG],
        omittedUnparsedLines: omittedUnparsedLines,
        redactedReservationCount: redactedReservationCount,
        blocked: true
      )
    }
    return ScopedShareResult(
      input: input,
      code: code,
      warnings: warnings,
      omittedUnparsedLines: omittedUnparsedLines,
      redactedReservationCount: redactedReservationCount,
      blocked: false
    )
  }

  // MARK: 停留所 id の付け替え

  /// TS `ResolutionRemap`(`:39-42`)
  struct ResolutionRemap {
    var overrides: [ResolutionOverride]
    var stopId: (String) -> String?
  }

  /// TS `manualStopId`(`:44-49`)。`PlannerEdits.manualStop` が作る id と同じ綴り。
  static func manualStopId(latitude: Double, longitude: Double, inputIndex: Int) -> String {
    "manual-\(inputIndex)-\(PlannerEdits.jsToFixed5(latitude))-\(PlannerEdits.jsToFixed5(longitude))"
  }

  /// TS `providerStopId`(`:51-53`)
  static func providerStopId(_ providerRef: String) -> String { "google-\(providerRef)" }

  private static let stopIdPattern = try! JSRegex("\\A[A-Za-z0-9._-]{1,200}\\z")

  /// TS `buildResolutionRemap`(`:55-123`)
  static func buildResolutionRemap(
    _ overrides: [ResolutionOverride]?,
    sourceToSharedIndex: [Int: Int],
    blockedStableIds: Set<String>
  ) -> ResolutionRemap {
    var remappedOverrides: [ResolutionOverride] = []
    var directIds: [String: String] = [:]
    var droppedIds: Set<String> = []
    // TS の `Map` は挿入順を覚えている。結果(集合)は順に依らないが、写しは順ごと写す。
    var providerRefs: [String] = []
    var providerGroups: [String: [Int]] = [:]

    for override in overrides ?? [] {
      let inputIndex = sourceToSharedIndex[override.inputIndex]
      // ここでもう一度ユニオンを射影する。とくに、可変なプロバイダの表示欄を型の付いていない
      // 実行時の値越しに運んでしまわないこと。
      switch override {
      case .provider(let sourceIndex, let providerRef):
        if providerGroups[providerRef] == nil { providerRefs.append(providerRef) }
        providerGroups[providerRef, default: []].append(sourceIndex)
        if let inputIndex { remappedOverrides.append(.provider(inputIndex: inputIndex, providerRef: providerRef)) }
      case .manual(let sourceIndex, let name, let address, let latitude, let longitude):
        let oldId = manualStopId(latitude: latitude, longitude: longitude, inputIndex: sourceIndex)
        guard let inputIndex else {
          droppedIds.insert(oldId)
          continue
        }
        directIds[oldId] = manualStopId(latitude: latitude, longitude: longitude, inputIndex: inputIndex)
        remappedOverrides.append(.manual(
          inputIndex: inputIndex,
          name: name,
          address: address,
          latitude: latitude,
          longitude: longitude
        ))
      }
    }

    // 一意なプロバイダの選択は、出現の番号が動いても安定した google-{Place ID} の停留所 id を
    // 保つ。同じ Place ID が重複していて、そのうち 1 つの出現が落ちたり番号が付け替わったり
    // すると、素の id と `--occurrence-` 付きの id のどちらが誰のものか決められない。
    // 間違った訪問に編集を貼るくらいなら、その一族ごと落とす。
    var blockedProviderFamilies: [String] = []
    for providerRef in providerRefs {
      let group = providerGroups[providerRef] ?? []
      let retained = group.filter { sourceToSharedIndex[$0] != nil }
      let changed = group.contains { sourceToSharedIndex[$0] != $0 }
      if retained.isEmpty || (group.count > 1 && (retained.count != group.count || changed)) {
        blockedProviderFamilies.append(providerStopId(providerRef))
      }
    }

    let stopId: (String) -> String? = { id in
      guard stopIdPattern.test(id) else { return nil }
      if blockedStableIds.contains(id) { return nil }
      if let direct = directIds[id] { return direct }
      if droppedIds.contains(id) { return nil }
      // 残った決定に対応しない手入力の id は、受け取った側では組み直せない。その編集を
      // 残すことは「まだどこかの場所を指している」という偽の主張になる。
      if id.hasPrefix("manual-") { return nil }
      for base in blockedProviderFamilies where id == base || id.hasPrefix("\(base)--occurrence-") { return nil }
      return id
    }

    return ResolutionRemap(overrides: remappedOverrides, stopId: stopId)
  }

  /// TS `remapRecord`(`:125-139`)。付け替えた先が衝突した鍵は、どちらの値が正しいか決められない
  /// ので**両方**落とす。
  static func remapRecord<Value>(_ source: ShareRecord<Value>, _ remapId: (String) -> String?) -> ShareRecord<Value> {
    var values = ShareRecord<Value>()
    var conflicts: Set<String> = []
    for entry in source.entries {
      guard let id = remapId(entry.key), !conflicts.contains(id) else { continue }
      if values[id] != nil {
        values[id] = nil
        conflicts.insert(id)
        continue
      }
      values[id] = entry.value
    }
    return values
  }

  /// TS `remapLegModes`(`:141-163`)。`::` はちょうど 1 つ、両端に id がある形だけを通す。
  /// 位置と長さは JS と同じ UTF-16 コード単位で数える。
  static func remapLegModes(
    _ source: ShareRecord<TransportMode>,
    _ remapId: (String) -> String?
  ) -> ShareRecord<TransportMode> {
    var values = ShareRecord<TransportMode>()
    var conflicts: Set<String> = []
    for entry in source.entries {
      let units = Array(entry.key.utf16)
      let separators = (0..<max(0, units.count - 1)).filter { units[$0] == 0x3A && units[$0 + 1] == 0x3A }
      guard let separator = separators.first, separator > 0,
            separator == separators.last, separator < units.count - 2 else { continue }
      guard let from = remapId(String(decoding: units[0..<separator], as: UTF16.self)),
            let to = remapId(String(decoding: units[(separator + 2)...], as: UTF16.self)),
            from != to else { continue }
      let legId = "\(from)::\(to)"
      if conflicts.contains(legId) { continue }
      if values[legId] != nil {
        values[legId] = nil
        conflicts.insert(legId)
        continue
      }
      values[legId] = entry.value
    }
    return values
  }

  /// TS `remapLockedOrder`(`:165-182`)
  static func remapLockedOrder(
    _ source: IntKeyedDictionary<[String]>?,
    _ remapId: (String) -> String?
  ) -> IntKeyedDictionary<[String]> {
    var result = IntKeyedDictionary<[String]>()
    for (day, oldIds) in source?.values ?? [:] {
      var ids: [String] = []
      var seen: Set<String> = []
      for oldId in oldIds {
        guard let id = remapId(oldId), seen.insert(id).inserted else { continue }
        ids.append(id)
      }
      if !ids.isEmpty { result[day] = ids }
    }
    return result
  }

  /// TS `remapRemovedStops`(`:184-206`)
  static func remapRemovedStops(
    _ source: [PlannerRemovedStop],
    _ remapId: (String) -> String?,
    _ retainedAuthoredNames: Set<String>
  ) -> [PlannerRemovedStop] {
    var order: [String] = []
    var values: [String: PlannerRemovedStop] = [:]
    var conflicts: Set<String> = []
    for stop in source {
      // 名前が利用者の書いたものだと言えるのは、それが墨消し後の行程にまだ現れているときだけ。
      // 機微な行を落としたのに、その見出しだけ別の編集記録に残ってはいけない。
      guard retainedAuthoredNames.contains(stop.name) else { continue }
      guard let id = remapId(stop.id), !conflicts.contains(id) else { continue }
      if values[id] != nil {
        values[id] = nil
        order.removeAll { $0 == id }
        conflicts.insert(id)
        continue
      }
      order.append(id)
      values[id] = PlannerRemovedStop(id: id, name: stop.name)
    }
    return order.compactMap { values[$0] }
  }
}
