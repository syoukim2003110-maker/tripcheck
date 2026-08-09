import assert from "node:assert/strict";
import test from "node:test";
import {
  PLANNER_MAP_DAY_COLORS,
  buildPlannerMapDayLayerViews,
  buildPlannerMapPinView,
  buildPlannerMapRouteView,
  plannerMapDayColor,
  plannerRouteGeometryIsDrawable,
} from "../lib/planner-map-model.ts";

test("day route view uses a stable day palette instead of transport-mode colours", () => {
  assert.equal(plannerMapDayColor(0), PLANNER_MAP_DAY_COLORS[0]);
  assert.equal(plannerMapDayColor(4), PLANNER_MAP_DAY_COLORS[0]);
  assert.equal(plannerMapDayColor(2, " #123456 "), "#123456");

  const active = buildPlannerMapRouteView({ dayIndex: 1 });
  assert.equal(active.dayNumber, 2);
  assert.equal(active.color, PLANNER_MAP_DAY_COLORS[1]);
  assert.equal(active.strokeWeight, 5);
  assert.equal(active.strokeOpacity, 0.95);
  assert.match(active.className, /is-day-2 is-active/);

  const inactive = buildPlannerMapRouteView({ dayIndex: 1, active: false });
  assert.equal(inactive.color, active.color);
  assert.equal(inactive.strokeWeight, 2);
  assert.ok(inactive.strokeOpacity < active.strokeOpacity);
  assert.match(inactive.className, /is-inactive/);
});

test("pin view models distinguish anchor, filler, meal, hotel and warnings without colour alone", () => {
  const anchor = buildPlannerMapPinView({ kind: "anchor", sequence: 3 });
  assert.deepEqual([anchor.badge, anchor.glyph, anchor.shape], ["3", "number", "filled"]);
  assert.match(anchor.className, /is-anchor/);
  assert.equal(anchor.labelVisibility, "interaction");

  const filler = buildPlannerMapPinView({ kind: "filler", warning: true });
  assert.deepEqual([filler.badge, filler.glyph, filler.shape, filler.warningBadge], ["✦", "star", "outlined", "!"]);
  assert.match(filler.className, /is-filler/);
  assert.match(filler.className, /is-warning/);
  assert.match(filler.ariaKind, /warning/);

  const meal = buildPlannerMapPinView({ kind: "meal", mealKind: "dinner" });
  assert.equal(meal.glyph, "dinner");
  assert.equal(meal.shape, "meal");
  assert.match(meal.className, /is-meal/);

  const hotel = buildPlannerMapPinView({ kind: "hotel" });
  assert.equal(hotel.glyph, "bed");
  assert.equal(hotel.shape, "hotel");

  const warning = buildPlannerMapPinView({ kind: "warning", locale: "ja" });
  assert.equal(warning.badge, "!");
  assert.equal(warning.ariaKind, "注意地点");
});

test("missing or invalid provider geometry is never considered drawable", () => {
  assert.equal(plannerRouteGeometryIsDrawable(null), false);
  assert.equal(plannerRouteGeometryIsDrawable([]), false);
  assert.equal(plannerRouteGeometryIsDrawable([{ lat: 35, lng: 139 }]), false);
  assert.equal(plannerRouteGeometryIsDrawable([{ lat: 35, lng: 139 }, { lat: Number.NaN, lng: 139 }]), false);
  assert.equal(plannerRouteGeometryIsDrawable([{ lat: 35, lng: 139 }, { lat: 35.1, lng: 139.1 }]), true);
});

test("multi-day layers keep stable colours, numbers and active/inactive emphasis", () => {
  const layers = buildPlannerMapDayLayerViews([
    {
      dayIndex: 2,
      stops: [{ id: "day-3-a", name: "Day three anchor", latitude: 35.3, longitude: 139.3 }],
      routeSegments: [[{ latitude: 35.3, longitude: 139.3 }, { latitude: 35.4, longitude: 139.4 }]],
    },
    {
      dayIndex: 0,
      dayColor: "#112233",
      stops: [{ id: "day-1-a", name: "Day one anchor", sequence: 4, latitude: 35, longitude: 139 }],
      routeSegments: [[{ latitude: 35, longitude: 139 }, { latitude: 35.1, longitude: 139.1 }]],
    },
  ], { activeDayIndex: 2 });

  assert.deepEqual(layers.map((layer) => layer.dayIndex), [0, 2]);
  assert.equal(layers[0].color, "#112233");
  assert.equal(layers[0].route.strokeWeight, 2);
  assert.equal(layers[0].pinOpacity, 0.38);
  assert.equal(layers[0].stops[0].pin.badge, "4");
  assert.equal(layers[1].dayNumber, 3);
  assert.equal(layers[1].route.strokeWeight, 5);
  assert.equal(layers[1].pinOpacity, 1);
});

test("multi-day layers discard missing and malformed geometry instead of joining stop coordinates", () => {
  const [layer] = buildPlannerMapDayLayerViews([{
    dayIndex: 0,
    stops: [
      { id: "a", name: "A", latitude: 35, longitude: 139 },
      { id: "b", name: "B", latitude: 36, longitude: 140 },
    ],
    routeSegments: [
      null,
      [{ latitude: 35, longitude: 139 }],
      [{ latitude: 35, longitude: 139 }, { latitude: 999, longitude: 140 }],
    ],
  }]);

  assert.equal(layer.stops.length, 2);
  assert.deepEqual(layer.drawableSegments, []);
});
