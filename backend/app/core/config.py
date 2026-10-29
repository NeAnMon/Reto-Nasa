import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent


class Settings:
    APP_NAME: str = os.getenv("APP_NAME", "AstroVital")
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
        "DATABASE_URL", f"sqlite:///{BASE_DIR / 'astrovital.db'}"
    )

    ENABLE_DEMO_SIMULATOR: bool = (
        os.getenv("ENABLE_DEMO_SIMULATOR", "true").lower() == "true"
    )
    SEED_DEMO_DATA: bool = os.getenv("SEED_DEMO_DATA", "true").lower() == "true"

    DEMO_ADMIN_EMAIL: str = os.getenv("DEMO_ADMIN_EMAIL", "admin@astrovital.demo")
    DEMO_ADMIN_PASSWORD: str = os.getenv("DEMO_ADMIN_PASSWORD", "AstroAdmin!2026")
    DEMO_LEADER_EMAIL: str = os.getenv("DEMO_LEADER_EMAIL", "leader@astrovital.demo")
    DEMO_LEADER_PASSWORD: str = os.getenv("DEMO_LEADER_PASSWORD", "AstroLeader!2026")
    DEMO_ASTRONAUT1_EMAIL: str = os.getenv(
        "DEMO_ASTRONAUT1_EMAIL", "elena.rostova@astrovital.demo"
    )
    DEMO_ASTRONAUT1_PASSWORD: str = os.getenv(
        "DEMO_ASTRONAUT1_PASSWORD", "AstroCrew!2026"
    )
    DEMO_ASTRONAUT2_EMAIL: str = os.getenv(
        "DEMO_ASTRONAUT2_EMAIL", "marcus.vance@astrovital.demo"
    )
    DEMO_ASTRONAUT2_PASSWORD: str = os.getenv(
        "DEMO_ASTRONAUT2_PASSWORD", "AstroCrew!2026"
    )
    DEMO_ASTRONAUT3_EMAIL: str = os.getenv(
        "DEMO_ASTRONAUT3_EMAIL", "kenji.takahashi@astrovital.demo"
    )
    DEMO_ASTRONAUT3_PASSWORD: str = os.getenv(
        "DEMO_ASTRONAUT3_PASSWORD", "AstroCrew!2026"
    )

    AI_PROVIDER_ENABLED: bool = (
        os.getenv("AI_PROVIDER_ENABLED", "false").lower() == "true"
    )


settings = Settings()

