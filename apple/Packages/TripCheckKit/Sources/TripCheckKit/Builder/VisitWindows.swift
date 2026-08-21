import Foundation

/*
 * 訪問を営業窓に当てはめる/食事窓までの距離を測る。
 *
 * lib/trip-builder.ts:1258-1292 (`fitVisitToWindow`, `distanceToWindow`) と
 * lib/place-hours.ts:1-24 (`placeRequiresOpeningHours`)。
 */

/// TS `fitVisitToWindow` (`lib/trip-builder.ts:1258-1277`)。
///
/// `windows == nil` は TS の `undefined` — その日の営業情報をまだ持っていない。
/// `windows == []` は「その曜日は休業」という Google の答えで、単なる時刻の衝突より強い事実
/// なので独自のステータスを持つ。開店前に着いたら開店まで待つ(`start` が開店時刻になる)。
public func fitVisitToWindow(cursor: Int, duration: Int, windows: [VisitWindow]?) -> (start: Int, status: OpeningStatus) {
  guard let windows else { return (cursor, .unknown) }
  if windows.isEmpty { return (cursor, .closed_day) }
  var blockedByLastEntry = false
  for window in windows {
    // TS の `Number.isFinite` 判定は `Int` では常に真なので、残るのは窓の向きの検査だけ。
    if window.closeMinutes <= window.openMinutes { continue }
    let start = max(cursor, window.openMinutes)
    if start + duration > window.closeMinutes { continue }
    if let lastEntry = window.lastEntryMinutes, start > lastEntry {
      blockedByLastEntry = true
      continue
    }
    return (start, .verified_open)
  }
  if blockedByLastEntry { return (cursor, .last_entry_conflict) }
  return (cursor, .conflict)
}

/// TS `distanceToWindow` (`lib/trip-builder.ts:1279-1282`) — 窓の中なら 0、外なら最寄りの端までの分数。
public func distanceToWindow(cursor: Int, window: MealWindow) -> Int {
  if cursor < window.start { return window.start - cursor }
  return max(0, cursor - window.end)
}

/// lib/place-hours.ts。`placeHasOpeningHoursEvidence` (`:26-33`) は
/// `PlaceIntelligenceResult["place"]`(プロバイダ応答型)を読むため、キットには移植しない。
public enum PlaceHours {
  /// lib/place-hours.ts:4-16 — 地理的な区画や自然地形には営業時間がない。
  public static let noOpeningHoursPlaceTypes: Set<String> = [
    "administrative_area_level_1",
    "administrative_area_level_2",
    "administrative_area_level_3",
    "country",
    "geocode",
    "locality",
    "mountain_peak",
    "natural_feature",
    "neighborhood",
    "postal_code",
    "sublocality",
  ]

  /// lib/place-hours.ts:18-22 — `placeRequiresOpeningHours`。
  public static func requiresOpeningHours(placeTypes: [String]?, openingHoursApplicable: Bool?) -> Bool {
    if openingHoursApplicable == false { return false }
    return !(placeTypes ?? []).contains { noOpeningHoursPlaceTypes.contains($0) }
  }

  public static func requiresOpeningHours(_ stop: RouteStop) -> Bool {
    requiresOpeningHours(placeTypes: stop.placeTypes, openingHoursApplicable: stop.openingHoursApplicable)
  }
}
