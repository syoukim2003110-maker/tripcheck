import {
  encodeTripShare,
  type ShareableResolutionOverride,
  type ShareableTripInput,
} from "./share-link.ts";
import {
  formatParsedWishlistPlaces,
  parseWishlist,
  type ParsedWishlistPlace,
} from "./wishlist-parser.ts";
import { resolveKnownStops } from "./route-optimizer.ts";

export const MAX_SHARE_FRAGMENT_CHARS = 6_000;

export type ShareScope = {
  dates: boolean;
  hotel: boolean;
  airports: boolean;
  reservations: boolean;
};

export type ShareWarningCode =
  | "URL_VISIBLE_TO_RECIPIENTS"
  | "URL_VISIBLE_IN_BROWSER_HISTORY"
  | "RESERVATION_DETAILS_INCLUDED"
  | "UNPARSED_LINES_OMITTED"
  | "LINK_TOO_LONG"
  | "NO_SHAREABLE_PLACES";

export type ScopedShareResult = {
  input: ShareableTripInput | null;
  code: string | null;
  warnings: ShareWarningCode[];
  omittedUnparsedLines: number;
  redactedReservationCount: number;
  blocked: boolean;
};

type ResolutionRemap = {
  overrides: ShareableResolutionOverride[];
  stopId(id: string): string | null;
};

function manualStopId(
  override: Extract<ShareableResolutionOverride, { name: string }>,
  inputIndex: number,
) {
  return `manual-${inputIndex}-${override.latitude.toFixed(5)}-${override.longitude.toFixed(5)}`;
}

function providerStopId(providerRef: string) {
  return `google-${providerRef}`;
}

function buildResolutionRemap(
  overrides: ShareableResolutionOverride[] | undefined,
  sourceToSharedIndex: ReadonlyMap<number, number>,
  blockedStableIds: ReadonlySet<string>,
) : ResolutionRemap {
  const remappedOverrides: ShareableResolutionOverride[] = [];
  const directIds = new Map<string, string>();
  const droppedIds = new Set<string>();
  const providerGroups = new Map<string, ShareableResolutionOverride[]>();

  for (const override of overrides ?? []) {
    const inputIndex = sourceToSharedIndex.get(override.inputIndex);
    // Project the union again at this boundary. In particular, never carry
    // mutable provider display fields through an untyped runtime object.
    if ("providerRef" in override) {
      const group = providerGroups.get(override.providerRef) ?? [];
      group.push(override);
      providerGroups.set(override.providerRef, group);
      if (inputIndex !== undefined) remappedOverrides.push({ inputIndex, providerRef: override.providerRef });
      continue;
    }
    const oldId = manualStopId(override, override.inputIndex);
    if (inputIndex === undefined) {
      droppedIds.add(oldId);
      continue;
    }
    const newId = manualStopId(override, inputIndex);
    directIds.set(oldId, newId);
    remappedOverrides.push({
      inputIndex,
      name: override.name,
      address: override.address,
      latitude: override.latitude,
      longitude: override.longitude,
    });
  }

  // A unique provider choice keeps the stable google-{Place ID} stop id even
  // when its occurrence index moves. If one occurrence from a duplicated
  // Place ID is omitted or renumbered, ownership of the base/suffixed ids is
  // ambiguous; drop that whole family rather than attach an edit to the wrong
  // visit.
  const blockedProviderFamilies = new Set<string>();
  for (const [providerRef, group] of providerGroups) {
    const retained = group.filter((override) => sourceToSharedIndex.has(override.inputIndex));
    const changed = group.some((override) => sourceToSharedIndex.get(override.inputIndex) !== override.inputIndex);
    if (retained.length === 0 || (group.length > 1 && (retained.length !== group.length || changed))) {
      blockedProviderFamilies.add(providerStopId(providerRef));
    }
  }

  const stopId = (id: string) => {
    if (typeof id !== "string" || !/^[A-Za-z0-9._-]{1,200}$/.test(id)) return null;
    if (blockedStableIds.has(id)) return null;
    const direct = directIds.get(id);
    if (direct) return direct;
    if (droppedIds.has(id)) return null;
    // A manual id without a corresponding retained override cannot be
    // reconstructed by the recipient. Keeping its edit would be a false claim
    // that it still points to a place.
    if (id.startsWith("manual-")) return null;
    for (const base of blockedProviderFamilies) {
      if (id === base || id.startsWith(`${base}--occurrence-`)) return null;
    }
    return id;
  };

  return { overrides: remappedOverrides, stopId };
}

