"use client";

/**
 * Itinerary page — 5-state PDF-to-risk pipeline.
 *
 * State 1 · upload     — drag-and-drop PDF zone
 * State 2 · parsing    — PDF.js text extraction + Gemini structured extraction
 *                         (health-condition chips shown simultaneously so user
 *                          isn't sitting idle while the LLM thinks)
 * State 3 · confirm    — inline-editable activity list, user reviews/fixes parse
 * State 4 · analyzing  — geocoding + /api/forecast/predict fetching
 * State 5 · results    — day cards with ItineraryMap + EnvForecastPanel
 *
 * Backend calls (all weather / AQ data comes from backend — none fetched here):
 *   POST /api/forecast/predict  { city, target_date } → ForecastResult
 *   GET  https://nominatim.openstreetmap.org/search   → geocode activity locations
 */

import { useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
    Upload, FileText, AlertTriangle, ChevronDown, ChevronUp,
    Map as MapIcon, Plus, Trash2, CheckCircle, Loader2, RotateCcw,
} from "lucide-react";
import EnvForecastPanel, { EnvForecast, SourceBadge } from "@/components/EnvForecastPanel";
import { ActivityPoint, ForecastResult } from "@/components/ItineraryMap";

// ── Dynamic map import (must be ssr:false — Leaflet + leaflet.heat need window) ─
const ItineraryMap = dynamic(() => import("@/components/ItineraryMap"), { ssr: false });

// ══════════════════════════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════════════════════════

type PageState = "upload" | "parsing" | "confirm" | "analyzing" | "results";

const ACTIVITY_TYPES = ["outdoor", "indoor", "dining", "transit", "hiking", "museum"];

interface ParsedActivity {
    name: string;
    location: string;  // "Central Park, New York"
    time: string;  // "HH:MM"
    type: string;  // inferred by keyword or default "outdoor"
}

interface ParsedDay {
    date: string;   // "YYYY-MM-DD"
    city: string;
    activities: ParsedActivity[];
}

interface ParsedItinerary {
    days: ParsedDay[];
}

interface RichActivity extends ParsedActivity {
    lat: number;
    lon: number;
    riskTier: string;
    riskScore: number;
    flags: string[];
    betterTime?: string;
}

interface DayResult {
    date: string;
    city: string;
    forecast: ForecastResult;
    visits?: {
        respiratory_risk_percent?: number;
    };
    daySuggestion?: string;
    activities: RichActivity[];
    overallTier: string;
    overallScore: number;
}

// ══════════════════════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════════════════════

const HEALTH_CHIPS = [
    "Asthma", "COPD", "Allergies", "Epilepsy",
    "Heart Disease", "Diabetes", "Gluten-free", "Vegetarian",
];

const CONDITION_WEIGHTS: Record<string, { aqi: number; humidity: number; heat: number }> = {
    asthma: { aqi: 2.0, humidity: 1.2, heat: 1.1 },
    copd: { aqi: 2.5, humidity: 1.3, heat: 1.2 },
    epilepsy: { aqi: 0.5, humidity: 0.5, heat: 1.5 },
    "heart disease": { aqi: 1.5, humidity: 1.0, heat: 1.8 },
    diabetes: { aqi: 1.0, humidity: 1.0, heat: 1.6 },
    allergies: { aqi: 1.5, humidity: 1.4, heat: 0.8 },
};

// ══════════════════════════════════════════════════════════════════════════════
// Risk computation (frontend, using p75 pessimistic estimate)
// ══════════════════════════════════════════════════════════════════════════════

type PredMap = ForecastResult["predictions"];

function hourlyValue(
    hourly: ForecastResult["hourly_breakdown"],
    hour: number | undefined,
    key: string,
): number | undefined {
    if (hour === undefined) return undefined;
    const entry = hourly.find(h => h.hour === hour);
    const raw = entry?.[key as keyof typeof entry];
    return typeof raw === "number" ? raw : undefined;
}

