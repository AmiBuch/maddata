"use client";

import Chatbot from "@/components/Chatbot";

export default function PlanPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      {/* Hero - same styling as homepage */}
      <div className="space-y-4 mb-6">
        <h1 className="text-5xl font-bold tracking-tight">
          <span className="text-brand-500">Plan your trip with real-time health, weather, and location insights.</span>
        </h1>
        <p className="text-slate-500 text-lg leading-relaxed">
          Our mission is to provide users with data-driven travel recommendations by
          combining environmental data, public health alerts, and location intelligence
          to identify safe activities, restaurants, and itineraries for a given destination.
        </p>
      </div>

      {/* Chatbot - single instance */}
      <div className="flex-1 min-h-0">
        <Chatbot />
      </div>
    </div>
  );
}