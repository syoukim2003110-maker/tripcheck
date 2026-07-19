"use client";

import { useEffect, useMemo, useRef, type CSSProperties, type RefObject } from "react";
import type { AppCopy, Locale } from "../lib/i18n";
import { sceneForProgress } from "../lib/film-sequence";
import { useFilmSequence } from "./useFilmSequence";

type JourneyProps = {
  locale: Locale;
  t: AppCopy;
};

type FilmScene = {
  start: number;
  end: number;
  act: 1 | 2 | 3 | 4 | 5;
  index: string;
  eyebrow: string;
  title: string;
  accent?: string;
  body: string;
  align?: "left" | "right" | "center";
  mode?: "hero" | "metrics" | "method" | "repair" | "cta";
};

export const USE_SEQUENCE_CANVAS = true;

const routeSegments = [
  { x: -330, y: 120, z: -40, r: -28, w: 150 },
  { x: -235, y: 52, z: 30, r: -16, w: 148 },
  { x: -126, y: 15, z: 74, r: -4, w: 154 },
  { x: -12, y: 14, z: 104, r: 11, w: 150 },
  { x: 100, y: 48, z: 72, r: 19, w: 150 },
  { x: 205, y: 104, z: 28, r: 34, w: 145 },
  { x: 296, y: 175, z: -32, r: 44, w: 140 },
];

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function bell(progress: number, center: number, radius: number) {
  return clamp(1 - Math.abs(progress - center) / radius);
}

function smooth(value: number) {
  const next = clamp(value);
  return next * next * (3 - 2 * next);
}

function SplitTitleLine({ text, accent = false }: { text: string; accent?: boolean }) {
  return (
    <span className={`film-title-line${accent ? " is-accent" : ""}`} aria-hidden="true">
      {text.split(" ").map((word, wordIndex) => (
        <span className="film-title-word" key={`${word}-${wordIndex}`}>
          {Array.from(word).map((character, characterIndex) => (
            <span className="film-char-mask" key={`${character}-${characterIndex}`}>
              <span className="film-title-char">{character}</span>
            </span>
          ))}
          {wordIndex < text.split(" ").length - 1 ? <span className="film-title-space">&nbsp;</span> : null}
        </span>
      ))}
    </span>
  );
}

function SequenceSurface({ enabled, canvasRef }: { enabled: boolean; canvasRef: RefObject<HTMLCanvasElement | null> }) {
  if (!enabled) return null;
  return (
    <div className="film-sequence" aria-hidden="true">
      <picture className="film-sequence-poster">
        <source media="(max-width: 719px)" srcSet="/seq/mobile/f0001.webp" />
        <img src="/seq/desktop/f0001.webp" alt="" decoding="async" fetchPriority="high" />
      </picture>
      <canvas className="film-sequence-canvas" ref={canvasRef} />
    </div>
  );
}

function FilmWorld() {
  return (
    <div className="film-world" aria-hidden="true">
      <div className="film-orbit film-orbit-a" />
      <div className="film-orbit film-orbit-b" />

      <div className="route-model">
        {routeSegments.map((segment, index) => (
          <i
            className="route-segment"
            key={`${segment.x}-${segment.y}`}
            style={{
              "--x": `${segment.x}px`,
              "--y": `${segment.y}px`,
              "--z": `${segment.z}px`,
              "--r": `${segment.r}deg`,
              "--w": `${segment.w}px`,
              "--segment-index": index,
            } as CSSProperties}
          />
        ))}
        <span className="route-pin route-pin-a"><b /></span>
        <span className="route-pin route-pin-b"><b /></span>
        <span className="route-pin route-pin-c"><b /></span>
      </div>

      <div className="film-landmark landmark-temple">
        <i className="landmark-roof roof-a" />
        <i className="landmark-roof roof-b" />
        <i className="landmark-body" />
        <i className="landmark-step step-a" />
        <i className="landmark-step step-b" />
      </div>

      <div className="film-landmark landmark-tower">
        <i /><i /><i /><i />
      </div>

      <div className="film-clock">
        <div className="clock-edge" />
        <div className="clock-face">
          <i className="clock-hand clock-hour" />
          <i className="clock-hand clock-minute" />
          <b />
        </div>
      </div>

      <div className="anchor-model">
        <i className="anchor-ring ring-a" />
        <i className="anchor-ring ring-b" />
        <i className="anchor-ring ring-c" />
        <span className="anchor-card card-a">09:30</span>
        <span className="anchor-card card-b">17:00</span>
        <span className="anchor-card card-c">20:15</span>
      </div>

      <div className="repair-model">
        <i className="repair-path path-before" />
        <i className="repair-path path-after" />
        <span className="repair-node node-a" />
        <span className="repair-node node-b" />
        <span className="repair-node node-c" />
        <span className="repair-node node-d" />
        <b className="repair-stamp">REORDERED</b>
      </div>
    </div>
  );
}

