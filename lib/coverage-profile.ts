import type { DestinationId } from "./destinations.ts";

/**
 * Regional capability is deliberately separate from fact-level evidence.
 *
 * A grade says how deeply TripCheck has validated one provider/domain in a
 * region. It does not say that a particular route, venue, or opening time was
 * fetched for the current trip. Those claims continue to belong to
 * `Evidence<T>` and critical-fact coverage.
 */
export type CoverageGrade = "A" | "B" | "C" | "unknown";

export type CoverageDimension = "routes" | "poi" | "hours" | "transit";

export type CoverageProfileId =
  | "tokyo"
  | "japan_other"
  | "switzerland"
  | "europe"
  | "usa"
  | "unsupported";

export type CoverageGrades = Readonly<Record<CoverageDimension, CoverageGrade>>;

export type RegionalCoverageProfile = Readonly<{
  /** Discriminator prevents this object being mistaken for fact coverage. */
  kind: "regional_capability";
  id: CoverageProfileId;
  label: Readonly<{ en: string; ja: string }>;
  grades: CoverageGrades;
  /** Date this regional assessment was last reviewed, not a provider fetch. */
  lastValidatedAt: string | null;
  publicCopy: Readonly<{ en: string; ja: string }>;
}>;

export type CoverageLookup = Readonly<{
  destination?: DestinationId | "auto" | string | null;
  countryCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Optional product-owned region label, for example a selected Tokyo area. */
  regionHint?: string | null;
}>;

const VALIDATED_AT = "2026-08-09";

function freezeProfile(profile: RegionalCoverageProfile): RegionalCoverageProfile {
  Object.freeze(profile.label);
  Object.freeze(profile.grades);
  Object.freeze(profile.publicCopy);
  return Object.freeze(profile);
}

const tokyo = freezeProfile({
  kind: "regional_capability",
  id: "tokyo",
  label: { en: "Tokyo", ja: "東京" },
  grades: { routes: "A", poi: "A", hours: "B", transit: "A" },
  lastValidatedAt: VALIDATED_AT,
  publicCopy: {
    en: "TripCheck's best-covered beta region. Routes, places, and transit have the deepest validation; date-specific opening hours still need confirmation.",
    ja: "TripCheckで最も検証が進んだベータ地域です。経路・地点・公共交通は重点検証済みですが、日付ごとの営業時間は引き続き確認が必要です。",
  },
});

const japanOther = freezeProfile({
  kind: "regional_capability",
  id: "japan_other",
  label: { en: "Japan outside Tokyo", ja: "東京以外の日本" },
  grades: { routes: "A", poi: "A", hours: "B", transit: "B" },
  lastValidatedAt: VALIDATED_AT,
  publicCopy: {
    en: "Japan-wide planning is available, but validation outside Tokyo is less deep. Confirm local transit details and date-specific opening hours before relying on the plan.",
    ja: "日本全国で計画できますが、東京以外は検証の深さが異なります。現地の公共交通と日付ごとの営業時間を確認してから旅程を確定してください。",
  },
});

const switzerland = freezeProfile({
  kind: "regional_capability",
  id: "switzerland",
  label: { en: "Switzerland", ja: "スイス" },
  grades: { routes: "A", poi: "A", hours: "B", transit: "A" },
  lastValidatedAt: VALIDATED_AT,
  publicCopy: {
    en: "Routes, places, and timetable-based transit are well covered in beta. Confirm date-specific opening hours and attraction reservation rules separately.",
    ja: "経路・地点・時刻表ベースの公共交通はベータで重点検証しています。日付ごとの営業時間と施設固有の予約条件は別途確認してください。",
  },
});

const europe = freezeProfile({
  kind: "regional_capability",
  id: "europe",
  label: { en: "Europe (limited beta)", ja: "ヨーロッパ（限定ベータ）" },
  grades: { routes: "B", poi: "B", hours: "C", transit: "C" },
  lastValidatedAt: VALIDATED_AT,
  publicCopy: {
    en: "Limited beta coverage. The plan can use provider data and estimates, but local opening-hour and transit validation is not yet as deep as Tokyo or Switzerland.",
    ja: "限定ベータの対応範囲です。提供元データと推定で計画できますが、営業時間と公共交通の地域検証は東京・スイスほど深くありません。",
  },
});

const usa = freezeProfile({
  kind: "regional_capability",
  id: "usa",
  label: { en: "United States (limited beta)", ja: "米国（限定ベータ）" },
  grades: { routes: "B", poi: "B", hours: "C", transit: "C" },
  lastValidatedAt: VALIDATED_AT,
  publicCopy: {
    en: "Limited beta coverage. Driving and place estimates may be useful, but opening hours and public-transit quality vary by city and require local confirmation.",
    ja: "限定ベータの対応範囲です。車移動と地点情報は参考になりますが、営業時間と公共交通の品質は都市差が大きいため現地確認が必要です。",
  },
});

const unsupported = freezeProfile({
  kind: "regional_capability",
  id: "unsupported",
  label: { en: "Unvalidated region", ja: "未検証地域" },
  grades: { routes: "unknown", poi: "unknown", hours: "unknown", transit: "unknown" },
  lastValidatedAt: null,
  publicCopy: {
    en: "TripCheck has not validated regional route, place, opening-hour, or transit coverage here. Any plan is provisional and every consequential fact should be checked.",
    ja: "この地域では経路・地点・営業時間・公共交通の対応品質を検証していません。旅程は暫定として扱い、重要な事実を個別に確認してください。",
  },
});

