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

  /// Canned は `suggestPlaces` が常に nil を返すので、Google 区画(`start.webSuggestion`)は
  /// 出ない —— 検索窓の非回帰を固定する。
  @MainActor
  func testWebSuggestionSectionAbsentUnderCannedWorker() {
    let app = launch()
    let field = app.textFields["start.placeField"]
    XCTAssertTrue(field.waitForExistence(timeout: 10))
    field.tap()
    field.typeText("Tokyo")

    XCTAssertFalse(
      app.buttons["start.webSuggestion"].waitForExistence(timeout: 2),
      "Canned worker returns nil suggestions; the web section must not appear"
    )
    XCTAssertTrue(app.buttons["start.build"].exists)
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

  /// 天気チップと Apple Weather 帰属が日ヘッダーに出る(canned プロバイダ)。
  ///
  /// `start.seeExample` の見本は**日付未定**(`loadSample` は `tripStartDate` を触らない)なので
  /// ホライズン判定(今日〜+10日)に一度も入らず、canned でもチップは出ない
  /// (`testSampleFetchesRoutesAndTheMapShowsAMeasuredLeg` のコメントの通り)。だから見本は使わず、
  /// 場所を 1 件だけ打ち込み(候補には触れない・オフラインで決定的)、Start 画面の
  /// 「日付を入れる」を開いて今日から数日先の日付を選んでから組む —— 実機で確かめたところ、
  /// `DatePicker(.compact)` はタップすると月間カレンダーのポップオーバーになり、選んだ日の
  /// ボタンは「M月D日 曜日」の形で読み上げる(今日だけ「今日, 」が付く)。月境界をまたいでも
  /// 崩れないよう、目当ての日が見えなければ「来月」を押してから探す。
  ///
  /// a11y の型は実機で確認した実際の種別:`WeatherChip` は `.accessibilityElement(children:
  /// .combine)` で複数の `Text` を畳むので `staticTexts`。`WeatherAttributionBadge` は
  /// `Link` だが、`app.links[...]` ではなく `app.buttons[...]` に現れる(SwiftUI の `Link` は
  /// ボタンのロールで公開される)。
  @MainActor
  func testWeatherChipAndAttributionAppear() {
    let app = XCUIApplication()
    // 表示文言の照合を機械の言語設定に依存させない —— どの実行環境でも同じ日本語で出す。
    app.launchArguments = ["-uiTesting", "-AppleLanguages", "(ja)", "-AppleLocale", "ja_JP"]
    app.launch()

    let field = app.textFields["start.placeField"]
    XCTAssertTrue(field.waitForExistence(timeout: 10))
    field.tap()
    field.typeText("東京タワー\n")

    let dateDisclosure = app.buttons["日付を入れる（営業時間・祝日・天気が正確になります）"]
    XCTAssertTrue(dateDisclosure.waitForExistence(timeout: 5))
    dateDisclosure.tap()

    let datePickerButton = app.datePickers.firstMatch
    XCTAssertTrue(datePickerButton.waitForExistence(timeout: 5))
    datePickerButton.tap()

    // ホライズン(今日〜+10日)に確実に入る、今日でも明日でもない日 —— 「今日, 」接頭辞が
    // 付かない素の「M月D日」表記に揃う。
    let calendar = Calendar.current
    let target = calendar.date(byAdding: .day, value: 2, to: Date())!
    let comps = calendar.dateComponents([.month, .day], from: target)
    let dayLabelFragment = "\(comps.month!)月\(comps.day!)日"
    let dayButton = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", dayLabelFragment)).firstMatch
    if !dayButton.waitForExistence(timeout: 2) {
      // 月末近くで表示中の月をまたいだ場合だけ、次月へ送る。
      app.buttons["DatePicker.NextMonth"].tap()
    }
    XCTAssertTrue(dayButton.waitForExistence(timeout: 5))
    dayButton.tap()

    let buildButton = app.buttons["start.build"]
    XCTAssertTrue(buildButton.waitForExistence(timeout: 5))
    XCTAssertTrue(buildButton.isEnabled)
    buildButton.tap()

    XCTAssertTrue(app.staticTexts["plan.hero"].waitForExistence(timeout: 30))
    XCTAssertTrue(app.staticTexts["plan.weatherChip.0"].waitForExistence(timeout: 10))
    let badge = app.buttons["plan.weatherAttribution"]
    XCTAssertTrue(badge.waitForExistence(timeout: 5))

    // 帰属バッジは日の設定ボタンの兄弟でなければならない —— 入れ子のままだと外側の
    // 日の設定ボタンにタップを奪われ、法的リンクではなく `daySettings.sheet` が開く
    // (レビュー指摘・実機で再現した回帰)。Safari を実際に起動させて確かめずに、間接的な
    // 強い証拠として「タップしても日の設定シートは出ない」ことを見る —— シートが出たら、
    // バッジがまだ日の設定ボタンの中に居るという意味になる。
    badge.tap()
    XCTAssertFalse(
      app.otherElements["daySettings.sheet"].waitForExistence(timeout: 3),
      "tapping the weather attribution badge must not open the day-settings inspector"
    )
  }
}
