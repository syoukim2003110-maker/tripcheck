import assert from "node:assert/strict";
import test from "node:test";
import { destinationById, destinationEntryAuthority, destinationPassportRule } from "../lib/destinations.ts";
import { addMonthsUtc, buildPreTripTimeline } from "../lib/pre-trip-timeline.ts";

const now = new Date("2026-08-06T00:00:00.000Z");

test("addMonthsUtc clamps to month end", () => {
  assert.equal(new Date(addMonthsUtc(Date.UTC(2026, 0, 31), 1)).toISOString().slice(0, 10), "2026-02-28");
  assert.equal(new Date(addMonthsUtc(Date.UTC(2024, 0, 31), 1)).toISOString().slice(0, 10), "2024-02-29");
  assert.equal(new Date(addMonthsUtc(Date.UTC(2026, 7, 15), 6)).toISOString().slice(0, 10), "2027-02-15");
});

test("ESTA gets a dated apply-by with urgency from today", () => {
  const usa = destinationEntryAuthority(destinationById("usa"));
  assert.ok(usa && usa.status === "required" && usa.transit);

  const relaxed = buildPreTripTimeline({
    tripStartDate: "2026-10-01",
    tripEndDate: "2026-10-08",
    authority: usa,
    passportRule: null,
    passportExpiry: null,
    now,
  });
  assert.equal(relaxed[0].dueDate, "2026-09-28");
  assert.equal(relaxed[0].urgency, "scheduled");

  const tight = buildPreTripTimeline({
    tripStartDate: "2026-08-12",
    tripEndDate: "2026-08-19",
    authority: usa,
    passportRule: null,
    passportExpiry: null,
    now,
  });
  assert.equal(tight[0].dueDate, "2026-08-09");
  assert.equal(tight[0].urgency, "due_soon");

  const late = buildPreTripTimeline({
    tripStartDate: "2026-08-07",
    tripEndDate: "2026-08-10",
    authority: usa,
    passportRule: null,
    passportExpiry: null,
    now,
  });
  assert.equal(late[0].urgency, "overdue");
});

test("TDAC is a window, not a deadline: cannot be filed before it opens", () => {
  const thailand = destinationEntryAuthority(destinationById("thailand"));
  assert.ok(thailand && thailand.opensDaysBefore === 3);

  const early = buildPreTripTimeline({
    tripStartDate: "2026-09-20",
    tripEndDate: "2026-09-27",
    authority: thailand,
    passportRule: null,
    passportExpiry: null,
    now,
  });
  assert.equal(early[0].opensDate, "2026-09-17");
  assert.equal(early[0].dueDate, "2026-09-20");
  assert.equal(early[0].urgency, "scheduled");

  const inWindow = buildPreTripTimeline({
    tripStartDate: "2026-08-08",
    tripEndDate: "2026-08-12",
    authority: thailand,
    passportRule: null,
    passportExpiry: null,
    now,
  });
  assert.equal(inWindow[0].urgency, "due_soon");
});

test("ETIAS stays informational and K-ETA waiver follows the trip date", () => {
  const france = destinationEntryAuthority(destinationById("france"));
  assert.ok(france && france.status === "not_yet");
  const items = buildPreTripTimeline({
    tripStartDate: "2026-09-01",
    tripEndDate: "2026-09-10",
    authority: france,
    passportRule: null,
    passportExpiry: null,
    now,
  });
  assert.equal(items[0].urgency, "info");
  assert.equal(items[0].dueDate, null);
  assert.match(items[0].label.ja, /現時点では不要/);

  const korea = destinationEntryAuthority(destinationById("korea"));
  assert.ok(korea && korea.status === "waived");

  const duringWaiver = buildPreTripTimeline({
    tripStartDate: "2026-12-31",
    tripEndDate: "2027-01-03",
    authority: korea,
    passportRule: null,
    passportExpiry: null,
    now,
  });
  assert.match(duringWaiver[0].label.en, /currently waived/);

  const afterWaiver = buildPreTripTimeline({
    tripStartDate: "2027-01-01",
    tripEndDate: "2027-01-05",
    authority: korea,
    passportRule: null,
    passportExpiry: null,
    now,
  });
  assert.doesNotMatch(afterWaiver[0].label.en, /currently waived/);
  assert.match(afterWaiver[0].label.ja, /期間外/);
});

