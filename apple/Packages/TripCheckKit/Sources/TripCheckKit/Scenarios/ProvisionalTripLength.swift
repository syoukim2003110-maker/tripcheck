import Foundation

/*
 * 「この旅は何日か」と「どこから出発するのか」を**一緒に**決める層。
 *
 * lib/provisional-trip-length.ts(93 行)全体。`clampTripDays`(`lib/planner-app-state.ts:198-200`)と
 * `provisionalBaseAsResolved`(`lib/planner-app-state.ts:597-603`)もここに置く —— TS ではアプリの
 * 状態モジュールにあるが、この不動点ループ以外から呼ばれていない。
 */
public enum ProvisionalTripLength {

  /// TS `PROVISIONAL_TRIP_LENGTH_ROUNDS` (`lib/provisional-trip-length.ts:31`)
  public static let maxRounds = 3

  /// TS `clampTripDays` (`lib/planner-app-state.ts:198-200`)。TS の `Math.round` は Swift の
  /// `days: Int` では恒等。
  public static func clampTripDays(_ value: Int) -> Int {
    min(EngineConstants.tripDaysRange.upperBound, max(EngineConstants.tripDaysRange.lowerBound, value))
  }

  /// TS `provisionalBaseAsResolved` (`lib/planner-app-state.ts:597-603`)。TS の `{ ...base }` は
  /// `TripBase` の `query` も運ぶが `ResolvedInputStop` は読まないので、`RouteStop` 部分だけを写す。
  public static func provisionalBaseAsResolved(_ base: TripBase) -> ResolvedStop {
    ResolvedStop(
      routeStop: base.routeStop,
      input: base.query.isEmpty ? base.name : base.query,
      address: base.area
    )
  }

  /// TS `ProvisionalTripLength` (`lib/provisional-trip-length.ts:33-40`)。ブリーフの Interfaces は
  /// `(days, base, rounds)` の 3 つだけを挙げるが、TS は `plan` と `settled` も返す —— 呼び出し側が
  /// 「合意した組から実際に組んだ計画」をそのまま受け取れることがこの型の要点なので、TS を採る。
  public struct Resolution: Sendable {
    public var days: Int
    public var base: ResolvedStop?
    public var plan: BuiltTripPlan
    /// 打ち切られる前に自己整合な組に届いたときだけ true。
    public var settled: Bool
    public var rounds: Int

    public init(days: Int, base: ResolvedStop?, plan: BuiltTripPlan, settled: Bool, rounds: Int) {
      self.days = days
      self.base = base
      self.plan = plan
      self.settled = settled
      self.rounds = rounds
    }
  }

  /// TS `resolveProvisionalTripLength` (`lib/provisional-trip-length.ts:42-93`)。
  ///
  /// 旅行者がホテルを打っていない旅も決定的な仮の拠点を通って走り、そのために毎日の往復 2 レグを
  /// 払う。最短日数の探索がその拠点が生まれる**前**に走っていたころ、09:00–16:00 の窓に東京 3 件を
  /// 置いた旅は「1 日で足ります」と言われ、その直後に組まれた計画 —— 75 分のホテル移動を背負った
  /// もの —— が 45 分の超過と 2 日の最短を報告した。提案と結果が 1 画面の中で矛盾していた。
  ///
  /// 日数と拠点は相互依存する:日が増えれば停留所が散り、推薦エリアが動き、毎日の移動レグが変わる。
  /// 下のループはその組に対する**有界の不動点**。プロバイダ呼び出しは一切なく、最後のラウンドが
  /// 合意した組がそのまま組まれる。
  ///
  /// TS の `contextFor` / `resolvedHotel` / `daysUndecided` は既定値つきで残してある。既定の
  /// `contextFor` は「`request.context` の `resolvedBase` だけを差し替える」で、TS のテストが渡す
  /// クロージャと同じ働きをする。
  public static func resolve(
    request: TripRequest,
    daysUndecided: Bool = true,
    resolvedHotel: ResolvedStop? = nil,
    contextFor: ((ResolvedStop?) -> PlannerContext)? = nil,
    recommendBase: (BuiltTripPlan) -> ResolvedStop? = { plan in
      plan.baseRecommendations.first.map { provisionalBaseAsResolved($0.base) }
    }
  ) -> Resolution {
    let context = contextFor ?? { base in
      var next = request.context
      next.resolvedBase = base
      return next
    }
    func build(_ days: Int, _ base: ResolvedStop?) -> BuiltTripPlan {
      TripBuilder.build(TripRequest(raw: request.raw, days: days, pace: request.pace, locale: request.locale, context: context(base)))
    }
    // TS `baseFor` (`:53-57`) — 旅行者自身のホテルが常に勝つ。
    func baseFor(_ candidate: BuiltTripPlan) -> ResolvedStop? {
      resolvedHotel ?? recommendBase(candidate)
    }

    var days = request.days
    var base = baseFor(build(days, resolvedHotel))
    // 旅行者が長さを名乗ったならそれは彼らのもの。導かれるのは拠点だけで、計画はそこから組み直す
    // ——下流が「日数を測っていない文脈」を見ることがないように。
    if !daysUndecided {
      return Resolution(days: days, base: base, plan: build(days, base), settled: true, rounds: 0)
    }

    var settled = false
    var rounds = 0
    for round in 0..<maxRounds {
      rounds = round + 1
      let fit = TripScenarios.assessTripFit(
        TripRequest(raw: request.raw, days: days, pace: request.pace, locale: request.locale, context: context(base))
      )
      let proposed = fit.minimumDays ?? fit.partialMinimumDays
      let nextDays = proposed.map(clampTripDays) ?? days
      let nextBase = baseFor(build(nextDays, base))
      settled = nextDays == days && nextBase?.id == base?.id
      days = nextDays
      base = nextBase
      if settled { break }
    }

    return Resolution(
      days: days,
      base: base,
      // 最後のラウンドで拠点が動いていることがある。実際に合意した組から組み直して、計画と日数が
      // 同じ文脈を共有するようにする。
      plan: build(days, base),
      settled: settled,
      rounds: rounds
    )
  }
}
