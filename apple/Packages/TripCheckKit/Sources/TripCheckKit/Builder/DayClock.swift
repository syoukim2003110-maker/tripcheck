import Foundation

/*
 * 1 日を時計に載せる。開始時刻を決め、ホテルからの往路・各停留所の滞在・区間の移動と乗換
 * バッファ・ホテルへの復路を順に足していき、締切(空港の締切と門限のうち早いほう)からどれだけ
 * はみ出したかを数える。
 *
 * 時計は「その日のローカル分」で回る。日跨ぎは日付(`date`)の仕事であって、ここで 1440 を
 * 足すことは決してしない — 翌 02:00 着を 26:00 として営業時間と比べてしまうから。
 *
 * lib/trip-builder.ts:1506-1700 (`buildDay`)、:309-321 (`dayLabel`, `openDayLabel`)。
 */
public enum DayClock {
  /// TS `dayLabel` (`lib/trip-builder.ts:309-314`)。`PlannerLocale` は ja/en の 2 値なので、
  /// TS の ko(`:311`)/zh(`:312`)の枝には移植先がない。
  public static func dayLabel(_ day: Int, locale: PlannerLocale) -> String {
    locale == .ja ? "\(day)日目" : "Day \(day)"
  }

  /// TS `openDayLabel` (`lib/trip-builder.ts:316-321`)。予定が 1 つも入っていない日の見出し。
  public static func openDayLabel(_ locale: PlannerLocale) -> String {
    locale == .ja ? "自由に使える日" : "Open day"
  }

