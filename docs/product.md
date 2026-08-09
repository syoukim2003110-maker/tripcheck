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
day-by-day route and tells you whether the trip actually fits. Add a hotel and
flight times so travel days use the hours that remain; if everything does not
fit, see the minimum days and the choices that would make it work.

## Initial customer and first job

The initial user is an independent Japan traveller who has collected places in
notes, saved lists, videos or an AI answer but does not want to manually turn
them into a schedule. Tokyo remains the highest-confidence seed market. The
first job is simple: accept an unordered wishlist,
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

## v0.3 product and UX contract (August 9, 2026)

The planner is an itinerary builder first and a feasibility report second. The
default path asks only for the traveller's places, trip length and optional
date, then offers one authoritative **Build my itinerary** action. People who
want control can reveal hotel, pace, transport, airport and per-place settings
through the custom path; those controls must not burden the default path.

The first result viewport must answer five questions in this order:

1. Does the plan work?
2. What is the single most important warning, if any?
3. Which day is selected and how full is it?
4. What are the first two scheduled stops?
5. Is there one useful, safe addition that fits an actual gap?

Evidence counts, regional coverage, assumptions and counterfactuals remain
available under **Verdict details**. They are not a dashboard placed before the
itinerary. Desktop results reserve 48% for the timeline and 52% for the map.
On mobile, the map remains above the timeline at no more than 35% of the
viewport and can be collapsed; the timeline remains usable without the map.

Every place supplied by the traveller is an **Anchor**. A meal, cafe or
micro-stop proposed by TripCheck is a **Filler** and must remain visibly
different in the timeline and on the map. A Filler is never silently added. It
may be accepted only after the deterministic planner re-runs the whole day and
confirms that it creates no new hard conflict, does not defer an Anchor and
does not violate a reservation. There may be at most one lunch, one dinner and
one cafe/micro Filler per day; the UI shows one default and at most two
alternatives. Removing an accepted Filler is one action and recalculates the
plan.

Gap suggestions are bounded: gaps below 30 minutes receive no suggestion;
30–59 minutes may receive a cafe, bakery or convenience stop; 60–120 minutes
may receive a small attraction or meal; longer open periods are outside the
P0 auto-fill contract. Unknown opening hours produce a conditional proposal,
never a verified claim. Confirmed closure or a failed re-solve rejects the
candidate.

Hotel recommendations are ranked against full-trip travel, not only straight
line proximity. Changing an existing base is suggested only if it resolves a
hard conflict, saves at least 60 minutes, or reduces travel by at least 15%.
Price or value language requires an actual attributable price signal.

The map uses one stable colour per day, numbered Anchor pins and visually
distinct Filler, meal, hotel and warning pins. A selected route is 5px and an
unselected route is 2px. Timeline selection and map selection must remain
bidirectional. Missing provider geometry is left undrawn; a straight line is
never presented as a measured route. Known mountain rail destinations use an
access node and do not offer impossible direct walking, taxi or driving legs.

## Current useful vertical slice

1. Paste an unordered Tokyo wishlist and choose one to ten available days; the
   fit checker can compare alternatives through fourteen days.
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
    whole route, dinner only, or no food recommendations. Once a plan exists,
    fetch several rating-backed lunch and dinner candidates in the background
    and show them on the map without requiring an extra discovery click.
    Recommendations remain outside the fixed schedule until explicitly chosen.
21. Put fixed reservations and unresolved entries in one trip brief, then show
    food recommendations as a separate, visually connected layer beside each
    day's route.
22. When a calendar date is available, show a date-aware crowd outlook beside
    each scheduled item. The first version is an explicitly labelled planning
    heuristic with a visible weekend driver, never a live queue claim.
23. Re-run the same resolved wishlist deterministically across one to fourteen
    days, show the usable time left after airport and day-end constraints, and
    report the minimum days needed. When the current trip does not fit, offer
    review candidates while protecting must-do, booked and fixed-time places.
    If any place is unresolved or unavailable, keep the day diagnostics but
    withhold minimum-day, spare-day and removal conclusions.
24. Compare two traveller-supplied arrival or departure flight candidates by
    the time they make available in the main city, including airport processing
    and transfer assumptions. Only airports serving the same metropolitan base
    may be compared. Apply the chosen candidate to the trip without pretending
    to know price, availability, baggage rules or delays.
25. Keep food discovery, public-source checks and measured route enrichment out
    of the first-plan critical path. Food and public checks start only when the
    traveller opens or requests them; measured routes blend in after the plan.
26. Show provisional date, hotel-base and missing-flight assumptions next to the
    result, and never show Japanese-passport entry rules until the traveller has
    explicitly selected a Japanese passport.
27. Run hotel search and place-detail enrichment in parallel after wishlist
    resolution. Public-web checks, food discovery and route measurements remain
    progressive so they never become hidden prerequisites again.

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
- deterministic route-order evaluation, time arithmetic and buffer checks;
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

1. **Does the trip fit at all?** Usable first/last-day time, minimum required
   days and explicit trade-offs when the wishlist exceeds the trip.
2. **Which day, what order and how to move?** Local recognition, multi-day
   geographic grouping, route order and transport-mode comparison.
3. **Where should the trip be based?** Hotel-area comparison and hotel-aware
   daily routes.
4. **How much of the first and last day exists?** Flight, airport processing,
   city transfer and early-arrival buffers.
5. **Will the day fit?** Durations, verified hours, reservations, buffers and
   walking load.
6. **What happens in the real network?** Current Google route/place adapters,
   with cost, consent and provider terms handled explicitly.
7. **What changed today?** Delay, weather and fatigue replanning.
8. **Can everyone accept it?** Must-do priorities, accessibility, dietary needs
   and private personal limits.
9. **Who owes what?** Itinerary-linked planned and actual expenses, individual
   burden and group settlement. This is not a standalone Splitwise clone.
10. **What do I need at the stop?** Addresses, Japanese presentation cards,
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

- Japan-first; Tokyo has the deepest verified seed data. Other destinations are
  an explicitly labelled beta and must not imply the same POI coverage;
- browser-first and account-free;
- no automated booking or money transfer;
- no saved-list scraping;
- no guarantee of live transit or opening-hour accuracy until those providers
  are connected and visibly attributed;
- no human access to a traveller's itinerary.
