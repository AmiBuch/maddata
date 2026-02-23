import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Semantic tokens
        primary:   "#6a8ce8",
        secondary: "#57dbff",
        accent:    "#b197ff",
        success:   "#90ff9e",
        highlight: "#f5f9ff",

        // Brand scale (primary shades)
        brand: {
          50:  "#f5f9ff",
          100: "#dce6fa",
          200: "#b197ff",
          300: "#6a8ce8",
          400: "#6a8ce8",
          500: "#6a8ce8",
          600: "#5a7ad0",
          700: "#4a68b8",
          800: "#3a56a0",
          900: "#2a4488",
        },

        // Named accents
        "accent-aqua":       "#57dbff",
        "accent-mint":       "#7ee8c6",
        "accent-green":      "#90ff9e",
        "accent-periwinkle": "#b197ff",

        // Typography
        heading: "#222222",
        body:    "#444444",
        muted:   "#777777",

        // Risk
        risk: {
          low:      "#22c55e",
          moderate: "#eab308",
          high:     "#f97316",
          vhigh:    "#ef4444",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
