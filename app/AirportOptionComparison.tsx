"use client";

import { useMemo, useState } from "react";
import { compareAirportOptions, type AirportDirection, type FlightKind } from "../lib/airport-comparison";
import {
  destinationAirportComparisonGroup,
  type Destination,
  type DestinationAirport,
} from "../lib/destinations";

type Candidate = { airportCode: string; time: string };
type CandidateState = { sourceKey: string; candidates: [Candidate, Candidate] };

const copy = {
  en: {
    arrivalTitle: "Compare arrival options",
    departureTitle: "Compare departure options",
    arrivalBoundary: "Ready in the main city",
    departureBoundary: "Leave the main city",
    nextDay: "next day",
    previousDay: "previous day",
    arrivalWinner: "Earliest city-ready time",
    departureWinner: "Latest leave-city time",
    later: (minutes: number) => `${minutes} min later in the city`,
    earlier: (minutes: number) => `${minutes} min earlier departure from the city`,
    arrivalBreakdown: (processing: number, transfer: number) => `After landing: ${processing} min at the airport + ~${transfer} min to the main city`,
    departureBreakdown: (processing: number, transfer: number) => `Before takeoff: ~${transfer} min to the airport + ${processing} min at the airport`,
    tripCheckEstimate: "TripCheck estimate",
    use: "Use this option",
    selected: "Selected",
    source: (code: string) => `Official ${code} airport information`,
    disclaimer: "Prices, availability, baggage rules and delays are not checked. Processing and city-transfer minutes are TripCheck planning assumptions, not facts supplied by the linked airport, and the transfer is to the main city rather than your exact hotel. Confirm the final flight with the airline.",
    option: (label: string) => `Flight option ${label}`,
    airportInput: (label: string) => `Option ${label} airport`,
    arrivalTimeInput: (label: string) => `Option ${label} scheduled arrival time`,
    departureTimeInput: (label: string) => `Option ${label} scheduled departure time`,
    useOption: (label: string, code: string, time: string) => `Use option ${label}: ${code} at ${time}`,
  },
  ja: {
    arrivalTitle: "到着便の候補を比較",
    departureTitle: "出発便の候補を比較",
    arrivalBoundary: "主要市街地で動ける目安",
    departureBoundary: "主要市街地を出る目安",
    nextDay: "翌日",
    previousDay: "前日",
    arrivalWinner: "市街地で動ける時刻が最も早い",
    departureWinner: "市街地を出る時刻が最も遅い",
    later: (minutes: number) => `市街地到着が${minutes}分遅い`,
    earlier: (minutes: number) => `市街地を${minutes}分早く出る`,
    arrivalBreakdown: (processing: number, transfer: number) => `着陸後：空港内 ${processing}分 + 主要市街地まで約${transfer}分`,
    departureBreakdown: (processing: number, transfer: number) => `出発前：空港まで約${transfer}分 + 空港内 ${processing}分`,
    tripCheckEstimate: "TripCheckの推定",
    use: "この候補を使う",
    selected: "選択中",
    source: (code: string) => `${code}空港の公式情報`,
    disclaimer: "航空券価格・空席・手荷物条件・遅延実績は取得していません。空港内と市街地移動の分数は、リンク先空港が示した事実ではなくTripCheckの計画用仮定です。またホテルまでの実測ではありません。最終確認は航空会社で行ってください。",
    option: (label: string) => `便の候補 ${label}`,
    airportInput: (label: string) => `候補${label}の空港`,
    arrivalTimeInput: (label: string) => `候補${label}の到着予定時刻`,
    departureTimeInput: (label: string) => `候補${label}の出発予定時刻`,
    useOption: (label: string, code: string, time: string) => `候補${label}、${code}、${time}を使用`,
  },
} as const;

function initialCandidates(
  airports: readonly DestinationAirport[],
  selectedAirport: string,
  selectedTime: string,
): [Candidate, Candidate] {
  const firstCode = airports.some((airport) => airport.code === selectedAirport)
    ? selectedAirport
    : airports[0]?.code ?? "";
  const secondCode = airports.find((airport) => airport.code !== firstCode)?.code ?? firstCode;
  return [
    { airportCode: firstCode, time: selectedTime },
    { airportCode: secondCode, time: selectedTime },
  ];
}

