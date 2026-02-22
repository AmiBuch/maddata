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
        accent: {
          aqua:  "#57dbff",
          mint:  "#7ee8c6",
          green: "#90ff9e",
          periwinkle: "#b197ff",
        },
        risk: {
          low:      "#90ff9e",
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
