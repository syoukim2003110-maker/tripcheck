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
  /// 解決済み停留所は `SwissSample.resolvedStops(locale:)`(id は `sample-switzerland-0`…`-7`、
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

  /// 浅草寺を「Day 1」に固定したうえで、その日の営業窓を空にした 1 日旅程。
  /// `tests/feasibility-result.test.ts:236-249`(週次パターンだけでは hard にならない例)と同じ
  /// 組み合わせに、旅行開始日 `2026-10-13` を足したもの(日付特定の証拠を当てられるように)。
  static func tokyoClosedOnFixedDay() -> (plan: BuiltTripPlan, fit: TripFitAssessment) {
    var context = PlannerContext()
    context.tripStartDate = "2026-10-13"
    context.openingWindowsByDay = ["sensoji": [0: []]]
    let request = tokyoRequest("Senso-ji — Day 1", days: 1, context: context)
    let plan = TripBuilder.build(request)
    return (plan, TripScenarios.assessTripFit(request, plan: plan))
  }

  /// 衝突の無い 1 日旅程。注意(attention)の排他順を見るためのもの —— 営業時間が未取得なので
  /// 梯子の上のほうにいる UNVERIFIED_FACTS が必ず先に立つ。
  static func tokyoLowBuffer() -> (plan: BuiltTripPlan, fit: TripFitAssessment) {
    var context = PlannerContext()
    context.tripStartDate = "2026-10-13"
    let request = tokyoRequest("Senso-ji\nTokyo Skytree", days: 1, context: context)
    let plan = TripBuilder.build(request)
    return (plan, TripScenarios.assessTripFit(request, plan: plan))
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

// MARK: - Task 20(編集ガード・Undo 台帳)

/*
 * 編集ガードのフィクスチャ。名前のついたものは**実際に `TripBuilder.build` を 2 回通した**前後の
 * 計画を返す(TS のテストが `buildTripFromWishlist` を 2 回呼ぶのと同じ)。締切だけを動かす TS の
 * 4 本(`tests/planner-guarded-edits.test.ts:241-297`)は TS 自身が計画リテラルを組んでいる ——
 * 「門限がちょうど 90 分良くなり空港がちょうど 30 分悪くなる 2 日計画は、数を探すのではなく述べる
 * 必要がある」(TS :195-206)—— ので `deadlinePlan` も併せて置く。
 *
 * 実ビルドの滞在時間はすべて `durationOverrides` で与えてある。数字は逆算した値で、下のコメントに
 * その日の時計を書いてある(9:00 開始・停留所間 35 分・門限 17:00・空港締切 15:30)。
 */
extension TestStops {
  /// 東京 2 件の 1 日旅程で滞在時間だけを動かす。衝突は生まれないので `.apply` になり、
  /// 余裕は伸ばした分だけちょうど減る(`from` → `to` が +30 分なら差は −30)。
  static func stayEdit(from: Int, to: Int) -> (before: BuiltTripPlan, after: BuiltTripPlan, context: PlannerContext) {
    let raw = "Senso-ji\nTokyo Skytree"
    var context = PlannerContext()
    context.durationOverrides = ["sensoji": from]
    var candidate = context
    candidate.durationOverrides = ["sensoji": to]
    return (
      TripBuilder.build(tokyoRequest(raw, days: 1, context: context)),
      TripBuilder.build(tokyoRequest(raw, days: 1, context: candidate)),
      context
    )
  }

  /// `tests/planner-guarded-edits.test.ts:16-44` そのまま。貼られた順が利用者の制約なので、
  /// 最適化は長くなった滞在を避けて予約を守ることができない。`stayMinutes: 360` で
  /// teamLab Planets の 13:00 予約に 170 分遅れる。`100` なら誰も遅れない。
  static func bookingLateEdit(stayMinutes: Int = 360) -> (before: BuiltTripPlan, after: BuiltTripPlan, context: PlannerContext) {
    let raw = "Senso-ji\nteamLab Planets — Day 1 13:00 booked"
    var context = PlannerContext()
    context.lockedOrderByDay = IntKeyedDictionary([0: ["sensoji", "teamlab-planets"]])
    var candidate = context
    candidate.durationOverrides = ["sensoji": stayMinutes]
    return (
      TripBuilder.build(tokyoRequest(raw, days: 1, context: context)),
      TripBuilder.build(tokyoRequest(raw, days: 1, context: candidate)),
      context
    )
  }

  /// 2 日旅程(1 日目は門限 17:00、2 日目は 18:00 発の便で空港締切 15:30)。
  /// 前:1 日目 18:30 終了 = 門限 +90 分、2 日目 13:35 終了 = 締切内。
  /// 後:1 日目 17:00 ちょうど(門限 −90 分の改善)、2 日目 16:00 = 空港締切 +30 分。
  /// 合計では 60 分の改善だが、飛行機は算術平均を待たない。
  static func airportWorseCurfewBetter() -> (before: BuiltTripPlan, after: BuiltTripPlan, context: PlannerContext) {
    let context = guardedDeadlineContext(["sensoji": 270, "tokyo-skytree": 265, "ueno-park": 120, "akihabara": 120])
    let candidate = guardedDeadlineContext(["sensoji": 180, "tokyo-skytree": 265, "ueno-park": 120, "akihabara": 265])
    return (
      TripBuilder.build(tokyoRequest(guardedTwoDayRaw, days: 2, context: context)),
      TripBuilder.build(tokyoRequest(guardedTwoDayRaw, days: 2, context: candidate)),
      context
    )
  }

  /// 3 日旅程。前:[門限 0、門限 +120、空港 0]、後:[門限 +20、門限 0、空港 +15]。
  /// 真ん中の日が 120 分良くなっても、1 日目と便の悪化は残る。
  static func dayOneWorseDayTwoBetter() -> (before: BuiltTripPlan, after: BuiltTripPlan, context: PlannerContext) {
    let context = guardedDeadlineContext([
      "sensoji": 220, "tokyo-skytree": 225, "ueno-park": 285, "akihabara": 280, "meiji-jingu": 175, "shibuya-sky": 180,
    ])
    let candidate = guardedDeadlineContext([
      "sensoji": 240, "tokyo-skytree": 225, "ueno-park": 165, "akihabara": 280, "meiji-jingu": 190, "shibuya-sky": 180,
    ])
    return (
      TripBuilder.build(tokyoRequest(guardedThreeDayRaw, days: 3, context: context)),
      TripBuilder.build(tokyoRequest(guardedThreeDayRaw, days: 3, context: candidate)),
      context
    )
  }

  /// `tests/planner-guarded-edits.test.ts:329-338`。営業時間の証拠が一切ない 2 件で、
  /// 1 日目の開始を 09:00 から 11:00 へ動かす。`unknown` は `unknown` のまま。
  static func dayStartPastUnknownHours() -> (before: BuiltTripPlan, after: BuiltTripPlan, context: PlannerContext) {
    var context = PlannerContext()
    context.defaultDayStart = "09:00"
    var candidate = PlannerContext()
    candidate.defaultDayStart = "11:00"
    return (
      TripBuilder.build(tokyoRequest(guardedOpeningRaw, days: 1, context: context)),
      TripBuilder.build(tokyoRequest(guardedOpeningRaw, days: 1, context: candidate)),
      context
    )
  }

  /// `tests/planner-guarded-edits.test.ts:340-352`。浅草寺の窓は 09:00–11:00 だけで、
  /// **両側とも** 11:00 開始 —— 既に破れている約束は、無関係な編集のたびに言い直さない。
  static func sameViolationBothSides() -> (before: BuiltTripPlan, after: BuiltTripPlan, context: PlannerContext) {
    var context = PlannerContext()
    context.openingWindowsByDay = guardedMorningOnly
    context.defaultDayStart = "11:00"
    var candidate = context
    candidate.durationOverrides = ["teamlab-planets": 100]
    return (
      TripBuilder.build(tokyoRequest(guardedOpeningRaw, days: 1, context: context)),
      TripBuilder.build(tokyoRequest(guardedOpeningRaw, days: 1, context: candidate)),
      context
    )
  }

  /// `tests/planner-guarded-edits.test.ts:305-327`。同じ 2 件に検証済みの窓(09:00–11:00)を
  /// 与えたうえで開始を 11:00 に動かすと、浅草寺は営業時間の外に出る。
  static func dayStartPastVerifiedClosing() -> (before: BuiltTripPlan, after: BuiltTripPlan, context: PlannerContext) {
    var context = PlannerContext()
    context.openingWindowsByDay = guardedMorningOnly
    context.defaultDayStart = "09:00"
    var candidate = context
    candidate.defaultDayStart = "11:00"
    return (
      TripBuilder.build(tokyoRequest(guardedOpeningRaw, days: 1, context: context)),
      TripBuilder.build(tokyoRequest(guardedOpeningRaw, days: 1, context: candidate)),
      context
    )
  }

  /// 最終入場を動かす編集。`openingStatus` が `last_entry_conflict` に変わることで
  /// `last_entry:{stopId}` の事実が新しく現れる。締切は日の開始(09:00)より前に置く ——
  /// 10:00 だと日内順序が「締切の早い停留所を先に」で本当に回避してしまい(`DayOrdering.swift:234`)、
  /// 測りたい遷移が起きない。
  static func lastEntryMissedEdit() -> (before: BuiltTripPlan, after: BuiltTripPlan, context: PlannerContext) {
    let raw = "Senso-ji\nTokyo Skytree"
    var context = PlannerContext()
    context.lastEntryTimes = ["tokyo-skytree": "18:00"]
    var candidate = context
    candidate.lastEntryTimes = ["tokyo-skytree": "08:00"]
    return (
      TripBuilder.build(tokyoRequest(raw, days: 1, context: context)),
      TripBuilder.build(tokyoRequest(raw, days: 1, context: candidate)),
      context
    )
  }

  /// must の停留所が候補計画から消える編集(除外は `excludedStopIds`)。
  static func mustStopDropped() -> (before: BuiltTripPlan, after: BuiltTripPlan, context: PlannerContext) {
    let raw = "Senso-ji — must\nTokyo Skytree"
    let context = PlannerContext()
    var candidate = context
    candidate.excludedStopIds = ["sensoji"]
    return (
      TripBuilder.build(tokyoRequest(raw, days: 1, context: context)),
      TripBuilder.build(tokyoRequest(raw, days: 1, context: candidate)),
      context
    )
  }

  /// 履歴の拠点差し替えテスト用の解決済み拠点(東京駅前のホテル 1 件)。
  static func resolvedBase() -> ResolvedStop {
    ResolvedStop(
      id: "hotel-tokyo-station",
      providerRef: "provider-tokyo-station",
      name: "Tokyo Station Hotel",
      area: "Marunouchi",
      latitude: 35.6812,
      longitude: 139.7671,
      sourceUrl: "https://example.com/hotel",
      verifiedAt: "2026-08-09T00:00:00Z",
      confidence: .medium,
      planningDurationMinutes: 0,
      isAnchor: false,
      input: "Tokyo Station Hotel",
      address: "1-9-1 Marunouchi, Tokyo"
    )
  }

  /// 日ごとの停留所 id だけを述べた計画。`hotelPlanSignature` は id の集合しか読まないので、
  /// 大文字混じりや空の日といった並べ替えの端を、実ビルドでは作れない形で直接置ける。
  static func planWithStopIds(_ dayStopIds: [[String]]) -> BuiltTripPlan {
    var plan = deadlinePlan(dayStopIds.map { _ in (kind: DeadlineKind?.none, overrun: 0) })
    for (index, ids) in dayStopIds.enumerated() {
      plan.days[index].stops = ids.map { id in
        BuiltPlanStop(
          stop: point(id: id, lat: 35.681236, lng: 139.767125),
          arrival: "09:00",
          departure: "10:00",
          kind: .place,
          priority: .normal,
          isReservation: false,
          reservationLateMinutes: 0,
          openingStatus: .unknown
        )
      }
    }
    return plan
  }

  /// TS `deadlinePlan`(`tests/planner-guarded-edits.test.ts:208-239`)。締切だけを述べた計画。
  /// `plannerHardEditConflicts` はこれらの欄に対する純粋な比較なので、これが検出器の見る入力の全部。
  static func deadlinePlan(_ days: [(kind: DeadlineKind?, overrun: Int)]) -> BuiltTripPlan {
    BuiltTripPlan(
      inputMode: .wishlist,
      destination: .japan,
      requestedDays: days.count,
      recognizedStopCount: 0,
      scheduledStopCount: 0,
      mealBreakCount: 0,
      unknownEntries: [],
      deferredOptionalStops: [],
      deferredUnavailableStops: [],
      constraintCount: 0,
      minimumPinnedDay: 0,
      overCapacityCount: 0,
      scheduleConflictCount: 0,
      hotelQuery: "",
      hotelResolved: false,
      travelPreference: .auto,
      mobilityPolicy: MobilityPolicy(
        maxWalkingMinutesPerLeg: 20,
        maxTransfersPerLeg: 2,
        walkingLimitWasProvided: false,
        transferLimitWasProvided: false
      ),
      baseRecommendations: [],
      airportConstraints: [],
      foodRecommendationSlots: [],
      days: days.enumerated().map { index, day in
        BuiltPlanDay(
          label: "Day \(index + 1)",
          theme: "",
          stops: [],
          legs: [],
          totalMinutes: 0,
          startTime: "09:00",
          requestedStartTime: "09:00",
          startAdjustedByArrival: false,
          finishTime: "18:00",
          deadline: "20:00",
          deadlineKind: day.kind,
          deadlineOverrunMinutes: day.overrun,
          reservationConflictCount: 0,
          openingConflictCount: 0
        )
      }
    )
  }
}

/// 浅草寺だけ午前中(09:00–11:00)しか開いていない 1 日目。
private let guardedMorningOnly: [String: IntKeyedDictionary<[VisitWindow]>] = [
  "sensoji": IntKeyedDictionary([0: [VisitWindow(openMinutes: 9 * 60, closeMinutes: 11 * 60)]]),
]

private let guardedOpeningRaw = "Senso-ji\nteamLab Planets"

private let guardedTwoDayRaw = """
Senso-ji — Day 1
Tokyo Skytree — Day 1
Ueno Park — Day 2
Akihabara — Day 2
"""

private let guardedThreeDayRaw = """
Senso-ji — Day 1
Tokyo Skytree — Day 1
Ueno Park — Day 2
Akihabara — Day 2
Meiji Jingu — Day 3
Shibuya Sky — Day 3
"""

// MARK: - Task 21(場所解決のパイプライン)

extension TestStops {
  /// 名前だけを述べた解決済み停留所。座標は東京駅で、id・名前・`input` は同じ文字列
  /// (順位や混在国の判定はどれも名前と国コードしか読まないので、これで足りる)。
  static func resolved(
    _ name: String,
    countryCode: String? = nil,
    placeTypes: [String]? = nil
  ) -> ResolvedStop {
    ResolvedStop(
      id: name,
      name: name,
      area: "",
      latitude: 35.681236,
      longitude: 139.767125,
      sourceUrl: "",
      verifiedAt: "",
      confidence: .medium,
      planningDurationMinutes: 60,
      isAnchor: false,
      placeTypes: placeTypes,
      input: name,
      address: "",
      countryCode: countryCode
    )
  }

  /// 解決器が返す候補 1 件。`isTouristic` は `PlaceCandidate` の既定(カテゴリ・`placeTypes`・
  /// 名前のどれも非観光でないこと)に任せる —— 自動採用の規則そのものを測るテストが、その規則の
  /// 答えを手で書いてしまわないように。
  static func candidate(
    name: String,
    category: String? = nil,
    countryCode: String? = nil,
    placeTypes: [String]? = nil
  ) -> PlaceCandidate {
    PlaceCandidate(stop: resolved(name, countryCode: countryCode, placeTypes: placeTypes), category: category)
  }
}

// MARK: - Task 22(gap 検出と Filler 上限)

extension TestStops {
  /// `minutes.count + 1` 件の停留所を東西に並べ、隣接する停留所の間に `minutes[i]` 分ちょうどの
  /// BETWEEN_ANCHORS ギャップができる 1 日を組む。開始前(BEFORE_FIRST_ANCHOR)とホテル復路
  /// (BEFORE_HOTEL_RETURN)のギャップは、`startBase`/`endBase` を持たせず・先頭停留所に制約を
  /// 置かないことでどちらもゼロに畳んである —— `GapDetection.detectForFixture(day:dayIndex:)` が
  /// `day.finishTime` を窓の終わりとして読むので、最後の停留所の出発がそのまま日の終わりになり、
  /// 復路の余りが生まれない。返る唯一の非ゼロなギャップは狙った BETWEEN_ANCHORS だけ。
  ///
  /// `DayClock.buildDay` の区間移動分はジオメトリだけで決まり(`WishlistStopConstraint` の影響を
  /// 受けない)、`GapDetection` が読む「最早到着」も同じ区間移動分から組み立て直される。だから
  /// 「制約なしで一度組んだときの自然な到着」に `minutes[i]` を足した時刻を次の停留所の
  /// `fixedTimeMinutes` に立てるだけで、その差(= GapDetection が数えるギャップ幅)が狙った値に
  /// ぴったり揃う。後続の停留所ほど前の停留所の(遅らせた)実際の出発に依存するので、1 本ずつ
  /// 「今までの制約で組み直して自然な到着を読み、次の制約を立てる」を繰り返す。
  static func dayWithGaps(minutes: [Int]) -> BuiltPlanDay {
    precondition(!minutes.isEmpty)
    let ids = (0...minutes.count).map { "gap-\($0)" }
    let stops = TestStops.line(ids: ids, stayMinutes: 30)
    var constraints: [String: WishlistStopConstraint] = [:]
    for (index, gapMinutes) in minutes.enumerated() {
      let probe = gapDetectionDay(stops: stops, constraints: constraints)
      let naturalArrival = ClockTime(probe.stops[index + 1].arrival)!.minutes
      constraints[ids[index + 1]] = WishlistStopConstraint(
        priority: .normal,
        fixedTimeMinutes: naturalArrival + gapMinutes,
        isReservation: false
      )
    }
    return gapDetectionDay(stops: stops, constraints: constraints)
  }

  /// `dayWithGaps(minutes: [minutes])` の 1 ギャップ版。
  static func dayWithGap(minutes: Int) -> BuiltPlanDay {
    dayWithGaps(minutes: [minutes])
  }

  private static func gapDetectionDay(stops: [RouteStop], constraints: [String: WishlistStopConstraint]) -> BuiltPlanDay {
    DayClock.buildDay(
      stops: stops,
      index: 0,
      dayCount: 1,
      locale: .ja,
      startBase: nil,
      endBase: nil,
      airportConstraints: [],
      constraints: constraints,
      earlyVisitStopIds: [],
      foodStopIds: [],
      openingWindows: [:],
      destination: Destinations.byId(.japan),
      requestedStart: nil,
      startDate: nil,
      travel: .default,
      dayEndTarget: nil,
      lockedOrder: []
    )
  }
}

/// 門限 17:00・18:00 発の便(= 最終日の空港締切 15:30)。食事は入れない —— 測っているのは締切で
/// あって、食事枠が日の算術に触れないことは Task 14 が既に固定している。
private func guardedDeadlineContext(_ overrides: [String: Int]) -> PlannerContext {
  var context = PlannerContext()
  context.destination = .destination(.japan)
  context.dayEndTarget = "17:00"
  context.departureAirport = "HND"
  context.departureTime = "18:00"
  context.flightKind = .domestic
  context.mealPlan = MealPlan.none
  context.durationOverrides = overrides
  return context
}
