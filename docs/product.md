# TripCheck Japan — utility-first product brief

## Reason to exist

Travel should not require a person to become a route planner, timetable expert,
group negotiator and bookkeeper before they can enjoy it.

TripCheck removes the negative work around a trip:

- understanding where saved places are in relation to one another;
- deciding which places belong on the same day and in what order;
- noticing when travel, queues, reservations or fatigue make a day unrealistic;
- adapting when weather, delay or energy changes the plan;
- reconciling different priorities, budgets and shared expenses in a group.

The product is useful when it gives time, certainty or calm back to the
traveller. Revenue is not an active product requirement. The default product
may remain free; monetization can be considered only after repeated utility is
proven and must never distort a recommendation.

## One-line promise

Drop in the places you want, in any order. TripCheck turns them into a
day-by-day route that is easier to understand, execute and change. Add a hotel
and flight times so travel days use the hours that actually remain.

## Initial customer and first job

The initial user is an independent Tokyo traveller who has collected places in
notes, saved lists, videos or an AI answer but does not want to manually turn
them into a schedule. The first job is simple: accept an unordered wishlist,
group nearby places into the available days, choose an efficient visit order
and compare likely transport modes without replacing the user's choices.

An existing itinerary remains a supported secondary input. Day headings and
times switch the product into checker mode, where reservations remain anchors
and the engine looks for route and timing conflicts.

## Product principles

1. Start with a traveller's existing intent; do not turn the product into a
   discovery feed.
2. Give an immediate useful result before asking the user to wait for AI or
   live providers.
3. Use deterministic computation for facts, constraints, optimization, money
   and time arithmetic.
4. Use AI only where language ambiguity or explanation quality creates a real
   benefit.
5. Preserve fixed reservations, must-do places and user control.
6. Keep itinerary content private by default and avoid accounts until a feature
   genuinely requires identity.
7. Add a feature only when it removes a named travel burden.

## Current useful vertical slice

1. Paste an unordered Tokyo wishlist and choose one to fourteen available days.
2. Recognise a small local catalog of common Tokyo places in the browser while
   retaining unresolved entries instead of guessing their location.
3. Cluster recognised places geographically across the selected number of days.
4. Calculate a short open route for every cluster with an exact algorithm for
   up to ten stops and a fast heuristic above that limit.
5. Add editable planning start times and stay assumptions.
6. Compare formula-based walking, public-transport and taxi estimates for every
   leg, showing both the fastest mode and the recommended time/effort balance.
7. Let the traveller explicitly open each day's selected coordinates in Google
   Maps for current directions.
8. Compare common hotel areas against the entered wishlist and, when a
   recognised hotel area is supplied, optimise each day from and back to it.
9. Turn arrival and departure flights into first-day start times and last-day
   sightseeing deadlines, with visible airport and city-transfer buffers.
10. Keep the full requested trip length, including intentionally open days.
11. Detect an existing structured itinerary from day headings, keep its days
   separate and keep reservation-sensitive locations ordered as anchors.
12. Parse explicit times locally and compare the gap between entries with a
   visible stay assumption and formula-based travel estimate.
13. Mark negative buffers as conflicts, small positive buffers as tight and
   unsupported travel legs as unknown.
14. Allow a stay override in itinerary mode, such as `stay 45m` or `滞在45分`.
15. Continue to show broader feasibility warnings and a calmer revision where
    the local rules have enough evidence.
16. Accept optional per-place annotations in wishlist mode (`Day 2 10:00
    booked · must`, with Japanese, Korean and Chinese equivalents), assign the
    place to that day and calculate the route around its fixed time.
17. Mark impossible fixed times as reservation conflicts rather than silently
    moving them, and move explicitly optional places to a visible backup list
    before they break the selected pace or airport deadline.
18. Let the traveller edit each day's start time and each recognised place's
    stay duration in the result, then immediately recalculate every downstream
    arrival, reservation conflict and airport deadline without an AI call.
19. Accept the trip's first calendar date and, only on an explicit user action,
    replace estimated public-transport minutes with fresh Google Maps Routes
    results for each planned leg. Send coordinates and departure timestamps,
    never the pasted itinerary text, and keep walking/taxi visibly estimated.
20. Let the traveller choose whether TripCheck should suggest food around the
    whole route, dinner only, or no food recommendations. Recommendations remain
    outside the fixed schedule: they identify a useful area and broad time
    window without locking an exact restaurant or start time.
