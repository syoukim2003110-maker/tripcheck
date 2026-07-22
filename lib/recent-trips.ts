/*
 * Device-local trip history. Entries live only in this browser's localStorage;
 * nothing leaves the device, so the server-side "nothing is saved" promise
 * stays intact. Each entry stores the same self-contained code a share link
 * uses, so reopening is exactly the share-link flow.
 */

export type RecentTrip = {
  code: string;
  title: string;
  days: number;
  startDate: string;
  savedAt: string;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STORAGE_KEY = "tripcheck-recent-trips";
const MAX_ENTRIES = 5;

function isRecentTrip(value: unknown): value is RecentTrip {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.code === "string" && entry.code.length > 0
    && typeof entry.title === "string"
    && typeof entry.days === "number" && Number.isFinite(entry.days)
    && typeof entry.startDate === "string"
    && typeof entry.savedAt === "string";
}

export function loadRecentTrips(storage: StorageLike): RecentTrip[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentTrip).slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function rememberRecentTrip(storage: StorageLike, entry: RecentTrip): RecentTrip[] {
  const next = [entry, ...loadRecentTrips(storage).filter((existing) => existing.code !== entry.code)].slice(0, MAX_ENTRIES);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* Storage may be full or blocked; the in-memory list still works this session. */
  }
  return next;
}

export function forgetRecentTrip(storage: StorageLike, code: string): RecentTrip[] {
  const next = loadRecentTrips(storage).filter((existing) => existing.code !== code);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}
