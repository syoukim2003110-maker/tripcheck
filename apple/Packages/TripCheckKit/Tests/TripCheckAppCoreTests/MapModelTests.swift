import Testing
@testable import TripCheckAppCore
import TripCheckKit

/*
 * 地図が描いてよいものと、描いてはいけないもの。
 *
 * いちばん重い約束は 1 つ:**通った道を知らない区間を、通った道のように描かない**
 * (統合仕様 §9、spec §5.4)。鍵ゼロのアプリには経路の提供元が無いので、今日はどの区間も
 * 「知らない」側にいる —— だから線は全部破線の直線で、点は 2 つしかない。
 *
 * 残りは、画面が読む導出値がその日の中身と噛み合っていること(範囲・スコープ・強調)と、
 * ピンが耳にも名乗ること。
 */

/// 区間の形を知らないなら、2 点を結ぶ破線しか描けない。実線は「ここを通る」と言い切る絵で、
/// 今日そう言い切れる区間は 1 つも無い。
@Test @MainActor func unmeasuredLegsAreDashedStraightLines() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  let m = store.mapModel(scope: .all)
  #expect(!m.routes.isEmpty)
  #expect(m.routes.allSatisfy { !$0.measured })          // 鍵ゼロ: 計測済みの経路は無い
  #expect(m.routes.allSatisfy { $0.points.count == 2 })
  #expect(m.pins.filter { if case .anchor = $0.kind { return true }; return false }.count == 8)
  #expect(m.pins.allSatisfy { !$0.a11y.isEmpty })
}

/// 2 点が近すぎる日でも、地図は最小の広さを持つ。クランプが無いと、隣り合う 2 か所の日が
/// 建物の中まで寄った絵になる。
@Test func degenerateBoundsGetAMinimumSpan() {
  let m = MapModel.region(for: [GeoPoint(latitude: 35.0, longitude: 139.0), GeoPoint(latitude: 35.001, longitude: 139.001)])
  #expect(m.latitudeDelta >= 0.006); #expect(m.longitudeDelta >= 0.006)
}

/// 「この日」を選んだ地図には、その日のものしか出ない。他の日のピンが薄く残っていると、
/// 「この日」と言いながら 8 か所を見せることになる。
@Test @MainActor func theDayScopeShowsOnlyTheSelectedDay() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  store.selectDay(2)
  let day = store.mapModel(scope: .day)
  #expect(!day.pins.isEmpty)
  #expect(day.pins.allSatisfy { $0.dayIndex == 2 })
  // 空の列は `allSatisfy` を素通りする。線が 1 本も無い日で「その日の線だけ」が
  // 通ってしまわないよう、まず線があることを言う。
  #expect(!day.routes.isEmpty)
  #expect(day.routes.allSatisfy { $0.dayIndex == 2 && $0.selected })
  #expect(day.pins.count < store.mapModel(scope: .all).pins.count)
  // 凡例の日ボタンは、地図に出ている日と同じ列でなければ押しても何も指さない。
  #expect(day.legendDays.map { $0.index } == [2])
  #expect(store.mapModel(scope: .all).legendDays.map { $0.index } == [0, 1, 2, 3])
}

/// 地図のピンを押すと、その場所の日がタイムラインでも選ばれる。全日程を映しているときに
/// 3日目のピンを押して 1日目の旅程が開いたままなら、開いた詳細はどの日の話か読めない。
@Test @MainActor func focusingAStopSelectsTheDayItBelongsTo() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  guard let bundle = store.bundle, bundle.plan.days.count > 2 else { Issue.record("sample has too few days"); return }
  let stopId = bundle.plan.days[2].stops[0].stop.id
  store.focusStop(id: stopId)
  #expect(store.view.mapFocusedStopId == stopId)
  #expect(store.view.selectedDay == 2)
}

/// ピンは目には色と番号で、耳には**名前と種別**で名乗る。種別の語は Kit の凡例と同じ 1 か所
/// から来る —— 凡例が「予定地点」と読み、ピンが別の語を名乗る地図は、凡例が凡例でなくなる。
@Test @MainActor func pinsNameThePlaceAndItsKindOutLoud() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  guard let bundle = store.bundle else { Issue.record("no bundle"); return }
  let names = Set(bundle.plan.days.flatMap(\.stops).map(\.stop.name))
  var checked = 0
  for pin in store.mapModel(scope: .all).pins {
    guard case .anchor = pin.kind else { continue }
    #expect(names.contains { pin.a11y.contains($0) }, "\(pin.a11y)")
    #expect(pin.a11y.contains(Copy.for(.ja).legendAnchor), "\(pin.a11y)")
    #expect(!pin.label.isEmpty)   // 丸の中の番号
    checked += 1
  }
  #expect(checked == 8)
}

