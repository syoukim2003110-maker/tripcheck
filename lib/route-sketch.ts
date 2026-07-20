export type RouteSketchSource = {
  id: string;
  name: string;
  area: string;
  latitude: number;
  longitude: number;
};

export type RouteSketchPoint = RouteSketchSource & {
  x: number;
  y: number;
};

const MIN = 12;
const MAX = 88;

function clamp(value: number) {
  return Math.max(MIN, Math.min(MAX, value));
}

export function buildRouteSketchPoints(stops: RouteSketchSource[]): RouteSketchPoint[] {
  if (stops.length === 0) return [];
  if (stops.length === 1) return [{ ...stops[0], x: 50, y: 50 }];

  const latitudes = stops.map((stop) => stop.latitude);
  const longitudes = stops.map((stop) => stop.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const latitudeSpan = maxLatitude - minLatitude;
  const longitudeSpan = maxLongitude - minLongitude;

  return stops.map((stop, index) => {
    const x = longitudeSpan < 0.00001
      ? MIN + ((MAX - MIN) * index) / Math.max(1, stops.length - 1)
      : MIN + ((stop.longitude - minLongitude) / longitudeSpan) * (MAX - MIN);
    const y = latitudeSpan < 0.00001
      ? 50 + (index % 2 === 0 ? -7 : 7)
      : MAX - ((stop.latitude - minLatitude) / latitudeSpan) * (MAX - MIN);

    const collisionCount = stops.slice(0, index).filter((other) => (
      Math.abs(other.latitude - stop.latitude) < 0.00001
      && Math.abs(other.longitude - stop.longitude) < 0.00001
    )).length;

    return {
      ...stop,
      x: clamp(x + collisionCount * 7),
      y: clamp(y + collisionCount * 6),
    };
  });
}

export function routeSketchLine(from: RouteSketchPoint, to: RouteSketchPoint, heightRatio = 0.62) {
  const dx = to.x - from.x;
  const scaledDy = (to.y - from.y) * heightRatio;
  return {
    left: from.x,
    top: from.y,
    width: Math.hypot(dx, scaledDy),
    angle: Math.atan2(scaledDy, dx) * (180 / Math.PI),
    labelX: (from.x + to.x) / 2,
    labelY: (from.y + to.y) / 2,
  };
}
