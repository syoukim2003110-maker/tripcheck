export const MAX_TRANSIT_ITERATIONS = 3;
export const MAX_TRANSIT_EVENTS = 20;

export type TransitEvidenceStatus = "verified" | "failed" | "unknown";

export type TransitRouteProvenance = Readonly<{
  mode: "transit";
  departureBucket: string;
  requestKey: string;
  fetchedAt?: string;
  providerRef?: string;
}>;

/**
 * The coordinator owns only identity and time provenance. Callers can extend
 * this type with provider-neutral origin/destination payloads.
 */
export type SelectedTransitLegRequest = Readonly<{
  legId: string;
  mode: "transit";
  departureTime: string;
  departureBucket: string;
  requestKey: string;
}>;

export type TransitProviderObservation = Readonly<{
  requestKey: string;
  status: TransitEvidenceStatus;
  durationMinutes: number | null;
  /** Provider-derived vehicle changes; omitted by legacy adapters, null when unknown. */
  transferCount?: number | null;
  fetchedAt?: string;
  providerRef?: string;
  routeGeometry?: TransitRouteGeometry;
}>;

export type TransitRouteGeometry = Readonly<{
  points: readonly Readonly<{ latitude: number; longitude: number }>[];
  distanceMeters: number | null;
}>;

export type TransitEvidenceReason =
  | "provider_failed"
  | "provider_unknown"
  | "missing_provider_result"
  | "invalid_provider_result"
  | "event_cap"
  | "iteration_limit";

export type TransitLegEvidence = Readonly<{
  legId: string;
  durationMinutes: number | null;
  transferCount: number | null;
  status: TransitEvidenceStatus;
  provenance: TransitRouteProvenance;
  routeGeometry?: TransitRouteGeometry;
  reason?: TransitEvidenceReason;
}>;

export type TransitPlanIteration<
  TPlan,
  TRequest extends SelectedTransitLegRequest = SelectedTransitLegRequest,
> = Readonly<{
  plan: TPlan;
  /** Deterministic signature of the order and scheduled times that can move. */
  signature: string;
  selectedTransitLegs: readonly TRequest[];
}>;

export type TransitFetchContext = Readonly<{
  iteration: number;
  eventCount: number;
  remainingEventBudget: number;
}>;

export type TransitRebuildContext<
  TPlan,
  TRequest extends SelectedTransitLegRequest = SelectedTransitLegRequest,
> = Readonly<{
  current: TransitPlanIteration<TPlan, TRequest>;
  iteration: number;
  /** Every request observation, including failed, unknown, and cap-skipped. */
  observations: readonly TransitLegEvidence[];
  /** Evidence for the currently selected request keys only. */
  selectedEvidence: readonly TransitLegEvidence[];
  /** Maximum verified duration observed for each physical leg. */
  conservativeEvidenceByLeg: Readonly<Record<string, TransitLegEvidence>>;
  eventCount: number;
}>;

export type TransitConvergenceStopReason =
  | "no_transit_legs"
  | "converged"
  | "event_cap"
  | "max_iterations";

export type TransitConvergenceResult<TPlan> = Readonly<{
  plan: TPlan;
  signature: string;
  converged: boolean;
  nonConverged: boolean;
  /** True when missing evidence or convergence limits qualify the plan. */
  conditional: boolean;
  stopReason: TransitConvergenceStopReason;
  iterations: number;
  eventCount: number;
  eventCap: number;
  observations: readonly TransitLegEvidence[];
  conservativeEvidenceByLeg: Readonly<Record<string, TransitLegEvidence>>;
}>;

export type TransitConvergenceOptions<
  TPlan,
  TRequest extends SelectedTransitLegRequest = SelectedTransitLegRequest,
> = Readonly<{
  initial: TransitPlanIteration<TPlan, TRequest>;
  fetchLegs: (
    requests: readonly TRequest[],
    context: TransitFetchContext,
  ) => Promise<readonly TransitProviderObservation[]> | readonly TransitProviderObservation[];
  rebuild: (
    context: TransitRebuildContext<TPlan, TRequest>,
  ) => Promise<TransitPlanIteration<TPlan, TRequest>> | TransitPlanIteration<TPlan, TRequest>;
  /** Test/safety override. Values above the product maximum are clamped. */
  maxIterations?: number;
  /** Test/safety override. Values above the product maximum are clamped. */
  eventCap?: number;
}>;

function boundedInteger(value: number | undefined, fallback: number, maximum: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(value)));
}

/** Buckets an instant without changing the departure time sent to a provider. */
export function transitDepartureBucket(departureTime: string, bucketMinutes = 30) {
  const timestamp = Date.parse(departureTime);
  const minutes = boundedInteger(bucketMinutes, 30, 24 * 60);
  if (!Number.isFinite(timestamp)) return "unknown";
  const bucketMs = minutes * 60_000;
  return new Date(Math.floor(timestamp / bucketMs) * bucketMs).toISOString();
}

