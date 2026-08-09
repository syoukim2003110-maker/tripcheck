import assert from "node:assert/strict";
import test from "node:test";
import {
  COVERAGE_PROFILES,
  coverageGrade,
  coverageProfileById,
  coverageProfileForLocation,
  coveragePublicCopy,
  hasUnknownRegionalCoverage,
  isTokyoCoverageCoordinate,
} from "../lib/coverage-profile.ts";

test("defines explicit regional grades without mixing them with fact coverage", () => {
  assert.deepEqual(COVERAGE_PROFILES.tokyo.grades, { routes: "A", poi: "A", hours: "B", transit: "A" });
  assert.deepEqual(COVERAGE_PROFILES.japan_other.grades, { routes: "A", poi: "A", hours: "B", transit: "B" });
  assert.deepEqual(COVERAGE_PROFILES.switzerland.grades, { routes: "A", poi: "A", hours: "B", transit: "A" });
  assert.deepEqual(COVERAGE_PROFILES.europe.grades, { routes: "B", poi: "B", hours: "C", transit: "C" });
  assert.deepEqual(COVERAGE_PROFILES.usa.grades, { routes: "B", poi: "B", hours: "C", transit: "C" });
  assert.deepEqual(COVERAGE_PROFILES.unsupported.grades, {
    routes: "unknown",
    poi: "unknown",
    hours: "unknown",
    transit: "unknown",
  });

  for (const profile of Object.values(COVERAGE_PROFILES)) {
    assert.equal(profile.kind, "regional_capability");
    assert.equal("facts" in profile, false);
    assert.equal("criticalFacts" in profile, false);
    assert.equal("verified" in profile, false);
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(profile.grades), true);
  }
});

test("separates Tokyo from the safer Japan-outside-Tokyo fallback", () => {
  assert.equal(isTokyoCoverageCoordinate(35.6812, 139.7671), true);
  assert.equal(isTokyoCoverageCoordinate(35.0116, 135.7681), false);
  assert.equal(coverageProfileForLocation({ destination: "japan", latitude: 35.6812, longitude: 139.7671 }).id, "tokyo");
  assert.equal(coverageProfileForLocation({ destination: "japan", latitude: 35.0116, longitude: 135.7681 }).id, "japan_other");
  assert.equal(coverageProfileForLocation({ destination: "japan" }).id, "japan_other", "country alone must not imply Tokyo validation");
  assert.equal(coverageProfileForLocation({ countryCode: "JP", regionHint: "東京" }).id, "tokyo");
});

test("maps supported destination families to their regional profile", () => {
  assert.equal(coverageProfileForLocation({ destination: "switzerland" }).id, "switzerland");
  assert.equal(coverageProfileForLocation({ countryCode: "CH" }).id, "switzerland");
  assert.equal(coverageProfileForLocation({ destination: "france" }).id, "europe");
  assert.equal(coverageProfileForLocation({ countryCode: "DE" }).id, "europe");
  assert.equal(coverageProfileForLocation({ destination: "usa" }).id, "usa");
  assert.equal(coverageProfileForLocation({ countryCode: "US" }).id, "usa");
});

test("fails closed for unsupported, malformed, or contradictory locations", () => {
  const unsupported = COVERAGE_PROFILES.unsupported;
  assert.strictEqual(coverageProfileForLocation(), unsupported);
  assert.strictEqual(coverageProfileForLocation({ destination: "korea" }), unsupported);
  assert.strictEqual(coverageProfileForLocation({ destination: "auto" }), unsupported);
  assert.strictEqual(coverageProfileForLocation({ destination: "switzerland", countryCode: "US" }), unsupported);
  assert.strictEqual(coverageProfileForLocation({ destination: "switzerland", latitude: 35.6812, longitude: 139.7671 }), unsupported);
  assert.strictEqual(coverageProfileForLocation({ destination: "japan", latitude: Number.NaN, longitude: 139.7 }), COVERAGE_PROFILES.japan_other);
  assert.strictEqual(coverageProfileById("future_region"), unsupported);
  assert.strictEqual(coverageProfileById(null), unsupported);
  assert.equal(coverageGrade(undefined, "routes"), "unknown");
  assert.equal(coverageGrade(COVERAGE_PROFILES.tokyo, "future_dimension"), "unknown");
  assert.equal(hasUnknownRegionalCoverage(unsupported), true);
  assert.equal(hasUnknownRegionalCoverage(COVERAGE_PROFILES.tokyo), false);
});

test("exposes dated, cautious public copy and uses English as the safe locale fallback", () => {
  for (const profile of Object.values(COVERAGE_PROFILES).filter((entry) => entry.id !== "unsupported")) {
    assert.match(profile.lastValidatedAt ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(profile.publicCopy.en.length > 40);
    assert.ok(profile.publicCopy.ja.length > 20);
  }
  assert.equal(COVERAGE_PROFILES.unsupported.lastValidatedAt, null);
  assert.match(coveragePublicCopy(COVERAGE_PROFILES.unsupported, "en"), /not validated|provisional/i);
  assert.match(coveragePublicCopy(COVERAGE_PROFILES.unsupported, "ja"), /検証していません|暫定/);
  assert.equal(
    coveragePublicCopy(COVERAGE_PROFILES.switzerland, "ko"),
    COVERAGE_PROFILES.switzerland.publicCopy.en,
  );
  assert.equal(coveragePublicCopy(undefined, "en"), COVERAGE_PROFILES.unsupported.publicCopy.en);
});
