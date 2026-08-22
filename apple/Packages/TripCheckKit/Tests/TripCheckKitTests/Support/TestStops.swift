import Foundation
@testable import TripCheckKit

/// Task 7 が作る共有テストフィクスチャ。後続タスクは自分の Step 1 で必要なヘルパーを
/// このファイルに追加していく(型リファレンス §「TestStops のヘルパー」参照)。
enum TestStops {
  /// 東京駅付近の小さな円周上に等間隔の `count` 点を置き、円周順(=幾何学的に隣接した順)ではない
  /// 決定的な順序(先頭/末尾を交互に取るジグザグ)で返す。Held-Karp / 2-opt が入力順に依存せず
  /// 最短経路を見つけることを確認するためのフィクスチャ。id は `ring-0`, `ring-1`, … (円周上の
  /// 角度順の番号。配列の並び順とは一致しない)。
  static func ring(count: Int) -> [RouteStop] {
    precondition(count > 0)
    let centerLat = 35.681236 // 東京駅
    let centerLng = 139.767125
    let radiusDegrees = 0.02 // およそ 2km 圏

    let sequential: [RouteStop] = (0..<count).map { index in
      let angle = 2 * Double.pi * Double(index) / Double(count)
      let lat = centerLat + radiusDegrees * sin(angle)
      let lng = centerLng + radiusDegrees * cos(angle)
      return point(id: "ring-\(index)", lat: lat, lng: lng)
    }

    var shuffled: [RouteStop] = []
    shuffled.reserveCapacity(count)
    var low = 0
    var high = count - 1
    var takeLow = true
    while low <= high {
      if takeLow {
        shuffled.append(sequential[low])
        low += 1
      } else {
        shuffled.append(sequential[high])
        high -= 1
      }
      takeLow.toggle()
    }
    return shuffled
  }

  /// 東京駅の緯度に沿って `ids` の順に西→東へ約 1km 間隔で点を置く。日内順序のテストは
  /// 「どの並びが幾何学的に近いか」を手計算できる必要があるので、円ではなく直線を使う。
  ///
  /// `areas` を渡すと同じ添字の停留所にその地区名が入る(足りない分は空文字のまま)。`theme` は
  /// 訪問順のエリアから作られる(`lib/trip-builder.ts:1664`)ので、その順を手で決められる必要がある。
  static func line(ids: [String], stayMinutes: Int = 90, areas: [String] = []) -> [RouteStop] {
    let latitude = 35.681236 // 東京駅
    // `straightLineDistanceKm` と同じ地球半径 6371km 換算で、この緯度の経度 1 度 ≒ 90.3km。
    let stepDegrees = 1 / (6371 * (Double.pi / 180) * cos(latitude * Double.pi / 180))
    return ids.enumerated().map { index, id in
      point(
        id: id,
        lat: latitude,
        lng: 139.767125 + Double(index) * stepDegrees,
        stayMinutes: stayMinutes,
        area: index < areas.count ? areas[index] : ""
      )
    }
  }

  /// 東京駅周辺 4 点 + 吉祥寺周辺 4 点(約 17km 離れた 2 群)を、群ごとにまとまっていない
  /// 交互順で返す。`Clustering.clusterStops` が入力順ではなく地理で日をまとめること、そして
  /// 種が最西端(= 吉祥寺側)から始まることを確かめるためのフィクスチャ。
  /// 経度は 8 点すべて異なるので「最西端」は一意に決まる。
  static func twoClusters() -> [RouteStop] {
    let tokyo = (latitude: 35.681236, longitude: 139.767125)      // 東京駅
    let kichijoji = (latitude: 35.703043, longitude: 139.579703)  // 吉祥寺駅
    // 群の広がりは半径 500m 程度。群間(約 17km)より 1 桁以上小さいので、どの点も自分の群の
    // 種のほうが近い。
    let offsets: [(latitude: Double, longitude: Double)] = [(0, 0), (0.004, 0.003), (-0.003, 0.005), (0.002, -0.004)]
    return (0..<4).flatMap { index -> [RouteStop] in
      [
        point(
          id: "tokyo-\(index)",
          lat: tokyo.latitude + offsets[index].latitude,
          lng: tokyo.longitude + offsets[index].longitude,
          area: "Tokyo Station"
        ),
        point(
          id: "kichijoji-\(index)",
          lat: kichijoji.latitude + offsets[index].latitude,
          lng: kichijoji.longitude + offsets[index].longitude,
          area: "Kichijoji"
        ),
      ]
    }
  }

  /// 日本の食事窓(昼 11:00-14:30 / 夜 17:30-21:00)。食事停留所のドリフトを見るテスト用。
  static let japanMeals = Destinations.byId(.japan).meals

