export type DecodedRoutePoint = { latitude: number; longitude: number };

/** Decodes Google's 1e-5 encoded polyline without accepting partial input. */
export function decodeGooglePolyline(value: string): DecodedRoutePoint[] {
  if (!value) return [];
  const points: DecodedRoutePoint[] = [];
  let cursor = 0;
  let latitude = 0;
  let longitude = 0;

  const readDelta = () => {
    let result = 0;
    let shift = 0;
    while (cursor < value.length && shift <= 30) {
      const chunk = value.charCodeAt(cursor) - 63;
      cursor += 1;
      if (chunk < 0 || chunk > 63) return null;
      result |= (chunk & 0x1f) << shift;
      if (chunk < 0x20) return (result & 1) ? ~(result >> 1) : result >> 1;
      shift += 5;
    }
    return null;
  };

  while (cursor < value.length) {
    const latitudeDelta = readDelta();
    const longitudeDelta = readDelta();
    if (latitudeDelta === null || longitudeDelta === null) return [];
    latitude += latitudeDelta;
    longitude += longitudeDelta;
    points.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
  }
  return points;
}
