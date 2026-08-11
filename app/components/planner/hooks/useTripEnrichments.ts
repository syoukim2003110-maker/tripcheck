"use client";

// Trip enrichments (refactor spec v2.1 hooks/): the AI-availability probe and
// the plan-derived enrichment fetches — per-day weather, public holidays and
// lazy Open Graph source previews. Owns that state and its fetch effects;
// TripPlannerApp consumes the values and never calls the clients directly.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestLinkPreview } from "../../../../lib/link-preview-client";
import { requestAiStatus } from "../../../../lib/ai-status-client";
import { buildWeatherPayload, requestWeatherPayload } from "../../../../lib/weather-client";
import type { TripWeatherDay } from "../../../../lib/weather";
import { buildHolidaysPayload, requestHolidays } from "../../../../lib/holidays-client";
import type { TripHoliday } from "../../../../lib/holidays";
import type { BuiltTripPlan } from "../../../../lib/trip-builder";
import type { Destination } from "../../../../lib/destinations";
import {
  P0_CORE_ONLY,
  P1_TRAVEL_ENRICHMENTS,
  type SourcePreviewState,
} from "../../../../lib/planner-app-state";

export function useTripEnrichments({ plan, activeDestination }: {
  plan: BuiltTripPlan | null;
  activeDestination: Destination;
}) {
  const [weatherByDay, setWeatherByDay] = useState<Record<number, TripWeatherDay>>({});
  const [holidaysByDate, setHolidaysByDate] = useState<Record<string, TripHoliday>>({});
  const [sourcePreviews, setSourcePreviews] = useState<Record<string, SourcePreviewState>>({});
  // Whether the server accepts Claude-backed requests. While paused, the AI
  // surfaces (concept drafts, social checks) are hidden instead of failing.
  const [aiEnabled, setAiEnabled] = useState(false);
  const aiEnabledRef = useRef(false);

  useEffect(() => {
    if (P0_CORE_ONLY) return;
    let cancelled = false;
    void requestAiStatus().then((enabled) => {
      if (cancelled) return;
      aiEnabledRef.current = enabled;
      setAiEnabled(enabled);
    });
    return () => { cancelled = true; };
  }, []);

  // Per-day forecast, keyed on the coordinate-only payload itself: the fetch
  // re-runs only when a day's date or centroid actually changes, not on every
  // unrelated plan tweak. Weather never gates the plan — failures just leave
  // the chips off.
  const weatherSignature = useMemo(() => {
    if (!plan) return "";
    const payload = buildWeatherPayload(plan);
    return payload ? JSON.stringify(payload) : "";
  }, [plan]);
  useEffect(() => {
    if (!P1_TRAVEL_ENRICHMENTS) {
      setWeatherByDay({});
      return;
    }
    if (!weatherSignature) {
      setWeatherByDay({});
      return;
    }
    let stale = false;
    void requestWeatherPayload(JSON.parse(weatherSignature)).then((result) => {
      if (!stale) setWeatherByDay(result);
    });
    return () => { stale = true; };
  }, [weatherSignature]);

  // Holiday overlay, same contract as the forecast: country code + bare dates
  // in, per-date warnings out, failures leave the plan untouched. This exists
  // because Google's weekly opening patterns are silently wrong on public
  // holidays and its dated hours only cover the next 7 days.
  const holidaysSignature = useMemo(() => {
    if (!plan) return "";
    const payload = buildHolidaysPayload(plan, activeDestination.countryCodes[0] ?? null);
    return payload ? JSON.stringify(payload) : "";
  }, [plan, activeDestination]);
  useEffect(() => {
    if (!P1_TRAVEL_ENRICHMENTS) {
      setHolidaysByDate({});
      return;
    }
    if (!holidaysSignature) {
      setHolidaysByDate({});
      return;
    }
    let stale = false;
    void requestHolidays(JSON.parse(holidaysSignature)).then((result) => {
      if (!stale) setHolidaysByDate(result);
    });
    return () => { stale = true; };
  }, [holidaysSignature]);

  // Open Graph thumbnails for public-source cards, fetched lazily when the
  // source list is opened and cached for the session. Failures fall back to
  // the media-kind badge that is always rendered.
  const requestedSourcePreviewsRef = useRef<Set<string>>(new Set());
  const ensureSourcePreviews = useCallback((urls: string[]) => {
    const missing = urls.filter((url) => url.startsWith("https://") && !requestedSourcePreviewsRef.current.has(url)).slice(0, 3);
    if (missing.length === 0) return;
    for (const url of missing) requestedSourcePreviewsRef.current.add(url);
    setSourcePreviews((state) => ({
      ...state,
      ...Object.fromEntries(missing.map((url) => [url, { status: "loading", imageUrl: null } satisfies SourcePreviewState])),
    }));
    for (const url of missing) {
      void requestLinkPreview(url)
        .then((preview) => {
          setSourcePreviews((state) => ({ ...state, [url]: { status: "ready", imageUrl: preview.imageUrl } }));
        })
        .catch(() => {
          setSourcePreviews((state) => ({ ...state, [url]: { status: "failed", imageUrl: null } }));
        });
    }
  }, []);

  return { weatherByDay, holidaysByDate, aiEnabled, aiEnabledRef, sourcePreviews, ensureSourcePreviews };
}
