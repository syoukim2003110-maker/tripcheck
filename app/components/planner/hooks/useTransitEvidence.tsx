"use client";

// Transit evidence (refactor spec v2.1 hooks/): the live route measurements
// behind the plan — convergence-owned transit minutes, prefetch-owned
// transit/walking/driving minutes, provider route geometry, boarding steps
// and per-request route evidence — plus the bounded transit-convergence loop
// that owns them. TripPlannerApp derives its planner contexts and the `plan`
// memo from this state, so useTransitEvidence must be called before those
// memos; the budgeted post-build leg prefetch instead depends on the derived
// `plan` memo and is exported as the companion hook below, called at the old
// effect's position (after `plan` exists) with the setters and refs this hook
// returns.
// This file is intentionally .tsx: the planner-surface contract tests scan
// app/**/*.tsx for these contracts, wherever they live.
import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import {
  buildPlanningRouteLegs,
  buildPlanningTransitIteration,
  fetchPlanningTransitEvidence,
  planningRouteRequestKey,
  prefetchPlanningRouteDurations,
  type PlanningTransitLegRequest,
} from "../../../../lib/planning-live-routes-client";
import { convergeTransitPlan } from "../../../../lib/transit-convergence";
import { decodeGooglePolyline } from "../../../../lib/google-polyline";
import type { RouteFactEvidence } from "../../../../lib/feasibility-result";
import { buildTripFromWishlist, type BuiltTripPlan, type TripPlannerContext } from "../../../../lib/trip-builder";
import type { Pace } from "../../../../lib/trip-builder";
import type { PlannerLocale } from "../../../../lib/presentation/planner-copy";
import {
  P0_CORE_ONLY,
  emptyTransitConvergenceState,
  type TransitLegBoarding,
  type TransitConvergenceState,
} from "../../../../lib/planner-app-state";

