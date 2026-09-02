import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.app.config import settings
from backend.app.db.session import init_db
from backend.app.api.routes import router as api_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("screening_system")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Database...")
    await init_db()
    logger.info("Database initialized successfully.")
    
    # Check FAISS indexes for supported roles
    from backend.app.rag.indexer import build_faiss_index_for_role
    for role in settings.ROLES:
        try:
            build_faiss_index_for_role(role, force_rebuild=False)
        except Exception as e:
            logger.warning(f"Could not build index for {role} at startup: {e}")

    yield
    logger.info("Shutting down application...")


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Aptus — Role-based, RAG-driven AI Candidate Screening System with LangGraph orchestration and Gemini evaluation.",
    version="1.0.0",
    lifespan=lifespan
)

# CORS configuration for Vite React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Suitable for local development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes under /api
app.include_router(api_router, prefix=settings.API_V1_STR)


@app.get("/")
async def root():
    return {
        "message": "Aptus — AI Candidate Screening System API is active",
        "docs": "/docs",
        "health": "/api/health"
    }



if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="0.0.0.0", port=8000, reload=True)
