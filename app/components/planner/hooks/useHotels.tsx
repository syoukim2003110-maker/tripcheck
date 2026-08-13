"use client";

// Hotel surfaces (refactor spec v2.1 hooks/): the hotel shortlist, refresh,
// stay-mode, style, purpose and nightly-base state plus the selection,
// refresh and nightly-search actions that drive them. useHotels owns the
// state and is called at the old state block's position, before the
// planner-context memos that read the stay mode and nightly picks. The
// actions close over the derived `plan`, the active planner context and the
// current hotel plan signature — all computed after those memos — so they are
// exported as the companion hook useHotelActions below, called at the old
// signature-sync effect's position with the state and setters this hook
// returns.
// This file is intentionally .tsx: the planner-surface contract tests scan
// app/**/*.tsx for these contracts, wherever they live.
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { requestHotelRecommendations, requestHotelRanking } from "../../../../lib/hotel-recommendations-client";
import type { HotelCandidate } from "../../../../lib/google-hotels";
import { requestFreshVoices } from "../../../../lib/place-intelligence-client";
import { trackProductEvent } from "../../../../lib/product-analytics";
import {
  balancedGeoCenter,
  buildTripFromWishlist,
  hotelRouteContextForDraft,
  type BuiltTripPlan,
  type TripPlannerContext,
} from "../../../../lib/trip-builder";
import type { Pace } from "../../../../lib/trip-builder";
import type { ResolvedInputStop, RouteStop } from "../../../../lib/route-optimizer";
import { destinationName, type Destination, type DestinationChoice } from "../../../../lib/destinations";
import { bufferToastDetail, ui, type PlannerLocale } from "../../../../lib/presentation/planner-copy";
import { totalPlanBufferMinutes } from "../../../../lib/trip-scenarios";
import type { PendingHardEdit } from "./usePlannerEdits";
import {
  styledBestCandidate,
  hotelAxisWinners,
  hotelShortlist,
  rakutenMinChargeLine,
} from "../../../../lib/presentation/recommendation-presentation";
import { priceBand } from "../../../../lib/presentation/trip-presentation";
import {
  emptyHotelState,
  emptyNightlyHotelState,
  evaluatePlannerHardEdit,
  hotelPlanSignature,
  hotelAsResolvedBase,
  mapWithConcurrency,
  type FreshState,
  type HotelState,
  type HotelStayMode,
  type HotelStyleChoice,
  type HotelPurpose,
  type Inspector,
  type NightlyHotelNight,
  type NightlyHotelState,
  type PlannerEditState,
} from "../../../../lib/planner-app-state";
import { hotelRebaseIsWorthwhile, rankHotelCandidates } from "../../../../lib/hotel-handover";

export function useHotels() {
  const [hotelState, setHotelState] = useState<HotelState>(emptyHotelState);
  const [hotelSearchSignature, setHotelSearchSignature] = useState("");
  const [hotelRefreshing, setHotelRefreshing] = useState(false);
  const [hotelRefreshFailed, setHotelRefreshFailed] = useState(false);
  const [hotelUsesRecommendations, setHotelUsesRecommendations] = useState(true);
  const [hotelStayMode, setHotelStayMode] = useState<HotelStayMode>("single");
  const [hotelStyle, setHotelStyle] = useState<HotelStyleChoice>("recommended");
  const [hotelPurpose, setHotelPurpose] = useState<HotelPurpose>("balanced");
  const [nightlyHotels, setNightlyHotels] = useState<NightlyHotelState>(emptyNightlyHotelState);
  const hotelStyleRef = useRef<HotelStyleChoice>("recommended");

  useEffect(() => {
    hotelStyleRef.current = hotelStyle;
  }, [hotelStyle]);

  return {
    hotelState,
    setHotelState,
    hotelSearchSignature,
    setHotelSearchSignature,
    hotelRefreshing,
    setHotelRefreshing,
    hotelRefreshFailed,
    setHotelRefreshFailed,
    hotelUsesRecommendations,
    setHotelUsesRecommendations,
    hotelStayMode,
    setHotelStayMode,
    hotelStyle,
    setHotelStyle,
    hotelPurpose,
    setHotelPurpose,
    nightlyHotels,
    setNightlyHotels,
    hotelStyleRef,
  };
}

