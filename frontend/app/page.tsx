"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { Wind, Map, MessageSquare, ChevronRight, PlusSquare } from "lucide-react";

import { useMemo } from "react";

// Map only runs in browser (Leaflet needs window)
const PredictiveMapLeaflet = dynamic(() => import("@/components/PredictiveMapLeaflet"),{ ssr: false });

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

export default function Home() {

function useMockAirQualityTimeseries() {
  return useMemo(() => {
    const base: [number, number] = [41.8781, -87.6298];
    return [0, 1, 2].map((t) => ({
      type: "FeatureCollection" as const,
      features: Array.from({ length: 40 }, (_, i) => ({
        type: "Feature" as const,
        properties: {
          aqi: 40 + t * 30 + Math.random() * 50,
          weight: 0.5 + Math.random() * 0.5,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [
            base[1] + (Math.random() - 0.5) * 0.06,
            base[0] + (Math.random() - 0.5) * 0.05,
          ],
        },
      })),
    }));
  }, []);
}
  const airQualityTimeseries = useMockAirQualityTimeseries();
  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] text-center gap-12">
      {/* Hero */}
      <div className="space-y-4 max-w-2xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-brand-200 bg-brand-50 text-brand-500 text-sm font-medium mb-2">
          <PlusSquare size={14} />
          Health-Aware Travel Assistance
        </div>
        <h1 className="text-5xl font-bold tracking-tight text-slate-800">
          Is it safe for you{" "}
          <span className="text-brand-500">to be there?</span>
        </h1>
        <p className="text-slate-500 text-lg leading-relaxed">
          Know before you go. Real-time health risk tracking,
          itinerary assessment, and AI-powered travel planning - personalized to your health conditions.
        </p>
      </div>

      {/* Map: overview of risk / conditions */}
      <div className="w-full max-w-4xl space-y-4">

    <div className="card overflow-hidden p-2" style={{ height: 380 }}>
      <PredictiveMapLeaflet
        className="w-full h-full"
        initialZoom={12}
        airQualityTimeseries={airQualityTimeseries}
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