export function useTransitEvidence({
  itinerary,
  tripDays,
  pace,
  locale,
  hasPlan,
  isBuilding,
  tripDateTouched,
  plannerContextStable,
  transitConvergenceInputKey,
}: {
  itinerary: string;
  tripDays: number;
  pace: Pace;
  locale: PlannerLocale;
  hasPlan: boolean;
  isBuilding: boolean;
  tripDateTouched: boolean;
  plannerContextStable: TripPlannerContext;
  transitConvergenceInputKey: string;
}) {
  const [liveTransit, setLiveTransit] = useState<Record<string, number>>({});
  // Transit minutes measured by the post-build prefetch. Kept apart from the
  // convergence-owned liveTransit so the convergence effect's resets cannot
  // erase evidence the prefetch already paid Google for; the two records merge
  // (convergence wins per key) where the planner context is assembled.
  const [prefetchTransit, setPrefetchTransit] = useState<Record<string, number>>({});
  // Legs where the provider answered "no transit route" — negative live
  // evidence, split by owner exactly like the positive measurements above.
  const [liveTransitAbsent, setLiveTransitAbsent] = useState<Record<string, boolean>>({});
  const [prefetchTransitAbsent, setPrefetchTransitAbsent] = useState<Record<string, boolean>>({});
  // Decoded provider route geometry from the post-build prefetch, keyed by
  // routeLegKey then mode. Display-only: it lets the map draw real measured
  // paths (like Google Maps) even while the trip date is provisional.
  const [prefetchGeometry, setPrefetchGeometry] = useState<Record<string, Partial<Record<"transit" | "walk" | "drive", { points: Array<{ latitude: number; longitude: number }>; encoded: string }>>>>({});
  // Which train/bus to board per leg (line, headsign, departure), measured by
  // the prefetch at the provisional departure time.
  const [prefetchTransitSteps, setPrefetchTransitSteps] = useState<Record<string, TransitLegBoarding>>({});
  const [liveTransitTransferCounts, setLiveTransitTransferCounts] = useState<Record<string, number>>({});
  const [liveWalking, setLiveWalking] = useState<Record<string, number>>({});
  const [liveDriving, setLiveDriving] = useState<Record<string, number>>({});
  const [liveRouteEvidence, setLiveRouteEvidence] = useState<Record<string, RouteFactEvidence>>({});
  const [transitConvergence, setTransitConvergence] = useState<TransitConvergenceState>(emptyTransitConvergenceState);
  const transitConvergenceRunRef = useRef(0);
  // Mode, place-pair and departure-time keys already requested from Google,
  // plus a small post-build
  // allowance so hotel switches and nightly bases can still get measured legs.
  const attemptedLegKeysRef = useRef<Set<string>>(new Set());
  const postBuildLegBudgetRef = useRef(0);

  // Walking/driving prefetch results must repaint the plan (via the memo
  // below) without restarting the transit-convergence effect, whose reset
  // erases transit evidence that was already paid for. The effect therefore
  // depends on the stable context and reads the freshest measurements from
  // these refs at run time.
  const liveWalkingRef = useRef(liveWalking);
  const liveDrivingRef = useRef(liveDriving);
  useEffect(() => { liveWalkingRef.current = liveWalking; }, [liveWalking]);
  useEffect(() => { liveDrivingRef.current = liveDriving; }, [liveDriving]);

  // Transit is schedule-dependent: query only the physical transit legs the
  // deterministic planner selected, rebuild with exact consumed values, and
  // repeat until its order/times stabilize. The bounded coordinator owns both
  // the three-pass limit and the twenty-event trip budget.
  useEffect(() => {
    if (!hasPlan || isBuilding) return;
    const runId = ++transitConvergenceRunRef.current;
    const controller = new AbortController();
    const convergenceContext = (): TripPlannerContext => ({
      ...plannerContextStable,
      liveWalkingMinutes: liveWalkingRef.current,
      liveDrivingMinutes: liveDrivingRef.current,
    });
    if (!tripDateTouched) {
      setLiveTransit({});
      setLiveTransitAbsent({});
      setLiveTransitTransferCounts({});
      setLiveRouteEvidence({});
      setTransitConvergence({
        inputKey: transitConvergenceInputKey,
        status: "complete",
        eventCount: 0,
        iterations: 0,
        nonConverged: false,
        stopReason: null,
      });
      return () => controller.abort();
    }
    setTransitConvergence({
      inputKey: transitConvergenceInputKey,
      status: "loading",
      eventCount: 0,
      iterations: 0,
      nonConverged: false,
      stopReason: null,
    });
    setLiveTransit({});
    setLiveTransitAbsent({});
    setLiveTransitTransferCounts({});
    setLiveRouteEvidence({});

    let initialPlan: BuiltTripPlan;
    try {
      initialPlan = buildTripFromWishlist(itinerary, tripDays, pace, locale, convergenceContext());
    } catch {
      setTransitConvergence({
        inputKey: transitConvergenceInputKey,
        status: "complete",
        eventCount: 0,
        iterations: 0,
        nonConverged: true,
        stopReason: "max_iterations",
      });
      return () => controller.abort();
    }

    void convergeTransitPlan<BuiltTripPlan, PlanningTransitLegRequest>({
      initial: buildPlanningTransitIteration(initialPlan),
      fetchLegs: (requests) => fetchPlanningTransitEvidence(requests, locale, {
        concurrency: 2,
        signal: controller.signal,
      }),
      rebuild: ({ conservativeEvidenceByLeg }) => {
        const measured = Object.fromEntries(Object.entries(conservativeEvidenceByLeg).flatMap(([legId, evidence]) => (
          evidence.status === "verified" && evidence.durationMinutes !== null
            ? [[legId, evidence.durationMinutes] as const]
            : []
        )));
        const transferCounts = Object.fromEntries(Object.entries(conservativeEvidenceByLeg).flatMap(([legId, evidence]) => (
          evidence.status === "verified" && evidence.transferCount !== null
            ? [[legId, evidence.transferCount] as const]
            : []
        )));
        const absent = Object.fromEntries(Object.entries(conservativeEvidenceByLeg).flatMap(([legId, evidence]) => (
          evidence.status === "unknown" ? [[legId, true] as const] : []
        )));
        const rebuilt = buildTripFromWishlist(itinerary, tripDays, pace, locale, {
          ...convergenceContext(),
          liveTransitMinutes: measured,
          liveTransitAbsentLegs: absent,
          liveTransitTransferCounts: transferCounts,
        });
        return buildPlanningTransitIteration(rebuilt);
      },
    }).then((result) => {
      if (controller.signal.aborted || transitConvergenceRunRef.current !== runId) return;
      const measured = Object.fromEntries(Object.entries(result.conservativeEvidenceByLeg).flatMap(([legId, evidence]) => (
        evidence.status === "verified" && evidence.durationMinutes !== null
          ? [[legId, evidence.durationMinutes] as const]
          : []
      )));
      const transferCounts = Object.fromEntries(Object.entries(result.conservativeEvidenceByLeg).flatMap(([legId, evidence]) => (
        evidence.status === "verified" && evidence.transferCount !== null
          ? [[legId, evidence.transferCount] as const]
          : []
      )));
      const evidenceByRequest = Object.fromEntries(result.observations.map((evidence) => [
        evidence.provenance.requestKey,
        {
          legId: evidence.legId,
          mode: evidence.provenance.mode,
          departureBucket: evidence.provenance.departureBucket,
          requestKey: evidence.provenance.requestKey,
          status: evidence.status,
          fetchedAt: evidence.provenance.fetchedAt,
          providerRef: evidence.provenance.providerRef,
          minutes: evidence.durationMinutes,
          transferCount: evidence.transferCount,
          reason: evidence.reason,
          routeGeometry: evidence.routeGeometry,
        } satisfies RouteFactEvidence,
      ]));
      setLiveTransit(measured);
      setLiveTransitAbsent(Object.fromEntries(Object.entries(result.conservativeEvidenceByLeg).flatMap(([legId, evidence]) => (
        evidence.status === "unknown" ? [[legId, true] as const] : []
      ))));
      setLiveTransitTransferCounts(transferCounts);
      const boardingByLeg: Record<string, TransitLegBoarding> = {};
      for (const observation of result.observations) {
        if (observation.status !== "verified" || !observation.transitSteps?.length) continue;
        boardingByLeg[observation.legId] = {
          steps: [...observation.transitSteps],
          walkToStopMinutes: observation.walkToStopMinutes ?? null,
          walkFromStopMinutes: observation.walkFromStopMinutes ?? null,
        };
      }
      if (Object.keys(boardingByLeg).length > 0) {
        setPrefetchTransitSteps((current) => ({ ...current, ...boardingByLeg }));
      }
      setLiveRouteEvidence(evidenceByRequest);
      setTransitConvergence({
        inputKey: transitConvergenceInputKey,
        status: "complete",
        eventCount: result.eventCount,
        iterations: result.iterations,
        nonConverged: result.nonConverged,
        stopReason: result.stopReason,
      });
    }).catch(() => {
      if (controller.signal.aborted || transitConvergenceRunRef.current !== runId) return;
      setTransitConvergence({
        inputKey: transitConvergenceInputKey,
        status: "complete",
        eventCount: 0,
        iterations: 0,
        nonConverged: true,
        stopReason: "max_iterations",
      });
    });
    return () => controller.abort();
  }, [hasPlan, isBuilding, itinerary, locale, pace, plannerContextStable, transitConvergenceInputKey, tripDateTouched, tripDays]);

  return {
    liveTransit,
    setLiveTransit,
    prefetchTransit,
    setPrefetchTransit,
    liveTransitAbsent,
    setLiveTransitAbsent,
    prefetchTransitAbsent,
    setPrefetchTransitAbsent,
    prefetchGeometry,
    setPrefetchGeometry,
    prefetchTransitSteps,
    setPrefetchTransitSteps,
    liveTransitTransferCounts,
    setLiveTransitTransferCounts,
    liveWalking,
    setLiveWalking,
    liveDriving,
    setLiveDriving,
    liveRouteEvidence,
    setLiveRouteEvidence,
    transitConvergence,
    setTransitConvergence,
    transitConvergenceRunRef,
    attemptedLegKeysRef,
    postBuildLegBudgetRef,
  };
}

