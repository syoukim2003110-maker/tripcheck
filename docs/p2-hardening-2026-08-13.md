# P2-01 / P2-02 / P2-03 — the last three findings from the 298646d review

Branch `claude/architecture-v2`, commits `a2a5ee9` and `518149b`, on top of the
Gate E pass in `fad407f`.

These were the three the review scoped after the blockers: a wide CSP, a DNS
rebind window in the link preview, and 22.5% of the TypeScript concentrated in
seven files. All three are closed. The record below is what was measured, what
was changed, and — for two of them — what deliberately was not.

## P2-01 — the CSP allowed every host on the internet

`img-src 'self' data: blob: https:` and `connect-src 'self' https: wss:`.
Anything that got script onto the page could post an itinerary anywhere, and
if fetch were blocked it could still leak it a query string at a time through
`new Image().src`.

Measured first: **every request the browser makes is a same-origin `/api/`
route** — fifteen of them, plus one `sendBeacon`. The only third party it
contacts is the Google Maps runtime. So both directives became Google-only
allowlists, and `wss:` went entirely: there are no websockets in production,
and the local HMR socket that allowance existed for never sees this policy,
because CSP is skipped on localhost.

`img-src` could not close while one `<img>` still pointed at an arbitrary
host — see P2-02 for the thumbnail that did. The Places attribution badge and
the photo route's redirect target are why `*.gstatic.com` and
`*.googleusercontent.com` stay: CSP re-checks the host after a redirect.

**`script-src` is unchanged, and says why in place.** `'unsafe-inline'` is not
removable while the framework emits its RSC bootstrap as inline `<script>`
with no nonce — 14 of them per page, counted on the rendered output — and a
nonce beside `'unsafe-inline'` would make browsers ignore the latter, not the
former. `'unsafe-eval'` belongs to the Maps runtime; narrowing it to
`'wasm-unsafe-eval'` is the obvious next step and is deliberately not taken
here, because the QA harness blocks external hosts and therefore cannot load
Maps to prove it. Guessing wrong breaks the map for everyone. That one needs
report-only collection from production first.

`tests/content-security-policy.test.ts` fails on any bare-scheme source in any
directive, requires every remote host named anywhere in the policy to be a
Google host, and greps the five components that render images to check none of
them has reintroduced a raw remote `src`.

## P2-02 — the preview fetched whatever it was pointed at

Two problems, one of which the review named.

**The window it named.** `assertPublicNetworkTarget` resolves the hostname over
DoH, checks every answer is public, and then `fetch` resolves the hostname
*again*. A short-TTL record can change in between.

That window cannot be closed on Workers. `fetch` gives no way to pin the
connect address, and connecting to a literal IP breaks SNI, so the certificate
never matches. The review's own proposal offers the alternative — an allowlist
of domains — but the URLs come from Anthropic web search results, so an
allowlist would be the whole internet or nothing.

**The problem underneath it.** `POST /api/link-preview` accepted *any* public
https URL from any same-origin caller. The DNS check was the only thing
standing between a hostile client and a general-purpose "fetch this from the
edge for me" service. The window was the second-order problem; the aim was the
first.

So the aim is taken away. The server signs every finding URL it hands the
browser (`lib/server/external-url-token.ts`, HMAC-SHA256 with a version prefix
so a Places Photo signature cannot be replayed here or the reverse), and both
fetching routes serve nothing else. Rebinding still requires winning a race,
but now only against a host TripCheck's own web search already surfaced.

The window itself is narrowed rather than claimed closed: the address is
re-checked **after** the response and **before** the body is read, so a body
fetched from a private address is not handed back. A rebind now has to flip
the record to a private address and back inside that window, with neither
check ever seeing the private answer.

Only a URL that already passes `parsePublicHttpsUrl` can be signed at all, so
the credential and the policy cannot drift apart.

## The thumbnail, which both findings needed

`<img src={preview.imageUrl}>` pointed straight at whatever host the og:image
named. That told a third party — one the traveller never chose — that this
person was reading about this place, complete with an IP and a timestamp.
`referrerPolicy="no-referrer"` was already there, which suggests someone saw
half of it.

It is proxied now: `GET /api/link-image`, signed the same way, `redirect:
"error"`, an image content-type allowlist, and a 2MB cap checked against the
real bytes rather than the sender's `Content-Length`. That is what let
`img-src` close, and it removes a third-party beacon from a product whose
privacy contract says itinerary content stays private.

The privacy page says so in the traveller's words, next to the paragraph about
Places photos.

