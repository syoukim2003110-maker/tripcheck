import { RailNetwork, type RailNetworkData } from "./rail-router.ts";
import { isToeiTimetableData, type ToeiTimetableData } from "./shiori/timetable.ts";

/**
 * Loads one city's bundled rail map (a static file shipped with the site) and
 * builds the router over it. Null when the file is missing or malformed: the
 * booklet then shows estimated transit legs instead of train routes.
 */
export async function loadRailNetwork(cityId: string, signal?: AbortSignal): Promise<RailNetwork | null> {
  if (!/^[a-z]{2,24}$/.test(cityId)) return null;
  try {
    const response = await fetch(`/rail/${cityId}.json`, { signal });
    if (!response.ok) return null;
    const data = await response.json() as RailNetworkData;
    if (!Array.isArray(data?.stations) || !Array.isArray(data?.edges) || !Array.isArray(data?.lines)) return null;
    return new RailNetwork(data);
  } catch {
    return null;
  }
}

/**
 * The Toei lines' published timetables (a static file of this site, about
 * 300 KB). Asked for only when a dated plan has a Toei ride; null when it is
 * missing or malformed, and the rides then show no times, as before.
 */
export async function loadToeiTimetable(signal?: AbortSignal): Promise<ToeiTimetableData | null> {
  try {
    const response = await fetch("/timetable/toei.json", { signal });
    if (!response.ok) return null;
    const data: unknown = await response.json();
    return isToeiTimetableData(data) ? data : null;
  } catch {
    return null;
  }
}
