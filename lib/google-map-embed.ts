import type { Destination } from "./destinations.ts";
import { destinationById, isDestinationId } from "./destinations.ts";

export type MapEmbedRequest = {
  points: Array<{ latitude: number; longitude: number; label?: string }>;
  language: "en" | "ja";
  zoom?: number;
  overview?: boolean;
  /** Region bias and label suffix; "worldwide" when the country is unknown. */
  destination: Destination;
};

export function parseMapEmbedRequest(url: string): MapEmbedRequest | null {
  const parsed = new URL(url);
  const language = parsed.searchParams.get("language") === "ja" ? "ja" : "en";
  const rawPoints = parsed.searchParams.get("points")?.split("|").filter(Boolean) ?? [];
  if (rawPoints.length === 0 || rawPoints.length > 10) return null;
  const rawLabels = parsed.searchParams.get("labels")?.split("|") ?? [];
  if (rawLabels.length > 0 && rawLabels.length !== rawPoints.length) return null;
  const points = rawPoints.map((rawPoint) => {
    const [latitudeText, longitudeText] = rawPoint.split(",");
    const latitude = Number(latitudeText);
    const longitude = Number(longitudeText);
    return { latitude, longitude };
  });
  if (points.some(({ latitude, longitude }) => (
    !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180
  ))) return null;
  const labels = rawLabels.map((label) => label.trim());
  if (labels.some((label) => label.length === 0 || label.length > 120)) return null;
  const rawZoom = parsed.searchParams.get("zoom");
  const zoom = rawZoom ? Number(rawZoom) : undefined;
  if (zoom !== undefined && (!Number.isInteger(zoom) || zoom < 1 || zoom > 18)) return null;
  const overview = parsed.searchParams.get("overview") === "1";
  const rawDestination = parsed.searchParams.get("destination");
  if (rawDestination !== null && !isDestinationId(rawDestination)) return null;
  return {
    points: points.map((point, index) => ({ ...point, ...(labels[index] ? { label: labels[index] } : {}) })),
    language,
    ...(zoom ? { zoom } : {}),
    ...(overview ? { overview } : {}),
    destination: destinationById(rawDestination),
  };
}

export function buildGoogleMapEmbedUrl(request: MapEmbedRequest, apiKey: string) {
  const coordinate = ({ latitude, longitude }: MapEmbedRequest["points"][number]) => `${latitude},${longitude}`;
  const { regionCode, querySuffix: labelSuffix } = request.destination;
  const withRegion = (params: URLSearchParams) => {
    if (regionCode) params.set("region", regionCode);
    return params;
  };
  if (request.overview && request.points.length === 1) {
    const params = withRegion(new URLSearchParams({
      key: apiKey,
      center: coordinate(request.points[0]),
      zoom: String(request.zoom ?? request.destination.overviewZoom),
      maptype: "roadmap",
      language: request.language,
    }));
    return `https://www.google.com/maps/embed/v1/view?${params.toString()}`;
  }
  if (request.points.length === 1) {
    const params = withRegion(new URLSearchParams({
      key: apiKey,
      q: coordinate(request.points[0]),
      zoom: String(request.zoom ?? 14),
      language: request.language,
    }));
    return `https://www.google.com/maps/embed/v1/place?${params.toString()}`;
  }
  const params = withRegion(new URLSearchParams({
    key: apiKey,
    origin: coordinate(request.points[0]),
    destination: coordinate(request.points.at(-1)!),
    mode: request.destination.mobility === "car_first" ? "driving" : "transit",
    language: request.language,
  }));
  if (request.points.length > 2) {
    params.set("waypoints", request.points.slice(1, -1).map((point) => (
      point.label ? (labelSuffix ? `${point.label}, ${labelSuffix}` : point.label) : coordinate(point)
    )).join("|"));
  }
  return `https://www.google.com/maps/embed/v1/directions?${params.toString()}`;
}