  /// Task 13/14 の共有ヘルパー。`DayClock.buildDay` を「日本・ホテルなし・空港制約なし・09:00 開始」の
  /// 既定で呼ぶ薄いラッパ。日割り探索は同じ日を何百回も組み直すので、テスト側の呼び出しを 1 行に保つ。
  ///
  /// `deadline` は**門限**(`dayEndTarget`)として渡す。出発便の締切は `index == dayCount - 1` の日に
  /// しか効かない(`lib/trip-builder.ts:1526`)ので、任意の添字の日に締切を置けるのは門限のほうだけ。
  /// Task 14 の食事枠が読むのは `day.deadline` の文字列と `deadlinePreviousDay` だけで
  /// (`lib/trip-builder.ts:481, 488`)、`deadlineKind` は見ないため、この選択は
  /// `dinnerSlotDisappearsWhenDeadlineIsBeforeDinnerStart` を表現するのに十分。
  static func buildPlainDay(_ cluster: [RouteStop], index: Int, deadline: String? = nil) -> BuiltPlanDay {
    DayClock.buildDay(
      stops: cluster,
      index: index,
      dayCount: index + 1,
      locale: .ja,
      startBase: nil,
      endBase: nil,
      airportConstraints: [],
      constraints: [:],
      earlyVisitStopIds: [],
      foodStopIds: [],
      openingWindows: [:],
      destination: Destinations.byId(.japan),
      requestedStart: nil,
      startDate: nil,
      travel: .default,
      dayEndTarget: deadline,
      lockedOrder: []
    )
  }

  // MARK: - Task 15(`TripBuilder.build` の入口)

  /// スイスのサンプル旅程まるごと 1 件のリクエスト。生テキストは
  /// `Destinations.byId(.switzerland).sample`(`lib/destinations.ts` のサンプル 8 行)、
  /// 解決済み停留所は `SwissSample.resolvedStops(locale:)`(id は `sample-0`…`sample-7`、
  /// `inputIndex` は 0…7)、行き先は明示 `switzerland`。
  ///
  /// `extraUnresolvedLines` はサンプルの後ろに足す「解決できない行」で、`unknownEntries` を
  /// 観測したいテストが使う。
  static func swissRequest(
    days: Int,
    startDate: String? = nil,
    locale: PlannerLocale = .en,
    pace: Pace = .balanced,
    extraUnresolvedLines: [String] = []
  ) -> TripRequest {
    let sample = Destinations.byId(.switzerland).sample?[locale] ?? ""
    var context = PlannerContext()
    context.destination = .destination(.switzerland)
    context.resolvedStops = SwissSample.resolvedStops(locale: locale)
    context.tripStartDate = startDate
    let raw = ([sample] + extraUnresolvedLines).joined(separator: "\n")
    return TripRequest(raw: raw, days: days, pace: pace, locale: locale, context: context)
  }

  /// 東京の実在座標に紐づく解決済み停留所。名前がそのまま `input` になるので、生テキストの
  /// 各行と 1 対 1 で対応する(`inputIndex` は 0 起点で配列順)。
  static func tokyoResolved(_ names: [String]) -> [ResolvedStop] {
    let known: [String: (Double, Double)] = [
      "Ueno Park": (35.7148, 139.7737),
      "Senso-ji": (35.7148, 139.7967),
      "Tokyo Skytree": (35.7101, 139.8107),
      "Shibuya Sky": (35.6580, 139.7016),
      "Meiji Jingu": (35.6764, 139.6993),
      "Akihabara": (35.6984, 139.7731),
    ]
    return names.enumerated().map { index, name in
      let point = known[name] ?? (35.681236, 139.767125)
      return ResolvedStop(
        id: "tokyo-\(index)-\(name.lowercased().replacingOccurrences(of: " ", with: "-"))",
        name: name,
        area: "Tokyo",
        latitude: point.0,
        longitude: point.1,
        sourceUrl: "https://example.com/\(index)",
        verifiedAt: "2026-08-09T00:00:00Z",
        confidence: .medium,
        planningDurationMinutes: 60,
        isAnchor: false,
        input: name,
        inputIndex: index,
        address: "\(name), Tokyo",
        countryCode: "JP"
      )
    }
  }

  /// 国コードだけを指定した解決済み停留所の列。`DestinationVote` の投票規則を測るための
  /// フィクスチャなので、座標はその国コードの箱の中(= 座標フォールバックでも同じ答え)に置く。
  static func mixed(_ countryCodes: [String]) -> [ResolvedStop] {
    let centers: [String: (Double, Double)] = [
      "JP": (35.681236, 139.767125),   // 東京駅
      "CH": (46.9480, 7.4474),         // ベルン
      "FR": (48.8566, 2.3522),         // パリ
      "XX": (-9.0, -60.0),             // どの国の箱にも入らない座標(ブラジル奥地)
    ]
    return countryCodes.enumerated().map { index, code in
      let center = centers[code] ?? (0, 0)
      // 同じ国を 2 件以上置いても座標が重ならないよう、わずかにずらす。
      let name = "\(code) place \(index)"
      return ResolvedStop(
        id: "vote-\(index)",
        name: name,
        area: code,
        latitude: center.0 + Double(index) * 0.01,
        longitude: center.1 + Double(index) * 0.01,
        sourceUrl: "https://example.com/vote-\(index)",
        verifiedAt: "2026-08-09T00:00:00Z",
        confidence: .medium,
        planningDurationMinutes: 60,
        isAnchor: false,
        input: name,
        inputIndex: index,
        address: name,
        countryCode: code == "XX" ? "XX" : code
      )
    }
  }