21. Put fixed reservations and unresolved entries in one trip brief, then show
    food recommendations as a separate, visually connected layer beside each
    day's route.
22. When a calendar date is available, show a date-aware crowd outlook beside
    each scheduled item. The first version is an explicitly labelled planning
    heuristic with a visible weekend driver, never a live queue claim.

This computation is immediate, on-device and does not use AI. Straight-line
distance and formula-based travel minutes are planning estimates, not claims
about live travel time. Venue stay values are editable product assumptions,
not official duration requirements.

## Food-recommendation vertical slice acceptance criteria

- The input asks for one low-effort preference: suggest food around the route,
  suggest dinner only, or hide food recommendations.
- Suggested food never changes a day's calculated arrival times, reservation
  feasibility or airport deadline.
- Every suggestion explains why that area fits the route and uses a flexible
  time window rather than a fixed booking time.
- A traveller-supplied restaurant with a fixed day and time remains a real
  reservation constraint; automatic recommendations remain optional.
- A user can request current nearby restaurant candidates from Google Places.
  Only the recommendation area's coordinates, meal type, language and search
  intent leave the browser; itinerary prose is not sent.
- Candidate cards show Google Maps attribution and provide separate outbound
  checks for Tabelog and social search. TripCheck does not scrape, copy or imply
  live ranking signals from Tabelog or social networks.
- If Places is unavailable, the product keeps useful Google Maps, Tabelog and
  social search exits instead of inventing restaurant names.
- The trip brief centralises protected reservations and unresolved entries;
  food remains a clearly separate recommendation layer.
- Crowd outlooks are calculated only when a trip date exists, identify weekend
  uplift as a driver and are labelled as planning estimates with low or medium
  confidence.
- The route and recommendation-area logic work without an account or AI call;
  live restaurant names gracefully fall back when the provider is unavailable.

## AI and non-AI boundary

### Never needs AI

- coordinate distance and area clustering;
- shortest-order calculation, time arithmetic and buffer checks;
- opening-hour conflicts after verified hours are supplied;
- reservation and last-entry constraints;
- walking-load totals and pace thresholds;
- expected-versus-actual totals, split calculations and settlement balances;
- confidence derived from source freshness and rule coverage.

### May use AI, with a deterministic fallback

- turning messy prose, screenshots or mixed-language notes into structured
  itinerary items;
- identifying which phrases are preferences rather than fixed constraints;
- explaining a detected conflict in plain language;
- summarising the smallest set of changes after the engine has selected them.

AI never invents coordinates, opening hours, transit times, prices or a
feasibility verdict. The deterministic result remains usable if AI is slow or
unavailable.

## Product sequence by burden removed

1. **Which day, what order and how to move?** Local recognition, multi-day
   geographic grouping, route order and transport-mode comparison.
2. **Where should the trip be based?** Hotel-area comparison and hotel-aware
   daily routes.
3. **How much of the first and last day exists?** Flight, airport processing,
   city transfer and early-arrival buffers.
4. **Will the day fit?** Durations, verified hours, reservations, buffers and
   walking load.
5. **What happens in the real network?** Current Google route/place adapters,
   with cost, consent and provider terms handled explicitly.
6. **What changed today?** Delay, weather and fatigue replanning.
7. **Can everyone accept it?** Must-do priorities, accessibility, dietary needs
   and private personal limits.
8. **Who owes what?** Itinerary-linked planned and actual expenses, individual
   burden and group settlement. This is not a standalone Splitwise clone.
9. **What do I need at the stop?** Addresses, Japanese presentation cards,
   reservation details, luggage and payment notes stored locally by default.

## Success evidence

- a result appears quickly enough that pasting feels easier than manual map
  work;
- users adopt the reordered route or explicitly keep their original order;
- avoidable cross-city jumps and missed reservations decrease;
- users return on the day of travel when the plan changes;
- group travellers complete settlement without a second bookkeeping tool;
- explicit satisfaction reports that TripCheck reduced planning effort.

Traffic, email capture and payment are not evidence that the travel burden was
removed.

## Current boundaries

- Tokyo only;
- browser-first and account-free;
- no automated booking or money transfer;
- no saved-list scraping;
- no guarantee of live transit or opening-hour accuracy until those providers
  are connected and visibly attributed;
- no human access to a traveller's itinerary.
