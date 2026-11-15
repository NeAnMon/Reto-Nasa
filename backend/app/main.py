import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.app.api.v1.isolation_router import purge_expired_orphan_attachments
from backend.app.api.v1.router import router as api_v1_router
from backend.app.core.config import insecure_config_warnings, settings
from backend.app.database.seed import seed_database
from backend.app.database.session import Base, SessionLocal, engine
import backend.app.models.models  # noqa: F401

FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"


logger = logging.getLogger("astrovital")


def ensure_upload_dir() -> Path:
    """Crea el directorio de adjuntos al arrancar (permisos 0700: solo el usuario del proceso)."""
    path = Path(settings.UPLOAD_DIR)
    path.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(path, 0o700)
    except OSError:
        pass
    return path


def init_db_and_seed() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_database(db)
        try:
            purged = purge_expired_orphan_attachments(db)
            if purged:
                logger.info("Adjuntos huérfanos caducados purgados al arrancar: %d", purged)
        except Exception:  # noqa: BLE001 - la purga nunca debe impedir el arranque
            logger.exception("No se pudo purgar adjuntos huérfanos al arrancar")
            db.rollback()
    finally:
        db.close()


def log_insecure_config_warnings() -> None:
    for warning in insecure_config_warnings(settings):
        logger.warning("CONFIGURACIÓN INSEGURA: %s", warning)


@asynccontextmanager
async def lifespan(app: FastAPI):
    log_insecure_config_warnings()
    ensure_upload_dir()
    init_db_and_seed()
    yield


# Rutas de subida cuyo cuerpo se limita ANTES de que FastAPI parsee el multipart (que lo vuelca a disco)
UPLOAD_PATHS = {"/api/v1/attachments"}
MULTIPART_OVERHEAD_BYTES = 64 * 1024


class UploadSizeLimitMiddleware:
    """
    Middleware ASGI puro: en POST /api/v1/attachments exige Content-Length (411 si falta) y rechaza con 413
    si supera MAX_ATTACHMENT_BYTES + margen multipart, sin leer el cuerpo. Además corta el flujo si el
    cliente envía más bytes de los declarados.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope.get("method") != "POST"
            or scope.get("path", "").rstrip("/") not in UPLOAD_PATHS
        ):
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        limit = settings.MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD_BYTES
        raw_len = headers.get("content-length")
        if raw_len is None:
            response = JSONResponse(
                status_code=411,
                content={"detail": "Falta la cabecera Content-Length: no se aceptan subidas sin tamaño declarado."},
            )
            await response(scope, receive, send)
            return
        try:
            declared = int(raw_len)
        except ValueError:
            declared = -1
        if declared < 0:
            response = JSONResponse(status_code=400, content={"detail": "Cabecera Content-Length no válida."})
            await response(scope, receive, send)
            return
        if declared > limit:
            response = JSONResponse(
                status_code=413, content={"detail": "El adjunto supera el tamaño máximo de 5 MB."}
            )
            await response(scope, receive, send)
            return

        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > declared:
                    raise RuntimeError("Cuerpo de la petición mayor que el Content-Length declarado.")
            return message

        await self.app(scope, limited_receive, send)


app = FastAPI(
    title=f"{settings.APP_NAME} API",
    description=(
        "Plataforma interactiva, gamificada y adaptativa para el monitoreo integral "
        "de la salud de astronautas — NASA Space Apps Challenge."
    ),
    version=settings.APP_VERSION,
    lifespan=lifespan,
)

# Se registra antes que CORS para que CORS sea la capa externa y también decore los 411/413
app.add_middleware(UploadSizeLimitMiddleware)
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
    return {"message": "AstroVital API running. Visit /docs for OpenAPI documentation."}

