"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wind, Map, MessageSquare, Activity } from "lucide-react";

const LINKS = [
  { href: "/now",       label: "Right Now",        icon: Wind },
  { href: "/itinerary", label: "Upload Itinerary",  icon: Map },
  { href: "/plan",      label: "Plan with AI",      icon: MessageSquare },
];

export default function Navbar() {
  const path = usePathname();

  return (
    <nav className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-14">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 font-bold text-lg">
          <Activity size={20} className="text-teal-400" />
          <span className="text-white">Breathe</span>
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-1">
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active = path === href || path.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? "bg-teal-500/15 text-teal-400"
                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                }`}
              >
                <Icon size={14} />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
