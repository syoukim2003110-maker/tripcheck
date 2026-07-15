"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { copy, localeLabels, type Locale } from "../lib/i18n";
import {
  analyzeTrip,
  type Pace,
  type Severity,
} from "../lib/trip-analysis";

const localeOrder: Locale[] = ["en", "ja", "ko", "zh"];

function IssueMark({ kind }: { kind: Severity }) {
  return <span className={`issue-glyph ${kind}`} aria-hidden="true">{kind === "note" ? "i" : "!"}</span>;
}

function Brand() {
  return (
    <span className="brand-lockup">
      <span className="brand-symbol" aria-hidden="true"><i /></span>
      <span>TripCheck <b>Japan</b></span>
    </span>
  );
}

export default function TripCheckApp() {
  const [locale, setLocale] = useState<Locale>("en");
  const [itinerary, setItinerary] = useState("");
  const [pace, setPace] = useState<Pace>("balanced");
  const [monthIndex, setMonthIndex] = useState(9);
  const [hasChecked, setHasChecked] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [navCompact, setNavCompact] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const t = copy[locale];

  const analysis = useMemo(
    () => (hasChecked ? analyzeTrip(itinerary, pace, locale) : null),
    [hasChecked, itinerary, locale, pace],
  );

  const characterCount = itinerary.length;
  const canCheck = itinerary.trim().length >= 30 && !isChecking;

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("tripcheck-locale") as Locale | null;
      if (stored && localeOrder.includes(stored)) {
        window.setTimeout(() => setLocale(stored), 0);
      }
    } catch {
      // Language persistence is optional.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : locale;
    try {
      window.localStorage.setItem("tripcheck-locale", locale);
    } catch {
      // The interface still works without storage.
    }
  }, [locale]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      const hero = heroRef.current;
      if (hero) {
        const rect = hero.getBoundingClientRect();
        const distance = Math.max(1, rect.height - window.innerHeight);
        const progress = Math.min(1, Math.max(0, -rect.top / distance));
        hero.style.setProperty("--hero-progress", progress.toFixed(3));
      }
      setNavCompact(window.scrollY > 30);
      frame = 0;
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const nodes = document.querySelectorAll<HTMLElement>(".reveal");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -12%", threshold: 0.12 },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [locale, analysis]);

  function loadSample() {
    setItinerary(t.sample);
    setHasChecked(false);
    window.setTimeout(() => document.getElementById("trip-input")?.focus(), 30);
  }

  function runCheck() {
    if (!canCheck) return;
    setIsChecking(true);
    window.setTimeout(() => {
      setHasChecked(true);
      setIsChecking(false);
      window.setTimeout(() => {
        document.getElementById("analysis-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    }, 720);
  }

  return (
    <main className="experience" data-locale={locale}>
      <header className={`global-nav ${navCompact ? "is-compact" : ""}`}>
        <div className="nav-inner">
          <a href="#top" aria-label="TripCheck Japan home"><Brand /></a>
          <nav aria-label="Main navigation">
            <a href="#method">{t.nav.method}</a>
            <a href="#trust">{t.nav.trust}</a>
            <span className="beta-badge"><i />{t.nav.beta}</span>
          </nav>
          <label className="locale-switcher">
            <span className="sr-only">{t.languageLabel}</span>
            <span aria-hidden="true">◎</span>
            <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)} aria-label={t.languageLabel}>
              {localeOrder.map((option) => <option value={option} key={option}>{localeLabels[option]}</option>)}
            </select>
          </label>
        </div>
      </header>

      <section className="cinematic-hero" id="top" ref={heroRef}>
        <div className="hero-sticky">
          <div className="hero-aurora" aria-hidden="true" />
          <div className="hero-copy-block">
            <p className="hero-eyebrow"><span />{t.hero.eyebrow}</p>
            <h1>
              <span>{t.hero.line1}</span>
              <strong>{t.hero.line2}</strong>
            </h1>
            <p className="hero-body">{t.hero.body}</p>
            <a className="hero-cta" href="#checker">{t.hero.cta}<span aria-hidden="true">↓</span></a>
          </div>

          <div className="hero-product" aria-label="Animated itinerary analysis preview">
            <div className="map-stage">
              <div className="map-grid" />
              <div className="route-stroke route-one" />
              <div className="route-stroke route-two" />
              <span className="map-district district-one">ASAKUSA</span>
              <span className="map-district district-two">MITAKA</span>
              <span className="map-district district-three">SHIBUYA</span>
              <span className="map-node node-one"><i />08:30</span>
              <span className="map-node node-two conflict"><i />15:30</span>
              <span className="map-node node-three"><i />18:00</span>
              <div className="conflict-wave" />
            </div>
            <div className="floating-plan-card">
              <p>{t.visual.draft}<span>Day 1</span></p>
              <ol>
                <li><time>08:30</time><span>Tsukiji</span></li>
                <li><time>13:00</time><span>Asakusa</span></li>
                <li className="is-conflict"><time>15:30</time><span>Ghibli Museum</span></li>
                <li><time>18:00</time><span>Shibuya Sky</span></li>
              </ol>
            </div>
            <div className="floating-status-card">
              <span className="status-orb" />
              <p><b>{t.visual.checking}</b><small>{t.visual.rebuild}</small></p>
            </div>
            <div className="floating-warning-card">
              <span>!</span><p><b>{t.visual.conflict}</b><small>{t.visual.reservation}</small></p>
            </div>
          </div>

          <p className="scroll-cue"><span />{t.hero.scroll}</p>
        </div>
      </section>

      <section className="story-section" id="method">
        <div className="story-inner">
          <p className="section-eyebrow reveal">{t.story.eyebrow}</p>
          <h2 className="display-title reveal"><span>{t.story.title}</span><strong>{t.story.accent}</strong></h2>
          <p className="story-body reveal">{t.story.body}</p>
          <div className="metric-row">
            {t.story.metrics.map((metric, index) => (
              <article className="metric-card reveal" style={{ transitionDelay: `${index * 90}ms` }} key={metric.value}>
                <strong>{metric.value}</strong><span>{metric.label}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="friction-section">
        <div className="friction-orb" aria-hidden="true" />
        <div className="friction-inner">
          <p className="section-eyebrow reveal">{t.friction.eyebrow}</p>
          <div className="friction-heading">
            <h2 className="reveal">{t.friction.title}</h2>
            <p className="reveal">{t.friction.body}</p>
          </div>
          <div className="friction-cards">
            {t.friction.cards.map((card, index) => (
              <article className="friction-card reveal" style={{ transitionDelay: `${index * 100}ms` }} key={card.number}>
                <span>{card.number}</span>
                <div className={`friction-icon icon-${index + 1}`} aria-hidden="true"><i /><i /><i /></div>
                <h3>{card.title}</h3><p>{card.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="checker-section" id="checker">
        <div className="checker-intro reveal">
          <p className="section-eyebrow">{t.checker.eyebrow}</p>
          <h2>{t.checker.title}</h2>
          <p>{t.checker.body}</p>
        </div>

        <div className="checker-console reveal">
          <div className="console-topbar">
            <div className="console-lights" aria-hidden="true"><i /><i /><i /></div>
            <button className="sample-link" onClick={loadSample} type="button">{t.checker.sample}<span>↗</span></button>
          </div>
          <div className="console-tabs" role="tablist" aria-label="Input type">
            <button className="active" role="tab" aria-selected="true" type="button">{t.checker.itinerary}</button>
            <button role="tab" aria-selected="false" type="button" disabled>{t.checker.saved}<small>{t.checker.soon}</small></button>
          </div>
          <label className="itinerary-input" htmlFor="trip-input">
            <span className="sr-only">{t.checker.inputLabel}</span>
            <span className="line-numbers" aria-hidden="true">01<br />02<br />03<br />04<br />05<br />06<br />07<br />08</span>
            <textarea
              id="trip-input"
              value={itinerary}
              onChange={(event) => { setItinerary(event.target.value); setHasChecked(false); }}
              placeholder={t.checker.placeholder}
              rows={11}
              maxLength={8000}
            />
            <span className="character-count">{characterCount.toLocaleString(locale)} / 8,000</span>
          </label>
          <div className="console-controls">
            <label className="select-field">
              <span>{t.checker.travelMonth}</span>
              <select value={monthIndex} onChange={(event) => setMonthIndex(Number(event.target.value))}>
                {t.months.map((month, index) => <option value={index} key={month}>{month}</option>)}
              </select>
            </label>
            <fieldset className="pace-field">
              <legend>{t.checker.pace}</legend>
              <div>
                {(["relaxed", "balanced", "fast"] as Pace[]).map((option) => (
                  <button className={pace === option ? "active" : ""} key={option} onClick={() => setPace(option)} type="button">{t.pace[option]}</button>
                ))}
              </div>
            </fieldset>
            <button className="check-button" disabled={!canCheck} onClick={runCheck} type="button">
              <span>{isChecking ? t.checker.checking : t.checker.button}</span><b aria-hidden="true">→</b>
            </button>
          </div>
          <p className="prototype-note"><b>{t.checker.prototype}</b>{t.checker.prototypeBody}</p>
        </div>
      </section>

      {analysis ? (
        <section className="results-section" id="analysis-result" aria-live="polite">
          <div className="result-hero reveal">
            <div className={`reality-gauge ${analysis.score < 60 ? "is-low" : ""}`}>
              <span>{analysis.score}</span><small>{t.result.score}</small>
            </div>
            <div>
              <p className="section-eyebrow">{t.result.eyebrow} · {t.months[monthIndex]} · {t.pace[pace]}</p>
              <h2>{analysis.headline}</h2><p>{analysis.subhead}</p>
            </div>
          </div>
          <div className="result-stats reveal">
            <div><strong>{analysis.criticalCount}</strong><span>{t.result.critical}</span></div>
            <div><strong>{analysis.warningCount}</strong><span>{t.result.warning}</span></div>
            <div><strong>{analysis.hiddenTransit}</strong><span>{t.result.transit}</span></div>
          </div>
          <div className="result-layout">
            <div className="issue-column">
              <div className="column-heading reveal"><p>{t.result.issuesEyebrow}</p><h3>{t.result.issuesTitle}</h3></div>
              <div className="issue-list">
                {analysis.issues.map((issue, index) => (
                  <article className={`issue-card reveal ${issue.severity}`} style={{ transitionDelay: `${index * 70}ms` }} key={`${issue.title}-${index}`}>
                    <IssueMark kind={issue.severity} />
                    <div>
                      <div className="issue-meta"><span>{t.result.severity[issue.severity]}</span><span>{issue.eyebrow}</span><span>{t.result.confidence[issue.confidence]}</span></div>
                      <h4>{issue.title}</h4><p>{issue.detail}</p>
                      <div className="issue-action"><b>{t.result.action}</b><span>{issue.action}</span></div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
            <aside className="revision-panel reveal">
              <p className="section-eyebrow">{t.result.revisedEyebrow}</p>
              <h3>{t.result.revisedTitle}</h3><p className="revision-intro">{t.result.revisedIntro}</p>
              <div className="day-list">
                {analysis.revisedDays.map((day) => (
                  <article className="day-card" key={day.day}>
                    <header><div><span>{day.day}</span><h4>{day.theme}</h4></div><em>{t.result.load[day.load]}</em></header>
                    <ol>
                      {day.stops.map((stop, index) => (
                        <li key={`${stop.name}-${index}`}><time>{stop.time}</time><span><b>{stop.name}</b>{stop.note && <small>{stop.note}</small>}</span></li>
                      ))}
                    </ol>
                  </article>
                ))}
              </div>
              <button className="save-button" type="button" disabled>{t.result.save}<span>{t.result.coming}</span></button>
            </aside>
          </div>
        </section>
      ) : null}

      <section className="method-section">
        <div className="method-inner">
          <p className="section-eyebrow reveal">{t.method.eyebrow}</p>
          <h2 className="display-title reveal"><span>{t.method.title}</span><strong>{t.method.accent}</strong></h2>
          <div className="method-cards">
            {t.method.cards.map((card, index) => (
              <article className="method-card reveal" style={{ transitionDelay: `${index * 90}ms` }} key={card.number}>
                <span>{card.number}</span><h3>{card.title}</h3><p>{card.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="trust-section" id="trust">
        <div className="trust-inner">
          <p className="section-eyebrow reveal">{t.trust.eyebrow}</p>
          <h2 className="reveal">{t.trust.title}</h2>
          <div className="trust-cards">
            {t.trust.cards.map((card, index) => (
              <article className="trust-card reveal" style={{ transitionDelay: `${index * 90}ms` }} key={card.letter}>
                <span>{card.letter}</span><div><h3>{card.title}</h3><p>{card.body}</p></div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <a href="#top"><Brand /></a><p>{t.footer}</p>
      </footer>
    </main>
  );
}
