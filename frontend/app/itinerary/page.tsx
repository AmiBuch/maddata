"use client";

import { useState } from "react";
import axios from "axios";
import { Map, Plus, Trash2, ChevronDown, ChevronUp, AlertTriangle, Calendar, Wind, Droplets, Thermometer, Activity } from "lucide-react";
import RiskBadge from "@/components/RiskBadge";
import HealthProfileSelector from "@/components/HealthProfileSelector";

interface ActivityItem {
  name: string;
  type: string;
  time: string;
}

interface Day {
  date: string;
  city: string;
  activities: ActivityItem[];
}

interface EnvPrediction {
  mean: number;
  min: number;
  max: number;
  p25?: number;
  p75?: number;
}

interface EnvForecast {
  source: string;
  days_ahead: number;
  aqi_category: string;
  data_points_used: number;
  temperature_2m?: EnvPrediction;
  relative_humidity_2m?: EnvPrediction;
  wind_speed_10m?: EnvPrediction;
  precipitation?: EnvPrediction;
  pm2_5?: EnvPrediction;
  pm10?: EnvPrediction;
  nitrogen_dioxide?: EnvPrediction;
  ozone?: EnvPrediction;
  us_aqi?: EnvPrediction;
}

interface DayRisk {
  date: string;
  risk: { overall: string; score: number; factors: string[]; recommendations: string[] };
  aqi_forecast?: number;
  weather_summary: string;
  activity_adjustments: { original: string; suggested: string; reason: string }[];
  morning_briefing: string[];
  env_forecast?: EnvForecast;
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

// ── Source confidence badge ──────────────────────────────────────────────────
const SOURCE_META: Record<string, { label: string; color: string }> = {
  api_direct:        { label: "Live Forecast",      color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  ml_aq_api_weather: { label: "Hybrid Forecast",    color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  ml_full:           { label: "Historical Pattern", color: "bg-violet-500/20 text-violet-400 border-violet-500/30" },
  error_fallback:    { label: "Current Conditions", color: "bg-slate-600/40 text-slate-400 border-slate-600/30" },
};

function SourceBadge({ source }: { source: string }) {
  const meta = SOURCE_META[source] ?? { label: source, color: "bg-slate-600/40 text-slate-400" };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${meta.color}`}>
      {meta.label}
    </span>
  );
}

// ── Single metric card ───────────────────────────────────────────────────────
function MetricCard({
  label,
  value,
  unit,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  unit: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg px-3 py-2 ${highlight ? "bg-teal-900/30 border border-teal-700/30" : "bg-slate-800/60"}`}>
      <div className="text-xs text-slate-500 mb-0.5">{label}</div>
      <div className="text-sm font-semibold text-slate-200">
        {value}
        <span className="text-xs text-slate-400 ml-0.5">{unit}</span>
      </div>
      {sub && <div className="text-xs text-slate-500 truncate mt-0.5">{sub}</div>}
    </div>
  );
}

// ── C→F helper ───────────────────────────────────────────────────────────────
const cToF = (c: number) => Math.round(c * 9 / 5 + 32);

// ── Predicted conditions panel ───────────────────────────────────────────────
function EnvForecastPanel({ ef }: { ef: EnvForecast }) {
  const p = ef;

  const tempF   = p.temperature_2m ? cToF(p.temperature_2m.mean) : null;
  const tempMin = p.temperature_2m ? cToF(p.temperature_2m.min)  : null;
  const tempMax = p.temperature_2m ? cToF(p.temperature_2m.max)  : null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Activity size={14} className="text-teal-400" />
          <h4 className="text-sm font-semibold text-teal-400">Predicted Conditions</h4>
        </div>
        <SourceBadge source={p.source} />
        {p.data_points_used > 0 && (
          <span className="text-xs text-slate-600">
            ({p.data_points_used.toLocaleString()} training points)
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {p.us_aqi && (
          <MetricCard
            label="AQI"
            value={p.us_aqi.mean.toFixed(0)}
            unit=""
            sub={p.aqi_category}
            highlight
          />
        )}
        {tempF !== null && (
          <MetricCard
            label="Temperature"
            value={String(tempF)}
            unit="°F"
            sub={`${tempMin}–${tempMax}°F range`}
          />
        )}
        {p.relative_humidity_2m && (
          <MetricCard
            label="Humidity"
            value={p.relative_humidity_2m.mean.toFixed(0)}
            unit="%"
            sub={`${p.relative_humidity_2m.min.toFixed(0)}–${p.relative_humidity_2m.max.toFixed(0)}%`}
          />
        )}
        {p.wind_speed_10m && (
          <MetricCard
            label="Wind Speed"
            value={p.wind_speed_10m.mean.toFixed(1)}
            unit=" mph"
            sub={`up to ${p.wind_speed_10m.max.toFixed(1)} mph`}
          />
        )}
        {p.pm2_5 && (
          <MetricCard
            label="PM2.5"
            value={p.pm2_5.mean.toFixed(1)}
            unit=" µg/m³"
            sub={`max ${p.pm2_5.max.toFixed(1)}`}
          />
        )}
        {p.pm10 && (
          <MetricCard
            label="PM10"
            value={p.pm10.mean.toFixed(1)}
            unit=" µg/m³"
            sub={`max ${p.pm10.max.toFixed(1)}`}
          />
        )}
        {p.nitrogen_dioxide && (
          <MetricCard
            label="NO₂"
            value={p.nitrogen_dioxide.mean.toFixed(1)}
            unit=" µg/m³"
          />
        )}
        {p.ozone && (
          <MetricCard
            label="O₃"
            value={p.ozone.mean.toFixed(1)}
            unit=" µg/m³"
          />
        )}
      </div>

      {p.source === "ml_full" && (
        <p className="text-xs text-slate-600 mt-2">
          Trip is {p.days_ahead}+ days out — predictions are based on seasonal patterns from the past 90 days.
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main page
// ═══════════════════════════════════════════════════════════════════════════════
export default function ItineraryPage() {
  const [days, setDays]           = useState<Day[]>(DEFAULT_ITINERARY);
  const [conditions, setConditions] = useState<string[]>([]);
  const [results, setResults]     = useState<DayRisk[] | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [expanded, setExpanded]   = useState<number | null>(0);

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

  const updateActivity = (dayIdx: number, actIdx: number, field: keyof ActivityItem, value: string) =>
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
          <p className="text-slate-400 text-sm mt-1">
            Build your trip day-by-day and get an ML-powered environmental health forecast
          </p>
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
        {loading
          ? <><span className="animate-spin">⟳</span> Fetching forecast &amp; analyzing…</>
          : "Analyze Health Risk"}
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
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-slate-400 text-sm">{day.date}</span>
                  <RiskBadge level={day.risk.overall} score={day.risk.score} />
                  {day.env_forecast && (
                    <SourceBadge source={day.env_forecast.source} />
                  )}
                </div>
                {expanded === i ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              {expanded === i && (
                <div className="mt-4 space-y-5 border-t border-slate-800 pt-4">

                  {/* ML-predicted environmental conditions */}
                  {day.env_forecast && day.env_forecast.source !== "error_fallback" && (
                    <EnvForecastPanel ef={day.env_forecast} />
                  )}

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
                    <span className="font-medium text-slate-300">Summary:</span> {day.weather_summary}
                    {day.aqi_forecast !== undefined && day.aqi_forecast > 0 && (
                      <span> · AQI: <span className="font-medium text-slate-200">{day.aqi_forecast}</span></span>
                    )}
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

                  {/* Risk factors */}
                  {day.risk.factors.length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold text-slate-400 mb-1">Risk Factors</h4>
                      <ul className="space-y-0.5">
                        {day.risk.factors.map((f, j) => (
                          <li key={j} className="text-xs text-slate-500 flex items-start gap-1.5">
                            <span className="text-red-400 mt-0.5">·</span> {f}
                          </li>
                        ))}
                      </ul>
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
