"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type SearchableOption = {
  /** Values must be unique within one combobox. */
  value: string;
  label: string;
  keywords?: readonly string[];
  group?: string;
};

export type SearchableComboboxProps = {
  id: string;
  ariaLabel: string;
  value: string;
  options: readonly SearchableOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  noResultsLabel?: string;
  resultCountLabel?: (count: number) => string;
};

type DraftState = {
  sourceKey: string;
  query: string;
  filtering: boolean;
};

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .trim();
}

function matchingOptions(options: readonly SearchableOption[], query: string) {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return options;

  return options.filter((option) => {
    const haystack = normalizeSearchText([
      option.label,
      option.value,
      option.group ?? "",
      ...(option.keywords ?? []),
    ].join(" "));
    return tokens.every((token) => haystack.includes(token));
  });
}

function optionSourceKey(value: string, label: string) {
  return `${value}\u0000${label}`;
}

/**
 * A controlled, restricted-value combobox. Render its visible <label> outside
 * the component and point that label's htmlFor at `id`. `ariaLabel` provides
 * an accessible name when the surrounding layout does not use a native label.
 */
function SearchableCombobox({
  id,
  ariaLabel,
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  noResultsLabel = "No results",
  resultCountLabel = (count) => `${count} result${count === 1 ? "" : "s"} available`,
}: SearchableComboboxProps) {
  const selectedOption = options.find((option) => option.value === value);
  const selectedLabel = selectedOption?.label ?? "";
  const sourceKey = optionSourceKey(value, selectedLabel);
  const [draftState, setDraftState] = useState<DraftState>(() => ({
    sourceKey,
    query: selectedLabel,
    filtering: false,
  }));
  const draft = draftState.sourceKey === sourceKey
    ? draftState
    : { sourceKey, query: selectedLabel, filtering: false };
  const [openState, setOpenState] = useState(() => ({ disabled, open: false }));
  const open = !disabled && openState.disabled === disabled && openState.open;
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const inputElement = useRef<HTMLInputElement>(null);
  const optionElements = useRef(new Map<string, HTMLDivElement>());
  const listboxId = `${id}-listbox`;

  const filteredOptions = useMemo(
    () => draft.filtering ? matchingOptions(options, draft.query) : options,
    [draft.filtering, draft.query, options],
  );
  const safeActiveValue = activeValue !== null
    && filteredOptions.some((option) => option.value === activeValue)
    ? activeValue
    : null;
  const activeOptionIndex = safeActiveValue === null
    ? -1
    : options.findIndex((option) => option.value === safeActiveValue);
  const activeDescendant = open && activeOptionIndex >= 0
    ? `${listboxId}-option-${activeOptionIndex}`
    : undefined;

  const groupedOptions = useMemo(() => {
    const groups: Array<{ name?: string; options: SearchableOption[] }> = [];
    for (const option of filteredOptions) {
      const previous = groups.at(-1);
      if (!previous || previous.name !== option.group) {
        groups.push({ name: option.group, options: [option] });
      } else {
        previous.options.push(option);
      }
    }
    return groups;
  }, [filteredOptions]);

  useEffect(() => {
    if (!open || safeActiveValue === null) return;
    optionElements.current.get(safeActiveValue)?.scrollIntoView({ block: "nearest" });
  }, [open, safeActiveValue]);

  function setOpen(nextOpen: boolean) {
    setOpenState({ disabled, open: nextOpen });
  }

  function restoreSelection() {
    setDraftState({ sourceKey, query: selectedLabel, filtering: false });
    setActiveValue(null);
    setOpen(false);
  }

  function openList(preferred: "selected" | "first" | "last" = "selected") {
    if (disabled) return;
    setOpen(true);
    const selectedIsVisible = filteredOptions.some((option) => option.value === value);
    const next = preferred === "last"
      ? filteredOptions.at(-1)
      : preferred === "selected" && selectedIsVisible
        ? selectedOption
        : filteredOptions[0];
    setActiveValue(next?.value ?? null);
  }

  function commit(option: SearchableOption) {
    const nextSourceKey = optionSourceKey(option.value, option.label);
    setDraftState({ sourceKey: nextSourceKey, query: option.label, filtering: false });
    setActiveValue(null);
    setOpen(false);
    onChange(option.value);
  }

  function moveActive(direction: 1 | -1) {
    if (filteredOptions.length === 0) {
      setActiveValue(null);
      return;
    }
    const currentIndex = safeActiveValue === null
      ? -1
      : filteredOptions.findIndex((option) => option.value === safeActiveValue);
    const nextIndex = currentIndex < 0
      ? direction === 1 ? 0 : filteredOptions.length - 1
      : (currentIndex + direction + filteredOptions.length) % filteredOptions.length;
    setActiveValue(filteredOptions[nextIndex]?.value ?? null);
  }

  function renderOption(option: SearchableOption) {
    const originalIndex = options.findIndex((candidate) => candidate.value === option.value);
    const isActive = option.value === safeActiveValue;
    const isSelected = option.value === value;
    const className = [
      "planner-combobox-option",
      isActive ? "planner-combobox-option-active" : "",
      isSelected ? "planner-combobox-option-selected" : "",
    ].filter(Boolean).join(" ");

    return (
      <div
        aria-selected={isSelected}
        className={className}
        id={`${listboxId}-option-${originalIndex}`}
        key={option.value}
        // Mouse-down would blur the input and remove the list before click.
        // Prevent that only for a mouse: touch must remain free to scroll a
        // long airport list, and click is also what AT virtual cursors fire.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => commit(option)}
        onPointerMove={() => setActiveValue(option.value)}
        ref={(element) => {
          if (element) optionElements.current.set(option.value, element);
          else optionElements.current.delete(option.value);
        }}
        role="option"
      >
        {option.label}
      </div>
    );
  }

  return (
    <div className="planner-combobox">
      <div className="planner-combobox-control">
        <input
          aria-activedescendant={activeDescendant}
          aria-autocomplete="list"
          // The listbox is only in the document while open, so pointing at it
          // when closed leaves aria-controls referencing a missing id.
          aria-controls={open ? listboxId : undefined}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={ariaLabel}
          autoComplete="off"
          className="planner-combobox-input"
          disabled={disabled}
          id={id}
          onBlur={restoreSelection}
          onChange={(event) => {
            const query = event.target.value;
            const nextOptions = matchingOptions(options, query);
            setDraftState({ sourceKey, query, filtering: true });
            setOpen(true);
            setActiveValue(nextOptions[0]?.value ?? null);
          }}
          onClick={() => {
            if (!open) openList();
          }}
          onFocus={() => {
            if (!open) openList();
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (open) moveActive(1);
              else openList("first");
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              if (open) moveActive(-1);
              else openList("last");
              return;
            }
            if (event.key === "Enter" && open && safeActiveValue !== null) {
              const activeOption = filteredOptions.find((option) => option.value === safeActiveValue);
              if (activeOption) {
                event.preventDefault();
                commit(activeOption);
              }
              return;
            }
            if (event.key === "Escape" && (open || draft.query !== selectedLabel || draft.filtering)) {
              event.preventDefault();
              restoreSelection();
              return;
            }
            if (event.key === "Tab") restoreSelection();
          }}
          placeholder={placeholder}
          ref={inputElement}
          role="combobox"
          type="text"
          value={draft.query}
        />
        <span
          aria-hidden="true"
          className="planner-combobox-indicator"
          onPointerDown={(event) => {
            event.preventDefault();
            inputElement.current?.focus();
            if (!open) openList();
          }}
        >
          ⌄
        </span>
      </div>

      {open ? (
        <div className="planner-combobox-list" id={listboxId} role="listbox">
          {groupedOptions.length > 0 ? groupedOptions.map((group, groupIndex) => {
            if (!group.name) return (
              <div className="planner-combobox-options" key={`ungrouped-${groupIndex}`} role="presentation">
                {group.options.map(renderOption)}
              </div>
            );

            const groupLabelId = `${listboxId}-group-${groupIndex}`;
            return (
              <div
                aria-labelledby={groupLabelId}
                className="planner-combobox-group"
                key={`${group.name}-${groupIndex}`}
                role="group"
              >
                <div className="planner-combobox-group-label" id={groupLabelId}>
                  {group.name}
                </div>
                {group.options.map(renderOption)}
              </div>
            );
          }) : (
            <div className="planner-combobox-empty">{noResultsLabel}</div>
          )}
        </div>
      ) : null}

      <span aria-atomic="true" aria-live="polite" className="sr-only">
        {open ? resultCountLabel(filteredOptions.length) : ""}
      </span>
    </div>
  );
}

export default SearchableCombobox;
