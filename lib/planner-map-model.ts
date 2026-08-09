export const PLANNER_MAP_DAY_COLORS = [
  "#146c67",
  "#b64b35",
  "#6550a8",
  "#936400",
] as const;

export type PlannerMapItemKind = "anchor" | "filler" | "meal" | "hotel" | "warning";
export type PlannerMapMealKind = "lunch" | "dinner" | "both";
export type PlannerMapPinGlyph = "number" | "star" | "meal" | "lunch" | "dinner" | "bed" | "warning" | "manual" | "text";

export type PlannerMapPinView = {
  kind: PlannerMapItemKind;
  badge: string;
  glyph: PlannerMapPinGlyph;
  shape: "filled" | "outlined" | "meal" | "hotel" | "warning";
  className: string;
  labelVisibility: "interaction";
  warningBadge: "!" | null;
  ariaKind: string;
};

export type PlannerMapRouteView = {
  color: string;
  dayIndex: number;
  dayNumber: number;
  dayLabel: string;
  className: string;
  strokeWeight: number;
  strokeOpacity: number;
  outlineWeight: number;
  outlineOpacity: number;
  zIndex: number;
  lineStyle: "solid";
};

export type PlannerMapLayerCoordinate = {
  latitude: number;
  longitude: number;
};

export type PlannerMapDayLayerStop = PlannerMapLayerCoordinate & {
  /** The same stable item id used by the timeline and inspector. */
  id: string;
  name: string;
  /** One-based visit order shown on an Anchor marker. */
  sequence?: number;
  kind?: PlannerMapItemKind;
  warning?: boolean;
};

export type PlannerMapDayLayer = {
  /** Zero-based index from the plan. */
  dayIndex: number;
  dayColor?: string;
  stops: readonly PlannerMapDayLayerStop[];
  /**
   * Provider-backed paths for individual legs. A missing leg stays missing;
   * consumers must never join adjacent stop coordinates as a fake route.
   */
  routeSegments?: readonly (readonly PlannerMapLayerCoordinate[] | null)[];
};

export type PlannerMapDayLayerView = {
  dayIndex: number;
  dayNumber: number;
  active: boolean;
  color: string;
  route: PlannerMapRouteView;
  pinOpacity: number;
  pinZIndex: number;
  stops: readonly (PlannerMapDayLayerStop & { pin: PlannerMapPinView })[];
  /** Only valid provider-backed segments survive. No fallback segment exists. */
  drawableSegments: readonly (readonly { lat: number; lng: number }[])[];
};

function normalizedDayIndex(value: number | undefined) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

/**
 * Google Maps draws onto its own canvas, so CSS custom properties cannot be
 * relied on for a polyline colour. Keep the palette deterministic and allow a
 * caller-owned override for a shared timeline/map day colour.
 */
export function plannerMapDayColor(dayIndex = 0, dayColor?: string) {
  const override = dayColor?.trim();
  if (override && override.length <= 64) return override;
  const index = normalizedDayIndex(dayIndex);
  return PLANNER_MAP_DAY_COLORS[index % PLANNER_MAP_DAY_COLORS.length];
}

export function buildPlannerMapRouteView(input: {
  dayIndex?: number;
  dayColor?: string;
  active?: boolean;
} = {}): PlannerMapRouteView {
  const dayIndex = normalizedDayIndex(input.dayIndex);
  const active = input.active !== false;
  const dayNumber = dayIndex + 1;
  return {
    color: plannerMapDayColor(dayIndex, input.dayColor),
    dayIndex,
    dayNumber,
    dayLabel: `Day ${dayNumber}`,
    className: `planner-map-route is-day-${dayNumber}${active ? " is-active" : " is-inactive"}`,
    strokeWeight: active ? 5 : 2,
    strokeOpacity: active ? 0.95 : 0.28,
    outlineWeight: active ? 9 : 4,
    outlineOpacity: active ? 0.92 : 0.38,
    zIndex: active ? 5 : 2,
    lineStyle: "solid",
  };
}

function safeSequence(value: number | undefined) {
  return Number.isInteger(value) && Number(value) > 0 ? String(value) : "1";
}

