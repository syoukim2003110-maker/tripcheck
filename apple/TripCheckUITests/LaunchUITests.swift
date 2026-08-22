import XCTest

/// 端末の上で本当に立ち上がることだけを見る。中身の検査(旅程・地図・共有)は Task 14 で足す。
final class LaunchUITests: XCTestCase {
  /// `XCUIApplication` は MainActor の持ち物。Swift 6 では明示しないと呼べない。
  @MainActor
  func testTheAppOpensAndSaysItsName() {
    let app = XCUIApplication()
    app.launch()
    XCTAssertTrue(app.staticTexts["TripCheck"].waitForExistence(timeout: 10))
  }
}