export const COVERAGE_PROFILES: Readonly<Record<CoverageProfileId, RegionalCoverageProfile>> = Object.freeze({
  tokyo,
  japan_other: japanOther,
  switzerland,
  europe,
  usa,
  unsupported,
});

const dimensions = new Set<CoverageDimension>(["routes", "poi", "hours", "transit"]);

const europeanDestinations = new Set<string>([
  "france",
  "italy",
  "spain",
  "portugal",
  "uk",
  "germany",
  "austria",
  "netherlands",
  "iceland",
  "norway",
]);

const europeanCountryCodes = new Set([
  "AD", "AL", "AT", "BA", "BE", "BG", "BY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GR",
  "HR", "HU", "IE", "IS", "IT", "LI", "LT", "LU", "LV", "MC", "MD", "ME", "MK", "MT", "NL", "NO",
  "PL", "PT", "RO", "RS", "SE", "SI", "SK", "SM", "UA", "VA",
]);

function normalizedCountryCode(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

function normalizedHint(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("en-US").replace(/[\s_-]+/g, " ") ?? "";
}

function hasCoordinate(input: CoverageLookup) {
  return typeof input.latitude === "number"
    && Number.isFinite(input.latitude)
    && input.latitude >= -90
    && input.latitude <= 90
    && typeof input.longitude === "number"
    && Number.isFinite(input.longitude)
    && input.longitude >= -180
    && input.longitude <= 180;
}

/** Conservative Greater Tokyo validation box, not a legal/political boundary. */
export function isTokyoCoverageCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= 35.45
    && latitude <= 35.90
    && longitude >= 139.45
    && longitude <= 140.05;
}

function coarseProfileForDestination(destination: string) {
  if (destination === "japan") return "japan_other" as const;
  if (destination === "switzerland") return "switzerland" as const;
  if (destination === "usa") return "usa" as const;
  if (europeanDestinations.has(destination)) return "europe" as const;
  return null;
}

function coarseProfileForCountry(countryCode: string | null) {
  if (countryCode === "JP") return "japan_other" as const;
  if (countryCode === "CH") return "switzerland" as const;
  if (countryCode === "US") return "usa" as const;
  if (countryCode && europeanCountryCodes.has(countryCode)) return "europe" as const;
  return null;
}

/**
 * Total, fail-closed regional lookup. Contradictory or unrecognised inputs never
 * inherit a nearby region's confidence; they return the all-unknown profile.
 */
export function coverageProfileForLocation(input: CoverageLookup = {}): RegionalCoverageProfile {
  const destination = input.destination?.trim().toLowerCase() ?? "";
  const byDestination = coarseProfileForDestination(destination);
  const byCountry = coarseProfileForCountry(normalizedCountryCode(input.countryCode));
  if (byDestination && byCountry && byDestination !== byCountry) return unsupported;

  const coarse = byCountry ?? byDestination;
  const tokyoHint = normalizedHint(input.regionHint) === "tokyo" || normalizedHint(input.regionHint) === "東京";
  const coordinateIsTokyo = hasCoordinate(input)
    && isTokyoCoverageCoordinate(input.latitude!, input.longitude!);

  // A coordinate or hint that contradicts an explicit non-Japan location is
  // ambiguous evidence, not permission to claim Tokyo coverage.
  if ((tokyoHint || coordinateIsTokyo) && coarse && coarse !== "japan_other") return unsupported;
  if (coarse === "japan_other") return tokyoHint || coordinateIsTokyo ? tokyo : japanOther;
  if (!coarse && (tokyoHint || coordinateIsTokyo)) return tokyo;
  if (coarse === "switzerland") return switzerland;
  if (coarse === "europe") return europe;
  if (coarse === "usa") return usa;
  return unsupported;
}

/** Unknown IDs are intentionally non-throwing and all-unknown. */
export function coverageProfileById(id: string | null | undefined): RegionalCoverageProfile {
  if (!id || !Object.prototype.hasOwnProperty.call(COVERAGE_PROFILES, id)) return unsupported;
  return COVERAGE_PROFILES[id as CoverageProfileId];
}

/** Missing profiles or future dimensions can never accidentally become A/B/C. */
export function coverageGrade(
  profile: RegionalCoverageProfile | null | undefined,
  dimension: CoverageDimension | string,
): CoverageGrade {
  return profile && dimensions.has(dimension as CoverageDimension)
    ? profile.grades[dimension as CoverageDimension]
    : "unknown";
}

export function coveragePublicCopy(
  profile: RegionalCoverageProfile | null | undefined,
  locale: "en" | "ja" | string = "en",
) {
  const safeProfile = profile ?? unsupported;
  return locale === "ja" ? safeProfile.publicCopy.ja : safeProfile.publicCopy.en;
}

export function hasUnknownRegionalCoverage(profile: RegionalCoverageProfile | null | undefined) {
  return (["routes", "poi", "hours", "transit"] as const)
    .some((dimension) => coverageGrade(profile, dimension) === "unknown");
}
