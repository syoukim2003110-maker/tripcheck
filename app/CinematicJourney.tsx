"use client";

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { AppCopy, Locale } from "../lib/i18n";

type JourneyProps = {
  locale: Locale;
  t: AppCopy;
};

type FilmScene = {
  start: number;
  end: number;
  index: string;
  eyebrow: string;
  title: string;
  accent?: string;
  body: string;
  align?: "left" | "right" | "center";
  mode?: "hero" | "metrics" | "method" | "repair" | "cta";
};

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

  const scenes = useMemo<FilmScene[]>(() => [
    {
      start: 0,
      end: 0.16,
      index: "01",
      eyebrow: t.hero.eyebrow,
      title: t.hero.line1,
      accent: t.hero.line2,
      body: t.hero.body,
      align: "left",
      mode: "hero",
    },
    {
      start: 0.14,
      end: 0.30,
      index: "02",
      eyebrow: t.story.eyebrow,
      title: t.story.title,
      accent: t.story.accent,
      body: t.story.body,
      align: "center",
      mode: "metrics",
    },
    {
      start: 0.28,
      end: 0.44,
      index: "03",
      eyebrow: t.friction.eyebrow,
      title: t.friction.cards[1].title,
      accent: t.story.metrics[2].value,
      body: t.friction.cards[1].body,
      align: "right",
    },
    {
      start: 0.42,
      end: 0.58,
      index: "04",
      eyebrow: t.friction.eyebrow,
      title: t.friction.title,
      body: t.friction.body,
      align: "left",
    },
    {
      start: 0.56,
      end: 0.72,
      index: "05",
      eyebrow: t.method.eyebrow,
      title: t.method.title,
      accent: t.method.accent,
      body: t.method.cards.map((card) => card.body).join(" "),
      align: "center",
      mode: "method",
    },
    {
      start: 0.70,
      end: 0.86,
      index: "06",
      eyebrow: t.trust.eyebrow,
      title: t.trust.title,
      body: t.trust.cards.map((card) => card.body).join(" "),
      align: "right",
      mode: "repair",
    },
    {
      start: 0.84,
      end: 1,
      index: "07",
      eyebrow: t.checker.eyebrow,
      title: t.checker.title,
      body: t.checker.body,
      align: "center",
      mode: "cta",
    },
  ], [t]);

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const copies = Array.from(stage.querySelectorAll<HTMLElement>(".film-copy"));
    let frame = 0;
    let lastScene = -1;

    root.classList.add("cinema-ready");

    const render = () => {
      const rect = root.getBoundingClientRect();
      const travel = Math.max(1, rect.height - window.innerHeight);
      const progress = reducedMotion ? 0 : clamp(-rect.top / travel);
      const activeScene = scenes.findIndex((scene, index) => progress <= scene.end || index === scenes.length - 1);

      root.style.setProperty("--film-progress", progress.toFixed(4));
      root.style.setProperty("--world-rotate-x", `${-11 + progress * 24}deg`);
      root.style.setProperty("--world-rotate-y", `${-24 + progress * 305}deg`);
      root.style.setProperty("--world-rotate-z", `${-4 + Math.sin(progress * Math.PI * 4) * 8}deg`);
      root.style.setProperty("--world-scale", `${0.84 + bell(progress, 0.48, 0.52) * 0.48}`);
      root.style.setProperty("--world-x", `${Math.sin(progress * Math.PI * 3) * 14}vw`);
      root.style.setProperty("--world-y", `${(progress - 0.5) * -18}vh`);
      root.style.setProperty("--blue-wash", `${smooth(clamp((progress - 0.1) / 0.12)) * (1 - smooth(clamp((progress - 0.68) / 0.17)))}`);
      root.style.setProperty("--red-wash", `${bell(progress, 0.48, 0.16) * 0.92}`);
      root.style.setProperty("--dark-wash", `${bell(progress, 0.75, 0.24)}`);
      root.style.setProperty("--clock-presence", `${bell(progress, 0.37, 0.17)}`);
      root.style.setProperty("--anchor-presence", `${bell(progress, 0.58, 0.19)}`);
      root.style.setProperty("--repair-presence", `${smooth(clamp((progress - 0.65) / 0.17))}`);
      root.style.setProperty("--route-spread", `${smooth(clamp((progress - 0.43) / 0.16))}`);
      root.style.setProperty("--film-line", `${progress * 100}%`);

      copies.forEach((copy, index) => {
        const scene = scenes[index];
        const fade = 0.02;
        const enter = index === 0 ? 1 : smooth((progress - scene.start) / fade);
        const exit = scene.end >= 0.999 ? 1 : 1 - smooth((progress - (scene.end - fade)) / fade);
        const opacity = reducedMotion ? 1 : clamp(Math.min(enter, exit));
        const drift = (progress - (scene.start + scene.end) / 2) * 90;
        copy.style.opacity = opacity.toFixed(3);
        copy.style.transform = reducedMotion
          ? "none"
          : `translate3d(0, ${drift}px, 0) scale(${0.96 + opacity * 0.04})`;
        copy.style.pointerEvents = opacity > 0.6 ? "auto" : "none";
      });

      if (lastScene !== activeScene) {
        stage.dataset.scene = String(activeScene + 1);
        stage.dataset.theme = activeScene >= 1 && activeScene <= 5 ? "dark" : "light";
        lastScene = activeScene;
      }
      frame = 0;
    };

    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(render);
    };
    render();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [scenes]);

  return (
    <section className="cinema-scroll" data-film-locale={locale} id="top" ref={rootRef} aria-label="TripCheck Japan product story">
      <span className="cinema-method-anchor" id="method" aria-hidden="true" />
      <div className="cinema-stage" ref={stageRef} data-scene="1" data-theme="light">
        <div className="film-background film-background-paper" />
        <div className="film-background film-background-blue" />
        <div className="film-background film-background-red" />
        <div className="film-background film-background-dark" />
        <div className="film-grain" aria-hidden="true" />

        <FilmWorld />

        <div className="film-copies">
          {scenes.map((scene) => (
            <article
              className={`film-copy film-copy-${scene.align ?? "left"} film-copy-${scene.mode ?? "standard"}`}
              data-start={scene.start}
              data-end={scene.end}
              key={scene.index}
            >
              <p className="film-eyebrow"><span>{scene.index}</span>{scene.eyebrow}</p>
              {scene.index === "01" ? (
                <h1>
                  <span>{scene.title}</span>
                  {scene.accent ? <strong>{scene.accent}</strong> : null}
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
                <ol className="film-method-list">
                  {t.method.cards.map((card) => <li key={card.number}><span>{card.number}</span>{card.title}</li>)}
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
          <span>SCENE <em>0</em><em className="film-scene-number">1</em> / 07</span>
        </div>
        <div className="film-scroll-cue" aria-hidden="true">SCROLL TO PLAY <span>↓</span></div>
      </div>
    </section>
  );
}
