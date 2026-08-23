import Foundation
import TripCheckKit

/*
 * 旅程を地図の点と線に畳んだもの。
 *
 * `PlannerStore+ViewModel.swift` の隣に別ファイルで置いてあるのは、`PlannerStore+Timeline.swift`
 * と同じ理由 —— あちらは「5 つの問い」の答え(見出し・警告・日タブ・帯・課題)だけを持つ
 * 1 ファイルで、そこに座標と範囲の計算を混ぜると、読む人がどちらを追っているのか分からなく
 * なる。約束(**ビューは計算しない**)は 3 ファイルで同じ。
 *
 * 描く形の規則そのものは `Map/MapModel.swift` の頭に書いた。ここが決めるのは「旅程のどの部分を
 * 渡すか」だけである。
 */

extension PlannerStore {

  /// 地図 1 枚ぶんの導出値。`scope` が `.day` なら選んでいる日だけ、`.all` なら全日程。
  ///
  /// 範囲は**出ている点の外接**。`.all` は全日程、`.day` はその日 —— 日を切り替えるたびに
  /// その日が画面に収まる(spec §5.4 の `fitBounds` 相当)。
  public func mapModel(scope: MapScope) -> MapModel {
    guard let plan = bundle?.plan else {
      return MapModel(pins: [], routes: [], region: MapModel.region(for: []), legendDays: [])
    }
    let selectedDay = view.selectedDay
    let days = plan.days.enumerated().filter { scope == .all || $0.offset == selectedDay }

    var pins: [MapPin] = []
    var routes: [MapRoute] = []
    // 同じ場所を 2 度訪ねる旅程も、拠点が同じ 2 日も書ける。地図では同じ点なので、
    // **id ごとに 1 つだけ**置く —— `ForEach` は id が重なった時点で何を描くか決められない。
    var placed = Set<String>()

    for (dayIndex, day) in days {
      let colorHex = DayPalette.color(forDayIndex: dayIndex)
      let selected = dayIndex == selectedDay

      for (index, built) in day.stops.enumerated() where placed.insert(built.stop.id).inserted {
        pins.append(stopPin(built, number: index + 1, dayIndex: dayIndex, colorHex: colorHex))
      }
      // 拠点はその日の始まりと終わりに 1 つずつ。決まっていない旅では出さない ——
      // 行き先の無いホテルのピンは、決めていない宿を決まったことにしてしまう。
      for base in [day.startBase ?? plan.selectedBase, day.endBase ?? plan.selectedBase].compactMap({ $0 })
      where placed.insert(base.id).inserted {
        pins.append(basePin(base, dayIndex: dayIndex, colorHex: colorHex))
      }
      for (index, leg) in day.legs.enumerated() {
        routes.append(MapRoute(
          id: "leg:\(dayIndex):\(index)",
          dayIndex: dayIndex,
          points: [
            GeoPoint(latitude: leg.from.latitude, longitude: leg.from.longitude),
            GeoPoint(latitude: leg.to.latitude, longitude: leg.to.longitude),
          ],
          // 鍵ゼロ: 区間の形を運ぶ欄が `BuiltPlanLeg` にそもそも無い。経路の提供元が入る次の
          // spec まで、ここが真になる道は 1 本も無い(`Map/MapModel.swift` の頭を見よ)。
          measured: false,
          selected: selected
        ))
      }
    }

    // まだ何も入っていない日を選んでいると、その日の外接は作れない。旅全体に寄る ——
    // 中心 0,0(大西洋のまん中)へ飛ばすより、「この旅はこのあたり」を見せるほうが正しい。
    let framed = pins.isEmpty
      ? plan.days.flatMap(\.stops).map { GeoPoint(latitude: $0.stop.latitude, longitude: $0.stop.longitude) }
      : pins.map(\.coordinate)

    return MapModel(
      pins: pins,
      routes: routes,
      region: MapModel.region(for: framed),
      legendDays: days.map { (index: $0.offset, colorHex: DayPalette.color(forDayIndex: $0.offset)) }
    )
  }

  /// 地図とタイムラインの強調を合わせる唯一の入口。行を押しても、ピンを押しても、ここを通る。
  ///
  /// **その場所が属する日も一緒に選ぶ。** 全日程を映しているときに 3 日目のピンを押して
  /// 1 日目の旅程が開いたままだと、そのあと開く詳細がどの日の話なのか読めない。
  public func focusStop(id: String) {
    view.mapFocusedStopId = id
    guard let plan = bundle?.plan,
          let dayIndex = plan.days.firstIndex(where: { $0.stops.contains { $0.stop.id == id } }),
          dayIndex != view.selectedDay
    else { return }
    selectDay(dayIndex)
  }

  // MARK: - 点 1 つずつ

