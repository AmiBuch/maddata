import Link from "next/link";
import { Wind, Map, MessageSquare, ChevronRight } from "lucide-react";

const SCREENS = [
  {
    href: "/now",
    icon: Wind,
    title: "Right Now",
    description: "Live air quality, weather, and health risk at your current location.",
    color: "text-teal-400",
    bg: "bg-teal-500/10 border-teal-500/20",
  },
  {
    href: "/itinerary",
    icon: Map,
    title: "Upload Itinerary",
    description: "Paste or upload your travel plan — get a day-by-day personal risk forecast.",
    color: "text-violet-400",
    bg: "bg-violet-500/10 border-violet-500/20",
  },
  {
    href: "/plan",
    icon: MessageSquare,
    title: "Plan with Pathfinder",
    description: "Get personalized recommendations for restaurants and activities.",
    color: "text-sky-400",
    bg: "bg-sky-500/10 border-sky-500/20",
  },
];

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] text-center gap-12">
      {/* Hero */}
      <div className="space-y-4 max-w-2xl">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-teal-500/30 bg-teal-500/10 text-teal-400 text-sm font-medium mb-2">
          <Wind size={14} />
          Health-Aware Travel Intelligence
        </div>
        <h1 className="text-5xl font-bold tracking-tight">
          <span className="text-teal-400">Plan your trip with real-time health, weather, and location insights.</span>
        </h1>
        <p className="text-slate-400 text-lg leading-relaxed">
          Our mission is to provide users with data-driven travel recommendations by
          combining environmental data, public health alerts, and location intelligence
          to identify safe activities, restaurants, and itineraries for a given destination.
        </p>
        <Link
          href="/plan"
          className="inline-flex items-center gap-2 mt-4 px-4 py-2.5 rounded-lg border border-teal-500/30 bg-teal-500/10 text-teal-400 font-medium hover:bg-teal-500/20 transition-colors"
        >
          Plan your trip <ChevronRight size={16} />
        </Link>
      </div>

      {/* Screen cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-4xl">
        {SCREENS.map(({ href, icon: Icon, title, description, color, bg }) => (
          <Link
            key={href}
            href={href}
            className={`card border ${bg} hover:scale-[1.02] transition-transform text-left group`}
          >
            <div className={`${color} mb-3`}>
              <Icon size={28} />
            </div>
            <h2 className="font-semibold text-lg mb-1">{title}</h2>
            <p className="text-slate-400 text-sm leading-relaxed mb-4">{description}</p>
            <span className={`inline-flex items-center gap-1 text-sm font-medium ${color}`}>
              Open <ChevronRight size={14} className="group-hover:translate-x-1 transition-transform" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
