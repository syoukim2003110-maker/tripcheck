/**
 * Executable slice of the v1.1 QA Matrix (rows that need no provider keys and
 * no real devices). Run with the dev server up:
 *
 *   QA_MODULES=…/node_modules node tools/qa/run-e2e.mjs
 *
 * Covered rows: QA-002 (start error), QA-008 (ambiguity asks once), QA-009
 * (not-found row offers retry / edit / manual pin), QA-011 (manual coordinates
 * reach the plan), §5.2 must-confirm, QA-021 (day tabs), QA-036 (must removal
 * confirms), QA-037 (toast + undo), QA-043 (live regions), QA-045 (24px
 * targets). Exit code 1 when any check fails.
 */
import {
  ambiguityFixture,
  ambiguityInput,
  buildSamplePlan,
  clickByText,
  clickStartCtaUntil,
  gotoStart,
  launchBrowser,
  newPage,
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
      const tabs = await page.$$(".planner-day-tabs button");
      if (tabs.length < 2) throw new Error(`only ${tabs.length} day tabs`);
      await tabs[1].click();
      await page.waitForFunction(() => {
        const buttons = [...document.querySelectorAll(".planner-day-tabs button")];
        return buttons[1]?.getAttribute("aria-current") === "true" || buttons[1]?.getAttribute("aria-current") === "page";
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

  // --- QA-045: pointer targets ≥ 24×24 CSS px on the three key screens. ---
  {
    const audit = async (page, label) => {
      const violators = await page.evaluate(() => {
        const interactive = [...document.querySelectorAll("button, a[href], select, summary, input:not([type=hidden])")];
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
      });
      if (violators.length > 0) throw new Error(`${label}: ${violators.join(" | ")}`);
    };

    const page = await newPage(browser, { fixtures: { placeResolution: ambiguityFixture("ja") } });
    await gotoStart(page, "ja");
    await expect("QA-045 start targets ≥24px", audit(page, "start"));
    await setWishlist(page, ambiguityInput("ja"));
    await clickStartCtaUntil(page, ".planner-resolve-intro", { timeout: 6_000 });
    await expect("QA-045 resolve targets ≥24px", audit(page, "resolve"));
    await page.close();

    const planPage = await newPage(browser);
    await buildSamplePlan(planPage, "ja");
    await expect("QA-045 plan targets ≥24px", audit(planPage, "plan"));
    await planPage.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) process.exitCode = 1;
