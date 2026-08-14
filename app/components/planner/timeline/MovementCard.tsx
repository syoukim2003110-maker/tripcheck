"use client";

// One between-stops movement (spec v2.1 timeline/): the transport-mode
// picker with minutes per option, live/transfer evidence, and the transit
// boarding line. Emits onSetLegMode - the parent owns the plan edit.
import Icon from "../../../PlannerIcons";
import { modeIcon } from "../icon-maps";
import { routeLegKey, type BuiltTripPlan } from "../../../../lib/trip-builder";
import type { TransportMode, TravelPreference } from "../../../../lib/time-feasibility";
import type { TransitLegBoarding } from "../../../../lib/planner-app-state";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy";
import { transitBoardingText, transportModeLabel } from "../../../../lib/presentation/timeline-presentation";

type BuiltPlanLeg = BuiltTripPlan["days"][number]["legs"][number];

type MovementCardProps = {
  leg: BuiltPlanLeg;
  travelPreference: TravelPreference;
  locale: PlannerLocale;
  boarding: TransitLegBoarding | undefined;
  onSetLegMode: (legKey: string, mode: TransportMode) => void;
  /** Hover/keyboard focus on the row highlights the map route segment (spec §7.4). */
  onHoverChange?: (legKey: string, hovered: boolean) => void;
};

export default function MovementCard({ leg, travelPreference, locale, boarding, onSetLegMode, onHoverChange }: MovementCardProps) {
  const text = ui[locale];
  const recommended = leg.comparison.recommended;
  const legKey = routeLegKey(leg.from.id, leg.to.id);
  const modeLabel = (mode: TransportMode) => transportModeLabel(mode, travelPreference, locale);
  const boardingLine = recommended.mode === "transit" ? transitBoardingText(boarding, locale) : null;
  return (
    <>
      <details
        className="planner-leg"
        onBlur={(event) => {
          // Focus moving between the summary and the mode buttons stays
          // inside the row; only leaving the whole row clears the highlight.
          if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
          onHoverChange?.(legKey, false);
        }}
        onFocus={() => onHoverChange?.(legKey, true)}
        onMouseEnter={() => onHoverChange?.(legKey, true)}
        onMouseLeave={() => onHoverChange?.(legKey, false)}
      >
        {/* v3.1 §5.2: a movement is a card, not a caption. The row used to say
            「電車 · 95分」 with a text link to change it, and kept the two things
            a traveller actually wants — where this leg goes, and how many
            changes it takes — inside the disclosure or in an aria-label. Both
            come up to the surface; the link becomes a chevron, because a whole
            row that opens does not need a word telling you so. */}
        <summary>
          <span aria-hidden="true" className="planner-leg-mark">{modeIcon(recommended.mode, travelPreference === "car")}</span>
          <span className="planner-leg-body">
            <b>
              {modeLabel(recommended.mode)} {text.minutes(recommended.minutes)}
              {recommended.mode === "transit" && leg.transferCount !== null
                ? locale === "ja"
                  ? `・乗換${leg.transferCount}回`
                  : ` · ${leg.transferCount} transfer${leg.transferCount === 1 ? "" : "s"}`
                : ""}
            </b>
            <small>{leg.from.name} → {leg.to.name}</small>
          </span>
          <i aria-hidden="true" className="planner-leg-chevron">›</i>
        </summary>
        <div className="planner-leg-modes" role="group" aria-label={`${leg.from.name} → ${leg.to.name} · ${text.legModes}`}>
          {leg.comparison.options
            .filter((option) => option.mode !== "walk" || option.minutes <= 90)
            .map((option) => (
              <button
                aria-pressed={option.mode === recommended.mode}
                className={option.mode === recommended.mode ? "is-active" : ""}
                key={option.mode}
                onClick={() => onSetLegMode(legKey, option.mode)}
                title={`${modeLabel(option.mode)} · ${text.legModes}`}
                type="button"
              >
                {modeIcon(option.mode, travelPreference === "car")}
                <b>{text.minutes(option.minutes)}</b>
              </button>
            ))}
        </div>
        <span className="planner-leg-evidence">
          {recommended.source === "live" ? <em>{text.legLive}</em> : null}
        </span>
      </details>
      {boardingLine ? (
        <div className="planner-transit-line">
          <Icon name="signal" size={10} />
          <span>{boardingLine}</span>
        </div>
      ) : null}
    </>
  );
}
