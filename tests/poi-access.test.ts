import assert from "node:assert/strict";
import test from "node:test";
import {
  allowedTransportModesForLeg,
  poiAccessPolicyForStop,
  routeAccessEndpointsForLeg,
  type PoiAccessPolicy,
} from "../lib/poi-access.ts";
import type { RouteStop } from "../lib/route-optimizer.ts";

function stop(name: string): RouteStop {
  return { id: name, name, area: "Switzerland", latitude: 0, longitude: 0, sourceUrl: "", verifiedAt: "", confidence: "low", planningDurationMinutes: 60, isAnchor: false };
}

test("mountain rail destinations never expose direct walking or taxi modes", () => {
  assert.deepEqual(allowedTransportModesForLeg(stop("Zermatt"), stop("Gornergrat")), ["transit"]);
  assert.deepEqual(allowedTransportModesForLeg(stop("Interlaken"), stop("ユングフラウヨッホ")), ["transit"]);
  assert.deepEqual(allowedTransportModesForLeg(stop("Gornergrat"), stop("Zermatt")), ["transit"]);
});

test("ordinary places keep every supported mode", () => {
  assert.deepEqual(allowedTransportModesForLeg(stop("Kapellbrücke"), stop("Lion Monument")), ["walk", "transit", "taxi"]);
});

test("access policies keep an official source and runtime access-node query", () => {
  const policy = poiAccessPolicyForStop(stop("Jungfraujoch – Top of Europe"));
  assert.equal(policy?.id, "jungfraujoch");
  assert.match(policy?.accessNode.providerQuery ?? "", /Eigergletscher/);
  assert.equal(policy?.accessNode.id, "didok-8507361");
  assert.deepEqual(policy?.accessNode.coordinate, { latitude: 46.5748, longitude: 7.974861 });
  assert.match(policy?.accessNode.coordinateSourceUrl ?? "", /data\.sbb\.ch/);
  assert.match(policy?.sourceUrl ?? "", /^https:\/\/www\.jungfrau\.ch\//);
  assert.equal(policy?.confidence, "high");
});

test("a mountain leg resolves a distinct access endpoint without replacing the summit", () => {
  const from = { ...stop("Zermatt"), id: "zermatt", latitude: 46.0207, longitude: 7.7491 };
  const summit = { ...stop("Gornergrat"), id: "gornergrat", latitude: 45.9834, longitude: 7.7847 };
  const resolution = routeAccessEndpointsForLeg(from, summit);

  assert.equal(resolution.status, "access_node");
  assert.equal(resolution.origin?.id, "zermatt");
  assert.equal(resolution.destination?.id, "access-node:gornergrat:didok-8501690");
  assert.deepEqual(resolution.destination?.coordinate, { latitude: 46.023889, longitude: 7.748889 });
  assert.match(resolution.routingEndpointKey ?? "", /access-node:gornergrat/);
  assert.equal(resolution.assumptions[0].mountainStopId, summit.id);
  assert.equal(resolution.assumptions[0].endpointRole, "destination");
  assert.deepEqual({ name: summit.name, latitude: summit.latitude, longitude: summit.longitude }, {
    name: "Gornergrat",
    latitude: 45.9834,
    longitude: 7.7847,
  }, "the itinerary POI remains the summit");
});

test("missing access-node coordinates fail conditional instead of reusing summit coordinates", () => {
  const source = poiAccessPolicyForStop(stop("Gornergrat"))!;
  const missingCoordinatePolicy: PoiAccessPolicy = {
    ...source,
    accessNode: {
      id: "future-node",
      name: "Future verified station",
      providerQuery: "Future verified station",
    },
  };
  const resolution = routeAccessEndpointsForLeg(
    { ...stop("Zermatt"), latitude: 46.0207, longitude: 7.7491 },
    { ...stop("Gornergrat"), latitude: 45.9834, longitude: 7.7847 },
    [missingCoordinatePolicy],
  );

  assert.equal(resolution.status, "conditional");
  assert.equal(resolution.reason, "access_node_coordinates_unavailable");
  assert.equal(resolution.origin, null);
  assert.equal(resolution.destination, null);
  assert.equal(resolution.assumptions[0].coordinate, null);
});
