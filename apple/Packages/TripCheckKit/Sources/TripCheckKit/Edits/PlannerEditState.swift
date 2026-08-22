import Foundation

/*
 * Undo の単位そのもの ——「利用者が編集したもの」だけを持つ状態と、その状態を作る枠のない補助。
 *
 * 移植元は `lib/planner-app-state.ts` の編集側だけ:`upsertResolutionOverride` `:64-71`、
 * `manualStopFromResolutionOverride` `:73-94`、`withManualResolutionOverrides` `:96-110`、
 * `clampTripDays` `:198-200`、`builtPlanTravelMinutes` `:219-226`、`PlannerEditState` `:457-481`、
 * `PLANNER_UNDO_LIMIT` `:484`、`emptyPlannerEditState` `:486-507`。TS の同ファイルにある
 * プロバイダ応答・要求状態・画面状態(`FoodState` ほか)は**この層に入れない** —— それらは
 * 独自の寿命を持ち、再生すると Undo が通信のタイミングに依存する(`lib/planner-history.ts:1-9`)。
 *
 * TS `addCalendarDays`(`:190-196`)は移植しない:Task 2 の `CalendarDate.adding(days:)`
 * (`Core/CalendarDate.swift:59`)が同じ算術で、文字列の出入りは `CalendarDate(_:)` /
 * `description` が担う。`provisionalBaseAsResolved`(`:597-603`)は日数と拠点の不動点ループ
 * からしか呼ばれないので `Scenarios/ProvisionalTripLength.swift` に置いたままにする。
 */

/// TS `PlannerEditState["removedStops"]` の要素(`lib/planner-app-state.ts:471`)。TS は名前の
/// ない構造体リテラルだが、Swift には無名の構造体がないので型に名前を与える。
public struct PlannerRemovedStop: Equatable, Sendable, Codable {
  public var id: String
  public var name: String

  public init(id: String, name: String) {
    self.id = id
    self.name = name
  }
}

/// TS `ShareableResolutionOverride`(`lib/share-link.ts:17-20`)。
///
/// 場所解決の決定のうち**持続する部分**。Google の表示欄は意図的に無い:プロバイダの決定は
/// それが当たる出現と安定した識別子だけを残し、手入力の決定は別種の物証なので旅行者が書いた
/// 文字と座標だけを残す。TS は 2 つのオブジェクト形のユニオンで、`"providerRef" in override`
/// で見分ける(`:76`)—— `Codable` もその 2 形をそのまま読み書きする(Task 23 の共有コードが
/// Web とバイト互換であるために、判別子の欄を足してはいけない)。
public enum ResolutionOverride: Equatable, Hashable, Sendable, Codable {
  case provider(inputIndex: Int, providerRef: String)
  case manual(inputIndex: Int, name: String, address: String, latitude: Double, longitude: Double)

  public var inputIndex: Int {
    switch self {
    case .provider(let inputIndex, _): inputIndex
    case .manual(let inputIndex, _, _, _, _): inputIndex
    }
  }

  private enum CodingKeys: String, CodingKey {
    case inputIndex, providerRef, name, address, latitude, longitude
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let inputIndex = try container.decode(Int.self, forKey: .inputIndex)
    if let providerRef = try container.decodeIfPresent(String.self, forKey: .providerRef) {
      self = .provider(inputIndex: inputIndex, providerRef: providerRef)
      return
    }
    self = .manual(
      inputIndex: inputIndex,
      name: try container.decode(String.self, forKey: .name),
      address: try container.decode(String.self, forKey: .address),
      latitude: try container.decode(Double.self, forKey: .latitude),
      longitude: try container.decode(Double.self, forKey: .longitude)
    )
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .provider(let inputIndex, let providerRef):
      try container.encode(inputIndex, forKey: .inputIndex)
      try container.encode(providerRef, forKey: .providerRef)
    case .manual(let inputIndex, let name, let address, let latitude, let longitude):
      try container.encode(inputIndex, forKey: .inputIndex)
      try container.encode(name, forKey: .name)
      try container.encode(address, forKey: .address)
      try container.encode(latitude, forKey: .latitude)
      try container.encode(longitude, forKey: .longitude)
    }
  }
}