export function buildPlannerMapPinView(input: {
  kind: PlannerMapItemKind;
  sequence?: number;
  mealKind?: PlannerMapMealKind;
  warning?: boolean;
  locale?: "en" | "ja";
  badgeText?: string;
  comparison?: boolean;
}): PlannerMapPinView {
  const locale = input.locale === "ja" ? "ja" : "en";
  const comparisonClass = input.comparison ? " is-comparison" : "";
  const warning = input.warning === true || input.kind === "warning";
  const warningClass = warning && input.kind !== "warning" ? " is-warning" : "";

  let kind = input.kind;
  let badge = input.badgeText?.trim() || "";
  let glyph: PlannerMapPinGlyph;
  let shape: PlannerMapPinView["shape"];
  let className: string;

  if (kind === "hotel") {
    badge ||= "H";
    glyph = input.comparison ? "text" : "bed";
    shape = "hotel";
    className = `planner-map-chip is-hotel${input.comparison ? "-option" : ""} is-shape-hotel`;
  } else if (kind === "meal") {
    badge ||= "M";
    glyph = input.mealKind === "lunch" ? "lunch" : input.mealKind === "dinner" ? "dinner" : "meal";
    shape = "meal";
    className = `planner-map-chip is-meal is-food-${input.mealKind ?? "both"} is-shape-meal`;
  } else if (kind === "filler") {
    badge ||= "✦";
    glyph = "star";
    shape = "outlined";
    className = "planner-map-chip is-filler is-recommendation is-shape-outlined";
  } else if (kind === "warning") {
    badge ||= "!";
    glyph = "warning";
    shape = "warning";
    className = "planner-map-chip is-warning is-shape-warning";
  } else {
    kind = "anchor";
    badge ||= safeSequence(input.sequence);
    glyph = "number";
    shape = "filled";
    className = "planner-map-chip is-anchor is-shape-filled";
  }

  const localizedKinds: Record<"en" | "ja", Record<PlannerMapItemKind, string>> = {
    en: { anchor: "planned stop", filler: "recommended stop", meal: "meal", hotel: "hotel", warning: "warning stop" },
    ja: { anchor: "予定地点", filler: "おすすめ地点", meal: "食事", hotel: "ホテル", warning: "注意地点" },
  };

  return {
    kind,
    badge,
    glyph,
    shape,
    className: `${className}${comparisonClass}${warningClass}`,
    labelVisibility: "interaction",
    warningBadge: warning ? "!" : null,
    ariaKind: `${localizedKinds[locale][kind]}${warning && kind !== "warning" ? (locale === "ja" ? "、注意あり" : ", warning") : ""}`,
  };
}

export function plannerRouteGeometryIsDrawable(
  points: readonly { lat: number; lng: number }[] | null | undefined,
) {
  return Boolean(points && points.length >= 2 && points.every((point) => (
    Number.isFinite(point.lat)
    && Number.isFinite(point.lng)
    && point.lat >= -90
    && point.lat <= 90
    && point.lng >= -180
    && point.lng <= 180
  )));
}

function layerCoordinateIsValid(point: PlannerMapLayerCoordinate) {
  return Number.isFinite(point.latitude)
    && Number.isFinite(point.longitude)
    && point.latitude >= -90
    && point.latitude <= 90
    && point.longitude >= -180
    && point.longitude <= 180;
}

/**
 * Produces render-ready all-day layers without route inference. The active
 * day is intentionally represented too, allowing the component to omit its
 * duplicate snapshot while its live route pipeline renders the authoritative
 * active layer.
 */
export function buildPlannerMapDayLayerViews(
  layers: readonly PlannerMapDayLayer[] | null | undefined,
  options: { activeDayIndex?: number; locale?: "en" | "ja" } = {},
): PlannerMapDayLayerView[] {
  const activeDayIndex = normalizedDayIndex(options.activeDayIndex);
  const locale = options.locale === "ja" ? "ja" : "en";
  if (!layers) return [];

  return layers
    .filter((layer) => Number.isInteger(layer.dayIndex) && layer.dayIndex >= 0)
    .map((layer) => {
      const active = layer.dayIndex === activeDayIndex;
      const route = buildPlannerMapRouteView({
        dayIndex: layer.dayIndex,
        dayColor: layer.dayColor,
        active,
      });
      const stops = layer.stops
        .filter((stop) => Boolean(stop.id.trim()) && Boolean(stop.name.trim()) && layerCoordinateIsValid(stop))
        .map((stop, index) => ({
          ...stop,
          sequence: stop.sequence ?? index + 1,
          pin: buildPlannerMapPinView({
            kind: stop.kind ?? "anchor",
            sequence: stop.sequence ?? index + 1,
            warning: stop.warning,
            locale,
          }),
        }));
      const drawableSegments = (layer.routeSegments ?? []).flatMap((segment) => {
        if (!segment) return [];
        const path = segment.map((point) => ({ lat: point.latitude, lng: point.longitude }));
        return plannerRouteGeometryIsDrawable(path) ? [path] : [];
      });
      return {
        dayIndex: layer.dayIndex,
        dayNumber: layer.dayIndex + 1,
        active,
        color: route.color,
        route,
        pinOpacity: active ? 1 : 0.38,
        pinZIndex: active ? 3 : 0,
        stops,
        drawableSegments,
      };
    })
    .sort((left, right) => left.dayIndex - right.dayIndex);
}
