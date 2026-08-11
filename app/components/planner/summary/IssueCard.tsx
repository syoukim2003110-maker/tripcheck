"use client";

// Things-to-check card (spec v2.1 summary/): unresolved entries, country
// conflicts, ambiguous places, deferred anchors, unknown hours and provider
// warnings - each with its one next action. Emits events only.
import { destinationName, type Destination } from "../../../../lib/destinations.ts";
import type { BuiltTripPlan } from "../../../../lib/trip-builder.ts";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";

type IssueCardProps = {
  locale: PlannerLocale;
  plan: BuiltTripPlan;
  planIssueCount: number;
  conflictingDestinations: readonly Destination[];
  ambiguousIssuePlaces: ReadonlyArray<{ input: string; candidates: readonly unknown[] }>;
  deferredAnchorStops: ReadonlyArray<{ id: string; name: string }>;
  unknownHoursStops: ReadonlyArray<{ id: string; name: string }>;
  /** v1.1 TC-004: the feasibility check hit its computation cap (LIMIT). */
  computationLimited: boolean;
  placeWarning: "unavailable" | "quota_exhausted" | false;
  onFixInput: () => void;
  onPickAmbiguous: () => void;
  onChooseCountry: (destinationId: Destination["id"]) => void;
  onOpenStop: (stopId: string) => void;
  onRetryBuild: () => void;
};

export default function IssueCard({
  locale,
  plan,
  planIssueCount,
  conflictingDestinations,
  ambiguousIssuePlaces,
  deferredAnchorStops,
  unknownHoursStops,
  computationLimited,
  placeWarning,
  onFixInput,
  onPickAmbiguous,
  onChooseCountry,
  onOpenStop,
  onRetryBuild,
}: IssueCardProps) {
  return (
    <section aria-labelledby="planner-issues-title" className="planner-issue-card" id="planner-issue-card">
      <b id="planner-issues-title">{locale === "ja" ? `確認したいこと ${planIssueCount}` : `${planIssueCount} thing${planIssueCount === 1 ? "" : "s"} to check`}</b>
      <ul>
        {plan.unknownEntries.slice(0, 3).map((entry) => (
          <li key={`unresolved-${entry}`}>
            <span>{locale === "ja" ? `「${entry}」が見つかりません` : `“${entry}” was not found`}</span>
            <button onClick={onFixInput} type="button">{locale === "ja" ? "入力を確認" : "Fix the input"}</button>
          </li>
        ))}
        {plan.unknownEntries.length > 3 ? (
          <li key="unresolved-more">
            <span>{locale === "ja" ? `ほか${plan.unknownEntries.length - 3}件が未解決です` : `${plan.unknownEntries.length - 3} more entries are unresolved`}</span>
            <button onClick={onFixInput} type="button">{locale === "ja" ? "入力を確認" : "Fix the input"}</button>
          </li>
        ) : null}
        {conflictingDestinations.length > 0 ? (
          <li className="planner-issue-country" key="country-conflict">
            <span>{locale === "ja"
              ? `場所が${conflictingDestinations.map((profile) => destinationName(profile, locale)).join("と")}にまたがっています。主な行き先を選ぶと精度が上がります`
              : `Your places span ${conflictingDestinations.map((profile) => destinationName(profile, locale)).join(" and ")}. Choosing the main country improves accuracy`}</span>
            <span className="planner-issue-country-choices">
              {conflictingDestinations.slice(0, 3).map((profile) => (
                <button
                  key={profile.id}
                  onClick={() => onChooseCountry(profile.id)}
                  type="button"
                >{destinationName(profile, locale)}</button>
              ))}
            </span>
          </li>
        ) : null}
        {ambiguousIssuePlaces.slice(0, 3).map((entry) => (
          <li key={`ambiguous-${entry.input}`}>
            <span>{locale === "ja"
              ? `「${entry.input}」に候補が${Math.min(entry.candidates.length, 3)}件あります`
              : `“${entry.input}” matched ${Math.min(entry.candidates.length, 3)} places`}</span>
            <button onClick={onPickAmbiguous} type="button">{locale === "ja" ? "1件を選ぶ" : "Pick one"}</button>
          </li>
        ))}
        {deferredAnchorStops.slice(0, 3).map((stop) => (
          <li key={`deferred-${stop.id}`}>
            <span>{locale === "ja" ? `「${stop.name}」が${plan.requestedDays}日に入りません` : `“${stop.name}” does not fit in ${plan.requestedDays} day${plan.requestedDays === 1 ? "" : "s"}`}</span>
            <button onClick={() => document.getElementById("planner-alternatives-title")?.scrollIntoView({ behavior: "smooth", block: "center" })} type="button">{locale === "ja" ? "直し方を見る" : "See how to fix it"}</button>
          </li>
        ))}
        {unknownHoursStops.length > 0 ? (
          <li key="hours">
            {/* Copy Deck data.checkhours is the standard unverified-hours
                phrasing; the affected places stay as the parameter. */}
            <span>{locale === "ja"
              ? `${ui.ja.checkHours} — ${unknownHoursStops.length}件（${unknownHoursStops.slice(0, 2).map((stop) => stop.name).join("・")}${unknownHoursStops.length > 2 ? " ほか" : ""}）`
              : `${ui.en.checkHours} — ${unknownHoursStops.length} place${unknownHoursStops.length === 1 ? "" : "s"} (${unknownHoursStops.slice(0, 2).map((stop) => stop.name).join(", ")}${unknownHoursStops.length > 2 ? ", …" : ""})`}</span>
            <button onClick={() => onOpenStop(unknownHoursStops[0].id)} type="button">{locale === "ja" ? "場所を開く" : "Open the place"}</button>
          </li>
        ) : null}
        {computationLimited ? (
          <li key="computation-limit">
            <span>{locale === "ja"
              ? "場所が多く計算の上限に達しました。場所を15件以下にしてください"
              : "The place list hit the computation limit. Reduce it to 15 places or fewer"}</span>
            <button onClick={onFixInput} type="button">{locale === "ja" ? "任意の場所を外す" : "Remove optional places"}</button>
          </li>
        ) : null}
        {placeWarning ? (
          <li key="provider">
            <span>{placeWarning === "quota_exhausted"
              ? locale === "ja" ? "場所検索が本日の上限に達しました" : "Place search hit today's allowance"
              : locale === "ja" ? "場所の確認を完了できませんでした" : "Place lookup could not finish"}</span>
            <button onClick={onRetryBuild} type="button">{locale === "ja" ? "再試行" : "Retry"}</button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
