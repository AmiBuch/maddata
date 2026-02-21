from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import conditions, itinerary, chat, outbreaks
from app.config import settings

app = FastAPI(
    title="Breathe API",
    description="Health-aware travel intelligence platform",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_url, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(conditions.router, prefix="/api/conditions", tags=["conditions"])
app.include_router(itinerary.router, prefix="/api/itinerary", tags=["itinerary"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(outbreaks.router, prefix="/api/outbreaks", tags=["outbreaks"])


@app.get("/")
async def root():
    return {"status": "ok", "service": "Breathe API"}


@app.get("/health")
async def health():
    return {"status": "healthy"}
