"use client";

import { useState, useRef, useEffect } from "react";
import { Heart, ChevronDown, X } from "lucide-react";

const CONDITIONS = [
  "Asthma", "COPD", "Epilepsy", "Heart disease", "Diabetes",
  "Allergies", "Nut allergy", "Gluten intolerance", "Migraines",
];

interface Props {
  selected: string[];
  onChange: (val: string[]) => void;
}

export default function HealthProfileSelector({ selected, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (c: string) =>
    onChange(selected.includes(c) ? selected.filter((s) => s !== c) : [...selected, c]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 btn-ghost text-sm"
      >
        <Heart size={14} className="text-rose-400" />
        Health Profile
        {selected.length > 0 && (
          <span className="bg-rose-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
            {selected.length}
          </span>
        )}
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 bg-slate-900 border border-slate-700 rounded-xl shadow-xl p-3 min-w-[220px]">
          <p className="text-xs text-slate-400 mb-2 font-medium">Select your health conditions</p>
          <div className="space-y-1">
            {CONDITIONS.map((c) => (
              <label key={c} className="flex items-center gap-2 cursor-pointer hover:bg-slate-800 rounded-lg px-2 py-1.5">
                <input
                  type="checkbox"
                  checked={selected.includes(c)}
                  onChange={() => toggle(c)}
                  className="accent-teal-500"
                />
                <span className="text-sm text-slate-200">{c}</span>
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="mt-2 flex items-center gap-1 text-xs text-slate-500 hover:text-red-400 transition-colors"
            >
              <X size={10} /> Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
