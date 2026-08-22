import Foundation

/// TS `buildTripFromWishlist` の引数 5 つ(`lib/trip-builder.ts:1938-1944`)を 1 つの値にまとめた
/// もの。TS は位置引数だが、Swift 側は保存・再生できるほうが都合がよい(ゴールデン比較、
/// アプリの下書き保存)ので `Codable` にしてある。
public struct TripRequest: Codable, Sendable, Equatable {
  public var raw: String
  public var days: Int
  public var pace: Pace
  public var locale: PlannerLocale
  public var context: PlannerContext

  public init(
    raw: String,
    days: Int,
    pace: Pace,
    locale: PlannerLocale = .en,
    context: PlannerContext = PlannerContext()
  ) {
    self.raw = raw
    self.days = days
    self.pace = pace
    self.locale = locale
    self.context = context
  }
}

/// TS `buildTripFromWishlist` (`lib/trip-builder.ts:1938-2300`) — ウィッシュリスト(または
/// 貼り付けられた既存旅程)の生テキストと計画の文脈から、組み上がった旅程を返す入口。
///
/// ここは新しい判断をしない。パーサ・カタログ・地理クラスタ・日割り探索・時計・空港・拠点・
/// 食事枠という既存の部品を、**TS と同じ順序で**呼ぶだけの結線である。
public enum TripBuilder {

  // MARK: - 制約

  /// TS `constraintFromParsedPlace` (`lib/trip-builder.ts:323-333`)
  static func constraint(from place: ParsedWishlistPlace) -> WishlistStopConstraint {
    WishlistStopConstraint(
      // `WishlistPriority` と `StopPriority` は同じ 3 語の raw value を持つ(TS は同じ型)。
      priority: StopPriority(rawValue: place.priority.rawValue) ?? .normal,
      fixedDay: place.day,
      fixedTime: place.time,
      fixedTimeMinutes: place.time.flatMap { ClockTime($0)?.minutes },
      timeOfDay: place.timeOfDay,
      isReservation: place.isReservation,
      stayMinutes: place.stayMinutes
    )
  }

  /// TS `mergeConstraints` (`lib/trip-builder.ts:335-348`) — 同じ場所が 2 行に出たときの合流。
  /// 優先度は高いほうが残り、日・時刻・滞在は**後の行**が勝ち、予約は片方でも真なら真。
  static func merge(_ current: WishlistStopConstraint?, _ next: WishlistStopConstraint) -> WishlistStopConstraint {
    guard let current else { return next }
    let rank: [StopPriority: Int] = [.optional: 0, .normal: 1, .must: 2]
    return WishlistStopConstraint(
      priority: (rank[next.priority] ?? 0) > (rank[current.priority] ?? 0) ? next.priority : current.priority,
      fixedDay: next.fixedDay ?? current.fixedDay,
      fixedTime: next.fixedTime ?? current.fixedTime,
      fixedTimeMinutes: next.fixedTimeMinutes ?? current.fixedTimeMinutes,
      timeOfDay: next.timeOfDay ?? current.timeOfDay,
      isReservation: current.isReservation || next.isReservation,
      stayMinutes: next.stayMinutes ?? current.stayMinutes
    )
  }

  /// TS `normalizedInput` (`lib/trip-builder.ts:1954`) — NFKC 畳み込み + 前後空白除去 + 小文字化。
  /// TS の `toLocaleLowerCase()` は引数なしなので実行環境の既定ロケール、Swift の `lowercased()`
  /// はロケール非依存。トルコ語ロケールの `I` 以外では同じ結果になる。
  static func normalizedInput(_ value: String) -> String {
    value.precomposedStringWithCompatibilityMapping
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased()
  }

  // MARK: - 入口

