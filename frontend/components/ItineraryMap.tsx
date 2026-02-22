"use client";

/**
 * ItineraryMap — full-featured route + environmental heatmap for a single day.
 *
 * IMPORTANT: This component MUST be dynamically imported with { ssr: false }
 * because Leaflet requires `window` and because leaflet.heat is loaded as a
 * side-effect <script> tag after mount. Example usage in a page:
 *
 *   const ItineraryMap = dynamic(() => import("@/components/ItineraryMap"), { ssr: false });
 *
 * leaflet.heat is NOT available as an npm package with working TS types, so it
 * is loaded via CDN inside a useEffect — this makes it safe for SSR/Next.js.
 * L.heatLayer() becomes available on the global L object after the script loads.
 */

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ActivityPoint {
  name:      string;
  time:      string;   // "HH:MM" — used to sort and label
  type:      string;   // outdoor | indoor | dining | transit | hiking | museum
  lat:       number;
  lon:       number;
  riskTier?: string;   // Low | Moderate | High | Very High
  riskScore?: number;
  flags?:    string[];
  betterTime?: string;
  location:  string;   // human-readable location string
}

interface PredStat {
  mean: number; min: number; max: number; p25?: number; p75?: number;
}

export interface ForecastPredictions {
  us_aqi?:              PredStat;
  pm2_5?:               PredStat;
  ozone?:               PredStat;
  temperature_2m?:      PredStat;
  relative_humidity_2m?: PredStat;
}

export interface HourlyEntry {
  hour: number;
  [key: string]: number;
}

export interface ForecastResult {
  city:         string;
  lat:          number;
  lon:          number;
  target_date:  string;
  days_ahead:   number;
  source:       string;
  predictions:  ForecastPredictions;
  hourly_breakdown: HourlyEntry[];
  aqi_category: string;
  data_points_used: number;
}

