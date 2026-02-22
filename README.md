# Breathe 🌬️

> **Is it safe for you to be there — and if so, when, where, and how?**

Health-aware travel intelligence platform. Real-time AQI, live outbreak tracking, and AI-powered itinerary planning — personalized to your health conditions.

Built for MadData Datathon 2026.

---

## Screens

| Screen | Route | Description |
|--------|-------|-------------|
| **Right Now** | `/now` | Live AQI, weather & risk at your current GPS location |
| **Upload Itinerary** | `/itinerary` | Day-by-day health risk forecast for your planned trip |
| **Plan with AI** | `/plan` | Chatbot (Claude) to build a health-safe itinerary from scratch |
| **Home Chatbot** | `/` | Destination + date + diet → forecast, outbreaks, Gemini-highlighted activities |

---

## Tech Stack

- **Frontend** — Next.js 15, Tailwind CSS, Leaflet (interactive heatmaps)
- **Backend** — FastAPI (Python), Anthropic Claude API
- **Data Sources** — Open-Meteo (AQI + weather, free), AirNow EPA, NewsAPI, Anthropic, Google Gemini

---

## Quick Start

### 1. Clone & configure

```bash
git clone <your-repo-url>
cd maddata
```

### 2. Backend

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate
# Mac/Linux
source .venv/bin/activate

pip install -r requirements.txt

# Copy and fill in your API keys
cp .env.example .env
```

Start the API server:

```bash
uvicorn app.main:app --reload --port 8000
```

API docs available at: http://localhost:8000/docs

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

App runs at: http://localhost:3000

---

## API Keys

Copy `backend/.env.example` → `backend/.env` and fill in:

| Key | Where to get it | Required? |
|-----|----------------|-----------|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | For AI chatbot |
| `NEWS_API_KEY` | [newsapi.org](https://newsapi.org) | For outbreak feed |
| `AIRNOW_API_KEY` | [airnowapi.org](https://www.airnowapi.org) | Better AQI data (Open-Meteo used as fallback) |
| `OPENWEATHER_API_KEY` | [openweathermap.org](https://openweathermap.org/api) | Optional weather upgrade |
| `GEMINI_API_KEY` | [ai.google.dev](https://ai.google.dev) | For chatbot activity recommendations (uses forecast + outbreaks to highlight suitable activities) |

**No keys? No problem** — Open-Meteo (AQI + weather) requires no key, and mock data is used for outbreaks and chatbot in demo mode.

---

## Project Structure

```
maddata/
├── frontend/                 # Next.js app
│   ├── app/
│   │   ├── now/page.tsx      # Screen 1: Right Now
│   │   ├── itinerary/page.tsx # Screen 2: Upload Itinerary
│   │   └── plan/page.tsx     # Screen 3: Plan with AI
│   └── components/
│       ├── HeatMap.tsx       # Leaflet heatmap with risk overlay
│       ├── OutbreakFeed.tsx  # Live news feed
│       └── ...
└── backend/                  # FastAPI
    └── app/
        ├── routers/          # conditions, itinerary, chat, outbreaks, forecast, chatbot
        ├── services/         # aqi, weather, risk_scorer, outbreak_tracker, forecaster
        └── data/             # activities.json — extend with your own restaurants & activities
```

---

## The Data Story

Every user who reports a symptom flare during a trip tags it with location + time + condition.
That feeds back into the prediction model.

Over time: Breathe knows that asthmatic users in Chicago's River North neighborhood in July, when ozone > 100, report flare-ups 68% of the time — **a dataset no one has built before.**
