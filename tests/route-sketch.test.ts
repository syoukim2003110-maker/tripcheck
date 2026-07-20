import assert from "node:assert/strict";
import test from "node:test";
import { buildRouteSketchPoints, routeSketchLine } from "../lib/route-sketch.ts";

test("normalizes route stops into a readable map frame", () => {
  const points = buildRouteSketchPoints([
    { id: "west", name: "West", area: "A", latitude: 35.65, longitude: 139.65 },
    { id: "north", name: "North", area: "B", latitude: 35.75, longitude: 139.75 },
    { id: "east", name: "East", area: "C", latitude: 35.68, longitude: 139.85 },
  ]);

  assert.equal(points.length, 3);
  assert.ok(points.every((point) => point.x >= 12 && point.x <= 88));
  assert.ok(points.every((point) => point.y >= 12 && point.y <= 88));
  assert.equal(points[0].x, 12);
  assert.equal(points[1].y, 12);
});

test("keeps repeated coordinates visible instead of stacking every pin", () => {
  const points = buildRouteSketchPoints([
    { id: "place", name: "Place", area: "A", latitude: 35.7, longitude: 139.7 },
    { id: "meal", name: "Meal", area: "A", latitude: 35.7, longitude: 139.7 },
  ]);

  assert.notDeepEqual([points[0].x, points[0].y], [points[1].x, points[1].y]);
});

test("builds a percentage-based segment with a midpoint label", () => {
  const [from, to] = buildRouteSketchPoints([
    { id: "a", name: "A", area: "A", latitude: 35.6, longitude: 139.6 },
    { id: "b", name: "B", area: "B", latitude: 35.8, longitude: 139.8 },
  ]);
  const line = routeSketchLine(from, to);

  assert.ok(line.width > 0);
  assert.equal(line.labelX, 50);
  assert.equal(line.labelY, 50);
  assert.ok(Number.isFinite(line.angle));
});
