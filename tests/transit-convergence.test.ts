import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_TRANSIT_EVENTS,
  convergeTransitPlan,
  transitDepartureBucket,
  transitRequestKey,
  type SelectedTransitLegRequest,
  type TransitPlanIteration,
} from "../lib/transit-convergence.ts";

type TestPlan = { version: string; adoptedMinutes: number | null };

function leg(legId: string, minute: number, suffix = "") : SelectedTransitLegRequest {
  const departureTime = `2026-09-14T09:${String(minute).padStart(2, "0")}:00+09:00`;
  const departureBucket = transitDepartureBucket(departureTime, 15);
  return {
    legId,
    mode: "transit",
    departureTime,
    departureBucket,
    requestKey: `${transitRequestKey(legId, departureTime, 15)}${suffix}`,
  };
}

function state(signature: string, selectedTransitLegs: readonly SelectedTransitLegRequest[], adoptedMinutes: number | null = null): TransitPlanIteration<TestPlan> {
  return { plan: { version: signature, adoptedMinutes }, signature, selectedTransitLegs };
}

test("stops after one iteration when the plan signature is unchanged", async () => {
  const selected = leg("hotel::museum", 0);
  let fetchCalls = 0;
  const result = await convergeTransitPlan({
    initial: state("same", [selected]),
    fetchLegs: (requests) => {
      fetchCalls += 1;
      assert.equal(requests.length, 1);
      return [{
        requestKey: selected.requestKey,
        status: "verified",
        durationMinutes: 18.2,
        transferCount: 2,
        fetchedAt: "2026-08-09T00:00:00Z",
        providerRef: "google",
        routeGeometry: {
          points: [{ latitude: 35.1, longitude: 139.1 }, { latitude: 35.2, longitude: 139.2 }],
          distanceMeters: 1_200,
        },
      }];
    },
    rebuild: ({ current, conservativeEvidenceByLeg }) => state(
      current.signature,
      current.selectedTransitLegs,
      conservativeEvidenceByLeg["hotel::museum"].durationMinutes,
    ),
  });

  assert.equal(fetchCalls, 1);
  assert.equal(result.iterations, 1);
  assert.equal(result.eventCount, 1);
  assert.equal(result.converged, true);
  assert.equal(result.nonConverged, false);
  assert.equal(result.conditional, false);
  assert.equal(result.stopReason, "converged");
  assert.equal(result.plan.adoptedMinutes, 19, "verified fractions are conservatively rounded up");
  assert.equal(result.observations[0].transferCount, 2);
  assert.deepEqual(result.observations[0].provenance, {
    mode: "transit",
    departureBucket: selected.departureBucket,
    requestKey: selected.requestKey,
    fetchedAt: "2026-08-09T00:00:00Z",
    providerRef: "google",
  });
  assert.deepEqual(result.observations[0].routeGeometry, {
    points: [{ latitude: 35.1, longitude: 139.1 }, { latitude: 35.2, longitude: 139.2 }],
    distanceMeters: 1_200,
  });
});

test("re-queries a changed departure bucket and stops on the next stable signature", async () => {
  const first = leg("a::b", 0);
  const second = leg("a::b", 45);
  const fetched: string[] = [];
  const result = await convergeTransitPlan({
    initial: state("v0", [first]),
    fetchLegs: (requests) => {
      fetched.push(...requests.map((request) => request.requestKey));
      return requests.map((request) => ({ requestKey: request.requestKey, status: "verified" as const, durationMinutes: request.requestKey === first.requestKey ? 12 : 16 }));
    },
    rebuild: ({ current, conservativeEvidenceByLeg }) => current.signature === "v0"
      ? state("v1", [second], conservativeEvidenceByLeg["a::b"].durationMinutes)
      : state("v1", [second], conservativeEvidenceByLeg["a::b"].durationMinutes),
  });

  assert.deepEqual(fetched, [first.requestKey, second.requestKey]);
  assert.equal(result.iterations, 2);
  assert.equal(result.eventCount, 2);
  assert.equal(result.converged, true);
  assert.equal(result.plan.adoptedMinutes, 16);
});

test("reuses an already observed request key without spending another event", async () => {
  const selected = leg("a::b", 0);
  let fetchCalls = 0;
  const result = await convergeTransitPlan({
    initial: state("v0", [selected]),
    fetchLegs: (requests) => {
      fetchCalls += 1;
      return requests.map((request) => ({ requestKey: request.requestKey, status: "verified" as const, durationMinutes: 14 }));
    },
    rebuild: ({ current, conservativeEvidenceByLeg }) => state(
      current.signature === "v0" ? "v1" : "v1",
      [selected],
      conservativeEvidenceByLeg["a::b"].durationMinutes,
    ),
  });

  assert.equal(fetchCalls, 1);
  assert.equal(result.iterations, 2);
  assert.equal(result.eventCount, 1);
  assert.equal(result.converged, true);
  assert.equal(result.conditional, true, "a stable duration does not imply the unknown transfer count met the policy");
});

