"use client";

// One route-idea candidate card (spec v2.1 recommendation/): main select
// button, add/added action and photo credit. The card consumes the unified
// Enhancement model via gapEnhancement — its title is the displayed name and
// its evidence lines are the rating/distance facts — so the gap card provably
// renders from the same shape the other recommendation surfaces build.
// Emits onSelect/onAdd only.
import type { SyntheticEvent } from "react";
import Icon from "../../../PlannerIcons";
import type { RouteRecommendation } from "../../../../lib/route-recommendations.ts";
import { detourWalkingMinutes } from "../../../../lib/recommendation-evaluator.ts";
import { gapEnhancement } from "../../../../lib/presentation/recommendation-presentation.ts";
import type { PlanImpactMetrics } from "../../../../lib/recommendation-impact.ts";
import { bufferDeltaLine, travelDeltaLine, ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";
import { placePhotoSrc } from "../../../../lib/presentation/place-photo";

type GapRecommendationCardProps = {
  candidate: RouteRecommendation;
  index: number;
  locale: PlannerLocale;
  selected: boolean;
  added: boolean;
  /** Pre-accept impact from the really simulated candidate plan (TC-048). */
  impact?: PlanImpactMetrics | null;
  /** TC-047: beyond the 15-minute walking cap — the card states the real detour. */
  overDetourCap?: boolean;
  onSelect: (candidateId: string) => void;
  onAdd: (candidate: RouteRecommendation) => void;
  onPhotoError: (event: SyntheticEvent<HTMLImageElement>) => void;
};

export default function GapRecommendationCard({
  candidate,
  index,
  locale,
  selected,
  added,
  impact = null,
  overDetourCap = false,
  onSelect,
  onAdd,
  onPhotoError,
}: GapRecommendationCardProps) {
  const text = ui[locale];
  // Enhancement.title is the candidate name and Enhancement.evidence holds
  // the rating/distance fact lines verbatim, so rendering them here keeps the
  // DOM byte-identical while exercising the unified model.
  const enhancement = gapEnhancement(candidate, { locale });
  return (
    <article className={selected ? "is-selected" : undefined}>
      <button
        aria-pressed={selected}
        className="planner-route-idea-main"
        onClick={() => onSelect(candidate.id)}
        type="button"
      >
        <span className="planner-route-idea-image">
          {candidate.photoName ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={candidate.name} loading="lazy" onError={onPhotoError} src={placePhotoSrc(candidate.photoName, candidate.photoSignature)} />
          ) : <span aria-hidden="true"><Icon name="pin" size={20} /></span>}
          <i>{index + 1}</i>
        </span>
        <span className="planner-route-idea-copy">
          <small>{candidate.type}</small>
          <b>{enhancement.title}</b>
          <span>
            {enhancement.evidence.map((line, index) => <em key={index}>{line}</em>)}
            {/* TC-047: a beyond-cap candidate names its real walking detour. */}
            {overDetourCap && detourWalkingMinutes(candidate.routeDistanceMeters) !== null
              ? <em className="is-detour">{text.detourLine(detourWalkingMinutes(candidate.routeDistanceMeters)!)}</em>
              : null}
            {impact ? <em className="is-impact">{travelDeltaLine(impact.travelDeltaMinutes, locale)}</em> : null}
            {impact ? <em className="is-impact">{bufferDeltaLine(impact.bufferDeltaMinutes, locale)}</em> : null}
          </span>
        </span>
      </button>
      <footer>
        <button disabled={added} onClick={() => onAdd(candidate)} type="button">
          {added ? <><Icon name="check" size={12} />{text.routeIdeasAdded}</> : <><Icon name="plus" size={12} />{text.routeIdeasAdd}</>}
        </button>
        <a href={candidate.googleMapsUrl} rel="noreferrer" target="_blank">Maps ↗</a>
      </footer>
      {candidate.photoAttribution ? (
        <a className="planner-photo-credit" href={candidate.photoAttribution.uri} rel="noreferrer" target="_blank">{text.photoLabel} {candidate.photoAttribution.name}</a>
      ) : null}
    </article>
  );
}
