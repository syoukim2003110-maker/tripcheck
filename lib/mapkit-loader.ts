import { appleRelayUrl } from "./apple-relay-client.ts";

/*
 * Apple's MapKit JS, loaded once for the whole page: the booklet's map and
 * Apple's place card share one script, one initialisation and one token.
 *
 * Nothing here runs on import. The script is fetched the first time something
 * asks for it, with a short-lived token the site's own relay signs for this
 * origin (op=maptoken, 20 minutes); the private key stays on the server.
 */

export type MapToken = Readonly<{ token: string; expiresAt: number }>;

/** A token is replaced this long before it runs out, so a request never leaves with a dying one. */
const TOKEN_MARGIN_SECONDS = 60;

/**
 * Hands out the current token, asking for a new one only when there is none
 * or it is about to expire. Callers arriving together share one request, and
 * a failed request is not remembered: the next call tries again.
 */
export function createMapTokenSource(fetchToken: () => Promise<MapToken>, nowSeconds: () => number = () => Date.now() / 1000) {
  let current: MapToken | null = null;
  let pending: Promise<MapToken> | null = null;
  return async function mapToken(): Promise<string> {
    if (current && current.expiresAt - TOKEN_MARGIN_SECONDS > nowSeconds()) return current.token;
    pending ??= fetchToken().then(
      (next) => { current = next; pending = null; return next; },
      (error) => { pending = null; throw error; },
    );
    return (await pending).token;
  };
}

