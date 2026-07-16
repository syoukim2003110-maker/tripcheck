"use client";

import { useEffect, useMemo, useState } from "react";
import CinematicJourney from "./CinematicJourney";
import { copy, localeLabels, type Locale } from "../lib/i18n";
import { analyzeTrip, type Pace, type Severity } from "../lib/trip-analysis";

const localeOrder: Locale[] = ["en", "ja", "ko", "zh"];

const answerCopy: Record<Locale, {
  eyebrow: string;
  title: string;
  intro: string;
  items: Array<{ question: string; answer: string }>;
}> = {
  en: {
    eyebrow: "Direct answers",
    title: "Before you trust the plan.",
    intro: "TripCheck is a Tokyo itinerary checker: it tests whether the order, timing and fixed reservations in a draft can work in the real city.",
    items: [
      { question: "What does TripCheck Japan check?", answer: "It checks the joins between stops: cross-city travel, station walking, queues, timed-entry buffers, daily load and the energy cost of a long day." },
      { question: "How is it different from ChatGPT or Google Maps?", answer: "Those tools are strong at discovery and directions. TripCheck focuses on feasibility: it identifies the smallest change that protects your must-do places and explains every trade-off." },
      { question: "Does TripCheck replace my itinerary?", answer: "No. Confirmed tickets and must-do places become anchors. Flexible stops move around them, so the repair keeps your priorities instead of generating a different trip." },
      { question: "Is the current Tokyo checker live?", answer: "The current version is a free prototype using illustrative rules. Live opening hours, ticket inventory, weather and train routing are not connected yet." },
    ],
  },
  ja: {
    eyebrow: "端的な答え",
    title: "その旅程を信じる前に。",
    intro: "TripCheckは東京旅行の旅程チェッカーです。予定の順番、所要時間、固定予約が実際の街で成立するかを検査します。",
    items: [
      { question: "TripCheck Japanは何を検査しますか？", answer: "場所と場所のつなぎ目を検査します。東京横断、駅構内の徒歩、行列、時間指定予約の余白、一日の密度、長時間行動の体力負荷が対象です。" },
      { question: "ChatGPTやGoogle Mapsとの違いは？", answer: "発見や経路検索ではなく、旅程の成立判定に特化しています。行きたい場所を守れる最小限の変更を見つけ、すべての取捨を説明します。" },
      { question: "元の旅程は作り直されますか？", answer: "いいえ。確定チケットと必須の場所を軸にし、柔軟な候補だけを動かします。別の旅行を生成するのではなく、あなたの優先順位を残します。" },
      { question: "現在の東京チェッカーはライブデータ対応ですか？", answer: "現在は無料で試せるプロトタイプです。最新の営業時間、チケット在庫、天候、鉄道経路にはまだ接続していません。" },
    ],
  },
  ko: {
    eyebrow: "바로 답하기",
    title: "그 일정을 믿기 전에.",
    intro: "TripCheck는 도쿄 일정 검사기입니다. 순서, 이동 시간, 고정 예약이 실제 도시에서 가능한지 확인합니다.",
    items: [
      { question: "TripCheck Japan은 무엇을 확인하나요?", answer: "장소 사이의 연결을 확인합니다. 도쿄 횡단 이동, 역 내부 도보, 대기 줄, 예약 여유, 하루 밀도와 체력 부담을 봅니다." },
      { question: "ChatGPT나 Google Maps와 무엇이 다른가요?", answer: "발견이나 길찾기보다 일정의 실행 가능성에 집중합니다. 꼭 가고 싶은 장소를 지키는 가장 작은 수정을 찾고 모든 선택의 이유를 설명합니다." },
      { question: "원래 일정을 완전히 바꾸나요?", answer: "아닙니다. 확정 티켓과 필수 장소를 기준점으로 두고 유연한 후보만 옮겨 우선순위를 유지합니다." },
      { question: "현재 검사기는 실시간 데이터와 연결되나요?", answer: "현재는 무료 프로토타입입니다. 최신 영업시간, 티켓, 날씨, 철도 경로는 아직 연결되지 않았습니다." },
    ],
  },
  zh: {
    eyebrow: "直接回答",
    title: "在相信这份行程之前。",
    intro: "TripCheck是一款东京行程检查器，用来判断顺序、时间和固定预约能否在真实城市中成立。",
    items: [
      { question: "TripCheck Japan检查什么？", answer: "它检查景点之间的衔接：跨城移动、车站内步行、排队、预约缓冲、每日密度以及长时间活动的体力负担。" },
      { question: "它与ChatGPT或Google Maps有什么不同？", answer: "它不以发现或导航为核心，而专注于可执行性。它寻找能保留必去地点的最小修改，并解释每个取舍。" },
      { question: "它会完全替换原行程吗？", answer: "不会。已确认的门票和必去地点会成为锚点，只移动灵活的候选地点，从而保留你的优先级。" },
      { question: "当前检查器连接实时数据了吗？", answer: "当前是可免费试用的原型。最新营业时间、门票库存、天气和铁路路线尚未连接。" },
    ],
  },
};

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

