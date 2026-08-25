import Foundation
import TripCheckKit

/// UI テスト/プレビュー用。決定的な天気を返す。時刻は読まない。
public struct CannedWeatherProvider: WeatherProviding {
  public init() {}
  public func weather(for requests: [WeatherDayRequest], locale: PlannerLocale) async -> WeatherResult {
    let kinds: [WeatherKind] = [.clear, .partly, .cloudy, .rain, .snow, .storm, .fog]
    let days = requests.enumerated().map { offset, request in
      WeatherDay(
        index: request.index,
        date: request.date,
        kind: kinds[offset % kinds.count],
        temperatureMaxC: 20 - offset,
        temperatureMinC: 12 - offset,
        precipitationPercent: (offset * 15) % 100
      )
    }
    let attribution = WeatherAttribution(
      legalPageURL: URL(string: "https://weatherkit.apple.com/legal-attribution.html")!
    )
    return days.isEmpty ? .empty : WeatherResult(days: days, attribution: attribution)
  }
}
