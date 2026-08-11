"use client";

// One route-idea candidate card (spec v2.1 recommendation/): main select
// button, add/added action and photo credit. The card consumes the unified
// Enhancement model via gapEnhancement — its title is the displayed name —
// so the gap card provably renders from the same shape the other
// recommendation surfaces can build. Emits onSelect/onAdd only.
import type { SyntheticEvent } from "react";
import Icon from "../../../PlannerIcons";
import type { RouteRecommendation } from "../../../../lib/route-recommendations.ts";
import { gapEnhancement } from "../../../../lib/presentation/recommendation-presentation.ts";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";

type GapRecommendationCardProps = {
  candidate: RouteRecommendation;
  index: number;
  locale: PlannerLocale;
  selected: boolean;
  added: boolean;
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
  onSelect,
  onAdd,
  onPhotoError,
}: GapRecommendationCardProps) {
  const text = ui[locale];
  // Enhancement.title is defined as the candidate name, so rendering it here
  // keeps the DOM byte-identical while exercising the unified model.
  const enhancement = gapEnhancement(candidate);
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
            <img alt={candidate.name} loading="lazy" onError={onPhotoError} src={`/api/place-photo?name=${encodeURIComponent(candidate.photoName)}`} />
          ) : <span aria-hidden="true"><Icon name="pin" size={20} /></span>}
          <i>{index + 1}</i>
        </span>
        <span className="planner-route-idea-copy">
          <small>{candidate.type}</small>
          <b>{enhancement.title}</b>
          <span>
            {candidate.rating !== null ? <em>★ {candidate.rating.toFixed(1)} · {candidate.userRatingCount?.toLocaleString(locale === "ja" ? "ja-JP" : "en-US") ?? "—"}</em> : null}
            <em>{text.routeIdeasDistance(candidate.routeDistanceMeters)}</em>
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
