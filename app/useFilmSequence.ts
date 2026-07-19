"use client";

import { useEffect, useRef, type RefObject } from "react";
import {
  SEQUENCE_FRAME_COUNT,
  prioritySequenceFrames,
  progressToSequenceFrame,
  sequenceCanvasScale,
  sequenceFramePath,
  type SequenceVariant,
} from "../lib/film-sequence";

export type FilmSequenceController = {
  setProgress: (progress: number) => void;
};

type UseFilmSequenceOptions = {
  enabled: boolean;
  rootRef: RefObject<HTMLElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
};

const MAX_DECODED_FRAMES = 24;
const IDLE_BATCH_SIZE = 8;
const PRIORITY_FRAMES = prioritySequenceFrames();
const PRIORITY_FRAME_SET = new Set(PRIORITY_FRAMES);

function canvasSourceSize(source: CanvasImageSource) {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  const bitmap = source as ImageBitmap;
  return { width: bitmap.width, height: bitmap.height };
}

function releaseSource(source: CanvasImageSource) {
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) source.close();
}

async function decodeBlob(blob: Blob): Promise<CanvasImageSource> {
  if ("createImageBitmap" in window) return window.createImageBitmap(blob);

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to decode sequence frame"));
    };
    image.src = url;
  });
}

export function useFilmSequence({ enabled, rootRef, canvasRef }: UseFilmSequenceOptions) {
  const controllerRef = useRef<FilmSequenceController | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: false, desynchronized: true });
    if (!root || !canvas || !context) return;

    const media = window.matchMedia("(max-width: 719px)");
    let variant: SequenceVariant = media.matches ? "mobile" : "desktop";
    let generation = 0;
    let disposed = false;
    let requestedFrame = 1;
    let lastRequestedFrame = 1;
    let lastDrawnFrame = 0;
    let lastDirection = 1;
    let canvasNeedsRedraw = true;
    let decodeQueueRunning = false;
    let resizeFrame = 0;
    let fillIdleHandle = 0;
    let warmIdleHandle = 0;
    const bitmaps = new Map<number, CanvasImageSource>();
    const blobs = new Map<number, Blob>();
    const pendingBlobs = new Map<number, Promise<Blob>>();
    const pendingBitmaps = new Map<number, Promise<CanvasImageSource>>();

    const clearCaches = () => {
      bitmaps.forEach(releaseSource);
      bitmaps.clear();
      blobs.clear();
      pendingBlobs.clear();
      pendingBitmaps.clear();
      lastDrawnFrame = 0;
      canvasNeedsRedraw = true;
      root.dataset.sequenceLoaded = "0";
      root.dataset.sequenceBuffered = "0";
      root.dataset.sequencePending = "0";
    };

    const rememberBitmap = (frame: number, source: CanvasImageSource) => {
      if (bitmaps.has(frame)) bitmaps.delete(frame);
      bitmaps.set(frame, source);
      while (bitmaps.size > MAX_DECODED_FRAMES) {
        const disposable = Array.from(bitmaps.keys()).find((candidate) => (
          !PRIORITY_FRAME_SET.has(candidate) && candidate !== requestedFrame
        ));
        const oldest = disposable ?? bitmaps.keys().next().value as number | undefined;
        if (oldest === undefined || oldest === requestedFrame) break;
        const released = bitmaps.get(oldest);
        if (released) releaseSource(released);
        bitmaps.delete(oldest);
      }
      root.dataset.sequenceLoaded = String(bitmaps.size);
    };

    const loadBlob = (frame: number, loadGeneration = generation) => {
      const cached = blobs.get(frame);
      if (cached) return Promise.resolve(cached);
      const pending = pendingBlobs.get(frame);
      if (pending) return pending;

      const request = fetch(sequenceFramePath(frame, variant), { cache: "force-cache" })
        .then((response) => {
          if (!response.ok) throw new Error(`Sequence frame ${frame} returned ${response.status}`);
          return response.blob();
        })
        .then((blob) => {
          if (!disposed && loadGeneration === generation) {
            blobs.set(frame, blob);
            root.dataset.sequenceBuffered = String(blobs.size);
          }
          return blob;
        })
        .finally(() => {
          if (pendingBlobs.get(frame) === request) pendingBlobs.delete(frame);
        });
      pendingBlobs.set(frame, request);
      return request;
    };

    const decodeFrame = (frame: number, loadGeneration = generation) => {
      const cached = bitmaps.get(frame);
      if (cached) {
        bitmaps.delete(frame);
        bitmaps.set(frame, cached);
        return Promise.resolve(cached);
      }
      const pending = pendingBitmaps.get(frame);
      if (pending) return pending;

      const request = loadBlob(frame, loadGeneration)
        .then(decodeBlob)
        .then((source) => {
          if (disposed || loadGeneration !== generation) {
            releaseSource(source);
            return source;
          }
          rememberBitmap(frame, source);
          return source;
        })
        .finally(() => {
          if (pendingBitmaps.get(frame) === request) pendingBitmaps.delete(frame);
        });
      pendingBitmaps.set(frame, request);
      return request;
    };

    const resizeCanvas = () => {
      const cssWidth = Math.max(1, canvas.clientWidth);
      const cssHeight = Math.max(1, canvas.clientHeight);
      const ratio = sequenceCanvasScale(cssWidth, cssHeight, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(cssWidth * ratio));
      const height = Math.max(1, Math.round(cssHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        canvasNeedsRedraw = true;
        root.dataset.sequenceCanvasPixels = String(width * height);
      }
    };

    const nearestLoadedFrame = (frame: number) => {
      let nearest = -1;
      let distance = Number.POSITIVE_INFINITY;
      bitmaps.forEach((_, candidate) => {
        const nextDistance = Math.abs(candidate - frame);
        if (nextDistance < distance) {
          nearest = candidate;
          distance = nextDistance;
        }
      });
      return nearest;
    };

    const drawSource = (frame: number, source: CanvasImageSource) => {
      if (!canvasNeedsRedraw && lastDrawnFrame === frame) return;
      const { width, height } = canvasSourceSize(source);
      if (!width || !height) return;
      const scale = Math.max(canvas.width / width, canvas.height / height);
      const drawWidth = width * scale;
      const drawHeight = height * scale;
      const x = (canvas.width - drawWidth) / 2;
      const y = (canvas.height - drawHeight) / 2;
      context.drawImage(source, x, y, drawWidth, drawHeight);
      canvasNeedsRedraw = false;
      lastDrawnFrame = frame;
      root.dataset.sequenceFrame = String(frame);
      root.dataset.sequenceVariant = variant;
      root.classList.add("sequence-ready");
    };

    const drawRequestedFrame = () => {
      const exact = bitmaps.get(requestedFrame);
      if (exact) {
        drawSource(requestedFrame, exact);
        return;
      }
      const nearest = nearestLoadedFrame(requestedFrame);
      if (nearest > 0) {
        const source = bitmaps.get(nearest);
        if (source) drawSource(nearest, source);
      }
    };

    const scheduleWarmNeighbors = (center: number, direction: number, loadGeneration: number) => {
      window.cancelIdleCallback?.(warmIdleHandle);
      window.clearTimeout(warmIdleHandle);

      const candidates = [
        center + direction,
        center - direction,
        center + direction * 2,
        center - direction * 2,
      ].filter((frame) => (
        frame >= 1 && frame <= SEQUENCE_FRAME_COUNT && !bitmaps.has(frame)
      ));
      let index = 0;

      const scheduleNext = () => {
        if (disposed || loadGeneration !== generation || requestedFrame !== center || index >= candidates.length) return;
        if ("requestIdleCallback" in window) {
          warmIdleHandle = window.requestIdleCallback(pump, { timeout: 700 });
        } else {
          warmIdleHandle = window.setTimeout(() => pump(), 48);
        }
      };

      const pump = (deadline?: IdleDeadline) => {
        if (disposed || loadGeneration !== generation || requestedFrame !== center || index >= candidates.length) return;
        if (deadline && !deadline.didTimeout && deadline.timeRemaining() <= 3) {
          scheduleNext();
          return;
        }
        const frame = candidates[index];
        index += 1;
        void decodeFrame(frame, loadGeneration)
          .catch(() => undefined)
          .finally(scheduleNext);
      };

      scheduleNext();
    };

    const scheduleRequestedDecode = () => {
      if (decodeQueueRunning || disposed || bitmaps.has(requestedFrame)) return;
      decodeQueueRunning = true;
      root.dataset.sequencePending = "1";
      const loadGeneration = generation;
      let failed = false;

      void (async () => {
        try {
          while (!disposed && loadGeneration === generation) {
            const target = requestedFrame;
            if (bitmaps.has(target)) break;
            await decodeFrame(target, loadGeneration);
            if (target === requestedFrame) {
              drawRequestedFrame();
              break;
            }
          }
        } catch {
          failed = true;
          if (!disposed && loadGeneration === generation) root.dataset.sequenceState = "fallback";
        } finally {
          decodeQueueRunning = false;
          root.dataset.sequencePending = "0";
          if (disposed) return;
          if (!failed && !bitmaps.has(requestedFrame)) {
            scheduleRequestedDecode();
          } else if (!failed && bitmaps.has(requestedFrame)) {
            scheduleWarmNeighbors(requestedFrame, lastDirection, generation);
          }
        }
      })();
    };

    const requestFrame = (frame: number) => {
      if (frame === requestedFrame) return;
      window.cancelIdleCallback?.(warmIdleHandle);
      window.clearTimeout(warmIdleHandle);
      lastDirection = Math.sign(frame - lastRequestedFrame) || lastDirection;
      lastRequestedFrame = frame;
      requestedFrame = frame;
      root.dataset.sequenceRequestedFrame = String(frame);
      drawRequestedFrame();
      scheduleRequestedDecode();
    };

    const scheduleIdleFill = (loadGeneration: number) => {
      const queue = Array.from({ length: SEQUENCE_FRAME_COUNT }, (_, index) => index + 1)
        .filter((frame) => !PRIORITY_FRAME_SET.has(frame));

      const pump = (deadline?: IdleDeadline) => {
        if (disposed || loadGeneration !== generation) return;
        let count = 0;
        while (queue.length && count < IDLE_BATCH_SIZE && (!deadline || deadline.didTimeout || deadline.timeRemaining() > 2)) {
          const frame = queue.shift();
          if (frame) void loadBlob(frame, loadGeneration).catch(() => undefined);
          count += 1;
        }
        if (!queue.length) return;
        if ("requestIdleCallback" in window) {
          fillIdleHandle = window.requestIdleCallback(pump, { timeout: 1200 });
        } else {
          fillIdleHandle = window.setTimeout(() => pump(), 80);
        }
      };

      if ("requestIdleCallback" in window) {
        fillIdleHandle = window.requestIdleCallback(pump, { timeout: 1200 });
      } else {
        fillIdleHandle = window.setTimeout(() => pump(), 80);
      }
    };

    const beginLoading = async () => {
      const loadGeneration = generation;
      root.dataset.sequenceState = "loading";
      try {
        await decodeFrame(1, loadGeneration);
        if (disposed || loadGeneration !== generation) return;
        drawRequestedFrame();
        root.dataset.sequenceState = "ready";
        scheduleRequestedDecode();
        const priority = PRIORITY_FRAMES.filter((frame) => frame !== 1);
        for (let index = 0; index < priority.length; index += 1) {
          if (disposed || loadGeneration !== generation) return;
          await decodeFrame(priority[index], loadGeneration);
          drawRequestedFrame();
          if (index % 2 === 1) {
            await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
          }
        }
        if (!disposed && loadGeneration === generation) scheduleIdleFill(loadGeneration);
      } catch {
        if (!disposed && loadGeneration === generation) root.dataset.sequenceState = "fallback";
      }
    };

    const onResize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        resizeCanvas();
        drawRequestedFrame();
      });
    };
    const onVariantChange = () => {
      const nextVariant: SequenceVariant = media.matches ? "mobile" : "desktop";
      if (nextVariant === variant) return;
      generation += 1;
      variant = nextVariant;
      window.cancelIdleCallback?.(fillIdleHandle);
      window.clearTimeout(fillIdleHandle);
      window.cancelIdleCallback?.(warmIdleHandle);
      window.clearTimeout(warmIdleHandle);
      root.classList.remove("sequence-ready");
      clearCaches();
      void beginLoading();
    };

    controllerRef.current = {
      setProgress(progress) {
        requestFrame(progressToSequenceFrame(progress));
      },
    };

    window.addEventListener("resize", onResize);
    media.addEventListener("change", onVariantChange);
    resizeCanvas();
    root.dataset.sequenceRequestedFrame = "1";
    void beginLoading();

    return () => {
      disposed = true;
      controllerRef.current = null;
      window.removeEventListener("resize", onResize);
      media.removeEventListener("change", onVariantChange);
      window.cancelAnimationFrame(resizeFrame);
      window.cancelIdleCallback?.(fillIdleHandle);
      window.clearTimeout(fillIdleHandle);
      window.cancelIdleCallback?.(warmIdleHandle);
      window.clearTimeout(warmIdleHandle);
      clearCaches();
    };
  }, [canvasRef, enabled, rootRef]);

  return controllerRef;
}
