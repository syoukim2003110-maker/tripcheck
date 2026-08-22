import Foundation

/*
 * 「この日数でこのウィッシュリストは入るのか」を測る層。
 *
 * lib/trip-scenarios.ts:132-429 —— `clockMinutes` `:132`、`paceCapacity` `:141`、`dayWindow` `:145`、
 * `totalPlanBufferMinutes` `:193`、`evaluateCapacity` `:202`、`suggestedCutCount` `:217`、
 * `cutCandidates` `:227`、`minimumDaysAssumptions` `:278`、`assessTripFit` `:325-429`。
 *
 * 出力の型は `Scenarios/TripFitTypes.swift`(Task 16 が先に置いた)にある。
 */
public enum TripScenarios {

  // MARK: - 1 日の窓

  /// TS `paceCapacity` (`lib/trip-scenarios.ts:141-143`)。TS は 3/5/4 を直書きしているが、同じ表が
  /// `EngineConstants.paceStopsPerDay` にある(統合仕様 §7.2)。
  static func paceCapacity(_ pace: Pace) -> Int {
    EngineConstants.paceStopsPerDay[pace] ?? 4
  }

  /// TS `dayWindow` (`lib/trip-scenarios.ts:145-191`)。
  ///
  /// 「ペースと希望件数は快適さの合図であって事実ではない。1 日を不可能にできるのは
  /// 旅行者が実際に使える時計の窓だけ」——`availableMinutes` に件数が一切入らないのはそのため。
  static func dayWindow(_ day: BuiltPlanDay, dayIndex: Int, pace: Pace, dayEnd: String) -> TripFitDay {
    let start = ClockTime(day.startTime)?.minutes ?? 0
    let ordinaryEnd = ClockTime(dayEnd)?.minutes ?? EngineConstants.defaultDayEnd.minutes
    // TS `day.deadline ? clockMinutes(day.deadline) : null` — 空文字は falsy なので null 扱い。
    let deadline: Int? = {
      guard let text = day.deadline, !text.isEmpty else { return nil }
      return ClockTime(text)?.minutes
    }()
    // 最終日の 02:00 空港締切は 09:00 開始の「17 時間後」ではなく「前」。翌日へ黙って繰り越さない。
    let clockWindow: Int
    if day.deadlinePreviousDay == true {
      clockWindow = 0
    } else if let deadline {
      clockWindow = max(0, min(ordinaryEnd, deadline) - start)
    } else {
      clockWindow = max(0, ordinaryEnd - start)
    }
    let availableMinutes = clockWindow
    let placeCount = day.stops.filter { $0.kind == .place }.count
    let capacity = paceCapacity(pace)
    let overrunMinutes = max(0, day.totalMinutes - availableMinutes)
    let boundedByDeadline = deadline != nil && deadline! <= ordinaryEnd
    let limitedBy: TripFitLimit = boundedByDeadline && day.deadlineKind == .airport ? .airport : .curfew
    return TripFitDay(
      dayIndex: dayIndex,
      label: day.label,
      startTime: day.startTime,
      usableUntil: boundedByDeadline ? (day.deadline ?? dayEnd) : dayEnd,
      availableMinutes: availableMinutes,
      plannedMinutes: day.totalMinutes,
      slackMinutes: availableMinutes - day.totalMinutes,
      overrunMinutes: overrunMinutes,
      placeCount: placeCount,
      placeCapacity: capacity,
      excessPlaceCount: max(0, placeCount - capacity),
      hasScheduleConflict: day.deadlineOverrunMinutes > 0
        || day.reservationConflictCount > 0
        || day.openingConflictCount > 0,
      limitedBy: limitedBy
    )
  }

  /// TS の `context.dayEndTimes?.[index] ?? context.dayEndTarget ?? DEFAULT_DAY_END`
  /// (`lib/trip-scenarios.ts:198, 207, 291`)。3 箇所で同じ式が繰り返されるのでここに畳む。
  static func dayEnd(_ context: PlannerContext, _ dayIndex: Int) -> String {
    context.dayEndTimes?[dayIndex] ?? context.dayEndTarget ?? EngineConstants.defaultDayEnd.description
  }

  /// TS `totalPlanBufferMinutes` (`lib/trip-scenarios.ts:193-200`) — 組み上がった計画の余裕の合計。
  /// 余裕はペースに依存しない(ペースは快適さの定員を決めるだけ)ので、TS と同じく `balanced` を
  /// 固定で渡しても返り値は変わらない。
  public static func totalPlanBufferMinutes(plan: BuiltTripPlan, context: PlannerContext) -> Int {
    plan.days.enumerated().reduce(0) { sum, entry in
      sum + dayWindow(entry.element, dayIndex: entry.offset, pace: .balanced, dayEnd: dayEnd(context, entry.offset)).slackMinutes
    }
  }

