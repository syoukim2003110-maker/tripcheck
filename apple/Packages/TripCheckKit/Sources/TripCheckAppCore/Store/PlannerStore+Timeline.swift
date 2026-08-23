import Foundation
import TripCheckKit

/*
 * 1 日を上から下へ読む形に畳んだもの —— ホテルを出る・移動する・訪ねる・食べる・帰る。
 *
 * `PlannerStore+ViewModel.swift` の隣に別ファイルで置いてあるのは、あちらが「5 つの問い」の
 * 答え(見出し・警告・日タブ・帯・課題)だけを持つ 1 ファイルであるため。行の並びは同じ
 * 「ビューは計算しない」という約束の下にあるが、扱う量が違う(4 種の行と、その 4 つが
 * 名乗る文の出どころ)ので、混ぜると読む人がどちらを追っているのか分からなくなる。
 *
 * ここも**文を作らない**:滞在の 1 行・区間の見出し・食事枠のラベル・状態の旗は全部 Kit の
 * `TimelinePresentation` が持ち主で、この層は「どの停留所のどの数を渡すか」だけを決める。
 * 唯一の例外がホテル行の前置き(「ホテルから」/「ホテルへ」)で、それは `AppCopy` にある。
 */

/// タイムラインの 1 行。並びは `timelineRows(_:)` が決め、ビューは受け取った順に描くだけ。
public enum TimelineRow: Identifiable, Sendable {
  case hotelLeg(HotelLegModel)
  case movement(MovementModel)
  case activity(ActivityModel)
  case meal(MealModel)

  public var id: String {
    switch self {
    case .hotelLeg(let model): "hotel:\(model.direction.rawValue)"
    // `legKey` は場所の組(A→B)だけを見るので、A→B→A→B のように同じ 2 地点を 1 日に
    // 何度も行き来する旅程では 2 度目が 1 度目と同じ id になる(`ForEach` に未定義の挙動を
    // 渡す)。訪問と同じく、区間が向かう先の番号まで入れて初めて一意になる。
    case .movement(let model): "leg:\(model.legKey)#\(model.nextStopNumber)"
    // 同じ場所を 1 日に 2 度訪ねる旅程が書けるので、番号まで入れて初めて一意になる。
    case .activity(let model): "stop:\(model.stopId)#\(model.number)"
    case .meal(let model): "meal:\(model.slotId)"
    }
  }
}

/// 訪問 1 件。
public struct ActivityModel: Identifiable, Sendable {
  public var stopId: String
  /// その日の何番目か(1 始まり)。デイカラーの丸の中に出る数。
  public var number: Int
  /// 到着時刻(`HH:MM`)。
  public var time: String
  public var name: String
  /// 「エリア · 滞在の目安 1時間30分」。**不確かさは名詞が運ぶ**(v3.1 §2.2)——
  /// 推定は「滞在の目安」、旅行者が指定した/提供元が確認した長さはただの「滞在」。
  public var areaAndStay: String
  /// 山岳アクセスなど、行き方に条件がある場所の但し書き(`PoiAccess`)。
  public var accessNote: String?
  /// 予約・固定時刻・必須・営業のトラブルの旗(`TimelinePresentation.activityFlags`)。
  public var flags: [ActivityFlag]
  /// TripCheck が自分で挟んだ行。旅行者が頼んだ場所と同じ顔をさせない(product.md の
  /// Anchor / Filler 則)。
  public var isFiller: Bool
  /// Filler の種類。丸の中の絵が食事(`fork`)か提案(`spark`)かはこれで決まる ——
  /// `isFiller` だけでは、この先 Filler が食事以外に増えたときに絵を選べない。
  public var fillerKind: TimelineFillerKind?
  /// 地図のピンと同じ日の色(`DayPalette`)。
  public var colorHex: String

  public var id: String { stopId }
}

/// 停留所と停留所のあいだの移動 1 件。
public struct MovementModel: Identifiable, Sendable {
  /// 手段ピッカーの 1 つ。`selected` は今この区間で使われている手段、`enabled` は選んでよいか。
  public typealias Option = (mode: TransportMode, label: String, minutes: Int, selected: Bool, enabled: Bool)

