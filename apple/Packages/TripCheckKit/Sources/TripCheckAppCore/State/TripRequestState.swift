import Foundation
import TripCheckKit

/// 旅行者が「おまかせ」で組ませるか、条件を自分で決めるか。TS
/// `PlannerBuildMode`(`app/components/planner/hooks/useTripRequestState.tsx:30`)。
public enum BuildMode: Equatable, Sendable {
  case automatic, custom
}

/*
 * 状態 3 グループの 1 つ目 ——「何を組むか」。
 *
 * 分け方の理由は寿命が違うこと: `TripRequestState` は旅程を作る前の入力(取り消せる必要が
 * ない)、`PlannerEditState`(Kit)は組み上がった旅程への編集(Undo の単位そのもの)、
 * `PlannerViewState` は画面の開閉と選択(保存も共有もしない)。
 *
 * **`pace` / `travelPreference` / `transferBufferMinutes` / `hotelQuery` はここに持たない。**
 * それらの正は `edit`(`PlannerEditState`)だけで、Start / Resolve の条件 UI は
 * `store.setPace(_:)` などの setter 経由で `edit` を書く(Task 3)。二重に持つと
 * `tripRequest()` が読む側と UI が書く側がずれる。
 *
 * `Codable` にはしない —— 端末内保存は Task 11 の `PersistedTripInput` DTO が担う。
 */
public struct TripRequestState: Equatable, Sendable {
  public var entries: [WishlistEntry]
  /// 貼り付けの中で場所名として読み取れなかった行。捨てずに見せる。
  public var unparsedLines: [String]
  /// 表示用。正は `bundle.plan.inputMode`(ビルダーが自分で決める)。
  public var inputMode: InputMode
  /// `nil` は「日数未定」。`build()` はそのとき(日数, 拠点)の不動点を解く。
  public var tripDays: Int?
  /// `YYYY-MM-DD`。無ければ営業時間・祝日・天気は日付なしの前提で扱われる。
  public var tripStartDate: String?
  public var destination: DestinationChoice
  /// `HH:MM`。日ごとの開始時刻が無い日に使う既定。
  public var dayStartDefault: String
  /// `HH:MM`。1 日の終わりの目標。`nil` はエンジンの既定(22:00)。
  public var dayEndTarget: String?
  /// `nil` はエンジンの既定(30 分 / 2 回)。
  public var maxWalkingMinutesPerLeg: Int?
  public var maxTransfersPerLeg: Int?
  /// 空文字は「指定なし」。Web の `"none"` に当たる番兵で、`tripRequest()` が `nil` に畳む。
  public var arrivalAirport: String
  public var arrivalTime: String
  public var departureAirport: String
  public var departureTime: String
  public var flightKind: FlightKind
  public var mealPlan: MealPlan
  public var locale: PlannerLocale
  /// 場所解決の途中経過。entry の `id` で引く(名前は重複しうる)。
  public var resolutions: [UUID: PlaceResolution]
  /// 解決した場所が 2 か国以上にまたがったときの ISO 3166-1 alpha-2。空なら 1 か国。
  public var mixedCountryCodes: [String]
  public var buildMode: BuildMode

  public init(
    entries: [WishlistEntry] = [],
    unparsedLines: [String] = [],
    inputMode: InputMode = .wishlist,
    tripDays: Int? = nil,
    tripStartDate: String? = nil,
    destination: DestinationChoice = .auto,
    dayStartDefault: String = EngineConstants.defaultDayStart.description,
    dayEndTarget: String? = nil,
    maxWalkingMinutesPerLeg: Int? = nil,
    maxTransfersPerLeg: Int? = nil,
    arrivalAirport: String = "",
    arrivalTime: String = "",
    departureAirport: String = "",
    departureTime: String = "",
    flightKind: FlightKind = .international,
    mealPlan: MealPlan = .all,
    locale: PlannerLocale,
    resolutions: [UUID: PlaceResolution] = [:],
    mixedCountryCodes: [String] = [],
    buildMode: BuildMode = .automatic
  ) {
    self.entries = entries
    self.unparsedLines = unparsedLines
    self.inputMode = inputMode
    self.tripDays = tripDays
    self.tripStartDate = tripStartDate
    self.destination = destination
    self.dayStartDefault = dayStartDefault
    self.dayEndTarget = dayEndTarget
    self.maxWalkingMinutesPerLeg = maxWalkingMinutesPerLeg
    self.maxTransfersPerLeg = maxTransfersPerLeg
    self.arrivalAirport = arrivalAirport
    self.arrivalTime = arrivalTime
    self.departureAirport = departureAirport
    self.departureTime = departureTime
    self.flightKind = flightKind
    self.mealPlan = mealPlan
    self.locale = locale
    self.resolutions = resolutions
    self.mixedCountryCodes = mixedCountryCodes
    self.buildMode = buildMode
  }

  /// 何も入っていない Start 画面。既定値は Web の `useTripRequestState`(`:30-50`)と同じ:
  /// 3 日・おまかせ・食事あり・国際線・9:00 始まり・空港と日付は未指定。日数だけは Web が
  /// `tripDays = 3` と `daysUndecided = false` の 2 つで持っているものを `Int?` 1 つに畳んで
  /// あるので、既定は「未定(`nil`)」ではなく `3` —— 旅行者が「未定」を選んで初めて `nil`
  /// になり、そのときだけ不動点探索が走る。
  public static func initial(locale: PlannerLocale) -> TripRequestState {
    TripRequestState(tripDays: 3, locale: locale)
  }
}