function remapRecord<T>(source: Record<string, T>, remapId: (id: string) => string | null) {
  const values = new Map<string, T>();
  const conflicts = new Set<string>();
  for (const [oldId, value] of Object.entries(source)) {
    const id = remapId(oldId);
    if (!id || conflicts.has(id)) continue;
    if (values.has(id)) {
      values.delete(id);
      conflicts.add(id);
      continue;
    }
    values.set(id, value);
  }
  return Object.fromEntries(values);
}

function remapLegModes(
  source: ShareableTripInput["legModeOverrides"],
  remapId: (id: string) => string | null,
) {
  const values = new Map<string, ShareableTripInput["legModeOverrides"][string]>();
  const conflicts = new Set<string>();
  for (const [oldLegId, mode] of Object.entries(source)) {
    const separator = oldLegId.indexOf("::");
    if (separator <= 0 || separator !== oldLegId.lastIndexOf("::") || separator >= oldLegId.length - 2) continue;
    const from = remapId(oldLegId.slice(0, separator));
    const to = remapId(oldLegId.slice(separator + 2));
    if (!from || !to || from === to) continue;
    const legId = `${from}::${to}`;
    if (conflicts.has(legId)) continue;
    if (values.has(legId)) {
      values.delete(legId);
      conflicts.add(legId);
      continue;
    }
    values.set(legId, mode);
  }
  return Object.fromEntries(values) as ShareableTripInput["legModeOverrides"];
}