interface Props {
  activities: ActivityPoint[];   // should be sorted by time before passing in
  forecast:   ForecastResult | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

type MetricKey = "AQI" | "PM2.5" | "Ozone" | "Temp" | "Humidity";

const METRIC_CONFIG: Record<MetricKey, { predKey: keyof ForecastPredictions; max: number; label: string }> = {
  AQI:      { predKey: "us_aqi",              max: 200, label: "AQI" },
  "PM2.5":  { predKey: "pm2_5",               max: 75,  label: "PM2.5" },
  Ozone:    { predKey: "ozone",               max: 150, label: "O₃" },
  Temp:     { predKey: "temperature_2m",      max: 43,  label: "Temp" },
  Humidity: { predKey: "relative_humidity_2m", max: 100, label: "Humidity" },
};

const TIER_COLOR: Record<string, string> = {
  Low:       "#22c55e",
  Moderate:  "#eab308",
  High:      "#f97316",
  "Very High": "#ef4444",
};

// AQI → polyline segment color
function aqiSegmentColor(aqi: number): string {
  if (aqi <= 50)  return "#22c55e"; // Good
  if (aqi <= 100) return "#eab308"; // Moderate
  if (aqi <= 150) return "#f97316"; // Unhealthy for Sensitive
  return "#ef4444";                 // Unhealthy+
}

// Take the worse of two tiers for segment coloring
const TIER_ORDER = ["Low", "Moderate", "High", "Very High"];
function worseTierColor(a?: string, b?: string): string {
  const ia = TIER_ORDER.indexOf(a ?? "Low");
  const ib = TIER_ORDER.indexOf(b ?? "Low");
  return TIER_COLOR[TIER_ORDER[Math.max(ia, ib)]] ?? "#22c55e";
}

// Normalize a value to [0, 1] for heatmap intensity
function normalize(val: number, max: number): number {
  return Math.min(1, Math.max(0, val / max));
}

// ── DivIcon factory ───────────────────────────────────────────────────────────
function numberedIcon(n: number, tier: string = "Low") {
  const bg = TIER_COLOR[tier] ?? "#6366f1";
  return L.divIcon({
    html: `<div style="
      background:${bg};color:#fff;border-radius:50%;
      width:28px;height:28px;display:flex;align-items:center;
      justify-content:center;font-size:12px;font-weight:700;
      border:2px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.5);
    ">${n}</div>`,
    iconSize:   [28, 28],
    iconAnchor: [14, 14],
    className:  "",  // suppress Leaflet default class so our styles aren't overridden
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ItineraryMap({ activities, forecast }: Props) {
  const mapContainerRef  = useRef<HTMLDivElement>(null);
  const mapInstanceRef   = useRef<L.Map | null>(null);
  const heatLayerRef     = useRef<unknown>(null);
  const [heatReady, setHeatReady]     = useState(false);
  const [activeMetric, setActiveMetric] = useState<MetricKey>("AQI");

  // ── Effect 1: load leaflet.heat from CDN as a side-effect script ────────────
  // Must happen after mount (no SSR). L.heatLayer becomes available globally
  // once the script executes — we then flip heatReady to trigger heatmap render.
  useEffect(() => {
    if ((L as unknown as Record<string, unknown>)["heatLayer"]) {
      setHeatReady(true);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js";
    script.async = true;
    script.onload = () => setHeatReady(true);
    document.head.appendChild(script);
    return () => { document.head.removeChild(script); };
  }, []);

  // ── Effect 2: initialise map once, add markers + route polylines ────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, { zoomControl: true });
    mapInstanceRef.current = map;

    // Dark tile layer (matches app's slate theme)
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap © CARTO",
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    if (activities.length === 0) {
      // Nothing to show — center on forecast city or world
      const c: L.LatLngExpression = forecast ? [forecast.lat, forecast.lon] : [20, 0];
      map.setView(c, forecast ? 12 : 2);
      return;
    }

    // Fit the map to the full route
    const allPoints: L.LatLngTuple[] = activities.map((a) => [a.lat, a.lon]);
    map.fitBounds(L.latLngBounds(allPoints), { padding: [40, 40] });

    // ── Numbered stop markers ──────────────────────────────────────────────────
    activities.forEach((act, idx) => {
      const popupHtml = `
        <div style="font-family:sans-serif;min-width:180px">
          <div style="font-weight:700;font-size:13px;margin-bottom:4px">${idx + 1}. ${act.name}</div>
          <div style="color:#94a3b8;font-size:12px;margin-bottom:4px">${act.time} · ${act.location}</div>
          ${act.riskTier
            ? `<div style="font-weight:600;color:${TIER_COLOR[act.riskTier] ?? "#fff"};font-size:12px">${act.riskTier} risk${act.riskScore !== undefined ? ` (${act.riskScore})` : ""}</div>`
            : ""}
          ${(act.flags ?? []).map((f) => `<div style="color:#f97316;font-size:11px;margin-top:2px">⚠ ${f}</div>`).join("")}
          ${act.betterTime ? `<div style="color:#22c55e;font-size:11px;margin-top:4px">💡 ${act.betterTime}</div>` : ""}
        </div>`;

      L.marker([act.lat, act.lon], { icon: numberedIcon(idx + 1, act.riskTier) })
        .addTo(map)
        .bindPopup(popupHtml, { maxWidth: 260 });
    });

    // ── Coloured route segments ────────────────────────────────────────────────
    const forecastAqi = forecast?.predictions?.us_aqi?.p75 ?? 0;
    for (let i = 0; i < activities.length - 1; i++) {
      const from = activities[i];
      const to   = activities[i + 1];
      const segColor = from.riskTier && to.riskTier
        ? worseTierColor(from.riskTier, to.riskTier)
        : aqiSegmentColor(forecastAqi);

      // Straight-line distance (km) for estimated travel time
      const d = map.distance([from.lat, from.lon], [to.lat, to.lon]) / 1000;
      const walkMin = Math.round((d / 5) * 60); // walking ~5 km/h
      const tooltipHtml = `
        <b>${from.name} → ${to.name}</b><br>
        ~${d.toFixed(1)} km · ~${walkMin} min walk<br>
        AQI corridor: ${forecastAqi.toFixed(0)} (${forecast?.aqi_category ?? "–"})
        ${forecast?.predictions?.ozone && conditions_flag(forecast.predictions) ? "<br>⚠ Ozone elevated during transit" : ""}`;

      L.polyline([[from.lat, from.lon], [to.lat, to.lon]], {
        color:   segColor,
        weight:  5,
        opacity: 0.85,
      })
        .addTo(map)
        .bindTooltip(tooltipHtml, { sticky: true, direction: "top" });
    }

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 3: rebuild heatmap layer when metric or heat-plugin changes ───────
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !heatReady || activities.length === 0) return;

    // Remove old heat layer
    if (heatLayerRef.current) {
      map.removeLayer(heatLayerRef.current as L.Layer);
      heatLayerRef.current = null;
    }

    const cfg     = METRIC_CONFIG[activeMetric];
    const predKey = cfg.predKey as string;
    const preds   = forecast?.predictions as Record<string, PredStat | undefined> | undefined;
    const p75Val  = preds?.[predKey]?.p75 ?? preds?.[predKey]?.mean ?? 0;
    const intensity = normalize(p75Val, cfg.max);

    // Build heatmap points — one per activity location
    const heatPoints: [number, number, number][] = activities.map((a) => [
      a.lat + (Math.random() - 0.5) * 0.003, // tiny jitter so overlapping stops show separately
      a.lon + (Math.random() - 0.5) * 0.003,
      intensity,
    ]);

    // L.heatLayer is injected by the CDN script
    const LWithHeat = L as unknown as {
      heatLayer: (points: [number, number, number][], opts: object) => L.Layer;
    };
    heatLayerRef.current = LWithHeat.heatLayer(heatPoints, {
      radius:  50,
      blur:    35,
      maxZoom: 17,
      max:     1.0,
      gradient: { 0.0: "#22c55e", 0.4: "#eab308", 0.7: "#f97316", 1.0: "#ef4444" },
    }).addTo(map);
  }, [activeMetric, heatReady, activities, forecast]);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full rounded-lg overflow-hidden" style={{ height: "360px" }}>
      {/* Map canvas */}
      <div ref={mapContainerRef} className="absolute inset-0" />

      {/* Metric toggle — floating top-right, z-index above Leaflet controls */}
      <div className="absolute top-3 right-3 z-[1000] flex gap-1 bg-slate-900/85 backdrop-blur rounded-lg p-1 border border-slate-700/50">
        {(Object.keys(METRIC_CONFIG) as MetricKey[]).map((m) => (
          <button
            key={m}
            onClick={() => setActiveMetric(m)}
            className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
              activeMetric === m
                ? "bg-teal-600 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {METRIC_CONFIG[m].label}
          </button>
        ))}
      </div>

      {/* Heat plugin loading indicator */}
      {!heatReady && (
        <div className="absolute bottom-3 left-3 z-[1000] text-xs text-slate-500 bg-slate-900/80 px-2 py-1 rounded">
          Loading heatmap…
        </div>
      )}
    </div>
  );
}

// Helper: returns true if ozone is elevated (for corridor tooltip)
function conditions_flag(preds: ForecastPredictions): boolean {
  return (preds.ozone?.p75 ?? preds.ozone?.mean ?? 0) > 70;
}