export function transitRequestKey(legId: string, departureTime: string, bucketMinutes = 30) {
  const bucket = transitDepartureBucket(departureTime, bucketMinutes);
  return `transit|${encodeURIComponent(legId)}|${bucket}`;
}

function uniqueRequests<TRequest extends SelectedTransitLegRequest>(requests: readonly TRequest[]) {
  const unique = new Map<string, TRequest>();
  for (const request of requests) {
    if (!unique.has(request.requestKey)) unique.set(request.requestKey, request);
  }
  return [...unique.values()];
}

function provenanceFor(
  request: SelectedTransitLegRequest,
  provider?: Pick<TransitProviderObservation, "fetchedAt" | "providerRef">,
): TransitRouteProvenance {
  return {
    mode: "transit",
    departureBucket: request.departureBucket,
    requestKey: request.requestKey,
    ...(provider?.fetchedAt ? { fetchedAt: provider.fetchedAt } : {}),
    ...(provider?.providerRef ? { providerRef: provider.providerRef } : {}),
  };
}

function unknownEvidence(
  request: SelectedTransitLegRequest,
  reason: TransitEvidenceReason,
  status: "failed" | "unknown" = "unknown",
): TransitLegEvidence {
  return {
    legId: request.legId,
    durationMinutes: null,
    transferCount: null,
    status,
    provenance: provenanceFor(request),
    reason,
  };
}

function normalizedProviderEvidence(
  request: SelectedTransitLegRequest,
  observation: TransitProviderObservation | undefined,
): TransitLegEvidence {
  if (!observation) return unknownEvidence(request, "missing_provider_result");
  if (observation.status === "failed") {
    return {
      ...unknownEvidence(request, "provider_failed", "failed"),
      provenance: provenanceFor(request, observation),
    };
  }
  if (observation.status === "unknown") {
    return {
      ...unknownEvidence(request, "provider_unknown"),
      provenance: provenanceFor(request, observation),
    };
  }
  if (
    typeof observation.durationMinutes !== "number"
    || !Number.isFinite(observation.durationMinutes)
    || observation.durationMinutes <= 0
  ) {
    return {
      ...unknownEvidence(request, "invalid_provider_result"),
      provenance: provenanceFor(request, observation),
    };
  }
  const routeGeometry = observation.routeGeometry;
  const validGeometry = routeGeometry
    && routeGeometry.points.length >= 2
    && routeGeometry.points.every((point) => (
      Number.isFinite(point.latitude)
      && Number.isFinite(point.longitude)
      && point.latitude >= -90
      && point.latitude <= 90
      && point.longitude >= -180
      && point.longitude <= 180
    ));
  return {
    legId: request.legId,
    durationMinutes: Math.ceil(observation.durationMinutes),
    transferCount: typeof observation.transferCount === "number"
      && Number.isSafeInteger(observation.transferCount)
      && observation.transferCount >= 0
      && observation.transferCount <= 100
      ? observation.transferCount
      : null,
    status: "verified",
    provenance: provenanceFor(request, observation),
    ...(validGeometry
      ? { routeGeometry }
      : {}),
  };
}

function conservativeEvidence(observations: Iterable<TransitLegEvidence>) {
  const byLeg = new Map<string, TransitLegEvidence>();
  for (const observation of observations) {
    const current = byLeg.get(observation.legId);
    if (!current) {
      byLeg.set(observation.legId, observation);
      continue;
    }
    if (observation.status === "verified") {
      if (
        current.status !== "verified"
        || observation.durationMinutes! > current.durationMinutes!
        || (observation.durationMinutes === current.durationMinutes
          && (observation.transferCount ?? -1) > (current.transferCount ?? -1))
      ) {
        byLeg.set(observation.legId, observation);
      }
      continue;
    }
    // Keep a verified conservative duration when a later lookup fails, while
    // retaining every failure in `observations`. With no verified value, a
    // concrete provider failure is more informative than an unknown omission.
    if (current.status === "unknown" && observation.status === "failed") {
      byLeg.set(observation.legId, observation);
    }
  }
  return Object.freeze(Object.fromEntries(byLeg));
}

function resultFor<TPlan>(input: {
  state: TransitPlanIteration<TPlan, SelectedTransitLegRequest>;
  converged: boolean;
  nonConverged: boolean;
  stopReason: TransitConvergenceStopReason;
  iterations: number;
  eventCount: number;
  eventCap: number;
  observationsByRequest: Map<string, TransitLegEvidence>;
}): TransitConvergenceResult<TPlan> {
  const observations = [...input.observationsByRequest.values()];
  const evidenceByLeg = conservativeEvidence(observations);
  const hasUnresolved = observations.some((entry) => entry.status !== "verified" || entry.transferCount === null);
  return {
    plan: input.state.plan,
    signature: input.state.signature,
    converged: input.converged,
    nonConverged: input.nonConverged,
    conditional: input.nonConverged || input.stopReason === "event_cap" || hasUnresolved,
    stopReason: input.stopReason,
    iterations: input.iterations,
    eventCount: input.eventCount,
    eventCap: input.eventCap,
    observations,
    conservativeEvidenceByLeg: evidenceByLeg,
  };
}

