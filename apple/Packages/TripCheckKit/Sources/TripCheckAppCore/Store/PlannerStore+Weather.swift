import Foundation
import TripCheckKit

/*
 * 天気の取得(spec 2026-08-25)。**表示専用** —— `FeasibilityResult`/`PlannerContext`/`verified`
 * には 1 ミリも触れない。プランが建った後に 1 回、非ブロッキングで取りに行き、世代ガードで
 * 古い応答を捨てる。規律は `PlannerStore+Routes.swift` の `startRouteEnrichment` と同じ形
 * (`Task { [weak self] ... }` + 世代の比較)を踏襲する。
 */
extension PlannerStore {
  /// 各日の要求を組む。日付が確定(String→CalendarDate)し、ホライズン(今日〜+N日)内で、
  /// 停留所が 1 つ以上ある日だけ。座標は停留所の平均を 2 桁丸め(地名・id は載せない)。最大 maxDays。
  func weatherRequests(now: Date, timeZone: TimeZone = .current, maxDays: Int = 10, horizonDays: Int = 10) -> [WeatherDayRequest] {
    guard let bundle else { return [] }
    let t = WeatherMath.calendarDay(of: now, in: timeZone)
    // `CalendarDate.init(year:month:day:)` は failable(月日を検証する)。`WeatherMath.calendarDay`
    // が返す `(year, month, day)` は `Calendar` から出た正の値のはずだが、無効な `now`/`timeZone`
    // (テストの作り違いなど)で 0 が返る枝もあるので、ここで確かめずに素通しはしない。
    guard let today = CalendarDate(year: t.year, month: t.month, day: t.day) else { return [] }
    var out: [WeatherDayRequest] = []
    for (index, day) in bundle.plan.days.enumerated() {
      if out.count >= maxDays { break }
      guard let text = day.date, let date = CalendarDate(text) else { continue }
      guard Self.withinHorizon(date, from: today, days: horizonDays) else { continue }
      let coords = day.stops.map { GeoPoint(latitude: $0.stop.latitude, longitude: $0.stop.longitude) }
      guard let center = Self.averagedCoordinate(coords) else { continue }
      out.append(WeatherDayRequest(index: index, date: date, coordinate: center))
    }
    return out
  }

  /// 停留所座標の平均を小数 2 桁に丸める(≒1km)。空なら nil。
  static func averagedCoordinate(_ coords: [GeoPoint]) -> GeoPoint? {
    guard !coords.isEmpty else { return nil }
    let count = Double(coords.count)
    let lat = coords.reduce(0.0) { $0 + $1.latitude } / count
    let lon = coords.reduce(0.0) { $0 + $1.longitude } / count
    return GeoPoint(latitude: (lat * 100).rounded() / 100, longitude: (lon * 100).rounded() / 100)
  }

  /// date が today..today+days(両端含む)に入るか。`CalendarDate.epochDay` の差で判定する ——
  /// `Calendar`/`TimeZone` を経由しないので、うるう年や月境界のずれを持ち込まない。
  static func withinHorizon(_ date: CalendarDate, from today: CalendarDate, days: Int) -> Bool {
    (0...days).contains(date.epochDay - today.epochDay)
  }

  /// プランが建った後に 1 回。route enrichment と同じ場所で呼ぶ。
  func startWeatherEnrichment(now: Date = Date(), timeZone: TimeZone = .current) {
    invalidateWeather()
    guard let provider = weatherProvider else { return }
    let requests = weatherRequests(now: now, timeZone: timeZone)
    guard !requests.isEmpty else { return }
    let generation = weatherGeneration
    let locale = request.locale
    weatherTask = Task { [weak self] in
      let result = await provider.weather(for: requests, locale: locale)
      guard let self, self.weatherGeneration == generation, !Task.isCancelled else { return }
      self.applyWeather(result)
      if self.weatherGeneration == generation { self.weatherTask = nil }
    }
  }

  /// 再構築・日付変更・reset で呼ぶ。世代を上げ、読みかけを捨て、表示を空に。
  func invalidateWeather() {
    weatherGeneration &+= 1
    weatherTask?.cancel()
    weatherTask = nil
    weatherByDay = [:]
    weatherAttribution = nil
  }

  private func applyWeather(_ result: WeatherResult) {
    // 帰属が無い、または天気ゼロなら出さない(Apple: 帰属無しで天気を見せない)。
    guard let attribution = result.attribution, !result.days.isEmpty else { return }
    var byDay: [Int: WeatherDay] = [:]
    for day in result.days { byDay[day.index] = day }
    weatherByDay = byDay
    weatherAttribution = attribution
  }

  /// テスト用: 走っている取得が落ち着くまで待つ(`awaitRouteEnrichment` と同じ形。天気は連鎖
  /// しないので 1 回待てば十分)。
  func awaitWeatherEnrichment() async {
    if let task = weatherTask { await task.value }
  }
}
