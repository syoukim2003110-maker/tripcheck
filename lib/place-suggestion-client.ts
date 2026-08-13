import type { DestinationChoice } from "./destinations.ts";
import type { Locale } from "./i18n.ts";
import type { PlaceSuggestion } from "./google-place-suggestions.ts";
import type { ShareableResolutionOverride } from "./share-link.ts";
import { parsedWishlistPlaces } from "./wishlist-parser.ts";
import { tripRequestHeaders } from "./trip-request-identity.ts";

export type PlaceSuggestionFailure = "quota_exhausted" | "unavailable";

export class PlaceSuggestionError extends Error {
  readonly code: PlaceSuggestionFailure;

  constructor(code: PlaceSuggestionFailure) {
    super(code);
    this.code = code;
  }
}

function validSuggestion(value: unknown): value is PlaceSuggestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const suggestion = value as Record<string, unknown>;
  return typeof suggestion.providerRef === "string"
    && /^[A-Za-z0-9_-]{1,256}$/.test(suggestion.providerRef)
    && typeof suggestion.primaryText === "string"
    && suggestion.primaryText.trim().length > 0
    && suggestion.primaryText.length <= 160
    && typeof suggestion.secondaryText === "string"
    && suggestion.secondaryText.length <= 240
    && typeof suggestion.fullText === "string"
    && suggestion.fullText.trim().length > 0
    && suggestion.fullText.length <= 300;
}

export async function requestPlaceSuggestions(
  query: string,
  locale: Locale,
  destination: DestinationChoice,
  signal?: AbortSignal,
): Promise<PlaceSuggestion[]> {
  let response: Response;
  try {
    response = await fetch("/api/place-suggestions", {
      method: "POST",
      headers: tripRequestHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ query, languageCode: locale === "ja" ? "ja" : "en", destination }),
      signal,
    });
  } catch {
    throw new PlaceSuggestionError("unavailable");
  }
  const body = await response.json().catch(() => null) as { suggestions?: unknown[]; code?: string } | null;
  if (!response.ok || !body) {
    if (response.status === 429 || body?.code === "budget_exhausted") {
      throw new PlaceSuggestionError("quota_exhausted");
    }
    throw new PlaceSuggestionError("unavailable");
  }
  return Array.isArray(body.suggestions) ? body.suggestions.filter(validSuggestion).slice(0, 5) : [];
}

function normalizedPlaceName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

function parsedOccurrenceIdentity(place: ReturnType<typeof parsedWishlistPlaces>[number]) {
  return JSON.stringify([
    normalizedPlaceName(place.name),
    place.day,
    place.time,
    place.timeOfDay,
    place.isReservation,
    place.priority,
    place.stayMinutes,
  ]);
}

/**
 * Carries provider choices across ordinary textarea edits by matching the
 * unchanged place occurrences, not by blindly retaining numeric indexes.
 * An edited/deleted occurrence loses its provider pin; inserting another line
 * shifts the existing pin to that occurrence's new index.
 */
export function rebaseResolutionOverrides(
  previousRaw: string,
  nextRaw: string,
  current: readonly ShareableResolutionOverride[],
): ShareableResolutionOverride[] {
  if (current.length === 0 || previousRaw === nextRaw) return [...current];
  const previous = parsedWishlistPlaces(previousRaw).map(parsedOccurrenceIdentity);
  const next = parsedWishlistPlaces(nextRaw).map(parsedOccurrenceIdentity);
  const previousCounts = new Map<string, number>();
  const nextCounts = new Map<string, number>();
  previous.forEach((identity) => previousCounts.set(identity, (previousCounts.get(identity) ?? 0) + 1));
  next.forEach((identity) => nextCounts.set(identity, (nextCounts.get(identity) ?? 0) + 1));
  const rows = previous.length + 1;
  const columns = next.length + 1;
  const lcs = Array.from({ length: rows }, () => new Uint8Array(columns));
  for (let left = previous.length - 1; left >= 0; left -= 1) {
    for (let right = next.length - 1; right >= 0; right -= 1) {
      lcs[left][right] = previous[left] === next[right]
        ? 1 + lcs[left + 1][right + 1]
        : Math.max(lcs[left + 1][right], lcs[left][right + 1]);
    }
  }
  const nextIndexByPrevious = new Map<number, number>();
  let left = 0;
  let right = 0;
  while (left < previous.length && right < next.length) {
    if (previous[left] === next[right]) {
      nextIndexByPrevious.set(left, right);
      left += 1;
      right += 1;
    } else if (lcs[left + 1][right] > lcs[left][right + 1]) {
      left += 1;
    } else {
      // Prefer treating a tie as newly inserted input so later occurrences
      // keep their established identity.
      right += 1;
    }
  }
  return current.flatMap((override) => {
    const identity = previous[override.inputIndex];
    // Two byte-equivalent occurrences are not safely distinguishable after a
    // free-form edit. Dropping the pin forces an explicit re-selection instead
    // of silently attaching one Place ID to the wrong visit occurrence.
    if (!identity || previousCounts.get(identity) !== 1 || nextCounts.get(identity) !== 1) return [];
    const inputIndex = nextIndexByPrevious.get(override.inputIndex);
    return inputIndex === undefined ? [] : [{ ...override, inputIndex }];
  }).sort((a, b) => a.inputIndex - b.inputIndex).slice(0, 12);
}

export type ActiveWishlistPlace = { inputIndex: number; query: string };

/** Returns the parsed place occurrence on the textarea line containing the caret. */
export function activeWishlistPlaceAtCursor(
  raw: string,
  selectionStart: number,
): ActiveWishlistPlace | null {
  const safeCursor = Math.min(raw.length, Math.max(0, selectionStart));
  const lineStart = raw.lastIndexOf("\n", Math.max(0, safeCursor - 1)) + 1;
  const nextBreak = raw.indexOf("\n", safeCursor);
  const lineEnd = nextBreak < 0 ? raw.length : nextBreak;
  const beforeLine = raw.slice(0, lineStart);
  const currentLine = raw.slice(lineStart, lineEnd);
  const currentPlaces = parsedWishlistPlaces(currentLine);
  if (currentPlaces.length !== 1) return null;
  return {
    inputIndex: parsedWishlistPlaces(beforeLine).length,
    query: currentPlaces[0].name,
  };
}
