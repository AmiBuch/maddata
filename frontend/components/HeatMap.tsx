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
  riskScore: number;         // 0–100 for color intensity
  route?: [number, number][]; // optional planned route polyline
}

// Generate fake heatmap cells around center for demo
function generateHeatCells(center: [number, number], score: number) {
  const cells: [number, number, number][] = []; // [lat, lon, intensity]
  const spread = 0.05;
  for (let i = 0; i < 40; i++) {
    const lat = center[0] + (Math.random() - 0.5) * spread * 2;
    const lon = center[1] + (Math.random() - 0.5) * spread * 2;
    const intensity = (score / 100) * (0.4 + Math.random() * 0.6);
    cells.push([lat, lon, intensity]);
  }
  return cells;
}

export default function HeatMap({ center, riskScore, route }: HeatMapProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      center,
      zoom: 13,
      zoomControl: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap © CARTO",
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    // Color-coded circle markers as heatmap proxy (leaflet.heat not in npm)
    const cells = generateHeatCells(center, riskScore);
    cells.forEach(([lat, lon, intensity]) => {
      const hue = Math.round((1 - intensity) * 120); // green → red
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
      fillColor: "#14b8a6",
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
