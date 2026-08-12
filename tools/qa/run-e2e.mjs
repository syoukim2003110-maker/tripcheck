/**
 * Executable slice of the v1.1 QA Matrix (rows that need no provider keys and
 * no real devices). Run with the dev server up:
 *
 *   QA_MODULES=…/node_modules node tools/qa/run-e2e.mjs
 *
 * Check inventory (this file — one standard invocation covers all of it):
 *   QA-002   start error + focus (ja/en)
 *   QA-008   ambiguity asks exactly once; choosing a candidate confirms
 *   QA-009   not-found row offers retry / edit / manual pin
 *   QA-011   manual coordinates confirm and reach the plan
 *   §5.2     must-unresolved requires an explicit continue
 *   QA-021   day tabs are a real tablist (roving tabindex, arrows, Home)
 *   QA-036   removing a must stop asks first
 *   QA-037   ordinary edit answers with toast + undo
 *   QA-043   recalculation announces politely (aria-live)
 *   QA-045   pointer targets ≥24px: start / resolve / plan @1440,
 *            plan @390 (mobile toggle + sticky rail), mobile sheet @390,
 *            desktop stop inspector
 *   TC-056   primary controls ≥44px effective target (start CTA, day tabs,
 *            mobile view toggle, recommendation accept buttons)
 *   DoD-A11Y-4  320×568 reflow: start / resolve / plan have no horizontal
 *               document scroll (disclosures open included)
 *   QA-042   keyboard-only main flow (see the section comment for what
 *            remains manual)
 *
 * Sibling runners (run them too — they are not covered by this file):
 *   QA_MODULES=… node tools/qa/run-axe.mjs   # QA-046/TC-057 WCAG 2.2 AA scan
 *   QA_MODULES=… node tools/qa/run-vr.mjs    # QA-054/TC-066 visual regression
 *
 * Exit code 1 when any check fails.
 */
import {
  ambiguityFixture,
  ambiguityInput,
  assertVisibleFocus,
  buildSamplePlan,
  clickByText,
  clickStartCtaUntil,
  foodRecommendationsFixture,
  gotoStart,
  launchBrowser,
  newPage,
  pressTabUntil,
  setWishlist,
  settle,
  unresolvedMustFixture,
  unresolvedMustInput,
  waitForText,
} from "./qa-lib.mjs";

const results = [];
function record(id, ok, note = "") {
  results.push({ id, ok, note });
  console.log(`${ok ? "PASS" : "FAIL"}  ${id}${note ? `  — ${note}` : ""}`);
}

async function expect(id, promise, note = "") {
  try {
    await promise;
    record(id, true, note);
  } catch (error) {
    record(id, false, `${note ? `${note}: ` : ""}${error?.message ?? error}`);
  }
}

/**
 * QA-045 / TC-056 shared audit: every visible interactive element inside
 * `scope` (default: whole document) must present a ≥24×24 CSS-px pointer
 * target. Throws with the violator list otherwise.
 */
