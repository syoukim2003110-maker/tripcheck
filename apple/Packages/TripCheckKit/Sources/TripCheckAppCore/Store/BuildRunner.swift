import Foundation
import TripCheckKit

/// 1 つの `TripRequest` から 1 つの `BuiltPlanBundle` を作る純関数。時計にも通信にも触らない
/// (`now` は引数)ので、どのスレッドで走らせても同じ答えになる —— `PlannerStore.build()` が
/// これを `Task.detached` に投げられるのはそのため。
public enum BuildRunner {

  /// spec §3.3: このアプリの live 経路は Apple 由来。Kit の既定(`nil` = google)は Web と
  /// フィクスチャのもので、こちらは端末の MapKit が測った分数に付く出典である。
  public static let liveRouteSource: EvidenceSource = .apple

  /// Kit の検証済みパイプライン。**順序に意味がある**:
  ///
  /// 1. `TripBuilder.build` —— 旅程そのもの。
  /// 2. `TripScenarios.assessTripFit` —— 収まるかどうかと、収まる最小日数。
  /// 3. `Feasibility.snapshot` —— 何を根拠に言っているかの一覧。`solverTimedOut` を省くと
  ///    `COMPUTATION_LIMIT`(探索が時間切れで結論を出せなかった)が消えて、結論が
  ///    実際より確かに見えてしまう。
  /// 4. `TripScenarios.counterfactuals` —— 比較できる変更案。
  /// 5. `Feasibility.derive(alternatives:)` —— 結論。`alternatives` は
  ///    `FeasibilityResult.alternatives` の**唯一の供給元**なので、4 を先に計算する。
  /// 6. 日ごとの `GapDetection` —— 空き時間。
  public static func run(
    _ request: TripRequest,
    options: TripFitSearchOptions = TripFitSearchOptions(),
    now: Date = Date()
  ) -> BuiltPlanBundle {
    let ctx = request.context
    let plan = TripBuilder.build(request)
    let fit = TripScenarios.assessTripFit(request, plan: plan, options: options)
    let evidence = Feasibility.snapshot(plan: plan, options: EvidenceSnapshotOptions(
      dateWasProvided: ctx.tripStartDate != nil,
      baseWasProvided: ctx.resolvedBase != nil,
      dayEndWasProvided: ctx.dayEndTarget != nil,
      userDurationStopIds: ctx.durationOverrides.map { Array($0.keys) },
      capturedAt: Feasibility.nowISO8601(now),
      solverTimedOut: fit.solverTimedOut,
      transferBufferMinutes: ctx.transferBufferMinutes,
      dayStartTimes: ctx.dayStartTimes,
      dayEndTimes: ctx.dayEndTimes,
      liveRouteSource: liveRouteSource
    ))
    let counterfactuals = TripScenarios.counterfactuals(request, plan: plan, fit: fit, options: options)
    // `AlternativePlan` は `TripCounterfactual` の別名(Feasibility/FeasibilityTypes.swift:111)。
    let result = Feasibility.derive(plan: plan, fit: fit, evidence: evidence, alternatives: counterfactuals)
    var gaps: [Int: ItineraryGap] = [:]
    for (index, day) in plan.days.enumerated() where index < fit.days.count {
      gaps[index] = GapDetection.primaryGap(GapDetection.detect(
        day: day,
        fitDay: fit.days[index],
        options: BuiltDayGapOptions(dayIndex: index, transferBufferMinutes: ctx.transferBufferMinutes)
      ))
    }
    return BuiltPlanBundle(
      request: request,
      plan: plan,
      fit: fit,
      evidence: evidence,
      result: result,
      counterfactuals: counterfactuals,
      gaps: gaps,
      builtAt: now
    )
  }
}