  /// 文脈の解決済み停留所から生テキストを組み立てる(1 行 1 件、`input` そのまま)。
  static func rawFor(_ context: PlannerContext) -> String {
    (context.resolvedStops ?? []).map(\.input).joined(separator: "\n")
  }

  /// `ring(count:)` をそのまま解決済み停留所として渡すリクエスト。件数と日数だけを動かして
  /// ビルダの上限まわりを測るためのもの。
  static func ringRequest(
    count: Int,
    days: Int,
    pace: Pace = .balanced,
    stayMinutes: Int = 90
  ) -> TripRequest {
    let stops = ring(count: count).map { stop -> RouteStop in
      var copy = stop
      copy.planningDurationMinutes = stayMinutes
      return copy
    }
    let resolved = stops.enumerated().map { index, stop in
      ResolvedStop(routeStop: stop, input: stop.name, inputIndex: index, address: stop.name, countryCode: "JP")
    }
    var context = PlannerContext()
    context.resolvedStops = resolved
    return TripRequest(
      raw: resolved.map(\.input).joined(separator: "\n"),
      days: days,
      pace: pace,
      locale: .en,
      context: context
    )
  }

  static func point(
    id: String,
    lat: Double,
    lng: Double,
    stayMinutes: Int = 90,
    area: String = "",
    isAnchor: Bool = false
  ) -> RouteStop {
    RouteStop(
      id: id,
      name: id,
      area: area,
      latitude: lat,
      longitude: lng,
      sourceUrl: "",
      verifiedAt: "",
      confidence: .medium,
      planningDurationMinutes: stayMinutes,
      isAnchor: isAnchor
    )
  }
}

// MARK: - Task 16(実現可能性の判定)

extension TestStops {
  /// TS のテストが `buildTripFromWishlist(raw, days, "balanced", "en", context)` を直に呼ぶところの
  /// Swift 版。東京の 3 件はカタログ(`Geo/Catalog.swift`)が解決するので `resolvedStops` は渡さない。
  static func tokyoRequest(
    _ raw: String,
    days: Int,
    context: PlannerContext = PlannerContext(),
    pace: Pace = .balanced,
    locale: PlannerLocale = .en
  ) -> TripRequest {
    TripRequest(raw: raw, days: days, pace: pace, locale: locale, context: context)
  }

  /// **Task 17 が来るまでの仮置き**。`TripScenarios.assessTripFit`(`lib/trip-scenarios.ts:325`)は
  /// まだ無いので、`Feasibility.derive` が読む 5 フィールド — `days`(最小余裕 = LOW_BUFFER の材料)、
  /// `minimumDays`、`partialMinimumDays`、`searchedThroughDays`、`minimumDaysAssumptions` — だけを
  /// 組み立てた `TripFitAssessment` を返す。日ごとの数値は素朴な「窓 − 予定」であって
  /// Task 17 の `evaluateCapacity`(`:202`)ではない。**Task 17 が本物に差し替えること。**
  static func fitStub(for plan: BuiltTripPlan, requestedDays: Int, slackMinutes: Int? = nil) -> TripFitAssessment {
    let capacity = EngineConstants.paceStopsPerDay[.balanced] ?? 4
    let days = plan.days.enumerated().map { dayIndex, day -> TripFitDay in
      let start = ClockTime(day.startTime)?.minutes ?? EngineConstants.defaultDayStart.minutes
      let usableUntil = day.deadline ?? EngineConstants.defaultDayEnd.description
      let end = ClockTime(usableUntil)?.minutes ?? EngineConstants.defaultDayEnd.minutes
      let available = max(0, end - start)
      let placeCount = day.stops.filter { $0.kind == .place }.count
      return TripFitDay(
        dayIndex: dayIndex,
        label: day.label,
        startTime: day.startTime,
        usableUntil: usableUntil,
        availableMinutes: available,
        plannedMinutes: day.totalMinutes,
        slackMinutes: slackMinutes ?? (available - day.totalMinutes),
        overrunMinutes: day.deadlineOverrunMinutes,
        placeCount: placeCount,
        placeCapacity: capacity,
        excessPlaceCount: max(0, placeCount - capacity),
        hasScheduleConflict: day.reservationConflictCount + day.openingConflictCount > 0,
        limitedBy: day.deadlineKind == .airport ? .airport : .curfew
      )
    }
    return TripFitAssessment(
      status: .fits,
      requestedDays: requestedDays,
      minimumDays: requestedDays,
      partialMinimumDays: nil,
      additionalDaysNeeded: 0,
      spareDays: 0,
      searchedThroughDays: requestedDays,
      dayEndAssumption: EngineConstants.defaultDayEnd.description,
      solverTimedOut: false,
      minimumDaysAssumptions: MinimumDaysAssumptions(
        dates: plan.days.map(\.date),
        dayWindows: days.map { .init(dayIndex: $0.dayIndex, start: $0.startTime, end: $0.usableUntil) },
        base: .init(id: plan.selectedBase?.id, name: plan.selectedBase?.name),
        stayDurations: [],
        lockedModes: [],
        airportBoundaries: plan.airportConstraints.map {
          .init(direction: $0.direction, airport: $0.airport, flightTime: $0.flightTime, cityTime: $0.cityTime)
        },
        fixedBookings: [],
        openingStatuses: [],
        transferBufferMinutes: EngineConstants.defaultTransferBuffer,
        mobilityPolicy: plan.mobilityPolicy
      ),
      days: days,
      overloadedDayCount: days.filter { $0.excessPlaceCount > 0 }.count,
      scheduleConflictCount: plan.scheduleConflictCount,
      deferredOptionalCount: plan.deferredOptionalStops.count,
      unavailableCount: plan.deferredUnavailableStops.count,
      unresolvedCount: plan.unknownEntries.count,
      cutCandidates: [],
      suggestedCutCount: 0
    )
  }