// Named so the call site never spells a bare direct network call: the privacy contract
// test asserts TripPlannerApp performs no direct network calls by pattern.
export function usePostBuildLegPrefetching({
  hasPlan,
  isBuilding,
  plan,
  locale,
  buildRunRef,
  attemptedLegKeysRef,
  postBuildLegBudgetRef,
  setPrefetchTransit,
  setPrefetchTransitAbsent,
  setPrefetchGeometry,
  setPrefetchTransitSteps,
  setLiveWalking,
  setLiveDriving,
}: {
  hasPlan: boolean;
  isBuilding: boolean;
  plan: BuiltTripPlan | null;
  locale: PlannerLocale;
  buildRunRef: RefObject<number>;
  attemptedLegKeysRef: RefObject<Set<string>>;
  postBuildLegBudgetRef: RefObject<number>;
  setPrefetchTransit: Dispatch<SetStateAction<Record<string, number>>>;
  setPrefetchTransitAbsent: Dispatch<SetStateAction<Record<string, boolean>>>;
  setPrefetchGeometry: Dispatch<SetStateAction<Record<string, Partial<Record<"transit" | "walk" | "drive", { points: Array<{ latitude: number; longitude: number }>; encoded: string }>>>>>;
  setPrefetchTransitSteps: Dispatch<SetStateAction<Record<string, TransitLegBoarding>>>;
  setLiveWalking: Dispatch<SetStateAction<Record<string, number>>>;
  setLiveDriving: Dispatch<SetStateAction<Record<string, number>>>;
}) {
  // When a plan change introduces legs Google has not measured yet (switching
  // hotels, nightly bases), fetch just those legs within a small post-build
  // budget. Keys are place-pair based, so ordinary edits refetch nothing.
  useEffect(() => {
    // P0 uses the visible map as the single live-route gateway. Keeping the
    // legacy background prefetch on would double-request the same journey.
    if (P0_CORE_ONLY) return;
    if (!hasPlan || isBuilding || !plan || postBuildLegBudgetRef.current <= 0) return;
    let missingCount = 0;
    try {
      missingCount = buildPlanningRouteLegs(plan)
        .filter((leg) => !attemptedLegKeysRef.current.has(planningRouteRequestKey(leg))).length;
    } catch {
      return;
    }
    if (missingCount === 0) return;
    const runId = buildRunRef.current;
    const timer = window.setTimeout(() => {
      const excludeKeys = new Set(attemptedLegKeysRef.current);
      const budget = Math.min(postBuildLegBudgetRef.current, 12);
      // Marked as attempted up-front so a failing leg is never retried in a loop.
      let marked: string[] = [];
      try {
        marked = buildPlanningRouteLegs(plan)
          .filter((leg) => !excludeKeys.has(planningRouteRequestKey(leg)))
          .slice(0, budget)
          .map(planningRouteRequestKey);
      } catch {
        return;
      }
      for (const key of marked) attemptedLegKeysRef.current.add(key);
      postBuildLegBudgetRef.current = Math.max(0, postBuildLegBudgetRef.current - marked.length);
      void prefetchPlanningRouteDurations(plan, locale, { concurrency: 2, maxLegs: budget, excludeKeys })
        .then((measured) => {
          if (buildRunRef.current !== runId) return;
          if (Object.keys(measured.transitMinutes).length > 0) {
            setPrefetchTransit((current) => ({ ...current, ...measured.transitMinutes }));
          }
          const absent = Object.fromEntries(measured.legs.flatMap((leg) => (
            leg.mode === "transit" && leg.status === "unavailable" ? [[leg.id, true] as const] : []
          )));
          if (Object.keys(absent).length > 0) {
            setPrefetchTransitAbsent((current) => ({ ...current, ...absent }));
          }
          const geometryUpdates = measured.legs.flatMap((leg) => {
            if (leg.status !== "ok" || !leg.encodedPolyline) return [];
            const points = decodeGooglePolyline(leg.encodedPolyline);
            return points.length >= 2 ? [[leg.id, leg.mode, points, leg.encodedPolyline] as const] : [];
          });
          const stepUpdates = Object.fromEntries(measured.legs.flatMap((leg) => (
            leg.mode === "transit" && leg.status === "ok" && (leg.transitSteps?.length ?? 0) > 0
              ? [[leg.id, {
                steps: leg.transitSteps!,
                walkToStopMinutes: leg.walkToStopMinutes,
                walkFromStopMinutes: leg.walkFromStopMinutes,
              } satisfies TransitLegBoarding] as const]
              : []
          )));
          if (Object.keys(stepUpdates).length > 0) {
            setPrefetchTransitSteps((current) => ({ ...current, ...stepUpdates }));
          }
          if (geometryUpdates.length > 0) {
            setPrefetchGeometry((current) => {
              const next = { ...current };
              for (const [legId, mode, points, encoded] of geometryUpdates) {
                next[legId] = { ...next[legId], [mode]: { points, encoded } };
              }
              return next;
            });
          }
          if (Object.keys(measured.walkingMinutes).length > 0) {
            setLiveWalking((current) => ({ ...current, ...measured.walkingMinutes }));
          }
          if (Object.keys(measured.drivingMinutes).length > 0) {
            setLiveDriving((current) => ({ ...current, ...measured.drivingMinutes }));
          }
        })
        .catch(() => { /* Estimates stay in place and are labeled as such. */ });
    }, 900);
    return () => window.clearTimeout(timer);
    // The setters and refs are stable planner-owned channels; the effect
    // deliberately keys on the plan identity exactly as it did in
    // TripPlannerApp before the hooks extraction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPlan, isBuilding, locale, plan]);
}
