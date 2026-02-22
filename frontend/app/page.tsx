"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { Wind, Map, MessageSquare, ChevronRight, PlusSquare } from "lucide-react";
import Chatbot from "@/components/Chatbot";
import { useMemo } from "react";

// Map only runs in browser (Leaflet needs window)
const PredictiveMapLeaflet = dynamic(() => import("@/components/PredictiveMapLeaflet"),{ ssr: false });

const SCREENS = [
  {
    href: "/now",
    icon: Wind,
    title: "Right Now",
    description: "Live air quality, weather, and health risk at your current location.",
    color: "text-teal-400",
    bg: "bg-teal-500/10 border-teal-500/20",
  },
  {
    href: "/itinerary",
    icon: Map,
    title: "Upload Itinerary",
    description: "Upload your travel plans and get a day-by-day health risk forecast.",
    color: "text-violet-400",
    bg: "bg-violet-500/10 border-violet-500/20",
  },
  {
    href: "/plan",
    icon: MessageSquare,
    title: "Plan with AI",
    description: "Chat with Breathe to build a health-safe itinerary from scratch.",
    color: "text-sky-400",
    bg: "bg-sky-500/10 border-sky-500/20",
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
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-teal-500/30 bg-teal-500/10 text-teal-400 text-sm font-medium mb-2">
          <PlusSquare size={14} />
          Health-Aware Travel Assistance
        </div>
        <h1 className="text-5xl font-bold tracking-tight">
          Is it safe for you{" "}
          <span className="text-teal-400">to be there?</span>
        </h1>
        <p className="text-slate-400 text-lg leading-relaxed">
          Know before you go. Real-time health risk tracking, 
          iternerary assesment, and AI-powered travel planning - personalized to your health conditions.

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

      <div className="w-full max-w-2xl">
        <Chatbot />
      </div>

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
            <p className="text-slate-400 text-sm leading-relaxed mb-4">{description}</p>
            <span className={`inline-flex items-center gap-1 text-sm font-medium ${color}`}>
              Open <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