test("six-month-at-entry passport rules use the trip start, not the trip end", () => {
  const rule = destinationPassportRule(destinationById("thailand"));
  assert.ok(rule && rule.monthsBeyond === 6 && rule.referenceDate === "entry");

  const short = buildPreTripTimeline({
    tripStartDate: "2026-09-20",
    tripEndDate: "2026-09-27",
    authority: null,
    passportRule: rule,
    passportExpiry: "2027-01-15",
    now,
  });
  assert.equal(short[0].urgency, "overdue");
  assert.match(short[0].label.ja, /不足/);

  const fine = buildPreTripTimeline({
    tripStartDate: "2026-09-20",
    tripEndDate: "2026-09-27",
    authority: null,
    passportRule: rule,
    // Exactly six months after entry; checking against trip end would reject it.
    passportExpiry: "2027-03-20",
    now,
  });
  assert.equal(fine[0].urgency, "info");
  assert.match(fine[0].label.ja, /OK/);

  const unknown = buildPreTripTimeline({
    tripStartDate: "2026-09-20",
    tripEndDate: "2026-09-27",
    authority: null,
    passportRule: rule,
    passportExpiry: null,
    now,
  });
  assert.equal(unknown[0].urgency, "info");
  assert.match(unknown[0].label.ja, /残り何ヶ月/);
});

test("beyond-stay rules use departure and do not overclaim unchecked conditions", () => {
  const schengen = destinationPassportRule(destinationById("france"));
  assert.ok(schengen && schengen.referenceDate === "departure" && schengen.additionalCheck);

  const tooShort = buildPreTripTimeline({
    tripStartDate: "2026-09-01",
    tripEndDate: "2026-09-10",
    authority: null,
    passportRule: schengen,
    passportExpiry: "2026-12-09",
    now,
  });
  assert.equal(tooShort[0].urgency, "overdue");
  assert.match(tooShort[0].label.en, /NOT enough/);

  const expiryRequirementMet = buildPreTripTimeline({
    tripStartDate: "2026-09-01",
    tripEndDate: "2026-09-10",
    authority: null,
    passportRule: schengen,
    passportExpiry: "2026-12-10",
    now,
  });
  assert.equal(expiryRequirementMet[0].urgency, "info");
  assert.match(expiryRequirementMet[0].label.en, /appears met/);
  assert.match(expiryRequirementMet[0].label.en, /remains unchecked/);
  assert.doesNotMatch(expiryRequirementMet[0].label.en, /validity OK/);
  assert.match(expiryRequirementMet[0].label.ja, /未確認/);
});

test("New Zealand's three-month rule is measured from departure", () => {
  const rule = destinationPassportRule(destinationById("newzealand"));
  assert.ok(rule && rule.referenceDate === "departure");
  const item = buildPreTripTimeline({
    tripStartDate: "2026-09-01",
    tripEndDate: "2026-09-10",
    authority: null,
    passportRule: rule,
    passportExpiry: "2026-12-09",
    now,
  });
  assert.equal(item[0].urgency, "overdue");
});

test("blockers sort before dated to-dos and notes", () => {
  const thailand = destinationById("thailand");
  const items = buildPreTripTimeline({
    tripStartDate: "2026-09-20",
    tripEndDate: "2026-09-27",
    authority: destinationEntryAuthority(thailand),
    passportRule: destinationPassportRule(thailand),
    passportExpiry: "2026-11-01",
    now,
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].id, "passport");
  assert.equal(items[0].urgency, "overdue");
  assert.equal(items[1].id, "authority-TDAC");
});

test("every non-worldwide destination with an authority also names an official URL", () => {
  for (const id of ["usa", "uk", "canada", "australia", "newzealand", "korea", "thailand", "singapore", "indonesia", "switzerland"] as const) {
    const authority = destinationEntryAuthority(destinationById(id));
    assert.ok(authority, id);
    assert.match(authority.officialUrl, /^https:\/\//, id);
  }
  assert.equal(destinationEntryAuthority(destinationById("worldwide")), null);
  assert.equal(destinationEntryAuthority(destinationById("japan")), null);
});
