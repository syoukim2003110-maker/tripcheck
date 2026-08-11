// Icon assignments for presentation states. Copy decisions live in
// lib/presentation; picking a glyph is a UI concern, so it lives here.
import Icon, { type IconName } from "../../PlannerIcons";
import type { WeatherKind } from "../../../lib/weather";
import type { FeasibilityState } from "../../../lib/feasibility-result";

export const weatherIconByKind: Record<WeatherKind, IconName> = {
  clear: "sun",
  partly: "sun",
  cloudy: "cloud",
  fog: "fog",
  rain: "rain",
  snow: "snow",
  storm: "storm",
};

export function feasibilityStateIcon(state: FeasibilityState): IconName {
  if (state === "VERIFIED_FEASIBLE") return "check";
  if (state === "PROVISIONAL_FEASIBLE") return "signal";
  if (state === "FEASIBLE_IF_ASSUMPTIONS") return "spark";
  if (state === "INFEASIBLE_HARD_CONFLICT") return "close";
  return "search";
}

export function modeIcon(mode: "walk" | "transit" | "taxi", carMode: boolean) {
  return <Icon name={mode === "transit" ? "train" : mode === "taxi" && carMode ? "car" : mode} size={14} />;
}