  /// TS `evaluateCapacity` (`lib/trip-scenarios.ts:202-215`)
  struct CapacityEvaluation {
    var days: [TripFitDay]
    var overloadedDayCount: Int
    var fitsAllKnownStops: Bool
  }

  static func evaluateCapacity(_ plan: BuiltTripPlan, pace: Pace, context: PlannerContext) -> CapacityEvaluation {
    let days = plan.days.enumerated().map { index, day in
      dayWindow(day, dayIndex: index, pace: pace, dayEnd: dayEnd(context, index))
    }
    let overloadedDayCount = days.filter { $0.overrunMinutes > 0 }.count
    return CapacityEvaluation(
      days: days,
      overloadedDayCount: overloadedDayCount,
      fitsAllKnownStops: overloadedDayCount == 0 && plan.scheduleConflictCount == 0
    )
  }

  // MARK: - 見直し候補

  /// TS `suggestedCutCount` (`lib/trip-scenarios.ts:217-225`)。どの「普通」の体験が一番どうでもいいかを
  /// 旅行者に聞かないまま数えられるのは下限だけ。UI は選択肢を出すのであって、黙って消さない。
  static func suggestedCutCount(_ days: [TripFitDay]) -> Int {
    days.reduce(0) { sum, day in
      if day.overrunMinutes <= 0 && day.excessPlaceCount <= 0 { return sum }
      return sum + max(1, day.excessPlaceCount)
    }
  }

  /// TS `cutCandidates` (`lib/trip-scenarios.ts:227-276`)
  static func cutCandidates(_ plan: BuiltTripPlan, fitDays: [TripFitDay]) -> [TripCutCandidate] {
    let overloaded = Set(
      fitDays.filter { $0.overrunMinutes > 0 || $0.excessPlaceCount > 0 }.map(\.dayIndex)
    )
    var candidates: [TripCutCandidate] = []
    var seen: Set<String> = []

    // 旅行者が自分で optional と書き、エンジンが既に計画から外して守った場所が一番損の小さい選択。
    for stop in plan.deferredOptionalStops {
      if seen.contains(stop.id) { continue }
      seen.insert(stop.id)
      candidates.append(TripCutCandidate(
        id: stop.id,
        name: stop.name,
        dayIndex: nil,
        priority: .optional,
        stayMinutes: stop.planningDurationMinutes
      ))
    }

    // TS は `plan.days.indexOf(day)` で添字を採る(:246)。JS の `indexOf` は参照同一性なので実添字に
    // なるが、Swift の `BuiltPlanDay` は値型で `firstIndex(of:)` が「等しい先頭の日」を返しうる。
    // `enumerated()` が TS の意図した添字そのもの。
    for (dayIndex, day) in plan.days.enumerated() {
      if !overloaded.contains(dayIndex) { continue }
      for built in day.stops {
        if built.kind != .place
          || built.priority == .must
          || built.isReservation
          || built.fixedTime != nil
          || seen.contains(built.stop.id) { continue }
        seen.insert(built.stop.id)
        candidates.append(TripCutCandidate(
          id: built.stop.id,
          name: built.stop.name,
          dayIndex: dayIndex,
          priority: built.priority,
          stayMinutes: built.stop.planningDurationMinutes
        ))
      }
    }

    // TS `:270-275` — optional が先、そのあと滞在の長い順。`sort` は安定(ES2019)。
    // TS の比較子 `left.priority === "optional" ? -1 : 1` は 3 値の優先度に対しては非対称
    // (normal と must を渡すとどちらの向きでも 1 を返す)。この配列に must は入らない
    // —— 先送りされた optional は `priority: "optional"` 固定で、日の走査は must を弾く(`:255`)——
    // ので到達しない枝だが、Swift 側は正しい厳密弱順序になるよう `== .optional` で書いてある。
    return Array(
      stableSorted(candidates) { left, right in
        if left.priority != right.priority { return left.priority == .optional }
        return right.stayMinutes < left.stayMinutes
      }.prefix(EngineConstants.cutCandidateLimit)
    )
  }

  // MARK: - 最短日数が前提にしたもの

