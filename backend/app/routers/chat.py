"""
Chatbot router — powered by Gemini (Google).
Helps users plan health-safe itineraries via conversational AI.
"""
from fastapi import APIRouter
from google import genai
from google.genai import types

from app.models.schemas import ChatRequest, ChatResponse
from app.config import settings

router = APIRouter()

SYSTEM_PROMPT = """You are PurePath, a health-aware travel assistant.
You help people with chronic health conditions (asthma, epilepsy, diabetes, heart disease, allergies, dietary restrictions, etc.)
plan safe, enjoyable trips.

You have access to real-time data about:
- Air quality index (AQI) and pollutant levels
- Weather conditions (temperature, humidity, UV index)
- Active disease outbreaks and health alerts by neighborhood
- Pollen counts and allergen levels

When a user asks about travel plans:
1. Ask about their health conditions if not provided
2. Suggest the safest times and locations for their planned activities
3. Flag high-risk periods or areas based on the data
4. Recommend alternatives when conditions are poor
5. Provide practical tips tailored to their specific conditions

Be empathetic, specific, and actionable. Format responses with clear structure when listing information.
Always remind users to consult their healthcare provider for medical advice."""


@router.post("/", response_model=ChatResponse)
async def chat(req: ChatRequest):
    api_key = settings.gemini_api_key
    if not api_key:
        return ChatResponse(
            reply=_mock_response(req),
            suggested_activities=None,
        )

    system = SYSTEM_PROMPT
    if req.health_profile:
        conds = ", ".join(req.health_profile.conditions) or "none specified"
        diet = ", ".join(req.health_profile.dietary_restrictions) or "none"
        system += f"\n\nUser health profile: conditions={conds}, dietary restrictions={diet}"
    if req.destination:
        system += f"\nUser is planning a trip to: {req.destination}"

    client = genai.Client(api_key=api_key)

    # Build conversation contents (user/model alternating)
    contents = []
    for m in req.messages:
        role = "model" if m.role in ("assistant", "model") else "user"
        contents.append(types.Content(role=role, parts=[types.Part.from_text(m.content)]))

    if not contents:
        return ChatResponse(reply=_mock_response(req), suggested_activities=None)

    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=contents,
        config=types.GenerateContentConfig(
            system_instruction=system,
            max_output_tokens=1024,
        ),
    )

    reply = response.text or ""
    return ChatResponse(reply=reply, suggested_activities=None)


def _mock_response(req: ChatRequest) -> str:
    last = req.messages[-1].content if req.messages else ""
    return (
        f"Thanks for your message! (Demo mode — add GEMINI_API_KEY to enable full AI responses)\n\n"
        f"You asked: \"{last[:100]}\"\n\n"
        "Here's what PurePath would normally do:\n"
        "- Check real-time AQI and weather for your destination\n"
        "- Scan for active health alerts in the area\n"
        "- Build a personalized day-by-day health itinerary\n"
        "- Flag high-risk times and suggest safer alternatives\n\n"
        "Add your API keys in backend/.env to unlock full functionality!"
    )