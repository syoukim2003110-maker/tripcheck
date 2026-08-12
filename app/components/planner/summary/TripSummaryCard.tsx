"use client";

// Feasibility summary card (spec v2.1 summary/TripSummaryCard): the verdict
// conclusion, minimum-days answer, one primary warning, verdict details
// (trip-day stepper, critical facts, coverage), the existing-itinerary
// comparison, comparable alternatives with before/after diff, assumptions
// and other notices. Emits events; the parent owns plan edits.
import Icon from "../../../PlannerIcons";
import type { AlternativePlan, FeasibilityResult } from "../../../../lib/feasibility-result.ts";
import type { BuiltTripPlan } from "../../../../lib/trip-builder.ts";
import { destinationName, type Destination } from "../../../../lib/destinations.ts";
import type { TripScopeWarning } from "../../../../lib/trip-scope.ts";
import { coveragePublicCopy, isDeepCoverageProfile } from "../../../../lib/coverage-profile.ts";
import { P0_CORE_ONLY, builtPlanTravelMinutes } from "../../../../lib/planner-app-state.ts";
import {
  alternativeCopy,
  alternativeLossCopy,
  assumptionCopy,
  attentionCopy,
  conflictCopy,
  minimumDaysCopy,
  ui,
  type PlannerLocale,
} from "../../../../lib/presentation/planner-copy.ts";

type TripSummaryCardProps = {
  locale: PlannerLocale;
  plan: BuiltTripPlan;
  feasibilityResult: FeasibilityResult;
  resultStateCopy: { label: string; headline: string } | null;
  deferredAnchorStops: ReadonlyArray<{ id: string; name: string }>;
  tripDays: number;
  confirmedRouteFactCount: number;
  routeFactCount: number;
  openingVerificationCount: number;
  regionalCoverage: Parameters<typeof coveragePublicCopy>[0] | null;
  scopeWarnings: ReadonlyArray<TripScopeWarning>;
  tripFit: { days: ReadonlyArray<{ placeCount: number; slackMinutes: number }> } | null;
  comparisonAlternative: AlternativePlan | null;
  placeWarning: "unavailable" | "quota_exhausted" | false;
  hotelStateStatus: "idle" | "loading" | "ready" | "unavailable";
  hotelQuery: string;
  firstStopArea: string | undefined;
  activeDestination: Destination;
  onChangeTripDays: (days: number) => void;
  onCompare: (alternative: AlternativePlan | null) => void;
  onApplyAlternative: (alternative: AlternativePlan) => void;
  onReviewConditions: () => void;
};

