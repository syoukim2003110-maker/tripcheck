"use client";

// The request the deterministic engine plans from.
//
// Everything here is an input to `buildPlan` and to the feasibility check:
// change one of these and the itinerary can legitimately change. That is the
// point of the split — a design or interaction change touches
// `usePlannerViewState`, and it is visible at a glance that it cannot reach
// any of these. The shell used to declare all 53 of its state slices in one
// block, so the difference between "which panel is open" and "how long the
// trip is" was a matter of reading 50 lines of useState carefully.
//
// A plain state container on purpose. A reducer would move the same fields
// behind a switch statement and change every call site to dispatch, which the
// remediation spec rules out as a bulk rewrite; naming the groups is what
// buys the boundary.
import { useState } from "react";
import type { DestinationChoice } from "../../../../lib/destinations";
import type { AirportCode, MealPlan, Pace } from "../../../../lib/trip-builder";
import type { TravelPreference } from "../../../../lib/time-feasibility";
import { defaultTripDate, type PlannerBuildMode } from "../../../../lib/planner-app-state";
import type { PlannerLocale } from "../../../../lib/presentation/planner-copy";

export function useTripRequestState(initialLocale: PlannerLocale) {
  const [locale, setLocale] = useState<PlannerLocale>(initialLocale);
  // "auto" is the honest default: the first resolved place names the country,
  // so a wishlist works without asking where the trip is before it exists.
  const [destinationChoice, setDestinationChoice] = useState<DestinationChoice>("auto");
  const [itinerary, setItinerary] = useState("");
  const [buildMode, setBuildMode] = useState<PlannerBuildMode>("automatic");
  const [tripDays, setTripDays] = useState(3);
  // v1.1 LIVE-P1-03: "how many days" may stay undecided. TripCheck then
  // proposes the deterministic minimum-day answer during the build.
  const [daysUndecided, setDaysUndecided] = useState(false);
  const [tripStartDate, setTripStartDate] = useState(() => defaultTripDate());
  const [tripDateTouched, setTripDateTouched] = useState(false);
  const [hotelQuery, setHotelQuery] = useState("");
  const [pace, setPace] = useState<Pace>("balanced");
  const [mealPlan, setMealPlan] = useState<MealPlan>("all");
  const [arrivalAirport, setArrivalAirport] = useState<AirportCode>("none");
  const [arrivalTime, setArrivalTime] = useState("");
  const [departureAirport, setDepartureAirport] = useState<AirportCode>("none");
  const [departureTime, setDepartureTime] = useState("");
  const [flightKind, setFlightKind] = useState<"international" | "domestic">("international");
  const [travelPreference, setTravelPreference] = useState<TravelPreference>("auto");
  const [dayStartDefault, setDayStartDefault] = useState("09:00");
  const [dayEndTarget, setDayEndTarget] = useState("");
  const [transferBufferMinutes, setTransferBufferMinutes] = useState<0 | 10 | 20 | 30>(10);
  const [maxWalkingMinutesPerLeg, setMaxWalkingMinutesPerLeg] = useState<number | null>(null);
  const [maxTransfersPerLeg, setMaxTransfersPerLeg] = useState<number | null>(null);

  return {
    locale, setLocale,
    destinationChoice, setDestinationChoice,
    itinerary, setItinerary,
    buildMode, setBuildMode,
    tripDays, setTripDays,
    daysUndecided, setDaysUndecided,
    tripStartDate, setTripStartDate,
    tripDateTouched, setTripDateTouched,
    hotelQuery, setHotelQuery,
    pace, setPace,
    mealPlan, setMealPlan,
    arrivalAirport, setArrivalAirport,
    arrivalTime, setArrivalTime,
    departureAirport, setDepartureAirport,
    departureTime, setDepartureTime,
    flightKind, setFlightKind,
    travelPreference, setTravelPreference,
    dayStartDefault, setDayStartDefault,
    dayEndTarget, setDayEndTarget,
    transferBufferMinutes, setTransferBufferMinutes,
    maxWalkingMinutesPerLeg, setMaxWalkingMinutesPerLeg,
    maxTransfersPerLeg, setMaxTransfersPerLeg,
  };
}
