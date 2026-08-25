import XCTest

/// 端末の上で本当に通る道を 4 本だけ。
///
/// 1. 見本 → 旅程 → 停留所の詳細 → 外す → 元に戻す(旅行者が最初にやる一巡り)
/// 2. 見本 → 経路の取得が終わる → 車を選ぶ → 地図が実経路の区間を数える
/// 3. ファーストビュー契約:**最初の停留所が、既定の文字サイズでスクロール無しに見える**
///    (統合仕様 §10)
/// 4. 旅程 ↔ 地図の往復
///
/// `-uiTesting` で起動するのは、`TripCheckApp` がそのときだけ保存先と設定の箱を使い捨てに
/// 切り替え、アニメーションを切るから —— 動いている札は掴めない。
final class PlannerFlowTests: XCTestCase {

  override func setUp() {
    super.setUp()
    continueAfterFailure = false
  }

  @MainActor
  private func launch() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["-uiTesting"]
    app.launch()
    return app
  }

  /// 見本を入れて組み、最初の停留所を開き、外して、元に戻す。
  @MainActor
  func testSampleToPlanToDetailToRemoveToUndo() {
    let app = launch()
    app.buttons["start.seeExample"].tap()
    XCTAssertTrue(app.staticTexts["plan.hero"].waitForExistence(timeout: 30))
    XCTAssertTrue(app.buttons["plan.dayTab.0"].isSelected)

    app.buttons["plan.dayTab.1"].tap()
    XCTAssertTrue(app.buttons["plan.dayTab.1"].isSelected)

    let firstStop = app.buttons.matching(identifier: "plan.activity").firstMatch
    XCTAssertTrue(firstStop.waitForExistence(timeout: 5))
    XCTAssertTrue(firstStop.isHittable)                      // 初見に最初の停留所
    firstStop.tap()

    XCTAssertTrue(app.otherElements["detail.sheet"].waitForExistence(timeout: 5))
    app.buttons["detail.remove"].tap()
    // 必須・予約済みの場所は先に問いかける。問いが出たときだけ「進める」を押す。
    if app.alerts.firstMatch.waitForExistence(timeout: 2) {
      app.alerts.buttons.element(boundBy: 1).tap()
    }

    let toast = app.otherElements["toast"]
    XCTAssertTrue(toast.waitForExistence(timeout: 10))
    app.buttons["toast.undo"].tap()
    // 「元に戻す」はトーストを畳んでから旅程を組み直す。押した瞬間に読むと、まだ畳む前の
    // 一瞬を掴むことがあるので、消えるところまで待つ。
    XCTAssertTrue(toast.waitForNonExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["plan.hero"].exists)
  }

  /// 見本 → 進捗が消える → 車を選ぶ → 地図に実経路の区間がある(`-uiTesting` は `CannedRouteProvider`)。
  @MainActor
  func testSampleFetchesRoutesAndTheMapShowsAMeasuredLeg() {
    let app = launch()
    app.buttons["start.seeExample"].tap()
    XCTAssertTrue(app.staticTexts["plan.hero"].waitForExistence(timeout: 30))
    // `RouteProgressLine` は `.combine` した 1 要素なので型(staticText / otherElement)を決め打ちしない。
    let progress = app.descendants(matching: .any).matching(identifier: "plan.routeProgress").firstMatch
    XCTAssertTrue(progress.waitForNonExistence(timeout: 30))
    // 見本は日付未定で公共交通が使用中のまま(破線)。車を選ぶと、先に測ってあった車の経路が実線になる。
    // `plan.movement` は `MovementCard` の外側の VStack に付いている(`MovementCard.swift:79`。ボタンではない)。
    let movement = app.descendants(matching: .any).matching(identifier: "plan.movement").firstMatch
    XCTAssertTrue(movement.waitForExistence(timeout: 5))
    movement.tap()
    let taxi = app.buttons["plan.movement.mode.taxi"]
    XCTAssertTrue(taxi.waitForExistence(timeout: 5))
    taxi.tap()
    if app.alerts.firstMatch.waitForExistence(timeout: 2) { app.alerts.buttons.element(boundBy: 1).tap() }
    XCTAssertTrue(app.otherElements["toast"].waitForExistence(timeout: 10))
    app.buttons["plan.view.map"].tap()
    XCTAssertTrue(app.otherElements["map"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["map.measuredCount"].waitForExistence(timeout: 10))
  }

  /// 統合仕様 §10 のファーストビュー契約。既定の文字サイズの iPhone 17 Pro で、**指を
  /// 動かさずに**最初の停留所が読めること。
  @MainActor
  func testFirstViewportContractAtDefaultType() {
    let app = launch()
    app.buttons["start.seeExample"].tap()
    XCTAssertTrue(app.staticTexts["plan.hero"].waitForExistence(timeout: 30))

    let stop = app.buttons.matching(identifier: "plan.activity").firstMatch
    XCTAssertTrue(stop.waitForExistence(timeout: 5))
    XCTAssertTrue(
      stop.frame.maxY <= app.frame.height,
      "first stop must be visible without scrolling (spec §10): \(stop.frame) in \(app.frame)"
    )
    // 見えているだけでなく、そこから開ける(下の切替の帯に隠れていない)。
    XCTAssertTrue(stop.isHittable)
  }

  /// 旅程と地図は同じ旅を指す 2 つの見え方。往復して、戻ってきたら同じ結論がそこに在る。
  @MainActor
  func testSwitchingToMapAndBack() {
    let app = launch()
    app.buttons["start.seeExample"].tap()
    XCTAssertTrue(app.staticTexts["plan.hero"].waitForExistence(timeout: 30))

    app.buttons["plan.view.map"].tap()
    XCTAssertTrue(app.otherElements["map"].waitForExistence(timeout: 10))

    app.buttons["plan.view.timeline"].tap()
    XCTAssertTrue(app.staticTexts["plan.hero"].waitForExistence(timeout: 10))
  }

  /// 文らしい入力に「読み取る」行が出て、canned の聞き取りがフォームに展開される。
  /// 行き先は検索欄のプリフィルに、ウィッシュは行に、確認トーストが出る(spec §4.4)。
  @MainActor
  func testFreeTextIntentFillsTheStartForm() {
    let app = launch()
    let field = app.textFields["start.placeField"]
    XCTAssertTrue(field.waitForExistence(timeout: 10))
    field.tap()
    field.typeText("Weekend trip to Kanazawa, seafood and museum")

    let row = app.buttons["start.intentRow"]
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    row.tap()

    XCTAssertTrue(app.otherElements["toast"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.buttons["海鮮"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["21世紀美術館"].exists)
    XCTAssertEqual(field.value as? String, "金沢")
    // canned の durationText は「3泊」(→4日) —— 既定の3日と区別できる値にして、
    // 適用が本当に起きたことを日数タイルの選択状態でも確かめる。
    XCTAssertTrue(app.buttons["4日"].isSelected)
  }

  /// `-workerDiagnostics` の隠し画面が出て、疎通ボタンが canned クライアントで成功する。
  @MainActor
  func testWorkerDiagnosticsPingsSuccessfully() {
    let app = XCUIApplication()
    app.launchArguments = ["-uiTesting", "-workerDiagnostics"]
    app.launch()

    XCTAssertTrue(app.otherElements["diag.screen"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.staticTexts["diag.state"].waitForExistence(timeout: 5))

    app.buttons["diag.check"].tap()
    XCTAssertTrue(app.staticTexts["diag.pingResult"].waitForExistence(timeout: 5))
  }
}