  private func stopPin(_ built: BuiltPlanStop, number: Int, dayIndex: Int, colorHex: String) -> MapPin {
    let stop = built.stop
    let kind = Self.pinKind(for: built, number: number)
    return MapPin(
      id: stop.id,
      // 停留所の点はほぼ全部開ける。**種別で閉ざさない** —— 注意のピンも手動の点も、
      // 旅行者が頼んだ本物の停留所で、直しに行く先はその詳細シートである。
      stopId: Self.opensStop(kind) ? stop.id : nil,
      coordinate: GeoPoint(latitude: stop.latitude, longitude: stop.longitude),
      kind: kind,
      dayIndex: dayIndex,
      colorHex: colorHex,
      // 絵で名乗る種別は丸の中に字を持たない —— `fork` の上に番号を重ねると、どちらも読めない。
      label: Self.showsNumber(kind) ? "\(number)" : "",
      a11y: AppCopy.for(request.locale).mapPinLabel(name: stop.name, kind: kindName(kind))
    )
  }

  private func basePin(_ base: TripBase, dayIndex: Int, colorHex: String) -> MapPin {
    MapPin(
      id: base.id,
      // 拠点は停留所ではない。押しても開く詳細が無いので、鍵を持たせない。
      stopId: nil,
      coordinate: GeoPoint(latitude: base.latitude, longitude: base.longitude),
      kind: .hotel,
      dayIndex: dayIndex,
      colorHex: colorHex,
      label: "",
      a11y: AppCopy.for(request.locale).mapPinLabel(name: base.name, kind: kindName(.hotel))
    )
  }

  /// 種別は 1 つだけ選ぶ。順は**旅行者が今できることの順**:直すものがある(注意)>
  /// 食事の場所 > 提案 > 自分で置いた点 > 頼んだ場所。
  ///
  /// `.filler` と `.meal` は**今日は作られない**。ビルダーが作る `BuiltPlanStop` は常に
  /// `kind: .place, mealKind: nil` で(`Sources/TripCheckKit/Builder/DayClock.swift:153-158`、
  /// 移植元の TS も同じ)、食事は「枠」——`plan.foodRecommendationSlots`——としてしか出てこない。
  /// 枠は自分の座標を持たず、動線が通る停留所の座標を借りているだけなので、地図に置くと
  /// 訪問のピンとぴったり重なり、「ここに食事の店がある」と読めてしまう。**採用した推薦が
  /// 自分の場所を持つ次の spec** で、この 2 つが初めて点になる(タイムラインの食事行が
  /// 「この時間に枠がある」しか言わないのと同じ線引き)。
  private nonisolated static func pinKind(for built: BuiltPlanStop, number: Int) -> MapPin.Kind {
    if built.reservationLateMinutes > 0 || conflictStatuses.contains(built.openingStatus) { return .warning }
    if let mealKind = built.mealKind { return .meal(mealKind) }
    if built.kind == .meal { return .filler }
    if built.stop.userProvidedCoordinates == true { return .manual }
    return .anchor(number: number)
  }

  /// 丸の中に番号を出す種別。絵(`fork` / `bed` / `spark`)だけで名乗るものは出さない。
  ///
  /// **手動の点も番号を出す。** 「1・2・+・4」と並ぶ日は訪問の順が 1 か所だけ読めなくなる
  /// (v1.1 §7.1 / §5.6「日の識別は常に番号と併用」)。`+` は番号を追い出さず、
  /// `!` と同じように丸の隅に付く小さな印になる(`PinView.badge`)。
  private nonisolated static func showsNumber(_ kind: MapPin.Kind) -> Bool {
    switch kind {
    case .anchor, .warning, .manual: true
    case .filler, .meal, .hotel: false
    }
  }

  /// 押すと詳細シートが開く種別。停留所そのものを指している点だけが開く。
  ///
  /// `.hotel` は拠点で、`.meal` は場所を持たない食事の枠 —— どちらも `Inspector.stop(id)` が
  /// 引ける相手ではない。残りは全部開く。
  private nonisolated static func opensStop(_ kind: MapPin.Kind) -> Bool {
    switch kind {
    case .anchor, .warning, .manual, .filler: true
    case .meal, .hotel: false
    }
  }

  /// 耳に名乗る種別の語。予定地点とおすすめ地点は**凡例と同じ Kit の鍵**から来る ——
  /// 凡例が「予定地点」と読み、ピンが別の語を名乗る地図は、凡例が凡例でなくなる。
  private func kindName(_ kind: MapPin.Kind) -> String {
    let locale = request.locale
    let text = Copy.for(locale)
    let app = AppCopy.for(locale)
    switch kind {
    case .anchor: return text.legendAnchor
    case .filler: return text.legendSuggestion
    case .meal(let mealKind): return TimelinePresentation.fillerRowLabel(mealKind == .lunch ? .lunch : .dinner, locale: locale)
    case .hotel: return app.mapPinHotel
    case .manual: return app.mapPinManual
    case .warning: return app.mapPinWarning
    }
  }
}