export default function TripCheckApp({ initialLocale = "en" }: { initialLocale?: Locale }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [itinerary, setItinerary] = useState("");
  const [pace, setPace] = useState<Pace>("balanced");
  const [monthIndex, setMonthIndex] = useState(9);
  const [hasChecked, setHasChecked] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [navCompact, setNavCompact] = useState(false);
  const t = copy[locale];
  const answers = answerCopy[locale];

  const analysis = useMemo(
    () => (hasChecked ? analyzeTrip(itinerary, pace, locale) : null),
    [hasChecked, itinerary, locale, pace],
  );

  const characterCount = itinerary.length;
  const canCheck = itinerary.trim().length >= 30 && !isChecking;

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
    document.documentElement.classList.add("motion-ready");

    const update = () => {
      document.querySelectorAll<HTMLElement>(".reveal:not(.is-visible)").forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.top < window.innerHeight * 0.88 && rect.bottom > -80) {
          node.classList.add("is-visible");
        }
      });

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
      document.documentElement.classList.remove("motion-ready");
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  function changeLocale(nextLocale: Locale) {
    setLocale(nextLocale);
    try {
      window.localStorage.setItem("tripcheck-locale", nextLocale);
    } catch {
      // Language persistence is optional.
    }
    const nextPath = nextLocale === "en" ? "/" : `/${nextLocale}`;
    window.history.replaceState({}, "", `${nextPath}${window.location.hash}`);
  }

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
    <main className="experience" data-locale={locale} lang={locale === "zh" ? "zh-CN" : locale}>
      <header className={`global-nav ${navCompact ? "is-compact" : ""}`}>
        <a href="#top" aria-label="TripCheck Japan home"><Brand /></a>
        <nav aria-label="Main navigation">
          <a href="#method">{t.nav.method}</a>
          <a href="#trust">{t.nav.trust}</a>
        </nav>
        <label className="locale-switcher">
          <span className="sr-only">{t.languageLabel}</span>
          <select value={locale} onChange={(event) => changeLocale(event.target.value as Locale)} aria-label={t.languageLabel}>
            {localeOrder.map((option) => <option value={option} key={option}>{localeLabels[option]}</option>)}
          </select>
        </label>
      </header>

      <CinematicJourney locale={locale} t={t} />

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

      <section className="answer-section" id="trust">
        <header className="answer-heading reveal">
          <p className="section-eyebrow">07 / {answers.eyebrow}</p>
          <h2>{answers.title}</h2>
          <p>{answers.intro}</p>
        </header>
        <div className="answer-list">
          {answers.items.map((item, index) => (
            <article className="answer-row reveal" style={{ transitionDelay: `${index * 60}ms` }} key={item.question}>
              <span>0{index + 1}</span>
              <h3>{item.question}</h3>
              <p>{item.answer}</p>
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
