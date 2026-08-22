import Foundation
import Observation
import TripCheckKit

/*
 * 画面が読む唯一の状態。3 つのグループ(入力・編集・見た目)と、組み上がった旅程を持つ。
 *
 * `@MainActor` なのは、ここが SwiftUI の観測対象そのものだから。重い計算(旅程の組み立て)は
 * `Task.detached` に出して本線を空ける —— 出せるのは `BuildRunner.run` が純関数で、
 * `TripRequest` も戻り値も `Sendable` だからである。
 */
@Observable
@MainActor
public final class PlannerStore {

  // MARK: - 状態 3 グループ

  /// 何を組むか(旅程を作る前の入力)。
  public var request: TripRequestState
  /// 組み上がった旅程への編集。Undo の単位そのもの(Kit の型)。
  public var edit: PlannerEditState = .empty
  /// 画面の開閉と選択。`tripRequest()` はここを読まない。
  public var view = PlannerViewState()

  /// 直近に組み上がったもの。差し替えは常に丸ごと。
  public private(set) var bundle: BuiltPlanBundle?

  /// `init(initial:limit:)` しか無い。10(`PlannerEdits.undoLimit`)は 1...20 の
  /// `precondition` を通る。
  public private(set) var history = PlannerHistory<PlannerEditState>(initial: .empty, limit: PlannerEdits.undoLimit)

  /// 組み立ての世代。1 回組むごとに 1 つ進み、**進んだ後に返ってきた答えは捨てる**。
  public private(set) var buildGeneration = 0

  /// 場所を調べている間だけ真(`requestBuildFromStart()` が立てて倒す)。CTA が「まだ場所が
  /// 無い」と「いま調べている」を言い分けるために要る —— 見分けが付かないと、旅行者は
  /// 同じボタンをもう一度押す。書くのは `PlannerStore+Start.swift` なので `internal(set)`。
  public internal(set) var isResolvingPlaces = false

  // MARK: - 手持ちの道具(観測しない)

  @ObservationIgnored let resolvers: [any PlaceResolver]
  @ObservationIgnored let store: TripStore?
  @ObservationIgnored let autosaveDebounce: Duration
  @ObservationIgnored let clock: any Clock<Duration>
  @ObservationIgnored private var buildTask: Task<Void, Never>?

  public init(
    resolvers: [any PlaceResolver],
    store: TripStore?,
    autosaveDebounce: Duration = .milliseconds(550),
    clock: any Clock<Duration> = ContinuousClock()
  ) {
    self.resolvers = resolvers
    self.store = store
    self.autosaveDebounce = autosaveDebounce
    self.clock = clock
    self.request = TripRequestState.initial(locale: .ja)
  }

  // MARK: - エンジンへの引き渡し

  /// `request` と `edit` を 1 つの `TripRequest` に畳む。**`view` は読まない** —— 見ている日や
  /// 開いているシートで旅程が変わってはいけないので、この関数が触れる欄をその 2 つに限る。
  ///
  /// 日数は `request.tripDays ?? edit.tripDays`:旅行者が名乗った日数が常に勝ち、名乗って
  /// いなければ直近の組み立てが落ち着いた日数を使う。
  public func tripRequest() -> TripRequest {
    let raw = WishlistSerialization.raw(from: request.entries, locale: request.locale)
    var ctx = PlannerContext()
    ctx.destination = request.destination
    ctx.tripStartDate = request.tripStartDate
    ctx.resolvedStops = request.entries.compactMap { $0.pinned?.stop } + edit.resolvedStops
    ctx.resolvedBase = edit.resolvedBase
    ctx.hotelQuery = edit.hotelQuery
    ctx.travelPreference = edit.travelPreference
    ctx.transferBufferMinutes = edit.transferBufferMinutes
    ctx.durationOverrides = edit.userStayMinutes
    ctx.lastEntryTimes = edit.lastEntryTimes
    ctx.dayStartTimes = edit.dayStartTimes
    ctx.dayEndTimes = edit.dayEndTimes
    ctx.legModeOverrides = edit.legModeOverrides
    ctx.dayOverrides = edit.dayOverrides
    ctx.lockedOrderByDay = edit.lockedOrderByDay
    ctx.excludedStopIds = edit.removedStops.map(\.id)
    ctx.defaultDayStart = request.dayStartDefault
    ctx.dayEndTarget = request.dayEndTarget
    ctx.maxWalkingMinutesPerLeg = request.maxWalkingMinutesPerLeg
    ctx.maxTransfersPerLeg = request.maxTransfersPerLeg
    ctx.arrivalAirport = request.arrivalAirport.isEmpty ? nil : request.arrivalAirport
    ctx.arrivalTime = request.arrivalTime.isEmpty ? nil : request.arrivalTime
    ctx.departureAirport = request.departureAirport.isEmpty ? nil : request.departureAirport
    ctx.departureTime = request.departureTime.isEmpty ? nil : request.departureTime
    ctx.flightKind = request.flightKind
    ctx.mealPlan = request.mealPlan
    return TripRequest(
      raw: raw,
      days: request.tripDays ?? edit.tripDays,
      pace: edit.pace,
      locale: request.locale,
      context: ctx
    )
  }

