import XCTest
import Foundation
@testable import TripCheckAppCore
import TripCheckKit

final class WeatherModelsTests: XCTestCase {
  private func req(_ index: Int) -> WeatherDayRequest {
    WeatherDayRequest(index: index, date: CalendarDate(year: 2026, month: 9, day: 1 + index)!, coordinate: GeoPoint(latitude: 35.0, longitude: 139.0))
  }

  func testCannedReturnsADayPerRequestWithAttribution() async {
    let result = await CannedWeatherProvider().weather(for: [req(0), req(1), req(2)], locale: .ja)
    XCTAssertEqual(result.days.count, 3)
    XCTAssertEqual(result.provider, "apple_weather")
    XCTAssertNotNil(result.attribution)
    XCTAssertEqual(result.days.map(\.index), [0, 1, 2])
  }

  func testCannedWithNoRequestsIsEmptyAndUnattributed() async {
    let result = await CannedWeatherProvider().weather(for: [], locale: .ja)
    XCTAssertTrue(result.days.isEmpty)
    XCTAssertNil(result.attribution)
  }
}
