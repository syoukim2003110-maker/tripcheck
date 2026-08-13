"use client";

// Places step (spec v2.1 start/PlacesStep): the wishlist composer with its
// parse preview and inline editors, the quick day/date conditions, the build
// CTA, the advanced (hotel/pace/destination) disclosure and the sample-trip
// link, next to the static preview aside. Renders parent-parsed rows and
// emits events; every state change stays in TripPlannerApp.
import type { RefObject } from "react";
import Icon from "../../../PlannerIcons";
import SearchableCombobox, { type SearchableOption } from "../../../SearchableCombobox";
import PlaceInputAutocomplete from "./PlaceInputAutocomplete";
import StartPreviewAside from "./StartPreviewAside";
import type { Pace } from "../../../../lib/trip-builder.ts";
import type { TravelPreference } from "../../../../lib/time-feasibility.ts";
import type { DestinationChoice } from "../../../../lib/destinations.ts";
import type { WishlistPlaceConstraintPatch } from "../../../../lib/wishlist-parser.ts";
import type { ParsePreviewRow, PlannerBuildMode } from "../../../../lib/planner-app-state.ts";
import type { ShareableResolutionOverride } from "../../../../lib/share-link.ts";
import type { PlaceSuggestionsState } from "../hooks/usePlaceSuggestions";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";

type PlacesStepProps = {
  locale: PlannerLocale;
  itinerary: string;
  startInputError: "" | "empty" | "limit";
  placesInputRef: RefObject<HTMLTextAreaElement | null>;
  parsePreviewRows: ReadonlyArray<ParsePreviewRow>;
  parsedPlaceCount: number;
  canNormalizeItinerary: boolean;
  daysUndecided: boolean;
  tripDays: number;
  tripDateTouched: boolean;
  tripStartDate: string;
  placeWarning: false | "unavailable" | "quota_exhausted";
  isResolvingPlaces: boolean;
  isBuilding: boolean;
  buildMode: PlannerBuildMode;
  hotelQuery: string;
  pace: Pace;
  travelPreference: TravelPreference;
  dayStartDefault: string;
  destinationChoice: DestinationChoice;
  destinationComboOptions: ReadonlyArray<SearchableOption>;
  resolutionOverrides: readonly ShareableResolutionOverride[];
  placeSuggestions: PlaceSuggestionsState;
  canReviewPlaces: boolean;
  onItineraryChange: (value: string) => void;
  onRequestBuild: () => void;
  onFormatItinerary: () => void;
  onUpdateConstraint: (placeIndex: number, patch: WishlistPlaceConstraintPatch) => void;
  onSelectDays: (value: number) => void;
  onDaysUndecided: () => void;
  onTripDateChange: (value: string) => void;
  onTripDateUndecided: () => void;
  onToggleBuildMode: () => void;
  onHotelQueryChange: (value: string) => void;
  onSelectPace: (value: Pace) => void;
  onSelectTravelPreference: (value: TravelPreference) => void;
  onSelectDayStart: (value: string) => void;
  onDestinationChange: (value: string) => void;
  onSelectPlaceCandidate: (inputIndex: number, providerRef: string) => void;
  onActivePlaceChange: (target: { inputIndex: number; query: string } | null) => void;
  onReviewPlaces: () => void;
  onLoadSample: () => void;
};

