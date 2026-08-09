import { destinationAirport, type Destination } from "./destinations.ts";

export type FlightKind = "international" | "domestic";
export type AirportDirection = "arrival" | "departure";

export type AirportOptionInput = {
  id: string;
  airportCode: string;
  /** Scheduled local airport time, HH:mm. */
  scheduledLocalTime: string;
  /** A selected hotel's live route may replace the destination estimate. */
  transferMinutes?: number;
};

export type AirportComparisonInput = {
  destination: Destination;
  direction: AirportDirection;
  flightKind: FlightKind;
  options: readonly AirportOptionInput[];
  locale?: "en" | "ja";
};

export type AirportOptionResult = {
  id: string;
  airportCode: string;
  airportName: string;
  scheduledLocalTime: string;
  /** Arrival: ready in the main city. Departure: leave the main city. */
  cityBoundaryTime: string;
  cityDayOffset: -1 | 0 | 1;
  processingMinutes: number;
  transferMinutes: number;
  timeDisadvantageMinutes: number;
  isTimeWinner: boolean;
  sourceUrl: string;
  evidence: {
    processing: "product_assumption";
    transfer: "destination_profile_estimate" | "live_selected_hotel_route";
  };
};

export type AirportComparisonResult = {
  direction: AirportDirection;
  options: AirportOptionResult[];
  /** First option at the best time; ties remain visible on every option. */
  timeWinnerId: string | null;
};

function clockMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function clock(value: number) {
  const normalized = ((value % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function dayOffset(value: number): -1 | 0 | 1 {
  return value < 0 ? -1 : value >= 1440 ? 1 : 0;
}

/**
 * Compares traveller-supplied flight candidates by usable trip time only.
 * It deliberately performs no provider, price or AI call.
 */
export function compareAirportOptions(input: AirportComparisonInput): AirportComparisonResult {
  const options = input.options.flatMap((option) => {
    const airport = destinationAirport(input.destination, option.airportCode);
    const scheduled = clockMinutes(option.scheduledLocalTime);
    if (!airport || scheduled === null) return [];

    const hasLiveTransfer = typeof option.transferMinutes === "number"
      && Number.isFinite(option.transferMinutes)
      && option.transferMinutes > 0;
    const transferMinutes = hasLiveTransfer
      ? Math.round(option.transferMinutes!)
      : airport.transferMinutes;
    const processingMinutes = input.direction === "arrival"
      ? input.flightKind === "international" ? 90 : 45
      : input.flightKind === "international" ? airport.internationalDepartureMinutes : 90;
    const absoluteBoundary = input.direction === "arrival"
      ? scheduled + processingMinutes + transferMinutes
      : scheduled - processingMinutes - transferMinutes;

    return [{
      id: option.id,
      airportCode: airport.code,
      airportName: input.locale === "ja" ? airport.names.ja : airport.names.en,
      scheduledLocalTime: clock(scheduled),
      cityBoundaryTime: clock(absoluteBoundary),
      cityDayOffset: dayOffset(absoluteBoundary),
      processingMinutes,
      transferMinutes,
      timeDisadvantageMinutes: 0,
      isTimeWinner: false,
      sourceUrl: airport.sourceUrl,
      evidence: {
        processing: "product_assumption" as const,
        transfer: hasLiveTransfer
          ? "live_selected_hotel_route" as const
          : "destination_profile_estimate" as const,
      },
      absoluteBoundary,
    }];
  });

  if (options.length === 0) return { direction: input.direction, options: [], timeWinnerId: null };
  const winningBoundary = input.direction === "arrival"
    ? Math.min(...options.map((option) => option.absoluteBoundary))
    : Math.max(...options.map((option) => option.absoluteBoundary));

  return {
    direction: input.direction,
    timeWinnerId: options.find((option) => option.absoluteBoundary === winningBoundary)?.id ?? null,
    options: options.map(({ absoluteBoundary, ...option }) => ({
      ...option,
      timeDisadvantageMinutes: input.direction === "arrival"
        ? absoluteBoundary - winningBoundary
        : winningBoundary - absoluteBoundary,
      isTimeWinner: absoluteBoundary === winningBoundary,
    })),
  };
}