test("never exceeds twenty provider events and records cap-skipped legs as unknown", async () => {
  const legs = Array.from({ length: 25 }, (_, index) => leg(`from-${index}::to-${index}`, index % 60, `-${index}`));
  let requested = 0;
  const result = await convergeTransitPlan({
    initial: state("same", legs),
    eventCap: 999,
    fetchLegs: (requests) => {
      requested += requests.length;
      return requests.map((request) => ({ requestKey: request.requestKey, status: "verified" as const, durationMinutes: 10 }));
    },
    rebuild: ({ current }) => current,
  });

  assert.equal(result.eventCap, MAX_TRANSIT_EVENTS);
  assert.equal(result.eventCount, MAX_TRANSIT_EVENTS);
  assert.equal(requested, MAX_TRANSIT_EVENTS);
  assert.equal(result.observations.length, 25);
  assert.equal(result.observations.filter((entry) => entry.reason === "event_cap" && entry.status === "unknown").length, 5);
  assert.equal(result.stopReason, "event_cap");
  assert.equal(result.conditional, true);
});

test("preserves failed, explicit unknown, and omitted provider responses", async () => {
  const failed = leg("a::b", 0);
  const unknown = leg("b::c", 15);
  const omitted = leg("c::d", 30);
  const result = await convergeTransitPlan({
    initial: state("same", [failed, unknown, omitted]),
    fetchLegs: () => [
      { requestKey: failed.requestKey, status: "failed", durationMinutes: 99, providerRef: "provider" },
      { requestKey: unknown.requestKey, status: "unknown", durationMinutes: 42 },
    ],
    rebuild: ({ current }) => current,
  });

  assert.deepEqual(result.observations.map((entry) => [entry.status, entry.durationMinutes, entry.reason]), [
    ["failed", null, "provider_failed"],
    ["unknown", null, "provider_unknown"],
    ["unknown", null, "missing_provider_result"],
  ]);
  assert.equal(result.conditional, true);
  assert.equal(result.converged, true, "the schedule can stabilize while evidence remains conditional");
});

test("turns a thrown provider batch into failed evidence without retrying", async () => {
  const selected = leg("a::b", 0);
  let calls = 0;
  const result = await convergeTransitPlan({
    initial: state("same", [selected]),
    fetchLegs: () => {
      calls += 1;
      throw new Error("provider down");
    },
    rebuild: ({ current }) => current,
  });

  assert.equal(calls, 1);
  assert.equal(result.eventCount, 1);
  assert.equal(result.observations[0].status, "failed");
  assert.equal(result.observations[0].durationMinutes, null);
  assert.equal(result.observations[0].transferCount, null);
  assert.equal(result.conditional, true);
});

test("after three unstable iterations returns each leg's maximum observation", async () => {
  const requests = [leg("a::b", 0, "-0"), leg("a::b", 15, "-1"), leg("a::b", 30, "-2"), leg("a::b", 45, "-3")];
  const durations = [10, 25, 15];
  const transferCounts = [0, 3, 1];
  const adopted: number[] = [];
  const result = await convergeTransitPlan({
    initial: state("v0", [requests[0]]),
    maxIterations: 99,
    fetchLegs: (selected, { iteration }) => selected.map((request) => ({
      requestKey: request.requestKey,
      status: "verified" as const,
      durationMinutes: durations[iteration - 1],
      transferCount: transferCounts[iteration - 1],
    })),
    rebuild: ({ iteration, conservativeEvidenceByLeg }) => {
      adopted.push(conservativeEvidenceByLeg["a::b"].durationMinutes!);
      return state(`v${iteration}`, [requests[iteration]], conservativeEvidenceByLeg["a::b"].durationMinutes);
    },
  });

  assert.deepEqual(adopted, [10, 25, 25]);
  assert.equal(result.iterations, 3);
  assert.equal(result.eventCount, 3);
  assert.equal(result.stopReason, "max_iterations");
  assert.equal(result.converged, false);
  assert.equal(result.nonConverged, true);
  assert.equal(result.conditional, true);
  assert.equal(result.plan.adoptedMinutes, 25);
  assert.equal(result.conservativeEvidenceByLeg["a::b"].durationMinutes, 25);
  assert.equal(result.conservativeEvidenceByLeg["a::b"].transferCount, 3);
  assert.equal(result.conservativeEvidenceByLeg["a::b"].provenance.requestKey, requests[1].requestKey);
  assert.ok(result.observations.some((entry) => entry.provenance.requestKey === requests[3].requestKey && entry.reason === "iteration_limit"));
});

test("returns immediately for a plan with no selected transit legs", async () => {
  let called = false;
  const result = await convergeTransitPlan({
    initial: state("walk-only", []),
    fetchLegs: () => {
      called = true;
      return [];
    },
    rebuild: (context) => context.current,
  });

  assert.equal(called, false);
  assert.equal(result.stopReason, "no_transit_legs");
  assert.equal(result.iterations, 0);
  assert.equal(result.eventCount, 0);
  assert.equal(result.converged, true);
  assert.equal(result.conditional, false);
});
