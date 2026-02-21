"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Wind, Thermometer, Droplets, AlertTriangle, MapPin, RefreshCw } from "lucide-react";
import RiskBadge from "@/components/RiskBadge";
import OutbreakFeed from "@/components/OutbreakFeed";
import HealthProfileSelector from "@/components/HealthProfileSelector";
import dynamic from "next/dynamic";

const HeatMap = dynamic(() => import("@/components/HeatMap"), { ssr: false });

interface ConditionsData {
  location: { lat: number; lon: number; city?: string };
  aqi: { aqi: number; category: string; dominant_pollutant: string; pm25?: number; ozone?: number };
  weather: { temp_f: number; feels_like_f: number; humidity: number; description: string; uv_index?: number; wind_mph?: number };
  risk: { overall: string; score: number; factors: string[]; recommendations: string[] };
  timestamp: string;
}

export default function NowPage() {
  const [data, setData] = useState<ConditionsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conditions, setConditions] = useState<string[]>([]);
  const [city, setCity] = useState("");

  const fetchConditions = async (lat: number, lon: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post("/api/conditions/", {
        lat, lon,
        health_profile: { conditions, dietary_restrictions: [] },
      });
      setData(res.data);
    } catch {
      setError("Failed to fetch conditions. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  const geolocate = () => {
    if (!navigator.geolocation) {
      setError("Geolocation not supported by your browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => fetchConditions(pos.coords.latitude, pos.coords.longitude),
      () => setError("Location access denied. Using Chicago as default.") || fetchConditions(41.8781, -87.6298),
    );
  };

  useEffect(() => { geolocate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const aqiColor = (aqi: number) =>
    aqi <= 50 ? "text-green-400" : aqi <= 100 ? "text-yellow-400" : aqi <= 150 ? "text-orange-400" : "text-red-400";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Wind className="text-teal-400" size={24} /> Right Now
          </h1>
          <p className="text-slate-400 text-sm mt-1">Live health conditions at your location</p>
        </div>
        <div className="flex gap-2">
          <HealthProfileSelector selected={conditions} onChange={setConditions} />
          <button onClick={geolocate} disabled={loading} className="btn-ghost flex items-center gap-2">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="card border-red-500/20 bg-red-500/10 flex items-center gap-3 text-red-400">
          <AlertTriangle size={18} />
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="card animate-pulse bg-slate-800 h-36" />
          ))}
        </div>
      )}

      {data && (
        <>
          {/* Risk Overview */}
          <div className="card flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <MapPin size={14} className="text-slate-400" />
                <span className="text-slate-400 text-sm">{data.location.city || `${data.location.lat.toFixed(2)}, ${data.location.lon.toFixed(2)}`}</span>
              </div>
              <div className="flex items-center gap-3 mb-3">
                <h2 className="text-xl font-semibold">Overall Risk</h2>
                <RiskBadge level={data.risk.overall} score={data.risk.score} />
              </div>
              <ul className="space-y-1">
                {data.risk.factors.map((f, i) => (
                  <li key={i} className="text-sm text-slate-400 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-400 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <div className="text-right hidden sm:block">
              <div className="text-6xl font-bold text-teal-400">{data.risk.score}</div>
              <div className="text-slate-500 text-sm">/ 100</div>
            </div>
          </div>

          {/* Metric cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* AQI */}
            <div className="card space-y-2">
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Wind size={14} /> Air Quality
              </div>
              <div className={`text-4xl font-bold ${aqiColor(data.aqi.aqi)}`}>{data.aqi.aqi}</div>
              <div className="text-slate-400 text-sm">{data.aqi.category}</div>
              {data.aqi.pm25 && <div className="text-xs text-slate-500">PM2.5: {data.aqi.pm25} · Ozone: {data.aqi.ozone ?? "—"}</div>}
            </div>

            {/* Temperature */}
            <div className="card space-y-2">
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Thermometer size={14} /> Temperature
              </div>
              <div className="text-4xl font-bold text-sky-400">{data.weather.temp_f}°F</div>
              <div className="text-slate-400 text-sm">{data.weather.description}</div>
              <div className="text-xs text-slate-500">Feels like {data.weather.feels_like_f}°F · UV {data.weather.uv_index ?? "—"}</div>
            </div>

            {/* Humidity */}
            <div className="card space-y-2">
              <div className="flex items-center gap-2 text-slate-400 text-sm">
                <Droplets size={14} /> Humidity
              </div>
              <div className="text-4xl font-bold text-violet-400">{data.weather.humidity}%</div>
              <div className="text-slate-400 text-sm">Wind: {data.weather.wind_mph ?? "—"} mph</div>
              <div className="text-xs text-slate-500">High humidity can worsen respiratory symptoms</div>
            </div>
          </div>

          {/* Recommendations */}
          {data.risk.recommendations.length > 0 && (
            <div className="card border-teal-500/20">
              <h3 className="font-semibold mb-3 text-teal-400">Recommendations</h3>
              <ul className="space-y-2">
                {data.risk.recommendations.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                    <span className="text-teal-400 mt-0.5">→</span> {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Map + Outbreaks */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card" style={{ height: 380 }}>
              <h3 className="font-semibold mb-3">Risk Heatmap</h3>
              <div style={{ height: 320 }}>
                <HeatMap
                  center={[data.location.lat, data.location.lon]}
                  riskScore={data.risk.score}
                />
              </div>
            </div>
            <OutbreakFeed
              city={data.location.city || "Chicago"}
            />
          </div>
        </>
      )}
    </div>
  );
}
