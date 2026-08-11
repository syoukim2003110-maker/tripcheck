"use client";

// Start-surface footer (spec v2.1 start/RecentTrips): the back-to-plan
// shortcut once a plan exists, the device-storage warning and the recent-trip
// list with open/delete actions. Reads stored inputs via the pure helper and
// emits events; the trip store itself lives in TripPlannerApp.
import Icon from "../../../PlannerIcons";
import type { StoredTripRecord } from "../../../../lib/trip-store.ts";
import { storedTripInput } from "../../../../lib/planner-app-state.ts";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";

type RecentTripsProps = {
  locale: PlannerLocale;
  planReady: boolean;
  isBuilding: boolean;
  tripStorePersistent: boolean | null;
  recentTrips: ReadonlyArray<StoredTripRecord>;
  onReturnToPlan: () => void;
  onOpenTrip: (entry: StoredTripRecord) => void;
  onDeleteTrip: (entry: StoredTripRecord) => void;
};

export default function RecentTrips({
  locale,
  planReady,
  isBuilding,
  tripStorePersistent,
  recentTrips,
  onReturnToPlan,
  onOpenTrip,
  onDeleteTrip,
}: RecentTripsProps) {
  const text = ui[locale];
  return (
    <>
      {planReady && !isBuilding ? (
        <button className="planner-return-plan" onClick={onReturnToPlan} type="button">
          {text.backToPlan}<Icon name="arrow" size={15} />
        </button>
      ) : null}

      {tripStorePersistent === false ? (
        <p className="planner-local-storage-warning" role="status">
          {locale === "ja" ? "このブラウザでは端末保存を利用できないため、最近の旅程はこのタブを閉じると消えます。" : "Device storage is unavailable in this browser. Recent trips will disappear when this tab closes."}
        </p>
      ) : null}
      {recentTrips.length > 0 ? (
        <div className="planner-recent">
          <span>{text.recentHeading}<small> · {text.recentNote}</small></span>
          <ul>
            {recentTrips.map((entry) => {
              const storedInput = storedTripInput(entry);
              return (
                <li key={entry.id}>
                  <button className="planner-recent-open" onClick={() => onOpenTrip(entry)} type="button">
                    <b>{entry.title}</b>
                    <small>
                      {storedInput
                        ? storedInput.dateWasProvided
                          ? storedInput.tripStartDate
                          : locale === "ja" ? "日付未定" : "Date not decided"
                        : entry.updatedAt.slice(0, 10)}
                      {" · "}
                      {storedInput ? text.recentDays(storedInput.tripDays) : (locale === "ja" ? "入力を再確認" : "Review input")}
                    </small>
                  </button>
                  <button
                    aria-label={text.recentDelete}
                    className="planner-recent-remove"
                    onClick={() => onDeleteTrip(entry)}
                    type="button"
                  >
                    <Icon name="close" size={11} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </>
  );
}
