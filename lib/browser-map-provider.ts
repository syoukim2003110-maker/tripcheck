type BrowserMapEnvironment = {
  GOOGLE_MAPS_BROWSER_API_KEY?: string;
  NEXT_PUBLIC_TRIPCHECK_GOOGLE_MAP_ENABLED?: string;
};

/**
 * A stale browser key must never opt the traveller into billable map loads.
 * This helper reads only deliberately public browser-map configuration; it
 * belongs outside the server-only key and quota boundary.
 */
export function browserGoogleMapsApiKey(environment: BrowserMapEnvironment = process.env as BrowserMapEnvironment) {
  if (environment.NEXT_PUBLIC_TRIPCHECK_GOOGLE_MAP_ENABLED !== "true") return "";
  return environment.GOOGLE_MAPS_BROWSER_API_KEY?.trim() ?? "";
}
