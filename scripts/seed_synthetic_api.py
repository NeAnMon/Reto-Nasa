#!/usr/bin/env python3
"""SEMSA · Precarga de datos sintéticos (SIMULADO) a través de la API de FastAPI (issue #24).

Genera una tripulación ficticia, una misión simulada con dos fases/entornos y un histórico diario de
indicadores fisiológicos, ambientales y de bienestar, y lo envía a los endpoints existentes
(`/api/v1/...`). El backend es quien evalúa cada lectura (estado NORMAL/MONITOR/WARNING/CRITICAL) y
crea o actualiza las alertas con su motor calibrado: este script no calcula estados ni alertas.

Propiedades:
- Reproducible: misma `--seed` y misma `--end-date` => mismos valores.
- Idempotente: cada medición lleva una `dedup_key` determinista y, antes de enviar, se consulta lo
  que ya existe; una segunda ejecución no crea duplicados (solo completa lo que falte).
- Todo queda marcado como sintético: `is_simulated=true` (calidad `SYNTHETIC_DEMO`) y notas `[SIMULADO]`.
- Sin secretos en el código: las credenciales salen de variables de entorno (o, si el paquete
  `backend` es importable, de las cuentas demo ya definidas en `backend/app/core/config.py`).

Uso rápido (con la API levantada en local):

    python scripts/seed_synthetic_api.py --base-url http://127.0.0.1:8000

Ver `docs/SEED_SINTETICO.md` para todas las opciones.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import random
import sys
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlparse

import httpx

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

log = logging.getLogger("semsa.seed24")

API = "/api/v1"
NOTE_TAG = "[SIMULADO] Precarga sintética issue #24"
DEDUP_PREFIX = "seed24"
SOURCE_CODE = "DEMO_SIMULATION"
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "testserver"}

# Fases de la misión sintética, en orden cronológico: (fase, entorno, módulo). La última es la vigente.
PHASES: Tuple[Tuple[str, str, str], ...] = (
    ("TRANSIT", "LUNAR_ORBIT", "Módulo de tránsito cislunar (SIMULADO)"),
    ("SURFACE", "LUNAR_SURFACE", "Hábitat de superficie lunar (SIMULADO)"),
)


@dataclass(frozen=True)
class IndicatorSpec:
    mean: float
    sd: float
    decimals: int
    secondary_mean: Optional[float] = None
    secondary_sd: Optional[float] = None


# Valores ficticios de referencia (no son datos médicos reales). Media y ruido diario por indicador.
INDICATORS: Dict[str, IndicatorSpec] = {
    "HEART_RATE": IndicatorSpec(66.0, 3.0, 0),
    "BLOOD_PRESSURE": IndicatorSpec(115.0, 4.0, 0, 74.0, 3.0),
    "BODY_TEMP": IndicatorSpec(36.6, 0.12, 1),
    "SPO2": IndicatorSpec(98.0, 0.6, 0),
    "RESP_RATE": IndicatorSpec(14.0, 1.0, 0),
    "SLEEP_DURATION": IndicatorSpec(7.4, 0.4, 1),
    "PERCEIVED_FATIGUE": IndicatorSpec(3.0, 0.6, 0),
    "HYDRATION": IndicatorSpec(2500.0, 150.0, 0),
    "PHYSICAL_ACTIVITY": IndicatorSpec(70.0, 10.0, 0),
    "BLOOD_GLUCOSE": IndicatorSpec(90.0, 5.0, 0),
}
# Indicadores que solo se registran los últimos N días: sirven para comprobar `insufficient_data`.
SPARSE_INDICATORS: Dict[str, int] = {"BLOOD_GLUCOSE": 5}

# Escenarios (se asignan por turno a los astronautas sintéticos).
#   trends: pendiente por día; random_walk: desviación del paseo aleatorio (serie no estacionaria,
#   candidata a `model_not_reliable`); anomalies: (días antes del final, indicador, nivel objetivo).
SCENARIOS: Tuple[Dict[str, Any], ...] = (
    {
        "code": "ESTABLE",
        "label": "Series estables alrededor de la línea base",
        "trends": {},
        "random_walk": {},
        "anomalies": (),
    },
    {
        "code": "TENDENCIAS",
        "label": "Tendencias crecientes y decrecientes",
        "trends": {"HEART_RATE": 0.5, "SLEEP_DURATION": -0.03, "HYDRATION": -12.0, "PHYSICAL_ACTIVITY": 0.6},
        # Paseo aleatorio casi sin ruido: "repetir el último valor" suele ganar al nivel robusto
        "random_walk": {"BODY_TEMP": 0.1},
        "noise_scale": {"BODY_TEMP": 0.2},
        "anomalies": (),
    },
    {
        "code": "ANOMALIAS",
        "label": "Tendencia descendente y lecturas anómalas controladas",
        "trends": {"SPO2": -0.03, "HYDRATION": -8.0},
        "random_walk": {},
        # El nivel es el rango de la regla vigente al que apunta el valor; el estado real lo decide el backend.
        "anomalies": ((0, "HEART_RATE", "CRITICAL"), (1, "SPO2", "WARNING"), (2, "BODY_TEMP", "WARNING"),
                      (3, "PERCEIVED_FATIGUE", "MONITOR"), (4, "HYDRATION", "MONITOR"),
                      ("mid", "HEART_RATE", "WARNING")),
    },
)

ENV_PARAMETERS: Tuple[Tuple[str, str, str, float, float, int], ...] = (
    # (código, nombre, unidad, media, ruido, decimales)
    ("CABIN_TEMP", "Temperatura Ambiental de Cabina", "°C", 21.5, 0.6, 1),
    ("HUMIDITY", "Humedad Relativa", "%", 45.0, 3.0, 0),
    ("CABIN_PRESSURE", "Presión Total de Hábitat", "kPa", 101.3, 0.4, 1),
    # Media dentro del rango normal del motor ambiental (≤ 2,5 mmHg) con margen: el ruido no genera alertas
    ("CO2_LEVEL", "Concentración de CO₂", "mmHg", 2.0, 0.1, 1),
    ("PPO2", "Presión Parcial de Oxígeno (ppO₂)", "kPa", 21.0, 0.3, 1),
    ("RADIATION_DOSE", "Tasa de Radiación Ambiental", "mSv/día", 0.40, 0.05, 2),
    ("AIR_QUALITY", "Índice de Calidad del Aire (VOCs)", "ICA", 94.0, 2.0, 0),
)
# La exposición en órbita lunar es algo mayor (sin la protección del hábitat): ficticio.
ENV_PHASE_SHIFT = {"LUNAR_ORBIT": {"RADIATION_DOSE": 0.15, "CO2_LEVEL": 0.2}}
# Anomalía ambiental INTENCIONAL (ficticia): en la fase de tránsito el depurador de CO₂ del módulo cislunar
# rinde menos y el CO₂ queda en 3,1 mmHg, fuera del rango normal (≤ 2,5) pero dentro del de observación
# (≤ 4,0): el motor ENVIRONMENT abre una alerta MONITOR (prioridad LOW) para cada astronauta de la misión.
# Es la única alerta ambiental esperada; el resto de parámetros se generan dentro de su rango normal.
ENV_ANOMALIES: Dict[Tuple[str, str], float] = {("LUNAR_ORBIT", "CO2_LEVEL"): 3.1}


# --------------------------------------------------------------------------------------------------
# Configuración
# --------------------------------------------------------------------------------------------------
@dataclass
class Config:
    base_url: str = "http://127.0.0.1:8000"
    admin_email: Optional[str] = None
    admin_password: Optional[str] = None
    leader_email: Optional[str] = None
    astronaut_password: Optional[str] = None
    astronauts: int = 3
    days: int = 45
    seed: int = 24
    end_date: Optional[date] = None
    mission_code: str = "SYNTH-SEED-24"
    crew_prefix: str = "SYN24"
    indicators: Optional[List[str]] = None
    modules: Tuple[str, ...] = ("health", "environment", "wellness", "gamification")
    baselines_db: bool = False
    reset: bool = False
    confirm_reset: bool = False
    allow_remote: bool = False
    verify: bool = True
    # True si la contraseña de los astronautas sintéticos se dio explícitamente (SEMSA_SYNTH_PASSWORD o en la
    # Config) y no sale de la cuenta demo por defecto. Obligatorio con --allow-remote.
    synth_password_explicit: bool = False


ALL_MODULES = ("health", "environment", "wellness", "gamification")


def _settings_fallback(attr: str) -> Optional[str]:
    """Cuentas demo ya definidas en el backend (si el paquete es importable). No hay secretos aquí."""
    try:
        from backend.app.core.config import settings  # noqa: WPS433
    except Exception:  # el script también funciona fuera del repositorio
        return None
    return getattr(settings, attr, None)


def _env_or_settings(*names: str, settings_attr: Optional[str] = None) -> Optional[str]:
    for n in names:
        v = os.getenv(n)
        if v:
            return v
    return _settings_fallback(settings_attr) if settings_attr else None


def resolve_credentials(cfg: Config) -> Config:
    cfg.admin_email = cfg.admin_email or _env_or_settings(
        "SEMSA_ADMIN_EMAIL", "DEMO_ADMIN_EMAIL", settings_attr="DEMO_ADMIN_EMAIL")
    cfg.admin_password = cfg.admin_password or _env_or_settings(
        "SEMSA_ADMIN_PASSWORD", "DEMO_ADMIN_PASSWORD", settings_attr="DEMO_ADMIN_PASSWORD")
    cfg.leader_email = cfg.leader_email or _env_or_settings(
        "SEMSA_LEADER_EMAIL", "DEMO_LEADER_EMAIL", settings_attr="DEMO_LEADER_EMAIL")
    cfg.synth_password_explicit = cfg.synth_password_explicit or bool(
        cfg.astronaut_password or os.getenv("SEMSA_SYNTH_PASSWORD"))
    cfg.astronaut_password = cfg.astronaut_password or _env_or_settings(
        "SEMSA_SYNTH_PASSWORD", "DEMO_ASTRONAUT1_PASSWORD", settings_attr="DEMO_ASTRONAUT1_PASSWORD")
    missing = [n for n, v in (("SEMSA_ADMIN_EMAIL", cfg.admin_email), ("SEMSA_ADMIN_PASSWORD", cfg.admin_password),
                              ("SEMSA_SYNTH_PASSWORD", cfg.astronaut_password)) if not v]
    if missing:
        raise SystemExit(f"Faltan credenciales: defina {', '.join(missing)} (ver docs/SEED_SINTETICO.md).")
    if len(cfg.astronaut_password) < 8:
        raise SystemExit("SEMSA_SYNTH_PASSWORD debe tener al menos 8 caracteres.")
    return cfg


# --------------------------------------------------------------------------------------------------
# Generación de series (funciones puras, reutilizables)
# --------------------------------------------------------------------------------------------------
def _rng(*parts: object) -> random.Random:
    # La semilla str es determinista entre ejecuciones (no depende de PYTHONHASHSEED).
    return random.Random(":".join(str(p) for p in parts))


def window_dates(end: date, days: int) -> List[date]:
    """Días UTC del histórico, del más antiguo al más reciente (incluye `end`)."""
    return [end - timedelta(days=k) for k in range(days - 1, -1, -1)]


def phase_for_day(index: int, days: int) -> Tuple[str, str, str]:
    """El primer tercio del histórico es la fase de tránsito; el resto, la de superficie (vigente)."""
    first_len = max(1, days // 3) if days >= 3 else 0
    return PHASES[0] if index < first_len else PHASES[-1]


def personal_baseline(seed: int, crew_code: str, code: str) -> Tuple[float, Optional[float]]:
    spec = INDICATORS[code]
    r = _rng(seed, crew_code, "baseline", code)
    mean = round(spec.mean + r.gauss(0.0, spec.sd * 0.8), spec.decimals)
    sec = None
    if spec.secondary_mean is not None:
        sec = round(spec.secondary_mean + r.gauss(0.0, (spec.secondary_sd or 1.0) * 0.8), spec.decimals)
    return mean, sec


def generate_series(
    seed: int,
    crew_code: str,
    code: str,
    n_days: int,
    trend_per_day: float = 0.0,
    random_walk_sd: float = 0.0,
    valid_range: Tuple[float, float] = (float("-inf"), float("inf")),
    noise_scale: float = 1.0,
) -> List[Tuple[float, Optional[float]]]:
    """Serie diaria (valor, secundario) alrededor de la línea base personal: ruido + tendencia + paseo."""
    spec = INDICATORS[code]
    base, sec_base = personal_baseline(seed, crew_code, code)
    r = _rng(seed, crew_code, "series", code)
    lo, hi = valid_range
    walk = 0.0
    out: List[Tuple[float, Optional[float]]] = []
    for t in range(n_days):
        if random_walk_sd:
            walk += r.gauss(0.0, random_walk_sd)
        value = base + trend_per_day * t + walk + r.gauss(0.0, spec.sd * noise_scale)
        value = round(min(max(value, lo), hi), spec.decimals)
        sec = None
        if sec_base is not None:
            sec = round(sec_base + r.gauss(0.0, spec.secondary_sd or 1.0), spec.decimals)
            sec = min(sec, value - 10)  # diastólica siempre por debajo de la sistólica
        out.append((float(value), None if sec is None else float(sec)))
    return out


def anomaly_value(rule: Dict[str, Any], level: str, valid: Tuple[float, float], decimals: int) -> Optional[float]:
    """Valor dentro del rango de la regla vigente (leída de /health/indicators) para el nivel pedido.

    No replica el motor: solo apunta al tramo; el estado final (y la alerta) los decide el backend.
    """
    keys = ("normal_min", "normal_max", "monitor_min", "monitor_max", "warning_min", "warning_max")
    if not rule or any(rule.get(k) is None for k in keys):
        return None
    lo, hi = valid
    span = max(rule["normal_max"] - rule["normal_min"], 1e-6)
    if level == "CRITICAL":
        high = rule["warning_max"] + span * 0.15
        value = high if high <= hi else rule["warning_min"] - span * 0.15
    elif level == "WARNING":
        if rule["warning_max"] > rule["monitor_max"] and rule["warning_max"] < hi:
            value = (rule["monitor_max"] + rule["warning_max"]) / 2
        else:
            value = (rule["warning_min"] + rule["monitor_min"]) / 2
    elif level == "MONITOR":  # zona de observación entre el rango habitual y el de vigilancia
        if rule["monitor_max"] > rule["normal_max"]:
            value = (rule["normal_max"] + rule["monitor_max"]) / 2
        elif rule["monitor_min"] < rule["normal_min"]:
            value = (rule["monitor_min"] + rule["normal_min"]) / 2
        else:
            return None
    else:
        return None
    value = round(min(max(value, lo), hi), decimals)
    return float(value)


# --------------------------------------------------------------------------------------------------
# Cliente HTTP
# --------------------------------------------------------------------------------------------------
@dataclass
class AuthSession:
    token: str
    csrf: str
    user: Dict[str, Any]

    @property
    def headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self.token}", "X-CSRF-Token": self.csrf}


class SeedError(RuntimeError):
    pass


@dataclass
class Stats:
    created: Counter = field(default_factory=Counter)
    skipped: Counter = field(default_factory=Counter)
    failed: Counter = field(default_factory=Counter)
    errors: List[str] = field(default_factory=list)
    states: Counter = field(default_factory=Counter)
    alerts_touched: int = 0
    env_states: Counter = field(default_factory=Counter)
    env_alerts: int = 0  # alertas ambientales creadas o actualizadas (una por astronauta de la misión)

    def fail(self, kind: str, message: str) -> None:
        self.failed[kind] += 1
        if len(self.errors) < 50:
            self.errors.append(f"{kind}: {message}")
        log.warning("%s: %s", kind, message)


class Api:
    def __init__(self, client: httpx.Client):
        self.client = client

    def call(self, method: str, path: str, auth: Optional[AuthSession] = None, **kwargs) -> httpx.Response:
        headers = dict(kwargs.pop("headers", {}) or {})
        if auth is not None:
            headers.update(auth.headers)
        return self.client.request(method, path, headers=headers, **kwargs)

    def json(self, method: str, path: str, auth: Optional[AuthSession] = None, ok=(200, 201), **kwargs) -> Any:
        resp = self.call(method, path, auth, **kwargs)
        if resp.status_code not in ok:
            raise SeedError(f"{method} {path} -> {resp.status_code}: {resp.text[:300]}")
        return resp.json()

    def login(self, email: str, password: str) -> AuthSession:
        data = self.json("POST", f"{API}/auth/login", json={"email": email, "password": password})
        return AuthSession(token=data["access_token"], csrf=data.get("csrf_token", ""), user=data["user"])


# --------------------------------------------------------------------------------------------------
# Precarga
# --------------------------------------------------------------------------------------------------
def _synthetic_crew(cfg: Config) -> List[Dict[str, Any]]:
    crew = []
    prefix = cfg.crew_prefix.strip().upper()
    for i in range(cfg.astronauts):
        scenario = SCENARIOS[i % len(SCENARIOS)]
        n = i + 1
        crew.append({
            "crew_code": f"{prefix}-{n:02d}",
            "email": f"{prefix.lower()}.astro{n}@semsa.demo",
            "full_name": f"Astronauta Sintético {n} ({scenario['code']}, SIMULADO)",
            "callsign": f"Synth-{n}",
            "specialty": f"Perfil ficticio de pruebas: {scenario['label']}",
            "scenario": scenario,
        })
    return crew


def _ensure_users(api: Api, admin: AuthSession, cfg: Config, crew: List[Dict[str, Any]],
                  stats: Stats) -> Optional[int]:
    """Crea (o reutiliza) la tripulación sintética. Devuelve el id del líder demo, si existe."""
    users = api.json("GET", f"{API}/users", admin)["users"]
    by_email = {u["email"].lower(): u for u in users}
    for member in crew:
        existing = by_email.get(member["email"])
        if existing:
            if existing["role_code"] != "ASTRONAUT":
                raise SeedError(f"{member['email']} existe con rol {existing['role_code']}, no ASTRONAUT.")
            member["id"] = existing["id"]
            stats.skipped["users"] += 1
            continue
        data = api.json("POST", f"{API}/users", admin, json={
            "crew_code": member["crew_code"], "email": member["email"], "full_name": member["full_name"],
            "password": cfg.astronaut_password, "role_code": "ASTRONAUT",
            "callsign": member["callsign"], "specialty": member["specialty"],
        })
        member["id"] = data["user"]["id"]
        stats.created["users"] += 1
    # El líder demo se asigna a la misión sintética para que su consola vea a la tripulación
    leader = by_email.get(cfg.leader_email.lower()) if cfg.leader_email else None
    return leader["id"] if leader and leader["role_code"] == "MISSION_LEADER" else None


def _ensure_mission(api: Api, admin: AuthSession, cfg: Config, stats: Stats) -> Dict[str, Any]:
    code = cfg.mission_code.strip().upper()
    missions = api.json("GET", f"{API}/missions", admin)["missions"]
    found = next((m for m in missions if m["code"] == code), None)
    if found:
        if not found.get("is_simulated"):
            raise SeedError(f"La misión {code} existe y NO está marcada como simulada: no se toca.")
        stats.skipped["missions"] += 1
        return found
    first_phase, first_env, module = PHASES[0]
    api.json("POST", f"{API}/missions", admin, json={
        "code": code,
        "name": f"Misión sintética de pruebas {code} (SIMULADO)",
        "description": "Misión ficticia generada por scripts/seed_synthetic_api.py para probar predicciones, "
                       "gráficas, comparación de fases y alertas. Datos SIMULADOS.",
        "vehicle_or_habitat": module,
        "planned_duration_days": max(cfg.days + 30, 60),
        "current_phase": first_phase,
        "environment_code": first_env,
        "is_simulated": True,
    })
    stats.created["missions"] += 1
    missions = api.json("GET", f"{API}/missions", admin)["missions"]
    return next(m for m in missions if m["code"] == code)


def _ensure_assignments(api: Api, admin: AuthSession, mission: Dict[str, Any], crew: List[Dict[str, Any]],
                        leader_id: Optional[int], stats: Stats) -> None:
    active = {(c["user_id"], c["assignment_role"]) for c in mission.get("crew", [])}
    wanted = [(m["id"], "ASTRONAUT") for m in crew]
    if leader_id:
        wanted.append((leader_id, "MISSION_LEADER"))
    for user_id, role in wanted:
        if (user_id, role) in active:
            stats.skipped["assignments"] += 1
            continue
        api.json("POST", f"{API}/missions/{mission['id']}/assignments", admin,
                 json={"user_id": user_id, "assignment_role": role})
        stats.created["assignments"] += 1


def _ensure_baselines_db(session_factory: Callable[[], Any], cfg: Config, crew: List[Dict[str, Any]],
                         codes: Iterable[str], stats: Stats) -> None:
    """Líneas base sintéticas. No hay endpoint de escritura: se usa el modelo SQLAlchemy (opcional)."""
    from backend.app.models.models import HealthBaseline
    from backend.app.rules.calibration import demo_std_dev

    db = session_factory()
    try:
        for member in crew:
            for code in codes:
                exists = db.query(HealthBaseline).filter(
                    HealthBaseline.astronaut_id == member["id"], HealthBaseline.indicator_code == code
                ).first()
                if exists:
                    stats.skipped["baselines"] += 1
                    continue
                mean, sec = personal_baseline(cfg.seed, member["crew_code"], code)
                db.add(HealthBaseline(
                    astronaut_id=member["id"], indicator_code=code, baseline_value=mean,
                    baseline_secondary_value=sec, std_dev=demo_std_dev(code),
                    established_phase="PRE_MISSION_BASELINE", is_simulated=True,
                ))
                stats.created["baselines"] += 1
        db.commit()
    finally:
        db.close()


def _measured_at(day: date, slot: int, now: datetime) -> datetime:
    ts = datetime.combine(day, time(6, 0), tzinfo=timezone.utc) + timedelta(minutes=2 * slot)
    if ts > now - timedelta(minutes=5):  # nunca en el futuro (el día de hoy, antes de las 06:00 UTC)
        ts = max(datetime.combine(day, time(0, 0), tzinfo=timezone.utc) + timedelta(seconds=slot),
                 now - timedelta(minutes=5 + 2 * (len(INDICATORS) - slot)))
    return ts


def build_plan(cfg: Config, member: Dict[str, Any], codes: List[str], defs: Dict[str, Dict[str, Any]],
               end: date, now: datetime) -> List[Dict[str, Any]]:
    """Lista cronológica de mediciones a enviar para un astronauta (sin estado: lo calcula el backend)."""
    scenario = member["scenario"]
    dates = window_dates(end, cfg.days)
    series: Dict[str, List[Tuple[float, Optional[float]]]] = {}
    for code in codes:
        d = defs[code]
        series[code] = generate_series(
            cfg.seed, member["crew_code"], code, cfg.days,
            trend_per_day=scenario["trends"].get(code, 0.0),
            random_walk_sd=scenario["random_walk"].get(code, 0.0),
            valid_range=(d["min_valid_value"], d["max_valid_value"]),
            noise_scale=scenario.get("noise_scale", {}).get(code, 1.0),
        )
    # Anomalías controladas: se fija el valor dentro del tramo de la regla vigente
    for when, code, level in scenario["anomalies"]:
        if code not in series:
            continue
        idx = cfg.days // 2 if when == "mid" else cfg.days - 1 - int(when)
        if not 0 <= idx < cfg.days:
            continue
        d = defs[code]
        v = anomaly_value(d.get("rule") or {}, level, (d["min_valid_value"], d["max_valid_value"]),
                          INDICATORS[code].decimals)
        if v is not None:
            _, sec = series[code][idx]
            series[code][idx] = (v, None if sec is None else min(sec, v - 10))

    plan = []
    for i, day in enumerate(dates):
        phase, env, module = phase_for_day(i, cfg.days)
        for slot, code in enumerate(codes):
            sparse = SPARSE_INDICATORS.get(code)
            if sparse is not None and i < cfg.days - sparse:
                continue
            value, sec = series[code][i]
            plan.append({
                "date": day, "phase": phase, "env": env, "module": module, "indicator_code": code,
                "value": value, "secondary_value": sec, "measured_at": _measured_at(day, slot, now),
                "dedup_key": f"{DEDUP_PREFIX}:{cfg.mission_code}:{member['crew_code']}:{code}:{day.isoformat()}",
            })
    return plan


def _existing_days(api: Api, admin: AuthSession, astronaut_id: int, mission_id: int, code: str) -> set:
    rows = api.json("GET", f"{API}/health/measurements", admin, params={
        "astronaut_id": astronaut_id, "mission_id": mission_id, "indicator_code": code, "limit": 500,
    })["measurements"]
    return {datetime.fromisoformat(r["measured_at"]).astimezone(timezone.utc).date() for r in rows}


def _ensure_context(api: Api, admin: AuthSession, mission_id: int, astronaut_id: int,
                    phase: str, env: str, module: str, stats: Stats) -> None:
    ctx = api.json("GET", f"{API}/missions/{mission_id}/context", admin,
                   params={"astronaut_id": astronaut_id})["context"]
    if ctx.get("phase_code") == phase and ctx.get("environment_code") == env:
        stats.skipped["contexts"] += 1
        return
    api.json("POST", f"{API}/missions/{mission_id}/context", admin, json={
        "astronaut_id": astronaut_id, "environment_code": env, "phase_code": phase,
        "location_module": module, "determination_source": "DEMO_SIMULATION", "is_simulated": True,
    })
    stats.created["contexts"] += 1


def _load_health(api: Api, admin: AuthSession, cfg: Config, mission: Dict[str, Any], crew: List[Dict[str, Any]],
                 codes: List[str], defs: Dict[str, Dict[str, Any]], end: date, now: datetime, stats: Stats) -> None:
    for member in crew:
        plan = build_plan(cfg, member, codes, defs, end, now)
        existing = {code: _existing_days(api, admin, member["id"], mission["id"], code) for code in codes}
        # Bloques consecutivos de la misma fase/entorno (el backend asigna fase y entorno desde el contexto)
        blocks: List[List[Dict[str, Any]]] = []
        for item in plan:
            if blocks and (blocks[-1][0]["phase"], blocks[-1][0]["env"]) == (item["phase"], item["env"]):
                blocks[-1].append(item)
            else:
                blocks.append([item])
        for block in blocks:
            missing = [it for it in block if it["date"] not in existing[it["indicator_code"]]]
            stats.skipped["health_measurements"] += len(block) - len(missing)
            if not missing:
                continue
            first = block[0]
            _ensure_context(api, admin, mission["id"], member["id"], first["phase"], first["env"],
                            first["module"], stats)
            for it in missing:
                resp = api.call("POST", f"{API}/health/measurements", admin, json={
                    "astronaut_id": member["id"], "mission_id": mission["id"],
                    "indicator_code": it["indicator_code"], "value": it["value"],
                    "secondary_value": it["secondary_value"], "measured_at": it["measured_at"].isoformat(),
                    "source_code": SOURCE_CODE, "data_quality": "SYNTHETIC_DEMO", "is_simulated": True,
                    "notes": f"{NOTE_TAG} · escenario {member['scenario']['code']}",
                    "dedup_key": it["dedup_key"],
                })
                if resp.status_code not in (200, 201):
                    stats.fail("health_measurements", f"{it['dedup_key']} -> {resp.status_code} {resp.text[:200]}")
                    continue
                body = resp.json()
                if body.get("duplicate_prevented"):
                    stats.skipped["health_measurements"] += 1
                    continue
                stats.created["health_measurements"] += 1
                stats.states[body["measurement"]["calculated_state"]] += 1
                if body.get("alert_generated"):
                    stats.alerts_touched += 1
        # El contexto vigente del astronauta queda en la última fase
        last_phase, last_env, last_module = PHASES[-1]
        _ensure_context(api, admin, mission["id"], member["id"], last_phase, last_env, last_module, stats)


def _load_environment(api: Api, admin: AuthSession, cfg: Config, mission: Dict[str, Any], today: date,
                      stats: Stats) -> None:
    """Una instantánea por parámetro, fase y día UTC (el endpoint fija measured_at = ahora)."""
    rows = api.json("GET", f"{API}/environment/measurements", admin,
                    params={"mission_id": mission["id"]})["environmental_measurements"]
    seen = {(r["phase_code"], r["environment_code"], r["parameter_code"]) for r in rows
            if r.get("is_simulated") and datetime.fromisoformat(r["measured_at"]).astimezone(timezone.utc).date() == today}
    for phase, env, _module in PHASES:
        for code, name, unit, mean, sd, decimals in ENV_PARAMETERS:
            if (phase, env, code) in seen:
                stats.skipped["environment_measurements"] += 1
                continue
            r = _rng(cfg.seed, cfg.mission_code, "env", phase, code, today.isoformat())
            value = round(mean + ENV_PHASE_SHIFT.get(env, {}).get(code, 0.0) + r.gauss(0.0, sd), decimals)
            value = ENV_ANOMALIES.get((env, code), value)
            resp = api.call("POST", f"{API}/environment/measurements", admin, json={
                "mission_id": mission["id"], "environment_code": env, "phase_code": phase,
                "parameter_code": code, "parameter_name": name, "value": value,
                "text_state": "SIMULADO", "unit": unit, "source_code": SOURCE_CODE, "is_simulated": True,
            })
            if resp.status_code in (200, 201):
                stats.created["environment_measurements"] += 1
                body = resp.json()
                stats.env_states[body.get("calculated_state") or "NORMAL"] += 1
                stats.env_alerts += int(body.get("crew_alerts_count", len(body.get("alerts_generated") or [])))
            else:
                stats.fail("environment_measurements", f"{code}/{phase} -> {resp.status_code} {resp.text[:200]}")


def _wellness_scores(seed: int, crew_code: str, scenario_code: str, today: date) -> Dict[str, Any]:
    r = _rng(seed, crew_code, "wellness", today.isoformat())
    strained = scenario_code == "ANOMALIAS"

    def s(mean: float) -> int:
        return int(min(10, max(1, round(mean + r.gauss(0.0, 1.0)))))

    return {
        "mood_score": s(5 if strained else 7.5), "stress_score": s(7 if strained else 3.5),
        "sleep_quality_score": s(5 if strained else 7), "sleep_hours": round(6.0 if strained else 7.3, 1),
        "fatigue_score": s(7 if strained else 3.5), "concentration_score": s(5 if strained else 7.5),
        "isolation_score": s(5 if strained else 3), "adaptation_score": s(6 if strained else 8),
        "social_support_score": s(7), "recovery_score": s(5 if strained else 7),
    }


def _load_astronaut_activity(api: Api, cfg: Config, mission: Dict[str, Any], crew: List[Dict[str, Any]],
                             today: date, stats: Stats) -> None:
    for member in crew:
        astro = api.login(member["email"], cfg.astronaut_password)
        if "wellness" in cfg.modules:
            existing = api.json("GET", f"{API}/wellness/assessments", astro)["assessments"]
            done_today = any(
                a.get("created_at") and datetime.fromisoformat(a["created_at"]).astimezone(timezone.utc).date() == today
                for a in existing
            )
            if done_today:
                stats.skipped["wellness_assessments"] += 1
            else:
                scores = _wellness_scores(cfg.seed, member["crew_code"], member["scenario"]["code"], today)
                resp = api.call("POST", f"{API}/wellness/assessments", astro, json={
                    "mission_id": mission["id"], "is_simulated": True,
                    "private_reflection": f"{NOTE_TAG} (texto ficticio)", **scores,
                })
                if resp.status_code in (200, 201):
                    stats.created["wellness_assessments"] += 1
                    recs = (resp.json().get("recommendations_bundle") or {}).get("recommendations") or []
                    if recs:
                        fb = api.call("POST", f"{API}/wellness/feedback", astro, json={
                            "recommendation_code": recs[0]["code"], "helpful_rating": 4, "notes": NOTE_TAG,
                        })
                        if fb.status_code in (200, 201):
                            stats.created["wellness_feedback"] += 1
                        else:
                            stats.fail("wellness_feedback", f"{fb.status_code} {fb.text[:200]}")
                else:
                    stats.fail("wellness_assessments", f"{member['crew_code']} -> {resp.status_code} {resp.text[:200]}")
            r = _rng(cfg.seed, member["crew_code"], "checkin", today.isoformat())
            resp = api.call("POST", f"{API}/wellness/quick-checkin", astro, json={
                "sleep_hours": round(7.0 + r.gauss(0.0, 0.5), 1), "sleep_quality": r.randint(3, 5),
                "mood": r.randint(3, 5), "energy": r.randint(3, 5), "feels_isolated": False,
                "note": f"{NOTE_TAG} (nota ficticia)",
                "dedup_key": f"{DEDUP_PREFIX}:checkin:{member['crew_code']}:{today.isoformat()}",
            })
            if resp.status_code in (200, 201):
                key = "skipped" if resp.json().get("duplicate_prevented") else "created"
                getattr(stats, key)["quick_checkins"] += 1
            else:
                stats.fail("quick_checkins", f"{member['crew_code']} -> {resp.status_code} {resp.text[:200]}")
        if "gamification" in cfg.modules:
            missions = api.json("GET", f"{API}/gamification/missions", astro)["missions"]
            for dm in [m for m in missions if not m["safety_blocked"]][:2]:
                if dm["status_today"] != "PENDING":
                    stats.skipped["gamification_events"] += 1
                    continue
                resp = api.call("POST", f"{API}/gamification/missions/complete", astro, json={
                    "daily_mission_code": dm["code"], "status_mode": "COMPLETED",
                    "reflection_note": NOTE_TAG, "is_simulated": True,
                })
                if resp.status_code in (200, 201) and not resp.json().get("already_recorded_today"):
                    stats.created["gamification_events"] += 1
                elif resp.status_code in (200, 201, 409):
                    stats.skipped["gamification_events"] += 1
                else:
                    stats.fail("gamification_events", f"{dm['code']} -> {resp.status_code} {resp.text[:200]}")


# --------------------------------------------------------------------------------------------------
# Verificación posterior
# --------------------------------------------------------------------------------------------------
def verify(api: Api, admin: AuthSession, cfg: Config, mission: Dict[str, Any], crew: List[Dict[str, Any]],
           codes: List[str]) -> Dict[str, Any]:
    checks: List[Dict[str, Any]] = []

    def check(name: str, ok: bool, detail: Any = None) -> None:
        checks.append({"check": name, "ok": bool(ok), "detail": detail})

    openapi = api.json("GET", "/openapi.json")
    check("router de predicciones registrado",
          f"{API}/predictions/indicators/{{indicator_code}}" in openapi.get("paths", {}))

    dense = [c for c in codes if c not in SPARSE_INDICATORS]
    required_days = min(30, cfg.days)
    predictions: Dict[str, Dict[str, Any]] = {}
    for member in crew:
        aid = member["id"]
        days_per_indicator = {
            c: len(_existing_days(api, admin, aid, mission["id"], c)) for c in dense
        }
        check(f"{member['crew_code']}: >= {required_days} días por indicador principal",
              all(v >= required_days for v in days_per_indicator.values()), days_per_indicator)

        ts = api.json("GET", f"{API}/analytics/timeseries", admin, params={
            "astronaut_id": aid, "mission_id": mission["id"], "indicator_code": dense[0]})
        real_points = [p for p in ts["points"] if not p.get("is_gap_marker")]
        check(f"{member['crew_code']}: serie temporal para gráficas ({dense[0]})", len(real_points) >= 10,
              len(real_points))

        pc = api.json("GET", f"{API}/analytics/phase-comparison", admin, params={
            "astronaut_id": aid, "mission_id": mission["id"], "indicator_code": dense[0]})
        phases = [p["phase_code"] for p in pc["phases_comparison"] if p["has_data"]]
        check(f"{member['crew_code']}: comparación entre fases", len(phases) >= min(2, len(PHASES)), phases)

        summary = api.call("GET", f"{API}/health/summary", admin, params={"astronaut_id": aid, "mission_id": mission["id"]})
        check(f"{member['crew_code']}: resumen de salud", summary.status_code == 200, summary.status_code)

        astro = api.login(member["email"], cfg.astronaut_password)
        member_preds = {}
        for c in codes:
            resp = api.call("GET", f"{API}/predictions/indicators/{c}", astro, params={
                "mission_id": mission["id"], "horizon_days": 7, "include_simulated": "true"})
            if resp.status_code != 200:
                member_preds[c] = {"status": f"HTTP {resp.status_code}"}
                continue
            body = resp.json()
            member_preds[c] = {"status": body["status"], "n_days": body["n_days"],
                               "phase_code": body.get("phase_code"), "forecast_points": len(body.get("forecast") or []),
                               "baseline_status": body.get("baseline_status")}
        predictions[member["crew_code"]] = member_preds

    flat = [p for m in predictions.values() for p in m.values()]
    check(">= 10 días UTC elegibles en el segmento más reciente (algún indicador)",
          any(p.get("n_days", 0) >= 10 for p in flat))
    check("al menos una predicción status=ok con puntos de pronóstico",
          any(p["status"] == "ok" and p.get("forecast_points", 0) > 0 for p in flat))

    alerts = api.json("GET", f"{API}/alerts", admin, params={"mission_id": mission["id"]})["alerts"]
    states = Counter(a.get("operational_state") or a.get("priority") for a in alerts)
    if any(m["scenario"]["anomalies"] for m in crew):
        check("las anomalías generan alertas (motor del backend)", len(alerts) > 0, dict(states))
    if "environment" in cfg.modules:
        env = api.json("GET", f"{API}/environment/measurements", admin, params={"mission_id": mission["id"]})
        check("mediciones ambientales", len(env["environmental_measurements"]) > 0,
              len(env["environmental_measurements"]))
    if "wellness" in cfg.modules:
        n = sum(len(api.json("GET", f"{API}/wellness/assessments", api.login(m["email"], cfg.astronaut_password))["assessments"])
                for m in crew)
        check("evaluaciones de bienestar", n > 0, n)

    return {
        "checks": checks,
        "predictions": predictions,
        "prediction_status_counts": dict(Counter(p["status"] for p in flat)),
        "alerts_by_state": dict(states),
        "all_ok": all(c["ok"] for c in checks),
    }


# --------------------------------------------------------------------------------------------------
# Orquestación
# --------------------------------------------------------------------------------------------------
def run(cfg: Config, client: httpx.Client, session_factory: Optional[Callable[[], Any]] = None,
        now: Optional[datetime] = None) -> Dict[str, Any]:
    """Ejecuta la precarga contra `client` (httpx.Client o TestClient de FastAPI) y devuelve el resumen."""
    parsed = urlparse(str(client.base_url))
    host = parsed.hostname or ""
    if host not in LOCAL_HOSTS:
        if not cfg.allow_remote:
            raise SeedError(f"Host '{host}' no es local: use --allow-remote solo contra entornos de desarrollo/pruebas.")
        # Host remoto: credenciales cifradas en tránsito, contraseña sintética propia y sin acceso directo a la BD
        if parsed.scheme != "https":
            raise SeedError("--allow-remote exige una URL https (las credenciales no viajan en claro).")
        if not cfg.synth_password_explicit:
            raise SeedError("--allow-remote exige definir SEMSA_SYNTH_PASSWORD explícitamente "
                            "(no se reutiliza la contraseña demo).")
        if cfg.baselines_db:
            raise SeedError("--baselines-db no se permite con --allow-remote: escribe directamente en la BD local.")
    if cfg.days < 1 or cfg.astronauts < 1:
        raise SeedError("--days y --astronauts deben ser >= 1.")
    unknown_modules = set(cfg.modules) - set(ALL_MODULES)
    if unknown_modules:
        raise SeedError(f"Módulos desconocidos: {sorted(unknown_modules)}")

    now = now or datetime.now(timezone.utc)
    end = cfg.end_date or now.date()
    if end > now.date():
        raise SeedError("--end-date no puede estar en el futuro.")
    api = Api(client)
    stats = Stats()

    admin = api.login(cfg.admin_email, cfg.admin_password)
    me = api.json("GET", f"{API}/auth/me", admin)
    role = (me.get("user") or me).get("role_code")
    if role != "ADMINISTRATOR":
        raise SeedError(f"La cuenta {cfg.admin_email} no es ADMINISTRATOR (rol {role}).")

    reset_stats = None
    if cfg.reset:
        if not cfg.confirm_reset:
            raise SeedError("--reset borra TODOS los datos simulados (incluido el escenario demo, que se "
                            "regenera): repítalo con --confirm-reset.")
        reset_stats = api.json("POST", f"{API}/simulator/reset", admin).get("stats")

    defs = {d["code"]: d for d in api.json("GET", f"{API}/health/indicators", admin)["indicators"]}
    wanted = cfg.indicators or list(INDICATORS)
    codes = [c for c in wanted if c in INDICATORS and c in defs]
    ignored = sorted(set(wanted) - set(codes))
    if ignored:
        log.warning("Indicadores ignorados (desconocidos para el script o el backend): %s", ignored)
    if not codes or all(c in SPARSE_INDICATORS for c in codes):
        raise SeedError("No hay indicadores principales que generar.")

    profiles = {p["code"] for p in api.json("GET", f"{API}/environment/profiles", admin)["profiles"]}
    missing_env = sorted({env for _, env, _ in PHASES} - profiles)
    if missing_env:
        raise SeedError(f"Perfiles ambientales inexistentes en el backend: {missing_env}")

    crew = _synthetic_crew(cfg)
    leader_id = _ensure_users(api, admin, cfg, crew, stats)
    mission = _ensure_mission(api, admin, cfg, stats)
    _ensure_assignments(api, admin, mission, crew, leader_id, stats)

    if cfg.baselines_db:
        if session_factory is None:
            from backend.app.database.session import SessionLocal
            session_factory = SessionLocal
        _ensure_baselines_db(session_factory, cfg, crew, codes, stats)

    if "health" in cfg.modules:
        _load_health(api, admin, cfg, mission, crew, codes, defs, end, now, stats)
    if "environment" in cfg.modules:
        _load_environment(api, admin, cfg, mission, now.date(), stats)
    if {"wellness", "gamification"} & set(cfg.modules):
        _load_astronaut_activity(api, cfg, mission, crew, now.date(), stats)

    summary: Dict[str, Any] = {
        "mission": {"id": mission["id"], "code": mission["code"]},
        "astronauts": [{"id": m["id"], "crew_code": m["crew_code"], "email": m["email"],
                        "scenario": m["scenario"]["code"]} for m in crew],
        "window": {"from": window_dates(end, cfg.days)[0].isoformat(), "to": end.isoformat(), "days": cfg.days},
        "seed": cfg.seed,
        "created": dict(stats.created),
        "skipped": dict(stats.skipped),
        "failed": dict(stats.failed),
        "errors": stats.errors,
        "measurement_states_created": dict(stats.states),
        "measurements_with_alert": stats.alerts_touched,
        "environment_states_created": dict(stats.env_states),
        "environment_alerts": stats.env_alerts,
        "reset": reset_stats,
    }
    if cfg.verify:
        summary["verification"] = verify(api, admin, cfg, mission, crew, codes)
    return summary


def parse_args(argv: Optional[List[str]] = None) -> Config:
    p = argparse.ArgumentParser(
        description="Precarga datos sintéticos (SIMULADO) en SEMSA a través de la API de FastAPI (issue #24).")
    p.add_argument("--base-url", default=os.getenv("SEMSA_API_URL", "http://127.0.0.1:8000"),
                   help="URL base de la API (env SEMSA_API_URL).")
    p.add_argument("--astronauts", type=int, default=int(os.getenv("SEMSA_SEED_ASTRONAUTS", "3")),
                   help="Astronautas sintéticos (escenarios ESTABLE, TENDENCIAS, ANOMALIAS por turno).")
    p.add_argument("--days", type=int, default=int(os.getenv("SEMSA_SEED_DAYS", "45")),
                   help="Días UTC de histórico (>= 30 recomendado).")
    p.add_argument("--seed", type=int, default=int(os.getenv("SEMSA_SEED", "24")), help="Semilla aleatoria.")
    p.add_argument("--end-date", default=os.getenv("SEMSA_SEED_END_DATE"),
                   help="Último día del histórico (AAAA-MM-DD, por defecto hoy UTC).")
    p.add_argument("--mission-code", default=os.getenv("SEMSA_SEED_MISSION", "SYNTH-SEED-24"),
                   help="Código de la misión sintética (se crea si no existe; debe ser simulada).")
    p.add_argument("--crew-prefix", default=os.getenv("SEMSA_SEED_CREW_PREFIX", "SYN24"),
                   help="Prefijo de códigos y correos de la tripulación sintética.")
    p.add_argument("--indicators", default=os.getenv("SEMSA_SEED_INDICATORS"),
                   help=f"Lista separada por comas (por defecto: {','.join(INDICATORS)}).")
    p.add_argument("--modules", default=os.getenv("SEMSA_SEED_MODULES", ",".join(ALL_MODULES)),
                   help=f"Módulos habilitados, separados por comas: {','.join(ALL_MODULES)}.")
    p.add_argument("--baselines-db", action="store_true",
                   help="Crea líneas base sintéticas con SQLAlchemy (no hay endpoint): requiere ejecutar en el "
                        "servidor con el mismo DATABASE_URL que la API.")
    p.add_argument("--reset", action="store_true",
                   help="Llama a POST /simulator/reset antes de cargar (borra TODOS los datos simulados).")
    p.add_argument("--confirm-reset", action="store_true", help="Confirmación explícita de --reset.")
    p.add_argument("--allow-remote", action="store_true",
                   help="Permite un host no local (solo entornos de desarrollo/pruebas, nunca producción).")
    p.add_argument("--no-verify", action="store_true", help="Omite la verificación posterior.")
    p.add_argument("--verbose", "-v", action="store_true")
    a = p.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO, format="%(levelname)s %(message)s")
    return Config(
        base_url=a.base_url.rstrip("/"), astronauts=a.astronauts, days=a.days, seed=a.seed,
        end_date=date.fromisoformat(a.end_date) if a.end_date else None,
        mission_code=a.mission_code.strip().upper(), crew_prefix=a.crew_prefix,
        indicators=[c.strip().upper() for c in a.indicators.split(",") if c.strip()] if a.indicators else None,
        modules=tuple(m.strip().lower() for m in a.modules.split(",") if m.strip()),
        baselines_db=a.baselines_db, reset=a.reset, confirm_reset=a.confirm_reset,
        allow_remote=a.allow_remote, verify=not a.no_verify,
    )


def main(argv: Optional[List[str]] = None) -> int:
    cfg = resolve_credentials(parse_args(argv))
    with httpx.Client(base_url=cfg.base_url, timeout=60.0) as client:
        try:
            summary = run(cfg, client)
        except (SeedError, httpx.HTTPError) as exc:
            log.error("%s", exc)
            return 2
    print(json.dumps(summary, ensure_ascii=False, indent=2, default=str))
    verification_ok = summary.get("verification", {}).get("all_ok", True)
    return 0 if not summary["failed"] and verification_ok else 1


if __name__ == "__main__":
    sys.exit(main())
