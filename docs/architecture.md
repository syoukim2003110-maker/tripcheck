# TripCheck Japan — target architecture

## Three latency layers

The user sees progressively richer truth rather than one opaque loading state.

| Layer | Target | Owns | AI? |
| --- | --- | --- | --- |
| Immediate local | perceptually instant | structured-line parsing, coordinates, clustering, shortest order, time and money arithmetic, cached verified constraints | No |
| Live provider | enrich after the local answer | current route duration, place resolution, volatile hours, weather | No |
| Language intelligence | optional and cancellable | messy prose normalization and plain-language explanation | Sometimes |

The immediate result remains usable when the two slower layers fail.

Traveller timing edits are immediate-local inputs. Per-day start times and
per-place duration overrides feed back into the same deterministic calculation;
they do not create a second editable copy of the itinerary. Arrival readiness,
booked times and departure deadlines remain hard bounds around those edits.

The current planner uses explicit, replaceable formulas for walking, public
transport and taxi time. It shows the fastest option and a separate recommended
option: short walks are preferred, then public transport unless taxi saves a
substantial amount of time. None of these outputs are labelled as live routing.
Unknown places remain unresolved instead of receiving invented coordinates.

Hotel input currently resolves to a small set of Tokyo base areas. A recognised
base changes the objective from an open path to a daily closed route that
starts and ends at that base. Recommendations minimise the sum of those daily
geographic paths; they do not use hotel price, quality, availability or
commission.

Flight inputs are deterministic schedule boundaries. International departure
currently reserves 180 minutes at Haneda, following Haneda Airport's guidance
that arriving three hours early is best, and 120 minutes at Narita, following
Narita Airport's at-least-two-hours guidance. Arrival processing (90 minutes
international / 45 domestic), domestic departure (90 minutes), and city
transfers (60 minutes Haneda / 105 Narita) are visibly labelled product
planning assumptions until live providers or user overrides are connected.
Sources: [Haneda Airport international departure guidance](https://www.tokyo-haneda.com/en/flight/detail/int_departure.html)
and [Narita Airport international departure guidance](https://www.narita-airport.jp/en/airportguide/inter-dep/).

## Processing pipeline

```text
raw wishlist or itinerary
  -> local mode detector (unordered wishlist vs timed itinerary)
  -> local parser (structured lines, known places, priority and booked time)
  -> optional redacted parser provider (only unresolved text)
  -> place resolver (owned POI + permitted runtime provider data)
  -> geographic day clustering when input is a wishlist
  -> optional hotel-base resolution and closed-route optimization
  -> optional arrival/departure flight boundary calculation
  -> deterministic constraint engine
  -> deterministic optimizer with user days, pace and fixed reservations
  -> transport-mode comparison
  -> local explanation templates or optional explanation provider
  -> result UI + shareable revision
```

The parser and explanation provider may use an LLM. Coordinates, route order,
time arithmetic, cost arithmetic, confidence and feasibility remain
model-independent and reproducible from structured inputs.

## Planned modules

```text
app/                 routes and UI
domain/              itinerary, POI, constraint, and result types
engine/              time arithmetic, conflicts, scoring, optimization
providers/ai/        Anthropic/OpenAI-compatible parser adapters
providers/maps/      routing and place adapters
data/                product-owned, source-attributed POI records
tests/                parser fixtures and constraint-engine cases
```

## Data record minimum

```ts
type OwnedPoi = {
  id: string;
  name: string;
  area: string;
  coordinates: { lat: number; lng: number };
  typicalDurationMinutes: number | null;
  constraints: Array<{
    type: string;
    value: unknown;
    sourceUrl: string;
    verifiedAt: string;
    confidence: "high" | "medium" | "low";
  }>;
};
```

## Canonical itinerary item

Future group, day-of, expense and pocket modules must extend one itinerary item
rather than create parallel trip records. The target shape is deliberately
optional so unvalidated modules do not leak into the current product:

```ts
type ItineraryItem = {
  id: string;
  place: { name: string; ownedPoiId?: string; providerPlaceId?: string };
  window: { startsAt?: string; endsAt?: string; durationMinutes?: number };
  flexibility: "fixed" | "flexible" | "unknown";
  participants?: string[];
  memberPriority?: Record<string, "must" | "prefer" | "neutral" | "avoid">;
  reservation?: { status: string; ownerId?: string };
  expectedCost?: { amount: number; currency: string };
  actualExpenseIds?: string[];
  state?: "planned" | "completed" | "cancelled" | "changed";
  changeReason?: string;
};
```

Sensitive group budgets, reservation numbers and QR content require an access,
retention and AI-processing policy before their fields are persisted.

## Privacy boundary

The browser is the default trust boundary. The current itinerary value must not
be logged, persisted or sent to an API. Future parsing providers receive only
the minimum redacted input after the gate in `docs/privacy.md` passes. Analytics
uses an explicit property allowlist and rejects arbitrary text and raw error
objects.

Payment identity, if added later, must remain structurally separate from
itinerary content. No administrator or support interface may expose a user's
raw itinerary.

Google-provided content is not an owned POI record. Store identifiers where the
terms allow it, fetch volatile fields at runtime, and keep provider responses out
of the editorial database.

## Provider strategy

Runtime model vendors are interchangeable behind a narrow structured-output
interface. Start with whichever model gives the best measured parse accuracy per
cost on the itinerary fixture set; do not choose based on brand preference.

Google Maps is the navigation and live-routing exit, not TripCheck's reasoning
engine. The no-key first step is a user-initiated Maps URL containing only the
selected stop coordinates. A paid Routes or Places integration is introduced
behind an adapter only when live results materially improve the decision.

Every paid external call needs:

- a timeout and graceful fallback;
- request-level cost telemetry;
- a cache policy reviewed against the provider's current terms;
- a fixture or fake implementation for local development.

The first live provider adapter is Google Routes for scheduled public transit.
It uses one `ComputeRoutes` request per displayed stop-to-stop leg rather than a
Cartesian route matrix, requests only duration and distance fields, sets an
eight-second timeout and never caches the response. The browser sends only
coordinates and planned departure timestamps to the same-origin endpoint. The
private API key remains server-side. Google Cloud daily quota is the required
cost circuit breaker before publishing this feature.

As of July 18, 2026, Google documents a 100-day future window for transit
departure times, a 10,000 monthly free-usage cap for Compute Routes Essentials,
and $5 per 1,000 requests in the first paid tier. A typical eight-stop trip has
seven stop-to-stop transit requests, so cost telemetry and a low daily quota
must be enabled before broad traffic. Verify these values again before launch.

## Release sequence

- Slice 0: local wishlist UX, Tokyo coordinate catalog, multi-day geographic
  clustering, deterministic stop order, planning-mode comparison, hotel-area
  ranking and airport-boundary calculation — active.
- Slice 1: structured local time parser, reservation-sensitive anchors,
  user-controlled must/optional priority and deterministic checker mode with
  fixtures — active.
- Slice 2: verified POI seed and freshness operations.
- Slice 3: opt-in live public-transit routes with privacy, attribution and
  no-cache boundaries — implemented behind a server-side service key; place
  resolution and shareable result URLs remain next.
- Slice 4: PWA return path and weather-window replanning.
- Slice 5: group constraints, then itinerary-linked settlement after its privacy
  model is proven.
