import type { CSSProperties } from "react";
import {
  buildPlannerDayTimeBarModel,
  formatPlannerDayTimeDuration,
  plannerDayTimeBarAriaLabel,
  type PlannerDayTimeBarDay,
  type PlannerDayTimeBarFit,
  type PlannerDayTimeBarLocale,
  type PlannerDayTimeSegmentKind,
} from "../lib/planner-day-time-bar";

export type PlannerDayTimeBarProps = {
  day: PlannerDayTimeBarDay;
  fit?: PlannerDayTimeBarFit | null;
  locale: PlannerDayTimeBarLocale;
};

const segmentStyles: Record<PlannerDayTimeSegmentKind, CSSProperties> = {
  visit: { background: "var(--pl-ink, #0b0b0e)" },
  travel: { background: "var(--pl-accent, #e2634e)" },
  slack: {
    background: "repeating-linear-gradient(-45deg, #e2e2e7 0 3px, #f7f7f8 3px 7px)",
  },
};

export default function PlannerDayTimeBar({ day, fit, locale }: PlannerDayTimeBarProps) {
  const model = buildPlannerDayTimeBarModel(day, fit);
  const labels = locale === "ja"
    ? { visit: "訪問", travel: "移動", slack: "余裕", reservation: "予約", conflict: "衝突", empty: "予定はまだありません" }
    : { visit: "Visits", travel: "Travel", slack: "Spare", reservation: "Reservation", conflict: "Conflict", empty: "No scheduled time yet" };

  return (
    <section className={`planner-day-time-bar${model.hasConflict ? " has-conflict" : ""}`}>
      <div
        aria-label={plannerDayTimeBarAriaLabel(model, locale)}
        className="planner-day-time-bar-track"
        role="img"
        style={{
          background: "var(--pl-tile, #f3f3f5)",
          borderRadius: 999,
          display: "flex",
          height: 14,
          overflow: "visible",
          position: "relative",
          width: "100%",
        }}
      >
        {model.isEmpty ? (
          <span
            aria-hidden="true"
            className="planner-day-time-bar-empty"
            style={{ color: "var(--pl-muted, #64646c)", fontSize: 10, left: 8, lineHeight: "14px", position: "absolute" }}
          >
            {labels.empty}
          </span>
        ) : model.segments.filter((segment) => segment.percentage > 0).map((segment, index, visibleSegments) => (
          <span
            aria-hidden="true"
            className={`planner-day-time-bar-segment is-${segment.kind}`}
            key={segment.kind}
            style={{
              ...segmentStyles[segment.kind],
              borderRadius: index === 0
                ? "999px 0 0 999px"
                : index === visibleSegments.length - 1 ? "0 999px 999px 0" : 0,
              display: "block",
              height: "100%",
              width: `${segment.percentage}%`,
            }}
          />
        ))}
        {model.markers.map((marker) => (
          <span
            aria-hidden="true"
            className={`planner-day-time-bar-marker is-${marker.kind}`}
            key={marker.id}
            style={{
              background: marker.kind === "conflict" ? "#b13a2b" : "#ffffff",
              border: marker.kind === "conflict" ? "2px solid #ffffff" : "2px solid var(--pl-ink, #0b0b0e)",
              borderRadius: marker.kind === "conflict" ? 2 : 999,
              boxShadow: marker.kind === "conflict" ? "0 0 0 1px #b13a2b" : "none",
              height: marker.kind === "conflict" ? 10 : 9,
              left: `${marker.positionPercentage}%`,
              position: "absolute",
              top: marker.kind === "conflict" ? -5 : -4,
              transform: marker.kind === "conflict" ? "translateX(-50%) rotate(45deg)" : "translateX(-50%)",
              width: marker.kind === "conflict" ? 10 : 9,
            }}
            title={`${marker.kind === "reservation" ? labels.reservation : labels.conflict}: ${marker.label}`}
          />
        ))}
      </div>

      {/* v1.1 TC-032: the day header keeps two headline numbers (予定/余裕
          tiles). The bar stays visual-only; its aria-label carries the full
          breakdown for assistive technology. */}
    </section>
  );
}