export default function PlacesStep({
  locale,
  itinerary,
  startInputError,
  placesInputRef,
  parsePreviewRows,
  parsedPlaceCount,
  canNormalizeItinerary,
  daysUndecided,
  tripDays,
  tripDateTouched,
  tripStartDate,
  placeWarning,
  isResolvingPlaces,
  isBuilding,
  buildMode,
  hotelQuery,
  pace,
  travelPreference,
  dayStartDefault,
  destinationChoice,
  destinationComboOptions,
  resolutionOverrides,
  placeSuggestions,
  canReviewPlaces,
  onItineraryChange,
  onRequestBuild,
  onFormatItinerary,
  onUpdateConstraint,
  onSelectDays,
  onDaysUndecided,
  onTripDateChange,
  onTripDateUndecided,
  onToggleBuildMode,
  onHotelQueryChange,
  onSelectPace,
  onSelectTravelPreference,
  onSelectDayStart,
  onDestinationChange,
  onSelectPlaceCandidate,
  onActivePlaceChange,
  onReviewPlaces,
  onLoadSample,
}: PlacesStepProps) {
  const text = ui[locale];
  return (
    <div className="planner-place-step">
      <div className="planner-place-main">
      <PlaceInputAutocomplete
        describedBy={startInputError ? "planner-start-error" : undefined}
        inputRef={placesInputRef}
        invalid={Boolean(startInputError)}
        label={text.inputLabel}
        locale={locale}
        onActivePlaceChange={onActivePlaceChange}
        onChange={onItineraryChange}
        onRequestBuild={onRequestBuild}
        onSelectCandidate={onSelectPlaceCandidate}
        placeholder={locale === "ja" ? "例：\nラウターブルンネン\nユングフラウヨッホ 必須\nツェルマット" : "e.g.\nLauterbrunnen\nJungfraujoch must\nZermatt"}
        resolutionOverrides={resolutionOverrides}
        suggestions={placeSuggestions}
        value={itinerary}
      />
      <p className="planner-parse-hint">{locale === "ja"
        ? "1行に1か所。入力を止めると候補が出ます。選ぶと同名の都市・店を取り違えません。"
        : "One place per line. Pause to see matches, then choose one to avoid same-name mix-ups."}</p>
      <details className="planner-input-examples">
        <summary>{locale === "ja" ? "入力例を見る" : "See input examples"}</summary>
        <p>{locale === "ja"
          ? "予約時刻や「必須」「時間があれば」も読み取れます。「1日目」の行で日を固定できます。"
          : "Booking times, “must” and “optional” are understood. A “Day 1” line pins places to a day."}</p>
        <pre aria-hidden="true">{locale === "ja"
          ? "1日目\n浅草寺\nチームラボプラネッツ 15:30 予約\n三鷹の森ジブリ美術館 必須\n渋谷スカイ 時間があれば"
          : "Day 1\nSenso-ji\nteamLab Planets 15:30 booked\nGhibli Museum must\nShibuya Sky optional"}</pre>
      </details>
      {startInputError ? (
        <p className="planner-inline-status is-warning" id="planner-start-error" role="alert">
          {startInputError === "empty"
            ? locale === "ja" ? "行きたい場所を入力してください。1行に1か所です。" : "Add the places you want to visit — one per line."
            : locale === "ja" ? `${parsedPlaceCount}件あります。現在は1回最大12件です。12件以下に分けてください。` : `${parsedPlaceCount} places were found. Up to 12 are checked at a time — split the list first.`}
        </p>
      ) : null}

      {parsePreviewRows.length > 0 ? (
        <div className="planner-parse-preview" aria-live="polite">
          <div className="planner-parse-head">
            <span className="planner-parse-title">{text.previewHeading(parsedPlaceCount)}</span>
            {canNormalizeItinerary ? <button onClick={onFormatItinerary} type="button">{text.previewFormat}</button> : null}
          </div>
          <ul>
            {parsePreviewRows.slice(0, 30).map((row, index) => row.type === "day" ? (
              <li className="is-day" key={`row-${index}`}><b>{text.previewDay(row.day)}</b></li>
            ) : row.type === "warn" ? (
              <li className="is-warn" key={`row-${index}`}><span>{row.raw}</span><small>{text.previewUnparsed}</small></li>
            ) : (
              <li key={`row-${index}`}>
                <span>{row.place.name}{resolutionOverrides.some((override) => override.inputIndex === row.placeIndex && "providerRef" in override)
                  ? <small className="planner-parse-place-selected">✓ {locale === "ja" ? "候補選択済み" : "Place selected"}</small>
                  : null}</span>
                <span className="planner-parse-chips">
                  {row.showDay && row.place.day !== null ? <i>{text.previewDay(row.place.day)}</i> : null}
                  {row.place.time ? <i className="is-time">{row.place.time}{row.place.isReservation ? ` ${text.reservation}` : ""}</i> : row.place.isReservation ? <i className="is-time">{text.reservation}</i> : null}
                  {row.place.stayMinutes !== null ? <i>{text.previewStay(row.place.stayMinutes)}</i> : null}
                  <span aria-label={locale === "ja" ? `${row.place.name}の優先度` : `${row.place.name} priority`} className="planner-parse-priority" role="group">
                    {(["normal", "must", "optional"] as const).map((priority) => (
                      <button
                        aria-pressed={row.place.priority === priority}
                        className={row.place.priority === priority ? `is-${priority}` : ""}
                        key={priority}
                        onClick={() => onUpdateConstraint(row.placeIndex, { priority })}
                        type="button"
                      >{locale === "ja"
                        ? { normal: "通常", must: "必須", optional: "任意" }[priority]
                        : { normal: "Normal", must: "Must", optional: "Optional" }[priority]}</button>
                    ))}
                  </span>
                </span>
                <details className="planner-parse-edit">
                  <summary>{locale === "ja" ? "時刻・予約・滞在を編集" : "Edit time, booking and stay"}</summary>
                  <div>
                    <label>
                      <span>{locale === "ja" ? "固定時刻" : "Fixed time"}</span>
                      <input
                        aria-label={locale === "ja" ? `${row.place.name}の固定時刻` : `${row.place.name} fixed time`}
                        onChange={(event) => onUpdateConstraint(row.placeIndex, { time: event.target.value || null })}
                        type="time"
                        value={row.place.time ?? ""}
                      />
                    </label>
                    <label className="planner-parse-booking">
                      <input
                        checked={row.place.isReservation}
                        onChange={(event) => onUpdateConstraint(row.placeIndex, { isReservation: event.target.checked })}
                        type="checkbox"
                      />
                      <span>{locale === "ja" ? "予約済み" : "Booked"}</span>
                    </label>
                    <label>
                      <span>{locale === "ja" ? "滞在（分）" : "Stay (minutes)"}</span>
                      <input
                        inputMode="numeric"
                        max="480"
                        min="15"
                        onChange={(event) => onUpdateConstraint(row.placeIndex, { stayMinutes: event.target.value ? Number(event.target.value) : null })}
                        placeholder={locale === "ja" ? "未入力は推定" : "Estimated if blank"}
                        type="number"
                        value={row.place.stayMinutes ?? ""}
                      />
                    </label>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {parsedPlaceCount > 12 ? (
        <p className="planner-inline-status is-warning" role="alert">
          {locale === "ja"
            ? `${parsedPlaceCount}件あります。現在は1回最大12件です。場所を黙って切り捨てないため、12件以下のまとまりに分けてください。`
            : `${parsedPlaceCount} places were found. This alpha checks up to 12 at a time. Split the list into groups of 12 or fewer so no place is silently omitted.`}
        </p>
      ) : null}

      <section className="planner-quick-conditions" aria-labelledby="planner-quick-conditions-title">
        <header>
          <b id="planner-quick-conditions-title">{locale === "ja" ? "何日くらい？" : "How many days?"}</b>
        </header>
        <div className="planner-days-chips" role="group" aria-label={locale === "ja" ? "旅行日数" : "Trip length"}>
          {[3, 4, 5].map((value) => (
            <button
              aria-pressed={!daysUndecided && tripDays === value}
              className={!daysUndecided && tripDays === value ? "is-active" : ""}
              key={value}
              onClick={() => onSelectDays(value)}
              type="button"
            >{value}</button>
          ))}
          <button
            aria-pressed={daysUndecided}
            className={daysUndecided ? "is-active" : ""}
            onClick={onDaysUndecided}
            type="button"
          >{locale === "ja" ? "まだ決めていない" : "Not decided"}</button>
          <label className="planner-days-other">
            <span>{locale === "ja" ? "他の日数" : "Other"}</span>
            <select
              aria-label={locale === "ja" ? "他の日数を選ぶ" : "Choose another day count"}
              onChange={(event) => onSelectDays(Number(event.target.value))}
              value={daysUndecided ? "" : tripDays}
            >
              <option disabled value="">{locale === "ja" ? "日数" : "days"}</option>
              {Array.from({ length: 14 }, (_, index) => index + 1).map((value) => (
                <option key={value} value={value}>{locale === "ja" ? `${value}日` : `${value} day${value === 1 ? "" : "s"}`}</option>
              ))}
            </select>
          </label>
        </div>
        {daysUndecided ? (
          <p className="planner-days-note">{locale === "ja" ? "場所に合わせて、必要な日数をTripCheckが提案します。" : "TripCheck will propose the day count that fits your places."}</p>
        ) : null}
        <details className="planner-date-disclosure" open={tripDateTouched || undefined}>
          <summary>{locale === "ja" ? "日付を入れる（営業時間・祝日・天気が正確になります）" : "Add dates (sharpens hours, holidays and weather)"}</summary>
          <div className="planner-date-field">
            <label htmlFor="planner-quick-trip-date">
              <span>{text.date}</span>
              <input id="planner-quick-trip-date" onChange={(event) => onTripDateChange(event.target.value)} type="date" value={tripStartDate} />
            </label>
            <button aria-pressed={!tripDateTouched} onClick={onTripDateUndecided} type="button">
              {locale === "ja" ? "日付はまだ未定" : "Date not decided yet"}
            </button>
          </div>
        </details>
      </section>

      <div className="planner-destination-field planner-field planner-place-country">
        <label htmlFor="planner-destination"><span>{text.destination}</span></label>
        <SearchableCombobox
          ariaLabel={text.destination}
          id="planner-destination"
          noResultsLabel={text.noMatchingOption}
          onChange={onDestinationChange}
          options={destinationComboOptions}
          placeholder={text.destinationSearch}
          resultCountLabel={text.optionCount}
          value={destinationChoice}
        />
        <small>{locale === "ja"
          ? "同名の都市・店があるため、国が分かる場合は先に選ぶと検索が正確になります。"
          : "If you know the country, choose it first to disambiguate same-named cities and venues."}</small>
      </div>

      {placeWarning ? <p className="planner-inline-status is-warning" role="status">{placeWarning === "quota_exhausted"
        ? locale === "ja" ? "本日の場所検索の上限に達しました。分かっている場所だけで続け、残りは未解決として表示します（上限は毎日リセットされます）。" : "Today's place-search allowance is used up. Known places continue; the rest stay unresolved (the allowance resets daily)."
        : locale === "ja" ? "位置情報サービスに接続できませんでした。分かる場所だけで続け、残りは未解決として表示します。" : "Place lookup is unavailable. Known places will continue and the rest will stay unresolved."}</p> : null}
      <button aria-busy={isResolvingPlaces || isBuilding} className="planner-build-button planner-review-button" disabled={isBuilding || isResolvingPlaces} onClick={onRequestBuild} type="button">
        <span>{isBuilding
          ? (locale === "ja" ? "旅程を作成中…" : "Building your itinerary…")
          : isResolvingPlaces
            ? (locale === "ja" ? "場所を確認しています…" : "Checking your places…")
            : (locale === "ja" ? "旅程をつくる" : "Build my trip")}</span><b aria-hidden="true"><Icon name="arrow" size={19} /></b>
      </button>

      <details className="planner-advanced-disclosure" open={buildMode === "custom" || undefined}>
        <summary onClick={(event) => { event.preventDefault(); onToggleBuildMode(); }}>
          {locale === "ja" ? "ホテル・空港・ペースを指定する" : "Set hotel, airport or pace"}
        </summary>
        {buildMode === "custom" ? (
        <div className="planner-quick-advanced">
          <label className="planner-hotel-field"><span>{text.hotel}</span><input onChange={(event) => onHotelQueryChange(event.target.value)} placeholder={text.hotelPlaceholder} value={hotelQuery} /></label>
          <div className="planner-core-choices">
            <div className="planner-choice"><span>{text.pace}</span><div className="planner-choice-chips" role="group" aria-label={text.pace}>{(["relaxed", "balanced", "fast"] as const).map((value) => <button aria-pressed={pace === value} className={pace === value ? "is-active" : ""} key={value} onClick={() => onSelectPace(value)} type="button">{text[value]}</button>)}</div></div>
            <div className="planner-choice"><span>{text.travelHeading}</span><div className="planner-choice-chips" role="group" aria-label={text.travelHeading}>{([["auto", text.travelAuto], ["car", text.travelCar]] as const).map(([value, label]) => <button aria-pressed={travelPreference === value} className={travelPreference === value ? "is-active" : ""} key={value} onClick={() => onSelectTravelPreference(value)} type="button">{label}</button>)}</div></div>
            <div className="planner-choice"><span>{text.timebandHeading}</span><div className="planner-choice-chips" role="group" aria-label={text.timebandHeading}>{([["08:00", text.timebandEarly], ["09:00", text.timebandNormal], ["10:30", text.timebandLate]] as const).map(([value, label]) => <button aria-pressed={dayStartDefault === value} className={dayStartDefault === value ? "is-active" : ""} key={value} onClick={() => onSelectDayStart(value)} type="button">{label}</button>)}</div></div>
          </div>
          <button className="planner-secondary-review" disabled={!canReviewPlaces} onClick={onReviewPlaces} type="button">
            {locale === "ja" ? "空港・予約・地点ごとの条件も設定" : "Set airports, bookings and per-place details"}
          </button>
        </div>
        ) : null}
      </details>

      <button className="planner-sample-link" onClick={onLoadSample} type="button">
        <span aria-hidden="true"><Icon name="spark" size={13} /></span>
        <b>{locale === "ja" ? "30秒で完成例を見る" : "See a finished example"}</b>
        <small>{locale === "ja" ? "スイス4日間 · ルート・ホテル・食事つき" : "Switzerland, 4 days · routes, base and meals"}</small>
      </button>
      </div>

      <StartPreviewAside locale={locale} />
    </div>
  );
}
