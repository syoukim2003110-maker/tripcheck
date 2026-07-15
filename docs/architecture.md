# TripCheck Japan — target architecture

## Processing pipeline

```text
raw itinerary
  -> parser provider (structured days, times, candidate places)
  -> place resolver (owned POI + permitted runtime provider data)
  -> deterministic constraint engine
  -> optimizer with user pace and fixed reservations
  -> explanation provider
  -> result UI + shareable revision
```

The parser and explanation provider may use an LLM. The constraint engine must
remain model-independent and reproducible from stored structured inputs.

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

Google-provided content is not an owned POI record. Store identifiers where the
terms allow it, fetch volatile fields at runtime, and keep provider responses out
of the editorial database.

## Provider strategy

Runtime model vendors are interchangeable behind a narrow structured-output
interface. Start with whichever model gives the best measured parse accuracy per
cost on the itinerary fixture set; do not choose based on brand preference.

Every paid external call needs:

- a timeout and graceful fallback;
- request-level cost telemetry;
- a cache policy reviewed against the provider's current terms;
- a fixture or fake implementation for local development.

## Release sequence

- Slice 0: local interactive UX and illustrative rules.
- Slice 1: structured parser API, fixtures, deterministic engine.
- Slice 2: verified POI seed and freshness operations.
- Slice 3: live routes/place resolution and shareable result URLs.
- Slice 4: PWA, email return path, weather-window replanning.

