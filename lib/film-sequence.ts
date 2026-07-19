export const SEQUENCE_FRAME_COUNT = 144;
export const SEQUENCE_CANVAS_MAX_PIXELS = 1_500_000;
export const SEQUENCE_CANVAS_MAX_SCALE = 1.5;

export type SequenceVariant = "desktop" | "mobile";

export const sequenceChapters = [
  { name: "hero", progressStart: 0, progressEnd: 0.08, frameStart: 1, frameEnd: 24 },
  { name: "knot", progressStart: 0.08, progressEnd: 0.32, frameStart: 24, frameEnd: 56 },
  { name: "clock", progressStart: 0.32, progressEnd: 0.55, frameStart: 56, frameEnd: 88 },
  { name: "untangle", progressStart: 0.55, progressEnd: 0.85, frameStart: 88, frameEnd: 128 },
  { name: "offer", progressStart: 0.85, progressEnd: 1, frameStart: 128, frameEnd: 144 },
] as const;

export function clampFilmProgress(progress: number) {
  return Math.min(1, Math.max(0, progress));
}

export function sceneForProgress(progress: number) {
  const value = clampFilmProgress(progress);
  const index = sequenceChapters.findIndex((chapter, chapterIndex) => (
    value <= chapter.progressEnd || chapterIndex === sequenceChapters.length - 1
  ));
  return Math.max(1, index + 1);
}

export function progressToSequenceFrame(progress: number) {
  const value = clampFilmProgress(progress);
  const chapter = sequenceChapters.find((candidate, index) => (
    value <= candidate.progressEnd || index === sequenceChapters.length - 1
  )) ?? sequenceChapters[sequenceChapters.length - 1];
  const duration = chapter.progressEnd - chapter.progressStart;
  const localProgress = duration > 0 ? (value - chapter.progressStart) / duration : 0;
  const frame = chapter.frameStart + localProgress * (chapter.frameEnd - chapter.frameStart);
  return Math.min(SEQUENCE_FRAME_COUNT, Math.max(1, Math.round(frame)));
}

export function sequenceFramePath(frame: number, variant: SequenceVariant) {
  const safeFrame = Math.min(SEQUENCE_FRAME_COUNT, Math.max(1, Math.round(frame)));
  return `/seq/${variant}/f${String(safeFrame).padStart(4, "0")}.webp`;
}

export function prioritySequenceFrames() {
  return Array.from({ length: 18 }, (_, index) => 1 + index * 8);
}

export function sequenceCanvasScale(
  cssWidth: number,
  cssHeight: number,
  deviceScale: number,
) {
  const safeWidth = Math.max(1, cssWidth);
  const safeHeight = Math.max(1, cssHeight);
  const safeDeviceScale = Math.max(0.75, deviceScale || 1);
  const pixelLimitedScale = Math.sqrt(SEQUENCE_CANVAS_MAX_PIXELS / (safeWidth * safeHeight));

  return Math.max(
    0.75,
    Math.min(SEQUENCE_CANVAS_MAX_SCALE, safeDeviceScale, pixelLimitedScale),
  );
}