  /// 浅草寺を「Day 1」に固定したうえで、その日の営業窓を空にした 1 日旅程。
  /// `tests/feasibility-result.test.ts:236-249`(週次パターンだけでは hard にならない例)と同じ
  /// 組み合わせに、旅行開始日 `2026-10-13` を足したもの(日付特定の証拠を当てられるように)。
  static func tokyoClosedOnFixedDay() -> (plan: BuiltTripPlan, fit: TripFitAssessment) {
    var context = PlannerContext()
    context.tripStartDate = "2026-10-13"
    context.openingWindowsByDay = ["sensoji": [0: []]]
    let request = tokyoRequest("Senso-ji — Day 1", days: 1, context: context)
    let plan = TripBuilder.build(request)
    return (plan, fitStub(for: plan, requestedDays: 1))
  }

  /// 衝突の無い 1 日旅程 + 余裕 30 分の仮 fit。注意(attention)の排他順を見るためのもの。
  static func tokyoLowBuffer() -> (plan: BuiltTripPlan, fit: TripFitAssessment) {
    var context = PlannerContext()
    context.tripStartDate = "2026-10-13"
    let request = tokyoRequest("Senso-ji\nTokyo Skytree", days: 1, context: context)
    let plan = TripBuilder.build(request)
    return (plan, fitStub(for: plan, requestedDays: 1, slackMinutes: 30))
  }
}

// MARK: - Task 17(場面比較)

extension TestStops {
  /// 1 日に 6 件を詰め込んだ東京の旅程。うち `Ghibli Museum` が must、`Shibuya Sky` が 10:00 の
  /// 予約(= 固定時刻)、`Tsukiji Outer Market` が optional。`cutCandidates`
  /// (`lib/trip-scenarios.ts:227-277`)が must と予約・固定時刻を外し、optional を先頭に置くことを
  /// 見るためのもの。カタログが 6 件すべてを解決するので `resolvedStops` は渡さない。
  static func overloadedDay() -> (request: TripRequest, plan: BuiltTripPlan) {
    let raw = """
    Ghibli Museum — must
    Shibuya Sky — 10:00 booked
    Senso-ji
    Tokyo Skytree
    teamLab Planets
    Tsukiji Outer Market — optional
    """
    var context = PlannerContext()
    // 09:00–16:00 の窓。6 件は時計に入らない —— `assessTripFit` を過負荷の側で測るための条件で、
    // TS の "the three-option shortlist retains a complete one-change repair" が
    // `dayEndTarget: "18:00"` でやっているのと同じ作り方(`tests/trip-scenarios.test.ts`)。
    context.dayEndTarget = "16:00"
    let request = tokyoRequest(raw, days: 1, context: context)
    return (request, TripBuilder.build(request))
  }

  /// TS `provisionalBaseAsResolved`(`lib/planner-app-state.ts:597-603`)を推薦拠点に当てる薄い包み。
  static func asResolved(_ base: TripBase?) -> ResolvedStop? {
    base.map(ProvisionalTripLength.provisionalBaseAsResolved)
  }
}
