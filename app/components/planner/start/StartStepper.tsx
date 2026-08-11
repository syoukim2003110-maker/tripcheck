"use client";

// Start-surface step indicator (spec v2.1 start/StartStepper): the numbered
// places → check places → itinerary rail above the input form. Renders the
// current step and emits step selection; the parent owns the input step.
import Icon from "../../../PlannerIcons";
import type { PlannerBuildMode, PlannerInputStep } from "../../../../lib/planner-app-state.ts";
import type { PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";

type StartStepperProps = {
  inputStep: PlannerInputStep;
  buildMode: PlannerBuildMode;
  locale: PlannerLocale;
  onStepSelect: (step: PlannerInputStep) => void;
};

export default function StartStepper({ inputStep, buildMode, locale, onStepSelect }: StartStepperProps) {
  return (
    <nav className={`planner-input-progress${inputStep === "places" && buildMode === "automatic" ? " is-compact" : ""}`} aria-label={locale === "ja" ? "入力の進み具合" : "Planning progress"}>
      <button aria-current={inputStep === "places" ? "step" : undefined} className={inputStep === "places" ? "is-active" : "is-complete"} onClick={() => onStepSelect("places")} type="button">
        <i aria-hidden="true">{inputStep === "conditions" ? <Icon name="check" size={11} /> : 1}</i><span>{locale === "ja" ? "場所と日数" : "Places & days"}</span>
      </button>
      <span aria-hidden="true" />
      {inputStep === "conditions" || buildMode === "custom" ? <>
        <div aria-current={inputStep === "conditions" ? "step" : undefined} className={inputStep === "conditions" ? "is-active" : ""}>
          <i aria-hidden="true">2</i><span>{locale === "ja" ? "場所の確認" : "Check places"}</span>
        </div>
        <span aria-hidden="true" />
        <div><i aria-hidden="true">3</i><span>{locale === "ja" ? "旅程" : "Itinerary"}</span></div>
      </> : <div><i aria-hidden="true">2</i><span>{locale === "ja" ? "旅程" : "Itinerary"}</span></div>}
    </nav>
  );
}
