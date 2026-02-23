"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { Wind, Map, MessageSquare, ChevronRight, PlusSquare } from "lucide-react";
import { useEffect, useState } from "react";
import axios from "axios";

// Map only runs in browser (Leaflet needs window)
const PredictiveMapLeaflet = dynamic(() => import("@/components/PredictiveMapLeaflet"), { ssr: false });

const SCREENS = [
  {
    href: "/now",
    icon: Wind,
    title: "Right Now",
    description: "Live air quality, weather, and health risk at your current location.",
    color: "text-brand-500",
    bg: "bg-brand-50 border-brand-200",
  },
  {
    href: "/itinerary",
    icon: Map,
    title: "Upload Itinerary",
    description: "Upload your travel plans and get a day-by-day health risk forecast.",
    color: "text-accent-periwinkle",
    bg: "bg-purple-50 border-purple-200",
  },
  {
    href: "/plan",
    icon: MessageSquare,
    title: "Plan with Pathfinder",
    description: "Get personalized recommendations for restaurants and activities.",
    color: "text-accent-aqua",
    bg: "bg-cyan-50 border-cyan-200",
  },
];

interface ConditionsAqi {
  aqi: number;
  pm25?: number;
  ozone?: number;
}

interface ConditionsResponse {
  location: { lat: number; lon: number; city?: string };
  aqi: ConditionsAqi;
  risk: { score: number };
}

/** Generate a grid of GeoJSON points around a center, seeded from real AQI. */
function buildAqiGeoJSON(
  center: [number, number],
  aqi: number,
): { type: "FeatureCollection"; features: { type: "Feature"; properties: { aqi: number; weight: number }; geometry: { type: "Point"; coordinates: [number, number] } }[] } {
  const features = Array.from({ length: 60 }, () => {
    // Vary AQI +/- 30% around real value so the heatmap has spatial variation
    const variation = aqi * (0.7 + Math.random() * 0.6);
    return {
      type: "Feature" as const,
      properties: {
        aqi: Math.max(0, variation),
        weight: 0.5 + Math.random() * 0.5,
      },
      geometry: {
        type: "Point" as const,
        coordinates: [
          center[1] + (Math.random() - 0.5) * 0.08,
          center[0] + (Math.random() - 0.5) * 0.06,
        ] as [number, number],
      },
    };
  });
  return { type: "FeatureCollection", features };
}

const DEFAULT_CENTER: [number, number] = [41.8781, -87.6298];

export default function Home() {
  const [center, setCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [aqiGeoJSON, setAqiGeoJSON] = useState<ReturnType<typeof buildAqiGeoJSON> | null>(null);
  const [showBreathe, setShowBreathe] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setShowBreathe((v) => !v), 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchAqi = async (lat: number, lon: number) => {
      try {
        const res = await axios.post<ConditionsResponse>("/api/conditions/", {
          lat,
          lon,
          health_profile: { conditions: [], dietary_restrictions: [] },
        });
        const loc: [number, number] = [res.data.location.lat, res.data.location.lon];
        setCenter(loc);
        setAqiGeoJSON(buildAqiGeoJSON(loc, res.data.aqi.aqi));
      } catch {
        // Fallback: show a demo heatmap with moderate AQI
        setAqiGeoJSON(buildAqiGeoJSON(DEFAULT_CENTER, 55));
      }
    };

    if (!navigator.geolocation) {
      fetchAqi(DEFAULT_CENTER[0], DEFAULT_CENTER[1]);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => fetchAqi(pos.coords.latitude, pos.coords.longitude),
      () => fetchAqi(DEFAULT_CENTER[0], DEFAULT_CENTER[1]),
    );
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] text-center gap-12">
      {/* Hero */}
      <div className="space-y-4 max-w-2xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-brand-200 bg-brand-50 text-brand-500 text-sm font-medium mb-2">
          <PlusSquare size={14} />
          Health-Aware Travel Assistance
        </div>
        <h1 className="text-5xl font-bold tracking-tight text-heading">
          Is it safe for you{" "}
          <span className="text-brand-500 relative inline-block">
            <span
              className="transition-opacity duration-700"
              style={{ opacity: showBreathe ? 0 : 1 }}
            >
              to be there?
            </span>
            <span
              className="absolute inset-0 transition-opacity duration-700"
              style={{ opacity: showBreathe ? 1 : 0 }}
            >
              to breathe?
            </span>
          </span>
        </h1>
        <p className="text-slate-500 text-lg leading-relaxed">
          Know before you go. Real-time health risk tracking,
          itinerary assessment, and AI-powered travel planning - personalized to your health conditions.
        </p>
      </div>

      {/* Map: live AQI heatmap */}
      <div className="w-full max-w-4xl space-y-4">
        <div className="card overflow-hidden p-2" style={{ height: 380 }}>
          <PredictiveMapLeaflet
            className="w-full h-full"
            initialZoom={12}
            center={center}
            airQualityGeoJSON={aqiGeoJSON ?? undefined}
          />
        </div>
      </div>

      <Link
        href="/plan"
        className="inline-flex items-center gap-2 mt-4 px-4 py-2.5 rounded-lg border border-brand-200 bg-brand-50 text-brand-500 font-medium hover:bg-brand-100 transition-colors"
      >
        Plan your trip <ChevronRight size={16} />
      </Link>

      {/* Screen cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-4xl">
        {SCREENS.map(({ href, icon: Icon, title, description, color, bg }) => (
          <Link
            key={href}
            href={href}
            className={`card border ${bg} hover:scale-[1.02] transition-transform text-left group`}
          >
            <div className={`${color} mb-3`}>
              <Icon size={28} />
            </div>
            <h2 className="font-semibold text-lg mb-1">{title}</h2>
            <p className="text-slate-500 text-sm leading-relaxed mb-4">{description}</p>
            <span className={`inline-flex items-center gap-1 text-sm font-medium ${color}`}>
              Open <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
