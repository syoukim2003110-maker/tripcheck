# TripCheck 旅のしおりメーカー — repository guide

Read this before changing anything. It is the working agreement between the
two coding agents on this project and the owner. (オーナー向けの要約: 見た目は
ChatGPT/Codex、中身と本番反映は Claude。同時に同じファイルは触らない。)

## Product contract

TripCheck turns the places a traveller wants to visit into a day-by-day
booklet (しおり) that can be used as it is: which day, in what order, how to
get between them (which line, where to change), where to eat, where to stay,
and a map. It is free, needs no account, and runs as a static site.

The owner's rule, above every feature: **the foundation must be right.** The
map shows, the route is the shortest sensible one, the days are grouped
sensibly, nothing on screen is wrong. A feature on a broken foundation is
worth nothing. Do not expand into booking, social planning or native apps
unless the owner asks.

## Who does what

| Area | Owner | Files |
| --- | --- | --- |
| Look and feel: colour, type, spacing, layout, icons, motion, wording polish | **ChatGPT / Codex** | `app/shiori/shiori.css`, the markup and class names in `app/shiori/ShioriApp.tsx`, `app/shiori/ShioriMap.tsx`, `app/shiori/PlaceCard.tsx` |
| Planning logic, rail data, search, relay, tests, build, deploy and live checks | **Claude** | `lib/**`, `scripts/**`, `deploy/**`, `public/rail/**`, `tests/**`, `lib/security-headers.ts` |

The UI files hold behaviour as well as presentation (state, effects, network
calls, the order things are computed in). A design change moves markup and
styles; it does not change what a button does, what is fetched, or what a
number means. If a design needs different data or behaviour, write down what
is needed and leave it for the logic owner instead of reaching into `lib/`.

### Taking turns

- **Never edit the same files at the same time.** One agent works, commits,
  and stops; then the other starts from that commit.
- Start from the latest commit of the branch named below. Do not start from
  `main` or `claude/architecture-v2`: they are an older, different line.
- Small, focused commits with a plain-English subject that says what changed
  for the traveller. Do not rewrite history, do not force-push.
- Before handing over, run the checks under "Quality bar" and say in the
  commit or hand-over note what was looked at on screen and what was not.

Working branch: `claude/free-place-resolution`.

## Things a design change must not break

- **Honesty of estimates.** Times are estimates unless measured: the 目安
  chip, 約, ごろ and the dashed "unknown way" line on the map say so. Styling
  may make that distinction clearer, never weaker. No invented fares,
  frequencies, platforms, ratings or opening hours.
- **HotPepper Gourmet credit.** The lines
  `【画像提供：ホットペッパー グルメ】` and
  `Powered by <a href="http://webservice.recruit.co.jp/">ホットペッパーグルメ Webサービス</a>`
  must stay exactly as written (the provider forbids altering the wording or
  the HTML) and stay visible wherever its shops or photos are shown, plus the
  line in the page footer. Nothing from that service may be stored on
  TripCheck's server or in any database, and its search answers (lists,
  photos, budgets, hours) are never saved anywhere; only a shop the traveller
  adds to the trip is kept, as a stop (name, position, shop ID), in that
  traveller's own trip in their browser and in a link they share.
- **Map credit.** OpenFreeMap / OpenStreetMap attribution stays reachable.
- **Apple place card.** It is drawn by Apple inside a closed element; do not
  restyle its inside, and keep it lazy (nothing is requested until the
  traveller presses the button).
- **Content Security Policy.** `lib/security-headers.ts` lists every outside
  host the page may use and tests pin that list. Do not add fonts, scripts,
  images or analytics from a new host. Use system font stacks or files in
  `public/`.
- **Accessibility.** Keyboard reachable, visible focus, tap targets of 44 px,
  WCAG AA contrast, `prefers-reduced-motion` respected, no sideways scroll at
  375 px. The print view must remain a clean paper booklet.
- **Both languages.** Every string exists in Japanese and English in the
  `text` table of `ShioriApp.tsx`.

## Architecture boundaries

- Deterministic code owns feasibility, time arithmetic and ordering
  (`lib/shiori/plan.ts`, `lib/shiori/day-search.ts`). No model output decides
  a time, a route or an opening hour.
- Outside services sit behind the site's own relay (`deploy/xserver/api/apple.php`,
  with `scripts/apple-relay-dev.ts` as its local twin). Keys never reach the
  browser and never enter the repository.
- The one use of an AI model is the meal advisor (`deploy/xserver/api/ai.php`,
  settings and prompts in `deploy/xserver/api/ai-spec.json`). The model gets a
  validated outline of the plan and returns only search conditions and one
  sentence; it never names a shop, a price, an hour or a route, and nothing
  from HotPepper or Apple is sent to it. When it cannot answer, the page
  works as it does without it.
- Rail legs come from bundled networks (`public/rail/*.json`) generated by
  `scripts/generate-rail-networks.ts`; a line name is never invented.
- The per-sight notes (`lib/shiori/sight-notes.json`: usual stay, part of
  the day, closed or seen from outside, part of another sight) were drafted
  at development time by two independent model passes; only values both
  agree on are kept, places called closed carry a verdict with a cited
  source (fetched on the web, or from memory and marked so), and
  `scripts/build-sight-notes.ts` rebuilds the file from the drafts kept in
  `scripts/sight-notes/`. They are used as planning habits and estimates
  only, never printed as opening hours or as facts about a place.
- A place found by search is matched to an Apple place only when the name is
  the same; a card for the wrong place is worse than no card.

## Secrets and deploy

- `.env.local` and everything under `dist-static/` hold keys. They are
  git-ignored. **Never read them aloud, print them, commit them, or copy them
  into any other file.**
- The site is a static export on shared PHP hosting
  (`https://trip.hikakunoshiori.com`). `pnpm build:static -- --origin <site>`
  writes `dist-static/` and an upload zip; the owner uploads and extracts it,
  then `pnpm deploy:finish -- --from-folder <folder>` moves it into place.
  Building and deploying is Claude's job; a design agent does not need to run
  either.
- Do not put anything in the WordPress root of the host.

## Quality bar

- `node --experimental-strip-types --test tests/*.test.ts` — all pass.
- `pnpm lint` — clean. `pnpm exec tsc --noEmit` — clean.
- Look at the result on a phone-width screen and a desktop-width screen, with
  a real trip (a hotel, a restaurant, a train leg with a change), in Japanese
  and English, and at the print preview. Say what was not looked at.
- Never present a prototype estimate as a verified fact.
