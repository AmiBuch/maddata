interface RiskBadgeProps {
  level: string;
  score?: number;
  size?: "sm" | "md";
}

const LEVEL_CLASS: Record<string, string> = {
  Low:       "risk-low",
  Moderate:  "risk-moderate",
  High:      "risk-high",
  "Very High": "risk-vhigh",
};

export default function RiskBadge({ level, score, size = "md" }: RiskBadgeProps) {
  const cls = LEVEL_CLASS[level] ?? "risk-badge bg-slate-700 text-slate-300";
  return (
    <span className={`${cls} ${size === "sm" ? "text-xs px-2 py-0.5" : ""}`}>
      {level}
      {score !== undefined && <span className="opacity-70 ml-1">({score})</span>}
    </span>
  );
}