## P2-03 — 53 state slices in one 2,300-line component

The review's concern was not the line count but what it implies: nothing
separated "which panel is open" from "how many days the trip is", so a P2
motion or spacing change sat a few lines away from a scheduling input.

Three groups, by who reads them:

| Hook | Slices | What it holds |
| --- | ---: | --- |
| `useTripRequestState` | 22 | The request the engine plans from |
| `usePlanEditState` | 12 | The traveller's edits it replans from |
| `usePlannerViewState` | 19 | Which screen, which day, which panel, which dialog |

The shell now declares **no `useState` at all**. Every name is unchanged: the
shell destructures each group back into the same identifiers, so not one call
site moved. That is deliberate — it is what made a change this wide verifiable
by VR alone.

**Not a reducer.** The spec proposes one; it also forbids a bulk rewrite, and
those pull in opposite directions here. A reducer moves the same 53 fields
behind a switch and rewrites every one of several hundred call sites to
dispatch. Naming the groups is what buys the boundary; the reducer would buy
`dispatch` stability, which matters mainly to the linter (see the cost below).

### What holds it

`tests/planner-state-boundary.test.ts`:

- the shell declares no state of its own;
- the three groups are disjoint and sum to 53, with the counts pinned, so
  moving a field between groups is a reviewed change;
- every declared slice is actually read by the shell;
- **no view field reaches `useStablePlannerContext` or `useTripDomainModel`.**

Three view fields do reach them, and the test names why each is a gate rather
than a parameter: `activeDay` decides which day's recommendations are fetched,
`hasPlan` whether a plan is computed at all, `planReady` whether a share code
is encoded. A separate assertion checks none of them is an argument to
`buildTripFromWishlist`, `assessTripFit` or `evaluateTripFeasibility`.

And the view hook may not import from the scheduler's modules, because a view
slice typed by the scheduler is a slice the scheduler ends up reading.

### What it cost

Two things, both measured, neither hidden.

**Five lint errors went quiet.** `react-hooks/set-state-in-effect` reported
five effects in this file; it cannot see through a custom hook's return, so it
reports none now. The effects are unchanged and were already in the accepted
lint baseline. Because the linter no longer writes them down, the file does:
a comment names all five sites. Repo totals went from 12 errors / 3 warnings
to 7 / 3.

**Sixty dependencies had to be named by hand.** The same blindness made
`exhaustive-deps` ask for 14 setters it previously knew were stable. They are
named rather than suppressed, so the rule keeps checking everything else in
those hooks. One is left out with a comment: `setPendingSharedBuild` comes
from a hook that runs further down the component, so naming it in a dependency
array reads it in the temporal dead zone.

`StartFlow` / `ResultWorkspace` / `InspectorLayer` were measured and **not**
extracted. Each region is already almost entirely prop-plumbing into
components that exist: the inspector region is 118 lines passing 64 distinct
identifiers, and the start region is 190 lines of props for `PlacesStep` and
`ResolveScreen`. Wrapping either would write the same prop list twice and add
a file. That extraction becomes worth doing once the groups above can be
passed as bundles, which is a change to those components' interfaces and
belongs with the work that needs it.

## Verification

| Check | Result |
| --- | --- |
| `tsc --noEmit` | 0 |
| `vinext build` | 0 |
| unit `.mjs` | 11/11 |
| unit `.ts` | 676/676 (was 655; +21, none removed) |
| golden feasibility | 500 scenarios, deterministic |
| E2E | 53/53 |
| VR | 24/24, **byte-identical** — no baseline moved |
| axe WCAG 2.2 AA | clean |
| eslint | 7 errors / 3 warnings, from 12 / 3 |

The VR result is the load-bearing one for P2-03: a refactor that touched every
state declaration in the largest component in the app changed nothing a
traveller can see.

## Known limitations

- **`script-src` is unchanged.** Both allowances are Maps' or the framework's,
  and neither can be tested here. `'wasm-unsafe-eval'` needs report-only data
  from production.
- **The rebind window is narrowed, not closed.** It cannot be closed on
  Workers. What changed is who can aim at it.
- **The image proxy spends this deployment's bandwidth**, capped at 2MB per
  thumbnail and cached privately for 15 minutes. Three thumbnails per source
  list, only when the list is opened.
- **`react-hooks` sees less of the shell than it did.** A reducer would give
  the rules a stable `dispatch` to reason about; that is the argument for the
  spec's version of P2-03, and it is a separate, larger change.
