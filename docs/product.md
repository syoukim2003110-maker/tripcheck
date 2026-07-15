# TripCheck Japan — product brief

## One-line promise

Paste the Japan itinerary you made with ChatGPT, Gemini, a spreadsheet, or your
own notes. TripCheck finds what will not work, explains the trade-offs, and gives
you a realistic version.

## Initial customer

An English-speaking independent traveller who has already chosen places in
Tokyo, has a three-to-seven-day plan, and is uncertain about distance, opening
hours, reservations, walking load, or how much can fit in one day.

## Wedge

This is not another place-discovery product. The wedge is feasibility checking:
turning an attractive draft into a plan that can actually be executed.

The primary acquisition phrase is **AI itinerary reality check**. Generic AI is
an input source: users can paste its itinerary here for verification.

## P0 experience

1. The user pastes an English itinerary.
2. The product extracts days, times, and places.
3. It reports impossible jumps, overpacked days, reservation dependencies, and
   uncertain data with an explicit confidence level.
4. Each excluded or moved item has a reason and an alternative.
5. The user receives a calmer revised itinerary and retains the final choice.

The current vertical slice demonstrates this interaction with illustrative local
rules. It must say clearly that live place and transit data are not connected.

## Trust model

- Tier A: editorially verified attractions. Hard constraints are permitted.
- Tier B: volatile restaurants and shops. Use soft warnings by default.
- Tier C: unknown user inputs. Preserve them, but label them unverified.
- Weather affects replanning only inside a credible forecast horizon.
- Monetization never changes feasibility ranking. Affiliate links are disclosed
  and attached only after a recommendation is already made.

## Validation before scale

- Offer a $19 human-assisted Tokyo Itinerary Reality Check to about 20 qualified
  travellers; aim for at least five purchases with a money-back guarantee.
- Measure: paste-to-result completion, usefulness of detected conflicts,
  agreement with removals, revised-plan adoption, and willingness to refer.
- Derive the first verified POI list from submitted itineraries. Start small and
  expand until measured coverage is sufficient; do not curate the whole city.
- Distribution gate: prove that an interactive tool and public examples can
  acquire planners before investing in large-scale content SEO.

## Explicit non-goals for P0

- Kyoto or Osaka
- Native applications
- Automated booking
- Group editing
- Saved-list scraping
- A broad recommendation feed
- Guaranteed live opening-hour accuracy