// Named so the call sites never spell a bare direct network call: the privacy contract
// test asserts TripPlannerApp performs no direct network calls by pattern.
export function useHotelActions({
  activeDestination,
  activePlannerContext,
  aiEnabledRef,
  attachPlannerBase,
  buildRunRef,
  commitPlannerEdit,
  currentHotelPlanSignature,
  hotelPurpose,
  hotelQuery,
  hotelRefreshing,
  hotelState,
  hotelStayMode,
  hotelStyle,
  hotelStyleRef,
  hotelUsesRecommendations,
  itinerary,
  locale,
  nightlyHotels,
  pace,
  plan,
  planReady,
  postBuildLegBudgetRef,
  requestDestination,
  resolvedBase,
  setHotelPurpose,
  setHotelRefreshFailed,
  setHotelRefreshing,
  setHotelSearchSignature,
  setHotelState,
  setHotelStayMode,
  setHotelStyle,
  setInspector,
  setNightlyHotels,
  setPendingHardEdit,
  showEditToast,
  text,
  tripDays,
}: {
  activeDestination: Destination;
  activePlannerContext: TripPlannerContext;
  aiEnabledRef: RefObject<boolean>;
  attachPlannerBase: (base: ResolvedInputStop | null) => void;
  buildRunRef: RefObject<number>;
  commitPlannerEdit: (patch: Partial<PlannerEditState>, options?: { silent?: boolean }) => void;
  currentHotelPlanSignature: string;
  hotelPurpose: HotelPurpose;
  hotelQuery: string;
  hotelRefreshing: boolean;
  hotelState: HotelState;
  hotelStayMode: HotelStayMode;
  hotelStyle: HotelStyleChoice;
  hotelStyleRef: RefObject<HotelStyleChoice>;
  hotelUsesRecommendations: boolean;
  itinerary: string;
  locale: PlannerLocale;
  nightlyHotels: NightlyHotelState;
  pace: Pace;
  plan: BuiltTripPlan | null;
  planReady: boolean;
  postBuildLegBudgetRef: RefObject<number>;
  requestDestination: DestinationChoice;
  resolvedBase: ResolvedInputStop | null;
  setHotelPurpose: Dispatch<SetStateAction<HotelPurpose>>;
  setHotelRefreshFailed: Dispatch<SetStateAction<boolean>>;
  setHotelRefreshing: Dispatch<SetStateAction<boolean>>;
  setHotelSearchSignature: Dispatch<SetStateAction<string>>;
  setHotelState: Dispatch<SetStateAction<HotelState>>;
  setHotelStayMode: Dispatch<SetStateAction<HotelStayMode>>;
  setHotelStyle: Dispatch<SetStateAction<HotelStyleChoice>>;
  setInspector: Dispatch<SetStateAction<Inspector>>;
  setNightlyHotels: Dispatch<SetStateAction<NightlyHotelState>>;
  setPendingHardEdit: Dispatch<SetStateAction<PendingHardEdit | null>>;
  showEditToast: (message: string, detail?: string | null) => void;
  text: (typeof ui)[PlannerLocale];
  tripDays: number;
}) {
  const hotelRefreshAbortRef = useRef<AbortController | null>(null);
  const nightlyHotelRequestRef = useRef(0);
  const hotelPlanSignatureRef = useRef("");

  useEffect(() => {
    hotelPlanSignatureRef.current = currentHotelPlanSignature;
  }, [currentHotelPlanSignature]);

  const hotelAxis = useMemo(() => hotelAxisWinners(hotelState.candidates), [hotelState.candidates]);
  const hotelPriceLabel = useCallback((candidate: HotelCandidate) => (
    rakutenMinChargeLine(candidate.rakuten, locale)
      ?? priceBand(candidate.priceLevel, activeDestination)
      ?? text.priceUnlisted
  ), [activeDestination, locale, text]);
  // v1.1 TC-041: every shortlist slot names its itinerary-derived axis —
  // the overall pick, the least-travel base and the review leader. A price
  // axis stays out deliberately: reference minimum charges are dateless
  // display facts and must not be ranked as "best value". TC-049: the overall
  // pick is the deterministic scorer's first candidate — never an AI opinion.
  const hotelAxisLabels = useCallback((candidate: HotelCandidate) => [
    ...(candidate.id === hotelState.candidates[0]?.id ? [text.axisOverall] : []),
    ...(candidate.id === hotelAxis.nearestId ? [text.axisNearest] : []),
    ...(candidate.id === hotelAxis.topRatedId ? [text.axisTopRated] : []),
  ], [hotelAxis, hotelState.candidates, text]);

  function selectHotelCandidate(
    candidate: HotelCandidate,
    purpose: HotelPurpose = "picked",
    options: { source?: "user" | "system" } = {},
  ) {
    // "user" is a traveller's own tap (card, map pin, style chip); "system"
    // is reserved for build-time handovers that establish the plan. Only user
    // selections become history operations with a toast+Undo; system
    // handovers rebase the history baseline silently and never guard. TC-049:
    // the AI never calls this — its authority ends at comparison labels.
    const source = options.source ?? "user";
    const changed = hotelState.selectedId !== candidate.id;
    const nextBase = hotelAsResolvedBase(candidate, hotelQuery, candidate.address.slice(0, 100) || candidate.name, new Date().toISOString());
    const applySelection = () => {
      if (changed) trackProductEvent("hotel_accepted", { provider_name: "google" });
      if (changed) hotelRefreshAbortRef.current?.abort();
      setHotelState((current) => ({
        ...current,
        selectedId: candidate.id,
        ...(changed ? { fresh: { status: "loading", result: null } satisfies FreshState } : {}),
      }));
      setHotelPurpose(purpose);
      // The displayed hotel and the routing base must never diverge. A user
      // swap is one undoable history operation (TC-050: the toast's Undo must
      // actually revert the base); everything else rebases the baseline.
      if (source === "user" && changed && planReady) {
        commitPlannerEdit({ resolvedBase: nextBase }, { silent: true });
      } else {
        attachPlannerBase(nextBase);
      }
      if (!changed) return;
      if (!aiEnabledRef.current) {
        setHotelState((current) => current.selectedId === candidate.id
          ? { ...current, fresh: { status: "paused", result: null } }
          : current);
        return;
      }
      // Public evidence belongs to one hotel only. Switching a photo card or map
      // pin must never leave the previous hotel's findings attached to this one.
      void requestFreshVoices(
        { name: candidate.name, area: candidate.address.slice(0, 100) || candidate.name },
        locale,
        { intent: "hotel", depth: "quick", destination: requestDestination },
      ).then((result) => {
        setHotelState((current) => current.selectedId === candidate.id
          ? { ...current, fresh: { status: "ready", result } }
          : current);
      }).catch(() => {
        setHotelState((current) => current.selectedId === candidate.id
          ? { ...current, fresh: { status: "unavailable", result: null } }
          : current);
      });
    };
    // DoD-PLAN-5 / spec §8.2 case 4: a user-initiated hotel swap runs the same
    // simulate-then-confirm pipeline as every other plan edit — a base change
    // can silently make a booking late. Clean swaps apply instantly with the
    // Copy Deck toast (buffer metric from the really simulated plan) + Undo.
    if (source === "user" && changed && planReady && plan) {
      const candidateContext = { ...activePlannerContext, resolvedBase: nextBase };
      const candidatePlan = buildTripFromWishlist(itinerary, tripDays, pace, locale, candidateContext);
      const evaluation = evaluatePlannerHardEdit({
        title: locale === "ja" ? `ホテルを「${candidate.name}」に変更しますか？` : `Switch the hotel to “${candidate.name}”?`,
        locale,
        plan,
        candidatePlan,
      });
      if (evaluation.decision === "confirm") {
        setPendingHardEdit({ title: evaluation.title, conflicts: evaluation.conflicts, apply: applySelection });
        return;
      }
      applySelection();
      // v1.1 §12.3: accepting a recommendation announces once, politely.
      const bufferDelta = totalPlanBufferMinutes(candidatePlan, candidateContext)
        - totalPlanBufferMinutes(plan, activePlannerContext);
      showEditToast(
        locale === "ja" ? `ホテルを「${candidate.name}」にしました` : `Hotel set to ${candidate.name}`,
        bufferToastDetail(bufferDelta, locale),
      );
      return;
    }
    applySelection();
  }

  async function refreshHotelRecommendations() {
    if (!plan || hotelRefreshing || hotelStayMode !== "single" || !hotelUsesRecommendations) return;
    const routeContext = hotelRouteContextForDraft(plan);
    if (!routeContext) return;
    const signatureAtStart = hotelPlanSignature(plan);
    const areaWasRequested = Boolean(hotelQuery.trim() && hotelUsesRecommendations);
    const searchAnchor = areaWasRequested && resolvedBase
      ? { latitude: resolvedBase.latitude, longitude: resolvedBase.longitude, area: hotelQuery.trim() }
      : routeContext;
    hotelRefreshAbortRef.current?.abort();
    const controller = new AbortController();
    hotelRefreshAbortRef.current = controller;
    setHotelRefreshing(true);
    setHotelRefreshFailed(false);
    try {
      const response = await requestHotelRecommendations({
        latitude: searchAnchor.latitude,
        longitude: searchAnchor.longitude,
        area: searchAnchor.area,
        routePoints: routeContext.routePoints,
      }, locale, requestDestination, controller.signal);
      if (controller.signal.aborted || hotelPlanSignatureRef.current !== signatureAtStart) return;
      const travelMinutesById = new Map<string, number>();
      // TC-007 / §8.2 case 4: the re-search used to attach its own winner to
      // the plan without a word, so a candidate that broke a fixed booking
      // could replace a working base and never show up in Undo. Candidates are
      // scored against the whole trip through the same hard-constraint gate a
      // manual swap runs.
      const evaluations = rankHotelCandidates({
        currentPlan: plan,
        locale,
        candidates: response.candidates.map((candidate) => ({
          candidate,
          plan: buildTripFromWishlist(
            itinerary,
            tripDays,
            pace,
            locale,
            { ...activePlannerContext, resolvedBase: hotelAsResolvedBase(candidate, hotelQuery, searchAnchor.area, response.fetchedAt) },
          ),
        })),
      });
      for (const entry of evaluations) travelMinutesById.set(entry.candidate.id, entry.travelMinutes);
      const rankedCandidates = evaluations.map(({ candidate }) => candidate);
      const safeById = new Map(evaluations.map((entry) => [entry.candidate.id, entry]));
      const safeOnly = evaluations.filter((entry) => entry.safe).map(({ candidate }) => candidate);
      const axes = hotelAxisWinners(safeOnly);
      // Style and purpose choose among the candidates the planner may adopt on
      // its own; an unsafe one is still shown, but only the traveller may pick it.
      const preferred = hotelStyle !== "recommended"
        ? styledBestCandidate(safeOnly, hotelStyle) ?? safeOnly[0] ?? null
        : hotelPurpose === "nearest"
          ? safeOnly.find((candidate) => candidate.id === axes.nearestId) ?? safeOnly[0] ?? null
          : hotelPurpose === "rated"
            ? safeOnly.find((candidate) => candidate.id === axes.topRatedId) ?? safeOnly[0] ?? null
            : hotelPurpose === "value"
              ? safeOnly.find((candidate) => candidate.id === axes.valueId) ?? safeOnly[0] ?? null
              : safeOnly[0] ?? null;
      if (rankedCandidates.length === 0) throw new Error("no_hotel_candidates");
      // A base that is already carrying the plan is only replaced silently to
      // fix real damage or to save time the traveller would notice; otherwise
      // the new shortlist is offered and the current base stays put.
      const adoption = preferred && hotelRebaseIsWorthwhile(safeById.get(preferred.id) ?? null, resolvedBase === null)
        ? preferred
        : null;
      const selected = adoption ?? rankedCandidates.find((candidate) => candidate.id === hotelState.selectedId) ?? null;
      const shortlist = hotelShortlist(rankedCandidates, selected?.id);
      setHotelState({
        status: "ready",
        candidates: shortlist,
        selectedId: selected?.id ?? null,
        fresh: { status: "loading", result: null },
        ai: { status: "idle", notes: {} },
      });
      // The re-search hands over a whole new shortlist; a safe, worthwhile
      // auto-pick is a baseline handover (the old candidates are gone, so an
      // "Undo" could not honestly restore the prior comparison) — rebase,
      // don't commit. Anything else waits for the traveller.
      if (adoption) {
        attachPlannerBase(hotelAsResolvedBase(adoption, hotelQuery, adoption.address.slice(0, 100) || searchAnchor.area, response.fetchedAt));
      }
      setHotelSearchSignature(signatureAtStart);
      clearNightlyHotelResults();
      postBuildLegBudgetRef.current = Math.max(postBuildLegBudgetRef.current, 16);
      setInspector({ kind: "hotel" });

      if (!selected || !aiEnabledRef.current) {
        setHotelState((current) => current.selectedId === (selected?.id ?? null)
          ? { ...current, fresh: { status: "paused", result: null } }
          : current);
        return;
      }
      const researched = selected;
      // The route decision is deterministic; the optional public-source check
      // follows in the background and never blocks or changes the hotel rank.
      void requestFreshVoices(
        { name: researched.name, area: researched.address.slice(0, 100) || searchAnchor.area },
        locale,
        { intent: "hotel", depth: "quick", destination: requestDestination, signal: controller.signal },
      ).then((result) => {
        if (controller.signal.aborted || hotelPlanSignatureRef.current !== signatureAtStart) return;
        setHotelState((current) => current.selectedId === researched.id
          ? { ...current, fresh: { status: "ready", result } }
          : current);
      }).catch(() => {
        if (controller.signal.aborted) return;
        setHotelState((current) => current.selectedId === researched.id
          ? { ...current, fresh: { status: "unavailable", result: null } }
          : current);
      });
      // TC-049: the deterministic order above IS the answer — display order
      // and selected base alike. The AI researches the same shortlist
      // (bounded web search) with label-only authority: it writes short
      // comparison notes for these ids and nothing else. Arriving late, the
      // labels attach in place without reordering or swapping the base.
      if (shortlist.length >= 2) {
        setHotelState((current) => ({ ...current, ai: { ...current.ai, status: "loading" } }));
        void requestHotelRanking({
          destination: locale === "ja" ? activeDestination.names.ja : activeDestination.names.en,
          area: searchAnchor.area,
          tripDays,
          purpose: hotelPurpose,
          candidates: shortlist.slice(0, 6).map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            area: candidate.address.slice(0, 100) || searchAnchor.area,
            rating: candidate.rating,
            reviewCount: candidate.userRatingCount,
            totalTravelMinutes: travelMinutesById.get(candidate.id) ?? null,
            styles: candidate.styles,
            priceHint: candidate.rakuten?.minCharge
              ? `~¥${candidate.rakuten.minCharge.toLocaleString("ja-JP")}/night`
              : null,
          })),
        }, locale, controller.signal).then((ai) => {
          if (controller.signal.aborted || hotelPlanSignatureRef.current !== signatureAtStart) return;
          setHotelState((current) => current.status === "ready"
            ? {
              ...current,
              ai: {
                status: "ready",
                notes: Object.fromEntries(ai.ranked.map((item) => [item.id, { reason: item.reason, tag: item.tag }])),
              },
            }
            : current);
        }).catch(() => {
          if (controller.signal.aborted) return;
          setHotelState((current) => ({ ...current, ai: { ...current.ai, status: "unavailable" } }));
        });
      }
    } catch {
      if (!controller.signal.aborted) setHotelRefreshFailed(true);
    } finally {
      if (hotelRefreshAbortRef.current === controller) {
        hotelRefreshAbortRef.current = null;
        setHotelRefreshing(false);
      }
    }
  }

  function clearNightlyHotelResults() {
    nightlyHotelRequestRef.current += 1;
    setHotelStayMode("single");
    setNightlyHotels({ status: "idle", nights: [] });
  }

  function selectNightCandidate(nightIndex: number, candidateId: string) {
    setNightlyHotels((state) => state.status !== "ready" ? state : {
      ...state,
      nights: state.nights.map((night, index) => index === nightIndex ? { ...night, selectedId: candidateId } : night),
    });
  }

  function applyHotelStyle(style: HotelStyleChoice) {
    hotelStyleRef.current = style;
    setHotelStyle(style);
    const pick = styledBestCandidate(hotelState.candidates, style);
    if (pick && pick.id !== hotelState.selectedId) selectHotelCandidate(pick, style === "recommended" ? "balanced" : style === "value" ? "value" : "picked");
    setNightlyHotels((state) => state.status !== "ready" ? state : {
      ...state,
      nights: state.nights.map((night) => {
        const nightPick = styledBestCandidate(night.candidates, style);
        return nightPick ? { ...night, selectedId: nightPick.id } : night;
      }),
    });
  }

  async function enableNightlyHotels() {
    setHotelStayMode("nightly");
    if (nightlyHotels.status === "loading" || nightlyHotels.status === "ready") return;
    if (!plan || plan.days.length < 2) return;
    const runId = buildRunRef.current;
    const requestId = ++nightlyHotelRequestRef.current;
    const stale = () => buildRunRef.current !== runId || nightlyHotelRequestRef.current !== requestId;
    setNightlyHotels({ status: "loading", nights: [] });
    // Night N serves two boundaries: the last stop that evening and the first
    // stop next morning. Ranking against every stop in Day N made a midday
    // museum outweigh the actual hotel transfer.
    const anchors = plan.days.slice(0, -1).map((planDay, index) => {
      const evening = planDay.stops.at(-1)?.stop ?? null;
      const morning = plan.days[index + 1]?.stops[0]?.stop ?? null;
      const boundaryStops = [evening, morning].filter((stop): stop is RouteStop => Boolean(stop));
      const fallback = morning ?? evening ?? planDay.endBase ?? plan.selectedBase;
      if (boundaryStops.length === 0 && !fallback) return null;
      // Sleep where tomorrow starts: the night's hotel leans toward the next
      // morning's first stop (60/40) so the day does not begin with the long
      // transfer the traveller just complained about.
      const center = evening && morning
        ? {
          latitude: evening.latitude * 0.4 + morning.latitude * 0.6,
          longitude: evening.longitude * 0.4 + morning.longitude * 0.6,
        }
        : balancedGeoCenter(boundaryStops);
      const latitude = center?.latitude ?? fallback!.latitude;
      const longitude = center?.longitude ?? fallback!.longitude;
      const area = evening?.area ?? fallback?.area ?? destinationName(activeDestination, locale);
      return {
        latitude,
        longitude,
        area,
        routePoints: boundaryStops.length > 0
          ? boundaryStops.map((stop) => ({ latitude: stop.latitude, longitude: stop.longitude }))
          : fallback ? [{ latitude: fallback.latitude, longitude: fallback.longitude }] : [],
      };
    });
    const nights = await mapWithConcurrency(anchors, 2, async (anchor): Promise<NightlyHotelNight> => {
      if (!anchor) return { area: "", fetchedAt: "", candidates: [], selectedId: null };
      try {
        const response = await requestHotelRecommendations(anchor, locale, requestDestination);
        const pick = response.candidates[0] ?? null;
        return { area: anchor.area, fetchedAt: response.fetchedAt, candidates: hotelShortlist(response.candidates, pick?.id), selectedId: pick?.id ?? null };
      } catch {
        return { area: anchor.area, fetchedAt: "", candidates: [], selectedId: null };
      }
    }, undefined, stale);
    if (stale()) return;
    const styledNights = nights.map((night) => {
      const pick = styledBestCandidate(night.candidates, hotelStyleRef.current) ?? night.candidates[0] ?? null;
      return { ...night, selectedId: pick?.id ?? null };
    });
    if (styledNights.every((night) => night.candidates.length === 0)) {
      setNightlyHotels({ status: "unavailable", nights: [] });
      return;
    }
    setNightlyHotels({ status: "ready", nights: styledNights });
  }

  return {
    hotelRefreshAbortRef,
    hotelAxis,
    hotelPriceLabel,
    hotelAxisLabels,
    selectHotelCandidate,
    refreshHotelRecommendations,
    clearNightlyHotelResults,
    selectNightCandidate,
    applyHotelStyle,
    enableNightlyHotels,
  };
}
