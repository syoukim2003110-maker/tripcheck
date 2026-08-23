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