  public static func build(_ request: TripRequest) -> BuiltTripPlan {
    let raw = request.raw
    let requestedDays = request.days
    let pace = request.pace
    let locale = request.locale
    let context = request.context

    var knownStops: [RouteStop] = []
    var unknownEntries: [String] = []
    var constraints: [String: WishlistStopConstraint] = [:]
    // TS の `constraints` は `Map` で挿入順を持つ。`applyFixedDays` がその順に走る
    // (`:996-1043`)ので、Swift 側は順序を別に持って `constraintOrder:` として渡す。
    var constraintOrder: [String] = []
    let parsedInput = WishlistParser.parse(raw)

    // TS `:1946-1948` — 見出し行、または日付を持つ場所が 1 つでもあれば既存旅程モード。
    let inputMode: InputMode = parsedInput.contains { line in
      switch line {
      case .heading: return true
      case .place(_, let places): return places.contains { $0.day != nil }
      default: return false
      }
    } ? .existing_itinerary : .wishlist

    var parsedOrderByDay: [Int: [String]] = [:]
    var placeOccurrenceIndex = 0

    // TS `:1956-1969` — 解決済み停留所を「入力の何番目か(inputIndex)」と「正規化した入力語」の
    // 2 つの索引に分ける。同じ索引に複数来たら id の小さいほう(localeCompare)を採る。
    var indexedResolvedStops: [Int: ResolvedStop] = [:]
    var unindexedResolvedStops: [String: [ResolvedStop]] = [:]
    for candidate in context.resolvedStops ?? [] {
      if let inputIndex = candidate.inputIndex, inputIndex >= 0 {
        // TS `:1960` は `localeCompare` — `jsLocaleCompare` を使う。
        if let current = indexedResolvedStops[inputIndex], jsLocaleCompare(candidate.id, current.id) >= 0 { continue }
        indexedResolvedStops[inputIndex] = candidate
        continue
      }
      unindexedResolvedStops[normalizedInput(candidate.input), default: []].append(candidate)
    }
    // TS `:1968` も `localeCompare`。
    for key in unindexedResolvedStops.keys {
      unindexedResolvedStops[key] = stableSorted(unindexedResolvedStops[key] ?? []) { jsLocaleCompare($0.id, $1.id) < 0 }
    }
    var usedResolvedStopIds = Set<String>()

    // TS `:1971-2003` — 1 行ずつ、1 件ずつ解決して制約を積む。
    for line in parsedInput {
      guard case .place(_, let places) = line else { continue }
      for place in places {
        let inputIndex = placeOccurrenceIndex
        placeOccurrenceIndex += 1
        let entry = place.name
        let parsedConstraint = constraint(from: place)
        let exactUnindexedMatches = unindexedResolvedStops[normalizedInput(entry)] ?? []
        // 索引のない候補が複数あるのは曖昧。出現位置に紐づいた旅行者の選択だけが 1 件を選べる
        // ので、プロバイダの先頭行を勝手に採ることはしない(`:1980-1982`)。
        let providerStop = indexedResolvedStops[inputIndex]
          ?? (exactUnindexedMatches.count == 1 ? exactUnindexedMatches[0] : nil)
        let userFoodReservation = resolveUserFoodReservation(entry: entry, constraint: parsedConstraint, locale: locale)

        let resolved: [RouteStop]
        if let providerStop {
          var stop = providerStop.routeStop
          // プロバイダは同じ問い合わせ 2 行に 1 件だけ返すことがある。確認済みの出現ごとに
          // 別々に指せるようにして、日や時刻の制約が最初の訪問に畳まれないようにする(`:1986-1992`)。
          stop.id = usedResolvedStopIds.contains(providerStop.id)
            ? "\(providerStop.id)--occurrence-\(inputIndex + 1)"
            : providerStop.id
          stop.isAnchor = parsedConstraint.isReservation || parsedConstraint.priority == .must
          resolved = [stop]
        } else if let userFoodReservation {
          resolved = [userFoodReservation]
        } else {
          resolved = Catalog.resolveKnownStops(entry, locale: locale)
        }

        if resolved.isEmpty {
          unknownEntries.append(entry)
          continue
        }
        for stop in resolved {
          if providerStop != nil { usedResolvedStopIds.insert(stop.id) }
          if !knownStops.contains(where: { $0.id == stop.id }) { knownStops.append(stop) }
          if constraints[stop.id] == nil { constraintOrder.append(stop.id) }
          constraints[stop.id] = merge(constraints[stop.id], parsedConstraint)
          if inputMode == .existing_itinerary, let day = place.day {
            let dayIndex = day - 1
            var order = parsedOrderByDay[dayIndex] ?? []
            if !order.contains(stop.id) { order.append(stop.id) }
            parsedOrderByDay[dayIndex] = order
          }
        }
      }
    }

    // 順序の固定は日の固定でもある。インスペクタの上書きより**前**に効かせるので、あとから
    // 明示的に日を動かせば、前の版に残った古い固定を意図的に置き換えられる(`:2025-2027`)。
    var lockedDayByStop: [String: Int] = [:]
    let knownStopIds = Set(knownStops.map(\.id))
    for (dayIndex, stopIds) in (context.lockedOrderByDay?.values ?? [:]).sorted(by: { $0.key < $1.key }) {
      guard dayIndex >= 0, dayIndex < requestedDays else { continue }
      for stopId in stopIds {
        guard knownStopIds.contains(stopId), lockedDayByStop[stopId] == nil else { continue }
        lockedDayByStop[stopId] = dayIndex
        let existing = constraints[stopId] ?? .default
        guard existing.fixedDay == nil else { continue }
        if constraints[stopId] == nil { constraintOrder.append(stopId) }
        var updated = existing
        updated.fixedDay = dayIndex + 1
        constraints[stopId] = updated
      }
    }

    // インスペクタの 1 タップで停留所が別の日へ移る。この選択は、ウィッシュリストに書かれた
    // 「2日目」マーカーとまったく同じ振る舞いをする(`:2039-2045`)。
    //
    // TS は `Object.entries` = 挿入順で回る。Swift の `Dictionary` に順序はないので、
    // **id の昇順**(`jsStringLess`)で回す。結果に差が出るのは「同じ日に 2 件以上を
    // 上書きで固定し、かつその id がまだ制約表に無い」場合の `constraintOrder` だけ。
    for (stopId, day) in (context.dayOverrides ?? [:]).sorted(by: { jsStringLess($0.key, $1.key) }) {
      guard day >= 1, day <= requestedDays else { continue }
      if constraints[stopId] == nil { constraintOrder.append(stopId) }
      var updated = constraints[stopId] ?? .default
      updated.fixedDay = day
      constraints[stopId] = updated
      lockedDayByStop[stopId] = day - 1
    }

    // 滞在時間は合流後の制約から引くので、同じ場所が 2 行に出ても滞在マーカーが効く。
    // 停留所ごとの編集(や根拠バッファ)がウィッシュリストの「滞在90分 / stay 90 min」に勝ち、
    // それが見積もりに勝つ(`:2047-2058`)。
    for index in knownStops.indices {
      let stop = knownStops[index]
      let durationOverride = context.durationOverrides?[stop.id]
      let stayMinutes = constraints[stop.id]?.stayMinutes ?? nil
      let effectiveDuration: Int?
      if let durationOverride, EngineConstants.stayMinutesRange.contains(durationOverride) {
        effectiveDuration = durationOverride
      } else {
        effectiveDuration = stayMinutes
      }
      if let effectiveDuration { knownStops[index].planningDurationMinutes = effectiveDuration }
    }

    // 「外す」の 1 タップで、やめた停留所が消える。残りはその穴の周りで組み直される(`:2060-2065`)。
    let excludedStopIds = Set(context.excludedStopIds ?? [])
    let activeStops = excludedStopIds.isEmpty
      ? knownStops
      : knownStops.filter { !excludedStopIds.contains($0.id) }
    let minimumPinnedDay = activeStops.reduce(1) { maximum, stop in
      guard let fixedDay = constraints[stop.id]?.fixedDay else { return maximum }
      return max(maximum, fixedDay)
    }

    // "auto" のときは、実際に計画に入った停留所の国が決める。だからスイスのウィッシュリストは
    // 言わずともスイスの食事時間・空港・移動手段の傾向を得る(`:2070`)。
    let destination = DestinationVote.resolve(context: context, stops: activeStops)
    // TS `:2071-2093` — 文脈の live* 群から `TravelInputs` を 1 度だけ作り、以降は使い回す。
    let bufferMinutes = EngineConstants.transferBufferChoices.contains(context.transferBufferMinutes ?? EngineConstants.defaultTransferBuffer)
      ? (context.transferBufferMinutes ?? EngineConstants.defaultTransferBuffer)
      : EngineConstants.defaultTransferBuffer
    let travelInputs = TravelInputs(
      preference: context.travelPreference ?? .auto,
      mobility: destination.mobility,
      transit: context.liveTransitMinutes,
      transitAbsent: context.liveTransitAbsentLegs,
      transfers: context.liveTransitTransferCounts,
      walking: context.liveWalkingMinutes,
      driving: context.liveDrivingMinutes,
      overrides: context.legModeOverrides,
      bufferMinutes: bufferMinutes,
      maxWalkingMinutesPerLeg: context.maxWalkingMinutesPerLeg.map { min(180, max(5, $0)) }
        ?? EngineConstants.defaultMaxWalkingMinutesPerLeg,
      maxTransfersPerLeg: context.maxTransfersPerLeg.map { min(8, max(0, $0)) }
        ?? EngineConstants.defaultMaxTransfersPerLeg
    )
    let mobilityPolicy = MobilityPolicy(
      maxWalkingMinutesPerLeg: travelInputs.maxWalkingMinutesPerLeg ?? EngineConstants.defaultMaxWalkingMinutesPerLeg,
      maxTransfersPerLeg: travelInputs.maxTransfersPerLeg ?? EngineConstants.defaultMaxTransfersPerLeg,
      walkingLimitWasProvided: context.maxWalkingMinutesPerLeg != nil,
      transferLimitWasProvided: context.maxTransfersPerLeg != nil
    )

    let hotelQuery = context.hotelQuery?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let selectedBase = Bases.resolveTripBase(query: hotelQuery, resolved: context.resolvedBase, locale: locale)
    let airportConstraints = Airports.buildAirportConstraints(
      context: context, destination: destination, base: selectedBase, travel: travelInputs
    )
    // 深夜着の便で街に入るのが翌日になると、活動 1 日目は暦日 1(`:2096-2099`)。
    let activityStartDayOffset = max(0, airportConstraints.first { $0.direction == .arrival }?.cityTimeDayOffset ?? 0)
    let activityStartDate = context.tripStartDate.flatMap { CalendarDate($0) }
      .map { $0.adding(days: activityStartDayOffset).description }
      ?? context.tripStartDate
    let openingWindowsByActivityDay = Clustering.activityDayOpeningWindows(
      context.openingWindowsByDay ?? [:],
      calendarDayOffset: activityStartDayOffset
    )
    // TS `:2104-2107`
    var lastEntryMinutesByStop: [String: Int] = [:]
    for (stopId, value) in context.lastEntryTimes ?? [:] {
      guard let minutes = ClockTime(value)?.minutes else { continue }
      lastEntryMinutesByStop[stopId] = minutes
    }
    // TS `:2108-2123` — 営業時間の根拠と入場締切の根拠を、日ごとの「入れる窓」に畳む。
    var accessWindowsByActivityDay: [String: IntKeyedDictionary<[VisitWindow]>] = [:]
    for stop in activeStops {
      let lastEntryMinutes = lastEntryMinutesByStop[stop.id]
      let providerDays = openingWindowsByActivityDay[stop.id] ?? IntKeyedDictionary()
      var daysWithEvidence = Set(providerDays.values.keys)
      if lastEntryMinutes != nil { daysWithEvidence.formUnion(0..<max(0, requestedDays)) }
      if daysWithEvidence.isEmpty { continue }
      var windowsByDay = IntKeyedDictionary<[VisitWindow]>()
      for dayIndex in daysWithEvidence.sorted() {
        let windows = providerDays[dayIndex] ?? [VisitWindow(openMinutes: 0, closeMinutes: 24 * 60)]
        windowsByDay[dayIndex] = windows.map { window in
          guard let lastEntryMinutes else { return window }
          var copy = window
          copy.lastEntryMinutes = lastEntryMinutes
          return copy
        }
      }
      accessWindowsByActivityDay[stop.id] = windowsByDay
    }

    let paceCapacity = EngineConstants.paceStopsPerDay[pace] ?? 4
    // TS `:2126` は空配列を `clusterStops` に渡さない(渡すと `reduce` が落ちる)。同じ位置で守る。
    let initialClusters = activeStops.isEmpty ? [] : Clustering.clusterStops(activeStops, requestedDays: requestedDays)
    let fixedClusters = Clustering.applyFixedDays(initialClusters, constraints: constraints, constraintOrder: constraintOrder)
    // 日の入れ替えはプロバイダの営業日に従う。入場締切は最終的な時計で別に評価するので、その
    // 固有の衝突と根拠が「営業していない」に潰れない(`:2128-2131`)。
    let openingAssignment = Clustering.applyOpeningDays(
      fixedClusters, constraints: constraints, availability: openingWindowsByActivityDay, capacity: paceCapacity
    )
    let fullClusters = openingAssignment.clusters
    var clusters = fullClusters
    var deferredOptionalStops: [RouteStop] = []

    // TS `:2134-2141`
    let paceTrim = Clustering.trimToPaceCapacity(clusters, constraints: constraints, capacity: paceCapacity)
    clusters = paceTrim.clusters
    deferredOptionalStops.append(contentsOf: paceTrim.deferred)
    // TS `:2142-2176`
    let spread = Clustering.spreadDayAnchors(clusters, constraints: constraints, capacity: paceCapacity)
    clusters = spread.clusters
    deferredOptionalStops.append(contentsOf: spread.deferred)
    // TS `:2177-2196`
    let dayBudgetMinutes = EngineConstants.paceDayBudgetMinutes[pace] ?? 570
    let firstBudgetTrim = Clustering.trimToDayBudget(clusters, constraints: constraints, budget: dayBudgetMinutes)
    clusters = firstBudgetTrim.clusters
    deferredOptionalStops.append(contentsOf: firstBudgetTrim.deferred)

    // TS `:2197-2198` — 拠点の推薦は**間引く前**のクラスタで測る。
    let scheduledKnownStops = fullClusters.flatMap { $0 }
    let baseRecommendations = Bases.recommendBases(
      stops: scheduledKnownStops,
      clusters: fullClusters,
      locale: locale,
      nationwide: !(context.resolvedStops ?? []).isEmpty
    )
    let earlyVisitStopIds = Set(context.earlyVisitStopIds ?? [])
    // 解決済み停留所は実行時に Google の placeTypes を持つ。レストランやカフェは日を開ける
    // のではなく食事の窓に寄せて組む(`:2200-2205`)。
    let foodStopIds = Set(
      activeStops.filter { StayEstimates.isFoodPlaceTypes($0.placeTypes ?? []) }.map(\.id)
    )

    // 夜 N は日 N のあとに眠る場所。日は前夜のホテルから始まり今夜のホテルで終わる。
    // 端を丸めることで初日と最終日が最初/最後の夜に固定され、欠けた夜は旅全体の拠点に落ちる
    // ——ホテル 1 つの旅はこれまでどおりに振る舞う(`:2206-2222`)。
    let nightCount = max(1, clusters.count - 1)
    func nightBaseFor(_ night: Int) -> TripBase? {
      let clamped = max(0, min(nightCount - 1, night))
      guard let resolved = context.nightBases?[clamped] ?? nil else { return selectedBase }
      var base = TripBase(routeStop: resolved.routeStop, query: resolved.name)
      base.id = "base-\(resolved.id)"
      base.planningDurationMinutes = 0
      base.isAnchor = false
      return base
    }

    // TS `:2223-2245`
    func buildCandidateDay(_ cluster: [RouteStop], _ index: Int) -> BuiltPlanDay {
      var openingWindows: [String: [VisitWindow]] = [:]
      for stop in cluster {
        if let windows = accessWindowsByActivityDay[stop.id]?[index] { openingWindows[stop.id] = windows }
      }
      let requestedDayEnd = context.dayEndTimes?[index] ?? context.dayEndTarget
      return DayClock.buildDay(
        stops: cluster,
        index: index,
        dayCount: clusters.count,
        locale: locale,
        startBase: nightBaseFor(index - 1),
        endBase: nightBaseFor(index),
        airportConstraints: airportConstraints,
        constraints: constraints,
        earlyVisitStopIds: earlyVisitStopIds,
        foodStopIds: foodStopIds,
        openingWindows: openingWindows,
        destination: destination,
        requestedStart: context.dayStartTimes?[index] ?? context.defaultDayStart,
        startDate: activityStartDate,
        travel: travelInputs,
        // TS `:2237-2239` — 時計として読めない指定は既定の 22:00 に落とす。
        dayEndTarget: requestedDayEnd.flatMap { ClockTime($0) } == nil
          ? EngineConstants.defaultDayEnd.description
          : requestedDayEnd,
        lockedOrder: context.lockedOrderByDay?[index]
          ?? ((context.optimizeExistingOrder ?? false) ? [] : parsedOrderByDay[index] ?? [])
      )
    }

    // TS `:2242-2246`
    clusters = DayAssignment.optimize(
      initial: clusters,
      constraints: constraints,
      lockedDayByStop: lockedDayByStop,
      build: buildCandidateDay,
      limits: DayAssignmentLimits(paceCapacity: paceCapacity, dayBudgetMinutes: dayBudgetMinutes)
    )
    // 入れ替えは、予算に収まる 2 日から予算を超える 1 日を組み上げてしまうことがある。
    // 返す日程が種と同じ天井を守るよう、末尾の任意をもう一度だけ落とす(`:2247-2251`)。
    let secondBudgetTrim = Clustering.trimToDayBudget(clusters, constraints: constraints, budget: dayBudgetMinutes)
    clusters = secondBudgetTrim.clusters
    deferredOptionalStops.append(contentsOf: secondBudgetTrim.deferred)

    var days = clusters.enumerated().map { buildCandidateDay($1, $0) }
    // TS `:2252-2261`
    let deadlineTrim = Clustering.trimLastDayToDeadline(
      clusters: clusters, days: days, constraints: constraints, build: buildCandidateDay
    )
    clusters = deadlineTrim.clusters
    days = deadlineTrim.days
    deferredOptionalStops.append(contentsOf: deadlineTrim.deferred)

    // 候補のどの日も閉まっている「任意」の場所は、宣言されたトレードオフであって矛盾ではない。
    // 必須・Must はそのまま unavailable に残し、判定が 2 つを区別できるようにする(`:2262-2271`)。
    let deferredUnavailableStops = openingAssignment.unavailable.filter {
      (constraints[$0.id] ?? .default).priority != .optional
    }
    for stop in openingAssignment.unavailable {
      guard (constraints[stop.id] ?? .default).priority == .optional else { continue }
      if !deferredOptionalStops.contains(where: { $0.id == stop.id }) { deferredOptionalStops.append(stop) }
    }

    let scheduledStopCount = days.reduce(0) { $0 + $1.stops.filter { $0.kind == .place }.count }
    let foodRecommendationSlots = MealSlots.build(
      days: days, destination: destination, mealPlan: context.mealPlan ?? .none, locale: locale
    )

    // TS `:2277` — `[...new Set(unknownEntries)]` は初出順を保つ。
    var seenUnknown = Set<String>()
    let dedupedUnknownEntries = unknownEntries.filter { seenUnknown.insert($0).inserted }

    return BuiltTripPlan(
      inputMode: inputMode,
      destination: destination.id,
      requestedDays: requestedDays,
      recognizedStopCount: activeStops.count,
      scheduledStopCount: scheduledStopCount,
      mealBreakCount: 0,
      unknownEntries: dedupedUnknownEntries,
      deferredOptionalStops: deferredOptionalStops,
      deferredUnavailableStops: deferredUnavailableStops,
      // TS `:2280-2282`
      constraintCount: constraints.values.filter {
        $0.priority != .normal || $0.fixedDay != nil || $0.fixedTime != nil
      }.count + lastEntryMinutesByStop.count,
      minimumPinnedDay: minimumPinnedDay,
      overCapacityCount: clusters.reduce(0) { $0 + max(0, $1.count - paceCapacity) },
      scheduleConflictCount: days.filter {
        $0.deadlineOverrunMinutes > 0 || $0.reservationConflictCount > 0 || $0.openingConflictCount > 0
      }.count,
      selectedBase: selectedBase,
      hotelQuery: hotelQuery,
      hotelResolved: selectedBase != nil,
      travelPreference: travelInputs.preference,
      mobilityPolicy: mobilityPolicy,
      baseRecommendations: baseRecommendations,
      airportConstraints: airportConstraints,
      foodRecommendationSlots: foodRecommendationSlots,
      days: days
    )
  }
}
