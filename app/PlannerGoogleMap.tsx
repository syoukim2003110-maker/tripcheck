"use client";

/* Google Maps loads at runtime, so this file keeps the API surface deliberately narrow. */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useRef, useState } from "react";
import type { RouteStop } from "../lib/route-optimizer";

type MapLocale = "en" | "ja";
type RouteState = "idle" | "loading" | "live" | "fallback";

type Props = {
  apiKey: string;
  dayKey: string;
  departureTimes: string[];
  locale: MapLocale;
  stops: RouteStop[];
};

declare global {
  interface Window {
    google?: any;
    __tripcheckMapsPromise?: Promise<any>;
  }
}

async function loadGoogleMaps(apiKey: string) {
  if (window.google?.maps?.importLibrary) return window.google;
  if (!apiKey) throw new Error("maps_not_configured");
  if (!window.__tripcheckMapsPromise) {
    window.__tripcheckMapsPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.async = true;
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async`;
        script.onload = () => resolve(window.google);
        script.onerror = () => reject(new Error("maps_unavailable"));
        document.head.append(script);
      });
  }
  return window.__tripcheckMapsPromise;
}

function usableDepartureTime(value: string) {
  const date = new Date(value);
  const deltaDays = (date.getTime() - Date.now()) / 86_400_000;
  return Number.isFinite(deltaDays) && deltaDays >= -7 && deltaDays <= 100 ? date : undefined;
}

export default function PlannerGoogleMap({ apiKey, dayKey, departureTimes, locale, stops }: Props) {
  const mapElement = useRef<HTMLDivElement>(null);
  const [routeState, setRouteState] = useState<RouteState>("idle");

  const embedPoints = stops.length > 0
    ? stops
    : [{ latitude: 36.2048, longitude: 138.2529, name: locale === "ja" ? "日本" : "Japan" }];
  const embedParams = new URLSearchParams({
    language: locale,
    points: embedPoints.map((stop) => `${stop.latitude},${stop.longitude}`).join("|"),
    labels: embedPoints.map((stop) => stop.name).join("|"),
    ...(stops.length === 0 ? { overview: "1", zoom: "5" } : {}),
  });

  useEffect(() => {
    let cancelled = false;
    const overlays: any[] = [];

    async function renderMap() {
      if (!mapElement.current) return;
      setRouteState(stops.length > 1 ? "loading" : "idle");
      try {
        const google = await loadGoogleMaps(apiKey);
        const [{ Map, Polyline }, { LatLngBounds }] = await Promise.all([
          google.maps.importLibrary("maps"),
          google.maps.importLibrary("core"),
        ]);
        if (cancelled || !mapElement.current) return;

        const center = stops.length > 0
          ? { lat: stops[0].latitude, lng: stops[0].longitude }
          : { lat: 36.2048, lng: 138.2529 };
        const map = new Map(mapElement.current, {
          center,
          zoom: stops.length > 0 ? 12 : 5,
          clickableIcons: false,
          fullscreenControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          zoomControl: true,
        });
        const bounds = new LatLngBounds();
        stops.forEach((stop, index) => {
          const position = { lat: stop.latitude, lng: stop.longitude };
          bounds.extend(position);
          overlays.push(new google.maps.Marker({
            map,
            position,
            title: stop.name,
            label: {
              text: index === 0 && stops.length > 1 ? "H" : String(index + (stops.length > 1 ? 0 : 1)),
              color: "#ffffff",
              fontSize: "11px",
              fontWeight: "700",
            },
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              fillColor: index === 0 && stops.length > 1 ? "#2563eb" : "#171717",
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 3,
              scale: 14,
            },
          }));
        });

        if (stops.length === 1) map.setZoom(14);
        if (stops.length > 1) map.fitBounds(bounds, 72);
        if (stops.length < 2) return;

        const directPath = stops.map((stop) => ({ lat: stop.latitude, lng: stop.longitude }));
        const fallbackLine = new Polyline({
          map,
          path: directPath,
          strokeColor: "#64748b",
          strokeOpacity: 0.6,
          strokeWeight: 4,
          zIndex: 2,
        });
        overlays.push(fallbackLine);

        try {
          const { Route } = await google.maps.importLibrary("routes");
          const results = await Promise.all(stops.slice(0, -1).map(async (origin, index) => {
            const destination = stops[index + 1];
            const departureTime = usableDepartureTime(departureTimes[index] ?? "");
            const { routes } = await Route.computeRoutes({
              origin: { lat: origin.latitude, lng: origin.longitude },
              destination: { lat: destination.latitude, lng: destination.longitude },
              travelMode: "TRANSIT",
              ...(departureTime ? { departureTime } : {}),
              transitPreference: {
                allowedTransitModes: ["BUS", "SUBWAY", "TRAIN", "LIGHT_RAIL", "RAIL"],
                routingPreference: "FEWER_TRANSFERS",
              },
              region: "JP",
              language: locale,
              fields: ["path"],
            });
            return routes?.[0]?.path ?? [];
          }));
          if (cancelled || results.some((path) => path.length < 2)) throw new Error("route_unavailable");

          fallbackLine.setMap(null);
          const routeBounds = new LatLngBounds();
          results.forEach((path) => path.forEach((point: any) => routeBounds.extend(point)));
          results.forEach((path) => {
            overlays.push(new Polyline({ map, path, strokeColor: "#172033", strokeOpacity: 0.2, strokeWeight: 11, zIndex: 3 }));
            overlays.push(new Polyline({ map, path, strokeColor: "#2563eb", strokeOpacity: 0.96, strokeWeight: 6, zIndex: 4 }));
          });
          map.fitBounds(routeBounds, 72);
          if (!cancelled) setRouteState("live");
        } catch {
          if (!cancelled) setRouteState("fallback");
        }
      } catch {
        if (!cancelled) setRouteState("fallback");
      }
    }

    void renderMap();
    return () => {
      cancelled = true;
      overlays.forEach((overlay) => overlay.setMap?.(null));
    };
  }, [apiKey, dayKey, departureTimes, locale, stops]);

  const statusText = locale === "ja"
    ? { idle: "Googleマップ", loading: "実経路を取得中", live: "Google実経路", fallback: "Googleルート" }[routeState]
    : { idle: "Google Maps", loading: "Loading real route", live: "Google route", fallback: "Google route" }[routeState];

  return (
    <>
      <div className="planner-map-layers">
        <iframe
          className="planner-map-embed"
          loading="eager"
          referrerPolicy="no-referrer-when-downgrade"
          src={`/api/map-embed?${embedParams.toString()}`}
          title={locale === "ja" ? "旅程のGoogleマップ" : "Itinerary on Google Maps"}
        />
        <div className={`planner-google-map${routeState === "live" ? " is-visible" : ""}`} ref={mapElement} />
      </div>
      <span className={`planner-route-status is-${routeState}`}><i aria-hidden="true" />{statusText}</span>
    </>
  );
}
