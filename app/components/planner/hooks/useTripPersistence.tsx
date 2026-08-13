"use client";

// Trip persistence (refactor spec v2.1 hooks/): device-local recent-trip
// storage (IndexedDB via lib/trip-store), the one-time share-link hydration,
// the debounced autosave and the on-device passport-expiry memory. The
// hydration and rebuild logic themselves are passed in; this hook only owns
// when they run. applySharedTripInput stays in TripPlannerApp; buildPlan
// lives in usePlanBuild and arrives as a render-fresh forwarder that reads
// the pipeline's buildPlanRef, so the per-render closure the
// pendingSharedBuild effect invokes is unchanged from the inline days.
// This file is intentionally .tsx: the planner-surface contract tests scan
// app/**/*.tsx for the autosave and storage contracts, wherever they live.
import { useEffect, useRef, useState } from "react";
import { createTripStore, type StoredTripRecord, type TripStore } from "../../../../lib/trip-store";
import { decodeTripShare, type ShareableTripInput } from "../../../../lib/share-link";
import type { BuildPlanOptions } from "./usePlanBuild";
import {
  newDeviceTripId,
  storedTripShareCode,
  type PassportCountry,
} from "../../../../lib/planner-app-state";

export function useTripPersistence({
  planReady,
  tripDays,
  tripStartDate,
  localTripCode,
  localTripTitle,
  applySharedTripInput,
  buildPlan,
}: {
  planReady: boolean;
  tripDays: number;
  tripStartDate: string;
  localTripCode: string;
  localTripTitle: string;
  applySharedTripInput: (shared: ShareableTripInput) => void;
  buildPlan: (options?: BuildPlanOptions) => Promise<void>;
}) {
  const [pendingSharedBuild, setPendingSharedBuild] = useState(false);
  const [recentTrips, setRecentTrips] = useState<StoredTripRecord[]>([]);
  const [tripStorePersistent, setTripStorePersistent] = useState<boolean | null>(null);
  // Passport expiry never leaves the device: it exists only to turn "6 months
  // remaining required" into a personal yes/no before the airport does it.
  const [passportExpiry, setPassportExpiry] = useState("");
  const [passportCountry, setPassportCountry] = useState<PassportCountry>("unset");
  const tripStoreRef = useRef<TripStore | null>(null);
  const currentStoredTripIdRef = useRef<string | null>(null);

  // Device-local history is user-authored input only. IndexedDB stores up to
  // ten trips; provider responses and the derived BuiltTripPlan are rebuilt.
  // If private mode blocks IndexedDB, the store remains usable for this tab
  // and the UI says explicitly that it is not persistent.
  const sharedHydrationRef = useRef(false);
  useEffect(() => {
    if (sharedHydrationRef.current) return;
    sharedHydrationRef.current = true;
    try {
      // One-time cleanup for the removed airfare experiment. Airport choices
      // inside an actual recent trip remain; the obsolete standalone origin does not.
      window.localStorage.removeItem("tripcheck.airfareOrigin");
    } catch { /* private-mode storage stays optional */ }
    void createTripStore().then(async (store) => {
      tripStoreRef.current = store;
      setTripStorePersistent(store.status.persistent);
      setRecentTrips(await store.list());
    }).catch(() => {
      setTripStorePersistent(false);
    });
    const match = window.location.hash.match(/^#t=([A-Za-z0-9_-]+)$/);
    if (!match) return;
    const shared = decodeTripShare(match[1]);
    if (!shared) return;
    applySharedTripInput(shared);
  }, [applySharedTripInput]);

  useEffect(() => {
    if (!pendingSharedBuild) return;
    setPendingSharedBuild(false);
    void buildPlan({ preserveEdits: true });
    // buildPlan reads the freshly hydrated state from this render on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSharedBuild]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("tripcheck.passportExpiry");
      if (stored && /^\d{4}-\d{2}-\d{2}$/.test(stored)) setPassportExpiry(stored);
    } catch { /* storage unavailable (private mode) — the field just starts empty */ }
  }, []);

  // Save meaningful user-authored changes after a short quiet period. The
  // encoded input contains no fetched place, route, review or hours payload;
  // reopening deliberately resolves those facts again.
  useEffect(() => {
    if (!planReady || !localTripCode || tripStorePersistent === null) return;
    const timer = window.setTimeout(() => {
      const store = tripStoreRef.current;
      if (!store) return;
      const id = currentStoredTripIdRef.current ?? newDeviceTripId();
      currentStoredTripIdRef.current = id;
      void store.save({
        id,
        title: localTripTitle.slice(0, 160),
        payload: {
          input: { shareCode: localTripCode, tripDays, tripStartDate },
          edits: { schemaVersion: 1 },
        },
      }).then(async () => {
        // This is automatic recovery storage, not evidence that the traveller
        // accepted the plan. The adoption funnel records only an explicit share.
        setTripStorePersistent(store.status.persistent);
        setRecentTrips(await store.list());
      }).catch(() => {
        setTripStorePersistent(false);
      });
    }, 550);
    return () => window.clearTimeout(timer);
  }, [localTripCode, localTripTitle, planReady, tripDays, tripStartDate, tripStorePersistent]);

  async function openRecentTrip(entry: StoredTripRecord) {
    const code = storedTripShareCode(entry);
    const shared = code ? decodeTripShare(code) : null;
    if (!shared) {
      const store = tripStoreRef.current;
      if (store) {
        await store.delete(entry.id);
        setRecentTrips(await store.list());
      }
      return;
    }
    currentStoredTripIdRef.current = entry.id;
    applySharedTripInput(shared);
  }

  async function deleteRecentTrip(entry: StoredTripRecord) {
    const store = tripStoreRef.current;
    if (!store) return;
    await store.delete(entry.id);
    if (currentStoredTripIdRef.current === entry.id) currentStoredTripIdRef.current = null;
    setRecentTrips(await store.list());
  }

  return {
    recentTrips,
    tripStorePersistent,
    passportExpiry,
    setPassportExpiry,
    passportCountry,
    setPassportCountry,
    pendingSharedBuild,
    setPendingSharedBuild,
    currentStoredTripIdRef,
    openRecentTrip,
    deleteRecentTrip,
  };
}