/// 日付変更線をまたぐ 2 点は、地球をほぼ一周した絵にならない。+179 と −179 は 2 度離れて
/// いるだけで、358 度離れてはいない —— 経度は輪であって数直線ではない。
@Test func pointsAcrossTheAntimeridianStayNextToEachOther() {
  let m = MapModel.region(for: [GeoPoint(latitude: -16.5, longitude: 179.0), GeoPoint(latitude: -16.5, longitude: -179.0)])
  #expect(m.longitudeDelta < 10)                      // 2 度 × 余白。358 度ではない
  #expect(m.longitudeDelta <= 360)
  #expect(abs(abs(m.center.longitude) - 180) < 0.000001)   // 中心は日付変更線そのもの
  #expect(m.center.longitude >= -180 && m.center.longitude <= 180)
}

/// 半周を超えない旅は今までどおり。日付変更線の手当てが、普通の広い旅程まで反対側へ
/// ひっくり返してしまわないこと。
@Test func aWideTripThatDoesNotCrossTheLineKeepsItsOwnCentre() {
  let m = MapModel.region(for: [GeoPoint(latitude: 35.0, longitude: -10.0), GeoPoint(latitude: 55.0, longitude: 30.0)])
  #expect(abs(m.center.longitude - 10) < 0.000001)
  #expect(m.longitudeDelta > 40 && m.longitudeDelta <= 360)
}

/// 注意のピンも、自分で置いた点も、押せば詳細が開く。**とりわけ注意のピン** —— 詳細シートは
/// そこを直しに行く先で、開かない地図は「直すところがある」とだけ言って直し方を渡さない。
/// 拠点(ホテル)だけが鍵を持たない。
@Test @MainActor func warningAndManualPinsCarryTheStopTheyOpen() async {
  let store = PlannerStore(resolvers: [FakeResolver(unresolved: ["Nowhere"])], store: nil)
  await store.addEntry(text: "Bern", suggestion: nil)
  await store.addEntry(text: "Nowhere", suggestion: nil)
  store.request.tripDays = 1
  // 朝 6 時に予約した場所は、朝から始まる日程でも必ず遅れる(`reservationLateMinutes > 0`)。
  store.updateEntry(id: store.request.entries[0].id, fixedTime: .some("06:00"), isReservation: true)
  await store.requestBuildFromStart()
  store.setManualPin(entryId: store.request.entries[1].id, name: "Nowhere", address: "", latitude: 46.95, longitude: 7.45)
  await store.build()

  let pins = store.mapModel(scope: .all).pins
  guard let manual = pins.first(where: { $0.kind == .manual }) else { Issue.record("手動の点が地図に無い"); return }
  #expect(manual.stopId == manual.id)
  #expect(!manual.label.isEmpty)          // 手動の点も番号を保つ(v1.1 §5.6)

  guard let warning = pins.first(where: { $0.kind == .warning }) else { Issue.record("注意の点が地図に無い"); return }
  #expect(warning.stopId == warning.id)
  #expect(!warning.label.isEmpty)

  // 拠点は停留所ではない。開く中身が無いので鍵も持たない。
  #expect(pins.filter { $0.kind == .hotel }.allSatisfy { $0.stopId == nil })

  // 色が言う日と、押したときに選ばれる日は同じ。違うと、緑のピンを押して 1日目が開く。
  store.focusStop(id: manual.id)
  #expect(store.view.selectedDay == manual.dayIndex)
}

/// 強調は両側へ流れる(spec §5.4)。タイムラインの行から開いた詳細も、地図の同じ場所を指す
/// —— 指さないと、帯で地図へ切り替えた旅行者が自分の読んでいた場所を目で探し直す。
@Test @MainActor func openingAStopFromTheTimelineAlsoFocusesItsPin() async {
  let store = PlannerStore(resolvers: [CatalogResolver()], store: nil); store.loadSample(.switzerland); await store.build()
  guard let bundle = store.bundle, let stopId = bundle.plan.days.first?.stops.first?.stop.id else {
    Issue.record("sample has no stops"); return
  }
  #expect(store.view.mapFocusedStopId == nil)
  store.openInspector(.stop(stopId))
  #expect(store.view.mapFocusedStopId == stopId)
  // 日の設定は場所を指していない。地図の強調を書き換えない。
  store.openInspector(.daySettings(0))
  #expect(store.view.mapFocusedStopId == stopId)
}
