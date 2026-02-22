"use client";

/**
 * PredictiveMapLeaflet — Interactive map using Leaflet.js with LayerGroup-based
 * single-selection toggles for predictive datasets and an always-visible user route.
 *
 * LAYERS (Leaflet LayerGroups):
 * - Air Quality: L.layerGroup() of circle markers (heatmap-style by AQI); supports timeseries animation.
 * - Outbreak Activity: L.layerGroup() of circle markers.
 * - Historical Risk: L.layerGroup() of polygon layers (risk-colored).
 * - User route overlay: L.polyline / L.geoJSON always on the map; not part of toggle.
 * - Intersection markers: L.layerGroup() of points where route crosses high-risk zones (shown when Historical Risk is selected).
 *
 * SINGLE-SELECTION: Only one of Air Quality, Outbreak, or Historical Risk is visible at a time.
 * Toggling is done by adding/removing the corresponding LayerGroup from the map.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet.heat";
import "leaflet/dist/leaflet.css";
import * as turf from "@turf/turf";

// ---------------------------------------------------------------------------
// GeoJSON types (minimal, no @types/geojson required)
// ---------------------------------------------------------------------------

interface GeoJSONPoint {
  type: "Point";
  coordinates: number[];
}
interface GeoJSONLineString {
  type: "LineString";
  coordinates: number[][];
}
interface GeoJSONPolygon {
  type: "Polygon";
  coordinates: number[][][];
}
interface Feature<G = GeoJSONPoint | GeoJSONLineString | GeoJSONPolygon> {
  type: "Feature";
  geometry: G;
  properties?: Record<string, unknown> | null;
}
interface FeatureCollection {
  type: "FeatureCollection";
  features: Feature[];
}
type LineString = GeoJSONLineString;
type Polygon = GeoJSONPolygon;

// ---------------------------------------------------------------------------
// Props and layer key type
// ---------------------------------------------------------------------------

export type PredictiveLayerKey = "airQuality" | "outbreak" | "historicalRisk" | null;


export interface PredictiveMapLeafletProps {
  userRouteGeoJSON?: FeatureCollection | Feature<LineString>;
  airQualityGeoJSON?: FeatureCollection;
  airQualityTimeseries?: FeatureCollection[];
  outbreakGeoJSON?: FeatureCollection;
  historicalRiskGeoJSON?: FeatureCollection;
  center?: [number, number];
  initialZoom?: number;
  className?: string;
}

// ---------------------------------------------------------------------------
// Mock GeoJSON for demo (map renders immediately without props)
// ---------------------------------------------------------------------------

const MOCK_CENTER: [number, number] = [41.8781, -87.6298]; // [lat, lng] for Leaflet

function getMockRoute(): Feature<LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: [
        [-87.64, 41.88],
        [-87.63, 41.875],
        [-87.62, 41.877],
        [-87.61, 41.879],
        [-87.6, 41.878],
      ],
    },
  };
}

function getMockAirQuality(): FeatureCollection {
  const base = MOCK_CENTER;
  const features = Array.from({ length: 80 }, (_, i) => ({
    type: "Feature" as const,
    properties: { aqi: 30 + Math.random() * 120, weight: 0.5 + Math.random() * 0.5 },
    geometry: {
      type: "Point" as const,
      coordinates: [base[1] + (Math.random() - 0.5) * 0.08, base[0] + (Math.random() - 0.5) * 0.06],
    },
  }));
  return { type: "FeatureCollection", features };
}

function getMockAirQualityTimeseries(): FeatureCollection[] {
  return [0, 1, 2].map((t) => {
    const base = MOCK_CENTER;
    const features = Array.from({ length: 50 }, () => ({
      type: "Feature" as const,
      properties: {
        aqi: 40 + t * 25 + Math.random() * 40,
        weight: 0.5 + Math.random() * 0.5,
      },
      geometry: {
        type: "Point" as const,
        coordinates: [base[1] + (Math.random() - 0.5) * 0.07, base[0] + (Math.random() - 0.5) * 0.05],
      },
    }));
    return { type: "FeatureCollection", features };
  });
}

function getMockOutbreaks(): FeatureCollection {
  const base = MOCK_CENTER;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "Site A", cases: 12 },
        geometry: { type: "Point", coordinates: [base[1] - 0.015, base[0] + 0.01] },
      },
      {
        type: "Feature",
        properties: { name: "Site B", cases: 5 },
        geometry: { type: "Point", coordinates: [base[1] + 0.01, base[0] - 0.008] },
      },
      {
        type: "Feature",
        properties: { name: "Site C", cases: 8 },
        geometry: { type: "Point", coordinates: [base[1] + 0.02, base[0] + 0.012] },
      },
    ],
  };
}

function getMockHistoricalRisk(): FeatureCollection {
  const base = MOCK_CENTER;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { risk: "high", level: 3 },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [base[1] - 0.02, base[0] + 0.015],
              [base[1] - 0.005, base[0] + 0.015],
              [base[1] - 0.005, base[0] + 0.005],
              [base[1] - 0.02, base[0] + 0.005],
              [base[1] - 0.02, base[0] + 0.015],
            ],
          ],
        },
      },
      {
        type: "Feature",
        properties: { risk: "medium", level: 2 },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [base[1] + 0.005, base[0] - 0.01],
              [base[1] + 0.025, base[0] - 0.01],
              [base[1] + 0.025, base[0] + 0.005],
              [base[1] + 0.005, base[0] + 0.005],
              [base[1] + 0.005, base[0] - 0.01],
            ],
          ],
        },
      },
      {
        type: "Feature",
        properties: { risk: "low", level: 1 },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [base[1] - 0.01, base[0] - 0.02],
              [base[1] + 0.02, base[0] - 0.02],
              [base[1] + 0.02, base[0] - 0.005],
              [base[1] - 0.01, base[0] - 0.005],
              [base[1] - 0.01, base[0] - 0.02],
            ],
          ],
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Helpers: route as LineString, Turf intersection, risk color
// ---------------------------------------------------------------------------

function routeToLineString(
  route: FeatureCollection | Feature<LineString> | undefined
): Feature<LineString> | null {
  if (!route) return null;
  if (route.type === "Feature" && route.geometry?.type === "LineString")
    return route as Feature<LineString>;
  if (route.type === "FeatureCollection" && route.features?.length) {
    const first = route.features[0];
    if (first?.geometry?.type === "LineString") return first as Feature<LineString>;
  }
  return null;
}

/** GeoJSON Point features where route line intersects high-risk polygon boundaries. */
function getRouteRiskIntersections(
  routeLine: Feature<LineString>,
  riskFC: FeatureCollection
): FeatureCollection {
  const points: Feature[] = [];
  const riskFeatures = riskFC?.features ?? [];
  const highRiskFeatures = riskFeatures.filter((f) => {
    const p = f.properties as Record<string, unknown> | null;
    if (!p) return false;
    return p.risk === "high" || (typeof p.level === "number" && p.level >= 3);
  });

  for (const poly of highRiskFeatures) {
    if (poly.geometry?.type !== "Polygon") continue;
    const line = turf.polygonToLine(
      poly as Parameters<typeof turf.polygonToLine>[0]
    );
    const crossed = turf.lineIntersect(
      routeLine as Parameters<typeof turf.lineIntersect>[0],
      line as Parameters<typeof turf.lineIntersect>[1]
    );
    if (crossed.features.length)
      points.push(...(crossed.features as Feature[]));
  }

  return { type: "FeatureCollection", features: points };
}

