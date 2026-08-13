"use client";

// Resolve step (spec v2.1 start/ResolveScreen): the reviewed-place list with
// its status icons, ambiguity questions, not-found recovery (retry, edit,
// manual pin) and per-place constraint editors, the folded trip-condition
// details including flight/airport comparison, and the continue CTA. Renders
// parent-computed review rows and emits events; resolution state, drafts and
// overrides all stay in TripPlannerApp.
import Icon from "../../../PlannerIcons";
import AirportOptionComparison from "../../../AirportOptionComparison";
import SearchableCombobox, { type SearchableOption } from "../../../SearchableCombobox";
import type { AmbiguousPlaceResolution, PlaceReviewStatus } from "../../../../lib/place-resolution-client.ts";
import type { ResolvedInputStop, RouteStop } from "../../../../lib/route-optimizer.ts";
import type { ParsedWishlistPlace, WishlistPlaceConstraintPatch } from "../../../../lib/wishlist-parser.ts";
import type { AirportCode, Pace } from "../../../../lib/trip-builder.ts";
import type { TravelPreference } from "../../../../lib/time-feasibility.ts";
import type { Destination, DestinationChoice } from "../../../../lib/destinations.ts";
import type { ManualPlaceDraft } from "../../../../lib/planner-app-state.ts";
import { placeCandidateLabel, resolvedStopAddress } from "../../../../lib/presentation/trip-presentation.ts";
import { ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";

type ReviewedPlaceRow = {
  place: ParsedWishlistPlace;
  placeIndex: number;
  resolved: ResolvedInputStop | RouteStop | null;
  ambiguity: AmbiguousPlaceResolution | null;
  status: PlaceReviewStatus;
};

type ResolveScreenProps = {
  locale: PlannerLocale;
  reviewedPlaceRows: ReadonlyArray<ReviewedPlaceRow>;
  resolveAttentionRanks: ReadonlyMap<number, number>;
  resolvedStops: ResolvedInputStop[];
  isResolvingPlaces: boolean;
  manualAddressResolution: Readonly<Record<number, "loading" | "failed">>;
  manualPlaceDrafts: Readonly<Record<number, ManualPlaceDraft>>;
  manualPinTarget: number | null;
  manualPinCoordinate: { latitude: number; longitude: number } | null;
  unresolvedReviewedCount: number;
  ambiguousReviewedCount: number;
  confirmedReviewedCount: number;
  destinationChoice: DestinationChoice;
  destinationComboOptions: ReadonlyArray<SearchableOption>;
  /** ISO country codes auto-detection refused to merge; empty when there is no conflict. */
  mixedCountryCodes: readonly string[];
  tripDays: number;
  tripStartDate: string;
  tripDateTouched: boolean;
  hotelQuery: string;
  pace: Pace;
  travelPreference: TravelPreference;
  dayStartDefault: string;
  dayEndTarget: string;
  transferBufferMinutes: 0 | 10 | 20 | 30;
  maxWalkingMinutesPerLeg: number | null;
  maxTransfersPerLeg: number | null;
  arrivalAirport: AirportCode;
  arrivalTime: string;
  departureAirport: AirportCode;
  departureTime: string;
  flightKind: "international" | "domestic";
  airportComboOptions: ReadonlyArray<SearchableOption>;
  arrivalAirportDestination: Destination;
  departureAirportDestination: Destination;
  canBuild: boolean;
  onEditInput: () => void;
  onDestinationChange: (value: string) => void;
  onSearchAgain: () => void;
  onEditPlaceName: () => void;
  onChooseCandidate: (placeIndex: number, candidate: ResolvedInputStop) => void;
  onRejectCandidates: (placeIndex: number, inputName: string) => void;
  onManualDraftChange: (placeIndex: number, field: "address" | "latitude" | "longitude", value: string) => void;
  onToggleManualPin: (placeIndex: number) => void;
  onConfirmManualPlace: (placeIndex: number, name: string) => void;
  onRemovePlace: (placeIndex: number) => void;
  onUpdateConstraint: (placeIndex: number, patch: WishlistPlaceConstraintPatch) => void;
  onChangeTripDays: (days: number) => void;
  onTripDateChange: (value: string) => void;
  onTripDateUndecided: () => void;
  onHotelQueryChange: (value: string) => void;
  onSelectPace: (value: Pace) => void;
  onSelectTravelPreference: (value: TravelPreference) => void;
  onSelectDayStart: (value: string) => void;
  onSelectDayEnd: (value: string) => void;
  onSelectTransferBuffer: (value: 0 | 10 | 20 | 30) => void;
  onChangeMaxWalking: (value: number | null) => void;
  onChangeMaxTransfers: (value: number | null) => void;
  onArrivalAirportChange: (value: AirportCode) => void;
  onArrivalTimeChange: (value: string) => void;
  onDepartureAirportChange: (value: AirportCode) => void;
  onDepartureTimeChange: (value: string) => void;
  onSelectFlightKind: (value: "international" | "domestic") => void;
  onUseArrivalOption: (airportCode: AirportCode, time: string) => void;
  onUseDepartureOption: (airportCode: AirportCode, time: string) => void;
  onContinue: () => void;
};

export default function ResolveScreen({
  locale,
  reviewedPlaceRows,
  resolveAttentionRanks,
  resolvedStops,
  isResolvingPlaces,
  manualAddressResolution,
  manualPlaceDrafts,
  manualPinTarget,
  manualPinCoordinate,
  unresolvedReviewedCount,
  ambiguousReviewedCount,
  confirmedReviewedCount,
  destinationChoice,
  destinationComboOptions,
  mixedCountryCodes,
  tripDays,
  tripStartDate,
  tripDateTouched,
  hotelQuery,
  pace,
  travelPreference,
  dayStartDefault,
  dayEndTarget,
  transferBufferMinutes,
  maxWalkingMinutesPerLeg,
  maxTransfersPerLeg,
  arrivalAirport,
  arrivalTime,
  departureAirport,
  departureTime,
  flightKind,
  airportComboOptions,
  arrivalAirportDestination,
  departureAirportDestination,
  canBuild,
  onEditInput,
  onDestinationChange,
  onSearchAgain,
  onEditPlaceName,
  onChooseCandidate,
  onRejectCandidates,
  onManualDraftChange,
  onToggleManualPin,
  onConfirmManualPlace,
  onRemovePlace,
  onUpdateConstraint,
  onChangeTripDays,
  onTripDateChange,
  onTripDateUndecided,
  onHotelQueryChange,
  onSelectPace,
  onSelectTravelPreference,
  onSelectDayStart,
  onSelectDayEnd,
  onSelectTransferBuffer,
  onChangeMaxWalking,
  onChangeMaxTransfers,
  onArrivalAirportChange,
  onArrivalTimeChange,
  onDepartureAirportChange,
  onDepartureTimeChange,
  onSelectFlightKind,
  onUseArrivalOption,
  onUseDepartureOption,
  onContinue,
}: ResolveScreenProps) {
  const text = ui[locale];
  // Automatic detection stops rather than merge two countries into one trip.
  // The reason has to be on screen: the traveller is standing here because the
  // build refused, not because they navigated back.
  const countryChoiceLeadsHere = mixedCountryCodes.length > 1;
  const resolveEscapeControls = (
    <>
      <div className="planner-resolve-intro">
        <button onClick={onEditInput} type="button">{locale === "ja" ? "入力を直す" : "Edit input"}</button>
      </div>
      {countryChoiceLeadsHere ? (
        <p className="planner-inline-status is-warning planner-resolve-country-conflict" role="status">
          {locale === "ja"
            ? `場所が${mixedCountryCodes.length}か国（${mixedCountryCodes.join("・")}）に分かれています。下で国を選ぶとその範囲で検索し直します。1か国に収まらない旅程は「世界中」を選んでください。`
            : `Your places span ${mixedCountryCodes.length} countries (${mixedCountryCodes.join(", ")}). Choose a country below to search again inside it, or pick “Worldwide” for a trip that genuinely crosses borders.`}
        </p>
      ) : null}
      <div className="planner-destination-field planner-field planner-place-country planner-resolve-country">
        <label htmlFor="planner-resolve-destination"><span>{text.destination}</span></label>
        <SearchableCombobox
          ariaLabel={text.destination}
          id="planner-resolve-destination"
          noResultsLabel={text.noMatchingOption}
          onChange={onDestinationChange}
          options={destinationComboOptions}
          placeholder={text.destinationSearch}
          resultCountLabel={text.optionCount}
          value={destinationChoice}
        />
        <small>{locale === "ja"
          ? "国を選ぶと、現在の入力をその国の範囲で検索し直します。"
          : "Choose a country to search the current input again inside that country."}</small>
      </div>
    </>
  );
  return (
    <div className="planner-conditions-step">
      {/* v1.1 §5.2 Resolve: the escape hatches. Both of them start the search
          over — one by re-opening the raw input, one by re-running it inside a
          chosen country — so they follow the list of what was actually found
          rather than standing between the traveller and it. Above the list
          they cost 139px, which is why the first thing to confirm opened at
          y=375 on a 390x844 screen. The country selector stays permanently
          visible (2026-08-13 product decision); only its position moves.

          A mixed-country result is the exception: automatic detection stopped
          because the places span borders, so choosing the country IS the next
          action and it keeps its place above the list. */}
      {countryChoiceLeadsHere ? resolveEscapeControls : null}
      <section className="planner-resolved-places" aria-labelledby="planner-reviewed-title">
        <ul>
          {reviewedPlaceRows.map((row) => {
            const attentionRank = resolveAttentionRanks.get(row.placeIndex) ?? -1;
            const attentionDeferred = attentionRank >= 3;
            return (
            <li className={`is-${row.status}`} key={`${row.placeIndex}-${row.place.name}`}>
              <span className="planner-place-status" role="img" aria-label={row.status === "confirmed" ? (locale === "ja" ? "確認済み" : "Confirmed") : row.status === "review" ? (locale === "ja" ? "候補を選択" : "Choose a match") : row.status === "parsed" ? (locale === "ja" ? "確認待ち" : "Pending review") : (locale === "ja" ? "未解決" : "Unresolved")}>
                {row.status === "confirmed" ? <Icon name="check" size={11} /> : row.status === "review" ? "!" : row.status === "parsed" ? "…" : "×"}
              </span>
              <span>
                <b>{row.resolved?.name ?? row.place.name}</b>
                {attentionDeferred ? (
                  <small className="planner-resolve-deferred">{locale === "ja" ? "先に上の項目を確認すると、ここが選べるようになります。" : "Settle the items above first — this one unlocks next."}</small>
                ) : row.status === "review" && row.ambiguity ? (
                  <div className="planner-candidate-question">
                    <p>{locale === "ja" ? `どちらの「${row.place.name}」ですか？` : `Which “${row.place.name}” did you mean?`}</p>
                    <div aria-label={locale === "ja" ? `${row.place.name}の候補` : `Candidates for ${row.place.name}`} className="planner-candidate-options" role="group">
                      {row.ambiguity.candidates.slice(0, 3).map((candidate) => (
                        <button key={candidate.id} onClick={() => onChooseCandidate(row.placeIndex, candidate)} type="button">
                          {placeCandidateLabel(candidate, resolvedStops, locale)}
                        </button>
                      ))}
                      <button className="is-none" onClick={() => onRejectCandidates(row.placeIndex, row.place.name)} type="button">
                        {locale === "ja" ? "候補にない（住所で指定）" : "None of these (use an address)"}
                      </button>
                    </div>
                    {row.ambiguity.candidates.length > 3 ? (
                      <select
                        aria-label={locale === "ja" ? `${row.place.name}のその他の候補` : `More candidates for ${row.place.name}`}
                        className="planner-place-candidates"
                        defaultValue=""
                        onChange={(event) => {
                          const selected = row.ambiguity?.candidates.find((candidate) => candidate.id === event.target.value);
                          if (selected) onChooseCandidate(row.placeIndex, selected);
                        }}
                      >
                        <option disabled value="">{locale === "ja" ? "その他の候補から選ぶ…" : "Choose from more candidates…"}</option>
                        {row.ambiguity.candidates.slice(3).map((candidate) => <option key={candidate.id} value={candidate.id}>{placeCandidateLabel(candidate, resolvedStops, locale)}</option>)}
                      </select>
                    ) : null}
                  </div>
                ) : row.status === "confirmed" ? <small>{resolvedStopAddress(row.resolved)}</small> : row.status === "parsed" ? (
                  <small className="planner-resolve-deferred">{locale === "ja" ? "内容が変わったため、もう一度確認します。" : "The input changed — this will be re-checked."}</small>
                ) : (
                  <div className="planner-notfound-block">
                    <p className="planner-notfound-note">{locale === "ja" ? "この場所だけ見つかりませんでした" : "We couldn’t find this place"}</p>
                    <div className="planner-notfound-actions">
                      <button disabled={isResolvingPlaces} onClick={onSearchAgain} type="button">{locale === "ja" ? "もう一度探す" : "Search again"}</button>
                      <button onClick={onEditPlaceName} type="button">{locale === "ja" ? "入力を直す" : "Edit the name"}</button>
                    </div>
                  <details className="planner-manual-place">
                    <summary>{locale === "ja" ? "地図で場所を指定する" : "Pin it on the map"}</summary>
                    <label>
                      <span>{locale === "ja" ? "住所・目印（任意）" : "Address or landmark (optional)"}</span>
                      <input
                        onChange={(event) => onManualDraftChange(row.placeIndex, "address", event.target.value)}
                        value={manualPlaceDrafts[row.placeIndex]?.address ?? ""}
                      />
                    </label>
                    <button
                      aria-pressed={manualPinTarget === row.placeIndex}
                      className="planner-map-pick-button"
                      onClick={() => onToggleManualPin(row.placeIndex)}
                      type="button"
                    >
                      {manualPinTarget === row.placeIndex
                        ? (locale === "ja" ? "地図選択を終了" : "Stop picking on map")
                        : (locale === "ja" ? "地図をクリックして選ぶ" : "Pick by clicking the map")}
                    </button>
                    {manualPinTarget === row.placeIndex ? (
                      <p aria-live="polite" className="planner-map-pick-status">
                        {manualPinCoordinate
                          ? (locale === "ja" ? "地図から座標を取得しました。内容を確認して「この地点を使う」を押してください。" : "Coordinates captured from the map. Review them, then choose Use this point.")
                          : (locale === "ja" ? "右側の地図で地点をクリックしてください。地図が使えない場合は座標を直接入力できます。" : "Click a point on the map. You can still enter coordinates when the interactive map is unavailable.")}
                      </p>
                    ) : null}
                    <div>
                      <label><span>{locale === "ja" ? "緯度" : "Latitude"}</span><input inputMode="decimal" onChange={(event) => onManualDraftChange(row.placeIndex, "latitude", event.target.value)} placeholder="35.6812" value={manualPlaceDrafts[row.placeIndex]?.latitude ?? ""} /></label>
                      <label><span>{locale === "ja" ? "経度" : "Longitude"}</span><input inputMode="decimal" onChange={(event) => onManualDraftChange(row.placeIndex, "longitude", event.target.value)} placeholder="139.7671" value={manualPlaceDrafts[row.placeIndex]?.longitude ?? ""} /></label>
                    </div>
                    <button disabled={manualAddressResolution[row.placeIndex] === "loading"} onClick={() => onConfirmManualPlace(row.placeIndex, row.place.name)} type="button">
                      {manualAddressResolution[row.placeIndex] === "loading" ? text.manualAddressResolving : (locale === "ja" ? "この地点を使う" : "Use this point")}
                    </button>
                    {manualAddressResolution[row.placeIndex] === "failed" ? (
                      <p className="planner-inline-status is-warning" role="status">{text.manualAddressNotFound}</p>
                    ) : null}
                    <small>{locale === "ja" ? "住所だけでも大丈夫です（座標は住所から探します）。提供元の確認済み地点ではなく、あなたが指定した地点として表示します。" : "An address alone is enough — its coordinates are looked up for you. This stays labelled as a traveller-supplied point, not a provider-verified place."}</small>
                  </details>
                  </div>
                )}
                <details className="planner-place-constraints">
                  <summary>{locale === "ja" ? "予約・時刻・滞在を編集" : "Edit booking, time and stay"}</summary>
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
                    <label className="planner-booking-toggle">
                      <input
                        checked={row.place.isReservation}
                        onChange={(event) => onUpdateConstraint(row.placeIndex, { isReservation: event.target.checked })}
                        type="checkbox"
                      />
                      <span>{locale === "ja" ? "予約済み（Mustとして固定）" : "Booked (protect as Must)"}</span>
                    </label>
                    <label>
                      <span>{locale === "ja" ? "滞在時間（分）" : "Stay (minutes)"}</span>
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
              </span>
              {row.place.isReservation ? (
                <span className="planner-booked-badge">{locale === "ja" ? "予約・必須" : "Booked · Must"}</span>
              ) : (
                <div aria-label={locale === "ja" ? `${row.place.name}の優先度` : `${row.place.name} priority`} className="planner-priority-picker" role="group">
                  {(["normal", "must", "optional"] as const).map((priority) => (
                    <button
                      aria-pressed={row.place.priority === priority}
                      className={row.place.priority === priority ? `is-${priority}` : ""}
                      key={priority}
                      onClick={() => {
                        onUpdateConstraint(row.placeIndex, { priority });
                      }}
                      type="button"
                    >{locale === "ja"
                      ? { normal: "通常", must: "必須", optional: "任意" }[priority]
                      : { normal: "Normal", must: "Must", optional: "Optional" }[priority]}</button>
                  ))}
                </div>
              )}
              {/* v1.1 TC-020: every row can be taken out of the pending input
                  here — the textarea line and the resolved row leave together.
                  Must/booked rows confirm first via the shared hard-edit
                  dialog; nothing protected vanishes silently. */}
              <button
                aria-label={text.resolveRemoveAria(row.place.name)}
                className="planner-place-remove"
                onClick={() => onRemovePlace(row.placeIndex)}
                title={text.resolveRemoveAria(row.place.name)}
                type="button"
              >{text.resolveRemove}</button>
            </li>
            );
          })}
        </ul>
        {unresolvedReviewedCount > 0 ? <p className="planner-inline-status is-warning" role="status">{locale === "ja" ? `${unresolvedReviewedCount}件は未解決です。確認が終わるまで結論を出しません。` : `${unresolvedReviewedCount} place${unresolvedReviewedCount === 1 ? " is" : "s are"} unresolved. The result stays conditional until they are confirmed.`}</p> : null}
        {ambiguousReviewedCount > 0 ? <p className="planner-inline-status is-warning" role="status">{locale === "ja" ? `${ambiguousReviewedCount}件は同名候補があります。住所を見て選んでください。` : `${ambiguousReviewedCount} place${ambiguousReviewedCount === 1 ? " has" : "s have"} same-name matches. Choose by address.`}</p> : null}
      </section>
      {countryChoiceLeadsHere ? null : resolveEscapeControls}

      {/* v1.1 §5.2: the Resolve step is about places. Trip conditions
          stay reachable but folded away, mirroring the Start screen. */}
      <details className="planner-details planner-resolve-conditions">
        <summary>{locale === "ja" ? "日数・ホテル・ペースなどの条件を調整（任意）" : "Adjust days, hotel, pace and more (optional)"}<span aria-hidden="true"><Icon name="plus" size={15} /></span></summary>

      <div className="planner-primary-fields">
        <label><span>{text.days}</span><select onChange={(event) => onChangeTripDays(Number(event.target.value))} value={tripDays}>{Array.from({ length: 14 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{locale === "ja" ? `${value}日` : `${value} day${value === 1 ? "" : "s"}`}</option>)}</select></label>
        <div className="planner-date-field">
          <label htmlFor="planner-trip-date"><span>{text.date}</span><input id="planner-trip-date" onChange={(event) => onTripDateChange(event.target.value)} type="date" value={tripStartDate} /></label>
          <button aria-pressed={!tripDateTouched} onClick={onTripDateUndecided} type="button">{locale === "ja" ? "日付はまだ未定" : "Date not decided yet"}</button>
          {!tripDateTouched ? <small>{locale === "ja" ? "表示日は計算用の仮日付です。曜日・営業時間は確定条件に使いません。" : "The visible date is a planning placeholder. Weekday and opening hours will not be treated as confirmed constraints."}</small> : null}
        </div>
      </div>

      <label className="planner-hotel-field"><span>{text.hotel}</span><input onChange={(event) => onHotelQueryChange(event.target.value)} placeholder={text.hotelPlaceholder} value={hotelQuery} /></label>

      <div className="planner-core-choices">
        <div className="planner-choice"><span>{text.pace}</span><div className="planner-choice-chips" role="group" aria-label={text.pace}>{(["relaxed", "balanced", "fast"] as const).map((value) => <button aria-pressed={pace === value} className={pace === value ? "is-active" : ""} key={value} onClick={() => onSelectPace(value)} type="button">{text[value]}</button>)}</div></div>
        <div className="planner-choice"><span>{text.travelHeading}</span><div className="planner-choice-chips" role="group" aria-label={text.travelHeading}>{([["auto", text.travelAuto], ["car", text.travelCar]] as const).map(([value, label]) => <button aria-pressed={travelPreference === value} className={travelPreference === value ? "is-active" : ""} key={value} onClick={() => onSelectTravelPreference(value)} type="button">{label}</button>)}</div></div>
        <div className="planner-choice"><span>{text.timebandHeading}</span><div className="planner-choice-chips" role="group" aria-label={text.timebandHeading}>{([["08:00", text.timebandEarly], ["09:00", text.timebandNormal], ["10:30", text.timebandLate]] as const).map(([value, label]) => <button aria-pressed={dayStartDefault === value} className={dayStartDefault === value ? "is-active" : ""} key={value} onClick={() => onSelectDayStart(value)} type="button">{label}</button>)}</div></div>
        <div className="planner-choice"><span>{text.dayEndHeading}</span><div className="planner-choice-chips" role="group" aria-label={text.dayEndHeading}>{([["", text.dayEndNone], ["19:30", "19:30"], ["21:30", "21:30"]] as const).map(([value, label]) => <button aria-pressed={dayEndTarget === value} className={dayEndTarget === value ? "is-active" : ""} key={value || "none"} onClick={() => onSelectDayEnd(value)} type="button">{label}</button>)}</div></div>
        <div className="planner-choice"><span>{locale === "ja" ? "移動ごとの余白" : "Buffer after each leg"}</span><div className="planner-choice-chips" role="group" aria-label={locale === "ja" ? "移動ごとの余白" : "Buffer after each leg"}>{([0, 10, 20, 30] as const).map((value) => <button aria-pressed={transferBufferMinutes === value} className={transferBufferMinutes === value ? "is-active" : ""} key={value} onClick={() => onSelectTransferBuffer(value)} type="button">{value}{locale === "ja" ? "分" : " min"}</button>)}</div></div>
        <label className="planner-choice planner-number-choice">
          <span>{locale === "ja" ? "1区間の徒歩上限（任意）" : "Max walking per leg (optional)"}</span>
          <input max="180" min="5" onChange={(event) => onChangeMaxWalking(event.target.value ? Number(event.target.value) : null)} placeholder={locale === "ja" ? "標準 30分" : "Default 30 min"} type="number" value={maxWalkingMinutesPerLeg ?? ""} />
          <small>{locale === "ja" ? "超える徒歩は他の移動手段を優先します。" : "Longer walks are deprioritised when another mode is available."}</small>
        </label>
        <label className="planner-choice planner-number-choice">
          <span>{locale === "ja" ? "1区間の乗換上限（任意）" : "Max transfers per leg (optional)"}</span>
          <input max="8" min="0" onChange={(event) => onChangeMaxTransfers(event.target.value ? Number(event.target.value) : null)} placeholder={locale === "ja" ? "標準 2回" : "Default 2"} type="number" value={maxTransfersPerLeg ?? ""} />
          <small>{locale === "ja" ? "乗換回数を取得できない区間は未確認と表示します。" : "A leg remains unverified when transfer-step data is unavailable."}</small>
        </label>
      </div>

      <details className="planner-details">
        <summary>{locale === "ja" ? "フライト・空港の条件" : "Flight and airport constraints"}<span aria-hidden="true"><Icon name="plus" size={15} /></span></summary>
        <div className="planner-detail-grid">
          <div className="planner-field"><label htmlFor="planner-arrival-airport"><span>{text.arrival}</span></label><SearchableCombobox ariaLabel={text.arrival} id="planner-arrival-airport" noResultsLabel={text.noMatchingOption} onChange={(value) => onArrivalAirportChange(value as AirportCode)} options={airportComboOptions} placeholder={text.airportSearch} resultCountLabel={text.optionCount} value={arrivalAirport} /></div>
          <label><span>{text.arrivalTime}</span><input disabled={arrivalAirport === "none"} onChange={(event) => onArrivalTimeChange(event.target.value)} type="time" value={arrivalTime} /></label>
          <div className="planner-field"><label htmlFor="planner-departure-airport"><span>{text.departure}</span></label><SearchableCombobox ariaLabel={text.departure} id="planner-departure-airport" noResultsLabel={text.noMatchingOption} onChange={(value) => onDepartureAirportChange(value as AirportCode)} options={airportComboOptions} placeholder={text.airportSearch} resultCountLabel={text.optionCount} value={departureAirport} /></div>
          <label><span>{text.departureTime}</span><input disabled={departureAirport === "none"} onChange={(event) => onDepartureTimeChange(event.target.value)} type="time" value={departureTime} /></label>
          {arrivalAirport !== "none" || departureAirport !== "none" ? <div className="planner-choice"><span>{text.flightKindHeading}</span><div className="planner-choice-chips" role="group" aria-label={text.flightKindHeading}>{([["international", text.flightInternational], ["domestic", text.flightDomestic]] as const).map(([value, label]) => <button aria-pressed={flightKind === value} className={flightKind === value ? "is-active" : ""} key={value} onClick={() => onSelectFlightKind(value)} type="button">{label}</button>)}</div></div> : null}
          {arrivalAirport !== "none" ? <AirportOptionComparison destination={arrivalAirportDestination} direction="arrival" flightKind={flightKind} key={`${arrivalAirportDestination.id}-arrival`} locale={locale} onUse={onUseArrivalOption} selectedAirport={arrivalAirport} selectedTime={arrivalTime} /> : null}
          {departureAirport !== "none" ? <AirportOptionComparison destination={departureAirportDestination} direction="departure" flightKind={flightKind} key={`${departureAirportDestination.id}-departure`} locale={locale} onUse={onUseDepartureOption} selectedAirport={departureAirport} selectedTime={departureTime} /> : null}
        </div>
      </details>

      </details>

      <button className="planner-build-button" disabled={!canBuild} onClick={onContinue} type="button">
        <span>{locale === "ja"
          ? `${confirmedReviewedCount}か所で続ける`
          : `Continue with ${confirmedReviewedCount} place${confirmedReviewedCount === 1 ? "" : "s"}`}</span><b aria-hidden="true"><Icon name="arrow" size={19} /></b>
      </button>
    </div>
  );
}
