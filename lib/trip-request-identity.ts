/**
 * Anonymous, browser-local identity for one planning run.
 *
 * This token is deliberately independent from itinerary text and the public
 * share payload. It exists only so server-side paid-provider ceilings can bind
 * all requests from one trip without falling back to a clock bucket.
 */

export const TRIP_REQUEST_HEADER = "X-TripCheck-Trip";
export const TRIP_REQUEST_STORAGE_KEY = "tripcheck.provider-trip.v1";

type SessionStorageLike = Pick<Storage, "getItem" | "setItem">;

type TripRequestIdentityOptions = Readonly<{
  storage?: () => SessionStorageLike | null;
  generateToken?: () => string;
}>;

export type TripRequestIdentity = Readonly<{
  currentToken(): string;
  rotateToken(): string;
  headers(initial?: HeadersInit): Headers;
}>;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,96}$/;

function validToken(value: string | null): value is string {
  return Boolean(value && TOKEN_PATTERN.test(value));
}

function randomToken() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return `trip_${cryptoApi.randomUUID().replaceAll("-", "")}`;
  }
  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = new Uint8Array(18);
    cryptoApi.getRandomValues(bytes);
    return `trip_${[...bytes].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  }
  // Old/private browser fall-back. This remains opaque and never incorporates
  // user input; paid quotas are still bounded by the server session/day caps.
  const random = Math.random().toString(36).slice(2).padEnd(12, "0");
  return `trip_${Date.now().toString(36)}_${random}`;
}

function browserSessionStorage() {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function createTripRequestIdentity(options: TripRequestIdentityOptions = {}): TripRequestIdentity {
  const storage = options.storage ?? browserSessionStorage;
  const generateToken = options.generateToken ?? randomToken;
  let memoryToken: string | null = null;
  let fallbackRotation = 0;

  function availableStorage() {
    try {
      return storage();
    } catch {
      return null;
    }
  }

  function persist(token: string) {
    try {
      availableStorage()?.setItem(TRIP_REQUEST_STORAGE_KEY, token);
    } catch {
      // Safari private mode and restrictive embeds can expose sessionStorage
      // while throwing on writes. The in-memory token remains stable.
    }
  }

  function generateDistinctToken(previous: string | null) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate = generateToken();
      if (validToken(candidate) && candidate !== previous) return candidate;
    }
    fallbackRotation += 1;
    const candidate = `${randomToken()}_${fallbackRotation.toString(36)}`.slice(0, 96);
    if (!validToken(candidate) || candidate === previous) throw new Error("trip_request_token_generation_failed");
    return candidate;
  }

  function rotateToken() {
    memoryToken = generateDistinctToken(memoryToken);
    persist(memoryToken);
    return memoryToken;
  }

  function currentToken() {
    if (memoryToken) return memoryToken;
    try {
      const stored = availableStorage()?.getItem(TRIP_REQUEST_STORAGE_KEY) ?? null;
      if (validToken(stored)) {
        memoryToken = stored;
        return stored;
      }
    } catch {
      // Read failures use the same memory-only path as write failures.
    }
    return rotateToken();
  }

  function headers(initial: HeadersInit = {}) {
    const result = new Headers(initial);
    result.set(TRIP_REQUEST_HEADER, currentToken());
    return result;
  }

  return { currentToken, rotateToken, headers };
}

const browserIdentity = createTripRequestIdentity();

export function rotateTripRequestToken() {
  return browserIdentity.rotateToken();
}

export function tripRequestHeaders(initial: HeadersInit = {}) {
  return browserIdentity.headers(initial);
}
