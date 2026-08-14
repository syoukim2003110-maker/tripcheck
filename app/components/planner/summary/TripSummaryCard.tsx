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
      {/* v3.1 §6.2: what sits between the headline and the day rail is what
          decides whether the traveller's own itinerary is the first thing they
          see. This card used to open with the label 「旅程の結論」 — which the
          headline above has already said — over two lines of arithmetic
          (「09:00–22:00・拠点…・移動ごと10分の余白では、最短3日です」). That is
          the basis for the verdict, not the verdict, and it belongs behind a
          question. What stays on the surface is the one warning, and the one
          action that answers it; the arithmetic moved under the itinerary it
          explains, into 結論の詳細, where docs/product.md already puts the
          evidence behind the verdict. */}
      <section className={`planner-feasibility-card is-${feasibilityResult.state.toLowerCase()}`} aria-label={locale === "ja" ? "旅程の結論" : "Plan result"}>
        {(() => {
          // TC-004: the card's one action follows the cause. A computation-cap
          // UNKNOWN cannot be answered by confirming places — its action is
          // the issue card's "remove optional places".
          const computationLimited = feasibilityResult.state === "UNKNOWN"
            && feasibilityResult.unknownCause === "COMPUTATION_LIMIT";
          const reviewable = !computationLimited
            && (feasibilityResult.state === "UNKNOWN" || feasibilityResult.state === "FEASIBLE_IF_ASSUMPTIONS");
          const warning = feasibilityResult.primaryConflict || deferredAnchorStops.length > 0 || feasibilityResult.primaryAttention;
          // A plan with nothing to fix gets no button: the old fallback only
          // scrolled to the day rail sitting directly below it.
          const actionable = feasibilityResult.state === "INFEASIBLE_HARD_CONFLICT" || computationLimited || reviewable;
          if (!warning && !actionable) return null;
          return (
            <header className="planner-result-decision">
              {warning ? (
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
              ) : <span />}
              {actionable ? (
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
                    onReviewConditions();
                  }}
                  type="button"
                >{locale === "ja"
                  ? feasibilityResult.state === "INFEASIBLE_HARD_CONFLICT" ? "直し方を見る" : computationLimited ? "減らし方を見る" : "確認する"
                  : feasibilityResult.state === "INFEASIBLE_HARD_CONFLICT" ? "See how to fix it" : computationLimited ? "See what to remove" : "Review details"}</button>
              ) : null}
            </header>
          );
        })()}


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
