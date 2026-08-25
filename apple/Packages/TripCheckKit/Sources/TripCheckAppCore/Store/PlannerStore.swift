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
  public internal(set) var history = PlannerHistory<PlannerEditState>(initial: .empty, limit: PlannerEdits.undoLimit)

  /// 組み立ての世代。1 回組むごとに 1 つ進み、**進んだ後に返ってきた答えは捨てる**。
  public internal(set) var buildGeneration = 0

  /// 場所を尋ねる世代。`buildGeneration` と同じ仕掛けを、組み立ての手前(場所の解決)に
  /// 掛ける —— 解決は通信で、返事は**数秒後**に来る。その間に旅が入れ替われば
  /// (`reset()`:リンクを開いた・保存した旅程を開いた・見本を入れた)、返ってきた答えは
  /// もう誰の答えでもない。世代が動いていたら黙って捨てる。
  ///
  /// 捨てないと何が起きるかは実際に踏める:`.onOpenURL` は解決の最中にも来るので、
  /// さっきの旅の「○○駅」が、リンクで入ったばかりの別の旅の 1 行目に**番号で**貼り付く。
  /// 進むのは `reset()` と、解決を始める 4 か所(`requestBuildFromStart` /
  /// `retryResolve` / `changeDestinationFromResolve` / 開き直しのカタログ引き直し)。
  public internal(set) var resolveGeneration = 0

  /// 場所を調べている間だけ真(`requestBuildFromStart()` が立てて倒す)。CTA が「まだ場所が
  /// 無い」と「いま調べている」を言い分けるために要る —— 見分けが付かないと、旅行者は
  /// 同じボタンをもう一度押す。書くのは `PlannerStore+Start.swift` なので `internal(set)`。
  public internal(set) var isResolvingPlaces = false

  /// 旅券の国。**端末に保存しない**(Web と同じ)—— 保存するのは有効期限だけで、国は
  /// 「入国判定を出してよいか」の合図にすぎない。書くのは `setPassportCountry(_:)`。
  public internal(set) var passportCountry: PassportCountry = .unset

  /// 旅券の有効期限(`YYYY-MM-DD`)。正は `UserDefaults`(`tripcheck.passportExpiry`)で、
  /// ここはそれを画面に映すための写し —— `UserDefaults` は観測できないので、写しが無いと
  /// 日付を選んでも残存期間の判定が更新されない。書くのは `setPassportExpiry(_:)`。
  public internal(set) var passportExpiry: String?

  /// 端末に残っている旅程(新しい順、最大 10 件)。`loadRecent()` が入れ替える。
  public internal(set) var recentTrips: [StoredTripRecord] = []

  /// 端末に旅程を残せない。`init` の探り(`trips/` を作ってみる)で**起動時に**立ち、以後の
  /// 保存が落ちても立つ —— 最初の保存まで黙っていると、旅行者は残っているつもりで
  /// アプリを閉じる。書くのは `PlannerStore+Persistence.swift`。
  public internal(set) var storageUnavailable = false

  // MARK: - 手持ちの道具(観測しない)

  @ObservationIgnored let resolvers: [any PlaceResolver]
  @ObservationIgnored let store: TripStore?
  /// `store` が書く場所。**`TripStore` は自分のディレクトリを外へ見せない**(actor の中の
  /// `private let`)ので、起動時に「書けるかどうか」を同期に確かめるにはここへ同じ URL を
  /// 渡してもらうしかない。渡さなければ探りは走らず、`storageUnavailable` は最初の保存が
  /// 落ちたときに立つ。
  @ObservationIgnored let storageDirectory: URL?
  @ObservationIgnored let autosaveDebounce: Duration
  @ObservationIgnored let clock: any Clock<Duration>
  /// 旅券の有効期限だけを置く箱。テストは自分の suite を差す(既定の suite を共有すると、
  /// 並列で走る別のテストが置いた期限をこちらが読む)。
  @ObservationIgnored let defaults: UserDefaults
  @ObservationIgnored private var buildTask: Task<Void, Never>?

  /// いま書き換え続けている記録の id。1 つの旅は 1 枚の記録で、編集のたびに増やさない
  /// (10 件の枠が 1 回の旅で埋まる)。`reset()` で消える —— 次の旅は次の記録。
  @ObservationIgnored var currentTripId: String?

  /// 待たせてある自動保存。次の変更が来たら破って取り直す(`autosaveDebounce`)。
  @ObservationIgnored var autosaveTask: Task<Void, Never>?

  /// 旅行者の返事を待っている編集の中身。**`view` には置かない** —— `PlannerViewState` は
  /// `Equatable` かつ `Sendable` で、組み上がった旅程(`BuiltPlanBundle`)はそのどちらでも
  /// ないから。あちらが持つのは「何を確認したいのか」だけで、確認が済んだときに実際に
  /// 引き渡すものはここにある(`Store/PlannerStore+Edits.swift`)。
  @ObservationIgnored var pendingApply: PendingGuardedEdit?

  /// 出したトーストを 6 秒後に消す約束。次のトーストが出たら前の約束は破る ——
  /// 破らないと、2 つ目のトーストが 1 つ目の時計で消える。
  @ObservationIgnored var toastDismissTask: Task<Void, Never>?

  /// 組み立ての答えを `commit` へ渡す直前の関所。**テストだけが差す**(`internal` なので
  /// アプリからは見えず、既定の `nil` では 1 度の分岐すら挟まらない)。
  ///
  /// 要るのは、「計算は終わったが、まだ画面へ渡していない」一点が外から掴めないからである。
  /// `buildGeneration` は `build()` の頭で同期に進むので、世代の変化を見ても捕まえられるのは
  /// **組み立てが始まった**ことだけで、答えが返る前かどうかは機械の忙しさ次第になる ——
  /// `swift test --parallel` で実際に、世代を見てから `screen` を読む間に commit が滑り込み、
  /// 取り消しの検査が落ちた。ここで待たせれば、遅れて届く答えを毎回きっかり作れる。
  var buildGate: (@Sendable () async -> Void)?

  // MARK: - 実経路(観測しない。`routeProgress` だけが観測される)

  /// 経路の提供元。`nil` = 今までの挙動(テストと旧来の呼び出しの既定)。
  @ObservationIgnored let routeProvider: (any RouteProvider)?

  /// 回答キャッシュ(ジオメトリも同じ値の中)。**永続化しない・共有しない・Undo に入れない・`view` に
  /// 置かない。** `tripRequest(with:days:)` が `LiveRouteMerge.apply` で折り込む。
  @ObservationIgnored var liveRoutes: [RouteRequest: RouteOutcome] = [:]

  /// 1 回の取得の中で同じ要求を二度立てないための印(`build()` / `reset()` / `cancelBuild()` と、
  /// **深さ 0 の `startRouteEnrichment` すべて**で空になる)。旅程が動いた後まで効かせない ——
  /// 効かせると、測り終える前の編集で残りの要求が「試したが答えが無い」ままになり、
  /// 旅程は推定のまま、進捗の行だけが消える。
  @ObservationIgnored var attemptedRoutes: Set<RouteRequest> = []

  /// `resolveGeneration` と同じ流儀。進んだ後に返ってきた回答は捨てる(キャッシュにも入れない)。
  @ObservationIgnored var routeGeneration = 0

  /// 走っている取得(と、その後ろに続く静かな置換)。**`routeGeneration` を進めた者がこの欄を
  /// 持ち、終わりに世代が変わっていなければ自分で畳む** —— 進めた者が別に居れば、この欄は
  /// もうその者のものなので触らない。
  @ObservationIgnored var routeTask: Task<Void, Never>?

  /// 確認ダイアログが開いていて置換を保留した連鎖の深さ。閉じたときに再開する。
  @ObservationIgnored var deferredRouteReplacement: Int?

  /// 旅行者が頼んだ組み直しのうち、まだ答えが返っていない本数。
  ///
  /// **置換はこれが 0 のときしか始めない。** 組み直す 3 本(`build()` / `applyGuardedEdit` /
  /// `adoptHistoryPresent`)はどれも「`buildGeneration` を進めてから待つ」形で、待っている間に
  /// 置換が割り込んで世代を進めると、返ってきた答えが自分の世代ガードで落ちる —— 旅行者から
  /// 見ると、押したのに何も起きない(トーストも問いかけも出ない)。世代を捕捉するだけでは
  /// 直らない: 捕捉した世代で置換が採用すると、今度は間に入った編集を測る前の旅程で上書きする。
  /// 先に始まった旅行者の一手が勝ち、置換はその後ろに並ぶ(`deferredRouteReplacement`)。
  @ObservationIgnored var rebuildsInFlight = 0

  /// 置換した回数(テストが「1 回だけ」を数えるため)。**トーストの数ではない** ——
  /// 「元に戻す」を差し出しているトーストが画面にあるときは、置換は起きても知らせは出ない
  /// (spec §4.5.5)。
  @ObservationIgnored var routeReplacements = 0

  /// 進捗の表示用値。`view` ではなく store 直下(spec §4.1)。
  public internal(set) var routeProgress: RouteProgress?

  // MARK: - 天気(観測しない。`weatherByDay`/`weatherAttribution` だけが観測される。spec 2026-08-25)

  /// 天気の提供元。`nil` = 今までの挙動(テストと旧来の呼び出しの既定・端末が非対応)。
  @ObservationIgnored let weatherProvider: (any WeatherProviding)?

  /// `routeGeneration` と同じ流儀。進んだ後に返ってきた答えは捨てる。
  @ObservationIgnored var weatherGeneration = 0

  /// 走っている取得。**`weatherGeneration` を進めた者がこの欄を持ち、終わりに世代が変わって
  /// いなければ自分で畳む。**
  @ObservationIgnored var weatherTask: Task<Void, Never>?

  /// 日ごとの天気(表示専用)。`FeasibilityResult` / `PlannerContext` / `verified` には触れない
  /// —— 天気は判定の材料ではなく、画面に添える一言でしかない。
  public internal(set) var weatherByDay: [Int: WeatherDay] = [:]

  /// Apple 必須の帰属。**帰属が無ければ天気そのものを出さない。**
  public internal(set) var weatherAttribution: WeatherAttribution?

  // MARK: - 食事の候補(観測しない。foodRecommendationsBySlot だけが観測される。spec 2026-08-25)
  /// 候補の提供元。nil = 出さない(UI テスト・未構成)。
  @ObservationIgnored let foodRecommendationProvider: (any FoodRecommending)?
  @ObservationIgnored var foodRecommendationGeneration = 0
  @ObservationIgnored var foodRecommendationTasks: [String: Task<Void, Never>] = [:]
  /// 食事枠 id → 候補の状態(表示専用)。
  public internal(set) var foodRecommendationsBySlot: [String: FoodSlotRecommendations] = [:]

  // MARK: - 自由文インテント(spec 2026-08-24)

  /// 聞き取り係。nil = 入口を出さない(非対応端末・従来テスト)。起動時に composition root が決める。
  @ObservationIgnored let intentParser: (any IntentParser)?
  /// 実行中のパース。入力が変わったら世代で無効化し、タスクも畳む。
  @ObservationIgnored var intentTask: Task<IntentOutcome, Never>?
  @ObservationIgnored var intentGeneration = 0
  @ObservationIgnored var intentPrewarmed = false
  /// 行の見た目(待機/読取中/失敗)。View が読むので observable のまま。
  public internal(set) var intentPhase: IntentPhase = .idle

  public init(
    resolvers: [any PlaceResolver],
    store: TripStore?,
    storageDirectory: URL? = nil,
    autosaveDebounce: Duration = .milliseconds(550),
    clock: any Clock<Duration> = ContinuousClock(),
    defaults: UserDefaults = .standard,
    initialLocale: PlannerLocale = .ja,
    routeProvider: (any RouteProvider)? = nil,
    intentParser: (any IntentParser)? = nil,
    weatherProvider: (any WeatherProviding)? = nil,
    foodRecommendationProvider: (any FoodRecommending)? = nil
  ) {
    self.resolvers = resolvers
    self.store = store
    self.routeProvider = routeProvider
    self.intentParser = intentParser
    self.weatherProvider = weatherProvider
    self.foodRecommendationProvider = foodRecommendationProvider
    self.storageDirectory = storageDirectory
    self.autosaveDebounce = autosaveDebounce
    self.clock = clock
    self.defaults = defaults
    // 言語は前に選んだものが勝ち、選んだことが無ければ呼び出し元が渡した既定(`initialLocale`)。
    // `Locale.current` はここでは読まない —— 読むのは合成の根(`TripCheckApp.init`)だけで、
    // そこが `PlannerStore.systemLocale` を `initialLocale` として渡す。ここで読んでいた頃は、
    // `defaults:` を省いた既定の入口(テストが 152 か所使う)がまるごと走らせる機械の言語に
    // 化けていた。
    self.request = TripRequestState.initial(locale: Self.storedLocale(in: defaults) ?? initialLocale)
    self.passportExpiry = defaults.string(forKey: PlannerStore.passportExpiryKey)
    self.storageUnavailable = Self.storageIsUnavailable(at: storageDirectory)
    // 入力と編集の変化を見張り始める。`view`(開閉・選択)は見張らない —— 旅程を眺めて
    // いるだけで記録が書き換わってはいけない。
    watchForAutosave()
  }

  // MARK: - エンジンへの引き渡し

  /// `request` と `edit` と `liveRoutes` を畳んで 1 つの `TripRequest` にする。**`view` は読まない**
  /// —— 見ている日や開いているシートで旅程が変わってはいけないので、この関数が触れる欄を
  /// その 3 つに限る(`liveRoutes` は測った経路そのもので、旅行者の入力でも編集でもない)。
  ///
  /// 日数は `request.tripDays ?? edit.tripDays`:旅行者が名乗った日数が常に勝ち、名乗って
  /// いなければ直近の組み立てが落ち着いた日数を使う。
  public func tripRequest() -> TripRequest {
    tripRequest(with: edit, days: request.tripDays ?? edit.tripDays)
  }

  /// 同じ畳み方を、**まだ採用していない編集**に対して行う。守られた編集(Task 9)は
  /// これで候補の旅程を組み、今の旅程と比べてから旅行者に訊く。
  ///
  /// 日数が `candidate.tripDays` そのものなのは、`edit.tripDays` が組み立てのたびに
  /// 「実際に組み上がった日数」へ追従するため(`adopt`)——つまり候補の日数を書き換え
  /// なければ今の日数がそのまま来るし、書き換えればその日数で候補が組まれる。日数を変える
  /// 編集は `request.tripDays` を**採用が決まった時に**同じ値へ揃える(R6)。
  func tripRequest(with candidate: PlannerEditState) -> TripRequest {
    tripRequest(with: candidate, days: candidate.tripDays)
  }

  private func tripRequest(with edit: PlannerEditState, days: Int) -> TripRequest {
    let raw = WishlistSerialization.raw(from: request.entries, locale: request.locale)
    var ctx = PlannerContext()
    ctx.destination = request.destination
    ctx.tripStartDate = request.tripStartDate
    // 番号は**いまの並び**から押し直す。`ResolvedStop.inputIndex` は場所が決まった時刻の
    // 並びで凍っており(`requestBuildFromStart` / `apply` / `loadSample` が押す)、
    // `TripBuilder` は行と場所をまずその番号で突き合わせる(`Builder/TripBuilder.swift:105-145`
    // の `indexedResolvedStops`)。だから固定された行より**前**の行を 1 つ外すと、以降の
    // 場所は 1 つずつ隣の行に貼り付く —— 最初にずれた行は場所を失ってカタログ送り
    // (`unknownEntries`)になり、最後の場所は旅程から黙って消え、行から読んだ制約
    // (必須・日指定・予約)は別の場所に効く。外す道は Start の行・行編集シート・確認画面の
    // 3 本あり、どれも旅行者が普通に押す。
    //
    // 直すのは渡す一点でよい。番号を持つ写しはここへ来る前に作られるものだけで、共有
    // (`manualPinOverrides()`)も端末内保存(`PersistedTripInput`)も既に**いまの並び**を
    // 数えている。
    ctx.resolvedStops = request.entries.enumerated().compactMap { index, entry in
      guard var stop = entry.pinned?.stop else { return nil }
      stop.inputIndex = index
      return stop
    } + edit.resolvedStops
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
    // 測れた経路を最後に折り込む。答えの無いレグは触られないので、提供元が居ない(あるいは
    // 1 本も返らなかった)ときの旅程は今までと 1 分も変わらない。
    LiveRouteMerge.apply(liveRoutes, to: &ctx)
    return TripRequest(
      raw: raw,
      days: days,
      pace: edit.pace,
      locale: request.locale,
      context: ctx
    )
  }

  // MARK: - 組み立て

  /// 旅程を組む。組んでいる間に入力が変わったら、**先に始まったほうの答えは捨てる** ——
  /// そうしないと、遅く返ってきた古い旅程が新しい入力を上書きして、画面と入力がずれる。
  public func build() async {
    // 旅行者が頼んだ組み直し。終わるまで置換は始まらず、終わったところで並んでいた置換を通す。
    rebuildsInFlight += 1
    defer {
      rebuildsInFlight -= 1
      resumeDeferredRouteReplacement()
    }
    buildTask?.cancel()
    buildGeneration += 1
    // 走っている取得は、これから組む旅程のものではない。キャッシュは残す —— 同じレグを
    // 組み直すだけなら、測った分をもう一度尋ねる必要はない。
    invalidateRoutes(keepCache: true)
    // 天気も同じ理由で世代を進める。この build が commit まで届けば `startWeatherEnrichment()`
    // が測り直す —— 届かなければ(古い世代として捨てられれば)ここで空にしたままでよい。
    invalidateWeather()
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
    await buildGate?()   // 既定は nil = 素通り。テストが「遅れて届く答え」を作るための関所
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
    invalidateRoutes(keepCache: true)
    if view.screen == .building {
      view.screen = bundle == nil ? .start : .plan
    }
  }

  /// 最初から。ロケールだけは端末の設定なので引き継ぐ。
  public func reset() {
    // 読みかけの自由文パースも次の旅へ持ち越さない(`loadSample` / `openTrip` はここを通る)。
    intentQueryChanged()
    cancelBuild()
    // 測った経路も捨てる。次は別の旅で、鍵(座標)が同じでも同じレグとは限らない。
    invalidateRoutes(keepCache: false)
    // 天気も同じく次の旅へ持ち越さない。次の旅は誰も測っていないので、空に戻す。
    invalidateWeather()
    // 飛んでいる問い合わせも同じように捨てる。世代を進めておけば、遅れて届いた場所は
    // `requestBuildFromStart` などのガードで落ちる —— 落とさないと、さっきの旅の答えが
    // 新しい旅の行へ番号で貼り付く。旗を倒すのはここ:返事は捨てるので、倒す役は
    // もう帰って来ない。倒さないと CTA が「調べています」のまま押せなくなる。
    resolveGeneration += 1
    isResolvingPlaces = false
    pendingApply = nil
    toastDismissTask?.cancel()
    toastDismissTask = nil
    // 次の旅は次の記録。待たせてある保存も破る —— さっきの旅の 1 手が、まっさらな入力を
    // 上書きしに来ない(新しい入力は入った時点で自分の保存を取り直す)。
    autosaveTask?.cancel()
    autosaveTask = nil
    currentTripId = nil
    request = TripRequestState.initial(locale: request.locale)
    edit = .empty
    view = PlannerViewState()
    bundle = nil
    history = PlannerHistory(initial: .empty, limit: PlannerEdits.undoLimit)
    // 旅券は**旅ではなく人**に属する。次の旅を作り始めただけで、さっき入れた有効期限を
    // 訊き直さない(`passportCountry` / `passportExpiry` はここで消さない)。
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
  ///
  /// **画面には触らない。** 守られた編集と Undo/Redo(`PlannerStore+Edits.swift`)は
  /// 結果画面に留まったまま旅程だけを差し替えるので、`.building` を挟む `commit` とは
  /// ここで分かれる。
  func adopt(_ bundle: BuiltPlanBundle) {
    self.bundle = bundle
    edit.tripDays = bundle.request.days
    view.selectedDay = min(view.selectedDay, max(0, bundle.plan.days.count - 1))
  }

  private func commit(_ bundle: BuiltPlanBundle) {
    // ずれているかどうかは、**採用する前の `edit`** に対して見る —— 直後の `adopt` が
    // `edit.tripDays` を書き換えるので、後から見ると「ずれていない組み直し」まで
    // ずれて見えてしまう。
    let driftedBeforeAdopt = !historyPointsAtTheCurrentEdit
    adopt(bundle)
    // **台帳を畳むのは、入力が台帳の現在地からずれていたときだけ。** `build()` は関所
    // (`applyGuardedEdit`)を通らない道からも呼ばれる —— ひとつは入力そのものが変わった後
    // (「入力にもどる」で歩く速さを変えて組み直す)、もうひとつは入力を変えずにもう一度
    // 組むだけの再試行(計算量オーバーの警告行「もう一度試す」)。前者は積んである
    // 「1 つ前」がもう存在しないので畳む —— 畳まないと、その Undo は**歩く速さの変更ごと**
    // 捨てて、旅行者が見ていない旅程へ跳ぶ。`reset()` が同じことをしている。後者は `edit` が
    // 1 ミリも動いていないので、守られた編集が積んだ Undo をここで捨てる理由が無い
    // (`applyGuardedEdit` の同じ判定と対になる)。
    if driftedBeforeAdopt {
      history = PlannerHistory(initial: edit, limit: PlannerEdits.undoLimit)
    }
    // `"empty"` は機械が読む語で、旅行者に見せる文ではない(文言は画面側が引く)。
    view.screen = bundle.plan.days.isEmpty ? .error("empty") : .plan
    // `hero` を直に読む(独自に `VerdictCopy.hero` を再度呼ばない) —— 読み上げの 1 文と
    // 画面に出す見出しが**同じ関数呼び出し**から来ないと、`checkCount` を渡し忘れた側だけ
    // 数が違う文になる(`FEASIBLE_IF_ASSUMPTIONS` で実際に起きた)。`self.bundle` は 2 行上で
    // 代入済みなので、この時点で `hero` はもう空文字列を返さない。
    view.announcement = hero.text
    // 画面が出てから測りに行く。返事が揃えば `replaceWithLiveRoutes` が静かに差し替える。
    startRouteEnrichment()
    // 天気も同じ場所で測りに行く。表示専用なので旅程の判定を 1 ミリも動かさない。
    startWeatherEnrichment()
    // 食事の候補も同じ場所で世代を進める。取得は lazy(タップ時)なので、ここでは前の旅程の
    // 候補を捨てるだけ —— 新しい枠は `loadFoodRecommendations(slotId:)` が取りに行く。
    invalidateFoodRecommendations()
  }
}