function routeIntersectsHighRisk(
  routeLine: Feature<LineString>,
  riskFC: FeatureCollection
): boolean {
  const riskFeatures = riskFC?.features ?? [];
  const highRiskFeatures = riskFeatures.filter((f) => {
    const p = f.properties as Record<string, unknown> | null;
    return (
      p?.risk === "high" || (typeof p?.level === "number" && p.level >= 3)
    );
  });
  for (const poly of highRiskFeatures) {
    if (
      poly.geometry?.type === "Polygon" &&
      turf.booleanIntersects(
        routeLine as Parameters<typeof turf.booleanIntersects>[0],
        poly as Parameters<typeof turf.booleanIntersects>[1]
      )
    )
      return true;
  }
  return false;
}

function riskToColor(risk: string): string {
  switch (risk?.toLowerCase()) {
    case "high":
      return "#dc2626";
    case "medium":
      return "#f59e0b";
    case "low":
      return "#22c55e";
    default:
      return "#6b7280";
  }
}

/** AQI value to color (green → yellow → red). */
function aqiToColor(aqi: number): string {
  if (aqi <= 50) return "#22c55e";
  if (aqi <= 100) return "#eab308";
  if (aqi <= 150) return "#f97316";
  return "#dc2626";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PredictiveMapLeaflet({
  userRouteGeoJSON,
  airQualityGeoJSON,
  airQualityTimeseries,
  outbreakGeoJSON,
  historicalRiskGeoJSON,
  center = MOCK_CENTER,
  initialZoom = 12,
  className = "",
}: PredictiveMapLeafletProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.Polyline | null>(null);
  const airQualityGroupRef = useRef<L.LayerGroup | null>(null);
  const outbreakGroupRef = useRef<L.LayerGroup | null>(null);
  const historicalRiskGroupRef = useRef<L.LayerGroup | null>(null);
  const intersectionGroupRef = useRef<L.LayerGroup | null>(null);
  const initializedRef = useRef(false);
  const boundsAppliedRef = useRef(false);
  // Single-selection: only one predictive layer visible at a time. Default = Air Quality.
  const [selectedLayer, setSelectedLayer] = useState<PredictiveLayerKey>("airQuality");

  // AQI timeseries animation (only when Air Quality layer is selected)
  const [aqiTimeIndex, setAqiTimeIndex] = useState(0);
  const [aqiPlaying, setAqiPlaying] = useState(false);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null); //for users active location marker
  const userMarkerRef = useRef<L.CircleMarker | null>(null);

  const routeData = userRouteGeoJSON ?? getMockRoute();
  const routeLine = routeToLineString(routeData);
  const airQualityFrames =
    airQualityTimeseries && airQualityTimeseries.length > 0
      ? airQualityTimeseries
      : [airQualityGeoJSON ?? getMockAirQuality()];
  const aqiData =
    airQualityFrames[Math.min(aqiTimeIndex, airQualityFrames.length - 1)] ??
    airQualityFrames[0];
  const outbreakData = outbreakGeoJSON ?? getMockOutbreaks();
  const historicalRiskData =
    historicalRiskGeoJSON ?? getMockHistoricalRisk();
  const hasAqiTimeseries =
    Boolean(airQualityTimeseries) && airQualityTimeseries!.length > 1;

  // Build Air Quality LayerGroup from current aqiData (circles by AQI)
  const updateAirQualityLayer = useCallback(() => {
    const group = airQualityGroupRef.current;
    if (!group) return;
    group.clearLayers();
    const fc = aqiData;
    if (!fc?.features) return;

    const aqiValues = fc.features.map(
      (f) => Number((f.properties as any)?.aqi ?? 0)
    );
    const maxAqi = Math.max(...aqiValues, 50);  

    const heatPoints: [number, number, number][] = fc.features
    .filter(f => f.geometry?.type === 'Point')
    .map(f => {
      // TS assertion: coordinates is [lng, lat]
      const coords = f.geometry!.coordinates as [number, number];
      const [lng, lat] = coords;
      const aqi = Number((f.properties as any)?.aqi ?? 0);
      const intensity = Math.min((aqi / maxAqi) * 1.2, 1.2);
      return [lat, lng, intensity];
    });
  
    if (!heatPoints.length) return;
  
    const heatLayer = (L as any).heatLayer(heatPoints, {
      radius: 30,
      blur: 10,
      maxZoom: 16,
      gradient: {
        0.0: '#22c55e', // green → AQI good
        0.4: '#facc15', // yellow → AQI moderate
        0.7: '#f97316', // orange → AQI unhealthy for sensitive
        1.0: '#dc2626', // red → AQI bad
      },
    });
  
    group.addLayer(heatLayer);
  }, [aqiData]);

  // Build Outbreak LayerGroup
  const updateOutbreakLayer = useCallback(() => {
    const group = outbreakGroupRef.current;
    if (!group) return;
    group.clearLayers();
    outbreakData.features.forEach((f) => {
      if (f.geometry?.type !== "Point") return;
      const [lng, lat] = f.geometry.coordinates;
      const cases = Number((f.properties as Record<string, unknown>)?.cases ?? 3);
      const name = String((f.properties as Record<string, unknown>)?.name ?? "Outbreak");
      const marker = L.circleMarker([lat, lng], {
        radius: 6 + cases,
        fillColor: "#a855f7",
        fillOpacity: 0.8,
        color: "#fff",
        weight: 2,
      });
      marker.bindPopup(`${name}: ${cases} cases`);
      group.addLayer(marker);
    });
  }, [outbreakData]);

  // Build Historical Risk LayerGroup (polygons)
  const updateHistoricalRiskLayer = useCallback(() => {
    const group = historicalRiskGroupRef.current;
    if (!group) return;
    group.clearLayers();
    historicalRiskData.features.forEach((f) => {
      if (f.geometry?.type !== "Polygon") return;
      const risk = String((f.properties as Record<string, unknown>)?.risk ?? "");
      const color = riskToColor(risk);
      const latLngs = f.geometry.coordinates[0].map(([lng, lat]) => [
        lat,
        lng,
      ]) as [number, number][];
      const poly = L.polygon(latLngs, {
        color,
        fillColor: color,
        fillOpacity: 0.35,
        weight: 2,
      });
      poly.bindPopup(`Risk: ${risk}`);
      group.addLayer(poly);
    });
  }, [historicalRiskData]);

  // Build intersection points LayerGroup (route × high-risk zones)
  const updateIntersectionLayer = useCallback(() => {
    const group = intersectionGroupRef.current;
    if (!group || !routeLine) return;
    group.clearLayers();
    const intersections = getRouteRiskIntersections(routeLine, historicalRiskData);
    intersections.features.forEach((f) => {
      if (f.geometry?.type !== "Point") return;
      const [lng, lat] = f.geometry.coordinates;
      const marker = L.circleMarker([lat, lng], {
        radius: 10,
        fillColor: "#ef4444",
        fillOpacity: 0.9,
        color: "#fff",
        weight: 3,
      });
      marker.bindPopup("Route crosses high-risk zone");
      group.addLayer(marker);
    });
  }, [routeLine, historicalRiskData]);

  /** Single-selection: show only the selected predictive layer; route stays. */
  const applyLayerVisibility = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const aq = airQualityGroupRef.current;
    const ob = outbreakGroupRef.current;
    const hr = historicalRiskGroupRef.current;
    const int = intersectionGroupRef.current;

    [aq, ob, hr].forEach((g) => {
      if (g && map.hasLayer(g)) map.removeLayer(g);
    });
    if (int && map.hasLayer(int)) map.removeLayer(int);

    if (selectedLayer === "airQuality" && aq) map.addLayer(aq);
    if (selectedLayer === "outbreak" && ob) map.addLayer(ob);
    if (selectedLayer === "historicalRisk") {
      if (hr) map.addLayer(hr);
      if (int) map.addLayer(int);
    }
  }, [selectedLayer]);

  const selectLayer = useCallback((key: PredictiveLayerKey) => {
    setSelectedLayer((prev) => (prev === key ? null : key));
  }, []);

  const updateAirQualityFrame = useCallback(() => {
    setAqiTimeIndex((i) => (i + 1) % airQualityFrames.length);
  }, [airQualityFrames.length]);

  //Initialize location 
  useEffect(() => {
    if (!navigator.geolocation) {
      console.warn("Geolocation not supported, using default location.");
      setUserLocation(center);
      return;
    }
  
    navigator.geolocation.watchPosition(
      (pos) => {
        setUserLocation([pos.coords.latitude, pos.coords.longitude]);
      },
      (err) => console.warn(err),
      { enableHighAccuracy: true }
    );
  }, []);

  // Initialize map and LayerGroups once
  useEffect(() => {
    if (!mapContainerRef.current || initializedRef.current || !userLocation) return;
  
    const map = L.map(mapContainerRef.current, { center: userLocation, zoom: initialZoom });
  
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap © CARTO",
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

        // Add user location marker
        const userMarker = L.circleMarker(userLocation, {
          radius: 8,
          fillColor: "#14b8a6",
          fillOpacity: 1,
          color: "#ffffff",
          weight: 2,
        }).addTo(map);
    
        userMarker.bindPopup("You are here", { autoClose: false, closeOnClick: false })
        .openPopup();
        userMarkerRef.current = userMarker;
  
    mapRef.current = map;
    //Button to recenter
          // --- Recenter Control
  const RecenterControl = L.Control.extend({
    options: { position: "topright" },

    onAdd: function () {
      const container = L.DomUtil.create(
        "div",
        "leaflet-bar leaflet-control"
      );

      container.style.backgroundColor = "#0f172a";
      container.style.width = "42px";
      container.style.height = "42px";
      container.style.fontSize = "18px";
      container.style.display = "flex";
      container.style.alignItems = "center";
      container.style.justifyContent = "center";
      container.style.cursor = "pointer";
      container.title = "Recenter to your location";

      container.innerHTML = "📍";

          // --- Create hover label
      const label = L.DomUtil.create("div", "", container);
      label.innerText = "Recenter";
      label.style.position = "absolute";
      label.style.right = "40px";
      label.style.top = "50%";
      label.style.transform = "translateY(-50%)";
      label.style.background = "#ffffff";
      label.style.color = "#000000";
      label.style.padding = "4px 8px";
      label.style.borderRadius = "6px";
      label.style.fontSize = "12px";
      label.style.whiteSpace = "nowrap";
      label.style.opacity = "0";
      label.style.pointerEvents = "none";
      label.style.transition = "opacity 0.2s ease";

      // Show on hover
      container.onmouseenter = () => {
        label.style.opacity = "1";
      };

      container.onmouseleave = () => {
        label.style.opacity = "0";
      };
      
        L.DomEvent.disableClickPropagation(container);

        container.onclick = () => {
          if (userLocation) {
            map.setView(userLocation, map.getZoom(), { animate: true });
          }
        };
        return container;
      },
    });
    map.addControl(new RecenterControl());

    // --- User route overlay
    if (routeLine?.geometry?.coordinates?.length) {
      const coords = routeLine.geometry.coordinates.map(([lng, lat]) => [lat, lng]) as [number, number][];
      const intersectsHigh = routeIntersectsHighRisk(routeLine, historicalRiskData);
      const routeLayer = L.polyline(coords, {
        color: intersectsHigh ? "#ef4444" : "#818cf8",
        weight: 4,
        opacity: 0.9,
      }).addTo(map);
      routeLayerRef.current = routeLayer;
    }
  
    // --- LayerGroups
    airQualityGroupRef.current = L.layerGroup();
    outbreakGroupRef.current = L.layerGroup();
    historicalRiskGroupRef.current = L.layerGroup();
    intersectionGroupRef.current = L.layerGroup();
  
    return () => {
      map.remove();
      mapRef.current = null;
      routeLayerRef.current = null;
      airQualityGroupRef.current = null;
      outbreakGroupRef.current = null;
      historicalRiskGroupRef.current = null;
      intersectionGroupRef.current = null;
      initializedRef.current = false;
    };
  }, [userLocation]); // <-- wait for actual user location

  // Populate LayerGroups and apply visibility when data or selection changes
  useEffect(() => {
    updateAirQualityLayer();
    updateOutbreakLayer();
    updateHistoricalRiskLayer();
    updateIntersectionLayer();
    applyLayerVisibility();
  }, [
    updateAirQualityLayer,
    updateOutbreakLayer,
    updateHistoricalRiskLayer,
    updateIntersectionLayer,
    applyLayerVisibility,
  ]);

  // AQI timeseries animation: only when Air Quality is selected and playing
  useEffect(() => {
    const shouldAnimate =
      selectedLayer === "airQuality" && aqiPlaying && hasAqiTimeseries;
    if (!shouldAnimate) {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
      return;
    }
    playIntervalRef.current = setInterval(updateAirQualityFrame, 1500);
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [selectedLayer, aqiPlaying, hasAqiTimeseries, updateAirQualityFrame]);

  // Update route line color when risk data changes (intersection highlight)
  useEffect(() => {
    const map = mapRef.current;
    const routeLayer = routeLayerRef.current;
    if (!map || !routeLayer || !routeLine || !map.hasLayer(routeLayer)) return;
    const intersectsHigh = routeIntersectsHighRisk(routeLine, historicalRiskData);
    routeLayer.setStyle({
      color: intersectsHigh ? "#ef4444" : "#818cf8",
    });
  }, [routeLine, historicalRiskData]);

  // Fit bounds to route when map is ready
  useEffect(() => {
    const map = mapRef.current;
  if (!map || !routeLine?.geometry?.coordinates?.length) return;

  // Only fit bounds once on initial load
  if (boundsAppliedRef.current) return;

  const coords = routeLine.geometry.coordinates;
  const bounds = L.latLngBounds(
    coords.map(([lng, lat]) => [lat, lng] as [number, number])
  );
  map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });

  boundsAppliedRef.current = true; // mark that we've applied bounds
}, [routeLine]);

  return (
    <div className={`flex flex-col gap-3 ${className}`}>
      {/* Single-selection layer toggle: radio buttons. Only one predictive layer visible at a time. */}
      <div className="flex flex-wrap items-center gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
          {[
            { key: "airQuality", label: "Air Quality", activeClass: "bg-teal-600 text-white" },
            { key: "outbreak", label: "Outbreak Activity", activeClass: "bg-teal-600 text-white" },
            { key: "historicalRisk", label: "Historical Risk", activeClass: "bg-teal-600 text-white" },
          ].map(({ key, label, activeClass }) => {
            const active = selectedLayer === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => selectLayer(key as PredictiveLayerKey)}
                className={`px-3 py-1 rounded text-sm font-medium transition
                  ${
                    active
                      ? activeClass
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  }`}
              >
                {label}
              </button>
            );
          })}
        </div>
     
        {selectedLayer === "historicalRisk" &&
          routeLine &&
          routeIntersectsHighRisk(routeLine, historicalRiskData) && (
            <span className="text-amber-400 text-xs font-medium flex items-center gap-1">
              Route crosses high-risk zone
            </span>
          )}

        {hasAqiTimeseries && selectedLayer === "airQuality" && (
          <div className="flex items-center gap-2 ml-auto pl-4 border-l border-slate-700">
            <button
              type="button"
              onClick={() => setAqiPlaying((p) => !p)}
              className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-medium"
            >
              {aqiPlaying ? "Pause" : "Play"}
            </button>
            <input
              type="range"
              min={0}
              max={airQualityFrames.length - 1}
              value={aqiTimeIndex}
              onChange={(e) => setAqiTimeIndex(Number(e.target.value))}
              className="w-24 h-2 rounded accent-teal-500"
            />
            <span className="text-slate-500 text-xs">
              {aqiTimeIndex + 1} / {airQualityFrames.length}
            </span>
          </div>
        )}
      </div>

      <div
        ref={mapContainerRef}
        className="w-full min-h-[320px] rounded-xl overflow-hidden bg-slate-900 leaflet-container"
        style={{ flex: "1 1 320px" }}
      />
    </div>
  );
}
