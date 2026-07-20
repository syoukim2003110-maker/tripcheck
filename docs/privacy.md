# TripCheck Japan — itinerary privacy contract

## Why an itinerary is sensitive

A travel plan can reveal when a home is likely to be empty, future locations,
hotel details, reservation identifiers, companions, mobility or dietary needs
and spending limits. TripCheck treats the itinerary itself as sensitive data,
not ordinary product analytics.

## Current demo boundary

The current interactive checker:

- keeps itinerary text in React memory in the browser;
- runs `analyzeTrip` in the browser;
- resolves supported POIs and optimizes their order in the browser without AI;
- does not send itinerary text to the TripCheck server;
- does not write itinerary text to local storage or a database;
- stores only the selected interface language on the device;
- has no human-review or administrator itinerary view.

The optional live-transit action is a narrow exception to the fully local
calculation path. Only consecutive origin/destination coordinates and planned
departure timestamps are sent to the TripCheck route endpoint and then to
Google Maps Platform. Raw itinerary lines, place notes, hotel text and
reservation descriptions are excluded. Responses are held in page memory,
marked as Google Maps content and never cached or persisted by TripCheck.

The optional nearby-food action is equally narrow. It sends only one suggested
area's coordinates, the lunch/dinner category, interface language and the
user-selected food phrase to the TripCheck food endpoint and then to Google
Maps Platform. It excludes itinerary text, dates, hotel text, reservation
details and the other trip stops. Returned place names, addresses, types and
Google Maps links remain in page memory and are not cached or persisted by
TripCheck.

The optional field-check action first sends only one place name and area to
Google Maps Platform. Listing fields and attributed Google reviews are reduced
to practical signals by deterministic rules. After Google identifies the
place, the same explicit action may send only its resolved public name, address
and interface language to Anthropic's web-search tool. It may search indexed
public X, Instagram, local-news and firsthand-blog pages. TripCheck displays
only URLs cited by the tool, rejects provider-dated sources older than 90 days,
labels unknown dates, deduplicates results and caps one check at two searches.
Results stay in page memory; an identical public-web result may stay in server
memory for up to 30 minutes solely to prevent duplicate paid calls. No raw
itinerary, dates, hotel text, reservation details or other stops are included.

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

IP addresses, exact dates, place names, free text, hotel data, reservation
identifiers and expense descriptions are not product analytics.

## Product copy rule

Privacy claims must match the running architecture. The current site may say
that the demo runs in the browser. It must not promise that a future AI-powered
version is on-device until that is true and verified.