function computeRisk(
    preds: PredMap,
    hourly: ForecastResult["hourly_breakdown"],
    conds: string[],
    actType: string,
    schedHour?: number,
): { tier: string; score: number; flags: string[]; betterTime?: string } {
    const p75 = (k: string) => {
        const p = (preds as Record<string, { mean: number; p75?: number }>)[k];
        return p?.p75 ?? p?.mean ?? 0;
    };

    // Temperature and humidity stay daily (p75); AQ uses time-specific values when available.
    const tempC = p75("temperature_2m");
    const tempF = tempC * 9 / 5 + 32;
    const hum = p75("relative_humidity_2m");

    const aqi = hourlyValue(hourly, schedHour, "us_aqi") ?? p75("us_aqi");
    const pm25 = hourlyValue(hourly, schedHour, "pm2_5") ?? p75("pm2_5");
    const pm10 = hourlyValue(hourly, schedHour, "pm10") ?? p75("pm10");
    const no2 = hourlyValue(hourly, schedHour, "nitrogen_dioxide") ?? p75("nitrogen_dioxide");
    const o3 = hourlyValue(hourly, schedHour, "ozone") ?? p75("ozone");

    const isOutdoor = ["outdoor", "hiking"].includes(actType);
    const aqiExposure = isOutdoor ? 1.0 : 0.6;

    let aqiW = 1.0, humW = 1.0, heatW = 1.0;
    for (const c of conds) {
        const w = CONDITION_WEIGHTS[c.toLowerCase()];
        if (w) {
            aqiW = Math.max(aqiW, w.aqi);
            humW = Math.max(humW, w.humidity);
            heatW = Math.max(heatW, w.heat);
        }
    }

    let aqiScore = 0;
    if (aqi > 100) aqiScore = (aqi - 100) / 4;
    else if (aqi > 50) aqiScore = (aqi - 50) / 2.5;
    aqiScore = Math.min(40, aqiScore * aqiW * aqiExposure);

    let heatScore = 0;
    if (tempF > 90) heatScore += Math.min(20, (tempF - 90) * 2) * heatW;
    if (hum > 70) heatScore += Math.min(10, (hum - 70) / 3) * humW;
    heatScore = Math.min(30, heatScore);

    const score = Math.round(Math.min(100, aqiScore + heatScore));
    const tier = score < 25 ? "Low" : score < 50 ? "Moderate" : score < 75 ? "High" : "Very High";

    const flags: string[] = [];
    if (aqi > 150) flags.push(`AQI ${aqi.toFixed(0)} — hazardous for outdoor activity`);
    else if (aqi > 100 && isOutdoor) flags.push(`AQI ${aqi.toFixed(0)} — limit strenuous outdoor exertion`);
    if (pm25 > 35) flags.push(`PM2.5 ${pm25.toFixed(1)} µg/m³ — elevated fine particles`);
    if (pm10 > 50) flags.push(`PM10 ${pm10.toFixed(1)} µg/m³ — coarse particles elevated`);
    if (no2 > 100) flags.push(`NO₂ ${no2.toFixed(0)} µg/m³ — nitrogen dioxide elevated`);
    if (o3 > 70 && conds.some(c => ["asthma", "copd", "allergies"].includes(c.toLowerCase()))) {
        flags.push(`O₃ ${o3.toFixed(1)} µg/m³ — ozone elevated, respiratory risk`);
    }
  }

  let aqiScore = 0;
  if (aqi > 100) aqiScore = (aqi - 100) / 4;
  else if (aqi > 50) aqiScore = (aqi - 50) / 2.5;
  aqiScore = Math.min(40, aqiScore * aqiW * aqiExposure);

  let heatScore = 0;
  if (tempF > 90) heatScore += Math.min(20, (tempF - 90) * 2) * heatW;
  if (hum  > 70) heatScore += Math.min(10, (hum - 70) / 3) * humW;
  heatScore = Math.min(30, heatScore);

  const score = Math.round(Math.min(100, aqiScore + heatScore));
  const tier  = score < 25 ? "Low" : score < 50 ? "Moderate" : score < 75 ? "High" : "Very High";

  const flags: string[] = [];
  if (aqi > 150) flags.push(`AQI ${aqi.toFixed(0)} — hazardous for outdoor activity`);
  else if (aqi > 100 && isOutdoor) flags.push(`AQI ${aqi.toFixed(0)} — limit strenuous outdoor exertion`);
  if (pm25 > 35) flags.push(`PM2.5 ${pm25.toFixed(1)} µg/m³ — elevated fine particles`);
  if (o3 > 70 && conds.some(c => ["asthma", "copd", "allergies"].includes(c.toLowerCase()))) {
    flags.push(`O₃ ${o3.toFixed(1)} µg/m³ — ozone elevated, respiratory risk`);
  }
  if (tempF > 95) flags.push(`Heat ${tempF.toFixed(0)}°F — stay hydrated`);
  if (hum > 80) flags.push(`Humidity ${hum.toFixed(0)}% — may worsen breathing`);

  let betterTime: string | undefined;
  if (schedHour !== undefined && hourly.length > 0) {
    // Only consider waking hours (6 AM – 9 PM) so we never recommend midnight
    const valid = hourly.filter(h => h.us_aqi !== undefined && h.hour >= 6 && h.hour <= 21);
    if (valid.length > 0) {
      const best = valid.reduce((a, b) => (a.us_aqi < b.us_aqi ? a : b));
      const schedAqi = hourly.find(h => h.hour === schedHour)?.us_aqi ?? aqi;
      // Always show the best time if it differs from scheduled (any improvement)
      if (best.hour !== schedHour) {
        const diff = schedAqi - best.us_aqi;
        betterTime = `Best air: ${String(best.hour).padStart(2, "0")}:00 (AQI ${best.us_aqi.toFixed(0)}${diff > 0 ? `, ${diff.toFixed(0)} better than ${String(schedHour).padStart(2,"0")}:00` : ""})`;
      }
    }

    return { tier, score, flags, betterTime };
}

