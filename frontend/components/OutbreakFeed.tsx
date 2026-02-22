"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Newspaper, AlertCircle, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import RiskBadge from "./RiskBadge";

interface Report {
  id: string;
  headline: string;
  source: string;
  published_at: string;
  url: string;
  condition_tags: string[];
  severity: string;
  neighborhood?: string;
}

const SEVERITY_BADGE: Record<string, string> = {
  High:     "text-red-400 bg-red-500/10 border border-red-500/20",
  Moderate: "text-amber-400 bg-amber-500/10 border border-amber-500/20",
  Low:      "text-green-400 bg-green-500/10 border border-green-500/20",
};

export default function OutbreakFeed({ city }: { city: string }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios
      .get(`/api/outbreaks/?city=${encodeURIComponent(city)}`)
      .then((r) => setReports(r.data.reports))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, [city]);

  return (
    <div className="card flex flex-col" style={{ maxHeight: 380 }}>
      <div className="flex items-center gap-2 mb-3">
        <Newspaper size={16} className="text-red-400" />
        <h3 className="font-semibold">Live Outbreak Feed</h3>
        <span className="ml-auto text-xs text-slate-500 flex items-center gap-1">
          <Clock size={10} /> Updated 20 min
        </span>
      </div>

      <div className="overflow-y-auto space-y-3 flex-1">
        {loading && (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="animate-pulse bg-slate-800 rounded-lg h-16" />
            ))}
          </div>
        )}

        {!loading && reports.length === 0 && (
          <div className="text-slate-500 text-sm flex items-center gap-2 py-4">
            <AlertCircle size={14} /> No active outbreak reports for {city}
          </div>
        )}

        {reports.map((r) => (
          <a
            key={r.id}
            href={r.url !== "#" ? r.url : undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="block bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 rounded-lg p-3 transition-colors"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm text-slate-200 leading-snug line-clamp-2">{r.headline}</p>
              <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full ${SEVERITY_BADGE[r.severity]}`}>
                {r.severity}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-500">{r.source}</span>
              <span className="text-xs text-slate-600">·</span>
              <span className="text-xs text-slate-500">
                {formatDistanceToNow(new Date(r.published_at), { addSuffix: true })}
              </span>
              {r.condition_tags.map((tag) => (
                <span key={tag} className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                  {tag}
                </span>
              ))}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