  /// TS `minimumDaysAssumptions` (`lib/trip-scenarios.ts:278-323`)
  static func minimumDaysAssumptions(_ plan: BuiltTripPlan, context: PlannerContext) -> MinimumDaysAssumptions {
    // TS の `Map` は挿入順を持つが、下の 3 本はいずれも最後に全順序で並べ替えられるので、
    // Swift の辞書順不定はここでは影響しない。
    var stayDurations: [String: Int] = [:]
    var fixedBookings: [MinimumDaysAssumptions.FixedBooking] = []
    var openingStatuses: [MinimumDaysAssumptions.OpeningStatusEntry] = []
    for (dayIndex, day) in plan.days.enumerated() {
      for built in day.stops {
        if built.kind != .place { continue }
        stayDurations[built.stop.id] = built.stop.planningDurationMinutes
        if let fixedTime = built.fixedTime, !fixedTime.isEmpty {
          fixedBookings.append(.init(stopId: built.stop.id, dayIndex: dayIndex, time: fixedTime))
        }
        openingStatuses.append(.init(stopId: built.stop.id, dayIndex: dayIndex, status: built.openingStatus.rawValue))
      }
    }
    for stop in plan.deferredOptionalStops + plan.deferredUnavailableStops {
      stayDurations[stop.id] = stop.planningDurationMinutes
    }
    return MinimumDaysAssumptions(
      dates: plan.days.map(\.date),
      dayWindows: plan.days.enumerated().map { dayIndex, day in
        .init(dayIndex: dayIndex, start: day.requestedStartTime, end: dayEnd(context, dayIndex))
      },
      base: .init(id: plan.selectedBase?.id, name: plan.selectedBase?.name),
      // TS `:305-307` は `localeCompare`。
      stayDurations: stableSorted(stayDurations.map { MinimumDaysAssumptions.StayDuration(stopId: $0.key, minutes: $0.value) }) {
        jsLocaleCompare($0.stopId, $1.stopId) < 0
      },
      lockedModes: stableSorted((context.legModeOverrides ?? [:]).map { MinimumDaysAssumptions.LockedMode(legId: $0.key, mode: $0.value.rawValue) }) {
        jsLocaleCompare($0.legId, $1.legId) < 0
      },
      airportBoundaries: plan.airportConstraints.map {
        .init(direction: $0.direction, airport: $0.airport, flightTime: $0.flightTime, cityTime: $0.cityTime)
      },
      fixedBookings: stableSorted(fixedBookings) { left, right in
        if left.dayIndex != right.dayIndex { return left.dayIndex < right.dayIndex }
        let byTime = jsLocaleCompare(left.time, right.time)
        if byTime != 0 { return byTime < 0 }
        return jsLocaleCompare(left.stopId, right.stopId) < 0
      },
      openingStatuses: stableSorted(openingStatuses) { left, right in
        if left.dayIndex != right.dayIndex { return left.dayIndex < right.dayIndex }
        return jsLocaleCompare(left.stopId, right.stopId) < 0
      },
      transferBufferMinutes: context.transferBufferMinutes ?? EngineConstants.defaultTransferBuffer,
      mobilityPolicy: plan.mobilityPolicy
    )
  }

  // MARK: - 判定