  /// `routeLegKey(from.id, to.id)`。手段の指定を引く鍵そのもの。**場所の組だけ**を見るので、
  /// 同じ 2 地点を 1 日に何度も行き来する旅程では複数の区間が同じ値を持つ——`TimelineRow.id`
  /// が一意であるためには `nextStopNumber` も要る。
  public var legKey: String
  /// この区間の直後に来る訪問の番号(`ActivityModel.number` と同じ、1 始まり)。行の役には
  /// 立たない——`TimelineRow.id` が `legKey` だけでは一意になれない旅程(A→B→A→B)を、
  /// 「どの回の A→B か」で区別するためだけに持つ。
  public var nextStopNumber: Int
  /// 「電車 95分・乗換1回」。**「約」も時間の丸めも出ない**(`legHeadline`)——
  /// 推定であることは `evidenceLine` が別に言う。
  public var summary: String
  public var from: String
  public var to: String
  /// `Icon` の rawValue。`Icon` は App ターゲットの型なので、ここは名前だけを返す。
  public var icon: String
  public var options: [Option]
  /// 徒歩で行くと何分か。**徒歩が選択肢に無い区間(山岳アクセスなど)は `nil`** ——
  /// 0 分と名乗ると「歩いてすぐ」に読める。
  public var walkMinutes: Int?
  /// 乗車の 1 行、無ければ「所要時間は目安です」。
  public var evidenceLine: String?

  public var id: String { legKey }
}

/// 食事枠 1 件。候補そのものは次の spec の担当で、この行が言うのは「この時間に食事の枠がある」
/// ことだけ。
public struct MealModel: Identifiable, Equatable, Sendable {
  public var slotId: String
  public var kind: MealKind
  /// `FoodRecommendationSlot.displayTime` —— 動線が実際にその辺りを通る時刻。
  public var time: String
  /// 「昼食のおすすめ」(`TimelinePresentation.fillerRowLabel`)。
  public var label: String

  public var id: String { slotId }
}

/// その日の最初と最後、ホテルとのあいだの移動。
public struct HotelLegModel: Identifiable, Equatable, Sendable {
  /// Kit の `hotelOutboundMinutes` / `hotelInboundMinutes` と同じ語で向きを呼ぶ。
  public enum Direction: String, Sendable { case outbound, inbound }

  public var direction: Direction
  /// 「ホテルから 徒歩 5分」。前置きは `AppCopy`、後ろは Kit の `legHeadline`。
  public var label: String

  public var id: String { direction.rawValue }
}

extension PlannerStore {

  /// 1 日ぶんの行。並びは `startBase → (移動 → 訪問 → 食事枠)× 停留所 → endBase`。
  ///
  /// 移動が 2 つ続くことは無い —— 区間は「n 番目の停留所の直前」にしか置かないので、
  /// 停留所と区間が 1 対 1 で噛み合う。食事枠の置き場所は Kit の
  /// `TimelinePresentation.mealSlotsAfterStop` が決める(**時刻順**で、その枠の時計を
  /// まだ過ぎていない最後の停留所の後ろ)—— 12:45 の昼食が 15:40 の訪問の下に出ない、
  /// という規則はそこで単体テストされている。
  public func timelineRows(_ dayIndex: Int) -> [TimelineRow] {
    guard let bundle, bundle.plan.days.indices.contains(dayIndex) else { return [] }
    let plan = bundle.plan
    let day = plan.days[dayIndex]
    // 何も入っていない日はホテル行も出さない。往復だけの日は旅程ではない(日の見出しが
    // 「この日はまだ予定がありません」を出す)。
    guard !day.stops.isEmpty else { return [] }

    let locale = request.locale
    let preference = plan.travelPreference
    let colorHex = DayPalette.color(forDayIndex: dayIndex)
    let daySlots = plan.foodRecommendationSlots.filter { $0.dayIndex == dayIndex }
    let arrivals = day.stops.map(\.arrival)
    // 物証は 1 度だけ引く。行ごとに全件を舐めると、停留所が増えるほど二乗で遅くなる。
    let stayStatus = durationEvidenceByStopId()

    var rows: [TimelineRow] = []
    if let leg = hotelLegRow(day: day, plan: plan, direction: .outbound, preference: preference, locale: locale) {
      rows.append(.hotelLeg(leg))
    }
    for (index, built) in day.stops.enumerated() {
      if index > 0, day.legs.indices.contains(index - 1) {
        rows.append(.movement(movementRow(
          day.legs[index - 1],
          nextStopNumber: index + 1,
          preference: preference,
          locale: locale
        )))
      }
      rows.append(.activity(activityRow(
        built,
        index: index,
        colorHex: colorHex,
        status: stayStatus[built.stop.id] ?? .estimated,
        locale: locale
      )))
      for slot in TimelinePresentation.mealSlotsAfterStop(daySlots, arrivals: arrivals, stopIndex: index) {
        rows.append(.meal(MealModel(
          slotId: slot.id,
          kind: slot.kind,
          time: slot.displayTime,
          // `MealKind` と `TimelineFillerKind` は別の enum(枠の種類と、行の見た目の種類)。
          label: TimelinePresentation.fillerRowLabel(slot.kind == .lunch ? .lunch : .dinner, locale: locale)
        )))
      }
    }
    if let leg = hotelLegRow(day: day, plan: plan, direction: .inbound, preference: preference, locale: locale) {
      rows.append(.hotelLeg(leg))
    }
    return rows
  }

