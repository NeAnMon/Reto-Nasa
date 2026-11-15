import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent


def _default_sqlite_path() -> Path:
    """BD SQLite por defecto: semsa.db. Si solo existe la de versiones previas (astrovital.db, antes del
    renombrado AstroVital -> SEMSA, issue #14), se sigue usando para no perder los datos ya registrados."""
    current = BASE_DIR / "semsa.db"
    legacy = BASE_DIR / "astrovital.db"
    return legacy if legacy.exists() and not current.exists() else current


class Settings:
    APP_NAME: str = os.getenv("APP_NAME", "SEMSA")
    APP_SLOGAN: str = "Your health. Your mission. Your future."
    APP_ENV: str = os.getenv("APP_ENV", "development")
    APP_VERSION: str = os.getenv("APP_VERSION", "1.0.0")
    SECRET_KEY: str = os.getenv(
        "SECRET_KEY", "replace-this-demo-secret-key-in-production-9f8e7d6c5b4a3210"
    )
    SESSION_EXPIRE_HOURS: int = int(os.getenv("SESSION_EXPIRE_HOURS", "12"))
    MAX_LOGIN_ATTEMPTS: int = int(os.getenv("MAX_LOGIN_ATTEMPTS", "5"))
    LOCKOUT_MINUTES: int = int(os.getenv("LOCKOUT_MINUTES", "15"))

    DATABASE_URL: str = os.getenv(
        "DATABASE_URL", f"sqlite:///{_default_sqlite_path()}"
    )

    ENABLE_DEMO_SIMULATOR: bool = (
        os.getenv("ENABLE_DEMO_SIMULATOR", "true").lower() == "true"
    )
    SEED_DEMO_DATA: bool = os.getenv("SEED_DEMO_DATA", "true").lower() == "true"

    DEMO_ADMIN_EMAIL: str = os.getenv("DEMO_ADMIN_EMAIL", "admin@semsa.demo")
    DEMO_ADMIN_PASSWORD: str = os.getenv("DEMO_ADMIN_PASSWORD", "AstroAdmin!2026")
    DEMO_LEADER_EMAIL: str = os.getenv("DEMO_LEADER_EMAIL", "leader@semsa.demo")
    DEMO_LEADER_PASSWORD: str = os.getenv("DEMO_LEADER_PASSWORD", "AstroLeader!2026")
    DEMO_ASTRONAUT1_EMAIL: str = os.getenv(
        "DEMO_ASTRONAUT1_EMAIL", "elena.rostova@semsa.demo"
    )
    DEMO_ASTRONAUT1_PASSWORD: str = os.getenv(
        "DEMO_ASTRONAUT1_PASSWORD", "AstroCrew!2026"
    )
    DEMO_ASTRONAUT2_EMAIL: str = os.getenv(
        "DEMO_ASTRONAUT2_EMAIL", "marcus.vance@semsa.demo"
    )
    DEMO_ASTRONAUT2_PASSWORD: str = os.getenv(
        "DEMO_ASTRONAUT2_PASSWORD", "AstroCrew!2026"
    )
    DEMO_ASTRONAUT3_EMAIL: str = os.getenv(
        "DEMO_ASTRONAUT3_EMAIL", "kenji.takahashi@semsa.demo"
    )
    DEMO_ASTRONAUT3_PASSWORD: str = os.getenv(
        "DEMO_ASTRONAUT3_PASSWORD", "AstroCrew!2026"
    )

    # SOLO DEMO LOCAL: devuelve el token de recuperación de contraseña en la respuesta HTTP.
    # Permite tomar cualquier cuenta sin autenticar: nunca activarlo en un despliegue accesible.
    DEMO_EXPOSE_RECOVERY_TOKEN: bool = (
        os.getenv("DEMO_EXPOSE_RECOVERY_TOKEN", "false").lower() == "true"
    )

    AI_PROVIDER_ENABLED: bool = (
        os.getenv("AI_PROVIDER_ENABLED", "false").lower() == "true"
    )


DEFAULT_DEMO_SECRET_KEY = "replace-this-demo-secret-key-in-production-9f8e7d6c5b4a3210"


def insecure_config_warnings(cfg: "Settings") -> list:
    """Avisos de configuración insegura que se registran al arrancar (no impiden el arranque demo local)."""
    warnings = []
    key = cfg.SECRET_KEY or ""
    if key == DEFAULT_DEMO_SECRET_KEY or "replace-this" in key or len(key) < 32:
        warnings.append(
            "SECRET_KEY usa el valor de demostración o es demasiado corta: genere una clave aleatoria "
            "(p. ej. `python -c \"import secrets; print(secrets.token_urlsafe(48))\"`) antes de exponer el servicio."
        )
    if cfg.DEMO_EXPOSE_RECOVERY_TOKEN:
        warnings.append(
            "DEMO_EXPOSE_RECOVERY_TOKEN=true: /auth/password-recovery/request devuelve el token de recuperación "
            "y cualquiera puede tomar cualquier cuenta. Úselo solo en una demo local aislada."
        )
    if cfg.SEED_DEMO_DATA:
        warnings.append(
            "SEED_DEMO_DATA=true: existen cuentas demo con contraseñas públicas. "
            "Desactívelo y cambie las contraseñas DEMO_* antes de producción."
        )
    return warnings


settings = Settings()

