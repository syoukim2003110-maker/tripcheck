"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { copy, localeLabels, type Locale } from "../lib/i18n";
import { analyzeTrip, type Pace, type Severity } from "../lib/trip-analysis";

const localeOrder: Locale[] = ["en", "ja", "ko", "zh"];

function IssueMark({ kind }: { kind: Severity }) {
  return (
    <span className={`issue-glyph ${kind}`} aria-hidden="true">
      {kind === "note" ? "i" : "!"}
    </span>
  );
}

function Brand() {
  return (
    <span className="brand-lockup">
      <span className="route-mark" aria-hidden="true">
        <i />
        <i />
      </span>
      <span>TRIPCHECK</span>
      <small>JAPAN</small>
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
      setNavCompact(window.scrollY > 24);
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
    }, 620);
  }

  return (
    <main className="experience" data-locale={locale}>
      <header className={`global-nav ${navCompact ? "is-compact" : ""}`}>
        <a href="#top" aria-label="TripCheck Japan home"><Brand /></a>
        <nav aria-label="Main navigation">
          <a href="#method">{t.nav.method}</a>
          <a href="#trust">{t.nav.trust}</a>
        </nav>
        <label className="locale-switcher">
          <span className="sr-only">{t.languageLabel}</span>
          <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)} aria-label={t.languageLabel}>
            {localeOrder.map((option) => <option value={option} key={option}>{localeLabels[option]}</option>)}
          </select>
        </label>
      </header>

      <section className="editorial-hero" id="top" ref={heroRef}>
        <div className="hero-sticky">
          <div className="hero-coordinate hero-coordinate-top" aria-hidden="true">35.6762° N / 139.6503° E</div>
          <div className="hero-title-block">
            <p className="hero-eyebrow"><span>01</span>{t.hero.eyebrow}</p>
            <h1>
              <span>{t.hero.line1}</span>
              <strong>{t.hero.line2}</strong>
            </h1>
          </div>

          <div className="hero-object" role="img" aria-label="A sculptural Tokyo route made from folded paper">
            <div className="hero-object-image" />
            <span className="hero-orbit hero-orbit-one" aria-hidden="true" />
            <span className="hero-orbit hero-orbit-two" aria-hidden="true" />
          </div>

          <div className="hero-summary">
            <p>{t.hero.body}</p>
            <a href="#checker">{t.hero.cta}<span aria-hidden="true">↘</span></a>
          </div>

          <div className="hero-footerline">
            <span>{t.nav.beta}</span>
            <span>GEOGRAPHY / TIME / CERTAINTY</span>
            <span>{t.hero.scroll} ↓</span>
          </div>
        </div>
      </section>

      <section className="manifesto-section" id="method">
        <div className="manifesto-index reveal">02 / THE HIDDEN LAYER</div>
        <div className="manifesto-copy">
          <p className="section-eyebrow reveal">{t.story.eyebrow}</p>
          <h2 className="reveal">
            <span>{t.story.title}</span>
            <strong>{t.story.accent}</strong>
          </h2>
          <p className="manifesto-body reveal">{t.story.body}</p>
        </div>
        <div className="metric-rail">
          {t.story.metrics.map((metric, index) => (
            <article className="metric-item reveal" style={{ transitionDelay: `${index * 80}ms` }} key={metric.value}>
              <span>0{index + 1}</span>
              <strong>{metric.value}</strong>
              <p>{metric.label}</p>
            </article>
          ))}
        </div>
        <div className="manifesto-marquee" aria-hidden="true">
          <div>{t.friction.cards.map((card) => <span key={card.number}>{card.title} <i>●</i></span>)}</div>
        </div>
      </section>

      <section className="criteria-section">
        <header className="criteria-heading">
          <div>
            <p className="section-eyebrow reveal">03 / {t.friction.eyebrow}</p>
            <h2 className="reveal">{t.friction.title}</h2>
          </div>
          <p className="reveal">{t.friction.body}</p>
        </header>
        <div className="criteria-list">
          {t.friction.cards.map((card, index) => (
            <article className="criterion reveal" style={{ transitionDelay: `${index * 70}ms` }} key={card.number}>
              <span className="criterion-number">{card.number}</span>
              <h3>{card.title}</h3>
              <p>{card.body}</p>
              <span className={`criterion-object criterion-object-${index + 1}`} aria-hidden="true"><i /></span>
            </article>
          ))}
        </div>
      </section>

      <section className="checker-section" id="checker">
        <header className="checker-heading">
          <p className="section-eyebrow reveal">04 / {t.checker.eyebrow}</p>
          <h2 className="reveal">{t.checker.title}</h2>
          <p className="reveal">{t.checker.body}</p>
        </header>

        <div className="checker-workbench reveal">
          <div className="workbench-bar">
            <span>TRIPCHECK / TOKYO / 001</span>
            <button onClick={loadSample} type="button">{t.checker.sample}<b aria-hidden="true">↗</b></button>
          </div>
          <label className="itinerary-input" htmlFor="trip-input">
            <span className="input-index" aria-hidden="true">A</span>
            <span className="sr-only">{t.checker.inputLabel}</span>
            <textarea
              id="trip-input"
              value={itinerary}
              onChange={(event) => { setItinerary(event.target.value); setHasChecked(false); }}
              placeholder={t.checker.placeholder}
              rows={12}
              maxLength={8000}
            />
            <span className="character-count">{characterCount.toLocaleString(locale)} / 8,000</span>
          </label>
          <div className="workbench-controls">
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
          <div className="result-head reveal">
            <div className={`reality-score ${analysis.score < 60 ? "is-low" : ""}`}>
              <span>{analysis.score}</span><small>{t.result.score}</small>
            </div>
            <div>
              <p className="section-eyebrow">{t.result.eyebrow} · {t.months[monthIndex]} · {t.pace[pace]}</p>
              <h2>{analysis.headline}</h2>
              <p>{analysis.subhead}</p>
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
                  <article className={`issue-card reveal ${issue.severity}`} style={{ transitionDelay: `${index * 60}ms` }} key={`${issue.title}-${index}`}>
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
        <div className="method-title">
          <p className="section-eyebrow reveal">05 / {t.method.eyebrow}</p>
          <h2 className="reveal"><span>{t.method.title}</span><strong>{t.method.accent}</strong></h2>
        </div>
        <div className="method-list">
          {t.method.cards.map((card, index) => (
            <article className="method-row reveal" style={{ transitionDelay: `${index * 70}ms` }} key={card.number}>
              <span>{card.number}</span><h3>{card.title}</h3><p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="trust-section" id="trust">
        <header>
          <p className="section-eyebrow reveal">06 / {t.trust.eyebrow}</p>
          <h2 className="reveal">{t.trust.title}</h2>
        </header>
        <div className="trust-list">
          {t.trust.cards.map((card, index) => (
            <article className="trust-row reveal" style={{ transitionDelay: `${index * 70}ms` }} key={card.letter}>
              <span>{card.letter}</span><h3>{card.title}</h3><p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="site-footer">
        <Brand />
        <p>{t.footer}</p>
        <a href="#top">BACK TO TOP ↑</a>
      </footer>
    </main>
  );
}
