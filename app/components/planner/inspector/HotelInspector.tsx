"use client";

// The hotel inspector aside (spec v2.1 inspector/): close/expand controls,
// refresh, the wide-trip note, stay-mode toggle and style chooser, the
// nightly night shortlists and the single-stay purpose group, comparison,
// hero, facts, review, links and evidence sources. Every hotel data
// computation stays with the parent; this component owns the DOM only. The
// rating and Rakuten fact lines come from the shared presentation rules that
// also feed hotelEnhancement, so the inspector and the tested model agree.
import type { RefObject, SyntheticEvent } from "react";
import Icon from "../../../PlannerIcons";
import HotelRecommendationCard from "../recommendation/HotelRecommendationCard";
import type { BuiltTripPlan, HotelRouteContext } from "../../../../lib/trip-builder.ts";
import type { HotelCandidate, HotelStyle } from "../../../../lib/google-hotels.ts";
import {
  type HotelPurpose,
  type HotelState,
  type HotelStayMode,
  type HotelStyleChoice,
  type NightlyHotelState,
  type SourcePreviewState,
} from "../../../../lib/planner-app-state.ts";
import { formatDistanceMeters } from "../../../../lib/presentation/trip-presentation.ts";
import { hotelAxisWinners, hotelShortlist, rakutenReviewLine, ratingFactLine } from "../../../../lib/presentation/recommendation-presentation.ts";
import type { PlanImpactMetrics } from "../../../../lib/recommendation-impact.ts";
import { bufferDeltaLine, travelDeltaLine, ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";

type HotelInspectorProps = {
  locale: PlannerLocale;
  selectedHotel: HotelCandidate;
  plan: BuiltTripPlan | null;
  hotelState: HotelState;
  hotelStayMode: HotelStayMode;
  hotelStyle: HotelStyleChoice;
  hotelPurpose: HotelPurpose;
  hotelUsesRecommendations: boolean;
  hotelPlanDirty: boolean;
  hotelRefreshing: boolean;
  hotelRefreshFailed: boolean;
  hotelRouteContext: HotelRouteContext | null;
  nightlyHotels: NightlyHotelState;
  hotelAxis: ReturnType<typeof hotelAxisWinners>;
  hotelAxisLabels: (candidate: HotelCandidate) => string[];
  /** Pre-accept impact vs the current base, from real simulations (TC-048). */
  hotelImpactById: Record<string, PlanImpactMetrics & { totalTravelMinutes: number }>;
  hotelPriceLabel: (candidate: HotelCandidate) => string;
  hotelTravelMinutesById: Record<string, number>;
  bestHotelTravelMinutes: number;
  hasRakutenHotelEvidence: boolean;
  sourcePreviews: Record<string, SourcePreviewState>;
  sheetExpanded: boolean;
  panelRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onToggleSheet: () => void;
  onRefreshHotels: () => void;
  onEnableNightly: () => void;
  onSelectStayModeSingle: () => void;
  onApplyHotelStyle: (style: HotelStyleChoice) => void;
  onSelectNightCandidate: (nightIndex: number, candidateId: string) => void;
  onSelectHotelCandidate: (candidate: HotelCandidate, purpose?: HotelPurpose) => void;
  onEnsureSourcePreviews: (urls: string[]) => void;
  onPhotoError: (event: SyntheticEvent<HTMLImageElement>) => void;
};

export default function HotelInspector({
  locale,
  selectedHotel,
  plan,
  hotelState,
  hotelStayMode,
  hotelStyle,
  hotelPurpose,
  hotelUsesRecommendations,
  hotelPlanDirty,
  hotelRefreshing,
  hotelRefreshFailed,
  hotelRouteContext,
  nightlyHotels,
  hotelAxis,
  hotelAxisLabels,
  hotelImpactById,
  hotelPriceLabel,
  hotelTravelMinutesById,
  bestHotelTravelMinutes,
  hasRakutenHotelEvidence,
  sourcePreviews,
  sheetExpanded,
  panelRef,
  onClose,
  onToggleSheet,
  onRefreshHotels,
  onEnableNightly,
  onSelectStayModeSingle,
  onApplyHotelStyle,
  onSelectNightCandidate,
  onSelectHotelCandidate,
  onEnsureSourcePreviews,
  onPhotoError,
}: HotelInspectorProps) {
  const text = ui[locale];
  const selectedRatingLine = ratingFactLine(selectedHotel.rating, selectedHotel.userRatingCount, locale);
  const selectedRakutenLine = rakutenReviewLine(selectedHotel.rakuten, locale);

  function renderHotelComparison() {
    if (!selectedHotel || hotelState.candidates.length <= 1) return null;
    const comparisonCandidates = hotelState.ai.status === "ready"
      ? hotelState.candidates
      : hotelShortlist(hotelState.candidates, selectedHotel.id);
    return (
      <section className="planner-hotel-compare">
        <header><span>{text.hotelCompareHeading}</span><small>{comparisonCandidates.length}</small></header>
        {hotelState.ai.status === "loading" ? (
          <p className="planner-hotel-ai-status">{locale === "ja" ? "AIが候補の評判を照合しています…" : "AI is researching these candidates…"}</p>
        ) : null}
        <div className="planner-hotel-compare-list">
          {comparisonCandidates.map((candidate) => {
            const aiNote = hotelState.ai.notes[candidate.id];
            const tags = [
              ...(hotelState.ai.recommendedId === candidate.id ? [locale === "ja" ? "AIのおすすめ" : "AI pick"] : []),
              ...hotelAxisLabels(candidate),
              ...(candidate.styles.includes("luxury") ? [text.styleLuxury] : []),
            ];
            const impact = candidate.id === selectedHotel.id ? null : hotelImpactById[candidate.id] ?? null;
            return (
              <HotelRecommendationCard
                aiNote={aiNote}
                candidate={candidate}
                facts={[
                  ratingFactLine(candidate.rating, candidate.userRatingCount, locale, "compare-paren"),
                  hotelTravelMinutesById[candidate.id] !== undefined
                    ? locale === "ja"
                      ? `全日程の移動 約${hotelTravelMinutesById[candidate.id]}分${Number.isFinite(bestHotelTravelMinutes) && hotelTravelMinutesById[candidate.id] > bestHotelTravelMinutes ? `（最短比 +${hotelTravelMinutesById[candidate.id] - bestHotelTravelMinutes}分）` : ""}`
                      : `~${hotelTravelMinutesById[candidate.id]} min total travel${Number.isFinite(bestHotelTravelMinutes) && hotelTravelMinutesById[candidate.id] > bestHotelTravelMinutes ? ` (+${hotelTravelMinutesById[candidate.id] - bestHotelTravelMinutes} vs best)` : ""}`
                    : text.distanceFrom(formatDistanceMeters(candidate.routeAverageDistanceMeters)),
                  // TC-048: what switching to this base would really do —
                  // both metrics from the simulated candidate plan.
                  ...(impact ? [`${travelDeltaLine(impact.travelDeltaMinutes, locale)} · ${bufferDeltaLine(impact.bufferDeltaMinutes, locale)}`] : []),
                ].filter(Boolean).join(" · ")}
                isSelected={candidate.id === selectedHotel.id}
                key={candidate.id}
                locale={locale}
                onPhotoError={onPhotoError}
                onSelect={() => onSelectHotelCandidate(candidate)}
                priceLabel={hotelPriceLabel(candidate)}
                rakutenLine={rakutenReviewLine(candidate.rakuten, locale)}
                tags={tags}
              />
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <aside
      aria-labelledby="planner-hotel-inspector-title"
      className={`planner-inspector is-hotel${sheetExpanded ? " is-sheet-full" : ""}`}
      ref={panelRef}
      role="dialog"
      tabIndex={-1}
    >
      <button className="planner-inspector-close" onClick={onClose} type="button" aria-label={text.close}><Icon name="close" size={13} /></button><button aria-label={locale === "ja" ? (sheetExpanded ? "シートを縮小" : "シートを全画面に広げる") : (sheetExpanded ? "Collapse sheet" : "Expand sheet")} className="planner-inspector-expand" onClick={onToggleSheet} type="button">{sheetExpanded ? "▾" : "▴"}</button>
      <header className="planner-inspector-head">
        <span className="planner-inspector-num is-hotel" aria-hidden="true"><Icon name="bed" size={17} /></span>
        <div>
          <h2 id="planner-hotel-inspector-title">{hotelStayMode === "nightly" ? text.stayNightly : selectedHotel.name}</h2>
          <p>{text.hotelCandidate}</p>
        </div>
      </header>
      {hotelUsesRecommendations && hotelStayMode === "single" ? (
        <div className={`planner-hotel-refresh-wrap${hotelPlanDirty ? " is-dirty" : ""}`}>
          {hotelPlanDirty ? <p>{text.hotelRefreshHint}</p> : null}
          <button className="planner-hotel-refresh" disabled={hotelRefreshing || !plan} onClick={onRefreshHotels} type="button">
            <Icon name="search" size={14} />
            {hotelRefreshing ? text.hotelRefreshing : hotelPlanDirty ? text.hotelRefreshChanged : text.hotelRefresh}
          </button>
          {hotelRefreshFailed ? <small role="status">{text.hotelRefreshFailed}</small> : null}
        </div>
      ) : null}
      {hotelRouteContext && hotelRouteContext.spreadKm >= 70 ? (
        <div className="planner-hotel-wide-note">
          <Icon name="train" size={15} />
          <p>{text.hotelWideTrip}</p>
          <button onClick={onEnableNightly} type="button">{text.stayNightly}</button>
        </div>
      ) : null}
      {plan && plan.days.length >= 2 ? (
        <div className="planner-stay-mode" role="group" aria-label={text.stayModeHeading}>
          <button
            aria-pressed={hotelStayMode === "single"}
            className={hotelStayMode === "single" ? "is-active" : ""}
            onClick={onSelectStayModeSingle}
            type="button"
          >
            {text.staySame}
          </button>
          <button
            aria-pressed={hotelStayMode === "nightly"}
            className={hotelStayMode === "nightly" ? "is-active" : ""}
            onClick={onEnableNightly}
            type="button"
          >
            {text.stayNightly}
          </button>
        </div>
      ) : null}
      {(() => {
        if (hotelStayMode !== "nightly") return null;
        const nightCandidates = nightlyHotels.status === "ready" ? nightlyHotels.nights.flatMap((night) => night.candidates) : [];
        const styleAvailable = (style: HotelStyle) => hotelState.candidates.some((candidate) => candidate.styles.includes(style))
          || nightCandidates.some((candidate) => candidate.styles.includes(style));
        if (!styleAvailable("luxury")) return null;
        const choices: Array<{ value: HotelStyleChoice; label: string; enabled: boolean }> = [
          { value: "recommended", label: text.styleRecommended, enabled: true },
          { value: "luxury", label: text.styleLuxury, enabled: styleAvailable("luxury") },
        ];
        return (
          <div className="planner-hotel-styles" role="group" aria-label={text.styleNote}>
            {choices.map((choice) => (
              <button
                aria-pressed={hotelStyle === choice.value}
                className={hotelStyle === choice.value ? "is-active" : ""}
                disabled={!choice.enabled}
                key={choice.value}
                onClick={() => onApplyHotelStyle(choice.value)}
                type="button"
              >
                {choice.label}
              </button>
            ))}
          </div>
        );
      })()}
      {hotelStayMode === "nightly" ? (
        <div className="planner-night-list">
          {nightlyHotels.status === "loading" ? <p className="planner-food-status" role="status">{text.nightlyLoading}</p> : null}
          {nightlyHotels.status === "unavailable" ? <p className="planner-food-status">{text.nightlyUnavailable}</p> : null}
          {nightlyHotels.status === "ready" ? nightlyHotels.nights.map((night, nightIndex) => {
            const selected = night.candidates.find((candidate) => candidate.id === night.selectedId) ?? null;
            const shortlist = hotelShortlist(night.candidates, night.selectedId);
            const nightAxes = hotelAxisWinners(night.candidates);
            return (
              <section className="planner-night" key={`night-${nightIndex}`}>
                <header><b>{text.nightLabel(nightIndex + 1)}</b><small>{night.area}</small></header>
                {selected ? (
                  <div className="planner-night-options">
                    {shortlist.map((candidate) => (
                      <HotelRecommendationCard
                        candidate={candidate}
                        facts={[
                          ratingFactLine(candidate.rating, candidate.userRatingCount, locale, "ascii-paren"),
                          text.distanceFrom(formatDistanceMeters(candidate.routeAverageDistanceMeters)),
                        ].filter(Boolean).join(" · ")}
                        isSelected={candidate.id === selected.id}
                        key={candidate.id}
                        locale={locale}
                        onPhotoError={onPhotoError}
                        onSelect={() => onSelectNightCandidate(nightIndex, candidate.id)}
                        priceLabel={hotelPriceLabel(candidate)}
                        showEmptyTags
                        tags={([
                          candidate.id === night.candidates[0]?.id ? text.hotelPurposeBalanced : null,
                          candidate.id === nightAxes.nearestId ? text.hotelPurposeNearest : null,
                          candidate.id === nightAxes.topRatedId ? text.hotelPurposeRated : null,
                          candidate.styles.includes("luxury") ? text.styleLuxury : null,
                        ] as Array<string | null>).filter((tag): tag is string => tag !== null)}
                      />
                    ))}
                  </div>
                ) : <p className="planner-food-status">{text.nightlyNightMissing}</p>}
              </section>
            );
          }) : null}
          <p className="planner-food-note">{text.hotelRankNote} {text.styleNote} {text.hotelNoAvailability}</p>
        </div>
      ) : (<>
      {hotelUsesRecommendations ? <div className="planner-hotel-purpose">
        <b>{text.hotelPurposeHeading}</b>
        <div role="group" aria-label={text.hotelPurposeHeading}>
          {([
            { purpose: "balanced" as const, label: text.hotelPurposeBalanced, id: hotelState.candidates[0]?.id ?? null },
            { purpose: "nearest" as const, label: text.hotelPurposeNearest, id: hotelAxis.nearestId },
            { purpose: "rated" as const, label: text.hotelPurposeRated, id: hotelAxis.topRatedId },
          ]).map((choice) => {
            const candidate = choice.id ? hotelState.candidates.find((item) => item.id === choice.id) ?? null : null;
            return (
              <button
                aria-pressed={hotelPurpose === choice.purpose}
                className={hotelPurpose === choice.purpose ? "is-active" : ""}
                disabled={!candidate}
                key={choice.purpose}
                onClick={() => candidate && onSelectHotelCandidate(candidate, choice.purpose)}
                type="button"
              >
                {choice.label}
              </button>
            );
          })}
        </div>
        <small>{text.hotelPurposeHelp}</small>
      </div> : null}
      {renderHotelComparison()}
      <p className="planner-hotel-reason">
        {!hotelUsesRecommendations ? text.hotelReasonSpecified
          : hotelPurpose === "nearest" ? text.hotelReasonNearest
          : hotelPurpose === "rated" ? text.hotelReasonRated
            : hotelPurpose === "value" ? text.hotelReasonValue
              : hotelPurpose === "balanced" ? text.hotelReasonTop
                : text.hotelReasonPicked}
      </p>
      <a className="planner-hotel-hero" href={selectedHotel.googleMapsUrl} key={selectedHotel.id} rel="noreferrer" target="_blank">
        {selectedHotel.photo ? <>
          {/* Google place photos are proxied at request time and are not stored. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={selectedHotel.name} onError={onPhotoError} src={`/api/place-photo?name=${encodeURIComponent(selectedHotel.photo.name)}`} />
        </> : <span aria-hidden="true"><Icon name="bed" size={26} /></span>}
        <i>{hotelPriceLabel(selectedHotel)}</i>
      </a>
      {selectedHotel.photo?.attribution ? <a className="planner-photo-credit" href={selectedHotel.photo.attribution.uri} rel="noreferrer" target="_blank">{text.photoLabel} {selectedHotel.photo.attribution.name} ↗</a> : null}
      <div className="planner-hotel-facts">
        {selectedRatingLine !== null ? <span className="is-rating">{selectedRatingLine}</span> : null}
        <span className={selectedHotel.rakuten?.minCharge ? "is-price" : ""}>{hotelPriceLabel(selectedHotel)}</span>
        <span>{text.distanceFrom(formatDistanceMeters(selectedHotel.routeAverageDistanceMeters))}</span>
        {hotelAxisLabels(selectedHotel).map((label) => <span className="is-axis" key={label}>{label}</span>)}
        {selectedHotel.styles.includes("luxury") ? <span>{text.styleLuxury}</span> : null}
        {selectedRakutenLine !== null && selectedHotel.rakuten ? (
          <a className="is-rakuten" href={selectedHotel.rakuten.url} rel="noreferrer" target="_blank">
            {selectedRakutenLine} ↗
          </a>
        ) : null}
        {selectedHotel.payment?.cashOnly === true ? <span>{text.cashOnly}</span> : null}
        {selectedHotel.payment?.acceptedMethods.includes("credit_card") ? <span>{text.cardsAccepted}</span> : null}
        {hotelState.fresh.result?.findings.length ? <span>{text.foodFresh(hotelState.fresh.result.findings.length)}</span> : null}
      </div>
      <p className="planner-hotel-address">{selectedHotel.address}</p>
      {selectedHotel.reviews?.[0] ? (
        <blockquote className="planner-hotel-review">
          <p>“{selectedHotel.reviews[0].text}”</p>
          <footer>
            <span>{selectedHotel.reviews[0].rating !== null ? `★ ${selectedHotel.reviews[0].rating}` : ""} {selectedHotel.reviews[0].relativeTime ?? ""}</span>
            <a href={selectedHotel.reviews[0].googleMapsUrl ?? selectedHotel.googleMapsUrl} rel="noreferrer" target="_blank">{selectedHotel.reviews[0].authorName ?? "Google Maps"} ↗</a>
          </footer>
        </blockquote>
      ) : null}
      <div className="planner-inspector-actions">
        <a href={selectedHotel.googleMapsUrl} rel="noreferrer" target="_blank">Google Maps ↗</a>
        {selectedHotel.websiteUrl ? <a href={selectedHotel.websiteUrl} rel="noreferrer" target="_blank">{text.official} ↗</a> : null}
      </div>
      {hotelState.fresh.result?.findings.length ? (
        <details
          className="planner-evidence-sources"
          onToggle={(event) => {
            if ((event.target as HTMLDetailsElement).open) onEnsureSourcePreviews((hotelState.fresh.result?.findings ?? []).slice(0, 3).map((finding) => finding.url));
          }}
        >
          <summary>{text.publicSources} · {hotelState.fresh.result.findings.length}</summary>
          <div className="planner-fresh-list">
            {hotelState.fresh.result.findings.map((finding) => (
              <a href={finding.url} key={finding.url} rel="noreferrer" target="_blank">
                <div><span className={`is-${finding.sourceKind}`}>{text.freshSource[finding.sourceKind]}</span><small>{finding.age ?? text.freshAgeUnknown}</small></div>
                <b>{finding.title}</b><p>{finding.note}</p>
                {sourcePreviews[finding.url]?.imageUrl ? <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="" className="planner-fresh-thumb" loading="lazy" onError={onPhotoError} referrerPolicy="no-referrer" src={sourcePreviews[finding.url].imageUrl ?? undefined} />
                </> : null}
                <i aria-hidden="true">↗</i>
              </a>
            ))}
          </div>
        </details>
      ) : null}
      <p className="planner-food-note">
        {text.hotelRankNote} {hasRakutenHotelEvidence ? `${text.hotelPriceNote} ` : ""}{text.styleNote} {text.hotelNoAvailability}
      </p>
      </>)}
    </aside>
  );
}