/** What the relay's `op=maptoken` answered, or null when it is not a usable token. */
export function readMapToken(payload: unknown, nowSeconds: () => number = () => Date.now() / 1000): MapToken | null {
  if (!payload || typeof payload !== "object") return null;
  const { token, expiresAt, expiresIn } = payload as Record<string, unknown>;
  if (typeof token !== "string" || !/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return null;
  // The lifetime is counted on this device's own clock: a phone twenty minutes
  // slow would otherwise keep handing Apple a token that has already run out.
  if (typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0) return { token, expiresAt: nowSeconds() + expiresIn };
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  return { token, expiresAt };
}

/** The full bundle: the map, annotations, overlays and the place card in one script. */
export const MAPKIT_SCRIPT_URL = "https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js";

async function fetchMapToken(): Promise<MapToken> {
  const relay = appleRelayUrl();
  if (!relay) throw new Error("apple_relay_not_configured");
  const url = new URL(relay, window.location.href);
  url.searchParams.set("op", "maptoken");
  const response = await globalThis.fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  const token = response.ok ? readMapToken(await response.json().catch(() => null)) : null;
  if (!token) throw new Error("apple_map_token_unavailable");
  return token;
}

/** The page's one token source; every MapKit JS caller goes through it. */
export const mapToken = createMapTokenSource(fetchMapToken);

/* Only the parts of MapKit JS this site uses, typed loosely enough to stay honest. */
export type MapKitCoordinate = { latitude: number; longitude: number };
export type MapKitEvent = { status?: string; annotation?: MapKitAnnotation };
export type MapKitAnnotation = {
  element: HTMLElement;
  selected: boolean;
  visible: boolean;
  data: Record<string, unknown>;
};
export type MapKitOverlay = object;
export type MapKitRegion = { center: MapKitCoordinate; span: { latitudeDelta: number; longitudeDelta: number } };
export type MapKitMap = {
  annotations: MapKitAnnotation[];
  overlays: MapKitOverlay[];
  region: MapKitRegion;
  selectedAnnotation: MapKitAnnotation | null;
  addAnnotations: (items: MapKitAnnotation[]) => void;
  removeAnnotations: (items: MapKitAnnotation[]) => void;
  addOverlays: (items: MapKitOverlay[]) => void;
  removeOverlays: (items: MapKitOverlay[]) => void;
  setRegionAnimated: (region: unknown, animate?: boolean) => void;
  setCenterAnimated: (center: unknown, animate?: boolean) => void;
  addEventListener: (type: string, listener: (event: MapKitEvent) => void) => void;
  removeEventListener: (type: string, listener: (event: MapKitEvent) => void) => void;
  destroy: () => void;
};
export type MapKitPlace = { name?: string };
export type MapKitPlaceDetail = { destroy?: () => void };
export type MapKit = {
  init: (options: { authorizationCallback: (done: (token: string) => void) => void; language?: string }) => void;
  addEventListener: (type: string, listener: (event: MapKitEvent) => void) => void;
  Map: new (host: HTMLElement, options: Record<string, unknown>) => MapKitMap;
  Coordinate: new (latitude: number, longitude: number) => MapKitCoordinate;
  CoordinateSpan: new (latitudeDelta: number, longitudeDelta: number) => object;
  CoordinateRegion: new (center: MapKitCoordinate, span: object) => MapKitRegion;
  Padding: new (top: number, right: number, bottom: number, left: number) => object;
  Style: new (options: Record<string, unknown>) => object;
  PolylineOverlay: new (points: MapKitCoordinate[], options: Record<string, unknown>) => MapKitOverlay;
  Annotation: new (at: MapKitCoordinate, factory: () => HTMLElement, options: Record<string, unknown>) => MapKitAnnotation;
  PointOfInterestFilter: { excludingAllCategories: unknown };
  FeatureVisibility: { Hidden: string; Visible: string; Adaptive: string };
  PlaceLookup: new () => { getPlace: (id: string, callback: (error: unknown, place: MapKitPlace | null) => void) => void };
  PlaceDetail: new (host: HTMLElement, place: MapKitPlace, options: { colorScheme?: string; displaysMap?: boolean }) => MapKitPlaceDetail;
};

let mapkitReady: Promise<MapKit> | null = null;

/**
 * Whether MapKit JS is working: "pending" until Apple has accepted the first
 * token, "ready" once it has, "failed" when it refused (a token it would not
 * take, "Unauthorized"; the day's map quota spent, "Too Many Requests") or
 * could not be loaded at all.
 */
export type MapKitState = "pending" | "ready" | "failed";
let state: MapKitState = "pending";
const stateListeners = new Set<(next: MapKitState) => void>();

function setState(next: MapKitState) {
  if (state === next) return;
  state = next;
  for (const listener of [...stateListeners]) listener(next);
}

/** Hears every change of state; the current one is told at once. Returns the unsubscribe. */
export function onMapKitState(listener: (next: MapKitState) => void) {
  listener(state);
  stateListeners.add(listener);
  return () => { stateListeners.delete(listener); };
}

/** Apple's script, added to the page once, on the first map or card anyone needs. */
export function loadMapKit(language: "ja" | "en"): Promise<MapKit> {
  mapkitReady ??= new Promise<MapKit>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = MAPKIT_SCRIPT_URL;
    script.crossOrigin = "anonymous";
    script.async = true;
    script.onload = () => {
      const mapkit = (window as unknown as { mapkit?: MapKit }).mapkit;
      if (!mapkit?.Map || !mapkit.PlaceDetail || !mapkit.PlaceLookup) { script.remove(); reject(new Error("mapkit_incomplete")); return; }
      // "Initialized" or "Refreshed": Apple took the token.
      mapkit.addEventListener("configuration-change", () => setState("ready"));
      mapkit.addEventListener("error", () => setState("failed"));
      mapkit.init({
        // Apple calls this again whenever it wants a fresh token.
        authorizationCallback: (done) => { mapToken().then(done, () => done("")); },
        language,
      });
      resolve(mapkit);
    };
    script.onerror = () => { script.remove(); setState("failed"); reject(new Error("mapkit_script_failed")); };
    document.head.appendChild(script);
  }).catch((error) => {
    // A failed load (offline, blocked) may be tried again later.
    mapkitReady = null;
    setState("failed");
    throw error;
  });
  return mapkitReady;
}
