"use client";

// Which screen, which day, which panel, which dialog.
//
// Nothing here is an input to the itinerary. That is the property worth
// having: the P2 work is motion, spacing, responsive behaviour and
// interaction, all of which live in this group, and `tests/planner-state-boundary.test.ts`
// fails if any of these fields reaches the build or feasibility call sites.
// A design change cannot quietly become a scheduling change.
import { useState } from "react";
import type { AlternativePlan } from "../../../../lib/feasibility-result";
import type { RouteRecommendationPoint } from "../../../../lib/route-recommendations";
import { createPlannerMapHoverChannel } from "../../../../lib/planner-map-hover";
import type { ShareScope } from "../../../../lib/share-scope";
import type {
  Inspector,
  ManualPlaceDraft,
  MobileResultView,
  PlannerInputStep,
  PlannerMapScope,
  PlannerSheetState,
} from "../../../../lib/planner-app-state";

export function usePlannerViewState() {
  const [inputStep, setInputStep] = useState<PlannerInputStep>("places");
  const [mobileResultView, setMobileResultView] = useState<MobileResultView>("timeline");
  const [mapScope, setMapScope] = useState<PlannerMapScope>("day");
  const [printMode, setPrintMode] = useState(false);
  // Draft text in the manual-address form. It becomes a resolution override
  // only when the traveller confirms it, and the override is what the engine
  // sees; the half-typed coordinate never is.
  const [manualPlaceDrafts, setManualPlaceDrafts] = useState<Record<number, ManualPlaceDraft>>({});
  const [manualPinTarget, setManualPinTarget] = useState<number | null>(null);
  const [hasPlan, setHasPlan] = useState(false);
  const [activeDay, setActiveDay] = useState(0);
  const [inspector, setInspector] = useState<Inspector>(null);
  const [mapFocusedStopId, setMapFocusedStopId] = useState<string | null>(null);
  // Timeline hover/focus → map highlight (spec §7.4). A ref-like channel, not
  // React state: pointer movement across the timeline must not re-render the
  // shell tree, and the map applies the highlight imperatively. Selection
  // stays in React state above and is untouched by this channel.
  const [mapHoverChannel] = useState(() => createPlannerMapHoverChannel());
  const [shareCopied, setShareCopied] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareScope, setShareScope] = useState<ShareScope>({ dates: true, hotel: false, airports: false, reservations: false });
  // Once a plan is built it stays available: "back to input" must never force
  // a full (paid, slow) rebuild just to peek at the form again.
  const [planReady, setPlanReady] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);
  // v1.1 §9.3: on phones the detail panel is a bottom sheet (half height by
  // default, full on request via an explicit button, never drag-only).
  const [inspectorSheetState, setInspectorSheetState] = useState<PlannerSheetState>("half");
  const [comparisonAlternative, setComparisonAlternative] = useState<AlternativePlan | null>(null);
  // Drawn polylines. The route geometry the scheduler uses is the leg's
  // duration, which comes from the plan; this is only what the map paints.
  const [routeGeometryByDay, setRouteGeometryByDay] = useState<Record<string, RouteRecommendationPoint[]>>({});

  return {
    inputStep, setInputStep,
    mobileResultView, setMobileResultView,
    mapScope, setMapScope,
    printMode, setPrintMode,
    manualPlaceDrafts, setManualPlaceDrafts,
    manualPinTarget, setManualPinTarget,
    hasPlan, setHasPlan,
    activeDay, setActiveDay,
    inspector, setInspector,
    mapFocusedStopId, setMapFocusedStopId,
    mapHoverChannel,
    shareCopied, setShareCopied,
    shareDialogOpen, setShareDialogOpen,
    shareScope, setShareScope,
    planReady, setPlanReady,
    hintDismissed, setHintDismissed,
    inspectorSheetState, setInspectorSheetState,
    comparisonAlternative, setComparisonAlternative,
    routeGeometryByDay, setRouteGeometryByDay,
  };
}
