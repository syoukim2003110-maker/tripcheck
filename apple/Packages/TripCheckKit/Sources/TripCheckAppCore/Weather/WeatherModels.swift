import Foundation
import TripCheckKit

/// web の 7 種(`lib/weather.ts` WeatherKind)に合わせた天気の畳み込み。
public enum WeatherKind: String, Sendable, Codable, CaseIterable {
  case clear, partly, cloudy, fog, rain, snow, storm
}

/// 1 日ぶんの天気。web の `TripWeatherDay` を踏襲(Apple は WMO code を返さないので code は持たない)。
public struct WeatherDay: Equatable, Sendable {
  public let index: Int
  public let date: CalendarDate
  public let kind: WeatherKind
  public let temperatureMaxC: Int
  public let temperatureMinC: Int
  public let precipitationPercent: Int?
  public init(index: Int, date: CalendarDate, kind: WeatherKind, temperatureMaxC: Int, temperatureMinC: Int, precipitationPercent: Int?) {
    self.index = index
    self.date = date
    self.kind = kind
    self.temperatureMaxC = temperatureMaxC
    self.temperatureMinC = temperatureMinC
    self.precipitationPercent = precipitationPercent
  }
}

/// Apple 必須の帰属。`legalPageURL` が土台、ロゴ URL は任意の上乗せ。
public struct WeatherAttribution: Equatable, Sendable {
  public let legalPageURL: URL
  public let markLightURL: URL?
  public let markDarkURL: URL?
  public init(legalPageURL: URL, markLightURL: URL? = nil, markDarkURL: URL? = nil) {
    self.legalPageURL = legalPageURL
    self.markLightURL = markLightURL
    self.markDarkURL = markDarkURL
  }
}

public struct WeatherResult: Equatable, Sendable {
  public let provider: String
  public let days: [WeatherDay]
  public let attribution: WeatherAttribution?
  public init(provider: String = "apple_weather", days: [WeatherDay], attribution: WeatherAttribution?) {
    self.provider = provider
    self.days = days
    self.attribution = attribution
  }
  /// 天気が出せないときの共通の空。チップも帰属も出さない。
  public static let empty = WeatherResult(days: [], attribution: nil)
}

/// 1 日の要求。web の `buildWeatherPayload` と同じく、日 index + 日付 + その日の停留所座標の平均(2桁丸め)。
public struct WeatherDayRequest: Equatable, Sendable {
  public let index: Int
  public let date: CalendarDate
  public let coordinate: GeoPoint
  public init(index: Int, date: CalendarDate, coordinate: GeoPoint) {
    self.index = index
    self.date = date
    self.coordinate = coordinate
  }
}

/// 天気の提供元。Kit は知らない(表示専用なので AppCore に置く)。
public protocol WeatherProviding: Sendable {
  func weather(for requests: [WeatherDayRequest], locale: PlannerLocale) async -> WeatherResult
}
