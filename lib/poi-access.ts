import type { RouteStop } from "./route-optimizer.ts";
import type { TransportMode } from "./time-feasibility.ts";

export type PoiAccessPolicy = {
  id: "jungfraujoch" | "gornergrat";
  labels: readonly string[];
  accessNode: {
    /** Product-owned transport identity; never a Google Place display field. */
    id: string;
    name: string;
    providerQuery: string;
    /** Optional by design: a missing or invalid coordinate must fail conditional. */
    coordinate?: PoiAccessCoordinate;
    coordinateSourceUrl?: string;
  };
  allowedModes: readonly TransportMode[];
  note: { en: string; ja: string };
  sourceUrl: string;
  verifiedAt: string;
  confidence: "high";
};

export type PoiAccessCoordinate = Readonly<{ latitude: number; longitude: number }>;

export type PoiAccessAssumption = Readonly<{
  policyId: PoiAccessPolicy["id"];
  mountainStopId: string;
  mountainStopName: string;
  endpointRole: "origin" | "destination";
  accessNodeId: string;
  accessNodeName: string;
  providerQuery: string;
  coordinate: PoiAccessCoordinate | null;
  coordinateSourceUrl?: string;
  sourceUrl: string;
  verifiedAt: string;
  confidence: PoiAccessPolicy["confidence"];
  note: PoiAccessPolicy["note"];
}>;

export type PoiRouteEndpoint = Readonly<{
  id: string;
  name: string;
  coordinate: PoiAccessCoordinate;
  kind: "poi" | "access_node";
  providerQuery?: string;
}>;

export type LegAccessResolution = Readonly<{
  status: "direct" | "access_node" | "conditional";
  origin: PoiRouteEndpoint | null;
  destination: PoiRouteEndpoint | null;
  /** Distinct from the itinerary leg id so endpoint evidence cannot collide. */
  routingEndpointKey: string | null;
  assumptions: readonly PoiAccessAssumption[];
  reason?: "access_node_coordinates_unavailable";
}>;

// Access-node coordinates below are product-owned Swiss public-transport stop
// facts (DiDok), not cached Google content. Timetables remain runtime provider
// evidence; the summit POI is never replaced in the traveller's itinerary.
export const POI_ACCESS_POLICIES: readonly PoiAccessPolicy[] = Object.freeze([
  Object.freeze({
    id: "jungfraujoch",
    labels: Object.freeze(["jungfraujoch", "jungfrau top of europe", "ユングフラウヨッホ", "ユングフラウ トップ オブ ヨーロッパ"]),
    accessNode: Object.freeze({
      id: "didok-8507361",
      name: "Eigergletscher station",
      providerQuery: "Eigergletscher station, Switzerland",
      coordinate: Object.freeze({ latitude: 46.5748, longitude: 7.974861 }),
      coordinateSourceUrl: "https://data.sbb.ch/explore/dataset/dienststellen-gemass-opentransportdataswiss/table/?q=8507361",
    }),
    allowedModes: Object.freeze(["transit"] as const),
    note: Object.freeze({
      en: "Mountain transport is required via Grindelwald Terminal or Kleine Scheidegg and Eigergletscher.",
      ja: "グリンデルワルト・ターミナルまたはクライネ・シャイデックからアイガーグレッチャーを経由する山岳交通が必要です。",
    }),
    sourceUrl: "https://www.jungfrau.ch/en-gb/arriving/",
    verifiedAt: "2026-08-09",
    confidence: "high",
  }),
  Object.freeze({
    id: "gornergrat",
    labels: Object.freeze(["gornergrat", "ゴルナーグラート"]),
    accessNode: Object.freeze({
      id: "didok-8501690",
      name: "Zermatt GGB station",
      providerQuery: "Zermatt GGB station, Switzerland",
      coordinate: Object.freeze({ latitude: 46.023889, longitude: 7.748889 }),
      coordinateSourceUrl: "https://data.sbb.ch/explore/dataset/dienststellen-gemass-opentransportdataswiss/table/?q=8501690",
    }),
    allowedModes: Object.freeze(["transit"] as const),
    note: Object.freeze({
      en: "Use the Gornergrat Railway from its valley station opposite Zermatt station; no direct road route is shown.",
      ja: "ツェルマット駅向かいのゴルナーグラート鉄道を利用します。山頂への直通道路としては表示しません。",
    }),
    sourceUrl: "https://www.gornergrat.ch/en/pages/timetable-gornergrat-bahn",
    verifiedAt: "2026-08-09",
    confidence: "high",
  }),
]);

