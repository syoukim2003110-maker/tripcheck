import XCTest
import Foundation
@testable import TripCheckAppCore
import TripCheckKit
#if canImport(WeatherKit)
import WeatherKit
#endif

final class WeatherProviderTests: XCTestCase {
  private let tokyo = TimeZone(identifier: "Asia/Tokyo")!

  func testCelsiusRounds() {
    XCTAssertEqual(WeatherMath.celsius(20.4), 20)
    XCTAssertEqual(WeatherMath.celsius(20.5), 21)
    // Swift の無引数 `.rounded()` は "away from zero" 規則なので -0.5 は -1 側に丸まる(0 ではない)。
    XCTAssertEqual(WeatherMath.celsius(-0.5), -1)
  }

  func testPrecipitationClampsToPercent() {
    XCTAssertEqual(WeatherMath.precipitationPercent(0.0), 0)
    XCTAssertEqual(WeatherMath.precipitationPercent(0.126), 13)
    XCTAssertEqual(WeatherMath.precipitationPercent(1.0), 100)
    XCTAssertEqual(WeatherMath.precipitationPercent(1.5), 100)
  }

  func testDateMatchUsesInjectedTimeZone() {
    // 2026-09-01T15:00:00Z は東京(UTC+9)では 2026-09-02T00:00 = 9/2。
    let date = Date(timeIntervalSince1970: 1_788_274_800) // 2026-09-01T15:00:00Z
    XCTAssertTrue(WeatherMath.matches(date, CalendarDate(year: 2026, month: 9, day: 2)!, in: tokyo))
    XCTAssertFalse(WeatherMath.matches(date, CalendarDate(year: 2026, month: 9, day: 1)!, in: tokyo))
    XCTAssertTrue(WeatherMath.matches(date, CalendarDate(year: 2026, month: 9, day: 1)!, in: TimeZone(identifier: "UTC")!))
  }

  #if canImport(WeatherKit)
  @available(iOS 16.0, macOS 13.0, *)
  func testConditionMappingFoldsToSevenKinds() {
    XCTAssertEqual(WeatherConditionMapping.kind(for: .clear), .clear)
    XCTAssertEqual(WeatherConditionMapping.kind(for: .partlyCloudy), .partly)
    XCTAssertEqual(WeatherConditionMapping.kind(for: .heavyRain), .rain)
    XCTAssertEqual(WeatherConditionMapping.kind(for: .blizzard), .snow)
    XCTAssertEqual(WeatherConditionMapping.kind(for: .thunderstorms), .storm)
    XCTAssertEqual(WeatherConditionMapping.kind(for: .foggy), .fog)
    XCTAssertEqual(WeatherConditionMapping.kind(for: .windy), .cloudy)
  }
  #endif
}
