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
};

export default function MovementCard({ leg, travelPreference, locale, boarding, onSetLegMode }: MovementCardProps) {
  const text = ui[locale];
  const recommended = leg.comparison.recommended;
  const legKey = routeLegKey(leg.from.id, leg.to.id);
  const modeLabel = (mode: TransportMode) => transportModeLabel(mode, travelPreference, locale);
  const boardingLine = recommended.mode === "transit" ? transitBoardingText(boarding, locale) : null;
  return (
    <>
      <details className="planner-leg">
        <summary>
          <span>{modeIcon(recommended.mode, travelPreference === "car")}<b>{modeLabel(recommended.mode)} · {text.minutes(recommended.minutes)}</b></span>
          <small>{locale === "ja" ? "移動手段を変える" : "Change transport"}</small>
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
          {recommended.mode === "transit" && leg.transferCount !== null ? (
            <em>{locale === "ja" ? `乗換${leg.transferCount}回` : `${leg.transferCount} transfer${leg.transferCount === 1 ? "" : "s"}`}</em>
          ) : null}
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