function normalizeAccessLabel(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function poiAccessPolicyForStop(
  stop: { name: string; input?: string },
  policies: readonly PoiAccessPolicy[] = POI_ACCESS_POLICIES,
) {
  const values = [stop.name, "input" in stop ? stop.input : undefined]
    .filter((value): value is string => Boolean(value))
    .map(normalizeAccessLabel);
  return policies.find((policy) => policy.labels.some((label) => {
    const normalized = normalizeAccessLabel(label);
    return values.some((value) => value === normalized || value.includes(normalized));
  })) ?? null;
}

export function allowedTransportModesForLeg(from: RouteStop, to: RouteStop): readonly TransportMode[] {
  const fromPolicy = poiAccessPolicyForStop(from);
  const toPolicy = poiAccessPolicyForStop(to);
  if (!fromPolicy && !toPolicy) return ["walk", "transit", "taxi"];
  const fromModes = fromPolicy?.allowedModes ?? ["walk", "transit", "taxi"];
  const toModes = toPolicy?.allowedModes ?? ["walk", "transit", "taxi"];
  return (["walk", "transit", "taxi"] as const).filter((mode) => fromModes.includes(mode) && toModes.includes(mode));
}

function validCoordinate(value: PoiAccessCoordinate | undefined): PoiAccessCoordinate | null {
  if (!value
    || !Number.isFinite(value.latitude)
    || !Number.isFinite(value.longitude)
    || value.latitude < -90
    || value.latitude > 90
    || value.longitude < -180
    || value.longitude > 180) return null;
  return Object.freeze({ latitude: value.latitude, longitude: value.longitude });
}

function assumptionFor(
  stop: RouteStop,
  policy: PoiAccessPolicy,
  endpointRole: PoiAccessAssumption["endpointRole"],
): PoiAccessAssumption {
  return Object.freeze({
    policyId: policy.id,
    mountainStopId: stop.id,
    mountainStopName: stop.name,
    endpointRole,
    accessNodeId: policy.accessNode.id,
    accessNodeName: policy.accessNode.name,
    providerQuery: policy.accessNode.providerQuery,
    coordinate: validCoordinate(policy.accessNode.coordinate),
    ...(policy.accessNode.coordinateSourceUrl ? { coordinateSourceUrl: policy.accessNode.coordinateSourceUrl } : {}),
    sourceUrl: policy.sourceUrl,
    verifiedAt: policy.verifiedAt,
    confidence: policy.confidence,
    note: policy.note,
  });
}

function directEndpoint(stop: RouteStop): PoiRouteEndpoint {
  return Object.freeze({
    id: stop.id,
    name: stop.name,
    coordinate: Object.freeze({ latitude: stop.latitude, longitude: stop.longitude }),
    kind: "poi",
  });
}

function accessEndpoint(policy: PoiAccessPolicy, coordinate: PoiAccessCoordinate): PoiRouteEndpoint {
  return Object.freeze({
    id: `access-node:${policy.id}:${policy.accessNode.id}`,
    name: policy.accessNode.name,
    coordinate,
    kind: "access_node",
    providerQuery: policy.accessNode.providerQuery,
  });
}

/**
 * Resolves provider routing endpoints without mutating either itinerary stop.
 * The injectable policy list is a deterministic test seam for missing-data
 * coverage; production callers use the frozen catalogue above.
 */
export function routeAccessEndpointsForLeg(
  from: RouteStop,
  to: RouteStop,
  policies: readonly PoiAccessPolicy[] = POI_ACCESS_POLICIES,
): LegAccessResolution {
  const fromPolicy = poiAccessPolicyForStop(from, policies);
  const toPolicy = poiAccessPolicyForStop(to, policies);
  if (!fromPolicy && !toPolicy) {
    const origin = directEndpoint(from);
    const destination = directEndpoint(to);
    return Object.freeze({
      status: "direct",
      origin,
      destination,
      routingEndpointKey: `${origin.id}::${destination.id}`,
      assumptions: Object.freeze([]),
    });
  }

  const assumptions = Object.freeze([
    ...(fromPolicy ? [assumptionFor(from, fromPolicy, "origin")] : []),
    ...(toPolicy ? [assumptionFor(to, toPolicy, "destination")] : []),
  ]);
  if (assumptions.some((assumption) => assumption.coordinate === null)) {
    return Object.freeze({
      status: "conditional",
      origin: null,
      destination: null,
      routingEndpointKey: null,
      assumptions,
      reason: "access_node_coordinates_unavailable",
    });
  }

  const origin = fromPolicy
    ? accessEndpoint(fromPolicy, assumptions.find((item) => item.endpointRole === "origin")!.coordinate!)
    : directEndpoint(from);
  const destination = toPolicy
    ? accessEndpoint(toPolicy, assumptions.find((item) => item.endpointRole === "destination")!.coordinate!)
    : directEndpoint(to);
  return Object.freeze({
    status: "access_node",
    origin,
    destination,
    routingEndpointKey: `${origin.id}::${destination.id}`,
    assumptions,
  });
}
