"use client";

import { useState, useRef, useEffect } from "react";
import axios from "axios";
import { Send, User, Bot, Utensils, Mountain, Cloud, AlertTriangle, Loader2 } from "lucide-react";

type DietaryPreference = "Vegetarian" | "Vegan" | "Gluten-Free" | "None";

interface Message {
  role: "user" | "assistant";
  content: React.ReactNode;
}

interface RecommendResponse {
  destination: string;
  target_date: string;
  forecast_summary: string;
  outbreak_alerts: { headline: string; severity: string }[];
  restaurants: { name: string; city?: string; state?: string; type?: string; rating?: number }[];
  activities: { name: string; city?: string; state?: string; type?: string; indoor?: boolean }[];
  ai_notes: string;
  source?: string;
}

const DIETARY_OPTIONS: DietaryPreference[] = ["Vegetarian", "Vegan", "Gluten-Free", "None"];

// Use relative URL so Next.js proxy handles routing (avoids CORS)
const RECOMMEND_URL = "/api/chatbot/recommend";

export default function Chatbot() {
  const [destination, setDestination] = useState("");
  const [tripDate, setTripDate] = useState("");
  const [dietaryPreference, setDietaryPreference] = useState<DietaryPreference>("None");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: (
        <p>
          Hi! I'm <strong>Pathfinder</strong>. I use real-time environmental and health data, including weather forecasts, air quality, and public health alerts, to generate personalized travel recommendations.
        </p>
      ),
    },
  ]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const dest = destination.trim();
    const dateVal = tripDate;
    if (!dest || !dateVal) return;

    const userContent = (
      <p>
        I'm planning a trip to <strong>{dest}</strong>
        {dateVal && <> on <strong>{dateVal}</strong></>}
        {dietaryPreference !== "None" && (
          <> with a <strong>{dietaryPreference}</strong> diet</>
        )}
        . What do you recommend?
      </p>
    );

    setMessages((prev) => [...prev, { role: "user", content: userContent }]);
    setDestination("");
    setTripDate("");
    setLoading(true);

    try {
      const { data } = await axios.post<RecommendResponse>(
        RECOMMEND_URL,
        {
          destination: dest,
          target_date: dateVal,
          dietary_preference: dietaryPreference,
        },
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          timeout: 90000, // 90s — forecast + geocoding + AI can be slow
        }
      );

      const recContent = (
        <div className="space-y-4">
          {/* Forecast & Alerts */}
          <div className="space-y-2">
            <div className="flex items-start gap-2 p-3 bg-slate-800/60 rounded-lg">
              <Cloud size={16} className="text-sky-400 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="font-semibold text-sky-400 text-sm mb-1">Forecast for {data.target_date}</h4>
                <p className="text-slate-300 text-sm">{data.forecast_summary}</p>
              </div>
            </div>
            {data.outbreak_alerts.length > 0 && (
              <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-semibold text-amber-400 text-sm mb-1">Health Alerts</h4>
                  <ul className="text-slate-300 text-sm space-y-1">
                    {data.outbreak_alerts.map((a, i) => (
                      <li key={i}>
                        <span className={`font-medium ${
                          a.severity === "High" ? "text-red-400" :
                          a.severity === "Moderate" ? "text-amber-400" : "text-slate-400"
                        }`}>{a.severity}:</span> {a.headline}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* AI Notes */}
          {data.ai_notes && (
            <p className="text-brand-400 text-sm italic border-l-2 border-brand-500/50 pl-3">
              {data.ai_notes}
            </p>
          )}

          {/* Restaurants */}
          <div>
            <h4 className="font-semibold text-brand-400 flex items-center gap-2 mb-2">
              <Utensils size={16} /> Restaurants
            </h4>
            {data.restaurants.length > 0 ? (
              <ul className="space-y-2">
                {data.restaurants.map((r, i) => (
                  <li key={i} className="bg-slate-800/60 rounded-lg px-3 py-2 text-sm">
                    <span className="font-medium text-slate-100">{r.name}</span>
                    <span className="text-slate-400">
                      {" "}· {[r.city, r.state].filter(Boolean).join(", ") || "—"}
                    </span>
                    {r.rating != null && (
                      <span className="text-amber-400 ml-2">★ {r.rating}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500 text-sm">No restaurants in our dataset for this area. Add more in backend/app/data/activities.json</p>
            )}
          </div>

          {/* Activities */}
          <div>
            <h4 className="font-semibold text-brand-400 flex items-center gap-2 mb-2">
              <Mountain size={16} /> Activities
            </h4>
            {data.activities.length > 0 ? (
              <ul className="space-y-2">
                {data.activities.map((a, i) => (
                  <li key={i} className="bg-slate-800/60 rounded-lg px-3 py-2 text-sm">
                    <span className="font-medium text-slate-100">{a.name}</span>
                    <span className="text-slate-400"> · {a.type || "—"}</span>
                    <span className="text-slate-500"> · {[a.city, a.state].filter(Boolean).join(", ") || "—"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500 text-sm">No activities in our dataset for this area. Add more in backend/app/data/activities.json</p>
            )}
          </div>
        </div>
      );

      setMessages((prev) => [...prev, { role: "assistant", content: recContent }]);
    } catch (err: unknown) {
      let msg = "Could not get recommendations. Ensure the backend is running (uvicorn app.main:app).";
      if (axios.isAxiosError(err)) {
        const detail = err.response?.data?.detail;
        msg = Array.isArray(detail)
          ? detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join(". ")
          : (typeof detail === "string" ? detail : err.message) || msg;
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: (
            <div className="flex items-start gap-2 text-red-400">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
              <p>{msg}</p>
            </div>
          ),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-[400px] max-h-[600px] sm:max-h-[calc(100vh-200px)]">
      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 mb-4 p-4 bg-slate-900/50 border border-slate-800 rounded-xl"
      >
        <input
          type="text"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="Destination (e.g. Austin, Texas or Edwardsville, Illinois)"
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-3 text-base text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500"
          required
        />
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="date"
            value={tripDate}
            onChange={(e) => setTripDate(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 flex-1 min-w-0"
            required
          />
          <select
            value={dietaryPreference}
            onChange={(e) => setDietaryPreference(e.target.value as DietaryPreference)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 w-full sm:w-44 flex-shrink-0"
          >
            {DIETARY_OPTIONS.map((opt) => (
              <option key={opt} value={opt} className="bg-slate-800 text-slate-100">
                {opt}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={loading || !destination.trim() || !tripDate}
            className="btn-primary flex items-center justify-center gap-2 px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            <span>{loading ? "Loading…" : "Get Recommendations"}</span>
          </button>
        </div>
      </form>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
          >
            <div
              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                msg.role === "user"
                  ? "bg-sky-500/20 text-sky-400"
                  : "bg-brand-500/20 text-brand-400"
              }`}
            >
              {msg.role === "user" ? <User size={14} /> : <Bot size={14} />}
            </div>
            <div
              className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-sky-500/15 border border-sky-500/20 text-sky-100"
                  : "bg-slate-800 border border-slate-700 text-slate-200"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-500/20 text-brand-400 flex items-center justify-center">
              <Bot size={14} />
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-2xl px-4 py-3 flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 size={14} className="animate-spin" />
              Fetching forecast, outbreaks & AI recommendations…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
