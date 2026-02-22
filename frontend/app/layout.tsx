import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/components/Navbar";

export const metadata: Metadata = {
  title: "Breathe — Health-Aware Travel",
  description: "Know before you go. Real-time health risk intelligence for every trip.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 font-sans">
        <Navbar />
        <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
