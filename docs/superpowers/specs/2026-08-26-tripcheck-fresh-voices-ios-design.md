# TripCheck iOS — Fresh Voices (`/fresh`) on the Stop place card — Design

**Date:** 2026-08-26
**Status:** Approved for planning (standing autonomous mandate — "残り全部自動")
**Feature slice:** ⑦ — extend the shipped iOS place-intelligence feature (④) with a "fresh voices" sub-layer.

## Goal

On a Google-verified stop's `StopInspector` "この場所について" (place-intelligence) card, add an opt-in **"最新の声" (recent voices)** sub-section that fetches recent web findings about the place (social / news / blog / web) via the already-shipped, already-paid-gated `POST /api/place-intelligence/fresh` endpoint, and displays them as text-only rows. Display-only, reversible, web/Kit untouched.

## Context & why this is a GO (unlike ⑧ holidays)

`/api/place-intelligence/fresh` is registered in `lib/server/api-route-policy.ts:87` as `class:"paid", provider:"anthropic", operation:"fresh_voices", origin:"strict_same_origin"` — **the same registration shape as base place-intelligence**, which the iOS app already calls successfully through `WorkerClient`. It is reachable through the Worker's app-session gate (`appSessionIsAuthorized`); no Worker change is needed. (The origin server still 503s if `ANTHROPIC_REQUESTS_ENABLED`/`ANTHROPIC_API_KEY` are unset — a deployment-config concern that fails closed to "unavailable" on iOS, exactly like hotel/food AI ranking already do today.)

Seam map (verified, read-only): `.superpowers/sdd/2026-08-26-tripcheck-fresh-voices-ios/investigation.md`.

## Global Constraints (inherited)

