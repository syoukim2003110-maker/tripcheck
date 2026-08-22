import Foundation

/*
 * 食事の枠。予定を 1 分も動かさずに「この日はこのあたりで昼/夕を探すとよい」とだけ言う推薦で、
 * 停留所としてスケジュールに割り込むことはない(食事休憩そのものは `DayClock` の担当)。
 *
 * lib/trip-builder.ts:396-459 (`foodProfiles`)、:460-466 (`foodIdeasForArea`)、
 * :468-583 (`buildFoodRecommendationSlots`)。
 */

/// TS `foodProfiles` の要素 (`lib/trip-builder.ts:396-399`)
private struct FoodProfile: Sendable {
  let areas: JSRegex
  let ideas: [PlannerLocale: [String]]

  init(areas: String, ideas: [PlannerLocale: [String]]) {
    self.areas = try! JSRegex(areas, options: [.caseInsensitive])
    self.ideas = ideas
  }
}

/// TS `foodProfiles` (`lib/trip-builder.ts:396-459`)。TS は ko/zh の語も持つが、このキットの
/// `PlannerLocale` は en/ja だけなので 2 言語ぶんを写す。
private let foodProfiles: [FoodProfile] = [
  FoodProfile(
    areas: "Tsukiji|Toyosu|築地|豊洲|쓰키지|도요스|筑地|丰洲",
    ideas: [
      .en: ["sushi & seafood", "market breakfast", "casual Japanese"],
      .ja: ["寿司・海鮮", "市場らしい朝ごはん", "気軽な和食"],
    ]
  ),
  FoodProfile(
    areas: "Asakusa|Oshiage|浅草|押上|아사쿠사|오시아게|浅草|押上",
    ideas: [
      .en: ["tempura & soba", "old-Tokyo classics", "kissaten café"],
      .ja: ["天ぷら・そば", "下町の定番", "喫茶店・甘味"],
    ]
  ),
  FoodProfile(
    areas: "Shibuya|Harajuku|渋谷|原宿|시부야|하라주쿠|涩谷|原宿",
    ideas: [
      .en: ["modern Japanese", "small-plate izakaya", "specialty café"],
      .ja: ["今っぽい和食", "小皿系の居酒屋", "専門店カフェ"],
    ]
  ),
  FoodProfile(
    areas: "Shinjuku|新宿|신주쿠",
    ideas: [
      .en: ["yakitori & izakaya", "ramen", "late-night Japanese"],
      .ja: ["焼き鳥・居酒屋", "ラーメン", "遅めでも入れる和食"],
    ]
  ),
  FoodProfile(
    areas: "Akihabara|Ueno|秋葉原|上野|아키하바라|우에노|秋叶原|上野",
    ideas: [
      .en: ["ramen & curry", "tonkatsu", "casual izakaya"],
      .ja: ["ラーメン・カレー", "とんかつ", "気軽な居酒屋"],
    ]
  ),
  FoodProfile(
    areas: "Mitaka|三鷹|미타카|三鹰",
    ideas: [
      .en: ["neighborhood Japanese", "set meal", "quiet café"],
      .ja: ["街の和食店", "定食", "落ち着いたカフェ"],
    ]
  ),
]

public enum MealSlots {
  /// TS `foodIdeasForArea` (`lib/trip-builder.ts:460-466`)。
  ///
  /// エリアプロファイルは設計上とうきょう固有。そこから外れたときの受け皿は目的地自身の
  /// 料理語でなければならず、ツェルマットで "casual Japanese" と言ってはいけない。
  static func foodIdeasForArea(_ area: String, locale: PlannerLocale, destination: Destination) -> [String] {
    let profile = destination.id == .japan ? foodProfiles.first { $0.areas.test(area) } : nil
    if let profile { return profile.ideas[locale] ?? profile.ideas[.en] ?? [] }
    let cuisine = locale == .ja ? destination.cuisine[.ja] : destination.cuisine[.en]
    return cuisine ?? destination.cuisine[.en] ?? []
  }

