export type MapEmbedRequest = {
  points: Array<{ latitude: number; longitude: number }>;
  language: "en" | "ja";
};

export function parseMapEmbedRequest(url: string): MapEmbedRequest | null {
  const parsed = new URL(url);
  const language = parsed.searchParams.get("language") === "ja" ? "ja" : "en";
  const rawPoints = parsed.searchParams.get("points")?.split("|").filter(Boolean) ?? [];
  if (rawPoints.length === 0 || rawPoints.length > 10) return null;
  const points = rawPoints.map((rawPoint) => {
    const [latitudeText, longitudeText] = rawPoint.split(",");
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    return { latitude, longitude };
  });
  if (points.some(({ latitude, longitude }) => (
    !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < 20 || latitude > 46 || longitude < 122 || longitude > 154
  ))) return null;
  return { points, language };
}

export function buildGoogleMapEmbedUrl(request: MapEmbedRequest, apiKey: string) {
  const coordinate = ({ latitude, longitude }: MapEmbedRequest["points"][number]) => `${latitude},${longitude}`;
  if (request.points.length === 1) {
    const params = new URLSearchParams({
      key: apiKey,
      q: coordinate(request.points[0]),
      zoom: "14",
      language: request.language,
      region: "JP",
    });
    return `https://www.google.com/maps/embed/v1/place?${params.toString()}`;
  }
  const params = new URLSearchParams({
    key: apiKey,
    origin: coordinate(request.points[0]),
    destination: coordinate(request.points.at(-1)!),
    mode: "transit",
    language: request.language,
    region: "JP",
  });
  if (request.points.length > 2) {
    params.set("waypoints", request.points.slice(1, -1).map(coordinate).join("|"));
  }
  return `https://www.google.com/maps/embed/v1/directions?${params.toString()}`;
}