  // MARK: - 行 1 種ずつ

  /// 訪問の行。数(番号・時刻・滞在)は組み上がった旅程から、文は全部 Kit から。
  private func activityRow(
    _ built: BuiltPlanStop,
    index: Int,
    colorHex: String,
    status: DurationEvidenceStatus,
    locale: PlannerLocale
  ) -> ActivityModel {
    let stop = built.stop
    let stay = TimelinePresentation.stayLine(minutes: stop.planningDurationMinutes, status: status, locale: locale)
    return ActivityModel(
      stopId: stop.id,
      number: index + 1,
      time: built.arrival,
      name: stop.name,
      areaAndStay: stop.area.isEmpty ? stay : "\(stop.area) · \(stay)",
      accessNote: PoiAccess.policy(for: stop).map { locale == .ja ? $0.note.ja : $0.note.en },
      flags: TimelinePresentation.activityFlags(built, locale: locale),
      // 今日の鍵ゼロのアプリでは、`isFiller`/`fillerKind` が真になる停留所は 1 つも無い。
      // ビルダーが作る `BuiltPlanStop` は常に `kind: .place, mealKind: nil`
      // (`Sources/TripCheckKit/Builder/DayClock.swift:153-158`。移植元の TS も同じ)——
      // この画面が読んでいるのはその事実そのままで、これは推測でも将来の話でもない。
      //
      // Web 版はウィッシュリストに刺した目印(`TRIPCHECK_FILLER_PREFIX`、
      // `lib/presentation/recommendation-presentation.ts:26`)から `isFiller` を出す
      // (`app/components/planner/hooks/useTripDomainModel.tsx:750-761`)が、その目印は
      // Kit にまだ移植されていない。採用した推薦が入る次の spec で、この 2 行をその目印の
      // 判定に差し替える —— それまでは `built.kind`/`mealKind` がここの唯一の出どころ。
      isFiller: built.kind == .meal,
      fillerKind: built.mealKind.map { $0 == .lunch ? .lunch : .dinner },
      colorHex: colorHex
    )
  }

  /// 移動の行。選ばれている手段は**旅行者の指定が常に勝つ**(`legModeOverrides`)——
  /// 指定が無ければエンジンの推薦。
  private func movementRow(
    _ leg: BuiltPlanLeg,
    nextStopNumber: Int,
    preference: TravelPreference,
    locale: PlannerLocale
  ) -> MovementModel {
    let legKey = routeLegKey(leg.from.id, leg.to.id)
    let recommended = leg.comparison.recommended
    let selected = edit.legModeOverrides[legKey] ?? recommended.mode
    let shown = leg.comparison.options.first { $0.mode == selected } ?? recommended
    let offersWalking = leg.comparison.options.contains { $0.mode == .walk }
    // 乗車の 1 行は提供元の経路情報からしか作れない。Apple の transit は ETA だけなので常に nil。
    let boarding: TransitLegBoarding? = nil
    return MovementModel(
      legKey: legKey,
      nextStopNumber: nextStopNumber,
      summary: TimelinePresentation.legHeadline(
        mode: recommended.mode,
        minutes: recommended.minutes,
        transferCount: leg.transferCount,
        travelPreference: preference,
        locale: locale
      ),
      from: leg.from.name,
      to: leg.to.name,
      icon: Self.modeIcon(recommended.mode, travelPreference: preference),
      options: leg.comparison.options.map { option in
        (
          mode: option.mode,
          label: legModeLabel(option.mode, locale),
          minutes: option.minutes,
          selected: option.mode == selected,
          // 提供元が「その手段では行けない」と答えた選択肢は選べない。徒歩はそれに加えて
          // 90 分まで —— それを超える徒歩は、選べば必ずその日の残りを壊す。
          enabled: !(option.unroutable ?? false) && (option.mode != .walk || leg.walkingMinutes <= 90)
        )
      },
      walkMinutes: offersWalking ? leg.walkingMinutes : nil,
      evidenceLine: TimelinePresentation.transitBoardingText(boarding, locale: locale)
        ?? (shown.source == .live ? AppCopy.for(locale).appleRouteEvidence : Copy.for(locale).estimated)
    )
  }