// ══════════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════════

function inferType(name: string): string {
    const n = name.toLowerCase();
    if (/museum|gallery|cinema|theater|mall|airport|hotel/.test(n)) return "indoor";
    if (/dinner|lunch|breakfast|brunch|restaurant|cafe|dining|eat|food/.test(n)) return "dining";
    if (/bus|train|metro|subway|flight|taxi|uber|transit|transfer/.test(n)) return "transit";
    if (/hike|hiking|trail|mountain|climb/.test(n)) return "hiking";
    return "outdoor";
}

function parseHour(time: string): number {
    const [h] = time.split(":");
    return parseInt(h, 10) || 9;
}

const TIER_ORDER = ["Low", "Moderate", "High", "Very High"];
function worseTier(tiers: string[]): string {
    let worst = 0;
    for (const t of tiers) {
        const i = TIER_ORDER.indexOf(t);
        if (i > worst) worst = i;
    }
    return TIER_ORDER[worst];
}

const TIER_COLOR: Record<string, string> = {
    Low: "text-green-400",
    Moderate: "text-yellow-400",
    High: "text-orange-400",
    "Very High": "text-red-400",
};
const TIER_BG: Record<string, string> = {
    Low: "border-green-500/20",
    Moderate: "border-yellow-500/20",
    High: "border-orange-500/20",
    "Very High": "border-red-500/20",
};

const SUGGESTION_START_HOUR = 8;
const SUGGESTION_END_HOUR = 20;

function respiratoryRiskLabel(risk: number): "Low" | "Medium" | "High" {
    if (risk < 4) return "Low";
    if (risk <= 8) return "Medium";
    return "High";
}

function respiratoryRiskColor(label: "Low" | "Medium" | "High"): string {
    if (label === "Low") return "text-green-400";
    if (label === "Medium") return "text-yellow-400";
    return "text-red-400";
}

function bestOutdoorWindow(hourly: ForecastResult["hourly_breakdown"]): { hour: number; aqi: number } | null {
    const valid = hourly.filter(h =>
        typeof h.us_aqi === "number"
        && h.hour >= SUGGESTION_START_HOUR
        && h.hour <= SUGGESTION_END_HOUR
    );
    if (valid.length === 0) return null;
    const best = valid.reduce((a, b) => (a.us_aqi < b.us_aqi ? a : b));
    return { hour: best.hour, aqi: best.us_aqi };
}

function buildDaySuggestion(
    forecast: ForecastResult,
    conds: string[],
): string | undefined {
    const best = bestOutdoorWindow(forecast.hourly_breakdown);
    if (!best) return undefined;

    const sensitive = conds.some(c => ["asthma", "copd", "allergies"].includes(c.toLowerCase()));
    const hourLabel = `${String(best.hour).padStart(2, "0")}:00`;
    if (best.aqi <= 50) {
        return `Best outdoor window around ${hourLabel} (AQI ${best.aqi.toFixed(0)}).`;
    }
    if (best.aqi <= 100) {
        return `Outdoor OK around ${hourLabel} (AQI ${best.aqi.toFixed(0)}). Keep activity moderate.`;
    }
    return sensitive
        ? `Air quality elevated all day. Prefer indoor spots; if you go out, keep it brief around ${hourLabel} (AQI ${best.aqi.toFixed(0)}).`
        : `Air quality elevated. Prefer indoor venues; if you go out, try around ${hourLabel} (AQI ${best.aqi.toFixed(0)}).`;
}

