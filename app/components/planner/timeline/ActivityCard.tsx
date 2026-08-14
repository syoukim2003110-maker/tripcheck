"use client";

// One scheduled stop row (spec v2.1 timeline/): times, name, stay evidence,
// access note and status flags. Emits onSelect / onRemoveFiller only - the
// parent owns inspector state and plan edits.
import Icon from "../../../PlannerIcons";
import type { BuiltTripPlan } from "../../../../lib/trip-builder";
import type { RouteStop } from "../../../../lib/route-optimizer";
import type { PlannerLocale } from "../../../../lib/presentation/planner-copy";
import {
  activityFlags,
  fillerRowLabel,
  stayLine,
  type DurationEvidenceStatus,
  type TimelineFillerKind,
} from "../../../../lib/presentation/timeline-presentation";

type BuiltPlanStop = BuiltTripPlan["days"][number]["stops"][number];

type ActivityCardProps = {
  builtStop: BuiltPlanStop;
  index: number;
  isSelected: boolean;
  isFiller: boolean;
  fillerKind: TimelineFillerKind;
  durationStatus: DurationEvidenceStatus;
  accessNote: string | null;
  locale: PlannerLocale;
  onSelect: (stopId: string, isSelected: boolean) => void;
  onRemoveFiller: (stop: RouteStop) => void;
  /** Hover/keyboard focus on the card highlights the map marker (spec §7.4). */
  onHoverChange?: (stopId: string, hovered: boolean) => void;
};

export default function ActivityCard({
  builtStop,
  index,
  isSelected,
  isFiller,
  fillerKind,
  durationStatus,
  accessNote,
  locale,
  onSelect,
  onRemoveFiller,
  onHoverChange,
}: ActivityCardProps) {
  const isMealFiller = fillerKind === "lunch" || fillerKind === "dinner";
  const flags = activityFlags(builtStop, locale);
  return (
    <>
      <button
        className={`planner-stop-row${isSelected ? " is-selected" : ""}${isFiller ? " is-filler" : ""}`}
        data-planner-stop-id={builtStop.stop.id}
        onBlur={() => onHoverChange?.(builtStop.stop.id, false)}
        onClick={() => onSelect(builtStop.stop.id, isSelected)}
        onFocus={() => onHoverChange?.(builtStop.stop.id, true)}
        onMouseEnter={() => onHoverChange?.(builtStop.stop.id, true)}
        onMouseLeave={() => onHoverChange?.(builtStop.stop.id, false)}
        type="button"
      >
        <time>{builtStop.arrival}</time>
        <span className="planner-stop-dot">{isMealFiller ? <Icon name="fork" size={11} /> : isFiller ? <Icon name="spark" size={11} /> : index + 1}</span>
        <span className="planner-stop-main">
          {isFiller ? <small className="planner-filler-label"><Icon name={isMealFiller ? "fork" : "spark"} size={10} />{fillerRowLabel(fillerKind, locale)}</small> : null}
          <b>{builtStop.stop.name}</b>
          {/* v3.1 §2.2: the 推定 / 確認 / 指定 badge moved into the stop
              sheet's evidence disclosure, and the uncertainty it used to carry
              moved into the word — an estimate now reads 「滞在の目安」. */}
          <small>{builtStop.stop.area} · {stayLine(builtStop.stop.planningDurationMinutes, durationStatus, locale)}</small>
          {accessNote ? <small className="planner-access-note"><Icon name="train" size={10} />{accessNote}</small> : null}
        </span>
        <span className="planner-stop-flags">
          {flags.map((flag, flagIndex) => <i className={flag.className} key={flagIndex}>{flag.label}</i>)}
        </span>
      </button>
      {isFiller ? (
        <button
          className="planner-filler-remove"
          onClick={() => onRemoveFiller(builtStop.stop)}
          type="button"
        >
          <Icon name="close" size={10} />{locale === "ja" ? "おすすめを外す" : "Remove suggestion"}
        </button>
      ) : null}
    </>
  );
}