export default function CinematicJourney({ locale, t }: JourneyProps) {
  const rootRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const loaderRef = useRef<HTMLDivElement>(null);
  const loaderContentRef = useRef<HTMLDivElement>(null);
  const loaderCounterRef = useRef<HTMLElement>(null);
  const progressRef = useRef<HTMLElement>(null);
  const cursorDotRef = useRef<HTMLSpanElement>(null);
  const cursorRingRef = useRef<HTMLSpanElement>(null);
  const sequenceController = useFilmSequence({ enabled: USE_SEQUENCE_CANVAS, rootRef, canvasRef });

  const scenes = useMemo<FilmScene[]>(() => [
    {
      start: 0,
      end: 0.08,
      act: 1,
      index: "01",
      eyebrow: t.hero.eyebrow,
      title: t.hero.line1,
      accent: t.hero.line2,
      body: t.hero.body,
      align: "left",
      mode: "hero",
    },
    {
      start: 0.08,
      end: 0.16,
      act: 2,
      index: "02",
      eyebrow: t.story.eyebrow,
      title: t.story.title,
      accent: t.story.accent,
      body: t.story.body,
      align: "center",
      mode: "metrics",
    },
    {
      start: 0.16,
      end: 0.24,
      act: 2,
      index: "03",
      eyebrow: t.friction.eyebrow,
      title: t.friction.cards[1].title,
      accent: t.story.metrics[2].value,
      body: t.friction.cards[1].body,
      align: "right",
    },
    {
      start: 0.24,
      end: 0.32,
      act: 2,
      index: "04",
      eyebrow: t.friction.eyebrow,
      title: t.friction.title,
      body: t.friction.body,
      align: "left",
    },
    {
      start: 0.32,
      end: 0.55,
      act: 3,
      index: "05",
      eyebrow: t.method.eyebrow,
      title: t.method.title,
      accent: t.method.accent,
      body: t.method.cards.map((card) => card.body).join(" "),
      align: "center",
      mode: "method",
    },
    {
      start: 0.55,
      end: 0.85,
      act: 4,
      index: "06",
      eyebrow: t.trust.eyebrow,
      title: t.trust.title,
      body: t.trust.cards.map((card) => card.body).join(" "),
      align: "right",
      mode: "repair",
    },
    {
      start: 0.85,
      end: 1,
      act: 5,
      index: "07",
      eyebrow: t.checker.eyebrow,
      title: t.checker.title,
      body: t.checker.body,
      align: "center",
      mode: "cta",
    },
  ], [t]);

  const inspectionChips = useMemo(() => [
    ...t.story.metrics.map((metric) => metric.label),
    ...t.friction.cards.map((card) => card.title),
    ...t.method.cards.map((card) => card.title),
  ], [t]);

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return;

    let cancelled = false;
    let context: { revert: () => void } | null = null;
    void Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([gsapModule, triggerModule]) => {
      if (cancelled) return;
      const gsap = gsapModule.gsap;
      const ScrollTrigger = triggerModule.ScrollTrigger;
      gsap.registerPlugin(ScrollTrigger);
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const copies = Array.from(stage.querySelectorAll<HTMLElement>(".film-copy"));
      const titleCharacters = Array.from(stage.querySelectorAll<HTMLElement>(".film-title-char"));
      const chips = Array.from(stage.querySelectorAll<HTMLElement>(".film-check-chip"));
      const offerPieces = Array.from(stage.querySelectorAll<HTMLElement>(".film-copy-cta > *"));
      const copyRenderState = copies.map(() => ({ opacity: "", pointerEvents: "", transform: "", visibility: "" }));
      let lastScene = -1;
      let lastFilmLine = "";

      root.classList.add("cinema-ready");

      context = gsap.context(() => {
      const chipTimeline = gsap.timeline({ paused: true })
        .fromTo(chips, { autoAlpha: 0, y: 24 }, {
          autoAlpha: 1,
          duration: 0.18,
          ease: "none",
          stagger: 0.06,
          y: 0,
        });
      const offerTimeline = gsap.timeline({ paused: true })
        .fromTo(offerPieces, { autoAlpha: 0, y: 32 }, {
          autoAlpha: 1,
          duration: 0.24,
          ease: "none",
          stagger: 0.08,
          y: 0,
        });

      if (reducedMotion) {
        gsap.set(loaderRef.current, { display: "none" });
        gsap.set(titleCharacters, { autoAlpha: 1, rotate: 0, yPercent: 0 });
      } else {
        gsap.set(titleCharacters, { autoAlpha: 0, rotate: 5, transformOrigin: "left bottom", yPercent: 120 });
        const counter = { value: 0 };
        gsap.timeline()
          .to(counter, {
            duration: 1.4,
            ease: "power2.inOut",
            onUpdate: () => {
              if (loaderCounterRef.current) loaderCounterRef.current.textContent = String(Math.round(counter.value)).padStart(3, "0");
            },
            value: 100,
          })
          .to(loaderContentRef.current, { autoAlpha: 0, duration: 0.2, ease: "power2.out" })
          .to(loaderRef.current, { clipPath: "inset(0 0 100% 0)", duration: 0.85, ease: "power4.inOut" })
          .set(loaderRef.current, { display: "none" })
          .to(titleCharacters, {
            autoAlpha: 1,
            duration: 0.72,
            ease: "power4.out",
            rotate: 0,
            stagger: 0.035,
            yPercent: 0,
          }, "-=0.12");
      }

      const renderMotion = (progress: number) => {
        if (!USE_SEQUENCE_CANVAS) {
          root.style.setProperty("--world-rotate-x", `${-11 + progress * 24}deg`);
          root.style.setProperty("--world-rotate-y", `${-24 + progress * 305}deg`);
          root.style.setProperty("--world-rotate-z", `${-4 + Math.sin(progress * Math.PI * 4) * 8}deg`);
          root.style.setProperty("--world-scale", `${0.84 + bell(progress, 0.48, 0.52) * 0.48}`);
          root.style.setProperty("--world-x", `${Math.sin(progress * Math.PI * 3) * 14}vw`);
          root.style.setProperty("--world-y", `${(progress - 0.5) * -18}vh`);
          root.style.setProperty("--blue-wash", `${smooth(clamp((progress - 0.1) / 0.12)) * (1 - smooth(clamp((progress - 0.68) / 0.17)))}`);
          root.style.setProperty("--red-wash", `${bell(progress, 0.48, 0.16) * 0.92}`);
          root.style.setProperty("--dark-wash", `${bell(progress, 0.75, 0.24)}`);
          root.style.setProperty("--clock-presence", `${bell(progress, 0.42, 0.18)}`);
          root.style.setProperty("--anchor-presence", `${bell(progress, 0.61, 0.2)}`);
          root.style.setProperty("--repair-presence", `${smooth(clamp((progress - 0.62) / 0.2))}`);
          root.style.setProperty("--route-spread", `${smooth(clamp((progress - 0.55) / 0.2))}`);
        }
        const filmLine = `${(progress * 100).toFixed(2)}%`;
        if (lastFilmLine !== filmLine) {
          root.style.setProperty("--film-line", filmLine);
          lastFilmLine = filmLine;
        }
        sequenceController.current?.setProgress(progress);

        copies.forEach((copy, index) => {
          const scene = scenes[index];
          const duration = Math.max(0.001, scene.end - scene.start);
          const local = clamp((progress - scene.start) / duration);
          let opacity = 0;
          let y = 46;

          if (index === 0) {
            opacity = 1 - smooth(clamp((progress - 0.055) / 0.025));
            y = -46 * (1 - opacity);
          } else if (index >= 1 && index <= 3) {
            const enter = smooth(clamp((progress - scene.start) / 0.018));
            const exit = 1 - smooth(clamp((progress - (scene.end - 0.018)) / 0.018));
            opacity = Math.min(enter, exit);
            y = 46 * (1 - enter) - 46 * (1 - exit);
          } else if (index === 4) {
            const enter = smooth(clamp((progress - scene.start) / 0.035));
            const exit = 1 - smooth(clamp((progress - (scene.end - 0.035)) / 0.035));
            opacity = Math.min(enter, exit);
            y = 46 * (1 - enter) - 46 * (1 - exit);
            chipTimeline.progress(local);
          } else if (index === 5) {
            const enter = smooth(clamp((local - 0.25) / 0.2));
            const exit = 1 - smooth(clamp((local - 0.9) / 0.1));
            opacity = Math.min(enter, exit);
            y = 46 * (1 - enter) - 46 * (1 - exit);
          } else {
            opacity = smooth(clamp(local / 0.2));
            y = 46 * (1 - opacity);
            offerTimeline.progress(local);
          }

          const nextState = {
            opacity: opacity.toFixed(3),
            pointerEvents: opacity > 0.6 ? "auto" : "none",
            transform: `translate3d(0, ${y.toFixed(2)}px, 0)`,
            visibility: opacity > 0.003 ? "visible" : "hidden",
          };
          const previousState = copyRenderState[index];
          if (previousState.opacity !== nextState.opacity) copy.style.opacity = nextState.opacity;
          if (previousState.transform !== nextState.transform) copy.style.transform = nextState.transform;
          if (previousState.pointerEvents !== nextState.pointerEvents) copy.style.pointerEvents = nextState.pointerEvents;
          if (previousState.visibility !== nextState.visibility) copy.style.visibility = nextState.visibility;
          copyRenderState[index] = nextState;
        });

        const activeScene = sceneForProgress(progress);
        if (lastScene !== activeScene) {
          stage.dataset.scene = String(activeScene);
          stage.dataset.theme = activeScene >= 2 && activeScene <= 4 ? "dark" : "light";
          lastScene = activeScene;
        }
      };

      const playhead = { progress: 0 };
      gsap.to(playhead, {
        ease: "none",
        onUpdate: () => renderMotion(playhead.progress),
        progress: 1,
        scrollTrigger: {
          end: "bottom bottom",
          invalidateOnRefresh: true,
          scrub: 1,
          start: "top top",
          trigger: root,
        },
      });

      gsap.fromTo(progressRef.current, { scaleX: 0 }, {
        ease: "none",
        scaleX: 1,
        scrollTrigger: {
          end: "bottom bottom",
          scrub: 0.3,
          start: "top top",
          trigger: root,
        },
      });

      renderMotion(0);
      window.requestAnimationFrame(() => ScrollTrigger.refresh());

      return () => {
        chipTimeline.kill();
        offerTimeline.kill();
      };
      }, root);
    });

    return () => {
      cancelled = true;
      context?.revert();
      root.classList.remove("cinema-ready");
    };
  }, [scenes, sequenceController]);

  useEffect(() => {
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (!finePointer.matches) return;
    const dot = cursorDotRef.current;
    const ring = cursorRingRef.current;
    if (!dot || !ring) return;

    let targetX = -100;
    let targetY = -100;
    let dotX = -100;
    let dotY = -100;
    let ringX = -100;
    let ringY = -100;
    let frame = 0;

    const render = () => {
      frame = 0;
      dotX += (targetX - dotX) * 0.35;
      dotY += (targetY - dotY) * 0.35;
      ringX += (targetX - ringX) * 0.12;
      ringY += (targetY - ringY) * 0.12;
      dot.style.transform = `translate3d(${dotX}px, ${dotY}px, 0)`;
      ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0)`;
      const remainingMotion = Math.max(
        Math.abs(targetX - dotX),
        Math.abs(targetY - dotY),
        Math.abs(targetX - ringX),
        Math.abs(targetY - ringY),
      );
      if (remainingMotion > 0.1) frame = window.requestAnimationFrame(render);
    };
    const onPointerMove = (event: PointerEvent) => {
      targetX = event.clientX;
      targetY = event.clientY;
      document.documentElement.classList.add("cursor-visible");
      if (!frame) frame = window.requestAnimationFrame(render);
    };
    const onPointerOver = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest("a,button,textarea,select") : null;
      ring.classList.toggle("is-interactive", Boolean(target));
    };
    const onPointerDown = () => ring.classList.add("is-active");
    const onPointerUp = () => ring.classList.remove("is-active");

    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerover", onPointerOver, { passive: true });
    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("pointerup", onPointerUp, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", onPointerUp);
      document.documentElement.classList.remove("cursor-visible");
    };
  }, []);

  return (
    <>
      <div className="film-progress" aria-hidden="true"><i ref={progressRef} /></div>
      <div className="film-loader" ref={loaderRef} aria-hidden="true">
        <div className="film-loader-content" ref={loaderContentRef}>
          <span>TRIPCHECK / TOKYO</span>
          <b>WISHLIST TO ITINERARY</b>
          <strong ref={loaderCounterRef}>000</strong>
        </div>
      </div>
      <div className="film-cursor" aria-hidden="true">
        <span className="film-cursor-dot" ref={cursorDotRef} />
        <span className="film-cursor-ring" ref={cursorRingRef} />
      </div>

      <section className="cinema-scroll" data-film-locale={locale} data-sequence-enabled={USE_SEQUENCE_CANVAS ? "true" : "false"} id="top" ref={rootRef} aria-label="TripCheck Japan product story">
        <span className="cinema-method-anchor" id="method" aria-hidden="true" />
        <div className="cinema-stage" ref={stageRef} data-scene="1" data-theme="light">
          <div className="film-background film-background-paper" />
          <div className="film-background film-background-blue" />
          <div className="film-background film-background-red" />
          <div className="film-background film-background-dark" />
          <SequenceSurface enabled={USE_SEQUENCE_CANVAS} canvasRef={canvasRef} />
          <div className="film-grain" aria-hidden="true" />

          <FilmWorld />

          <div className="film-copies">
            {scenes.map((scene) => (
              <article
                className={`film-copy film-copy-${scene.align ?? "left"} film-copy-${scene.mode ?? "standard"}`}
                data-act={scene.act}
                data-start={scene.start}
                data-end={scene.end}
                key={scene.index}
              >
                <p className="film-eyebrow"><span>{scene.index}</span>{scene.eyebrow}</p>
                {scene.index === "01" ? (
                  <h1 aria-label={`${scene.title} ${scene.accent ?? ""}`.trim()}>
                    <SplitTitleLine text={scene.title} />
                    {scene.accent ? <SplitTitleLine text={scene.accent} accent /> : null}
                  </h1>
                ) : (
                  <h2 className="film-heading-secondary">
                    <span>{scene.title}</span>
                    {scene.accent ? <strong>{scene.accent}</strong> : null}
                  </h2>
                )}
                <p className="film-body">{scene.body}</p>

                {scene.mode === "metrics" ? (
                  <div className="film-metrics">
                    {t.story.metrics.map((metric) => (
                      <span key={metric.value}><b>{metric.value}</b><small>{metric.label}</small></span>
                    ))}
                  </div>
                ) : null}

                {scene.mode === "method" ? (
                  <ol className="film-check-grid">
                    {inspectionChips.map((label, index) => (
                      <li className="film-check-chip" key={`${label}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span>{label}</li>
                    ))}
                  </ol>
                ) : null}

                {scene.mode === "repair" ? (
                  <div className="film-repair-list">
                    {t.trust.cards.map((card) => <span key={card.letter}><b>{card.letter}</b>{card.title}</span>)}
                  </div>
                ) : null}

                {scene.mode === "cta" ? <a className="film-cta" href="#checker">{t.hero.cta}<span>↘</span></a> : null}
              </article>
            ))}
          </div>

          <div className="film-hud" aria-hidden="true">
            <span>TRIPCHECK / TOKYO</span>
            <i><b /></i>
            <span>SCENE <em>0</em><em className="film-scene-number">1</em> / 05</span>
          </div>
          <div className="film-scroll-cue" aria-hidden="true"><b>SCROLL TO PLAY</b><i><span /></i></div>
        </div>
      </section>
    </>
  );
}