  /// ホテルとのあいだの 1 行。拠点が決まっていない旅では**出さない** —— 行き先の無い
  /// 「ホテルへ」は、決めていない宿を決まったことにしてしまう。
  ///
  /// 文は Kit の `legHeadline`(「徒歩 5分」)に `AppCopy` の前置きを足して作る。Kit にも
  /// `hotelDepartRow` があるが、あちらは分に「約」を付ける古い形で、v3.1 が移動の行から
  /// 外した丸めの但し書きがそのまま残っている。
  private func hotelLegRow(
    day: BuiltPlanDay,
    plan: BuiltTripPlan,
    direction: HotelLegModel.Direction,
    preference: TravelPreference,
    locale: PlannerLocale
  ) -> HotelLegModel? {
    let base = direction == .outbound ? (day.startBase ?? plan.selectedBase) : (day.endBase ?? plan.selectedBase)
    guard base != nil else { return nil }
    let minutes = direction == .outbound ? day.hotelOutboundMinutes : day.hotelInboundMinutes
    guard let minutes else { return nil }
    let mode = direction == .outbound ? day.hotelOutboundMode : day.hotelInboundMode
    let transfers = direction == .outbound ? day.hotelOutboundTransferCount : day.hotelInboundTransferCount
    // 手段が分からない区間は、その志向の既定の乗り物で呼ぶ(`transportModeLabel(nil, …)`
    // と同じ語になる組み合わせ)。
    let headline = TimelinePresentation.legHeadline(
      mode: mode ?? (preference == .car ? .taxi : .transit),
      minutes: minutes,
      transferCount: transfers,
      travelPreference: preference,
      locale: locale
    )
    let app = AppCopy.for(locale)
    return HotelLegModel(
      direction: direction,
      label: direction == .outbound ? app.hotelLegDepart(headline) : app.hotelLegReturn(headline)
    )
  }

  // MARK: - 内部

  /// 停留所 id → 滞在時間が誰の言い分か。物証の一覧(`duration:<id>`)が唯一の持ち主で、
  /// `edit.userStayMinutes` を直に見ない —— 見ると、指定を入れた直後で**まだ組み直して
  /// いない**旅程に「滞在」と書いてしまう(数はまだ前の見積もりのまま)。
  ///
  /// 印刷の 1 枚(`PlannerStore+Print.swift`)も同じ表を読む —— 紙と画面で滞在の言い方が
  /// 割れると、同じ場所が画面では「滞在の目安 1時間」、紙では「滞在 1時間」になる。
  func durationEvidenceByStopId() -> [String: DurationEvidenceStatus] {
    guard let bundle else { return [:] }
    let prefix = "duration:"
    var out: [String: DurationEvidenceStatus] = [:]
    for fact in bundle.evidence.facts where fact.kind == .stay_duration && fact.id.hasPrefix(prefix) {
      out[String(fact.id.dropFirst(prefix.count))] = fact.evidence.status
    }
    return out
  }

  /// 手段 3 つと絵の対応(`app/components/planner/icon-maps.tsx:25-27`)。車で回る旅の
  /// タクシーだけは車の絵で出る —— 呼ぶ乗り物ではなく、自分で運転する車だから。
  nonisolated static func modeIcon(_ mode: TransportMode, travelPreference: TravelPreference) -> String {
    switch mode {
    case .transit: "train"
    case .taxi: travelPreference == .car ? "car" : "taxi"
    case .walk: "walk"
    }
  }
}