/// TS `PlannerEditState`(`lib/planner-app-state.ts:457-481`)。
///
/// ブリーフは 16 欄と書いているが TS は 18 欄ある(`itinerary` と `mealSelections` を数え落と
/// している)。v1.1 TC-048/TC-050 の推薦採用は wishlist の本文・解決済み停留所・プロバイダの
/// ピン・食事の選択を**同時に**変える 1 つの操作なので、それらが同じ追跡状態に居ることが
/// 「Undo 1 回で直前の計画がそのまま戻る」の根拠になる(TS `:472-480` の但し書き)。TS を採る。
///
/// **この `Codable` は Web の JSON とバイト互換ではない。** 合成された `encode(to:)` は `nil` の
/// オプショナル欄(`resolvedBase` など)を**書かない**が、TS は `resolvedBase: null` を書く。
/// 端末内保存(Task 25)と `PlannerHistory` は Swift 同士の往復なので問題にならない。Web と
/// 同じバイトが要るのは共有コードだけで、そこは Task 23 の `ShareCodec` が
/// `ShareableTripInput` 用の直列化を自前で持つ(この型を流用しないこと)。
public struct PlannerEditState: Equatable, Sendable, Codable {
  public var tripDays: Int
  public var pace: Pace
  public var hotelQuery: String
  public var resolvedBase: ResolvedStop?
  public var travelPreference: TravelPreference
  /// TS は `0 | 10 | 20 | 30` に絞るが、`PlannerContext.transferBufferMinutes` と同じく素の
  /// `Int` にしてある(検証は値を置く側の仕事で、受動的な入れ物の仕事ではない)。
  public var transferBufferMinutes: Int
  public var userStayMinutes: [String: Int]
  public var lastEntryTimes: [String: String]
  /// TS `Record<number, string>` は JSON ではオブジェクト。`Core/IntKeyed.swift` 参照。
  public var dayStartTimes: IntKeyedDictionary<String>
  public var dayEndTimes: IntKeyedDictionary<String>
  public var legModeOverrides: [String: TransportMode]
  public var dayOverrides: [String: Int]
  public var lockedOrderByDay: IntKeyedDictionary<[String]>
  public var removedStops: [PlannerRemovedStop]
  public var itinerary: String
  public var mealSelections: [String: String]
  public var resolvedStops: [ResolvedStop]
  public var resolutionOverrides: [ResolutionOverride]

  public init(
    tripDays: Int,
    pace: Pace,
    hotelQuery: String,
    resolvedBase: ResolvedStop? = nil,
    travelPreference: TravelPreference,
    transferBufferMinutes: Int,
    userStayMinutes: [String: Int] = [:],
    lastEntryTimes: [String: String] = [:],
    dayStartTimes: IntKeyedDictionary<String> = IntKeyedDictionary(),
    dayEndTimes: IntKeyedDictionary<String> = IntKeyedDictionary(),
    legModeOverrides: [String: TransportMode] = [:],
    dayOverrides: [String: Int] = [:],
    lockedOrderByDay: IntKeyedDictionary<[String]> = IntKeyedDictionary(),
    removedStops: [PlannerRemovedStop] = [],
    itinerary: String = "",
    mealSelections: [String: String] = [:],
    resolvedStops: [ResolvedStop] = [],
    resolutionOverrides: [ResolutionOverride] = []
  ) {
    self.tripDays = tripDays
    self.pace = pace
    self.hotelQuery = hotelQuery
    self.resolvedBase = resolvedBase
    self.travelPreference = travelPreference
    self.transferBufferMinutes = transferBufferMinutes
    self.userStayMinutes = userStayMinutes
    self.lastEntryTimes = lastEntryTimes
    self.dayStartTimes = dayStartTimes
    self.dayEndTimes = dayEndTimes
    self.legModeOverrides = legModeOverrides
    self.dayOverrides = dayOverrides
    self.lockedOrderByDay = lockedOrderByDay
    self.removedStops = removedStops
    self.itinerary = itinerary
    self.mealSelections = mealSelections
    self.resolvedStops = resolvedStops
    self.resolutionOverrides = resolutionOverrides
  }

  /// TS `emptyPlannerEditState()`(`lib/planner-app-state.ts:486-507`)。
  public static let empty = PlannerEditState(
    tripDays: 3,
    pace: .balanced,
    hotelQuery: "",
    travelPreference: .auto,
    transferBufferMinutes: EngineConstants.defaultTransferBuffer
  )
}

/// 枠のない編集の補助。`Edits/HardEdits.swift` が同じ名前空間へ編集ガードを足す。
public enum PlannerEdits {

  /// TS `PLANNER_UNDO_LIMIT`(`lib/planner-app-state.ts:484`)—— v1.1 §8.1「Undo/Redo は
  /// 直近 10 操作に届く」。台帳そのものの天井は `PlannerHistory.maxEntries`(20)で別物。
  public static let undoLimit = 10

  /// TS `upsertResolutionOverride`(`:64-71`)の `.slice(0, 12)`。
  public static let maxResolutionOverrides = 12

  /// TS `clampTripDays`(`lib/planner-app-state.ts:198-200`)。TS の `Math.round` は
  /// Swift の `Int` 引数では恒等。Task 17 が `ProvisionalTripLength` に先置きしていたものを、
  /// TS と同じ所属(編集状態の側)へ移した。
  public static func clampTripDays(_ value: Int) -> Int {
    min(EngineConstants.tripDaysRange.upperBound, max(EngineConstants.tripDaysRange.lowerBound, value))
  }

