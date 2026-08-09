import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecommendation,
  createSystemFiller,
  createUserAnchor,
  isAnchorItem,
  isFillerItem,
} from "../lib/itinerary-domain.ts";

test("every traveller place is an Anchor independently of priority", () => {
  const optional = createUserAnchor({
    id: "user-1",
    placeId: "google-place-1",
    title: "Optional museum",
    dayIndex: 0,
    startAt: "10:00",
    endAt: "11:00",
    durationMinutes: 60,
    priority: "OPTIONAL",
    confidence: "VERIFIED",
  });
  assert.equal(optional.kind, "ANCHOR");
  assert.equal(optional.source, "USER");
  assert.equal(optional.priority, "OPTIONAL");
  assert.equal(isAnchorItem(optional), true);
  assert.equal(Object.isFrozen(optional), true);
});

test("a system Filler has a separate kind and cannot masquerade as user input", () => {
  const filler = createSystemFiller({
    id: "filler-lunch-1",
    recommendationId: "rec-lunch-1",
    placeId: "provider-ref-1",
    title: "Lunch candidate",
    dayIndex: 0,
    startAt: "12:00",
    endAt: "13:00",
    durationMinutes: 60,
    fillerKind: "LUNCH",
    priority: "PREFER",
    confidence: "UNKNOWN",
  });
  assert.equal(filler.kind, "FILLER");
  assert.equal(filler.source, "SYSTEM_RECOMMENDATION");
  assert.equal(filler.fillerKind, "LUNCH");
  assert.equal(isFillerItem(filler), true);
});

test("recommendations retain bounded score components, statuses and at most three reasons", () => {
  const recommendation = createRecommendation({
    id: "rec-1",
    type: "MEAL",
    fillerKind: "DINNER",
    slotId: "day-1-dinner",
    placeId: "provider-ref-1",
    proposedDayIndex: 0,
    proposedStartAt: "19:00",
    addedTravelMinutes: 4.4,
    score: {
      total: 106,
      detour: 91.123,
      timeFit: 80,
      qualityConfidence: 70,
      preferenceFit: -3,
      priceFit: 55,
    },
    reasons: ["+4 min", "Open then", "+4 min", "Strong reviews", "Hidden fourth"],
    evidenceIds: ["hours:1", "route:1", "hours:1"],
  });

  assert.equal(recommendation.status, "PROPOSED");
  assert.equal(recommendation.addedTravelMinutes, 4);
  assert.equal(recommendation.score.total, 100);
  assert.equal(recommendation.score.detour, 91.12);
  assert.equal(recommendation.score.preferenceFit, 0);
  assert.deepEqual(recommendation.reasons, ["+4 min", "Open then", "Strong reviews"]);
  assert.deepEqual(recommendation.evidenceIds, ["hours:1", "route:1"]);
});