  /// 同じ解決済みウィッシュリストを日数違いで決定的に比べる。ネットワークも AI も呼ばない:
  /// どの場面も `context` に既にあるプロバイダのデータを再利用し、ローカルの制約エンジンだけを回す。
  ///
  /// TS `assessTripFit` (`lib/trip-scenarios.ts:325-429`)。TS の位置引数 `(raw, requestedDays, pace,
  /// locale, context)` は `TripRequest` に畳んである(Task 15 の `TripBuilder.build` と同じ扱い)。
  public static func assessTripFit(
    _ request: TripRequest,
    plan currentPlan: BuiltTripPlan? = nil,
    maxDays: Int = EngineConstants.maxScenarioDays,
    options: TripFitSearchOptions = TripFitSearchOptions()
  ) -> TripFitAssessment {
    let context = request.context
    let pace = request.pace
    // TS `Math.max(1, Math.round(requestedDays))` — Swift の `days` は既に整数なので丸めは恒等。
    let normalizedRequestedDays = max(1, request.days)
    let dayEndAssumption = context.dayEndTarget ?? EngineConstants.defaultDayEnd.description
    let plan = currentPlan ?? TripBuilder.build(
      TripRequest(raw: request.raw, days: normalizedRequestedDays, pace: pace, locale: request.locale, context: context)
    )
    let current = evaluateCapacity(plan, pace: pace, context: context)
    let unresolvedCount = plan.unknownEntries.count
    let unavailableCount = plan.deferredUnavailableStops.count
    let incomplete = unresolvedCount > 0 || unavailableCount > 0
    // ビルダは日指定を実在の停留所 id に対して解決してから除外を適用する。その結果を使い回すと、
    // 消された `Day 3` の停留所が 1 日で足りるウィッシュリストを 3 日に縛り続けることがなくなる。
    let firstAllowedDays = plan.minimumPinnedDay
    let searchLimit = min(EngineConstants.maxScenarioDays, max(normalizedRequestedDays, maxDays))
    let elapsed = stopwatch(options.clock)
    // TS `Math.max(1, Math.floor(timeoutMs ?? 1_000))` — 0 も負も 1ms に切り上がる。
    let budget = Duration.milliseconds(max(1, wholeMilliseconds(options.timeout)))
    var solverTimedOut = false
    var searchedThroughDays = 0
    var minimumDays: Int?
    var minimumPlan: BuiltTripPlan?

    // 最短日数の答えが意味を持つのは、頼まれた場所が全部その比較に参加したときだけ。場所の解決や
    // 営業状況が欠けている間も同じ探索は解決できた部分集合の上で走るが、その答えは
    // `partialMinimumDays` として別枠で返す —— 偽の「2 日で足ります」が確定の判定として出ないように。
    var partialMinimumDays: Int?
    if firstAllowedDays <= searchLimit {
      for days in firstAllowedDays...searchLimit {
        if elapsed() >= budget {
          // 部分探索中のタイムアウトが判定を貼り替えてはいけない。塞いでいるのは未解決の場所のまま。
          if !incomplete { solverTimedOut = true }
          break
        }
        if !incomplete { searchedThroughDays = days }
        let candidatePlan = days == normalizedRequestedDays
          ? plan
          : TripBuilder.build(TripRequest(raw: request.raw, days: days, pace: pace, locale: request.locale, context: context))
        let candidateFit = days == normalizedRequestedDays
          ? current
          : evaluateCapacity(candidatePlan, pace: pace, context: context)
        if candidateFit.fitsAllKnownStops {
          if incomplete {
            partialMinimumDays = days
          } else {
            minimumDays = days
            minimumPlan = candidatePlan
          }
          break
        }
        if elapsed() >= budget {
          if !incomplete {
            solverTimedOut = true
            minimumDays = nil
          }
          break
        }
      }
    }

    let capacityNeedsChange = !current.fitsAllKnownStops
    let tight = !capacityNeedsChange && current.days.contains { day in
      day.placeCount > 0 && day.slackMinutes >= 0 && day.slackMinutes < EngineConstants.tightBufferMinutes
    }
    let status: TripFitStatus = solverTimedOut
      ? .timed_out
      : incomplete
        ? .incomplete
        : capacityNeedsChange ? .needs_change
          : tight ? .tight : .fits

    return TripFitAssessment(
      status: status,
      requestedDays: normalizedRequestedDays,
      minimumDays: minimumDays,
      partialMinimumDays: partialMinimumDays,
      additionalDaysNeeded: minimumDays.map { max(0, $0 - normalizedRequestedDays) },
      // 短い場面は、旅行者が実際に選んだ計画の予約/営業の衝突を直しはしない。別の日数が入るという
      // だけで「全部入ります」の見出しに変えてはいけない。
      spareDays: incomplete || capacityNeedsChange || minimumDays == nil
        ? nil
        : max(0, normalizedRequestedDays - minimumDays!),
      searchedThroughDays: searchedThroughDays,
      dayEndAssumption: dayEndAssumption,
      solverTimedOut: solverTimedOut,
      minimumDaysAssumptions: minimumDaysAssumptions(minimumPlan ?? plan, context: context),
      days: current.days,
      overloadedDayCount: current.overloadedDayCount,
      scheduleConflictCount: plan.scheduleConflictCount,
      deferredOptionalCount: plan.deferredOptionalStops.count,
      unavailableCount: unavailableCount,
      unresolvedCount: unresolvedCount,
      cutCandidates: incomplete || solverTimedOut ? [] : cutCandidates(plan, fitDays: current.days),
      suggestedCutCount: incomplete || solverTimedOut ? 0 : suggestedCutCount(current.days)
    )
  }

  // MARK: - 時計の継ぎ目

  /// TS の `now: () => number` 継ぎ目(`lib/trip-scenarios.ts:86`)の Swift 版。
  ///
  /// `any Clock<Duration>` は存在型なので `clock.now` の `Instant` が消去され、`>=` も
  /// `duration(to:)` も直接は使えない(どちらも `Self` を要求する)。ジェネリック関数へ渡して
  /// 存在型を開き、開いた中で経過時間を測るクロージャを作って返す。
  static func stopwatch(_ clock: any Clock<Duration>) -> () -> Duration {
    func open<C: Clock>(_ clock: C) -> () -> Duration where C.Duration == Duration {
      let start = clock.now
      return { start.duration(to: clock.now) }
    }
    return open(clock)
  }

  /// TS `Math.floor(timeoutMs)` — ミリ秒未満は切り捨て。負値は TS の `Math.floor` と同じく
  /// 0 から遠いほうへ落ちるが、直後の `max(1, …)` が拾うので呼び出し側からは見えない。
  static func wholeMilliseconds(_ duration: Duration) -> Int {
    let (seconds, attoseconds) = duration.components
    return Int(seconds * 1_000 + attoseconds / 1_000_000_000_000_000)
  }
}
