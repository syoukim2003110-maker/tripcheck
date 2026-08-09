import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { parseWishlist, type ParsedWishlistPlace } from "../lib/wishlist-parser.ts";
import {
  SYNTHETIC_CORPUS_NOTICE,
  generateSyntheticWishlistParserCorpus,
  type ExpectedSyntheticPlace,
} from "./helpers/generate-wishlist-parser-corpus.ts";

const CORPUS_SIZE = 500;

function normalizedName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function multiset(values: readonly string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function overlapCount(expected: readonly string[], actual: readonly string[]) {
  const expectedCounts = multiset(expected);
  const actualCounts = multiset(actual);
  let truePositive = 0;
  for (const [value, count] of expectedCounts) truePositive += Math.min(count, actualCounts.get(value) ?? 0);
  return {
    truePositive,
    falsePositive: actual.length - truePositive,
    falseNegative: expected.length - truePositive,
  };
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? 1 : numerator / denominator;
}

function markerChecks(expected: ExpectedSyntheticPlace, actual: ParsedWishlistPlace | undefined) {
  const checks: boolean[] = [];
  if (expected.priority !== undefined) checks.push(actual?.priority === expected.priority);
  if (expected.isReservation !== undefined) checks.push(actual?.isReservation === expected.isReservation);
  if (expected.time !== undefined) checks.push(actual?.time === expected.time);
  if (expected.stayMinutes !== undefined) checks.push(actual?.stayMinutes === expected.stayMinutes);
  return checks;
}

test("500-case synthetic corpus meets INP-001/002/003 regression thresholds", (context) => {
  const corpus = generateSyntheticWishlistParserCorpus(CORPUS_SIZE);
  assert.equal(corpus.length, CORPUS_SIZE);
  assert.equal(new Set(corpus.map((entry) => entry.id)).size, CORPUS_SIZE);
  assert.deepEqual(generateSyntheticWishlistParserCorpus(CORPUS_SIZE), corpus, "corpus generation must be deterministic");

  let candidateTruePositive = 0;
  let candidateFalsePositive = 0;
  let candidateFalseNegative = 0;
  let markerCorrect = 0;
  let markerTotal = 0;
  let headingCorrect = 0;
  let headingTotal = 0;
  let dayCorrect = 0;
  let dayTotal = 0;

  for (const fixture of corpus) {
    const parsed = parseWishlist(fixture.input);
    const actualPlaces = parsed.flatMap((line) => line.kind === "place" ? line.places : []);
    const expectedNames = fixture.expectedPlaces.map((place) => normalizedName(place.name));
    const actualNames = actualPlaces.map((place) => normalizedName(place.name));
    const candidateCounts = overlapCount(expectedNames, actualNames);
    candidateTruePositive += candidateCounts.truePositive;
    candidateFalsePositive += candidateCounts.falsePositive;
    candidateFalseNegative += candidateCounts.falseNegative;

    const actualByName = new Map(actualPlaces.map((place) => [normalizedName(place.name), place]));
    for (const expectedPlace of fixture.expectedPlaces) {
      const actual = actualByName.get(normalizedName(expectedPlace.name));
      for (const correct of markerChecks(expectedPlace, actual)) {
        markerTotal += 1;
        if (correct) markerCorrect += 1;
      }
      if (expectedPlace.day !== undefined) {
        dayTotal += 1;
        if (actual?.day === expectedPlace.day) dayCorrect += 1;
      }
    }

    const actualHeadings = parsed.filter((line) => line.kind === "heading").map((line) => line.day);
    const headingCounts = overlapCount(fixture.expectedHeadings.map(String), actualHeadings.map(String));
    headingCorrect += headingCounts.truePositive;
    headingTotal += fixture.expectedHeadings.length;
    assert.equal(headingCounts.falsePositive, 0, `${fixture.id} created an unexpected heading`);
  }

  const precision = ratio(candidateTruePositive, candidateTruePositive + candidateFalsePositive);
  const recall = ratio(candidateTruePositive, candidateTruePositive + candidateFalseNegative);
  const f1 = ratio(2 * precision * recall, precision + recall);
  const explicitMarkerRecall = ratio(markerCorrect, markerTotal);
  const headingRecall = ratio(headingCorrect, headingTotal);
  const dayAssignmentRecall = ratio(dayCorrect, dayTotal);

  context.diagnostic(SYNTHETIC_CORPUS_NOTICE);
  context.diagnostic(`candidate split precision=${precision.toFixed(4)} recall=${recall.toFixed(4)} F1=${f1.toFixed(4)} (TP=${candidateTruePositive}, FP=${candidateFalsePositive}, FN=${candidateFalseNegative})`);
  context.diagnostic(`explicit marker recall=${explicitMarkerRecall.toFixed(4)} (${markerCorrect}/${markerTotal})`);
  context.diagnostic(`heading recall=${headingRecall.toFixed(4)} (${headingCorrect}/${headingTotal}); inherited/inline day recall=${dayAssignmentRecall.toFixed(4)} (${dayCorrect}/${dayTotal})`);

  assert.ok(f1 >= 0.97, `synthetic candidate-splitting F1 ${f1.toFixed(4)} is below 0.97`);
  assert.ok(recall >= 0.99, `synthetic candidate-splitting recall ${recall.toFixed(4)} is below 0.99`);
  assert.ok(explicitMarkerRecall >= 0.99, `synthetic explicit-marker recall ${explicitMarkerRecall.toFixed(4)} is below 0.99`);
  assert.ok(headingRecall >= 0.99, `synthetic heading recall ${headingRecall.toFixed(4)} is below 0.99`);
  assert.ok(dayAssignmentRecall >= 0.99, `synthetic day-assignment recall ${dayAssignmentRecall.toFixed(4)} is below 0.99`);
});

test("synthetic per-case parser latency p95 remains below 200ms", (context) => {
  const corpus = generateSyntheticWishlistParserCorpus(CORPUS_SIZE);

  // Deterministic warmup keeps one-time JIT/module work out of the per-case
  // regression number. The 200ms gate is intentionally generous for CI hosts.
  for (let pass = 0; pass < 4; pass += 1) {
    for (const fixture of corpus) parseWishlist(fixture.input);
  }

  const milliseconds = corpus.map((fixture) => {
    const start = performance.now();
    parseWishlist(fixture.input);
    return performance.now() - start;
  }).sort((left, right) => left - right);
  const p95 = milliseconds[Math.ceil(milliseconds.length * 0.95) - 1] ?? Number.POSITIVE_INFINITY;

  context.diagnostic(SYNTHETIC_CORPUS_NOTICE);
  context.diagnostic(`parseWishlist per-case latency p95=${p95.toFixed(3)}ms across ${CORPUS_SIZE} cases after 4 deterministic warmup passes`);
  assert.ok(p95 < 200, `synthetic parser latency p95 ${p95.toFixed(3)}ms is not below 200ms`);
});