  /// TS `builtPlanTravelMinutes`(`lib/planner-app-state.ts:219-226`)—— ホテルの往復 2 本と、
  /// 各レグの**推奨手段**の分の合計。編集の前後で引き算すると「移動が何分増えたか」になる。
  public static func builtPlanTravelMinutes(_ plan: BuiltTripPlan) -> Int {
    plan.days.reduce(0) { sum, planDay in
      sum
        + (planDay.hotelOutboundMinutes ?? 0)
        + (planDay.hotelInboundMinutes ?? 0)
        + planDay.legs.reduce(0) { $0 + $1.comparison.recommended.minutes }
    }
  }

  /// TS `hotelPlanSignature`(`lib/planner-app-state.ts:445-450`)。ブリーフの名前リストには
  /// 無いが、指定された移植範囲 `:247-456` の中にあるので併せて移す。
  ///
  /// 経路が最適化されると停留所の**順**は変わる。ホテルが古くなるのは、その日が回る先の
  /// **集合**が変わったときだけ —— だから id を並べ替えてから畳む。TS の `.sort()` は比較関数
  /// なしの既定、すなわち UTF-16 コード単位の辞書順なので `jsStringLess` を使う(Global
  /// Constraints の照合規則)。
  public static func hotelPlanSignature(_ plan: BuiltTripPlan?) -> String {
    guard let plan else { return "" }
    return plan.days.enumerated().map { dayIndex, day in
      "\(dayIndex):" + stableSorted(day.stops.map(\.stop.id), by: jsStringLess).joined(separator: ",")
    }.joined(separator: "|")
  }

  /// TS `upsertResolutionOverride`(`lib/planner-app-state.ts:64-71`)。1 つの出現には 1 つの
  /// 決定しか無い(同じ `inputIndex` の古い決定は消える)。並びは `inputIndex` 昇順、最大 12 件。
  public static func upsertResolutionOverride(
    _ current: [ResolutionOverride],
    _ next: ResolutionOverride
  ) -> [ResolutionOverride] {
    let kept = current.filter { $0.inputIndex != next.inputIndex } + [next]
    return Array(stableSorted(kept) { $0.inputIndex < $1.inputIndex }.prefix(maxResolutionOverrides))
  }

  /// TS `manualStopFromResolutionOverride`(`lib/planner-app-state.ts:73-94`)。プロバイダの
  /// 決定は停留所を生まない(`nil`)—— 手入力だけが「旅行者の書いた場所」になる。
  ///
  /// `input` はブリーフの引数。TS は `override.name` をそのまま `input` にも入れる(`:79`)ので、
  /// 省略時はそれと同じ。貼られた行そのものを残したい呼び出し側だけが明示する。
  ///
  /// `provider: .user` は TS に無い欄(spec §4.3 で Swift に足した由来タグ)。手入力の決定は
  /// 定義上 `user_provided` なので、ここで名乗らせておく。
  public static func manualStop(from override: ResolutionOverride, input: String? = nil) -> ResolvedStop? {
    guard case .manual(let inputIndex, let name, let address, let latitude, let longitude) = override else { return nil }
    return ResolvedStop(
      id: "manual-\(inputIndex)-\(jsToFixed5(latitude))-\(jsToFixed5(longitude))",
      name: name,
      area: address,
      latitude: latitude,
      longitude: longitude,
      sourceUrl: "",
      verifiedAt: "",
      confidence: .low,
      planningDurationMinutes: StayEstimates.estimateStayMinutes(name: name, placeTypes: [], fallback: 90),
      isAnchor: false,
      isUserEntered: true,
      userProvidedCoordinates: true,
      input: input ?? name,
      inputIndex: inputIndex,
      address: address,
      provider: .user
    )
  }

  /// TS `withManualResolutionOverrides`(`lib/planner-app-state.ts:96-110`)。手入力の決定が
  /// ある出現だけを置き換え、残りはそのまま。手入力が 1 件も無ければ入力の複製を返す。
  public static func applyManualOverrides(
    _ stops: [ResolvedStop],
    overrides: [ResolutionOverride]
  ) -> [ResolvedStop] {
    let manual = overrides.compactMap { manualStop(from: $0) }
    if manual.isEmpty { return stops }
    let manualIndexes = Set(manual.compactMap(\.inputIndex))
    return stops.filter { $0.inputIndex == nil || !manualIndexes.contains($0.inputIndex!) } + manual
  }

  /// JS `Number.prototype.toFixed(5)`。手入力の停留所 id は Web と Swift の両方で座標から
  /// 組み直されるので、同じ丸めでなければ同じ場所が 2 つの id を持つ。
  ///
  /// 丸めは `Core/JSNumbers.swift` の `jsToFixed` に任せる。`String(format: "%.5f", …)` は同点を
  /// **偶数側**へ倒すが、JS の `toFixed` は「近いほうの整数、同点なら大きいほう」で、
  /// `35.015625` のように二進でちょうど半分になる座標で答えが割れる。`-0` を `"0.00000"` と
  /// 書くのも `jsToFixed` の側が持っている(`abs` を通すので符号が出ない)。
  static func jsToFixed5(_ value: Double) -> String { jsToFixed(value, 5) }
}