// ── Nominatim geocoding with simple in-memory cache ──────────────────────────
const _geoCache: Record<string, { lat: number; lon: number } | null> = {};
let _lastGeoReq = 0;

async function geocode(query: string): Promise<{ lat: number; lon: number } | null> {
    if (_geoCache[query] !== undefined) return _geoCache[query];
    // Rate-limit to 1 req/s (Nominatim policy)
    const now = Date.now();
    if (now - _lastGeoReq < 1100) await new Promise(r => setTimeout(r, 1100 - (now - _lastGeoReq)));
    _lastGeoReq = Date.now();
    try {
        const r = await fetch(
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`,
            { headers: { "User-Agent": "breathe-travel-app/1.0" } },
        );
        const data = await r.json();
        const result = data.length ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) } : null;
        _geoCache[query] = result;
        return result;
    } catch {
        _geoCache[query] = null;
        return null;
    }
}

// ── PDF text extraction (pdfjs-dist, loaded dynamically) ─────────────────────
async function extractPdfText(file: File): Promise<string> {
    // Dynamic import keeps pdfjs out of the initial bundle
    const pdfjsLib = await import("pdfjs-dist");
    // Set worker via CDN to match the installed version (avoids webpack bundling issues)
    pdfjsLib.GlobalWorkerOptions.workerSrc =
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item: unknown) => (item as { str: string }).str).join(" ") + "\n";
    }
    return text;
}

// ── Gemini structured extraction ──────────────────────────────────────────────
// Update the model string once Gemini 3 is available (e.g. "gemini-3-flash")
const GEMINI_MODEL = "gemini-2.5-flash";

const EXTRACTION_PROMPT = `You are a travel itinerary parser. Extract the itinerary from the text below and return ONLY valid JSON — no markdown, no explanation, nothing else.

Return this exact shape:
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "city": "City Name",
      "activities": [
        { "name": "Activity Name", "location": "Specific place, City", "time": "HH:MM" }
      ]
    }
  ]
}

Rules:
- Infer times from context if missing (morning → 09:00, afternoon → 14:00, evening → 19:00)
- If no specific address, use the landmark name + city (e.g. "Central Park, New York")
- If dates are relative ("Day 1"), infer YYYY-MM-DD from any absolute date in the text
- If multi-city in one day, create separate day entries
- Return ONLY the JSON object

Itinerary text:
`;

async function extractWithGemini(text: string): Promise<ParsedItinerary> {
    const key = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!key) throw new Error("NEXT_PUBLIC_GEMINI_API_KEY is not set in .env.local");

    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: key });
    const result = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: EXTRACTION_PROMPT + text,
    });
    const raw = (result.text ?? "").trim();

    // Strip optional markdown code fence
    const jsonStr = raw.replace(/^```(?:json)?\n?/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(jsonStr) as ParsedItinerary;

    // Ensure activities have a type field
    parsed.days.forEach(day => {
        day.activities.forEach(act => {
            if (!act.type) {
                act.type = inferType(act.name);
            }
        });
    });
    return parsed;
}

// ══════════════════════════════════════════════════════════════════════════════
// Page component
// ══════════════════════════════════════════════════════════════════════════════

