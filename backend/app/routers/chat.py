"""
Chatbot router — powered by Claude (Anthropic).
Helps users plan health-safe itineraries via conversational AI.
"""
from fastapi import APIRouter
from app.models.schemas import ChatRequest, ChatResponse
from app.config import settings
import anthropic

router = APIRouter()

SYSTEM_PROMPT = """You are Breathe, a health-aware travel assistant.
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
    if not settings.anthropic_api_key:
        return ChatResponse(
            reply=_mock_response(req),
            suggested_activities=None,
        )

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    system = SYSTEM_PROMPT
    if req.health_profile:
        conds = ", ".join(req.health_profile.conditions) or "none specified"
        diet = ", ".join(req.health_profile.dietary_restrictions) or "none"
        system += f"\n\nUser health profile: conditions={conds}, dietary restrictions={diet}"
    if req.destination:
        system += f"\nUser is planning a trip to: {req.destination}"

    messages = [{"role": m.role, "content": m.content} for m in req.messages]

    response = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=1024,
        system=system,
        messages=messages,
    )

    reply = response.content[0].text
    return ChatResponse(reply=reply, suggested_activities=None)


def _mock_response(req: ChatRequest) -> str:
    last = req.messages[-1].content if req.messages else ""
    return (
        f"Thanks for your message! (Demo mode — add ANTHROPIC_API_KEY to enable full AI responses)\n\n"
        f"You asked: \"{last[:100]}\"\n\n"
        "Here's what Breathe would normally do:\n"
        "- Check real-time AQI and weather for your destination\n"
        "- Scan for active health alerts in the area\n"
        "- Build a personalized day-by-day health itinerary\n"
        "- Flag high-risk times and suggest safer alternatives\n\n"
        "Add your API keys in backend/.env to unlock full functionality!"
    )
