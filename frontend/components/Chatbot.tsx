"use client";

import { useState, useRef, useEffect } from "react";
import { Send, User, Bot, Utensils, Mountain } from "lucide-react";

type DietaryPreference = "Vegetarian" | "Vegan" | "Gluten-Free" | "None";

interface Message {
  role: "user" | "assistant";
  content: React.ReactNode;
}

interface Restaurant {
  name: string;
  city: string;
  rating: number;
}

interface Activity {
  name: string;
  type: string;
  city: string;
}

// Example data for recommendations
const EXAMPLE_RESTAURANTS: Restaurant[] = [

    // California
    { name: "Plant Power Fast Food", city: "California", rating: 4.6 },
    { name: "Native Foods", city: "California", rating: 4.5 },
    { name: "Veggie Grill", city: "California", rating: 4.7 },
  
    // Texas
    { name: "Leaf & Sprout Kitchen", city: "Texas", rating: 4.6 },
    { name: "Harmony Bowl", city: "Texas", rating: 4.5 },
    { name: "Bouldin Creek Cafe", city: "Texas", rating: 4.7 },
  
    // Wisconsin
    { name: "Green Owl Cafe", city: "Wisconsin", rating: 4.8 },
    { name: "Twisted Plants", city: "Wisconsin", rating: 4.6 }
  
  ];

  const EXAMPLE_ACTIVITIES: Activity[] = [

    // California
    { name: "Golden Gate Park", type: "Nature", city: "California" },
    { name: "Santa Monica Pier", type: "Tourism", city: "California" },
  
    // Texas
    { name: "Barton Springs Pool", type: "Nature", city: "Texas" },
    { name: "River Walk", type: "Walking", city: "Texas" },
  
    // Wisconsin
    { name: "Devil's Lake", type: "Hiking", city: "Wisconsin" },
    { name: "Lake Mendota", type: "Nature", city: "Wisconsin" }
  
  ];

const DIETARY_OPTIONS: DietaryPreference[] = ["Vegetarian", "Vegan", "Gluten-Free", "None"];

export default function Chatbot() {
  const [destination, setDestination] = useState("");
  const [dietaryPreference, setDietaryPreference] = useState<DietaryPreference>("None");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: (
        <p>
          Hi! I'm <strong>Breathe</strong>, your health-aware travel assistant. Tell me your destination and dietary preferences, and I'll recommend restaurants and activities that suit your needs.
        </p>
      ),
    },
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const dest = destination.trim();
    if (!dest) return;

    const userContent = (
      <p>
        I'm planning a trip to <strong>{dest}</strong>
        {dietaryPreference !== "None" && (
          <> with a <strong>{dietaryPreference}</strong> diet</>
        )}
        . What do you recommend?
      </p>
    );

    setMessages((prev) => [
      ...prev,
      { role: "user", content: userContent },
    ]);
    setDestination("");

    // Simulate response delay, then show recommendations
    setTimeout(() => {
      const recContent = (
        <div className="space-y-4">
          <p>Here are some recommendations for <strong>{dest}</strong>:</p>

          <div>
            <h4 className="font-semibold text-brand-400 flex items-center gap-2 mb-2">
              <Utensils size={16} /> Restaurants
            </h4>
            <ul className="space-y-2">
              {EXAMPLE_RESTAURANTS
                .filter((r)=>
                    r.city.toLowerCase()===dest.toLowerCase()
                )
                .map((r, i) => (
                <li key={i} className="bg-slate-800/60 rounded-lg px-3 py-2 text-sm">
                  <span className="font-medium text-slate-100">{r.name}</span>
                  <span className="text-slate-400"> · {r.city}</span>
                  <span className="text-amber-400 ml-2">★ {r.rating}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="font-semibold text-brand-400 flex items-center gap-2 mb-2">
              <Mountain size={16} /> Activities
            </h4>
            <ul className="space-y-2">
            {EXAMPLE_ACTIVITIES
                .filter((a) =>
                    a.city.toLowerCase() === dest.toLowerCase()
                )
            .map((a, i) => (
                <li key={i} className="bg-slate-800/60 rounded-lg px-3 py-2 text-sm">
                  <span className="font-medium text-slate-100">{a.name}</span>
                  <span className="text-slate-400"> · {a.type}</span>
                  <span className="text-slate-500"> · {a.city}</span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-slate-400 text-sm pt-2">
            These are example recommendations. For personalized suggestions based on your health profile, try the full Plan page.
          </p>
        </div>
      );

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: recContent },
      ]);
    }, 600);
  };

  return (
    <div className="flex flex-col h-full min-h-[400px] max-h-[600px] sm:max-h-[calc(100vh-200px)]">
      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col sm:flex-row gap-3 mb-4 p-4 bg-slate-900/50 border border-slate-800 rounded-xl"
      >
        <input
          type="text"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="Destination state (e.g. Texas)"
          className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500"
          required
        />
        <select
          value={dietaryPreference}
          onChange={(e) => setDietaryPreference(e.target.value as DietaryPreference)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500 w-full sm:w-44"
        >
          {DIETARY_OPTIONS.map((opt) => (
            <option key={opt} value={opt} className="bg-slate-800 text-slate-100">
              {opt}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!destination.trim()}
          className="btn-primary flex items-center justify-center gap-2 px-5 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send size={16} />
          <span>Get Recommendations</span>
        </button>
      </form>

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}
          >
            <div
              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                msg.role === "user"
                  ? "bg-sky-500/20 text-sky-400"
                  : "bg-brand-500/20 text-brand-400"
              }`}
            >
              {msg.role === "user" ? <User size={14} /> : <Bot size={14} />}
            </div>
            <div
              className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                msg.role === "user"
                  ? "bg-sky-500/15 border border-sky-500/20 text-sky-100"
                  : "bg-slate-800 border border-slate-700 text-slate-200"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
