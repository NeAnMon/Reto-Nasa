import logging
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.app.api.v1.router import router as api_v1_router
from backend.app.core.config import insecure_config_warnings, settings
from backend.app.database.seed import seed_database
from backend.app.database.session import Base, SessionLocal, engine
import backend.app.models.models  # noqa: F401

FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"

# Python 3.12 de la imagen no conoce .webp y lo serviría como application/octet-stream:
# se registra antes de montar los estáticos (banners de entorno de la consola).
mimetypes.add_type("image/webp", ".webp")


logger = logging.getLogger("semsa")


def init_db_and_seed() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_database(db)
    finally:
        db.close()


def log_insecure_config_warnings() -> None:
    for warning in insecure_config_warnings(settings):
        logger.warning("CONFIGURACIÓN INSEGURA: %s", warning)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log_insecure_config_warnings()
    init_db_and_seed()
    yield


app = FastAPI(
    title=f"{settings.APP_NAME} API",
    description=(
        "Plataforma interactiva, gamificada y adaptativa para el monitoreo integral "
        "de la salud de astronautas — NASA Space Apps Challenge."
    ),
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_v1_router)


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "slogan": settings.APP_SLOGAN,
        "version": settings.APP_VERSION,
    }


if FRONTEND_DIR.exists():
    src_dir = FRONTEND_DIR / "src"
    if src_dir.exists():
        app.mount("/src", StaticFiles(directory=str(src_dir)), name="frontend-src")


@app.get("/")
def serve_index():
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    return {"message": "SEMSA API running. Visit /docs for OpenAPI documentation."}

