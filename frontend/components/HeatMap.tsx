"use client";

/**
 * Leaflet-based heatmap component.
 * Dynamically imported (no SSR) because Leaflet requires window.
 */
import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface HeatMapProps {
  center: [number, number];
  riskScore: number;         // 0-100 for color intensity
  aqi?: number;              // actual AQI value for realistic coloring
  route?: [number, number][]; // optional planned route polyline
}

/** Generate heatmap cells around center using actual AQI for realistic visualization. */
function generateHeatCells(center: [number, number], aqi: number, riskScore: number) {
  const cells: [number, number, number][] = []; // [lat, lon, intensity]
  const spread = 0.05;
  // Normalize AQI to 0-1 intensity (AQI 0=green, 200+=red)
  const baseIntensity = aqi > 0 ? Math.min(aqi / 200, 1) : riskScore / 100;
  for (let i = 0; i < 50; i++) {
    const lat = center[0] + (Math.random() - 0.5) * spread * 2;
    const lon = center[1] + (Math.random() - 0.5) * spread * 2;
    // Vary intensity +/- 30% around the real AQI-based value
    const intensity = Math.max(0.05, baseIntensity * (0.7 + Math.random() * 0.6));
    cells.push([lat, lon, intensity]);
  }
  return cells;
}

export default function HeatMap({ center, riskScore, aqi, route }: HeatMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center,
      zoom: 13,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "\u00a9 OpenStreetMap \u00a9 CARTO",
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    // Color-coded circle markers as heatmap proxy
    const cells = generateHeatCells(center, aqi ?? 0, riskScore);
    cells.forEach(([lat, lon, intensity]) => {
      const hue = Math.round((1 - intensity) * 120); // green -> red
      L.circleMarker([lat, lon], {
        radius: 18,
        fillColor: `hsl(${hue}, 80%, 50%)`,
        fillOpacity: 0.35,
        stroke: false,
        color: "transparent",
      }).addTo(map);
    });

    // User location marker
    L.circleMarker(center, {
      radius: 8,
      fillColor: "#6a8ce8",
      fillOpacity: 1,
      color: "#fff",
      weight: 2,
    })
      .addTo(map)
      .bindPopup("You are here")
      .openPopup();

    // Optional route overlay
    if (route && route.length > 1) {
      L.polyline(route, { color: "#818cf8", weight: 4, opacity: 0.85 })
        .addTo(map)
        .bindPopup("Your planned route");
    }

    mapInstanceRef.current = map;
    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={mapRef} style={{ height: "100%", width: "100%", borderRadius: "0.5rem" }} />;
}