- **web 不可侵**: `lib/**`, `app/api/**`, `worker/**` unchanged. `/api/place-intelligence/fresh` already exists and is paid/app-session-authorized/quota-metered server-side.
- **Kit engine 不可侵**: `apple/Packages/TripCheckKit/Sources/TripCheckKit/` (frozen engine) unchanged. New types live in `TripCheckAppCore` or the app target. `AppCopy.swift` (in TripCheckAppCore) is the only home for Japanese/English UI literals.
- **Swift 6 strict concurrency**: zero new warnings; cross-boundary types `Sendable`.
- **No emoji**; ratings/counts numeric. Text-only cards (no images — the fresh preview/image proxy is browser-only via `urlSignature`, structurally unreachable from iOS `URLSession`, same as the base card's photo decision).
- **Never `git push`** (user runs `! git push`).
- **Commit trailer (exact):**
  ```
  Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012DRrRBiU96fLJmvfThaR4J
  ```
- **Verify**: `apple/tools/verify-kit.sh` (no args) all green; `apple/tools/verify-app.sh test` all green; zero new warnings.

## Web contract (frozen — mirror exactly)

**Request** (`FreshVoicesRequest`, `lib/fresh-voices.ts:11-18`; parser `lib/fresh-voices.ts:93-111`):
```
{ name: string(1-160), area: string(1-100), languageCode: "en"|"ja",
  destination?: DestinationChoice (default "auto"),
  intent?: "place"|"food"|"hotel" (default "place"),
  depth?: "quick"|"deep" (default "deep") }
```

**Response** (`FreshVoicesResult`, `lib/fresh-voices.ts:45-53`):
```
{ provider: "anthropic_web_search", checkedAt: string(ISO),
  intent: "place"|"food"|"hotel", depth: "quick"|"deep",
  summary: string ("" when none),
  findings: FreshFinding[], searchCount: number }
```
`FreshFinding` (`lib/fresh-voices.ts:29-43`):
```
{ title: string, url: string, note: string,
  age: string|null, isRecent: boolean|null,
  sourceKind: "social"|"news"|"blog"|"web",
  evidenceLevel?: "cited_claim"|"source_only",
  urlSignature?: string|null }
```
No envelope wrapper (the object is the whole body). Errors: `{code}` with HTTP 503/400/429/502. All responses carry `Cache-Control: private, no-store`.

## Design rulings

1. **State enum — no `paused` case.** `enum StopFreshVoices: Equatable, Sendable { case loading; case loaded(FreshVoicesResult); case unavailable }`. The web's client-side "paused" status derives from `/api/ai-status` (a flag iOS does not fetch); a 503/`not_configured` simply fails closed to `.unavailable`, matching every other iOS provider. `FreshVoicesResult` (and `FreshFinding`) must be `Equatable` so `.loaded` synthesizes (same requirement place-intelligence hit in ④).

2. **Opt-in second expand — NOT auto-fire (cost discipline).** The web fires fresh automatically once base place-intelligence resolves. On mobile, base already spends 1 quota unit per card-open; auto-firing fresh would double every card-open to 2 units (`maxPerTrip:24` → only ~12 stop-opens/trip). Instead, fresh is a **nested collapsed "最新の声を見る" disclosure inside the base card's `.loaded` branch**, expand-to-fetch — a second explicit tap, `depth:"quick"` (1 unit). This mirrors the deliberate lazy-on-tap ruling from ③ food recommendations (chosen over eager to avoid unit waste). The investigation explicitly noted this "bounds cost further."

3. **Subject fields from the resolved base result.** When the base `PlaceIntelligenceResult` is `.loaded`, the fresh fetch uses `result.place.name` as `name` and `result.place.address` truncated to 100 chars as `area` (fallback to the stop's `area` if the base name/address is empty) — matching web's `checkPlace` (`usePlanBuild.tsx:1706-1747`). `intent:"place"`, `depth:"quick"`, `destination` = the planner's current destination (same value the base place-intelligence payload uses).

4. **Pipeline takes subject as args (testability).** `loadFreshVoices(stopId:name:area:)` receives `name`/`area` computed by the caller (the disclosure's `.loaded` branch has the base result in scope), so tests need only strings — mirroring ⑥'s `beginGapDetourFetch(...excluded:)` ruling. No-ops on `.loading`/`.loaded`.

5. **Text-only display.** Sub-section shows: `summary` (when non-empty) as a lead paragraph, then each `FreshFinding` as a row: `title` wrapped in `Link(destination: url)`, the `note`, a localized `sourceKind` label, and a "最近" recency badge when `isRecent == true` (or `age` present). No images, no emoji. `evidenceLevel`/`urlSignature`/`searchCount` are decoded-but-unused (documented as dropped, like prior slices drop fields).

6. **Invalidation co-located with place-intelligence.** `invalidateFreshVoices()` (bumps generation, cancels+clears all fresh tasks and the `freshVoicesByStop` dict) is called at the **same 5 sites** as `invalidatePlaceIntelligence()` — fresh shares the stop lifecycle, so a plan rebuild/edit/reset that clears base intelligence must clear fresh too. No separate invalidation site.

## Architecture (mirror ④'s 4-part shape)

**New files (TripCheckAppCore):**
- `Worker/FreshVoicesModels.swift` — `FreshVoicesRequestPayload` (Encodable: name, area, languageCode, destination, intent, depth), `FreshVoicesResult` + `FreshFinding` (Decodable, Equatable, Sendable; mirror `lib/fresh-voices.ts:29-53`, documenting dropped fields).
- `Providers/FreshVoicesProvider.swift` — `FreshVoicesProviding` protocol (`func freshVoices(_:) async -> FreshVoicesResult?`), `WorkerFreshVoicesProvider` (wraps `any WorkerAuthenticating`, `withTaskGroup` 8s timeout race, mirrors `WorkerPlaceIntelligenceProvider`), `FreshVoicesAvailability.makeDefaultProvider(uiTesting:client:)` → nil under uiTesting.
- `Store/PlannerStore+FreshVoices.swift` — `StopFreshVoices` enum, `loadFreshVoices(stopId:name:area:)`, `beginFreshVoices(stopId:name:area:)` (generation-guarded Task, `[weak self]`), `invalidateFreshVoices()`.

**Edited files:**
- `Worker/WorkerAuthState.swift` — add `freshVoices(_:)` to the `WorkerAuthenticating` protocol (after `routeRecommendations`).
- `Worker/WorkerClient.swift` — implement `freshVoices(_:)` (mirror `placeIntelligence` lines 239-274: `ensureSession`, POST `/api/place-intelligence/fresh`, session header, one-shot 401→re-auth→retry via a unique private enum, fail-closed nil on any error/decode failure).
- `Worker/CannedWorkerClient.swift` — add `freshVoices(_:) -> nil` stub.
- `Tests/TripCheckAppCoreTests/WorkerRouteProviderTests.swift` (`FakeRouteWorker`), `Tests/TripCheckAppCoreTests/WorkerPlaceResolverTests.swift` (`StubWorker`, `SlowStubWorker`) — add `freshVoices(_:) -> nil` stubs (5 conformers total; no default impls exist).
- `Store/PlannerStore.swift` — add `@ObservationIgnored let freshVoicesProvider: (any FreshVoicesProviding)?`, `freshVoicesGeneration`, `freshVoicesTasks: [String: Task<Void,Never>]`, `public internal(set) var freshVoicesByStop: [String: StopFreshVoices] = [:]`; new init param `freshVoicesProvider: (any FreshVoicesProviding)? = nil` (LAST param, after `routeDetourProvider`) + assignment.
- `App/TripCheckApp.swift` — add `freshVoicesProvider: FreshVoicesAvailability.makeDefaultProvider(uiTesting: isUITesting, client: workerClient)` to the `PlannerStore.init` call (matching declaration order — last).
- `Screens/Detail/PlaceIntelligenceDisclosure.swift` — inside the `.loaded(result)` branch, add a nested `DisclosureCard` "最新の声" sub-section: on expand, `.task { store.loadFreshVoices(stopId:name:area:) }` using `result.place.name` / `result.place.address.prefix(100)`; `.onChange(of: store.freshVoicesByStop[stopId])` re-load when it goes `nil`; render `.loading`→spinner, `.unavailable`/`.loaded` with empty summary+findings→`freshVoicesEmpty`, `.loaded`→summary + finding rows. Accessibility ids under the existing namespace: `plan.placeIntelligence.fresh`, `plan.placeIntelligence.fresh.loaded`, per-finding `plan.placeIntelligence.fresh.finding`.
- `Presentation/AppCopy.swift` — new strings (5 spots each): `freshVoicesTitle` (ja "最新の声" / en "Recent voices"), `freshVoicesExpand` (ja "最新の声を見る" / en "See recent voices"), `freshVoicesEmpty` (ja "最近の話題は見つかりませんでした" / en "No recent buzz found"), `freshSourceSocial` (ja "SNS" / en "Social"), `freshSourceNews` (ja "ニュース" / en "News"), `freshSourceBlog` (ja "ブログ" / en "Blog"), `freshSourceWeb` (ja "ウェブ" / en "Web"), `freshVoicesRecent` (ja "最近" / en "Recent").

## Data flow

Stop card open → base place-intelligence fetch (unchanged, 1 unit) → `.loaded(result)` → user taps "最新の声を見る" → `loadFreshVoices(stopId:name:area:)` sets `.loading`, builds `FreshVoicesRequestPayload{name: result.place.name, area: result.place.address.prefix(100), languageCode, destination, intent:"place", depth:"quick"}`, races the worker call (8s) → writes `.loaded(FreshVoicesResult)` / `.unavailable` into `freshVoicesByStop[stopId]` (generation-guarded) → sub-section renders findings.

## Error handling / fail-closed

provider nil → `.unavailable`; 8s timeout → nil → `.unavailable`; 401-retry failure / non-200 (incl. 503 not_configured, 429 rate_limited) / decode failure → nil → `.unavailable`. `.unavailable` and `.loaded` with empty summary+findings both render the `freshVoicesEmpty` message. Nothing crashes or spins forever (generation guard + no-op idempotence).

## Testing

- **Models**: `FreshVoicesModels` decode (full finding, null `age`/`isRecent`, missing optional `evidenceLevel`/`urlSignature`), payload encode (quick depth, intent place, destination).
- **WorkerClient**: `freshVoices` 200→decode, 401→retry, non-200→nil (mirror place-intelligence client tests).
- **Pipeline**: `loadFreshVoices` sets `.loading` then `.loaded`/`.unavailable`; idempotent no-op on `.loading`/`.loaded`; generation guard drops a stale write; `invalidateFreshVoices` clears the dict.
- **UI (best-effort, non-flaky)**: a `PlannerFlowTests` assertion that under `-uiTesting` (provider nil) the fresh sub-section, when expanded, shows the empty state — only if the base card is deterministically reachable; otherwise skip and rely on pipeline+build (same ruling as ⑥).
- Manual E2E: append a "最新の声 (fresh voices)" section to `apple/docs/paid-route-check.md`.

## Out of scope (v1.1+)

- Auto-fire on base load (kept opt-in for cost).
- `evidenceLevel` badges, `searchCount` display, image previews (urlSignature proxy).
- Fresh for non-place intents (food/hotel) — this slice is `intent:"place"` on the StopInspector place card only.
- A client `/api/ai-status` "paused" awareness layer.