  // MARK: - 組み立て

  /// 旅程を組む。組んでいる間に入力が変わったら、**先に始まったほうの答えは捨てる** ——
  /// そうしないと、遅く返ってきた古い旅程が新しい入力を上書きして、画面と入力がずれる。
  public func build() async {
    buildTask?.cancel()
    buildGeneration += 1
    let generation = buildGeneration
    view.screen = .building
    let req = tripRequest()
    let daysUndecided = request.tripDays == nil
    let task = Task.detached(priority: .userInitiated) { () -> BuiltPlanBundle in
      if daysUndecided {
        // 日数未定:(日数, 拠点)の不動点。日数を決めるには拠点が要り、拠点を選ぶには
        // 日数が要るので、両方が動かなくなるまで回す。
        //
        // `resolvedHotel:` を渡すのは省略できない。Kit の `baseFor` は
        // `resolvedHotel ?? recommendBase(candidate)`(`Scenarios/ProvisionalTripLength.swift:79-81`)
        // で、既定の `contextFor` は毎ラウンド `resolvedBase` を書き換える —— 渡さないと、
        // 自分でホテルを決めた旅行者が「未定」を選んだだけで、そのホテルが黙って
        // `baseRecommendations.first` に差し替わる。旅行者自身のホテルが常に勝ち、
        // 推薦(`provisionalBaseAsResolved`)はホテルが無いときの控えである。
        let fixed = ProvisionalTripLength.resolve(request: req, resolvedHotel: req.context.resolvedBase)
        var ctx = req.context
        ctx.resolvedBase = fixed.base
        return BuildRunner.run(TripRequest(raw: req.raw, days: fixed.days, pace: req.pace, locale: req.locale, context: ctx))
      }
      return BuildRunner.run(req)
    }
    buildTask = Task { _ = await task.value }
    let result = await task.value
    guard generation == buildGeneration, !Task.isCancelled else { return }
    commit(result)
  }

  /// 走っている組み立てを捨てる。`BuildRunner.run` は純粋な計算なので途中では止まらない ——
  /// 止まるのは**受け取る側**で、世代を 1 つ進めておけば、遅れて届いた束は `build()` の
  /// ガードで落ちる。
  public func cancelBuild() {
    buildTask?.cancel()
    buildTask = nil
    buildGeneration += 1
    if view.screen == .building {
      view.screen = bundle == nil ? .start : .plan
    }
  }

  /// 最初から。ロケールだけは端末の設定なので引き継ぐ。
  public func reset() {
    cancelBuild()
    request = TripRequestState.initial(locale: request.locale)
    edit = .empty
    view = PlannerViewState()
    bundle = nil
    history = PlannerHistory(initial: .empty, limit: PlannerEdits.undoLimit)
  }

  /// 見本の旅程を入れる。プロバイダの鍵が 1 つも無くても組み上がるように、行きたい場所の
  /// 文面(`Destination.sample`)と座標(`SwissSample`)の両方を Kit から取る。
  public func loadSample(_ id: DestinationId) {
    let destination = Destinations.byId(id)
    let raw = destination.sample?[request.locale] ?? destination.sample?[.en] ?? ""
    let parsed = WishlistSerialization.entries(fromPasted: raw)
    // 座標つきの見本は今のところスイスの 8 地点だけ。ほかの行き先が `sampleStops` を持つ日が
    // 来たら、ここが引く表を増やす(文面だけなら既に `id` で引けている)。
    let pins = id == .switzerland ? SwissSample.resolvedStops(locale: request.locale) : []
    reset()
    request.entries = parsed.entries.map { entry in
      var pinned = entry
      pinned.pinned = pins.first { $0.name == entry.text }.map(PinnedResolution.catalog)
      return pinned
    }
    request.unparsedLines = parsed.unparsed
    request.inputMode = parsed.mode
    request.tripDays = 4
    request.destination = .destination(id)
  }

  /// 組み上がったものを引き受ける。`edit.tripDays` を追従させるのは、次の組み立てで
  /// `request.tripDays` が `nil`(未定)でも、落ち着いた日数から続けられるようにするため。
  private func commit(_ bundle: BuiltPlanBundle) {
    self.bundle = bundle
    edit.tripDays = bundle.request.days
    // `"empty"` は機械が読む語で、旅行者に見せる文ではない(文言は画面側が引く)。
    view.screen = bundle.plan.days.isEmpty ? .error("empty") : .plan
    view.selectedDay = min(view.selectedDay, max(0, bundle.plan.days.count - 1))
    view.announcement = VerdictCopy.hero(
      result: bundle.result,
      fit: bundle.fit,
      plan: bundle.plan,
      locale: request.locale
    )
  }
}
