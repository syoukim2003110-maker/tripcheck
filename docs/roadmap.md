# TripCheck Japan — utility-first roadmap v1.4

Last updated: 2026-07-18

## North star

TripCheck removes the work around travel. A traveller brings places they care
about; the product makes their spatial relationship, feasible order, time,
energy, shared constraints and costs understandable without taking control away.

The active roadmap optimizes for burden removed, not revenue. The product is
free by default while usefulness is being established. Pricing, affiliates and
sales targets are outside this roadmap.

## Non-negotiable promises

1. No employee, contractor or operator reads a traveller's itinerary.
2. The immediate answer does not wait for an AI model.
3. AI does not own coordinates, time arithmetic, route order, feasibility,
   prices or settlement balances.
4. A recommendation never moves a fixed reservation silently.
5. Unknown or stale data remains visibly uncertain.
6. A new capability must remove a named travel burden and work as part of the
   same trip, not become an unrelated mini-product.

## Delivery ladder

### 0. Wishlist to trip — active

Burden: “I know where I want to go, but turning the list into days, an order and
transport choices is the planning work I wanted to avoid.”

Deliver:

- browser-local recognition for a deliberately small Tokyo POI catalog;
- unordered wishlist input and a selectable one-to-fourteen-day window;
- geographic clustering that assigns nearby places to the same day;
- exact shortest open path for up to ten known stops in each day;
- fast nearest-neighbour plus local improvement above ten stops;
- planning arrival times and visible stay assumptions;
- walking, train and taxi comparisons with fastest and recommended separated;
- hotel or nearest-station input for recognised Tokyo base areas;
- daily closed-route planning from and back to the recognised hotel base;
- hotel-area ranking by the wishlist's total route distance;
- optional Haneda/Narita arrival and departure flight boundaries;
- visible airport-processing, early-arrival and city-transfer assumptions;
- open days preserved when the trip is longer than the place list;
- unresolved places retained for future resolution rather than discarded;
- user-initiated Google Maps handoff for live transit confirmation.

Continue when users can paste supported places in any order, understand why the
daily groups and route were chosen, and adopt the plan without assistance.

### 1. Time and reservation feasibility — active foundation

Burden: “The route looks fine, but I do not know whether the day actually fits.”

Deliver:

- structured local parser for days and explicit times — **active**;
- automatic checker-mode switch when day headings and times are present — **active**;
- editable stay assumptions and deterministic buffer arithmetic — **active**;
- formula-based local travel estimates with unknown fallback — **active**;
- reservation-sensitive anchor ordering — **active**;
- full fixed/flexible state and user-controlled anchor editing;
- verified queue and safety-buffer inputs;
- verified source metadata for a narrow set of high-demand attractions;
- explicit explanation of the smallest repair;
- fixtures for missed-entry, last-entry, overpacked-day and station-walk cases.
- automatic lunch/dinner protection that consumes real schedule time without
  inventing a restaurant — **active**;
- one trip brief for reservations, meal decisions and unresolved choices —
  **active**;
- transparent date-aware crowd heuristics with a visible weekend driver —
  **active**.

Current travel and stay values are planning estimates and must be labelled as
such. Do not unlock live providers until the same fixture produces the same
verdict every time without AI.

### 2. Live map and place truth

Burden: “The theoretical route ignores today's network and current venue data.”

Deliver:

- Google Maps URL as the no-key exit already available;
- a Maps adapter for route matrices and place resolution only when its live
  value exceeds local estimates;
- current travel duration and distance matrices across walking, transit and
  driving/taxi candidates, with provider attribution;
- caching and data ownership that follow provider terms;
- graceful local fallback when the provider is slow or unavailable.

The live call is not AI. It may be slower than the local result, so it enriches
rather than blocks the first answer.

### 3. Day-of recovery

Burden: “We are late, tired or facing rain; rebuilding the rest of the day is
too much work.”

Deliver:

- current position and remaining-time input only with explicit consent;
- keep/drop/replace choices that preserve reservations and must-do priorities;
- time-versus-cost comparisons for train, walking and taxi alternatives;
- weather logic only inside a credible forecast horizon;
- PWA return path and local offline copy.

### 4. Group agreement

Burden: “Everyone has different must-dos, energy, food needs and budgets, and
one person ends up negotiating everything.”

Deliver:

- member priorities and constraints attached to the same itinerary items;
- private personal limits that do not need to be disclosed to the group;
- an explanation of which compromise protects the most must-dos;
- expiring, revocable sharing with per-member visibility.

### 5. Itinerary-linked ledger

Burden: “The plan changed, costs changed, and nobody knows the final fair share.”

Deliver one continuous loop:

```text
itinerary decision
  -> expected group and per-person cost
  -> accepted change
  -> local expense prefill
  -> payer and participants confirmed
  -> individual burden and settlement update
```

The ledger does deterministic decimal arithmetic. AI may read an optional
receipt only after explicit consent; it never decides who owes what. Direct
money transfer and a standalone expense-splitting product remain out of scope.

### 6. Travel Pocket

Burden: “The information exists, but I cannot find or communicate it when I
reach the station, hotel or venue.”

Deliver local-first Japanese address cards, reservation references, QR items,
luggage instructions and cash/IC/card notes. Sensitive content requires
encryption, expiring access and automatic deletion after the trip.

## Utility gates

Every module must answer:

1. Which travel burden disappears or becomes materially smaller?
2. Can the traveller complete the task without support?
3. Is the immediate deterministic result still available if AI or a provider
   times out?
4. Is the recommendation adopted, rejected with a clear reason, or ignored?
5. Does it preserve privacy and user control?

Stop or redesign a module when it adds input work without reducing more work
later, duplicates a tool the traveller must still open, or turns uncertainty
into false confidence.

## Confirmed non-goals

- human itinerary review;
- open-ended destination discovery or AI-generated place recommendations;
- a discovery or social feed;
- product-owned chat;
- direct money transfer;
- booking marketplace;
- standalone expense splitting;
- monetization-led ranking or feature priority.
