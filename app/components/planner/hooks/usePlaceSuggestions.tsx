"use client";

/*
 * Owns the paid place-autocomplete lookup for the start input.
 *
 * Spec v2.1 §13: components emit events, hooks own provider calls. The
 * autocomplete panel is a leaf component, so the request lifecycle (debounce,
 * abort, cache, failure mapping) lives here and the panel receives a state
 * object plus one "the caret is on this place" callback.
 *
 * Two properties matter for cost. Requests key off (query, destination,
 * locale) only, so moving the caret inside an unchanged line cannot re-fire
 * one - it used to, at one billed Google event per cursor move. And answered
 * keys are cached for the session, so re-reading, blurring and refocusing, or
 * retyping a line the traveller already looked at costs nothing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DestinationChoice } from "../../../../lib/destinations.ts";
import type { PlaceSuggestion } from "../../../../lib/google-place-suggestions.ts";
import {
  PlaceSuggestionError,
  requestPlaceSuggestions,
  type ActiveWishlistPlace,
} from "../../../../lib/place-suggestion-client.ts";
import type { PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";

export type PlaceSuggestionStatus = "idle" | "loading" | "ready" | "unavailable" | "quota_exhausted";

export type PlaceSuggestionsState = {
  /** The place occurrence the caret is on, or null when no single place is in focus. */
  target: ActiveWishlistPlace | null;
  status: PlaceSuggestionStatus;
  suggestions: PlaceSuggestion[];
};

/** Shortest input worth a paid lookup; one character matches most of a country. */
const MINIMUM_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 550;
/** Bounded so a long session cannot grow the cache without limit. */
const MAX_CACHED_QUERIES = 60;

const emptyState: PlaceSuggestionsState = { target: null, status: "idle", suggestions: [] };

function requestKey(query: string, destination: DestinationChoice, locale: PlannerLocale) {
  return JSON.stringify([query.trim(), destination, locale]);
}

export function usePlaceSuggestions({
  locale,
  destination,
}: {
  locale: PlannerLocale;
  destination: DestinationChoice;
}) {
  // Only the key participates in the effect's identity: a new target object
  // describing the same query must not restart the request.
  const [request, setRequest] = useState<{ key: string; target: ActiveWishlistPlace } | null>(null);
  const [result, setResult] = useState<{ key: string; status: PlaceSuggestionStatus; suggestions: PlaceSuggestion[] }>({
    key: "",
    status: "idle",
    suggestions: [],
  });
  const cacheRef = useRef(new Map<string, PlaceSuggestion[]>());

  const requestSuggestionsFor = useCallback((target: ActiveWishlistPlace | null) => {
    setRequest((current) => {
      if (!target || target.query.trim().length < MINIMUM_QUERY_LENGTH) return null;
      const key = requestKey(target.query, destination, locale);
      // Same query, same place occurrence: keep the in-flight request and its
      // object identity so the effect below does not re-run.
      if (current && current.key === key && current.target.inputIndex === target.inputIndex) return current;
      return { key, target };
    });
  }, [destination, locale]);

  useEffect(() => {
    if (!request) return;
    const cached = cacheRef.current.get(request.key);
    if (cached) {
      setResult({ key: request.key, status: "ready", suggestions: cached });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setResult({ key: request.key, status: "loading", suggestions: [] });
      void requestPlaceSuggestions(request.target.query, locale, destination, controller.signal)
        .then((suggestions) => {
          if (controller.signal.aborted) return;
          if (cacheRef.current.size >= MAX_CACHED_QUERIES) {
            cacheRef.current.delete(cacheRef.current.keys().next().value as string);
          }
          cacheRef.current.set(request.key, suggestions);
          setResult({ key: request.key, status: "ready", suggestions });
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          // A failure is deliberately not cached: the next pause may succeed.
          setResult({
            key: request.key,
            status: error instanceof PlaceSuggestionError ? error.code : "unavailable",
            suggestions: [],
          });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [destination, locale, request]);

  const state: PlaceSuggestionsState = request === null
    ? emptyState
    : {
      target: request.target,
      status: result.key === request.key ? result.status : "idle",
      suggestions: result.key === request.key ? result.suggestions : [],
    };

  return { placeSuggestions: state, requestSuggestionsFor };
}