  /// TS `buildFoodRecommendationSlots` (`lib/trip-builder.ts:468-583`)。
  ///
  /// 引数の並びは task-14-brief.md の Interfaces に合わせた(TS は `(days, mealPlan, locale, destination)`)。
  public static func build(
    days: [BuiltPlanDay],
    destination: Destination,
    mealPlan: MealPlan,
    locale: PlannerLocale
  ) -> [FoodRecommendationSlot] {
    let lunch = destination.meals.lunch
    let dinner = destination.meals.dinner
    let lunchAnchorMinutes = Int((Double(lunch.start + lunch.end) / 2).rounded())
    if mealPlan == .none { return [] }
    var slots: [FoodRecommendationSlot] = []

    for (dayIndex, day) in days.enumerated() {
      if day.stops.isEmpty { continue }
      if day.deadlinePreviousDay == true { continue }
      let requestedKinds: [MealKind] = mealPlan == .all ? [.lunch, .dinner] : [.dinner]
      guard let firstArrival = ClockTime(day.stops[0].arrival)?.minutes,
            let lastDepartureRaw = ClockTime(day.stops[day.stops.count - 1].departure)?.minutes
      else { continue }
      // 深夜を跨ぐ予定は 00:xx へ折り返すので、食事窓との重なり判定が本当の 1 日の終わりを
      // 見られるように巻き戻す。
      let lastDeparture = lastDepartureRaw < firstArrival ? lastDepartureRaw + 1440 : lastDepartureRaw

      for kind in requestedKinds {
        let deadlineMinutes = day.deadline.flatMap { ClockTime($0) }?.minutes
        // 食事は実際に存在する予定に属する。経路が食事窓に一度も触れない日には枠を出さない。
        // 午前で終わる日が 10:42 終了の下に 18:00 の「帰路の夕食」行を生やさないための門。
        if kind == .lunch && (firstArrival > lunch.end || lastDeparture < lunch.start) { continue }
        if kind == .dinner, let deadlineMinutes, deadlineMinutes < dinner.start { continue }
        // 旅行者は夕食どきにまだ動いている日には夕食を食べる。下の規則はかつて「観光が
        // いつ終わるか」を尋ねていたので、22:00 の門限の下で 09:00–15:00 という普通の東京の
        // 1 日 — 最も夕食の余地がある日 — が 30 分差で枠を失っていた。日の終わりが決める。
        // このヒューリスティックは終わりが分からないときだけ立つ。
        if kind == .dinner && deadlineMinutes == nil && lastDeparture < dinner.start - 120 { continue }
        // 逆の場合: 夕食窓全体をまたぐ経路には、その中で食べる瞬間が無い。20:40–21:55 を
        // 美術館の中で過ごす人に 21:00 を出すのは、枠が名乗る動線を壊す。だから不可能な枠を
        // 出すのではなく、その日は夕食枠なしにする。
        if kind == .dinner && firstArrival <= dinner.start && lastDeparture >= dinner.end { continue }

        // 昼は、昼の時間帯に旅行者がいる(あるいは直近で着いた)停留所に錨を下ろす。窓の後に
        // しか着かない停留所は決して選ばない — それでは食事行が後の訪問より後ろに来てしまう。
        func unwrappedArrival(_ stop: BuiltPlanStop) -> Int {
          guard let value = ClockTime(stop.arrival)?.minutes else { return Int.max }
          return value < firstArrival ? value + 1440 : value
        }
        let anchor = kind == .lunch
          ? (day.stops.last { unwrappedArrival($0) <= lunch.end } ?? day.stops[0])
          : day.stops[day.stops.count - 1]
        let anchorArrival = ClockTime(anchor.arrival)?.minutes ?? lunchAnchorMinutes
        let displayMinutes = kind == .lunch
          ? min(max(lunchAnchorMinutes, anchorArrival), lunch.end)
          : max(dinner.start, min(lastDeparture, dinner.end))

        // 「動線上」を名乗る以上、検索の中心は食事時刻に旅行者が実際にいる地点に置く:
        // 滞在中ならその場所、移動中ならその区間の中間点、最終地点を出た後ならホテルへの
        // 帰路の中間点。アンカー1点に候補が固まる見え方を避ける。
        func positionAtMealTime(_ minutes: Int) -> GeoPoint {
          for index in day.stops.indices {
            let stopArrival = ClockTime(day.stops[index].arrival)?.minutes
            let stopDeparture = ClockTime(day.stops[index].departure)?.minutes
            if let stopArrival, minutes < stopArrival {
              let previous: GeoPoint? = index > 0
                ? GeoPoint(latitude: day.stops[index - 1].stop.latitude, longitude: day.stops[index - 1].stop.longitude)
                : day.startBase.map { GeoPoint(latitude: $0.latitude, longitude: $0.longitude) }
              let current = day.stops[index].stop
              guard let previous else { return GeoPoint(latitude: current.latitude, longitude: current.longitude) }
              return GeoPoint(
                latitude: (previous.latitude + current.latitude) / 2,
                longitude: (previous.longitude + current.longitude) / 2
              )
            }
            if let stopDeparture, minutes <= stopDeparture {
              let current = day.stops[index].stop
              return GeoPoint(latitude: current.latitude, longitude: current.longitude)
            }
          }
          let lastStop = day.stops[day.stops.count - 1].stop
          guard let home = day.endBase else {
            return GeoPoint(latitude: lastStop.latitude, longitude: lastStop.longitude)
          }
          return GeoPoint(
            latitude: (lastStop.latitude + home.latitude) / 2,
            longitude: (lastStop.longitude + home.longitude) / 2
          )
        }
        let mealPosition = positionAtMealTime(displayMinutes)

        let rationale: String
        switch (kind, locale) {
        case (.lunch, .en):
          rationale = "Easy to reach around \(anchor.stop.name), without adding a cross-city detour."
        case (.lunch, .ja):
          rationale = "\(anchor.stop.name)の前後で寄りやすく、わざわざ別の街へ移動せずに済みます。"
        case (.dinner, .en):
          rationale = "A flexible finish near \(anchor.stop.name); keep it here or move dinner back toward the hotel."
        case (.dinner, .ja):
          rationale = "\(anchor.stop.name)を見終えた流れで選びやすいエリアです。疲れていたらホテル周辺へ変えても大丈夫。"
        }

        let displayTime = ClockTime(minutes: displayMinutes).description
        slots.append(FoodRecommendationSlot(
          id: "food-\(dayIndex + 1)-\(kind.rawValue)",
          dayIndex: dayIndex,
          dayLabel: day.label,
          date: day.date,
          kind: kind,
          area: anchor.stop.area,
          anchorStopId: anchor.stop.id,
          latitude: mealPosition.latitude,
          longitude: mealPosition.longitude,
          window: kind == .lunch
            ? "\(ClockTime(minutes: lunch.start).description)–\(ClockTime(minutes: lunch.end).description)"
            : "\(ClockTime(minutes: dinner.start).description)–\(ClockTime(minutes: dinner.end).description)",
          displayTime: displayTime,
          probeTime: displayTime,
          rationale: rationale,
          queryIdeas: foodIdeasForArea(anchor.stop.area, locale: locale, destination: destination)
        ))
      }
    }
    return slots
  }
}