/**
 * LIV-004 coordinator: measure selected transit legs at their planned times,
 * rebuild, and stop when the deterministic plan signature stabilizes.
 *
 * A provider event is counted before the callback, including failed calls.
 * The hard limits cannot be raised by callers. No failed or omitted response is
 * converted into a duration.
 */
export async function convergeTransitPlan<
  TPlan,
  TRequest extends SelectedTransitLegRequest = SelectedTransitLegRequest,
>(options: TransitConvergenceOptions<TPlan, TRequest>): Promise<TransitConvergenceResult<TPlan>> {
  const maxIterations = boundedInteger(options.maxIterations, MAX_TRANSIT_ITERATIONS, MAX_TRANSIT_ITERATIONS);
  const eventCap = boundedInteger(options.eventCap, MAX_TRANSIT_EVENTS, MAX_TRANSIT_EVENTS);
  const observationsByRequest = new Map<string, TransitLegEvidence>();
  let state = options.initial;
  let eventCount = 0;

  if (uniqueRequests(state.selectedTransitLegs).length === 0) {
    return resultFor({
      state,
      converged: true,
      nonConverged: false,
      stopReason: "no_transit_legs",
      iterations: 0,
      eventCount,
      eventCap,
      observationsByRequest,
    });
  }

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const selected = uniqueRequests(state.selectedTransitLegs);
    const unseen = selected.filter((request) => !observationsByRequest.has(request.requestKey));
    const remaining = Math.max(0, eventCap - eventCount);
    const requested = unseen.slice(0, remaining);
    const skipped = unseen.slice(remaining);
    for (const request of skipped) {
      observationsByRequest.set(request.requestKey, unknownEvidence(request, "event_cap"));
    }

    if (requested.length > 0) {
      // Count first: a thrown provider call still consumes cost and cannot be
      // retried by the next render/iteration.
      eventCount += requested.length;
      let providerResults: readonly TransitProviderObservation[];
      try {
        providerResults = await options.fetchLegs(requested, {
          iteration,
          eventCount,
          remainingEventBudget: Math.max(0, eventCap - eventCount),
        });
      } catch {
        providerResults = requested.map((request) => ({
          requestKey: request.requestKey,
          status: "failed" as const,
          durationMinutes: null,
        }));
      }
      const byRequestKey = new Map(providerResults.map((entry) => [entry.requestKey, entry]));
      for (const request of requested) {
        observationsByRequest.set(
          request.requestKey,
          normalizedProviderEvidence(request, byRequestKey.get(request.requestKey)),
        );
      }
    }

    const observations = [...observationsByRequest.values()];
    const selectedEvidence = selected.flatMap((request) => {
      const evidence = observationsByRequest.get(request.requestKey);
      return evidence ? [evidence] : [];
    });
    const previousSignature = state.signature;
    state = await options.rebuild({
      current: state,
      iteration,
      observations,
      selectedEvidence,
      conservativeEvidenceByLeg: conservativeEvidence(observations),
      eventCount,
    });
    const signatureStable = state.signature === previousSignature;
    if (skipped.length > 0 || (eventCount >= eventCap
      && uniqueRequests(state.selectedTransitLegs).some((request) => !observationsByRequest.has(request.requestKey)))) {
      // Preserve newly selected, unmeasured legs as unknown even though there
      // is no budget for another provider pass.
      for (const request of uniqueRequests(state.selectedTransitLegs)) {
        if (!observationsByRequest.has(request.requestKey)) {
          observationsByRequest.set(request.requestKey, unknownEvidence(request, "event_cap"));
        }
      }
      return resultFor({
        state,
        converged: signatureStable,
        nonConverged: !signatureStable,
        stopReason: "event_cap",
        iterations: iteration,
        eventCount,
        eventCap,
        observationsByRequest,
      });
    }
    if (signatureStable) {
      return resultFor({
        state,
        converged: true,
        nonConverged: false,
        stopReason: "converged",
        iterations: iteration,
        eventCount,
        eventCap,
        observationsByRequest,
      });
    }
  }

  // The final rebuild may select a new departure bucket that cannot be queried
  // without a fourth iteration. Keep it explicit rather than certifying the
  // estimate that happens to be in the plan.
  for (const request of uniqueRequests(state.selectedTransitLegs)) {
    if (!observationsByRequest.has(request.requestKey)) {
      observationsByRequest.set(request.requestKey, unknownEvidence(request, "iteration_limit"));
    }
  }
  return resultFor({
    state,
    converged: false,
    nonConverged: true,
    stopReason: "max_iterations",
    iterations: maxIterations,
    eventCount,
    eventCap,
    observationsByRequest,
  });
}
