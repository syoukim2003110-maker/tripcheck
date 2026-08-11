"use client";

// Plan-could-not-render fallback (spec v2.1 states/): names the problem,
// keeps the unrecognized entries honest, and offers the way back to edit.
import Icon from "../../../PlannerIcons";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy";

type ErrorStateProps = {
  locale: PlannerLocale;
  unknownEntries: readonly string[];
  onEdit: () => void;
};

export default function ErrorState({ locale, unknownEntries, onEdit }: ErrorStateProps) {
  const text = ui[locale];
  return (
    <div className="planner-result-view">
      <p className="planner-warning" role="status"><span aria-hidden="true">!</span>{text.noDays}</p>
      {unknownEntries.length > 0 ? (
        <details className="planner-unknown" open>
          <summary>{text.unknown} · {unknownEntries.length}</summary>
          <ul>{unknownEntries.map((entry) => <li key={entry}>{entry}</li>)}</ul>
        </details>
      ) : null}
      <button className="planner-build-button" onClick={onEdit} type="button"><span>{text.edit}</span><b aria-hidden="true"><Icon name="arrow" size={19} /></b></button>
    </div>
  );
}
