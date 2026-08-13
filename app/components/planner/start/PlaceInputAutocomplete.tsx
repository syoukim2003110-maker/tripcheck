"use client";

/*
 * The start input, as a search field: typing a line offers real places and
 * choosing one pins that exact Google Place ID to the occurrence, so a
 * same-named city or shop elsewhere can never be substituted later.
 *
 * Presentation only. Caret tracking and keyboard navigation are local because
 * they are properties of this textarea, but the paid lookup belongs to
 * usePlaceSuggestions in the hooks layer; this component reports which place
 * occurrence the caret is on and renders whatever state comes back.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { PlaceSuggestion } from "../../../../lib/google-place-suggestions.ts";
import { activeWishlistPlaceAtCursor } from "../../../../lib/place-suggestion-client.ts";
import type { PlaceSuggestionsState } from "../hooks/usePlaceSuggestions";
import type { ShareableResolutionOverride } from "../../../../lib/share-link.ts";
import type { PlannerLocale } from "../../../../lib/presentation/planner-copy.ts";

type PlaceInputAutocompleteProps = {
  locale: PlannerLocale;
  value: string;
  resolutionOverrides: readonly ShareableResolutionOverride[];
  suggestions: PlaceSuggestionsState;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  describedBy?: string;
  invalid: boolean;
  label: string;
  placeholder: string;
  onChange: (value: string) => void;
  onRequestBuild: () => void;
  onActivePlaceChange: (target: { inputIndex: number; query: string } | null) => void;
  onSelectCandidate: (inputIndex: number, providerRef: string) => void;
};

export default function PlaceInputAutocomplete({
  locale,
  value,
  resolutionOverrides,
  suggestions,
  inputRef,
  describedBy,
  invalid,
  label,
  placeholder,
  onChange,
  onRequestBuild,
  onActivePlaceChange,
  onSelectCandidate,
}: PlaceInputAutocompleteProps) {
  const [panelDismissed, setPanelDismissed] = useState(false);
  const [activeProviderRef, setActiveProviderRef] = useState<string | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const target = suggestions.target;
  const panelOpen = target !== null && !panelDismissed;
  const selectedOverride = target === null ? undefined : resolutionOverrides.find((override) => (
    override.inputIndex === target.inputIndex && "providerRef" in override
  ));
  const selectedProviderRef = selectedOverride && "providerRef" in selectedOverride
    ? selectedOverride.providerRef
    : null;
  const listboxId = "planner-place-suggestions";
  const activeIndex = activeProviderRef === null
    ? -1
    : suggestions.suggestions.findIndex((suggestion) => suggestion.providerRef === activeProviderRef);

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
  }, []);

  function syncTarget(raw: string, cursor: number | null) {
    onActivePlaceChange(activeWishlistPlaceAtCursor(raw, cursor ?? raw.length));
    setActiveProviderRef(null);
    setPanelDismissed(false);
  }

  function selectCandidate(suggestion: PlaceSuggestion) {
    if (!target) return;
    onSelectCandidate(target.inputIndex, suggestion.providerRef);
    setActiveProviderRef(null);
    setPanelDismissed(true);
    inputRef.current?.focus();
  }

  function moveActive(direction: 1 | -1) {
    const options = suggestions.suggestions;
    if (options.length === 0) return;
    const currentIndex = activeProviderRef === null
      ? -1
      : options.findIndex((suggestion) => suggestion.providerRef === activeProviderRef);
    const nextIndex = currentIndex < 0
      ? direction === 1 ? 0 : options.length - 1
      : (currentIndex + direction + options.length) % options.length;
    setActiveProviderRef(options[nextIndex]?.providerRef ?? null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      onRequestBuild();
      return;
    }
    if (panelOpen && event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (panelOpen && event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (panelOpen && event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      const active = suggestions.suggestions[activeIndex];
      if (active) selectCandidate(active);
      return;
    }
    if (panelOpen && event.key === "Escape") {
      event.preventDefault();
      setPanelDismissed(true);
      setActiveProviderRef(null);
    }
  }

  const statusText = suggestions.status === "loading"
    ? locale === "ja" ? "候補を検索しています…" : "Searching for places…"
    : suggestions.status === "quota_exhausted"
      // The review step runs on a separate provider budget, so it genuinely
      // still works when this one is spent.
      ? locale === "ja" ? "この旅の候補検索上限に達しました。このまま入力を続け、次の確認画面で場所を選べます。" : "This trip's suggestion limit is used up. Keep typing — you can still pick each place on the next review screen."
      : suggestions.status === "unavailable"
        ? locale === "ja" ? "候補を取得できませんでした。入力後の確認画面で再検索できます。" : "Suggestions are unavailable. You can retry on the review screen."
        : suggestions.status === "ready" && suggestions.suggestions.length === 0
          ? locale === "ja" ? "一致する候補がありません。国または綴りを変えてください。" : "No matching places. Try a country or another spelling."
          : "";

  return (
    <div className="planner-composer">
      <label htmlFor="trip-input"><span>{label}</span></label>
      <textarea
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        aria-autocomplete="list"
        aria-controls={panelOpen ? listboxId : undefined}
        aria-describedby={describedBy}
        aria-expanded={panelOpen}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        autoFocus
        id="trip-input"
        onBlur={() => {
          blurTimer.current = setTimeout(() => setPanelDismissed(true), 120);
        }}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          onChange(raw);
          syncTarget(raw, event.currentTarget.selectionStart);
        }}
        onClick={(event) => syncTarget(event.currentTarget.value, event.currentTarget.selectionStart)}
        onFocus={(event) => syncTarget(event.currentTarget.value, event.currentTarget.selectionStart)}
        onKeyDown={handleKeyDown}
        onKeyUp={(event) => {
          if (panelOpen && ["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) return;
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
            syncTarget(event.currentTarget.value, event.currentTarget.selectionStart);
          }
        }}
        placeholder={placeholder}
        ref={inputRef}
        role="combobox"
        value={value}
      />

      {target && selectedProviderRef ? (
        <span className="planner-place-selection-confirmed">
          <span aria-hidden="true">✓</span>
          {locale === "ja" ? "この行は候補から選択済み" : "This line is fixed to a selected place"}
        </span>
      ) : null}

      {panelOpen && target ? (
        <div className="planner-place-suggestion-panel">
          <div className="planner-place-suggestion-heading">
            <span>{locale === "ja" ? `「${target.query}」の候補` : `Matches for “${target.query}”`}</span>
            <small>{locale === "ja" ? "選ぶとこの場所として固定します" : "Choose one to fix the exact place"}</small>
          </div>
          {suggestions.status === "ready" && suggestions.suggestions.length > 0 ? (
            <div aria-label={locale === "ja" ? `${target.query}の場所候補` : `Place matches for ${target.query}`} id={listboxId} role="listbox">
              {suggestions.suggestions.map((suggestion, index) => (
                <div
                  aria-selected={suggestion.providerRef === selectedProviderRef}
                  className={[
                    "planner-place-suggestion-option",
                    suggestion.providerRef === activeProviderRef ? "is-active" : "",
                    suggestion.providerRef === selectedProviderRef ? "is-selected" : "",
                  ].filter(Boolean).join(" ")}
                  id={`${listboxId}-${index}`}
                  key={suggestion.providerRef}
                  onClick={() => selectCandidate(suggestion)}
                  onMouseDown={(event) => event.preventDefault()}
                  onPointerMove={() => setActiveProviderRef(suggestion.providerRef)}
                  role="option"
                >
                  <span><b>{suggestion.primaryText}</b>{suggestion.secondaryText ? <small>{suggestion.secondaryText}</small> : null}</span>
                  {suggestion.providerRef === selectedProviderRef ? <i>{locale === "ja" ? "選択済み" : "Selected"}</i> : null}
                </div>
              ))}
            </div>
          ) : statusText ? <p className="planner-place-suggestion-status" role="status">{statusText}</p> : null}
          {suggestions.status === "ready" ? (
            // Places policy requires Google attribution whenever predictions
            // are displayed without a functioning Google map.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt="Powered by Google"
              className="planner-place-suggestion-attribution"
              height="14"
              src="https://maps.gstatic.com/mapfiles/api-3/images/powered-by-google-on-white3.png"
              width="120"
            />
          ) : null}
        </div>
      ) : null}

      <span aria-atomic="true" aria-live="polite" className="sr-only">{statusText}</span>
    </div>
  );
}