async function auditTargets(page, label, { scope = null } = {}) {
  const violators = await page.evaluate((scopeSelector) => {
    const root = scopeSelector ? document.querySelector(scopeSelector) : document;
    if (!root) throw new Error(`audit scope "${scopeSelector}" not found`);
    const interactive = [...root.querySelectorAll("button, a[href], select, summary, input:not([type=hidden])")];
    const bad = [];
    for (const node of interactive) {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue; // hidden
      // Content slotted inside a closed <details> keeps a layout box in
      // Chrome; checkVisibility is the reliable "can a pointer hit this".
      if (typeof node.checkVisibility === "function" && !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const style = getComputedStyle(node);
      if (style.visibility === "hidden") continue;
      if (rect.height < 23.5 || rect.width < 23.5) {
        bad.push(`${node.tagName.toLowerCase()}.${[...node.classList].join(".")} ${Math.round(rect.width)}×${Math.round(rect.height)} "${(node.textContent ?? "").trim().slice(0, 28)}"`);
      }
    }
    return bad;
  }, scope);
  if (violators.length > 0) throw new Error(`${label}: ${violators.join(" | ")}`);
}

/**
 * TC-056: the enumerated PRIMARY controls must present a ≥44×44 CSS-px
 * pointer target. The measurement is the *effective* target: when the
 * layout box is smaller than 44px, the audit samples elementFromPoint
 * around the box, so an invisible hit-area extension (planner.css
 * `.planner-filler-actions button::after`) counts exactly as far as it
 * really receives clicks — remove the CSS and this fails. Every selector
 * must match at least one visible element, or the check fails: a primary
 * control that vanished is not a pass.
 */
async function auditPrimaryTargets(page, label, selectors) {
  const failures = await page.evaluate((sels) => {
    const bad = [];
    for (const sel of sels) {
      const nodes = [...document.querySelectorAll(sel)].filter((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        return typeof node.checkVisibility !== "function" || node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      });
      if (nodes.length === 0) {
        bad.push(`${sel}: no visible element to audit`);
        continue;
      }
      for (const node of nodes) {
        node.scrollIntoView({ block: "center", inline: "nearest" });
        const rect = node.getBoundingClientRect();
        if (rect.width >= 43.5 && rect.height >= 43.5) continue;
        const centerX = Math.min(Math.max(rect.left + rect.width / 2, 1), window.innerWidth - 1);
        const centerY = Math.min(Math.max(rect.top + rect.height / 2, 1), window.innerHeight - 1);
        const hits = (x, y) => {
          const hit = document.elementFromPoint(x, y);
          return hit === node || node.contains(hit);
        };
        let effectiveHeight = 0;
        for (let y = Math.floor(rect.top - 14); y <= Math.ceil(rect.bottom + 14); y += 1) if (hits(centerX, y)) effectiveHeight += 1;
        let effectiveWidth = 0;
        for (let x = Math.floor(rect.left - 14); x <= Math.ceil(rect.right + 14); x += 1) if (hits(x, centerY)) effectiveWidth += 1;
        if (effectiveHeight < 44 || effectiveWidth < 44) {
          bad.push(`${sel} → ${Math.round(rect.width)}×${Math.round(rect.height)} box, ${effectiveWidth}×${effectiveHeight} effective "${(node.textContent ?? "").trim().slice(0, 20)}"`);
        }
      }
    }
    return bad;
  }, selectors);
  if (failures.length > 0) throw new Error(`${label}: ${failures.join(" | ")}`);
}

const browser = await launchBrowser();
try {
  // --- QA-002: empty Start input answers with an inline error and focus. ---
  for (const locale of ["ja", "en"]) {
    const page = await newPage(browser);
    await gotoStart(page, locale);
    await expect(`QA-002 (${locale})`, (async () => {
      await clickStartCtaUntil(page, "#planner-start-error");
      const state = await page.evaluate(() => ({
        error: document.querySelector("#planner-start-error")?.textContent ?? "",
        focused: document.activeElement?.tagName === "TEXTAREA",
        described: document.activeElement?.getAttribute("aria-describedby") ?? "",
      }));
      if (!state.error.trim()) throw new Error("error text empty");
      if (!state.focused) throw new Error("textarea did not receive focus");
      if (!state.described.includes("planner-start-error")) throw new Error("aria-describedby not wired");
    })());
    await page.close();
  }

  // --- QA-008 / QA-009 / QA-011: the Resolve step. ---
  {
    const page = await newPage(browser, { fixtures: { placeResolution: ambiguityFixture("ja") } });
    await gotoStart(page, "ja");
    await setWishlist(page, ambiguityInput("ja"));
    await clickStartCtaUntil(page, ".planner-resolve-intro", { timeout: 6_000 });

    await expect("QA-008 ambiguity asks exactly once", (async () => {
      await waitForText(page, "#planner-reviewed-title", "場所を確認してください");
      const rows = await page.evaluate(() => [...document.querySelectorAll(".planner-resolved-places li")].map((li) => ({
        cls: li.className,
        question: li.querySelector(".planner-candidate-question") !== null,
        candidates: li.querySelectorAll(".planner-candidate-options button").length,
        name: li.querySelector("b")?.textContent ?? "",
      })));
      if (rows.length !== 3) throw new Error(`expected 3 rows, saw ${rows.length}`);
      if (!rows[0].cls.includes("is-confirmed") || rows[0].question) throw new Error("high-confidence row was interrupted");
      if (!rows[1].cls.includes("is-review") || rows[1].candidates !== 2) throw new Error("ambiguous row did not ask with 2 candidates");
      if (rows[2].question) throw new Error("not-found row rendered a candidate question");
    })());

    await expect("QA-009 not-found offers retry / edit / manual pin", (async () => {
      const offer = await page.evaluate(() => {
        const row = [...document.querySelectorAll(".planner-resolved-places li")][2];
        const text = row?.textContent ?? "";
        return {
          note: text.includes("この場所だけ見つかりませんでした"),
          retry: text.includes("もう一度探す"),
          edit: text.includes("入力を直す"),
          pin: text.includes("地図で場所を指定する"),
        };
      });
      for (const [key, ok] of Object.entries(offer)) if (!ok) throw new Error(`missing offer: ${key}`);
    })());

    await expect("QA-008 choosing a candidate confirms the row", (async () => {
      await clickByText(page, ".planner-candidate-options button", "リギ・クルム");
      await page.waitForFunction(() => {
        const row = [...document.querySelectorAll(".planner-resolved-places li")][1];
        return row?.className.includes("is-confirmed") && !row.querySelector(".planner-candidate-question");
      }, { timeout: 5_000 });
    })());

    await expect("QA-011 manual coordinates confirm the place", (async () => {
      await page.evaluate(() => {
        const row = [...document.querySelectorAll(".planner-resolved-places li")][2];
        row.querySelector(".planner-manual-place").open = true;
      });
      const inputs = await page.$$(".planner-resolved-places li:nth-child(3) .planner-manual-place input");
      if (inputs.length < 3) throw new Error(`expected address+lat+lng inputs, saw ${inputs.length}`);
      await inputs[0].type("Luzern old town");
      await inputs[1].type("47.0512");
      await inputs[2].type("8.3068");
      await clickByText(page, ".planner-manual-place > button", "この地点を使う");
      await page.waitForFunction(() => {
        const row = [...document.querySelectorAll(".planner-resolved-places li")][2];
        return row?.className.includes("is-confirmed");
      }, { timeout: 5_000 });
    })());

    await expect("QA-011 manual place appears in the plan", (async () => {
      await waitForText(page, ".planner-build-button", "3か所で続ける");
      await clickByText(page, ".planner-build-button", "続ける");
      await page.waitForSelector(".trip-planner-app.is-result", { timeout: 30_000 });
      await settle(page, 800);
      // The timeline shows one day at a time; the manual pin may be scheduled
      // on any of them.
      const found = await page.evaluate(async (needle) => {
        const dayTabs = [...document.querySelectorAll(".planner-day-tabs button")];
        const visible = () => [...document.querySelectorAll(".planner-stop-row b")].some((node) => (node.textContent ?? "").includes(needle));
        if (visible()) return true;
        for (const tab of dayTabs) {
          tab.click();
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
          if (visible()) return true;
        }
        return false;
      }, "謎の食堂ゾルバ");
      if (!found) throw new Error("manual pin not scheduled on any day");
    })());
    await page.close();
  }

  // --- §5.2: continuing past an unconfirmed Must asks for a decision. ---
  {
    const page = await newPage(browser, { fixtures: { placeResolution: unresolvedMustFixture("ja") } });
    await gotoStart(page, "ja");
    await setWishlist(page, unresolvedMustInput("ja"));
    await clickStartCtaUntil(page, ".planner-resolve-intro", { timeout: 6_000 });
    await expect("§5.2 must-unresolved requires explicit continue", (async () => {
      await clickByText(page, ".planner-build-button", "か所で続ける");
      await page.waitForSelector(".planner-confirm-dialog", { timeout: 5_000 });
      const dialog = await page.evaluate(() => ({
        title: document.querySelector("#planner-confirm-title")?.textContent ?? "",
        focusOnCancel: document.activeElement?.textContent ?? "",
        conflict: document.querySelector("#planner-confirm-conflicts")?.textContent ?? "",
      }));
      if (!dialog.title.includes("必須・予約の場所が未確認のままです")) throw new Error(`title: ${dialog.title}`);
      if (!dialog.conflict.includes("リギ山")) throw new Error("conflict does not name the place");
      if (!dialog.focusOnCancel.includes("もどって確認する")) throw new Error("safe choice not focused");
      await clickByText(page, ".planner-confirm-dialog button", "もどって確認する");
      await page.waitForFunction(() => !document.querySelector(".planner-confirm-dialog"), { timeout: 5_000 });
      await clickByText(page, ".planner-build-button", "か所で続ける");
      await page.waitForSelector(".planner-confirm-dialog", { timeout: 5_000 });
      await clickByText(page, ".planner-confirm-dialog button", "このまま続ける");
      await page.waitForSelector(".trip-planner-app.is-result", { timeout: 30_000 });
    })());
    await page.close();
  }

  // --- Sample plan: QA-021, QA-036, QA-037, QA-043. ---
  sample: {
    const page = await newPage(browser);
    try {
      await buildSamplePlan(page, "ja");
      record("sample builds a finished example", true);
    } catch (error) {
      record("sample builds a finished example", false, String(error?.message ?? error));
      await page.close();
      break sample;
    }

    await expect("QA-043 recalculation announces politely", (async () => {
      await page.waitForFunction(() => [...document.querySelectorAll(".sr-only [aria-live=\"polite\"], .sr-only[aria-live=\"polite\"], p[aria-live=\"polite\"]")]
        .some((node) => (node.textContent ?? "").includes("旅程ができました")), { timeout: 10_000 });
      const assertive = await page.evaluate(() => document.querySelectorAll("[aria-live=\"assertive\"]").length);
      if (assertive === 0) throw new Error("assertive region missing");
    })());

    await expect("QA-021 day tabs expose selection", (async () => {
      // DoD-A11Y-5 / §12.3: the switcher is a real WAI-ARIA tablist — roving
      // tabindex, aria-selected (aria-current is gone), aria-controls to the
      // labelled tabpanel, and arrow keys move the selection (automatic
      // activation: selection follows focus).
      const semantics = await page.evaluate(() => {
        const list = document.querySelector(".planner-day-tabs");
        const tabs = [...(list?.querySelectorAll("[role=\"tab\"]") ?? [])];
        const panel = document.getElementById("planner-day-panel");
        return {
          listRole: list?.getAttribute("role") ?? null,
          tabCount: tabs.length,
          selectedCount: tabs.filter((tab) => tab.getAttribute("aria-selected") === "true").length,
          controlsPanel: tabs.length > 0 && tabs.every((tab) => tab.getAttribute("aria-controls") === "planner-day-panel"),
          rovingOk: tabs.filter((tab) => tab.tabIndex === 0).length === 1
            && tabs.every((tab) => tab.tabIndex === 0 || tab.tabIndex === -1),
          hasAriaCurrent: tabs.some((tab) => tab.hasAttribute("aria-current")),
          panelRole: panel?.getAttribute("role") ?? null,
          panelLabelledBy: panel?.getAttribute("aria-labelledby") ?? null,
        };
      });
      if (semantics.listRole !== "tablist") throw new Error(`day switcher role is ${semantics.listRole}, not tablist`);
      if (semantics.tabCount < 2) throw new Error(`only ${semantics.tabCount} day tabs`);
      if (semantics.selectedCount !== 1) throw new Error(`${semantics.selectedCount} tabs claim aria-selected`);
      if (!semantics.controlsPanel) throw new Error("tabs do not aria-controls the day panel");
      if (!semantics.rovingOk) throw new Error("roving tabindex is broken");
      if (semantics.hasAriaCurrent) throw new Error("aria-current lingers; aria-selected owns selection");
      if (semantics.panelRole !== "tabpanel") throw new Error(`day panel role is ${semantics.panelRole}, not tabpanel`);
      if (!semantics.panelLabelledBy) throw new Error("tabpanel is not aria-labelledby a tab");

      // Clicking a tab selects it and relabels the panel from that tab.
      const tabs = await page.$$(".planner-day-tabs [role=\"tab\"]");
      await tabs[1].click();
      await page.waitForFunction(() => {
        const buttons = [...document.querySelectorAll(".planner-day-tabs [role=\"tab\"]")];
        return buttons[1]?.getAttribute("aria-selected") === "true"
          && document.getElementById("planner-day-panel")?.getAttribute("aria-labelledby") === buttons[1]?.id;
      }, { timeout: 5_000 });

      // ArrowRight moves both focus and selection; Home returns to day 1.
      await tabs[1].focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(() => {
        const buttons = [...document.querySelectorAll(".planner-day-tabs [role=\"tab\"]")];
        const expected = buttons.length > 2 ? 2 : 0;
        return buttons[expected]?.getAttribute("aria-selected") === "true"
          && document.activeElement === buttons[expected];
      }, { timeout: 5_000 });
      await page.keyboard.press("Home");
      await page.waitForFunction(() => {
        const buttons = [...document.querySelectorAll(".planner-day-tabs [role=\"tab\"]")];
        return buttons[0]?.getAttribute("aria-selected") === "true"
          && document.getElementById("planner-day-panel")?.getAttribute("aria-labelledby") === buttons[0]?.id;
      }, { timeout: 5_000 });
    })());

    await expect("QA-037 ordinary edit answers with toast + undo", (async () => {
      // The move may switch the visible day; judge undo on the original tab.
      const dayOne = async () => {
        await page.evaluate(() => document.querySelectorAll(".planner-day-tabs button")[0]?.click());
        await settle(page, 350);
      };
      await dayOne();
      const stops = async () => page.evaluate(() => [...document.querySelectorAll(".planner-stop-row b")].map((node) => node.textContent ?? ""));
      const before = await stops();
      await page.click(".planner-stop-row");
      await page.waitForSelector(".planner-inspector .planner-day-move button", { timeout: 10_000 });
      const moved = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll(".planner-inspector .planner-day-move button")];
        const target = buttons.find((button) => button.getAttribute("aria-pressed") !== "true" && !button.disabled);
        if (!target) return false;
        target.click();
        return true;
      });
      if (!moved) throw new Error("no enabled day-move target");
      await page.waitForSelector(".planner-edit-toast", { timeout: 6_000 });
      await waitForText(page, ".planner-edit-toast", "元に戻す", { timeout: 3_000 });
      // Copy Deck toast.changed: 「N日目に移動しました・余裕 ±X分」 — the metric
      // is the buffer (余裕) change from the simulated plan, never travel.
      const toast = await page.evaluate(() => ({
        message: document.querySelector(".planner-edit-toast span")?.textContent ?? "",
        detail: document.querySelector(".planner-edit-toast small")?.textContent ?? "",
      }));
      if (!/日目に移動しました/.test(toast.message)) throw new Error(`toast message: ${toast.message}`);
      if (toast.detail && !/^余裕 [+−]\d+分$/.test(toast.detail)) throw new Error(`toast metric must be 余裕: ${toast.detail}`);
      await clickByText(page, ".planner-edit-toast button", "元に戻す");
      await settle(page, 500);
      await dayOne();
      const after = await stops();
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`undo did not restore day 1 (${before.join("/")} → ${after.join("/")})`);
    })());

    await expect("QA-036 removing a must stop asks first", (async () => {
      // The must stop can be scheduled on any day; walk the tabs to find it.
      const opened = await page.evaluate(async () => {
        const tabs = [...document.querySelectorAll(".planner-day-tabs button")];
        for (const tab of tabs) {
          tab.click();
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
          const row = [...document.querySelectorAll(".planner-stop-row")]
            .find((candidate) => candidate.querySelector(".planner-stop-flags .is-must, .planner-stop-flags .is-booked"));
          if (row) {
            row.click();
            return true;
          }
        }
        return false;
      });
      if (!opened) throw new Error("no must/booked stop in the sample");
      await page.waitForSelector(".planner-inspector .planner-remove-stop", { timeout: 10_000 });
      await page.click(".planner-inspector .planner-remove-stop");
      await page.waitForSelector(".planner-confirm-dialog", { timeout: 5_000 });
      await clickByText(page, ".planner-confirm-dialog button", "変更しない");
      await page.waitForFunction(() => !document.querySelector(".planner-confirm-dialog"), { timeout: 5_000 });
    })());

    await page.close();
  }

  // --- QA-045 / TC-056: pointer-target audits. ---
  // 24×24 CSS px is the hard floor for EVERY interactive element (WCAG 2.5.8),
  // on start / resolve / plan at 1440, on the plan at 390×844 (mobile view
  // toggle + sticky day rail), inside the mobile bottom sheet, and inside the
  // desktop stop inspector. On top of that, TC-056 raises the floor to a
  // ≥44×44 *effective* target for the enumerated PRIMARY controls:
  //   .planner-review-button                                (start CTA 旅程をつくる)
  //   .planner-day-tabs [role="tab"]                        (plan-view day tabs)
  //   .planner-mobile-result-toggle button                  (mobile 旅程/地図/地図を隠す toggle, ≤900px only)
  //   .planner-meal-row .planner-filler-actions button:first-child
  //                                                         (recommendation accept ここにする / meal + gap rows)
  {
    const page = await newPage(browser, { fixtures: { placeResolution: ambiguityFixture("ja") } });
    await gotoStart(page, "ja");
    await expect("QA-045 start targets ≥24px", auditTargets(page, "start"));
    await expect("TC-056 primary targets ≥44px (start CTA, 1440)", auditPrimaryTargets(page, "start-1440", [".planner-review-button"]));
    await setWishlist(page, ambiguityInput("ja"));
    await clickStartCtaUntil(page, ".planner-resolve-intro", { timeout: 6_000 });
    await expect("QA-045 resolve targets ≥24px", auditTargets(page, "resolve"));
    await page.close();

    const startMobile = await newPage(browser, { width: 390, height: 844 });
    await gotoStart(startMobile, "ja");
    await expect("TC-056 primary targets ≥44px (start CTA, 390)", auditPrimaryTargets(startMobile, "start-390", [".planner-review-button"]));
    await startMobile.close();

    // The desktop plan: whole-document 24px floor, the primary 44px set, and
    // the stop-inspector panel once it is open. The food fixture gives every
    // meal slot a real accept button (ここにする) to measure.
    const planPage = await newPage(browser, { fixtures: { foodRecommendations: foodRecommendationsFixture("ja") } });
    await buildSamplePlan(planPage, "ja");
    await waitForText(planPage, ".planner-filler-actions button", "ここにする", { timeout: 15_000 });
    await expect("QA-045 plan targets ≥24px", auditTargets(planPage, "plan"));
    await expect("TC-056 primary targets ≥44px (plan 1440: day tabs, meal accept)", auditPrimaryTargets(planPage, "plan-1440", [
      ".planner-day-tabs [role=\"tab\"]",
      ".planner-meal-row .planner-filler-actions button:first-child",
    ]));
    await expect("QA-045 desktop inspector targets ≥24px", (async () => {
      await planPage.click(".planner-stop-row");
      await planPage.waitForSelector(".planner-inspector", { timeout: 10_000 });
      await settle(planPage, 400);
      await auditTargets(planPage, "inspector", { scope: ".planner-inspector" });
    })());
    await planPage.close();

    // The 390×844 plan: same 24px floor across the document (this is where
    // the mobile view toggle and the sticky day rail live), the primary 44px
    // set, and the bottom sheet's own controls after opening a stop.
    const mobilePlan = await newPage(browser, { width: 390, height: 844, fixtures: { foodRecommendations: foodRecommendationsFixture("ja") } });
    await buildSamplePlan(mobilePlan, "ja");
    await waitForText(mobilePlan, ".planner-filler-actions button", "ここにする", { timeout: 15_000 });
    await expect("QA-045 plan targets ≥24px (390px mobile)", auditTargets(mobilePlan, "plan-390"));
    await expect("TC-056 primary targets ≥44px (plan 390: day tabs, view toggle, meal accept)", auditPrimaryTargets(mobilePlan, "plan-390", [
      ".planner-day-tabs [role=\"tab\"]",
      ".planner-mobile-result-toggle button",
      ".planner-meal-row .planner-filler-actions button:first-child",
    ]));
    await expect("QA-045 mobile sheet targets ≥24px", (async () => {
      await mobilePlan.click(".planner-stop-row");
      await mobilePlan.waitForSelector(".planner-inspector", { timeout: 10_000 });
      await settle(mobilePlan, 400);
      await auditTargets(mobilePlan, "sheet-390", { scope: ".planner-inspector" });
    })());
    // §9.3 makes the sheet's three explicit controls the non-drag way to
    // operate it, and §11.3 puts phone primaries at 44px.
    await expect("TC-056 primary targets ≥44px (mobile sheet controls)", auditPrimaryTargets(mobilePlan, "sheet-390", [
      ".planner-inspector-close",
      ".planner-inspector-collapse",
      ".planner-inspector-expand",
    ]));
    await mobilePlan.close();

    // Copy Deck toast.undo is a primary action and the toast is fixed to the
    // bottom edge on phones. Measured in EN too: the audits above all run in
    // ja, where every label is narrower.
    for (const locale of ["ja", "en"]) {
      const undoPage = await newPage(browser, { width: 390, height: 844, fixtures: { foodRecommendations: foodRecommendationsFixture(locale) } });
      await expect(`TC-056 primary targets ≥44px (undo in the edit toast, ${locale})`, (async () => {
        await buildSamplePlan(undoPage, locale);
        await waitForText(undoPage, ".planner-filler-actions button", locale === "ja" ? "ここにする" : "Add this", { timeout: 15_000 });
        await clickByText(undoPage, ".planner-meal-row .planner-filler-actions button", locale === "ja" ? "ここにする" : "Add this");
        await undoPage.waitForSelector(".planner-edit-toast button", { timeout: 10_000 });
        await settle(undoPage, 300);
        await auditPrimaryTargets(undoPage, `toast-390-${locale}`, [".planner-edit-toast button"]);
      })());
      await undoPage.close();
    }

    // The plan's own primaries, measured with the wider English labels.
    const planEn = await newPage(browser, { fixtures: { foodRecommendations: foodRecommendationsFixture("en") } });
    await expect("TC-056 primary targets ≥44px (plan 1440, en labels)", (async () => {
      await buildSamplePlan(planEn, "en");
      await waitForText(planEn, ".planner-filler-actions button", "Add this", { timeout: 15_000 });
      await auditPrimaryTargets(planEn, "plan-1440-en", [
        ".planner-day-tabs [role=\"tab\"]",
        ".planner-meal-row .planner-filler-actions button:first-child",
      ]);
    })());
    await planEn.close();
  }

  // --- DoD-A11Y-4: 320×568 reflow — no horizontal document scroll. ---
  // The document-level assertion covers everything visible at 320: in the
  // mobile timeline view the map pane (the only spec-exempt surface) is not
  // rendered in the document flow, so no scoping is needed. Disclosures are
  // opened first (input examples, advanced options, manual pin) because
  // that is where fixed-width regressions historically hide.
  {
    const assertNoHorizontalScroll = async (page, label) => {
      const state = await page.evaluate(() => ({
        scrollWidth: document.scrollingElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      if (state.scrollWidth > state.innerWidth + 1) {
        throw new Error(`${label}: document scrollWidth ${state.scrollWidth} exceeds viewport ${state.innerWidth}`);
      }
    };

    const page = await newPage(browser, { width: 320, height: 568, fixtures: { placeResolution: ambiguityFixture("ja") } });
    await gotoStart(page, "ja");
    await expect("DoD-A11Y-4 320px start reflows with no horizontal scroll", (async () => {
      await assertNoHorizontalScroll(page, "start-320");
      await page.evaluate(() => { for (const details of document.querySelectorAll(".trip-planner-app details")) details.open = true; });
      await settle(page, 300);
      await assertNoHorizontalScroll(page, "start-320 (disclosures open)");
    })());
    await expect("DoD-A11Y-4 320px resolve reflows with no horizontal scroll", (async () => {
      await setWishlist(page, ambiguityInput("ja"));
      await clickStartCtaUntil(page, ".planner-resolve-intro", { timeout: 6_000 });
      await assertNoHorizontalScroll(page, "resolve-320");
      await page.evaluate(() => { for (const details of document.querySelectorAll(".planner-resolved-places details")) details.open = true; });
      await settle(page, 300);
      await assertNoHorizontalScroll(page, "resolve-320 (manual pin open)");
    })());
    await page.close();

    const planPage = await newPage(browser, { width: 320, height: 568 });
    await expect("DoD-A11Y-4 320px plan reflows with no horizontal scroll", (async () => {
      await buildSamplePlan(planPage, "ja");
      await assertNoHorizontalScroll(planPage, "plan-320");
    })());
    await planPage.close();
  }

  // --- QA-042 / DoD-A11Y-2: keyboard-only main flow. ---
  // Every step below uses page.keyboard only (Tab / Shift+Tab / Enter /
  // Arrows / Escape) — no mouse, tap or programmatic .focus(). At each
  // asserted step document.activeElement must be the expected control AND
  // carry a visible focus indicator (computed outline/box-shadow — the
  // planner.css :focus-visible rule).
  //
  // Automated here: start → sample build (Enter on 30秒で完成例を見る), day
  // tablist arrows, meal-recommendation accept (fixture-backed ここにする →
  // toast), share dialog open / focus trap / Escape close / focus return,
  // and Cmd/Ctrl+Enter submitting the start form into the (fixture-backed)
  // Resolve step.
  //
  // Still MANUAL for QA-042 sign-off:
  //   - real place entry against live providers (resolution quality needs
  //     Google keys; here the Resolve step is fixture-fed),
  //   - gap-row accept (route recommendations need a live route provider —
  //     only the meal accept is fixtured),
  //   - the share dialog's actual clipboard copy (clipboard permission),
  //   - bottom-sheet keyboard operation on a real phone (peek/half/full)
  //     and map-pane keyboard operation,
  //   - visual (screenshot-level) confirmation of the focus ring — this
  //     harness proves its computed presence, not its rendered contrast.
  keyboard: {
    const page = await newPage(browser, { fixtures: { foodRecommendations: foodRecommendationsFixture("ja") } });
    await gotoStart(page, "ja");
    await settle(page, 700); // hydration must own the handlers before we type

    await expect("QA-042 keyboard start: textarea focus + sample link reachable", (async () => {
      // The textarea autofocuses; if a hydration race dropped that, Tab must
      // still reach it — either way keyboard-only.
      const focused = await page.evaluate(() => document.activeElement?.tagName === "TEXTAREA");
      if (!focused) await pressTabUntil(page, () => document.activeElement?.tagName === "TEXTAREA", { max: 30, label: "start textarea" });
      await assertVisibleFocus(page, "start textarea");
      await pressTabUntil(page, () => document.activeElement?.classList?.contains("planner-sample-link"), { max: 60, label: "sample link (30秒で完成例を見る)" });
      await assertVisibleFocus(page, "sample link");
    })());

    let planReady = false;
    await expect("QA-042 keyboard Enter builds the sample plan", (async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await page.keyboard.press("Enter");
        try {
          await page.waitForSelector(".trip-planner-app.is-result", { timeout: 4_000 });
          break;
        } catch {
          // Hydration retry — walk focus back onto the link if a re-render moved it.
          const onLink = await page.evaluate(() => document.activeElement?.classList?.contains("planner-sample-link"));
          if (!onLink) await pressTabUntil(page, () => document.activeElement?.classList?.contains("planner-sample-link"), { max: 60, label: "sample link" }).catch(() => {});
        }
      }
      await page.waitForSelector(".trip-planner-app.is-result", { timeout: 30_000 });
      await page.waitForSelector(".planner-day-tabs [role=\"tab\"]", { timeout: 30_000 });
      await waitForText(page, ".planner-filler-actions button", "ここにする", { timeout: 15_000 });
      await settle(page, 400);
      planReady = true;
    })());
    if (!planReady) { await page.close(); break keyboard; }

    await expect("QA-042 arrow keys drive the day tablist", (async () => {
      await pressTabUntil(page, () => document.activeElement?.getAttribute?.("role") === "tab" && !!document.activeElement.closest(".planner-day-tabs"), { max: 100, label: "day tab" });
      await assertVisibleFocus(page, "day tab");
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(() => {
        const tabs = [...document.querySelectorAll(".planner-day-tabs [role=\"tab\"]")];
        const index = tabs.indexOf(document.activeElement);
        return index === 1
          && tabs[1]?.getAttribute("aria-selected") === "true"
          && document.getElementById("planner-day-panel")?.getAttribute("aria-labelledby") === tabs[1]?.id;
      }, { timeout: 5_000 });
      await page.keyboard.press("Home");
      await page.waitForFunction(() => {
        const tabs = [...document.querySelectorAll(".planner-day-tabs [role=\"tab\"]")];
        return document.activeElement === tabs[0] && tabs[0]?.getAttribute("aria-selected") === "true";
      }, { timeout: 5_000 });
    })());

    await expect("QA-042 keyboard accepts a meal recommendation (toast)", (async () => {
      await pressTabUntil(page, () => {
        const active = document.activeElement;
        return !!active && (active.textContent ?? "") === "ここにする" && !!active.closest(".planner-filler-actions");
      }, { max: 200, label: "meal accept button (ここにする)" });
      await assertVisibleFocus(page, "meal accept button");
      await page.keyboard.press("Enter");
      await page.waitForSelector(".planner-edit-toast", { timeout: 6_000 });
      await waitForText(page, ".planner-edit-toast", "旅程に追加しました", { timeout: 3_000 });
      const hasUndo = await page.evaluate(() => [...document.querySelectorAll(".planner-edit-toast button")].some((button) => (button.textContent ?? "").includes("元に戻す")));
      if (!hasUndo) throw new Error("accept toast offers no undo");
    })());

    await expect("QA-042 keyboard opens and closes the share dialog", (async () => {
      // The accept re-render decides where focus survived; walk toward the
      // result menu in whichever direction is shorter from there.
      const inTimeline = await page.evaluate(() => !!document.activeElement?.closest?.(".planner-sheet, .planner-timeline, .planner-day-panel, #planner-day-panel"));
      const summaryFocused = () => document.activeElement?.tagName === "SUMMARY" && !!document.activeElement.closest(".planner-result-menu");
      await pressTabUntil(page, summaryFocused, { max: 300, shift: inTimeline, label: "result menu summary" });
      await assertVisibleFocus(page, "result menu summary");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector(".planner-result-menu")?.open === true, { timeout: 3_000 });
      await pressTabUntil(page, () => {
        const active = document.activeElement;
        return active?.tagName === "BUTTON" && !!active.closest(".planner-result-menu") && (active.textContent ?? "").includes("共有");
      }, { max: 10, label: "share button" });
      await assertVisibleFocus(page, "share button");
      await page.keyboard.press("Enter");
      await page.waitForSelector(".planner-share-dialog", { timeout: 5_000 });
      // Focus must move INTO the dialog, and Tab must stay trapped inside.
      await page.waitForFunction(() => {
        const dialog = document.querySelector(".planner-share-dialog");
        return !!dialog && dialog.contains(document.activeElement);
      }, { timeout: 5_000 });
      await page.keyboard.press("Tab");
      const trapped = await page.evaluate(() => !!document.querySelector(".planner-share-dialog")?.contains(document.activeElement));
      if (!trapped) throw new Error("Tab escaped the share dialog");
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector(".planner-share-dialog"), { timeout: 5_000 });
      // Focus returns to the triggering share button (dialog contract).
      await page.waitForFunction(() => {
        const active = document.activeElement;
        return active?.tagName === "BUTTON" && !!active.closest(".planner-result-menu") && (active.textContent ?? "").includes("共有");
      }, { timeout: 5_000 });
    })());
    await page.close();
  }

  // --- QA-042 addendum: Cmd/Ctrl+Enter submits the start form. ---
  // Typed keylessly against the resolution fixture: the shortcut must land
  // the traveller on the Resolve step, proving keyboard submit end to end.
  {
    const page = await newPage(browser, { fixtures: { placeResolution: ambiguityFixture("ja") } });
    await gotoStart(page, "ja");
    await expect("QA-042 Cmd/Ctrl+Enter submits the start form", (async () => {
      await settle(page, 700);
      const focused = await page.evaluate(() => document.activeElement?.tagName === "TEXTAREA");
      if (!focused) await pressTabUntil(page, () => document.activeElement?.tagName === "TEXTAREA", { max: 30, label: "start textarea" });
      const wanted = ambiguityInput("ja");
      const selectAllKey = process.platform === "darwin" ? "Meta" : "Control";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await page.keyboard.type(wanted);
        const value = await page.evaluate(() => document.querySelector(".trip-planner-app textarea")?.value ?? "");
        if (value === wanted) break;
        // Keystrokes landed before hydration: clear by keyboard and retype.
        await page.keyboard.down(selectAllKey);
        await page.keyboard.press("KeyA");
        await page.keyboard.up(selectAllKey);
        await page.keyboard.press("Backspace");
      }
      const typed = await page.evaluate(() => document.querySelector(".trip-planner-app textarea")?.value ?? "");
      if (typed !== wanted) throw new Error(`typed value mismatch: ${JSON.stringify(typed)}`);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await page.keyboard.down("Control");
        await page.keyboard.press("Enter");
        await page.keyboard.up("Control");
        try {
          await page.waitForSelector(".planner-resolve-intro", { timeout: 3_000 });
          break;
        } catch { /* hydration retry */ }
      }
      await page.waitForSelector(".planner-resolve-intro", { timeout: 3_000 });
      await waitForText(page, "#planner-reviewed-title", "場所を確認してください");
    })());

    // DoD-A11Y-2: the same run continues THROUGH Resolve into the plan without
    // a mouse — choosing the ambiguous candidate and pressing the continue CTA
    // by keyboard. Until this existed, the only keyboard path to a plan was
    // the sample link, which skips Resolve entirely.
    await expect("QA-042 keyboard continues from Resolve into the plan", (async () => {
      await pressTabUntil(
        page,
        () => document.activeElement?.closest(".planner-candidate-options") !== null
          && (document.activeElement?.textContent ?? "").includes("リギ・クルム"),
        { max: 60, label: "ambiguous candidate option" },
      );
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () => document.querySelectorAll(".planner-candidate-options").length === 0,
        { timeout: 10_000 },
      );
      await pressTabUntil(
        page,
        () => document.activeElement?.classList.contains("planner-build-button") === true,
        { max: 60, label: "resolve continue CTA" },
      );
      await page.keyboard.press("Enter");
      await page.waitForSelector(".trip-planner-app.is-result", { timeout: 30_000 });
    })());
    await page.close();
  }

  // --- DoD-A11Y-5: the timeline is a real list for screen readers. ---
  // planner.css removes the markers, which drops list semantics in Safari and
  // VoiceOver unless the role is explicit — that is where "item N of M in this
  // day" comes from.
  {
    const page = await newPage(browser);
    await expect("DoD-A11Y-5 the day timeline exposes list semantics", (async () => {
      await buildSamplePlan(page, "ja");
      await settle(page, 400);
      const semantics = await page.evaluate(() => {
        const list = document.querySelector(".planner-timeline");
        const panel = document.getElementById("planner-day-panel");
        return {
          role: list?.getAttribute("role") ?? null,
          label: list?.getAttribute("aria-label") ?? "",
          items: list ? [...list.children].filter((node) => node.tagName === "LI").length : 0,
          stops: document.querySelectorAll(".planner-stop-row").length,
          insidePanel: Boolean(panel && list && panel.contains(list)),
        };
      });
      if (semantics.role !== "list") throw new Error(`timeline role: ${semantics.role}`);
      if (!semantics.label.includes("行程")) throw new Error(`timeline label: ${semantics.label}`);
      if (semantics.items < semantics.stops) throw new Error(`list items ${semantics.items} < stops ${semantics.stops}`);
      if (!semantics.insidePanel) throw new Error("the timeline is not inside the day tabpanel");
    })());
    await page.close();
  }

  // --- Definition of Done: first view + 200% zoom. ---
  // DoD-START-4 「CTAが1280×800と390×844で見える」 and DoD-PLAN-1 「最初の2地点
  // がファーストビューに見える」 are *without scrolling* claims, so they are
  // measured as "the element's box finishes inside the initial viewport".
  // DoD-A11Y-3 「200% zoomで機能欠損なし」 is modelled the way a browser
  // actually zooms: 1280×800 at 200% is a 640×400 CSS-px viewport at
  // devicePixelRatio 2.
  {
    const assertInFirstView = async (page, selector, index, label) => {
      const box = await page.evaluate((sel, n) => {
        const node = document.querySelectorAll(sel)[n];
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: rect.height, viewport: window.innerHeight };
      }, selector, index);
      if (!box) throw new Error(`${label}: ${selector}[${index}] not rendered`);
      if (box.height < 1) throw new Error(`${label}: ${selector}[${index}] has no box`);
      if (box.top < 0 || box.bottom > box.viewport + 1) {
        throw new Error(`${label}: ${selector}[${index}] spans ${Math.round(box.top)}–${Math.round(box.bottom)} in a ${box.viewport}px viewport`);
      }
    };

    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      const label = `${viewport.width}×${viewport.height}`;
      const startPage = await newPage(browser, viewport);
      await expect(`DoD-START-4 start CTA sits in the first view (${label})`, (async () => {
        await gotoStart(startPage, "ja");
        await settle(startPage, 400);
        await assertInFirstView(startPage, ".planner-review-button", 0, `start-${label}`);
      })());
      await startPage.close();

      const planPage = await newPage(browser, viewport);
      await expect(`DoD-PLAN-1 first two stops sit in the first view (${label})`, (async () => {
        await buildSamplePlan(planPage, "ja");
        await settle(planPage, 500);
        await assertInFirstView(planPage, ".planner-stop-row", 0, `plan-${label}`);
        await assertInFirstView(planPage, ".planner-stop-row", 1, `plan-${label}`);
      })());
      await planPage.close();
    }

    const zoomed = await newPage(browser, { width: 640, height: 400, deviceScaleFactor: 2 });
    await expect("DoD-A11Y-3 200% zoom keeps the start CTA and reflow intact", (async () => {
      await gotoStart(zoomed, "ja");
      await settle(zoomed, 400);
      await assertInFirstView(zoomed, ".planner-review-button", 0, "start-200%");
      const state = await zoomed.evaluate(() => ({
        scrollWidth: document.scrollingElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      if (state.scrollWidth > state.innerWidth + 1) {
        throw new Error(`start-200%: document scrollWidth ${state.scrollWidth} exceeds viewport ${state.innerWidth}`);
      }
    })());
    await expect("DoD-A11Y-3 200% zoom keeps the plan usable", (async () => {
      await buildSamplePlan(zoomed, "ja");
      await settle(zoomed, 500);
      await assertInFirstView(zoomed, ".planner-stop-row", 0, "plan-200%");
      const state = await zoomed.evaluate(() => ({
        scrollWidth: document.scrollingElement.scrollWidth,
        innerWidth: window.innerWidth,
        tabs: document.querySelectorAll(".planner-day-tabs [role=\"tab\"]").length,
        stops: document.querySelectorAll(".planner-stop-row").length,
      }));
      if (state.scrollWidth > state.innerWidth + 1) {
        throw new Error(`plan-200%: document scrollWidth ${state.scrollWidth} exceeds viewport ${state.innerWidth}`);
      }
      if (state.tabs < 1 || state.stops < 1) {
        throw new Error(`plan-200%: day rail/timeline missing (tabs ${state.tabs}, stops ${state.stops})`);
      }
    })());
    await zoomed.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