export default function ItineraryPage() {
    const [pageState, setPageState] = useState<PageState>("upload");
    const [conditions, setConditions] = useState<string[]>([]);
    const [itinerary, setItinerary] = useState<ParsedItinerary>({ days: [] });
    const [results, setResults] = useState<DayResult[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [parseStatus, setParseStatus] = useState("Reading your itinerary…");
    const [expandedDay, setExpandedDay] = useState<number | null>(0);
    const [expandedEnv, setExpandedEnv] = useState<number | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ── Toggle health condition chip ───────────────────────────────────────────
    const toggleCondition = (c: string) =>
        setConditions(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

    // ── Handle PDF upload ──────────────────────────────────────────────────────
    const handleFile = useCallback(async (file: File) => {
        if (!file.name.toLowerCase().endsWith(".pdf")) {
            setError("Please upload a PDF file.");
            return;
        }
        setError(null);
        setPageState("parsing");
        setParseStatus("Extracting text from PDF…");

        try {
            const pdfText = await extractPdfText(file);
            setParseStatus("Parsing itinerary with Gemini…");
            const parsed = await extractWithGemini(pdfText);
            setItinerary(parsed);
            setPageState("confirm");
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Unknown error";
            setError(`Parsing failed: ${msg}`);
            setPageState("upload");
        }
    }, []);

    const onDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    }, [handleFile]);

    const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
    };

    // ── Confirmation: edit helpers ─────────────────────────────────────────────
    const updateActivity = (di: number, ai: number, field: keyof ParsedActivity, val: string) =>
        setItinerary(prev => {
            const days = prev.days.map((d, idx) =>
                idx !== di ? d : {
                    ...d,
                    activities: d.activities.map((a, ji) => ji === ai ? { ...a, [field]: val } : a),
                });
            return { ...prev, days };
        });

    const removeActivity = (di: number, ai: number) =>
        setItinerary(prev => ({
            ...prev,
            days: prev.days.map((d, idx) =>
                idx !== di ? d : { ...d, activities: d.activities.filter((_, j) => j !== ai) }),
        }));

    const addActivity = (di: number) =>
        setItinerary(prev => ({
            ...prev,
            days: prev.days.map((d, idx) =>
                idx !== di ? d : {
                    ...d,
                    activities: [...d.activities, { name: "", location: d.city, time: "09:00", type: "outdoor" }],
                }),
        }));

    // ── Add manual day (skip PDF flow) ─────────────────────────────────────────
    const startManually = () => {
        setItinerary({
            days: [{
                date: new Date().toISOString().split("T")[0],
                city: "",
                activities: [{ name: "", location: "", time: "09:00", type: "outdoor" }],
            }],
        });
        setPageState("confirm");
    };

    // ── Analysis: geocode + forecast fetch + risk compute ─────────────────────
    const runAnalysis = async () => {
        setPageState("analyzing");
        setError(null);

        try {
            // 1. Deduplicate (city, date) pairs → fetch forecasts in parallel
            const pairLookup: Record<string, { city: string; target_date: string }> = {};
            itinerary.days.forEach(d => {
                pairLookup[`${d.city}|${d.date}`] = { city: d.city, target_date: d.date };
            });
            const pairs = Object.values(pairLookup);

            const forecastMap: Record<string, ForecastResult> = {};
            const visitsMap: Record<string, { respiratory_risk_percent?: number }> = {};
            await Promise.all(pairs.map(async ({ city, target_date }) => {
                try {
                    const [forecastRes, visitsRes] = await Promise.all([
                        fetch("/api/forecast/predict", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ city, target_date }),
                        }),
                        fetch("/api/forecast/predict_respiratory_risk", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ city, target_date }),
                        }),
                    ]);

                    if (forecastRes.ok) {
                        forecastMap[`${city}|${target_date}`] = await forecastRes.json();
                    }
                    if (visitsRes.ok) {
                        visitsMap[`${city}|${target_date}`] = await visitsRes.json();
                    }
                } catch { /* forecast failure handled below */ }
            }));

            // 2. Build results day by day
            const dayResults: DayResult[] = [];

            for (const day of itinerary.days) {
                const fKey = `${day.city}|${day.date}`;
                const forecast = forecastMap[fKey];
                const visits = visitsMap[fKey];

                if (!forecast) {
                    // Skip days with no forecast (shouldn't happen in normal flow)
                    continue;
                }

                // Sort activities by time
                const sorted = [...day.activities].sort((a, b) => a.time.localeCompare(b.time));

                // 3. Geocode each activity's location (Nominatim, rate-limited)
                const richActivities: RichActivity[] = [];
                for (const act of sorted) {
                    const locQuery = act.location || `${act.name}, ${day.city}`;
                    // First try the activity's location string; fall back to city center
                    const geo = await geocode(locQuery) ?? { lat: forecast.lat, lon: forecast.lon };

                    const hour = parseHour(act.time);
                    const risk = computeRisk(
                        forecast.predictions,
                        forecast.hourly_breakdown,
                        conditions,
                        act.type,
                        hour,
                    );

                    richActivities.push({
                        ...act,
                        lat: geo.lat,
                        lon: geo.lon,
                        riskTier: risk.tier,
                        riskScore: risk.score,
                        flags: risk.flags,
                        betterTime: risk.betterTime,
                    });
                }

                const overallTier = worseTier(richActivities.map(a => a.riskTier));
                const overallScore = Math.max(...richActivities.map(a => a.riskScore), 0);
                const daySuggestion = buildDaySuggestion(forecast, conditions);

                dayResults.push({
                    date: day.date,
                    city: day.city,
                    forecast,
                    visits,
                    daySuggestion,
                    activities: richActivities,
                    overallTier,
                    overallScore,
                });
            }

            setResults(dayResults);
            setPageState("results");
            setExpandedDay(0);
        } catch (e) {
            setError(`Analysis failed: ${e instanceof Error ? e.message : String(e)}`);
            setPageState("confirm");
        }
    };

    // ══════════════════════════════════════════════════════════════════════════
    // Render
    // ══════════════════════════════════════════════════════════════════════════

    return (
        <div className="space-y-6 max-w-4xl mx-auto">
            {/* Page header */}
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <MapIcon className="text-violet-400" size={24} /> Upload Itinerary
                </h1>
                <p className="text-slate-400 text-sm mt-1">
                    Upload a PDF travel plan — Gemini extracts it, our ML model predicts the air quality.
                </p>
            </div>

            {/* ── STATE 1: Upload ──────────────────────────────────────────────── */}
            {pageState === "upload" && (
                <div className="space-y-4">
                    <div
                        onDrop={onDrop}
                        onDragOver={e => e.preventDefault()}
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-slate-600 hover:border-teal-500 rounded-xl
                       flex flex-col items-center justify-center gap-3 py-16 px-8 cursor-pointer
                       transition-colors bg-slate-900/30 hover:bg-teal-900/10"
                    >
                        <Upload className="text-slate-500" size={40} />
                        <div className="text-center">
                            <p className="text-slate-300 font-medium">Drag &amp; drop your PDF itinerary</p>
                            <p className="text-slate-500 text-sm mt-1">or click to browse</p>
                        </div>
                        <span className="text-xs text-slate-600">PDF only · processed entirely in your browser</span>
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf"
                        className="hidden"
                        onChange={onFileInput}
                    />

                    <button
                        onClick={startManually}
                        className="w-full btn-ghost text-sm"
                    >
                        Don&apos;t have a PDF? Build itinerary manually →
                    </button>

                    {error && (
                        <div className="card border-red-500/20 bg-red-500/10 flex items-center gap-2 text-red-400 text-sm">
                            <AlertTriangle size={16} /> {error}
                        </div>
                    )}
                </div>
            )}

            {/* ── STATE 2: Parsing (+ State 3: health chips shown simultaneously) ─ */}
            {pageState === "parsing" && (
                <div className="space-y-6">
                    {/* Parsing indicator */}
                    <div className="card flex items-center gap-4">
                        <Loader2 className="text-teal-400 animate-spin flex-shrink-0" size={28} />
                        <div>
                            <p className="font-medium text-slate-200">{parseStatus}</p>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Pick your health conditions while we work — no dead wait time.
                            </p>
                        </div>
                    </div>

                    {/* Health condition chips — shown here so user isn't sitting idle */}
                    <ConditionChips selected={conditions} onToggle={toggleCondition} />
                </div>
            )}

            {/* ── STATE 3: Confirmation (editable parsed itinerary) ──────────────── */}
            {pageState === "confirm" && (
                <div className="space-y-6">
                    {/* Health condition chips */}
                    <ConditionChips selected={conditions} onToggle={toggleCondition} />

                    <div className="space-y-4">
                        <h2 className="text-lg font-semibold text-slate-200 flex items-center gap-2">
                            <FileText size={18} className="text-violet-400" />
                            Review your itinerary — fix anything before analysis
                        </h2>

                        {itinerary.days.map((day, di) => (
                            <div key={di} className="card space-y-3">
                                {/* Day header */}
                                <div className="flex items-center gap-3 flex-wrap">
                                    <input
                                        type="date"
                                        value={day.date}
                                        onChange={e =>
                                            setItinerary(prev => ({
                                                ...prev,
                                                days: prev.days.map((d, i) => i !== di ? d : { ...d, date: e.target.value }),
                                            }))}
                                        className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm"
                                    />
                                    <input
                                        type="text"
                                        placeholder="City"
                                        value={day.city}
                                        onChange={e =>
                                            setItinerary(prev => ({
                                                ...prev,
                                                days: prev.days.map((d, i) => i !== di ? d : { ...d, city: e.target.value }),
                                            }))}
                                        className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[140px]"
                                    />
                                </div>

                                {/* Activity rows — inline editable */}
                                <div className="space-y-1.5">
                                    {day.activities.map((act, ai) => (
                                        <div key={ai} className="flex items-center gap-2 flex-wrap bg-slate-800/50 rounded-lg px-3 py-2">
                                            <input
                                                type="time"
                                                value={act.time}
                                                onChange={e => updateActivity(di, ai, "time", e.target.value)}
                                                className="bg-transparent text-sm w-20 outline-none"
                                            />
                                            <input
                                                type="text"
                                                placeholder="Activity name"
                                                value={act.name}
                                                onChange={e => updateActivity(di, ai, "name", e.target.value)}
                                                className="bg-transparent text-sm flex-1 min-w-[120px] outline-none"
                                            />
                                            <input
                                                type="text"
                                                placeholder="Location"
                                                value={act.location}
                                                onChange={e => updateActivity(di, ai, "location", e.target.value)}
                                                className="bg-transparent text-xs text-slate-400 flex-1 min-w-[120px] outline-none"
                                            />
                                            <select
                                                value={act.type}
                                                onChange={e => updateActivity(di, ai, "type", e.target.value)}
                                                className="bg-slate-700 border border-slate-600 rounded px-1.5 py-0.5 text-xs"
                                            >
                                                {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                            </select>
                                            <button
                                                onClick={() => removeActivity(di, ai)}
                                                className="text-slate-500 hover:text-red-400 transition-colors"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        onClick={() => addActivity(di)}
                                        className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors mt-1"
                                    >
                                        <Plus size={12} /> Add activity
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {error && (
                        <div className="card border-red-500/20 bg-red-500/10 flex items-center gap-2 text-red-400 text-sm">
                            <AlertTriangle size={16} /> {error}
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button onClick={() => setPageState("upload")} className="btn-ghost flex items-center gap-2">
                            <RotateCcw size={14} /> Start over
                        </button>
                        <button
                            onClick={runAnalysis}
                            disabled={itinerary.days.length === 0}
                            className="btn-primary flex-1 flex items-center justify-center gap-2"
                        >
                            <CheckCircle size={16} /> Looks good — analyze risks
                        </button>
                    </div>
                </div>
            )}

            {/* ── STATE 4: Analyzing ─────────────────────────────────────────────── */}
            {pageState === "analyzing" && (
                <div className="card flex flex-col items-center gap-4 py-12">
                    <Loader2 className="text-teal-400 animate-spin" size={40} />
                    <div className="text-center">
                        <p className="font-medium text-slate-200">Fetching environmental forecasts…</p>
                        <p className="text-slate-500 text-sm mt-1">
                            Geocoding locations · calling ML forecast API · computing per-activity risk
                        </p>
                    </div>
                </div>
            )}

            {/* ── STATE 5: Results ───────────────────────────────────────────────── */}
            {pageState === "results" && results.length > 0 && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-semibold">Your Health Itinerary</h2>
                        <button onClick={() => setPageState("upload")} className="btn-ghost text-sm flex items-center gap-1">
                            <RotateCcw size={13} /> New trip
                        </button>
                    </div>

                    {results.map((day, di) => {
                        const isOpen = expandedDay === di;
                        const isEnvOpen = expandedEnv === di;
                        const envForecast = buildEnvForecast(day.forecast);

                        return (
                            <div key={di} className={`card border ${TIER_BG[day.overallTier] ?? "border-slate-700"}`}>
                                {/* Day card header */}
                                <button
                                    className="w-full flex items-center justify-between gap-3"
                                    onClick={() => setExpandedDay(isOpen ? null : di)}
                                >
                                    <div className="flex items-center gap-3 flex-wrap">
                                        <span className="text-slate-400 text-sm">{day.date}</span>
                                        <span className="font-medium text-slate-300">{day.city}</span>
                                        <span className={`text-sm font-semibold ${TIER_COLOR[day.overallTier]}`}>
                                            {day.overallTier} risk ({day.overallScore})
                                        </span>
                                        <SourceBadge source={day.forecast.source} />
                                    </div>
                                    {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                </button>

                                {isOpen && (
                                    <div className="mt-4 space-y-5 border-t border-slate-800 pt-4">
                                        {day.visits && (
                                            <div className="px-3 py-2 text-sm text-slate-300 border-b border-slate-800/40">
                                                {day.visits.respiratory_risk_percent !== undefined ? (
                                                    <div className="text-base md:text-lg">
                                                        Respiratory visit risk: {" "}
                                                        <strong className={respiratoryRiskColor(respiratoryRiskLabel(day.visits.respiratory_risk_percent))}>
                                                            {respiratoryRiskLabel(day.visits.respiratory_risk_percent)}
                                                        </strong>
                                                        <span className="text-slate-400"> ({day.visits.respiratory_risk_percent.toFixed(2)}%)</span>
                                                    </div>
                                                ) : <div className="text-xs text-slate-500">Model not available — showing environmental forecast only.</div>}
                                            </div>
                                        )}
                                        {day.daySuggestion && (
                                            <div className="px-3 py-2 text-sm text-emerald-300 border-b border-slate-800/40">
                                                {day.daySuggestion}
                                            </div>
                                        )}
                                        {/* Map — shows route + heatmap */}
                                        <ItineraryMap
                                            activities={day.activities.map((a, idx) => ({
                                                name: a.name,
                                                time: a.time,
                                                type: a.type,
                                                lat: a.lat,
                                                lon: a.lon,
                                                riskTier: a.riskTier,
                                                riskScore: a.riskScore,
                                                flags: a.flags,
                                                betterTime: a.betterTime,
                                                location: a.location,
                                            } satisfies ActivityPoint))}
                                            forecast={day.forecast}
                                        />

                                        {/* Per-activity risk cards */}
                                        <div>
                                            <h4 className="text-sm font-semibold text-slate-400 mb-2">
                                                Activity Breakdown
                                            </h4>
                                            <div className="space-y-2">
                                                {day.activities.map((act, ai) => (
                                                    <div
                                                        key={ai}
                                                        className={`rounded-lg px-3 py-2.5 border ${TIER_BG[act.riskTier]} bg-slate-900/40`}
                                                    >
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div>
                                                                <span className="font-medium text-slate-200 text-sm">{act.name}</span>
                                                                <span className="text-slate-500 text-xs ml-2">{act.time} · {act.location}</span>
                                                            </div>
                                                            <span className={`text-xs font-semibold flex-shrink-0 ${TIER_COLOR[act.riskTier]}`}>
                                                                {act.riskTier}
                                                            </span>
                                                        </div>
                                                        {act.flags.map((f, fi) => (
                                                            <p key={fi} className="text-xs text-orange-400 mt-1">⚠ {f}</p>
                                                        ))}
                                                        {act.betterTime && (
                                                            <p className="text-xs text-emerald-400 mt-1">💡 {act.betterTime}</p>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Collapsible EnvForecastPanel */}
                                        {envForecast && (
                                            <div className="border border-slate-700/50 rounded-lg overflow-hidden">
                                                <button
                                                    className="w-full flex items-center justify-between px-3 py-2.5 bg-slate-800/40 text-sm"
                                                    onClick={() => setExpandedEnv(isEnvOpen ? null : di)}
                                                >
                                                    <span className="text-teal-400 font-medium">Environmental Details</span>
                                                    {isEnvOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                </button>
                                                {isEnvOpen && (
                                                    <div className="p-3">
                                                        <EnvForecastPanel ef={envForecast} />
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════════════════
// Sub-components
// ══════════════════════════════════════════════════════════════════════════════

function ConditionChips({
    selected,
    onToggle,
}: {
    selected: string[];
    onToggle: (c: string) => void;
}) {
    return (
        <div className="card space-y-2">
            <p className="text-sm font-semibold text-slate-300">Your health conditions</p>
            <p className="text-xs text-slate-500">Selected conditions adjust the risk weights applied to the forecast.</p>
            <div className="flex flex-wrap gap-2 mt-1">
                {HEALTH_CHIPS.map(c => (
                    <button
                        key={c}
                        onClick={() => onToggle(c)}
                        className={`px-3 py-1 rounded-full text-sm border transition-colors ${selected.includes(c)
                            ? "bg-teal-600 border-teal-500 text-white"
                            : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500"
                            }`}
                    >
                        {c}
                    </button>
                ))}
            </div>
        </div>
    );
}

// ── Convert ForecastResult → EnvForecast (for EnvForecastPanel) ─────────────
function buildEnvForecast(f: ForecastResult): EnvForecast | null {
    if (!f?.predictions) return null;
    const p = f.predictions as Record<string, { mean: number; min: number; max: number; p25?: number; p75?: number } | undefined>;
    const ep = (k: string) => p[k] ?? undefined;
    return {
        source: f.source,
        days_ahead: f.days_ahead,
        aqi_category: f.aqi_category,
        data_points_used: f.data_points_used,
        temperature_2m: ep("temperature_2m"),
        relative_humidity_2m: ep("relative_humidity_2m"),
        wind_speed_10m: ep("wind_speed_10m"),
        precipitation: ep("precipitation"),
        pm2_5: ep("pm2_5"),
        pm10: ep("pm10"),
        nitrogen_dioxide: ep("nitrogen_dioxide"),
        ozone: ep("ozone"),
        us_aqi: ep("us_aqi"),
    };
}