export default function TripSummaryCard({
  locale,
  plan,
  feasibilityResult,
  resultStateCopy,
  deferredAnchorStops,
  tripDays,
  confirmedRouteFactCount,
  routeFactCount,
  openingVerificationCount,
  regionalCoverage,
  scopeWarnings,
  tripFit,
  comparisonAlternative,
  placeWarning,
  hotelStateStatus,
  hotelQuery,
  firstStopArea,
  activeDestination,
  onChangeTripDays,
  onCompare,
  onApplyAlternative,
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

        <details className="planner-verdict-details">
          <summary>{locale === "ja" ? "結論の詳細" : "Result details"}</summary>
          <div className="planner-verdict-details-body">

        <div className="planner-trip-days" role="group" aria-label={text.fitSelectedDays}>
          <span>{text.fitSelectedDays}</span>
          <div>
            <button aria-label={text.fitDaysDecrease} disabled={tripDays <= Math.max(1, plan.minimumPinnedDay)} onClick={() => onChangeTripDays(tripDays - 1)} type="button">−</button>
            <output aria-live="polite">{text.fitDaysValue(tripDays)}</output>
            <button aria-label={text.fitDaysIncrease} disabled={tripDays >= 14} onClick={() => onChangeTripDays(tripDays + 1)} type="button">+</button>
          </div>
        </div>

        <div className="planner-critical-facts" aria-label={locale === "ja" ? "重要情報の確認状況" : "Critical fact coverage"}>
          <span><i className="is-verified" aria-hidden="true" /><b>{feasibilityResult.criticalFacts.verified}</b><small>{locale === "ja" ? "確認済み" : "confirmed"}</small></span>
          <span><i className="is-estimated" aria-hidden="true" /><b>{feasibilityResult.criticalFacts.estimated}</b><small>{locale === "ja" ? "推定" : "estimated"}</small></span>
          <span><i className="is-unknown" aria-hidden="true" /><b>{feasibilityResult.criticalFacts.unknown}</b><small>{locale === "ja" ? "未確認" : "unknown"}</small></span>
        </div>
        <p className="planner-route-coverage">
          {locale === "ja"
            ? `重要情報 ${feasibilityResult.criticalFacts.total}件中 ${feasibilityResult.criticalFacts.verified}件を確認。経路 ${confirmedRouteFactCount}/${routeFactCount}区間は取得済みです。`
            : `${feasibilityResult.criticalFacts.verified} of ${feasibilityResult.criticalFacts.total} critical facts confirmed. ${confirmedRouteFactCount}/${routeFactCount} route legs retrieved.`}
        </p>
        {openingVerificationCount > 0 ? (
          <p aria-live="polite" className="planner-progressive-status">
            <i aria-hidden="true" />
            {locale === "ja"
              ? `暫定結果を表示中。最終旅程の営業時間をあと${openingVerificationCount}件確認しています。`
              : `Showing a provisional result while ${openingVerificationCount} final-stop hour check${openingVerificationCount === 1 ? "" : "s"} continue in the background.`}
          </p>
        ) : null}
        {regionalCoverage ? (
          <details className="planner-regional-coverage">
            <summary>
              <span>{locale === "ja" ? "この地域の対応" : "Coverage in this region"}</span>
              <b>{regionalCoverage.label[locale]}</b>
            </summary>
            <div aria-label={locale === "ja" ? "地域別の機能評価" : "Regional capability grades"}>
              {(["routes", "poi", "hours", "transit"] as const).map((dimension) => (
                <span key={dimension}>
                  <small>{locale === "ja"
                    ? { routes: "経路", poi: "地点", hours: "営業時間", transit: "公共交通" }[dimension]
                    : { routes: "Routes", poi: "Places", hours: "Hours", transit: "Transit" }[dimension]}</small>
                  <b>{regionalCoverage.grades[dimension]}</b>
                </span>
              ))}
            </div>
            <p>{coveragePublicCopy(regionalCoverage, locale)}</p>
            {regionalCoverage.lastValidatedAt ? <small>{locale === "ja" ? `地域評価: ${regionalCoverage.lastValidatedAt}` : `Regional review: ${regionalCoverage.lastValidatedAt}`}</small> : null}
          </details>
        ) : null}

        {plan.inputMode === "existing_itinerary" ? (() => {
          const shortest = feasibilityResult.alternatives.find((alternative) => alternative.kind === "OPTIMIZE_ORDER") ?? null;
          const repairRank = (kind: AlternativePlan["kind"]) => ({
            START_EARLIER: 0,
            END_LATER: 1,
            CHANGE_MODE: 2,
            CHANGE_DAYS: 3,
            CHANGE_BASE: 4,
            REMOVE_OPTIONAL: 5,
            OPTIMIZE_ORDER: 6,
          })[kind];
          const corrective = feasibilityResult.alternatives
            .filter((alternative) => alternative.kind !== "OPTIMIZE_ORDER")
            .sort((left, right) => repairRank(left.kind) - repairRank(right.kind) || left.id.localeCompare(right.id));
          const completeRepair = corrective.find((alternative) => (
            alternative.after.hardConflictCount === 0 && alternative.after.overrunMinutes === 0
          )) ?? null;
          const minimal = completeRepair ?? corrective[0] ?? null;
          const minimalIsRepair = Boolean(completeRepair);
          const populated = tripFit?.days.filter((fitDay) => fitDay.placeCount > 0) ?? [];
          const currentMetrics = {
            hardConflictCount: plan.scheduleConflictCount + plan.deferredUnavailableStops.length,
            minimumSlackMinutes: populated.length > 0 ? Math.min(...populated.map((fitDay) => fitDay.slackMinutes)) : null,
            // The same shared computation the headline stats line uses.
            travelMinutes: builtPlanTravelMinutes(plan),
          };
          const cards = [
            {
              key: "original",
              label: locale === "ja" ? "元の案" : "Original",
              detail: locale === "ja" ? "入力した日別割当と順番" : "Pasted days and order",
              metrics: currentMetrics,
              alternative: null,
            },
            {
              key: "minimal",
              label: minimalIsRepair
                ? (locale === "ja" ? "最小修正版" : "Minimal revision")
                : (locale === "ja" ? "最小の改善案" : "Smallest improvement"),
              detail: minimal
                ? alternativeCopy(minimal, locale).title
                : currentMetrics.hardConflictCount === 0
                  ? (locale === "ja" ? "必要な修正はありません" : "No corrective change needed")
                  : (locale === "ja" ? "1回の変更で成立する案はまだありません" : "No one-change repair is available yet"),
              metrics: minimal?.after ?? currentMetrics,
              alternative: minimal,
            },
            {
              key: "shortest",
              label: locale === "ja" ? "移動を減らす案" : "Lower-travel order",
              detail: shortest ? alternativeCopy(shortest, locale).title : (locale === "ja" ? "固定条件内で、より移動の少ない案は見つかりませんでした" : "No lower-travel alternative was found within the fixed constraints"),
              metrics: shortest?.after ?? currentMetrics,
              alternative: shortest,
            },
          ];
          return (
            <section className="planner-existing-comparison" aria-labelledby="planner-existing-comparison-title">
              <header><span>{locale === "ja" ? "既存旅程モード" : "Existing itinerary mode"}</span><b id="planner-existing-comparison-title">{locale === "ja" ? "3つの見方を比較" : "Compare three views"}</b></header>
              <div>
                {cards.map((card) => (
                  <article className={card.key === "original" ? "is-current" : ""} key={card.key}>
                    <span>{card.label}</span><b>{card.detail}</b>
                    <dl>
                      <div><dt>{locale === "ja" ? "衝突" : "Conflicts"}</dt><dd>{card.metrics.hardConflictCount}</dd></div>
                      <div><dt>{locale === "ja" ? "移動" : "Travel"}</dt><dd>{card.metrics.travelMinutes}{locale === "ja" ? "分" : " min"}</dd></div>
                      <div><dt>{locale === "ja" ? "最小余白" : "Min slack"}</dt><dd>{card.metrics.minimumSlackMinutes === null ? "—" : `${card.metrics.minimumSlackMinutes}${locale === "ja" ? "分" : " min"}`}</dd></div>
                    </dl>
                    {card.alternative ? <button onClick={() => onCompare(card.alternative)} type="button">{locale === "ja" ? "差分を見る" : "Review diff"}</button> : <small>{locale === "ja" ? "現在" : "Current"}</small>}
                  </article>
                ))}
              </div>
            </section>
          );
        })() : null}

        {feasibilityResult.alternatives.length > 0 ? (
          <details className="planner-alternatives" open={comparisonAlternative ? true : undefined}>
            <summary><span><b id="planner-alternatives-title">{locale === "ja" ? "比較できる変更案" : "Comparable changes"}</b><small>{locale === "ja" ? "差分を確認してから適用" : "Compare before applying"}</small></span><em>{feasibilityResult.alternatives.length}</em></summary>
            <div>
              {feasibilityResult.alternatives.map((alternative) => {
                const copy = alternativeCopy(alternative, locale);
                return (
                  <button
                    aria-pressed={comparisonAlternative?.id === alternative.id}
                    key={alternative.id}
                    onClick={() => onCompare(alternative)}
                    type="button"
                  >
                    <span><b>{copy.title}</b><small>{copy.detail}</small></span><Icon name="arrow" size={14} />
                  </button>
                );
              })}
            </div>
            {comparisonAlternative ? (() => {
              const copy = alternativeCopy(comparisonAlternative, locale);
              const metric = (value: number | null, suffix = "") => value === null ? "—" : `${value}${suffix}`;
              return (
                <section aria-live="polite" className="planner-comparison" aria-labelledby="planner-comparison-title">
                  <header><span id="planner-comparison-title">{locale === "ja" ? "変更前と変更後" : "Before and after"}</span><b>{copy.title}</b></header>
                  <div>
                    {[
                      { label: locale === "ja" ? "現在の案" : "Current plan", metrics: comparisonAlternative.before },
                      { label: locale === "ja" ? "変更案" : "Proposed plan", metrics: comparisonAlternative.after },
                    ].map((column) => (
                      <article key={column.label}>
                        <h3>{column.label}</h3>
                        <dl>
                          <div><dt>{locale === "ja" ? "重大な衝突" : "Hard conflicts"}</dt><dd>{column.metrics.hardConflictCount}</dd></div>
                          <div><dt>{locale === "ja" ? "超過" : "Overrun"}</dt><dd>{metric(column.metrics.overrunMinutes, locale === "ja" ? "分" : " min")}</dd></div>
                          <div><dt>{locale === "ja" ? "最小余白" : "Minimum slack"}</dt><dd>{metric(column.metrics.minimumSlackMinutes, locale === "ja" ? "分" : " min")}</dd></div>
                          <div><dt>{locale === "ja" ? "訪問数 / 日数" : "Visits / days"}</dt><dd>{column.metrics.scheduledStopCount} / {column.metrics.dayCount}</dd></div>
                          <div><dt>{locale === "ja" ? "移動" : "Travel"}</dt><dd>{metric(column.metrics.travelMinutes, locale === "ja" ? "分" : " min")}</dd></div>
                        </dl>
                      </article>
                    ))}
                  </div>
                  <p>{copy.detail}</p>
                  {comparisonAlternative.loss ? <p className="is-loss">{alternativeLossCopy(comparisonAlternative, locale)}</p> : null}
                  <footer>
                    <button onClick={() => onCompare(null)} type="button">{locale === "ja" ? "戻る" : "Cancel"}</button>
                    <button className="is-apply" onClick={() => onApplyAlternative(comparisonAlternative)} type="button">{locale === "ja" ? "この変更を適用" : "Apply this change"}</button>
                  </footer>
                </section>
              );
            })() : null}
          </details>
        ) : null}

        <details className="planner-plan-assumptions">
          <summary>{locale === "ja" ? `この結論の前提 ${feasibilityResult.assumptions.length}件` : `${feasibilityResult.assumptions.length} assumptions behind this result`}</summary>
          <ul>
            {feasibilityResult.assumptions.map((assumption) => <li key={assumption.code}>{assumptionCopy(assumption, locale)}</li>)}
            {feasibilityResult.assumptions.length === 0 ? <li>{locale === "ja" ? "重要な前提はすべて確認済みです。" : "All critical assumptions are confirmed."}</li> : null}
          </ul>
        </details>

        {placeWarning || (!P0_CORE_ONLY && hotelStateStatus === "unavailable") || plan.overCapacityCount > 0 || plan.deferredUnavailableStops.length > 0 || plan.deferredOptionalStops.length > 0 ? (
          <details className="planner-plan-notices">
            <summary>
              <span aria-hidden="true">!</span>
              {locale === "ja" ? "その他の注意" : "Other notices"}
            </summary>
            <div>
              {placeWarning ? (
                <p>
                  {plan.unknownEntries.length > 0
                    ? locale === "ja"
                      ? `${placeWarning === "quota_exhausted" ? "場所検索が本日の上限に達したため" : "位置情報サービスに接続できず"}、${plan.unknownEntries.length}件（${plan.unknownEntries.slice(0, 3).join("・")}${plan.unknownEntries.length > 3 ? " ほか" : ""}）が未解決のままです。時間をおいて作り直すか、入力にもどって確認してください。`
                      : `${placeWarning === "quota_exhausted" ? "Place search hit its allowance" : "Place lookup failed"}, so ${plan.unknownEntries.length} entr${plan.unknownEntries.length === 1 ? "y" : "ies"} (${plan.unknownEntries.slice(0, 3).join(", ")}${plan.unknownEntries.length > 3 ? ", …" : ""}) stayed unresolved. Rebuild later or go back to the input to settle them.`
                    : text.placeFallback}
                </p>
              ) : null}
              {!P0_CORE_ONLY && hotelStateStatus === "unavailable" ? (
                <p>{text.hotelUnavailable}{" "}<a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${hotelQuery.trim() || firstStopArea || destinationName(activeDestination, locale)} ${locale === "ja" ? "ホテル" : "hotels"}`)}`} rel="noreferrer" target="_blank">{text.hotelSearch} ↗</a></p>
              ) : null}
              {plan.overCapacityCount > 0 ? <p>{text.overCapacity}</p> : null}
              {plan.deferredUnavailableStops.length > 0 || plan.deferredOptionalStops.length > 0 ? (
                <div className="planner-excluded">
                  <b>{text.excludedHeading} · {plan.deferredUnavailableStops.length + plan.deferredOptionalStops.length}</b>
                  <ul>
                    {plan.deferredUnavailableStops.map((stop) => <li key={stop.id}><b>{stop.name}</b><small> — {text.excludedClosed}</small></li>)}
                    {plan.deferredOptionalStops.map((stop) => <li key={stop.id}><b>{stop.name}</b><small> — {text.excludedPace}</small></li>)}
                  </ul>
                </div>
              ) : null}
            </div>
          </details>
        ) : null}

          </div>
        </details>

      </section>
    </>
  );
}
