import Foundation
import TripCheckKit
#if canImport(WeatherKit)
import WeatherKit
#endif
#if canImport(CoreLocation)
import CoreLocation
#endif

/// WeatherKit に触れない純関数群。ここだけは常に単体テストできる。
enum WeatherMath {
  /// 摂氏の生値(Measurement から取り出した Double)を四捨五入して Int に。
  static func celsius(_ value: Double) -> Int { Int(value.rounded()) }

  /// 降水確率 0...1 を 0...100 の Int に(範囲外は丸めてクランプ)。
  static func precipitationPercent(_ chance: Double) -> Int {
    min(100, max(0, Int((chance * 100).rounded())))
  }

  /// 予報の Date を、注入した TimeZone の暦日に落として (年,月,日) を返す。
  static func calendarDay(of date: Date, in timeZone: TimeZone) -> (year: Int, month: Int, day: Int) {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let c = calendar.dateComponents([.year, .month, .day], from: date)
    return (c.year ?? 0, c.month ?? 0, c.day ?? 0)
  }

  /// 予報 Date が要求の暦日(CalendarDate)と一致するか。
  static func matches(_ date: Date, _ request: CalendarDate, in timeZone: TimeZone) -> Bool {
    let d = calendarDay(of: date, in: timeZone)
    return d.year == request.year && d.month == request.month && d.day == request.day
  }
}

#if canImport(WeatherKit)
/// WeatherKit の `WeatherCondition` を web の 7 種へ畳む。表外・@unknown は中立の cloudy。
@available(iOS 16.0, macOS 13.0, *)
enum WeatherConditionMapping {
  static func kind(for condition: WeatherCondition) -> WeatherKind {
    switch condition {
    case .clear, .mostlyClear, .hot: return .clear
    case .partlyCloudy: return .partly
    case .cloudy, .mostlyCloudy, .windy, .breezy, .blowingDust, .smoky: return .cloudy
    case .foggy, .haze: return .fog
    case .drizzle, .rain, .heavyRain, .sunShowers, .freezingDrizzle, .freezingRain: return .rain
    case .snow, .heavySnow, .flurries, .sunFlurries, .sleet, .hail, .wintryMix, .blizzard, .blowingSnow, .frigid: return .snow
    case .thunderstorms, .isolatedThunderstorms, .scatteredThunderstorms, .strongStorms, .tropicalStorm, .hurricane: return .storm
    @unknown default: return .cloudy
    }
  }
}

/// 端末から WeatherKit を叩く実物。表示専用・失敗は空。座標・結果をログに残さない。
@available(iOS 16.0, macOS 13.0, *)
public struct AppleWeatherProvider: WeatherProviding {
  private let timeZone: TimeZone
  public init(timeZone: TimeZone = .current) { self.timeZone = timeZone }

  public func weather(for requests: [WeatherDayRequest], locale: PlannerLocale) async -> WeatherResult {
    guard !requests.isEmpty else { return .empty }
    let service = WeatherService.shared

    // 帰属が取れなければ天気自体を出さない(Apple 必須)。
    guard let attribution = try? await service.attribution else { return .empty }
    let mapped = WeatherAttribution(
      legalPageURL: attribution.legalPageURL,
      markLightURL: attribution.combinedMarkLightURL,
      markDarkURL: attribution.combinedMarkDarkURL
    )

    // 座標ごとに日次予報を引き、要求日に一致する DayWeather を拾う。1 座標の失敗は捨てる。
    var days: [WeatherDay] = []
    await withTaskGroup(of: WeatherDay?.self) { group in
      for request in requests {
        let tz = timeZone
        group.addTask {
          let location = CLLocation(latitude: request.coordinate.latitude, longitude: request.coordinate.longitude)
          guard let daily = try? await service.weather(for: location, including: .daily) else { return nil }
          guard let match = daily.forecast.first(where: { WeatherMath.matches($0.date, request.date, in: tz) }) else { return nil }
          return WeatherDay(
            index: request.index,
            date: request.date,
            kind: WeatherConditionMapping.kind(for: match.condition),
            temperatureMaxC: WeatherMath.celsius(match.highTemperature.converted(to: .celsius).value),
            temperatureMinC: WeatherMath.celsius(match.lowTemperature.converted(to: .celsius).value),
            precipitationPercent: WeatherMath.precipitationPercent(match.precipitationChance)
          )
        }
      }
      for await day in group { if let day { days.append(day) } }
    }
    let sorted = days.sorted { $0.index < $1.index }
    return sorted.isEmpty ? .empty : WeatherResult(days: sorted, attribution: mapped)
  }
}
#endif
