import Foundation

/*
 * その訪問がどれくらい混みそうかの見立て。曜日とピーク時間帯という 2 つの公開情報だけで
 * 決まる粗い読みで、プロバイダの混雑データではない。
 *
 * lib/trip-builder.ts:375-394 (`buildCrowdOutlook`)。`buildDay` が停留所ごとに直接呼ぶので、
 * 日の時計と一緒にここへ置く(TS のこの直後 `:396-459` にある `foodProfiles` は食事推薦の
 * 材料で、混雑とは無関係。Task 14 の担当)。
 */
extension CrowdOutlook {
  /// TS `buildCrowdOutlook` (`lib/trip-builder.ts:375-394`)。
  ///
  /// 日付が分からない日は見立てを出さない(`:376`)。TS の `new Date(\`${date}T00:00:00Z\`)` は
  /// 不正な文字列で `Invalid Date` になり `null` を返す(`:377-378`)ので、Swift 側は
  /// `CalendarDate(_:)` の失敗をそのまま `nil` にする。
  public static func build(date: String?, arrival: String, stop: RouteStop) -> CrowdOutlook? {
    guard let date, let parsed = CalendarDate(date) else { return nil }
    // `CalendarDate.weekday` は JS の `getUTCDay()` と同じ 0 = 日曜(`:379`)。
    let isWeekend = parsed.weekday == 0 || parsed.weekday == 6
    let arrivalMinutes = ClockTime(arrival)?.minutes ?? 0
    let peakTime = arrivalMinutes >= 11 * 60 && arrivalMinutes <= 16 * 60
    var score = stop.isAnchor ? 2 : 1
    if peakTime { score += 1 }
    if isWeekend { score += 1 }
    let levels: [CrowdLevel] = [.quiet, .moderate, .busy, .veryBusy]
    return CrowdOutlook(
      level: levels[min(levels.count - 1, score)],
      // TS は `"low"` 以外をすべて `"medium"` に畳む。Swift の `Confidence` は low/medium の
      // 2 値なので同じ結果になる。
      confidence: stop.confidence == .low ? .low : .medium,
      isWeekend: isWeekend,
      weekendUplift: isWeekend ? 1 : 0,
      peakTime: peakTime
    )
  }
}
