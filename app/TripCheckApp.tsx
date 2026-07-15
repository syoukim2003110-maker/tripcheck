"use client";

import { useMemo, useState } from "react";
import {
  analyzeTrip,
  type Pace,
  type Severity,
  type TripAnalysis,
} from "../lib/trip-analysis";

const sampleItinerary = `Day 1
08:30 Tsukiji Outer Market
10:30 teamLab Planets
13:00 Senso-ji and Asakusa
15:30 Ghibli Museum
18:00 Shibuya Sky
20:00 Golden Gai, Shinjuku

Day 2
09:00 Meiji Jingu
11:00 Harajuku
14:00 Akihabara
17:00 Tokyo Skytree`;

const severityLabels: Record<Severity, string> = {
  critical: "Must fix",
  warning: "At risk",
  note: "Worth knowing",
};

function Mark({ kind }: { kind: Severity }) {
  if (kind === "critical") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3 2.8 20h18.4L12 3Z" />
        <path d="M12 8.2v5.8M12 17.2h.01" />
      </svg>
    );
  }

  if (kind === "warning") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v6M12 16.8h.01" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.5v6M12 7.2h.01" />
    </svg>
  );
}

export default function TripCheckApp() {
  const [itinerary, setItinerary] = useState("");
  const [pace, setPace] = useState<Pace>("balanced");
  const [travelMonth, setTravelMonth] = useState("October");
  const [analysis, setAnalysis] = useState<TripAnalysis | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const characterCount = itinerary.length;
  const canCheck = itinerary.trim().length >= 30 && !isChecking;
  const scoreTone = useMemo(() => {
    if (!analysis) return "";
    return analysis.score < 60 ? "score-low" : "score-mid";
  }, [analysis]);

  function loadSample() {
    setItinerary(sampleItinerary);
    setAnalysis(null);
  }

  function runCheck() {
    if (!canCheck) return;
    setIsChecking(true);
    window.setTimeout(() => {
      setAnalysis(analyzeTrip(itinerary, pace));
      setIsChecking(false);
      window.setTimeout(() => {
        document
          .getElementById("analysis-result")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }, 520);
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="TripCheck Japan home">
          <span className="brand-mark" aria-hidden="true">
            T<span>✓</span>
          </span>
          <span>
            TripCheck
            <small>JAPAN</small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#trust">Trust & data</a>
          <span className="beta-pill">
            <i /> Tokyo beta
          </span>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="hero-kicker">
          <span>AI itinerary reality check</span>
          <span className="kicker-line" />
          <span>01 · Tokyo</span>
        </div>
        <h1>
          Your Japan itinerary looks good.
          <em>But will it actually work?</em>
        </h1>
        <p className="hero-copy">
          Paste the plan you made with ChatGPT, Gemini, a spreadsheet, or your own
          notes. We&apos;ll find the impossible jumps, fragile reservations, and
          exhausting days—then rebuild it around reality.
        </p>
        <div className="trust-strip" aria-label="Product principles">
          <span><b>01</b> No account</span>
          <span><b>02</b> Reasons, not magic</span>
          <span><b>03</b> You keep the final say</span>
        </div>
      </section>

      <section className="checker-shell" aria-label="Itinerary checker">
        <div className="checker-head">
          <div>
            <span className="step-number">01</span>
            <div>
              <p className="overline">Paste your draft</p>
              <h2>What are you trying to fit in?</h2>
            </div>
          </div>
          <button className="sample-button" onClick={loadSample} type="button">
            Load a messy example <span>↗</span>
          </button>
        </div>

        <div className="input-tabs" role="tablist" aria-label="Input type">
          <button className="active" role="tab" aria-selected="true" type="button">
            Itinerary text
          </button>
          <button role="tab" aria-selected="false" type="button" disabled>
            Saved places <span>Soon</span>
          </button>
        </div>

        <label className="textarea-frame">
          <span className="sr-only">Paste your itinerary</span>
          <textarea
            value={itinerary}
            onChange={(event) => {
              setItinerary(event.target.value);
              setAnalysis(null);
            }}
            placeholder={`Day 1\n09:00 Senso-ji\n11:30 teamLab…\n\nPaste any format. Rough notes are fine.`}
            rows={11}
          />
          <span className="character-count">{characterCount.toLocaleString()} / 8,000</span>
        </label>

        <div className="preferences">
          <label>
            <span>Travel month</span>
            <select
              value={travelMonth}
              onChange={(event) => setTravelMonth(event.target.value)}
            >
              {[
                "January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December",
              ].map((month) => <option key={month}>{month}</option>)}
            </select>
          </label>
          <fieldset>
            <legend>Your pace</legend>
            <div className="pace-control">
              {(["relaxed", "balanced", "fast"] as Pace[]).map((option) => (
                <button
                  className={pace === option ? "active" : ""}
                  key={option}
                  onClick={() => setPace(option)}
                  type="button"
                >
                  {option[0].toUpperCase() + option.slice(1)}
                </button>
              ))}
            </div>
          </fieldset>
          <button
            className="check-button"
            disabled={!canCheck}
            onClick={runCheck}
            type="button"
          >
            {isChecking ? "Checking the joins…" : "Reality-check my trip"}
            <span aria-hidden="true">→</span>
          </button>
        </div>
        <p className="prototype-note">
          <span>Prototype</span> This version uses illustrative local rules. It does
          not yet verify live opening hours, tickets, weather, or train routes.
        </p>
      </section>

      {analysis ? (
        <section className="results" id="analysis-result" aria-live="polite">
          <div className="result-lead">
            <div className={`score-ring ${scoreTone}`}>
              <span>{analysis.score}</span>
              <small>/ 100</small>
            </div>
            <div>
              <p className="overline">Reality score · {travelMonth} · {pace} pace</p>
              <h2>{analysis.headline}</h2>
              <p>{analysis.subhead}</p>
            </div>
          </div>

          <div className="summary-grid">
            <div><strong>{analysis.criticalCount}</strong><span>must-fix conflicts</span></div>
            <div><strong>{analysis.warningCount}</strong><span>fragile assumptions</span></div>
            <div><strong>{analysis.hiddenTransit}</strong><span>estimated hidden transit</span></div>
          </div>

          <div className="result-grid">
            <div className="issues-column">
              <div className="section-title">
                <span>02</span>
                <div><p className="overline">What breaks</p><h2>Fix these first</h2></div>
              </div>
              <div className="issue-list">
                {analysis.issues.map((issue, index) => (
                  <article className={`issue-card ${issue.severity}`} key={`${issue.title}-${index}`}>
                    <div className="issue-icon"><Mark kind={issue.severity} /></div>
                    <div>
                      <div className="issue-meta">
                        <span>{severityLabels[issue.severity]}</span>
                        <span>{issue.eyebrow}</span>
                        <span>{issue.confidence} confidence</span>
                      </div>
                      <h3>{issue.title}</h3>
                      <p>{issue.detail}</p>
                      <div className="issue-action"><b>Better move</b>{issue.action}</div>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <aside className="revision-column">
              <div className="section-title">
                <span>03</span>
                <div><p className="overline">One better version</p><h2>Same trip, calmer order</h2></div>
              </div>
              <p className="revision-intro">
                We moved the day—not your priorities. Fixed reservations become
                anchors; flexible stops become options.
              </p>
              <div className="day-list">
                {analysis.revisedDays.map((day) => (
                  <article className="day-card" key={day.day}>
                    <header>
                      <div><span>{day.day}</span><h3>{day.theme}</h3></div>
                      <em>{day.load}</em>
                    </header>
                    <ol>
                      {day.stops.map((stop, index) => (
                        <li key={`${stop.name}-${index}`}>
                          <time>{stop.time}</time>
                          <span><b>{stop.name}</b>{stop.note && <small>{stop.note}</small>}</span>
                        </li>
                      ))}
                    </ol>
                  </article>
                ))}
              </div>
              <button className="secondary-button" type="button" disabled>
                Save this revision <span>Coming next</span>
              </button>
            </aside>
          </div>
        </section>
      ) : null}

      <section className="how-it-works" id="how-it-works">
        <div className="section-title light">
          <span>04</span>
          <div><p className="overline">Not another travel chatbot</p><h2>Facts decide. AI explains.</h2></div>
        </div>
        <div className="principle-grid">
          <article><b>01</b><h3>Parse the mess</h3><p>AI turns rough notes into structured days, times, and candidate places.</p></article>
          <article><b>02</b><h3>Check the constraints</h3><p>Deterministic rules test geography, time, reservations, load, and freshness.</p></article>
          <article><b>03</b><h3>Explain every trade-off</h3><p>You see why something moved, what remains uncertain, and how to put it back.</p></article>
        </div>
      </section>

      <section className="trust-section" id="trust">
        <p className="overline">Built for earned trust</p>
        <h2>We would rather say “unverified” than invent certainty.</h2>
        <div className="trust-grid">
          <p><span>A</span><b>Verified constraints</b>Editorially checked attractions with a source and freshness date.</p>
          <p><span>B</span><b>Volatile places</b>Restaurants and shops stay soft warnings unless recently confirmed.</p>
          <p><span>C</span><b>Your unknowns</b>We keep unfamiliar places in the plan and label what we cannot yet prove.</p>
        </div>
      </section>

      <footer>
        <a className="brand inverse" href="#top">
          <span className="brand-mark">T<span>✓</span></span>
          <span>TripCheck<small>JAPAN</small></span>
        </a>
        <p>Working prototype · Tokyo only · Live data connection comes next.</p>
      </footer>
    </main>
  );
}