export default function AirportOptionComparison({
  destination,
  direction,
  flightKind,
  locale,
  selectedAirport,
  selectedTime,
  onUse,
}: {
  destination: Destination;
  direction: AirportDirection;
  flightKind: FlightKind;
  locale: "en" | "ja";
  selectedAirport: string;
  selectedTime: string;
  onUse: (airportCode: string, time: string) => void;
}) {
  const comparisonAirports = useMemo(
    () => destinationAirportComparisonGroup(destination, selectedAirport),
    [destination, selectedAirport],
  );
  const sourceKey = `${destination.id}:${selectedAirport}:${selectedTime}`;
  const [candidateState, setCandidateState] = useState<CandidateState>(() => ({
    sourceKey,
    candidates: initialCandidates(comparisonAirports, selectedAirport, selectedTime),
  }));
  // Prop changes reset the draft immediately, without a one-render stale
  // airport group. Local edits remain intact until the parent selection moves.
  const candidates = candidateState.sourceKey === sourceKey
    ? candidateState.candidates
    : initialCandidates(comparisonAirports, selectedAirport, selectedTime);
  const text = copy[locale];

  const comparison = useMemo(() => compareAirportOptions({
    destination,
    direction,
    flightKind,
    locale,
    options: candidates.map((candidate, index) => ({
      id: index === 0 ? "a" : "b",
      airportCode: candidate.airportCode,
      scheduledLocalTime: candidate.time,
    })),
  }), [candidates, destination, direction, flightKind, locale]);
  const hasComparableTimes = comparison.options.length >= 2;

  if (comparisonAirports.length < 2) return null;

  const update = (index: number, next: Partial<Candidate>) => {
    setCandidateState((current) => {
      const currentCandidates = current.sourceKey === sourceKey ? current.candidates : candidates;
      return {
        sourceKey,
        candidates: currentCandidates.map((candidate, candidateIndex) => (
          candidateIndex === index ? { ...candidate, ...next } : candidate
        )) as [Candidate, Candidate],
      };
    });
  };

  return (
    <details className="planner-airport-comparison">
      <summary>{direction === "arrival" ? text.arrivalTitle : text.departureTitle}</summary>
      <div className="planner-airport-options">
        {candidates.map((candidate, index) => {
          const optionLabel = index === 0 ? "A" : "B";
          const result = comparison.options.find((option) => option.id === (index === 0 ? "a" : "b"));
          const isSelected = selectedAirport === candidate.airportCode && selectedTime === candidate.time;
          const dayLabel = result?.cityDayOffset === 1 ? text.nextDay : result?.cityDayOffset === -1 ? text.previousDay : null;
          return (
            <article className={hasComparableTimes && result?.isTimeWinner ? "is-winner" : ""} key={index === 0 ? "a" : "b"}>
              <div className="planner-airport-option-inputs">
                <b>{optionLabel}</b>
                <label>
                  <span className="sr-only">{text.option(optionLabel)}</span>
                  <select
                    aria-label={text.airportInput(optionLabel)}
                    onChange={(event) => update(index, { airportCode: event.target.value })}
                    value={candidate.airportCode}
                  >
                    {comparisonAirports.map((airport) => (
                      <option key={airport.code} value={airport.code}>
                        {airport.code} — {locale === "ja" ? airport.names.ja : airport.names.en}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="sr-only">{direction === "arrival" ? text.arrivalTitle : text.departureTitle}</span>
                  <input
                    aria-label={direction === "arrival" ? text.arrivalTimeInput(optionLabel) : text.departureTimeInput(optionLabel)}
                    onChange={(event) => update(index, { time: event.target.value })}
                    type="time"
                    value={candidate.time}
                  />
                </label>
              </div>
              {result ? (
                <div aria-live="polite" className="planner-airport-option-result">
                  <span>{result.airportCode} · {result.airportName}</span>
                  <small className="planner-airport-boundary-label">{direction === "arrival" ? text.arrivalBoundary : text.departureBoundary}</small>
                  <b>{result.cityBoundaryTime}{dayLabel ? <small> · {dayLabel}</small> : null}</b>
                  <small>
                    <strong>{text.tripCheckEstimate}:</strong>{" "}
                    {direction === "arrival"
                      ? text.arrivalBreakdown(result.processingMinutes, result.transferMinutes)
                      : text.departureBreakdown(result.processingMinutes, result.transferMinutes)}
                  </small>
                  {hasComparableTimes && result.isTimeWinner
                    ? <em>{direction === "arrival" ? text.arrivalWinner : text.departureWinner}</em>
                    : hasComparableTimes && result.timeDisadvantageMinutes > 0
                      ? <em>{direction === "arrival" ? text.later(result.timeDisadvantageMinutes) : text.earlier(result.timeDisadvantageMinutes)}</em>
                      : null}
                  <a href={result.sourceUrl} rel="noreferrer" target="_blank">{text.source(result.airportCode)} ↗</a>
                </div>
              ) : null}
              {result ? (
                <button
                  aria-label={text.useOption(optionLabel, result.airportCode, result.scheduledLocalTime)}
                  disabled={isSelected}
                  onClick={() => onUse(result.airportCode, result.scheduledLocalTime)}
                  type="button"
                >{isSelected ? text.selected : text.use}</button>
              ) : null}
            </article>
          );
        })}
      </div>
      <small className="planner-airport-disclaimer">{text.disclaimer}</small>
    </details>
  );
}
