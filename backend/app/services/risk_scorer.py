"""
Composite risk scorer.
Combines AQI, weather, outbreak reports, and user health profile
into a single 0-100 risk score with human-readable factors.
"""
from app.models.schemas import AQIData, WeatherData, RiskScore

CONDITION_WEIGHTS = {
    "asthma":       {"aqi": 2.0, "humidity": 1.2, "heat": 1.1},
    "epilepsy":     {"aqi": 0.5, "humidity": 0.5, "heat": 1.5},
    "heart disease":{"aqi": 1.5, "humidity": 1.0, "heat": 1.8},
    "diabetes":     {"aqi": 1.0, "humidity": 1.0, "heat": 1.6},
    "copd":         {"aqi": 2.5, "humidity": 1.3, "heat": 1.2},
    "allergies":    {"aqi": 1.5, "humidity": 1.4, "heat": 0.8},
    "default":      {"aqi": 1.0, "humidity": 1.0, "heat": 1.0},
}

SCORE_LABELS = [
    (25,  "Low",       "#22c55e"),
    (50,  "Moderate",  "#eab308"),
    (75,  "High",      "#f97316"),
    (100, "Very High", "#ef4444"),
]


def _label(score: int) -> tuple[str, str]:
    for threshold, label, color in SCORE_LABELS:
        if score <= threshold:
            return label, color
    return "Very High", "#ef4444"


def compute_risk(
    aqi: AQIData,
    weather: WeatherData,
    conditions: list[str],
    outbreak_score: float = 0.0,   # 0-1 from outbreak tracker
) -> RiskScore:
    factors: list[str] = []
    recommendations: list[str] = []

    # Get weights for worst applicable condition
    weights = CONDITION_WEIGHTS["default"]
    for cond in conditions:
        w = CONDITION_WEIGHTS.get(cond.lower())
        if w:
            weights = {k: max(weights[k], w[k]) for k in weights}

    # ── AQI component (0-40 points) ──────────────────────────────────────────
    aqi_score = 0
    if aqi.aqi > 100:
        aqi_score = min(40, (aqi.aqi - 100) / 4)
        factors.append(f"AQI {aqi.aqi} ({aqi.category})")
        if "asthma" in conditions or "copd" in conditions:
            recommendations.append("Carry rescue inhaler. Limit outdoor exposure.")
    elif aqi.aqi > 50:
        aqi_score = (aqi.aqi - 50) / 2.5
    aqi_score *= weights["aqi"]

    # ── Heat / humidity component (0-30 points) ───────────────────────────────
    heat_score = 0
    if weather.temp_f > 90:
        heat_score = min(20, (weather.temp_f - 90) * 2)
        factors.append(f"High heat ({weather.temp_f}°F)")
        recommendations.append("Stay hydrated. Seek air conditioning between 11am–4pm.")
    if weather.humidity > 70:
        heat_score += min(10, (weather.humidity - 70) / 3)
        factors.append(f"High humidity ({weather.humidity}%)")
    heat_score *= weights["heat"]

    # ── Outbreak component (0-30 points) ─────────────────────────────────────
    outbreak_component = outbreak_score * 30
    if outbreak_score > 0.5:
        factors.append("Active outbreak reports in the area")
        recommendations.append("Wash hands frequently. Avoid crowded indoor spaces.")

    # ── Composite ─────────────────────────────────────────────────────────────
    total = min(100, int(aqi_score + heat_score + outbreak_component))
    label, _ = _label(total)

    if not factors:
        factors.append("No significant risk factors detected")
    if not recommendations:
        recommendations.append("Conditions look good — enjoy your day!")

    return RiskScore(
        overall=label,
        score=total,
        factors=factors,
        recommendations=recommendations,
    )
