import assert from "node:assert/strict";
import test from "node:test";
import {
  prioritySequenceFrames,
  progressToSequenceFrame,
  sceneForProgress,
  sequenceCanvasScale,
  sequenceFramePath,
} from "../lib/film-sequence.ts";

test("maps the five scroll chapters to their exact boundary frames", () => {
  assert.equal(progressToSequenceFrame(0), 1);
  assert.equal(progressToSequenceFrame(0.08), 24);
  assert.equal(progressToSequenceFrame(0.32), 56);
  assert.equal(progressToSequenceFrame(0.55), 88);
  assert.equal(progressToSequenceFrame(0.85), 128);
  assert.equal(progressToSequenceFrame(1), 144);
});

test("keeps frame mapping monotonic and clamps out-of-range progress", () => {
  const samples = Array.from({ length: 101 }, (_, index) => progressToSequenceFrame(index / 100));
  samples.forEach((frame, index) => {
    if (index > 0) assert.ok(frame >= samples[index - 1]);
  });
  assert.equal(progressToSequenceFrame(-1), 1);
  assert.equal(progressToSequenceFrame(2), 144);
});

test("selects five scenes and builds zero-padded responsive asset paths", () => {
  assert.equal(sceneForProgress(0.04), 1);
  assert.equal(sceneForProgress(0.2), 2);
  assert.equal(sceneForProgress(0.4), 3);
  assert.equal(sceneForProgress(0.7), 4);
  assert.equal(sceneForProgress(0.95), 5);
  assert.equal(sequenceFramePath(9, "desktop"), "/seq/desktop/f0009.webp");
  assert.equal(sequenceFramePath(144, "mobile"), "/seq/mobile/f0144.webp");
});

test("preloads the poster plus every eighth frame", () => {
  const frames = prioritySequenceFrames();
  assert.equal(frames.length, 18);
  assert.equal(frames[0], 1);
  assert.equal(frames.at(-1), 137);
  assert.ok(frames.every((frame, index) => frame === 1 + index * 8));
});

test("caps the sequence canvas backing store without dropping below a useful scale", () => {
  assert.equal(sequenceCanvasScale(736, 807, 2), 1.5);
  assert.ok(sequenceCanvasScale(1440, 900, 2) < 1.1);
  assert.equal(sequenceCanvasScale(4000, 2200, 2), 0.75);
});
