"use client";

import { useState, useRef, useEffect } from "react";
import axios from "axios";
import { MessageSquare, Send, User, Bot, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import HealthProfileSelector from "@/components/HealthProfileSelector";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const STARTER_PROMPTS = [
  "I have asthma and I'm visiting New York in July. What should I watch out for?",
  "Plan a safe 3-day itinerary in Chicago for someone with epilepsy.",
  "When is the safest time of day to go hiking in LA during summer?",
  "What restaurants in Seattle are safe for someone with a severe nut allergy?",
];

export default function PlanPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hi! I'm **Breathe**, your health-aware travel assistant.\n\nTell me where you're going and your health conditions — I'll help you plan a trip that's safe and enjoyable for you.\n\nYou can start with something like: *\"I have asthma and I'm visiting New York next week.\"*",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conditions, setConditions] = useState<string[]>([]);
  const [destination, setDestination] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content) return;

    const userMsg: Message = { role: "user", content };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await axios.post("/api/chat/", {
        messages: [...messages, userMsg],
        health_profile: { conditions, dietary_restrictions: [] },
        destination: destination || undefined,
      });
      setMessages((prev) => [...prev, { role: "assistant", content: res.data.reply }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I couldn't connect to the server. Is the backend running?" },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageSquare className="text-sky-400" size={24} /> Plan with AI
          </h1>
          <p className="text-slate-400 text-sm mt-1">Chat with Breathe to build your health-safe itinerary</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            placeholder="Destination (optional)"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm w-44"
          />
          <HealthProfileSelector selected={conditions} onChange={setConditions} />
        </div>
      </div>

      {/* Starter prompts (only before user sends anything) */}
      {messages.length === 1 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
          {STARTER_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => send(p)}
              className="text-left text-sm card border-sky-500/20 hover:border-sky-400/40 text-slate-300 hover:text-white transition-colors py-3"
            >
              {p}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
            <div
              className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                msg.role === "user" ? "bg-sky-500/20 text-sky-400" : "bg-teal-500/20 text-teal-400"
              }`}
            >
              {msg.role === "user" ? <User size={14} /> : <Bot size={14} />}
            </div>
            <div
              className={`max-w-[80%] rounded-xl px-4 py-3 text-sm leading-relaxed prose prose-invert prose-sm ${
                msg.role === "user"
                  ? "bg-sky-500/15 border border-sky-500/20 text-sky-100"
                  : "bg-slate-800 border border-slate-700 text-slate-200"
              }`}
            >
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-teal-500/20 text-teal-400 flex items-center justify-center">
              <Bot size={14} />
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 size={14} className="animate-spin" /> Thinking…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="mt-4 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          placeholder="Ask about your trip…"
          disabled={loading}
          className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-sky-500/50 transition-colors"
        />
        <button
          onClick={() => send()}
          disabled={loading || !input.trim()}
          className="btn-primary flex items-center gap-2 px-4"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
