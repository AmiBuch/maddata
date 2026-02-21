"use client";

import { Activity } from "lucide-react";

// ── Shared types (re-exported for consumers) ──────────────────────────────────
export interface EnvPrediction {
  mean: number;
  min:  number;
  max:  number;
  p25?: number;
  p75?: number;
}

export interface EnvForecast {
  source: string;           // "api_direct" | "ml_aq_api_weather" | "ml_full" | "error_fallback"
  days_ahead: number;
  aqi_category: string;
  data_points_used: number;
  temperature_2m?:       EnvPrediction;
  relative_humidity_2m?: EnvPrediction;
  wind_speed_10m?:       EnvPrediction;
  precipitation?:        EnvPrediction;
  pm2_5?:                EnvPrediction;
  pm10?:                 EnvPrediction;
  nitrogen_dioxide?:     EnvPrediction;
  ozone?:                EnvPrediction;
  us_aqi?:               EnvPrediction;
}

// ── Source badge ──────────────────────────────────────────────────────────────
export const SOURCE_META: Record<string, { label: string; color: string }> = {
  api_direct:        { label: "Live Forecast",      color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
  ml_aq_api_weather: { label: "Hybrid Forecast",    color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  ml_full:           { label: "Historical Pattern", color: "bg-violet-500/20 text-violet-400 border-violet-500/30" },
  error_fallback:    { label: "Current Conditions", color: "bg-slate-600/40 text-slate-400 border-slate-600/30" },
};

export function SourceBadge({ source }: { source: string }) {
  const meta = SOURCE_META[source] ?? { label: source, color: "bg-slate-600/40 text-slate-400 border-slate-600/30" };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${meta.color}`}>
      {meta.label}
    </span>
  );
}

// ── Metric card with IQR range bar ────────────────────────────────────────────
interface MetricCardProps {
  label:     string;
  value:     string;
  unit:      string;
  sub?:      string;
  highlight?: boolean;
  pred?:     EnvPrediction;   // if provided, renders the IQR bar
}

function MetricCard({ label, value, unit, sub, highlight, pred }: MetricCardProps) {
  const canBar =
    pred &&
    pred.p25 !== undefined &&
    pred.p75 !== undefined &&
    pred.max > pred.min;

  const barLeft  = canBar ? Math.round(((pred!.p25! - pred!.min) / (pred!.max - pred!.min)) * 100) : 0;
  const barWidth = canBar ? Math.max(4, Math.round(((pred!.p75! - pred!.p25!) / (pred!.max - pred!.min)) * 100)) : 0;

  return (
    <div className={`rounded-lg px-3 py-2 ${highlight ? "bg-teal-900/30 border border-teal-700/30" : "bg-slate-800/60"}`}>
      <div className="text-xs text-slate-500 mb-0.5">{label}</div>
      <div className="text-sm font-semibold text-slate-200">
        {value}
        <span className="text-xs text-slate-400 ml-0.5">{unit}</span>
      </div>
      {sub && <div className="text-xs text-slate-500 truncate mt-0.5">{sub}</div>}

      {/* IQR range bar — shows the interquartile spread */}
      {canBar && (
        <div className="mt-1.5 h-1 bg-slate-700 rounded-full overflow-hidden relative" title={`IQR: ${pred!.p25!.toFixed(1)}–${pred!.p75!.toFixed(1)}`}>
          <div
            className={`absolute h-full rounded-full ${highlight ? "bg-teal-400/70" : "bg-violet-400/70"}`}
            style={{ left: `${barLeft}%`, width: `${barWidth}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export const cToF = (c: number) => Math.round(c * 9 / 5 + 32);

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  ef: EnvForecast;
}

export default function EnvForecastPanel({ ef }: Props) {
  const p = ef;

  const tempF   = p.temperature_2m ? cToF(p.temperature_2m.mean) : null;
  const tempMin = p.temperature_2m ? cToF(p.temperature_2m.min)  : null;
  const tempMax = p.temperature_2m ? cToF(p.temperature_2m.max)  : null;

  // AQI variability warning
  const aqiSwing = p.us_aqi ? p.us_aqi.max - p.us_aqi.min : 0;
  const highVariability = aqiSwing > 60;

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Activity size={14} className="text-teal-400" />
          <h4 className="text-sm font-semibold text-teal-400">Predicted Conditions</h4>
        </div>
        <SourceBadge source={p.source} />
        {p.data_points_used > 0 && (
          <span className="text-xs text-slate-600">({p.data_points_used.toLocaleString()} pts)</span>
        )}
      </div>

      {highVariability && (
        <div className="mb-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1">
          AQI swings significantly today ({p.us_aqi!.min.toFixed(0)}–{p.us_aqi!.max.toFixed(0)}) — check closer to your activity time.
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {p.us_aqi && (
          <MetricCard
            label="AQI"
            value={p.us_aqi.mean.toFixed(0)}
            unit=""
            sub={p.aqi_category}
            highlight
            pred={p.us_aqi}
          />
        )}
        {tempF !== null && (
          <MetricCard
            label="Temperature"
            value={String(tempF)}
            unit="°F"
            sub={`${tempMin}–${tempMax}°F`}
            pred={p.temperature_2m}
          />
        )}
        {p.relative_humidity_2m && (
          <MetricCard
            label="Humidity"
            value={p.relative_humidity_2m.mean.toFixed(0)}
            unit="%"
            sub={`${p.relative_humidity_2m.min.toFixed(0)}–${p.relative_humidity_2m.max.toFixed(0)}%`}
            pred={p.relative_humidity_2m}
          />
        )}
        {p.wind_speed_10m && (
          <MetricCard
            label="Wind"
            value={p.wind_speed_10m.mean.toFixed(1)}
            unit=" mph"
            sub={`up to ${p.wind_speed_10m.max.toFixed(1)}`}
            pred={p.wind_speed_10m}
          />
        )}
        {p.pm2_5 && (
          <MetricCard label="PM2.5" value={p.pm2_5.mean.toFixed(1)} unit=" µg/m³" sub={`max ${p.pm2_5.max.toFixed(1)}`} pred={p.pm2_5} />
        )}
        {p.pm10 && (
          <MetricCard label="PM10" value={p.pm10.mean.toFixed(1)} unit=" µg/m³" sub={`max ${p.pm10.max.toFixed(1)}`} pred={p.pm10} />
        )}
        {p.nitrogen_dioxide && (
          <MetricCard label="NO₂" value={p.nitrogen_dioxide.mean.toFixed(1)} unit=" µg/m³" pred={p.nitrogen_dioxide} />
        )}
        {p.ozone && (
          <MetricCard label="O₃" value={p.ozone.mean.toFixed(1)} unit=" µg/m³" pred={p.ozone} />
        )}
      </div>

      {p.source === "ml_full" && (
        <p className="text-xs text-slate-600 mt-2">
          Trip is {p.days_ahead}+ days out — based on seasonal patterns from the past 90 days.
        </p>
      )}
    </div>
  );
}
