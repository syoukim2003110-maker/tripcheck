"use client";

// Build-in-progress screen (spec v2.1 states/): numbered stages with a live
// detail line and a cancel action. Pure renderer - the build pipeline owns
// the stage data.
import Icon from "../../../PlannerIcons";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy";
import type { BuildStage } from "../../../../lib/planner-app-state";

type LoadingStateProps = {
  stages: readonly BuildStage[];
  activeIndex: number;
  detail: string;
  aiEnabled: boolean;
  locale: PlannerLocale;
  onCancel: () => void;
};

export default function LoadingState({ stages, activeIndex, detail, aiEnabled, locale, onCancel }: LoadingStateProps) {
  const text = ui[locale];
  return (
    <div className="planner-building-view" aria-live="polite">
      <header className="planner-building-head">
        <span className="planner-building-orbit" aria-hidden="true" />
        <div><h1>{text.buildingTitle}</h1><p>{aiEnabled ? text.buildingBody : text.buildingBodyNoSocial}</p></div>
      </header>
      <ol className="planner-building-steps">
        {stages.map((stage, index) => {
          const state = index < activeIndex ? "is-complete" : index === activeIndex ? "is-active" : "";
          return (
            <li className={state} key={stage}>
              <span className="planner-building-step-dot" aria-hidden="true">{index < activeIndex ? <Icon name="check" size={11} /> : index + 1}</span>
              <span className="planner-building-step-copy">
                <b>{text.buildSteps[stage]}</b>
                {index === activeIndex ? <small>{detail}</small> : null}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="planner-building-live"><i aria-hidden="true" />{detail}</p>
      <button className="planner-building-cancel" onClick={onCancel} type="button">{text.buildingCancel}</button>
    </div>
  );
}