  /// TS `buildDay` (`lib/trip-builder.ts:1506-1700`)。
  public static func buildDay(
    stops: [RouteStop],
    index: Int,
    dayCount: Int,
    locale: PlannerLocale,
    startBase: TripBase?,
    endBase: TripBase?,
    airportConstraints: [AirportConstraint],
    constraints: [String: WishlistStopConstraint],
    earlyVisitStopIds: Set<String>,
    foodStopIds: Set<String>,
    openingWindows: [String: [VisitWindow]],
    destination: Destination,
    requestedStart: String? = nil,
    startDate: String? = nil,
    travel: TravelInputs = .default,
    dayEndTarget: String? = nil,
    lockedOrder: [String] = []
  ) -> BuiltPlanDay {
    // 到着便が縛るのは初日だけ、出発便が縛るのは最終日だけ(`:1525-1526`)。
    let arrivalConstraint = index == 0 ? airportConstraints.first { $0.direction == .arrival } : nil
    let departureConstraint = index == dayCount - 1 ? airportConstraints.first { $0.direction == .departure } : nil
    // 実際のフライトだけが開始時刻を押し下げる。到着便がないなら 8:00 発の早起きは正当な選択
    // (`:1527-1533`)。TS の `clockMinutes(...)!` は型の主張にすぎず、実行時に null が来れば
    // `Math.max` が 0 に強制変換するので、Swift 側も `?? 0` にする。
    let arrivalReadyMinutes = arrivalConstraint.flatMap { ClockTime($0.cityTime)?.minutes } ?? 0
    let requestedStartMinutes = requestedStart.flatMap { ClockTime($0)?.minutes } ?? EngineConstants.defaultDayStart.minutes
    let startMinutes = max(requestedStartMinutes, arrivalReadyMinutes)
    let routeOrdered = DayOrdering.orderForReservations(
      stops: stops,
      base: startBase,
      startMinutes: startMinutes,
      constraints: constraints,
      earlyVisitStopIds: earlyVisitStopIds,
      foodStopIds: foodStopIds,
      openingWindows: openingWindows,
      meals: destination.meals,
      // 事前取得が覆うのは選ばれた下書きのレグだけで、全ペアの行列ではない。順序は安定に保ち、
      // 計測値は時計にだけ使う(`:1546-1547`)。
      travel: travel,
      lockedOrder: lockedOrder
    )
    // 1 日を丸ごと使う停留所(テーマパーク級)がその日の先頭に立つ。完璧な周回よりも午前が
    // 要るから。予約済みの時刻や明示的な日内順の固定はそれより強い(`:1550-1555`)。
    let dayAnchors = lockedOrder.isEmpty
      ? routeOrdered.filter {
          StayEstimates.isDayAnchorStay($0.planningDurationMinutes) && constraints[$0.id]?.fixedTimeMinutes == nil
        }
      : []
    let ordered = dayAnchors.isEmpty
      ? routeOrdered
      : dayAnchors + routeOrdered.filter { stop in !dayAnchors.contains { $0.id == stop.id } }
    // TS `addDaysToIsoDate(startDate, index)` (`:1559`、定義は `:367-373`)。日付が書かれていない、
    // または "YYYY-MM-DD" として読めない旅程は、日付を持たないまま進む。
    let date = startDate.flatMap { CalendarDate($0) }.map { $0.adding(days: index).description }
    let legs: [BuiltPlanLeg] = ordered.dropLast().enumerated().map { stopIndex, from in
      let to = ordered[stopIndex + 1]
      let comparison = Legs.routeComparison(from: from, to: to, travel: travel)
      let walkingMinutes = comparison.options.first { $0.mode == .walk }?.minutes ?? 0
      let walkingLimitExceededMinutes = max(
        0,
        walkingMinutes - (travel.maxWalkingMinutesPerLeg ?? EngineConstants.defaultMaxWalkingMinutesPerLeg)
      )
      let access = Legs.accessMetadataForLeg(from: from, to: to)
      return BuiltPlanLeg(
        from: from,
        to: to,
        comparison: comparison,
        googleMapsUrls: Legs.googleMapsUrlsForLeg(from: from, to: to),
        isLocalMealPause: false,
        walkingMinutes: walkingMinutes,
        walkingLimitExceededMinutes: walkingLimitExceededMinutes,
        transferCount: comparison.recommended.mode == .transit
          ? Legs.knownTransferCount(from: from, to: to, travel: travel)
          : nil,
        routeEvidenceScope: access.routeEvidenceScope,
        accessAssumptions: access.accessAssumptions
      )
    }
    var cursor = startMinutes
    var hotelTravelMinutes: Int?
    var hotelOutboundMinutes: Int?
    var hotelInboundMinutes: Int?
    var hotelOutboundMode: TransportMode?
    var hotelInboundMode: TransportMode?
    var hotelOutboundSource: ModeSource?
    var hotelInboundSource: ModeSource?
    var hotelOutboundTransferCount: Int?
    var hotelInboundTransferCount: Int?
    var hotelOutboundRouteEvidenceScope: RouteEvidenceScope?
    var hotelInboundRouteEvidenceScope: RouteEvidenceScope?
    var hotelOutboundAccessAssumptions: [PoiAccessAssumption]?
    var hotelInboundAccessAssumptions: [PoiAccessAssumption]?
    let transferBufferMinutes = travel.bufferMinutes ?? EngineConstants.defaultTransferBuffer
    // 往路だけが乗換バッファを背負う(`:1594-1607`)。
    if let startBase, let first = ordered.first {
      let access = Legs.accessMetadataForLeg(from: startBase.routeStop, to: first)
      let outbound = Legs.routeComparison(from: startBase.routeStop, to: first, travel: travel).recommended
      cursor += outbound.minutes + transferBufferMinutes
      hotelTravelMinutes = outbound.minutes
      hotelOutboundMinutes = outbound.minutes
      hotelOutboundMode = outbound.mode
      hotelOutboundSource = outbound.source ?? .estimate
      hotelOutboundTransferCount = outbound.mode == .transit
        ? Legs.knownTransferCount(from: startBase.routeStop, to: first, travel: travel)
        : nil
      hotelOutboundRouteEvidenceScope = access.routeEvidenceScope
      hotelOutboundAccessAssumptions = access.accessAssumptions
    }
    // TS `:1608-1636` の `ordered.map(...)` — 副作用(`cursor`)が順序に依存するので `for` で書く。
    var scheduledStops: [BuiltPlanStop] = []
    scheduledStops.reserveCapacity(ordered.count)
    for (stopIndex, stop) in ordered.enumerated() {
      let constraint = constraints[stop.id] ?? .default
      if let fixedTimeMinutes = constraint.fixedTimeMinutes { cursor = max(cursor, fixedTimeMinutes) }
      // 利用者が書いた「夕暮れに」「夜に」は訪問を夕方以降へ押し下げる。数字で書かれた時刻は
      // その曖昧な希望より強い(`:1611-1614`)。
      if constraint.fixedTimeMinutes == nil && constraint.timeOfDay == .evening { cursor = max(cursor, 16 * 60) }
      if constraint.fixedTimeMinutes == nil && constraint.timeOfDay == .night { cursor = max(cursor, 18 * 60) }
      let opening = fitVisitToWindow(cursor: cursor, duration: stop.planningDurationMinutes, windows: openingWindows[stop.id])
      if opening.status != .conflict && opening.status != .closed_day { cursor = opening.start }
      let reservationLateMinutes = constraint.fixedTimeMinutes.map { max(0, cursor - $0) } ?? 0
      let arrival = ClockTime(minutes: cursor).description
      cursor += stop.planningDurationMinutes
      let departure = ClockTime(minutes: cursor).description
      // TS `const leg = legs[stopIndex]` — 最後の停留所には続くレグがない(`:1621-1622`)。
      if stopIndex < legs.count { cursor += legs[stopIndex].comparison.recommended.minutes + transferBufferMinutes }
      scheduledStops.append(BuiltPlanStop(
        stop: stop,
        arrival: arrival,
        departure: departure,
        kind: .place,
        mealKind: nil,
        priority: constraint.priority,
        fixedTime: constraint.fixedTime,
        isReservation: constraint.isReservation,
        reservationLateMinutes: reservationLateMinutes,
        openingStatus: opening.status,
        crowd: CrowdOutlook.build(date: date, arrival: arrival, stop: stop)
      ))
    }
    let finishBase = endBase ?? startBase
    // 復路にはバッファを足さない。その日の予定はもう終わっていて、待たせる相手がいない(`:1638-1651`)。
    if let finishBase, let last = ordered.last {
      let access = Legs.accessMetadataForLeg(from: last, to: finishBase.routeStop)
      let inbound = Legs.routeComparison(from: last, to: finishBase.routeStop, travel: travel).recommended
      cursor += inbound.minutes
      hotelTravelMinutes = (hotelTravelMinutes ?? 0) + inbound.minutes
      hotelInboundMinutes = inbound.minutes
      hotelInboundMode = inbound.mode
      hotelInboundSource = inbound.source ?? .estimate
      hotelInboundTransferCount = inbound.mode == .transit
        ? Legs.knownTransferCount(from: last, to: finishBase.routeStop, travel: travel)
        : nil
      hotelInboundRouteEvidenceScope = access.routeEvidenceScope
      hotelInboundAccessAssumptions = access.accessAssumptions
    }
    // `cityTimeDayOffset === -1` は市内を出る刻限が前日に落ちているということ。負の分のまま
    // 持ち、日跨ぎは `deadlinePreviousDay` で伝える(`:1652-1654`)。
    let airportDeadline = departureConstraint.map {
      (ClockTime($0.cityTime)?.minutes ?? 0) + ($0.cityTimeDayOffset == -1 ? -1440 : 0)
    }
    // 門限は毎日の柔らかい目標。フライトの締切のほうが早ければ必ずそちらが勝つ — 飛行機は
    // 待ってくれないから(`:1655-1657`)。
    let curfewDeadline = dayEndTarget.flatMap { ClockTime($0)?.minutes }
    let deadlineMinutes: Int?
    if let airportDeadline, let curfewDeadline {
      deadlineMinutes = min(airportDeadline, curfewDeadline)
    } else {
      deadlineMinutes = airportDeadline ?? curfewDeadline
    }
    let deadlineKind: DeadlineKind?
    if deadlineMinutes == nil {
      deadlineKind = nil
    } else if let airportDeadline, curfewDeadline == nil || airportDeadline <= curfewDeadline! {
      deadlineKind = .airport
    } else {
      deadlineKind = .curfew
    }
    // TS `[...new Set(...)]` — 出現順のまま重複を落とす(`:1664`)。
    var seenAreas = Set<String>()
    let areas = ordered.map(\.area).filter { seenAreas.insert($0).inserted }
    let mapStops: [RouteStop] = startBase.map { base in
      [base.routeStop] + ordered + [(finishBase ?? base).routeStop]
    } ?? ordered
    return BuiltPlanDay(
      label: dayLabel(index + 1, locale: locale),
      date: date,
      theme: areas.isEmpty ? openDayLabel(locale) : areas.prefix(3).joined(separator: " · "),
      stops: scheduledStops,
      legs: legs,
      totalMinutes: cursor - startMinutes,
      startTime: ClockTime(minutes: startMinutes).description,
      requestedStartTime: ClockTime(minutes: requestedStartMinutes).description,
      startAdjustedByArrival: startMinutes > requestedStartMinutes,
      finishTime: ClockTime(minutes: cursor).description,
      hotelTravelMinutes: hotelTravelMinutes,
      hotelOutboundMinutes: hotelOutboundMinutes,
      hotelInboundMinutes: hotelInboundMinutes,
      hotelOutboundMode: hotelOutboundMode,
      hotelInboundMode: hotelInboundMode,
      hotelOutboundSource: hotelOutboundSource,
      hotelInboundSource: hotelInboundSource,
      hotelOutboundTransferCount: hotelOutboundTransferCount,
      hotelInboundTransferCount: hotelInboundTransferCount,
      hotelOutboundRouteEvidenceScope: hotelOutboundRouteEvidenceScope,
      hotelInboundRouteEvidenceScope: hotelInboundRouteEvidenceScope,
      hotelOutboundAccessAssumptions: hotelOutboundAccessAssumptions,
      hotelInboundAccessAssumptions: hotelInboundAccessAssumptions,
      startBase: startBase,
      endBase: finishBase,
      deadline: deadlineMinutes.map { ClockTime(minutes: $0).description },
      // TS は `deadlineMinutes < 0` のときだけキーを立てる(`:1693`)。それ以外は「なし」。
      deadlinePreviousDay: (deadlineMinutes.map { $0 < 0 } ?? false) ? true : nil,
      deadlineKind: deadlineKind,
      deadlineOverrunMinutes: deadlineMinutes.map { max(0, cursor - $0) } ?? 0,
      reservationConflictCount: scheduledStops.filter { $0.reservationLateMinutes > 0 }.count,
      openingConflictCount: scheduledStops.filter {
        $0.openingStatus == .conflict || $0.openingStatus == .closed_day || $0.openingStatus == .last_entry_conflict
      }.count,
      googleMapsUrl: ordered.isEmpty ? nil : GoogleMapsUrl.build(mapStops)
    )
  }
}
