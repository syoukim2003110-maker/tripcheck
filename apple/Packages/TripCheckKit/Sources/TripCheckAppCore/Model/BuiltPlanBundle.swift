import Foundation
import TripCheckKit

/// 1 回の組み立てが出したものの全部 —— 何を頼んだか(`request`)から、組み上がった旅程・
/// 収まり具合・物証・結論・比較できる変更案・日ごとの空きまで。
///
/// 1 つの値にまとめてあるのは、画面がこれらを**混ぜて**読むから: 結論の見出しは
/// `result` と `fit` と `plan` の 3 つから作られ、代替案の差分は `counterfactuals` と
/// `result.alternatives` の同じ要素を指す。別々に置くと「どの旅程に対する結論か」が
/// 崩れうる。差し替えは常に丸ごと(`PlannerStore.commit`)。
public struct BuiltPlanBundle: Sendable {
  public var request: TripRequest
  public var plan: BuiltTripPlan
  public var fit: TripFitAssessment
  public var evidence: PlannerEvidenceSnapshot
  public var result: FeasibilityResult
  public var counterfactuals: [TripCounterfactual]
  /// 0 始まりの日 → その日のいちばん大きな空き。空きの無い日は欄ごと無い。
  public var gaps: [Int: ItineraryGap]
  public var builtAt: Date

  public init(
    request: TripRequest,
    plan: BuiltTripPlan,
    fit: TripFitAssessment,
    evidence: PlannerEvidenceSnapshot,
    result: FeasibilityResult,
    counterfactuals: [TripCounterfactual],
    gaps: [Int: ItineraryGap],
    builtAt: Date
  ) {
    self.request = request
    self.plan = plan
    self.fit = fit
    self.evidence = evidence
    self.result = result
    self.counterfactuals = counterfactuals
    self.gaps = gaps
    self.builtAt = builtAt
  }
}
