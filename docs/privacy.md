# TripCheck Japan — itinerary privacy contract

## Why an itinerary is sensitive

A travel plan can reveal when a home is likely to be empty, future locations,
hotel details, reservation identifiers, companions, mobility or dietary needs
and spending limits. TripCheck treats the itinerary itself as sensitive data,
not ordinary product analytics.

## Current demo boundary

The current interactive planner:

- keeps the active itinerary in React memory and performs parsing, clustering,
  schedule arithmetic and feasibility rules in the browser;
- sends unresolved place names and optional hotel/area text through a protected
  TripCheck endpoint to Google Places so coordinates can be resolved;
- does not write itinerary content to a TripCheck server database and has no
  human-review or administrator itinerary view;
- stores the selected interface language and, when available, up to ten recent
  user-authored trip/edit bundles in this browser's IndexedDB, with a
  non-persistent in-memory fallback when browser storage is unavailable;
- stores only the stable Google Place ID for an explicit ambiguity choice so
  current provider fields can be re-fetched; provider display names, addresses,
  hours, reviews, photos and routes are not persisted. Traveller-created pins
  retain only the name, address and coordinates the traveller entered;
- encodes trip inputs in the URL fragment only when the traveller explicitly
  chooses Copy share link. Anyone holding that complete link can read the trip;
- never sends the full itinerary, reservation notes or completed schedule to an
  AI provider.

Live-route enrichment begins only after a usable deterministic plan appears.
Only consecutive origin/destination coordinates, route modes and planned
departure timestamps are sent to the TripCheck route endpoint and then to
Google Maps Platform. Raw itinerary lines, place notes, hotel text and
reservation descriptions are excluded. Responses are held in page memory,
marked as Google Maps content and never persisted by TripCheck.

Nearby-food enrichment sends only one suggested area's coordinates, the
lunch/dinner category, interface language and a bounded food phrase to the
TripCheck food endpoint and then to Google Maps Platform. It excludes itinerary
text, hotel text, reservation details and the other trip stops. Returned place
names, addresses, types and Google Maps links remain in page memory and are not
persisted by TripCheck. TripCheck may send only those supplied candidate names,
public addresses, place types, meal period and area to Anthropic to write compact
comparison labels. Google evidence and deterministic code keep ownership of the
ranking; the AI cannot add a candidate or invent ratings, hours, prices or menu
facts.

Near-plan recommendations are user-triggered and non-blocking. The browser
sends sampled coordinates from the available Google route geometry (falling
back to the current day's ordered stops), interface language, destination
country and the public IDs/names of already planned places to a protected
TripCheck endpoint. Existing IDs and names are used only inside that endpoint to
remove duplicates; Google receives only those coordinates and a bounded
nearby-place query. Returned public listing fields, ratings, photos and
Google Maps links stay in page memory. The request excludes raw itinerary lines,
hotel text, dates, reservation notes and the completed schedule. A candidate is
never inserted automatically: the traveller must choose Add, after which it is
treated as an ordinary stop and the deterministic scheduler reruns.
When a selected lodging is a day's start or end base, its coordinate is part of
the route geometry; the raw hotel text is not sent.

Place evidence enrichment first sends only one resolved place name and area to
Google Maps Platform. Listing fields and attributed Google reviews are reduced
to practical signals by deterministic rules. After Google identifies the
place, only when you request recent public-source context or explicitly refresh
an eligible result may TripCheck send its resolved public name, address and
interface language to Anthropic's web-search tool. It may search indexed
public X, Instagram, local-news and firsthand-blog pages. TripCheck displays
only URLs cited by the tool, rejects provider-dated sources older than 90 days,
labels unknown dates, deduplicates results and caps one check at two searches.
Results stay in page memory; an identical public-web result may stay in server
memory for up to 30 minutes solely to prevent duplicate paid calls. No raw
itinerary, dates, hotel text, reservation details or other stops are included.

Weather is a separate, non-blocking enrichment. For eligible forecast days it
sends only the date and approximate geographic centre coordinates to
Open-Meteo. It sends no place names or itinerary text and never changes the
deterministic schedule.

The browser still requests normal site assets such as JavaScript, fonts and
sequence images. Those requests must never include itinerary content.

## Required architecture for automated Core

Prefer this order:

1. on-device parsing and deterministic checks;
2. product-owned, source-attributed POI data delivered without user content;
3. privacy-preserving server computation only when necessary;
4. an external AI provider only for the minimum redacted parsing task that
   cannot reasonably run on-device.

If itinerary content must leave the device, the product must disclose that
before submission and meet all of these requirements:

- transport encryption;
- no raw request or response body in application, edge or error logs;
- memory-only processing with a short enforced timeout;
- no database persistence by default;
- provider terms that prohibit training on submitted content and support an
  acceptable retention policy;
- redaction of emails, phone numbers, hotel booking codes, QR contents and
  unrelated personal notes before a provider call;
- deletion of transient objects after the response;
- an on-device-only fallback with reduced capability;
- automated tests proving analytics and errors cannot contain raw itinerary
  fragments.

## Identity separation

Payment and account providers must not receive itinerary content. TripCheck must
not store a direct join between payment identity and itinerary text. Anonymous
or device-local use remains the default.

## Travel Pocket and Trip Room

Private budgets, companion constraints, reservation numbers and QR codes are
more sensitive than ordinary POI names. Before these modules ship they require:

- local-device storage by default;
- encryption for any synced copy;
- per-member visibility;
- expiring and revocable share links;
- automatic deletion after the trip;
- no human support access path;
- clear export and immediate delete controls.

## Analytics allowlist

Analytics accepts only enumerated event names and non-content properties. Raw
text and arbitrary error objects are rejected. Safe examples include a coarse
input-length bucket, number of parsed days, issue category and whether a
revision was accepted.

The running P0 funnel uses eight enumerated milestones and accepts only counts,
solver duration, provider/error category, result state and alternative type.
It does not create or transmit a stable user identifier. Hosting infrastructure
may still process an IP address and ordinary request metadata; its configured
retention period is an operational release check.

IP addresses, exact dates, place names, free text, hotel data, reservation
identifiers and expense descriptions are not product analytics.

## Product copy rule

Privacy claims must match the running architecture. The current site may say
that the demo runs in the browser. It must not promise that a future AI-powered
version is on-device until that is true and verified.
