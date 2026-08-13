"use client";

// Feasibility summary strip (spec v2.1 summary/TripSummaryCard): the verdict
// conclusion, the minimum-days answer, one primary warning and the single
// action that follows from the cause. Emits events; the parent owns plan
// edits. The evidence behind the conclusion lives in VerdictDetails, under
// the itinerary — docs/product.md is explicit that it is not a dashboard
// placed before it.
import Icon from "../../../PlannerIcons";
import type { FeasibilityResult } from "../../../../lib/feasibility-result.ts";
import type { TripScopeWarning } from "../../../../lib/trip-scope.ts";
import { coveragePublicCopy, isDeepCoverageProfile } from "../../../../lib/coverage-profile.ts";
import {
  attentionCopy,
  conflictCopy,
  minimumDaysCopy,
  ui,
  type PlannerLocale,
} from "../../../../lib/presentation/planner-copy.ts";

type TripSummaryCardProps = {
  locale: PlannerLocale;
  feasibilityResult: FeasibilityResult;
  resultStateCopy: { label: string; headline: string } | null;
  deferredAnchorStops: ReadonlyArray<{ id: string; name: string }>;
  regionalCoverage: Parameters<typeof coveragePublicCopy>[0] | null;
  scopeWarnings: ReadonlyArray<TripScopeWarning>;
  onReviewConditions: () => void;
};

export default function TripSummaryCard({
  locale,
  feasibilityResult,
  resultStateCopy,
  deferredAnchorStops,
  regionalCoverage,
  scopeWarnings,
  onReviewConditions,
}: TripSummaryCardProps) {
  const text = ui[locale];
  return (
    <>
      <p aria-atomic="true" aria-live="polite" className="sr-only">
        {resultStateCopy?.headline}. {feasibilityResult.criticalFacts.verified} of {feasibilityResult.criticalFacts.total} critical facts confirmed.
        {feasibilityResult.primaryConflict ? ` ${conflictCopy(feasibilityResult.primaryConflict, locale)}` : ""}
      </p>
      <section className={`planner-feasibility-card is-${feasibilityResult.state.toLowerCase()}`} aria-labelledby="planner-feasibility-title">
        <header className="planner-result-decision">
          <div>
            <span id="planner-feasibility-title">{locale === "ja" ? "旅程の結論" : "Plan result"}</span>
            <small>{minimumDaysCopy(feasibilityResult, locale)}</small>
          </div>
          {/* TC-004: the card's one action follows the cause. A computation-cap
              UNKNOWN cannot be answered by confirming places — its action is
              the issue card's "remove optional places". */}
          {(() => {
            const computationLimited = feasibilityResult.state === "UNKNOWN"
              && feasibilityResult.unknownCause === "COMPUTATION_LIMIT";
            const reviewable = !computationLimited
              && (feasibilityResult.state === "UNKNOWN" || feasibilityResult.state === "FEASIBLE_IF_ASSUMPTIONS");
            return (
              <button
                onClick={() => {
                  if (feasibilityResult.state === "INFEASIBLE_HARD_CONFLICT") {
                    document.getElementById("planner-alternatives-title")?.scrollIntoView({ behavior: "smooth", block: "center" });
                    return;
                  }
                  if (computationLimited) {
                    document.getElementById("planner-issues-title")?.scrollIntoView({ behavior: "smooth", block: "center" });
                    return;
                  }
                  if (reviewable) {
                    onReviewConditions();
                    return;
                  }
                  document.querySelector(".planner-day-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                type="button"
              >{locale === "ja"
                ? feasibilityResult.state === "INFEASIBLE_HARD_CONFLICT" ? "直し方を見る" : computationLimited ? "減らし方を見る" : reviewable ? "確認する" : "このプランを見る"
                : feasibilityResult.state === "INFEASIBLE_HARD_CONFLICT" ? "See how to fix it" : computationLimited ? "See what to remove" : reviewable ? "Review details" : "View this plan"}</button>
            );
          })()}
        </header>

        {feasibilityResult.primaryConflict || deferredAnchorStops.length > 0 || feasibilityResult.primaryAttention ? (
          <p className="planner-one-warning">
            <Icon name="signal" size={14} />
            <span>{feasibilityResult.primaryConflict
              ? conflictCopy(feasibilityResult.primaryConflict, locale)
              : deferredAnchorStops.length > 0
                ? locale === "ja"
                  ? `${deferredAnchorStops.slice(0, 2).map((stop) => stop.name).join("、")}${deferredAnchorStops.length > 2 ? `ほか${deferredAnchorStops.length - 2}件` : ""}は、現在の条件では日程に入りません。`
                  : `${deferredAnchorStops.slice(0, 2).map((stop) => stop.name).join(", ")}${deferredAnchorStops.length > 2 ? ` and ${deferredAnchorStops.length - 2} more` : ""} do not fit the current plan.`
              : attentionCopy(feasibilityResult.primaryAttention!, locale)}</span>
          </p>
        ) : null}

        {/* Copy Deck scope.beta: a small always-visible one-liner for
            non-deep coverage regions only; the per-capability detail stays
            inside the coverage disclosure below. Deep regions show nothing. */}
        {regionalCoverage && !isDeepCoverageProfile(regionalCoverage) ? (
          <p className="planner-beta-region">{text.betaRegion}</p>
        ) : null}

        {/* TC-062: deterministic scope warnings when the trip leaves the
            supported territory (border crossing, multiple time zones, ferry
            evidence). One short line per triggered case in the scope.beta
            badge family; nothing renders otherwise and planning never blocks. */}
        {scopeWarnings.map((warning) => (
          <p className="planner-scope-warning" key={warning.kind}>
            {warning.kind === "border" ? text.scopeBorder : warning.kind === "timezone" ? text.scopeTimezone : text.scopeFerry}
          </p>
        ))}
      </section>
    </>
  );
}
