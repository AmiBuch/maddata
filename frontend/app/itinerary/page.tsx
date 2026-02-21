"use client";

import { useState } from "react";
import axios from "axios";
import { Map, Plus, Trash2, ChevronDown, ChevronUp, AlertTriangle, Calendar } from "lucide-react";
import RiskBadge from "@/components/RiskBadge";
import HealthProfileSelector from "@/components/HealthProfileSelector";

interface Activity {
  name: string;
  type: string;
  time: string;
}

interface Day {
  date: string;
  city: string;
  activities: Activity[];
}

interface DayRisk {
  date: string;
  risk: { overall: string; score: number; factors: string[]; recommendations: string[] };
  aqi_forecast?: number;
  weather_summary: string;
  activity_adjustments: { original: string; suggested: string; reason: string }[];
  morning_briefing: string[];
}

const ACTIVITY_TYPES = ["outdoor", "indoor", "dining", "transit", "hiking", "museum"];

const DEFAULT_ITINERARY: Day[] = [
  {
    date: new Date().toISOString().split("T")[0],
    city: "New York",
    activities: [
      { name: "Central Park walk", type: "outdoor", time: "10:00" },
      { name: "MoMA", type: "indoor", time: "14:00" },
      { name: "Dinner in Midtown", type: "dining", time: "19:00" },
    ],
  },
];

export default function ItineraryPage() {
  const [days, setDays] = useState<Day[]>(DEFAULT_ITINERARY);
  const [conditions, setConditions] = useState<string[]>([]);
  const [results, setResults] = useState<DayRisk[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(0);

  const addDay = () => {
    const last = days[days.length - 1];
    const nextDate = new Date(last?.date || new Date());
    nextDate.setDate(nextDate.getDate() + 1);
    setDays([...days, { date: nextDate.toISOString().split("T")[0], city: last?.city || "", activities: [] }]);
  };

  const removeDay = (i: number) => setDays(days.filter((_, idx) => idx !== i));

  const updateDay = (i: number, field: keyof Day, value: string) =>
    setDays(days.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)));

  const addActivity = (dayIdx: number) =>
    setDays(days.map((d, i) =>
      i === dayIdx ? { ...d, activities: [...d.activities, { name: "", type: "outdoor", time: "09:00" }] } : d,
    ));

  const removeActivity = (dayIdx: number, actIdx: number) =>
    setDays(days.map((d, i) =>
      i === dayIdx ? { ...d, activities: d.activities.filter((_, j) => j !== actIdx) } : d,
    ));

  const updateActivity = (dayIdx: number, actIdx: number, field: keyof Activity, value: string) =>
    setDays(days.map((d, i) =>
      i === dayIdx
        ? { ...d, activities: d.activities.map((a, j) => (j === actIdx ? { ...a, [field]: value } : a)) }
        : d,
    ));

  const analyze = async () => {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await axios.post("/api/itinerary/analyze", {
        days,
        health_profile: { conditions, dietary_restrictions: [] },
      });
      setResults(res.data.days);
      setExpanded(0);
    } catch {
      setError("Analysis failed. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Map className="text-violet-400" size={24} /> Upload Itinerary
          </h1>
          <p className="text-slate-400 text-sm mt-1">Build your trip day-by-day and get a personalized health forecast</p>
        </div>
        <HealthProfileSelector selected={conditions} onChange={setConditions} />
      </div>

      {/* Itinerary builder */}
      <div className="space-y-4">
        {days.map((day, dayIdx) => (
          <div key={dayIdx} className="card space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Calendar size={16} className="text-violet-400 flex-shrink-0" />
              <input
                type="date"
                value={day.date}
                onChange={(e) => updateDay(dayIdx, "date", e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm"
              />
              <input
                type="text"
                placeholder="City (e.g. New York)"
                value={day.city}
                onChange={(e) => updateDay(dayIdx, "city", e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[160px]"
              />
              <button onClick={() => removeDay(dayIdx)} className="ml-auto text-slate-500 hover:text-red-400 transition-colors">
                <Trash2 size={16} />
              </button>
            </div>

            {/* Activities */}
            <div className="space-y-2">
              {day.activities.map((act, actIdx) => (
                <div key={actIdx} className="flex items-center gap-2 flex-wrap bg-slate-800/50 rounded-lg px-3 py-2">
                  <input
                    type="time"
                    value={act.time}
                    onChange={(e) => updateActivity(dayIdx, actIdx, "time", e.target.value)}
                    className="bg-transparent text-sm w-24"
                  />
                  <input
                    type="text"
                    placeholder="Activity name"
                    value={act.name}
                    onChange={(e) => updateActivity(dayIdx, actIdx, "name", e.target.value)}
                    className="bg-transparent text-sm flex-1 min-w-[120px] outline-none"
                  />
                  <select
                    value={act.type}
                    onChange={(e) => updateActivity(dayIdx, actIdx, "type", e.target.value)}
                    className="bg-slate-700 border border-slate-600 rounded px-2 py-1 text-xs"
                  >
                    {ACTIVITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <button onClick={() => removeActivity(dayIdx, actIdx)} className="text-slate-500 hover:text-red-400">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button onClick={() => addActivity(dayIdx)} className="flex items-center gap-1 text-sm text-violet-400 hover:text-violet-300 transition-colors">
                <Plus size={14} /> Add activity
              </button>
            </div>
          </div>
        ))}

        <button onClick={addDay} className="btn-ghost flex items-center gap-2 w-full justify-center">
          <Plus size={16} /> Add Day
        </button>
      </div>

      {error && (
        <div className="card border-red-500/20 bg-red-500/10 flex items-center gap-3 text-red-400">
          <AlertTriangle size={18} /> {error}
        </div>
      )}

      <button onClick={analyze} disabled={loading || days.length === 0} className="btn-primary w-full flex items-center justify-center gap-2">
        {loading ? <><span className="animate-spin">⟳</span> Analyzing…</> : "Analyze Health Risk"}
      </button>

      {/* Results */}
      {results && (
        <div className="space-y-3">
          <h2 className="text-xl font-semibold">Your Health Itinerary</h2>
          {results.map((day, i) => (
            <div key={i} className="card border-violet-500/20">
              <button
                className="w-full flex items-center justify-between"
                onClick={() => setExpanded(expanded === i ? null : i)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-slate-400 text-sm">{day.date}</span>
                  <RiskBadge level={day.risk.overall} score={day.risk.score} />
                </div>
                {expanded === i ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              {expanded === i && (
                <div className="mt-4 space-y-4 border-t border-slate-800 pt-4">
                  {/* Morning briefing */}
                  <div>
                    <h4 className="text-sm font-semibold text-violet-400 mb-2">Morning Briefing</h4>
                    <ul className="space-y-1">
                      {day.morning_briefing.map((tip, j) => (
                        <li key={j} className="text-sm text-slate-300 flex items-start gap-2">
                          <span className="text-violet-400 mt-0.5">→</span> {tip}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="text-sm text-slate-400">
                    <span className="font-medium text-slate-300">Weather:</span> {day.weather_summary}
                    {day.aqi_forecast && <span> · AQI: <span className="font-medium text-slate-200">{day.aqi_forecast}</span></span>}
                  </div>

                  {/* Activity adjustments */}
                  {day.activity_adjustments.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-amber-400 mb-2">Activity Adjustments</h4>
                      {day.activity_adjustments.map((adj, j) => (
                        <div key={j} className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-sm space-y-1">
                          <div className="line-through text-slate-500">{adj.original}</div>
                          <div className="text-amber-300">→ {adj.suggested}</div>
                          <div className="text-slate-400 text-xs">{adj.reason}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