function remapLockedOrder(
  source: ShareableTripInput["lockedOrderByDay"],
  remapId: (id: string) => string | null,
) {
  const result: Record<string, string[]> = {};
  for (const [day, oldIds] of Object.entries(source ?? {})) {
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const oldId of oldIds) {
      const id = remapId(oldId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (ids.length > 0) result[day] = ids;
  }
  return result;
}

function remapRemovedStops(
  source: ShareableTripInput["removedStops"],
  remapId: (id: string) => string | null,
  retainedAuthoredNames: ReadonlySet<string>,
) {
  const values = new Map<string, { id: string; name: string }>();
  const conflicts = new Set<string>();
  for (const stop of source) {
    // The name is user-authored only when it still appears in the redacted
    // itinerary. Dropping a sensitive line must not leave its label behind in
    // a separate edit record.
    if (!retainedAuthoredNames.has(stop.name)) continue;
    const id = remapId(stop.id);
    if (!id || conflicts.has(id)) continue;
    if (values.has(id)) {
      values.delete(id);
      conflicts.add(id);
      continue;
    }
    values.set(id, { id, name: stop.name });
  }
  return [...values.values()];
}

/**
 * Builds the public fragment payload from an explicit privacy scope.
 * Opaque lines are never copied into a supposedly redacted URL: the parser
 * cannot prove that they do not contain a booking code, email, room number or
 * other private note, so they are omitted and disclosed to the traveller.
 */
export function buildScopedTripShare(
  source: ShareableTripInput,
  scope: ShareScope,
  locale: "en" | "ja" = "en",
): ScopedShareResult {
  const parsed = parseWishlist(source.itinerary);
  const sensitiveOpaqueLine = (raw: string) => (
    /https?:\/\/|\b[^\s@]+@[^\s@]+\.[^\s@]+\b/iu.test(raw)
    || /(?:booking|confirmation|reference|ref\.?|pnr|reservation\s*(?:no|number)|予約番号|確認番号|照会番号)\D{0,12}[A-Z0-9-]{5,}/iu.test(raw)
  );
  const omittedUnparsedLines = parsed.filter((line) => (
    line.kind === "unparsed" || (line.kind === "place" && sensitiveOpaqueLine(line.raw))
  )).length;
  const places: ParsedWishlistPlace[] = [];
  const sourceToSharedIndex = new Map<number, number>();
  const stableOwnership = new Map<string, { retained: boolean; dropped: boolean }>();
  let sourcePlaceIndex = 0;
  for (const line of parsed) {
    if (line.kind !== "place") continue;
    const omitLine = sensitiveOpaqueLine(line.raw);
    for (const place of line.places) {
      const sourceIndex = sourcePlaceIndex;
      sourcePlaceIndex += 1;
      for (const stop of resolveKnownStops(place.name, locale)) {
        const ownership = stableOwnership.get(stop.id) ?? { retained: false, dropped: false };
        if (omitLine) ownership.dropped = true;
        else ownership.retained = true;
        stableOwnership.set(stop.id, ownership);
      }
      if (omitLine) continue;
      sourceToSharedIndex.set(sourceIndex, places.length);
      places.push(place);
    }
  }
  const redactedReservationCount = scope.reservations ? 0 : places.filter((place) => place.isReservation).length;
  const sharePlaces = places.map((place) => scope.reservations || !place.isReservation
    ? place
    : {
        ...place,
        // A booked visit remains protected as Must, while the booking time and
        // reservation marker stay on the sender's device.
        time: null,
        isReservation: false,
        priority: "must" as const,
      });
  const itinerary = formatParsedWishlistPlaces(sharePlaces, locale);
  const retainedAuthoredNames = new Set(places.map((place) => place.name));
  // A stable catalogue ID shared by a retained and an omitted occurrence is
  // still ambiguous: fail closed rather than attach an edit to the wrong one.
  const blockedStableIds = new Set(
    [...stableOwnership].filter(([, ownership]) => ownership.dropped).map(([id]) => id),
  );
  const warnings: ShareWarningCode[] = [
    "URL_VISIBLE_TO_RECIPIENTS",
    "URL_VISIBLE_IN_BROWSER_HISTORY",
    ...(scope.reservations && places.some((place) => place.isReservation) ? ["RESERVATION_DETAILS_INCLUDED" as const] : []),
    ...(omittedUnparsedLines > 0 ? ["UNPARSED_LINES_OMITTED" as const] : []),
  ];
  if (!itinerary.trim()) {
    return {
      input: null,
      code: null,
      warnings: [...warnings, "NO_SHAREABLE_PLACES"],
      omittedUnparsedLines,
      redactedReservationCount,
      blocked: true,
    };
  }

  const {
    resolutionOverrides: sourceResolutionOverrides,
    userStayMinutes: sourceUserStayMinutes,
    lastEntryTimes: sourceLastEntryTimes,
    dayOverrides: sourceDayOverrides,
    lockedOrderByDay: sourceLockedOrderByDay,
    removedStops: sourceRemovedStops,
    legModeOverrides: sourceLegModeOverrides,
    ...sourceWithoutRemappedFields
  } = source;
  const resolution = buildResolutionRemap(sourceResolutionOverrides, sourceToSharedIndex, blockedStableIds);
  const input: ShareableTripInput = {
    ...sourceWithoutRemappedFields,
    itinerary,
    tripStartDate: scope.dates ? source.tripStartDate : "",
    dateWasProvided: scope.dates ? source.dateWasProvided : false,
    hotelQuery: scope.hotel ? source.hotelQuery : "",
    arrivalAirport: scope.airports ? source.arrivalAirport : "none",
    arrivalTime: scope.airports ? source.arrivalTime : "",
    departureAirport: scope.airports ? source.departureAirport : "none",
    departureTime: scope.airports ? source.departureTime : "",
    userStayMinutes: remapRecord(sourceUserStayMinutes, resolution.stopId),
    lastEntryTimes: remapRecord(sourceLastEntryTimes, resolution.stopId),
    dayOverrides: remapRecord(sourceDayOverrides, resolution.stopId),
    lockedOrderByDay: remapLockedOrder(sourceLockedOrderByDay, resolution.stopId),
    removedStops: remapRemovedStops(sourceRemovedStops, resolution.stopId, retainedAuthoredNames),
    legModeOverrides: remapLegModes(sourceLegModeOverrides, resolution.stopId),
    ...(resolution.overrides.length > 0 ? { resolutionOverrides: resolution.overrides } : {}),
  };
  const code = encodeTripShare(input);
  if (code.length > MAX_SHARE_FRAGMENT_CHARS) {
    return {
      input,
      code: null,
      warnings: [...warnings, "LINK_TOO_LONG"],
      omittedUnparsedLines,
      redactedReservationCount,
      blocked: true,
    };
  }
  return { input, code, warnings, omittedUnparsedLines, redactedReservationCount, blocked: false };
}
