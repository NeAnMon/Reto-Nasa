"""SEMSA · Servicio · Pronóstico exploratorio de indicadores fisiológicos (no es apoyo a la decisión clínica).

Pronostica la TENDENCIA de un indicador (1–14 días); no predice enfermedades ni diagnostica.
El llamador debe autorizar el acceso a los datos del astronauta. Sin dependencias de FastAPI.

Método (elegido por backtest de origen móvil sobre los vitales reales de NASA UTMB, reposo en cama
con la cabeza inclinada: un análogo terrestre de la microgravedad, NO datos de vuelo espacial;
ver `backend/tests/test_prediction_calibration.py`):

1. Nivel robusto: mediana ponderada exponencialmente de las medianas diarias del último segmento
   de misma fase/entorno (`LEVEL_ALPHA`; vida media ≈ 10 días). En los datos reales gana a
   "último valor" y a "media de 7 días"; la recta OLS que usaba la primera versión perdía contra ambas.
2. Tendencia: recta OLS de los últimos `TREND_WINDOW_DAYS` días con prueba t corregida por
   autocorrelación de orden 1 (`TREND_ALPHA`). Se informa siempre (dirección, pendiente,
   significación), pero solo se extrapola si además domina al ruido dentro de la propia serie
   (validación de origen móvil: error ≤ `TREND_SKILL_RATIO` × error del nivel y menor que el del
   ingenuo). En los datos reales esa condición no se cumple nunca: extrapolar pendientes, incluso
   significativas, empeoraba el error.
3. Compuerta de fiabilidad: habilidad frente a "repetir el último valor" medida con validación de
   origen móvil dentro de la serie (pasos de 1 a `VALIDATION_MAX_STEP_DAYS` días).
4. Bandas de predicción al 80 % y 95 %: dispersión propia de la serie (semivarianzas a cada lado
   del nivel, así la banda puede ser asimétrica), cuantil t y una inflación empírica que crece con
   el horizonte, ajustada en una mitad de los sujetos y comprobada en la otra. (Las bandas de la
   rama de tendencia usan el intervalo de predicción de la regresión con esa misma inflación; no
   están contrastadas con datos reales porque esa rama no se activa en ellos.)
5. Proyección contra el motor de alertas: el estado de cada día pronosticado lo da
   `rules/evaluation.evaluate_reading` (umbral absoluto de la versión vigente de la regla + desvío
   frente a la línea base personal), evaluando el nivel como sostenido. No se proyectan la
   diastólica ni la dosis acumulada de radiación. La recomendación preventiva sale del catálogo de
   alertas (`rules/recommendations.py`) para el indicador y la dirección del cruce. Aquí no se
   crean alertas.

Las funciones puras (sin BD) están en la primera mitad del módulo; `predict_indicator` las aplica
a las mediciones del astronauta.
"""
from __future__ import annotations

from bisect import insort
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from math import isfinite, log, pi, sqrt
from statistics import NormalDist, median

from sqlalchemy.orm import Session

from backend.app.models.models import (
    HealthBaseline, HealthIndicatorDefinition, HealthMeasurement, MissionAssignment,
)
from backend.app.rules.calibration import (
    PERSISTENCE_WINDOW_HOURS, Z_RED, Z_YELLOW, get_calibration, is_placeholder_std_dev,
)
from backend.app.rules.engine import baseline_from_row, get_active_rule_version
from backend.app.rules.evaluation import (
    ABS_OBSERVE, Evaluation, PersonalBaseline, PreviousReading, RollingWindow, Thresholds,
    evaluate_reading, is_valid_std_dev,
)
from backend.app.rules.recommendations import (
    CATALOG, GENERIC, HIGH, LEVEL_STEP, LOW, PERSONAL, RULE_FOLLOWUP_INSTRUCTIONS,
    RULE_IMMEDIATE_INSTRUCTIONS, build_alert_texts, get_recommendation,
)

MIN_DAYS = 10
MAX_HORIZON = 14
MAX_HISTORY_DAYS = 90
MAX_ROWS = 10000
VALID_QUALITIES = ("VALIDATED", "SYNTHETIC_DEMO")
EXCLUDED_PHASES = ("TRAINING", "PRE_MISSION_BASELINE")
DISCLAIMER = (
    "Preliminary statistical estimate only; not a clinical assessment, "
    "diagnosis, or basis for medical decisions."
)

# --- Método (hiperparámetros afinados en una mitad de los sujetos UTMB y confirmados en la otra) ---
METHOD_CODE = "robust_level_v1"
LEVEL_ALPHA = 0.07                 # peso exponencial por día de antigüedad (vida media ≈ 9,6 días)
TREND_WINDOW_DAYS = 45             # ventana de la recta de tendencia
TREND_MIN_POINTS = 10              # días con dato dentro de la ventana para evaluar la tendencia
TREND_ALPHA = 0.01                 # nivel de significación bilateral de la prueba de tendencia
TREND_SKILL_RATIO = 0.5            # la tendencia se extrapola solo si su error ≤ 0,5 × error del nivel
VALIDATION_MIN_TRAIN = 5           # puntos mínimos de entrenamiento en la validación de origen móvil
VALIDATION_MAX_STEP_DAYS = 7       # se validan pronósticos de 1 a 7 días dentro de la serie
VALIDATION_MIN_COMPARISONS = 10    # comparaciones mínimas para dar por medida la habilidad
INTERVAL_LEVELS = (80, 95)
# Inflación empírica c_p(h) = a + b·ln(h) del cuantil t, ajustada en la mitad de afinado.
PI_INFLATION = {80: (0.8390, 0.0177), 95: (0.9056, 0.0140)}
PI_SMALL_SAMPLE = 2.0              # factor (1 + 2/n_ef) por muestra pequeña
PI_SIDE_FLOOR = 0.25               # cada semivarianza vale al menos el 25 % de la varianza total

# Indicadores cuyo pronóstico se contrastó con datos reales (UTMB: pulso, presión sistólica,
# temperatura y frecuencia respiratoria en reposo en cama). Para el resto el método se aplica igual,
# pero sin validación empírica.
VALIDATED_INDICATORS = ("HEART_RATE", "BLOOD_PRESSURE", "BODY_TEMP", "RESP_RATE")
VALIDATION_DATASET = "NASA UTMB head-down bed rest (ground analog of microgravity)"

# Textos visibles al usuario (en español, como el resto del backend; su traducción al inglés está en
# frontend/src/i18n/backend-en-runtime.js y la comprueba frontend/tests/test_frontend_integrity.py).
METHOD_DESCRIPTION = (
    "Nivel robusto: mediana ponderada exponencialmente de las medianas diarias del segmento actual "
    "(los días recientes pesan más). La tendencia se informa siempre, pero solo se extrapola si es "
    "estadísticamente significativa y reduce el error dentro de la propia serie; en caso contrario "
    "el pronóstico es plano. Cada día lleva bandas de predicción al 80 % y al 95 %."
)
VALIDATION_NOTE_VALIDATED = (
    "Método calibrado con datos reales de reposo en cama (NASA UTMB), un análogo terrestre de la "
    "microgravedad; no son datos de vuelo espacial."
)
VALIDATION_NOTE_NOT_VALIDATED = (
    "Indicador sin validación empírica: el método se calibró solo con pulso, presión sistólica, "
    "temperatura y frecuencia respiratoria en reposo en cama (análogo terrestre) y aquí se aplica "
    "sin haber medido su error real."
)

_NORMAL = NormalDist()
_STATE_SEVERITY = {"NORMAL": 0, "MONITOR": 1, "WARNING": 2, "CRITICAL": 3}


@dataclass
class PredictionResult:
    status: str
    indicator_code: str
    unit: str | None = None
    phase_code: str | None = None
    environment_code: str | None = None
    n_days: int = 0
    # Compatibilidad: recta de tendencia observada. beta1 = 0 si la pendiente no es significativa.
    # Solo generan el pronóstico cuando trend["extrapolated"] es True.
    beta0: float | None = None
    beta1: float | None = None
    # Compatibilidad: MAE del método y del ingenuo en la validación de origen móvil de la serie.
    mae_ols: float | None = None
    mae_naive: float | None = None
    forecast: list[dict] = field(default_factory=list)
    # z frente a la línea base personal como lo calcula el motor de alertas (DE con piso; en los
    # indicadores de media móvil, DE de la media). Último día pronosticado; también va en cada día.
    z_score: float | None = None
    z_band: str | None = None
    direction: str | None = None  # respecto a la línea base (above / below / at_baseline)
    baseline_status: str = "missing"
    baseline_is_simulated: bool | None = None
    disclaimer: str = DISCLAIMER
    # --- Campos añadidos (opcionales) ---
    baseline_value: float | None = None
    method: dict | None = None
    trend: dict | None = None
    reliability: dict | None = None
    empirical_validation: dict | None = None
    threshold_projection: dict | None = None
    recommendation: dict | None = None


# ============================================================================
# Lógica pura (sin base de datos)
# ============================================================================

def t_quantile(df: float, alpha: float) -> float:
    """Valor crítico bilateral de la t de Student (expansión de Cornish–Fisher; exacta a 3 decimales con df ≥ 3)."""
    df = max(float(df), 3.0)
    z = _NORMAL.inv_cdf(1 - alpha / 2)
    g1 = (z ** 3 + z) / 4
    g2 = (5 * z ** 5 + 16 * z ** 3 + 3 * z) / 96
    g3 = (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / 384
    g4 = (79 * z ** 9 + 776 * z ** 7 + 1482 * z ** 5 - 1920 * z ** 3 - 945 * z) / 92160
    return z + g1 / df + g2 / df ** 2 + g3 / df ** 3 + g4 / df ** 4


def prefix_levels(xs: list[int], ys: list[float], alpha: float = LEVEL_ALPHA) -> list[float | None]:
    """Nivel robusto de cada prefijo: out[m] es la mediana ponderada exponencialmente de los m primeros puntos.

    El peso de un punto cae un factor (1 − alpha) por día de antigüedad respecto al último del prefijo.
    """
    q = 1 - alpha
    x0 = xs[0]
    items: list[tuple[float, float]] = []
    total = 0.0
    out: list[float | None] = [None]
    for x, y in zip(xs, ys):
        w = q ** (x0 - x)  # pesos relativos: equivalen a q ** (x_último − x)
        insort(items, (y, w))
        total += w
        half = total / 2
        acc = 0.0
        value = y
        for value, weight in items:
            acc += weight
            if acc >= half:
                break
        out.append(value)
    return out


def _resolution(values: list[float]) -> float:
    """Paso decimal con el que están registrados los valores (1, 0,1, 0,01…); 0 si no es apreciable."""
    for decimals in range(0, 5):
        factor = 10 ** decimals
        if all(abs(v * factor - round(v * factor)) < 1e-6 for v in values):
            return 10.0 ** (-decimals)
    return 0.0


def _level_spread(xs: list[int], ys: list[float], level: float, alpha: float = LEVEL_ALPHA) -> dict:
    """Dispersión alrededor del nivel con los mismos pesos exponenciales.

    Devuelve las semiamplitudes base (sin cuantil ni inflación) hacia arriba y hacia abajo y el
    tamaño efectivo de muestra. Usa semivarianzas para que una distribución asimétrica (p. ej. el
    pulso, con picos hacia arriba) dé una banda asimétrica.
    """
    q = 1 - alpha
    xn = xs[-1]
    sw = sw2 = total = upper = lower = 0.0
    for x, y in zip(xs, ys):
        w = q ** (xn - x)
        sw += w
        sw2 += w * w
        d = y - level
        total += w * d * d
        if d > 0:
            upper += w * d * d
        elif d < 0:
            lower += w * d * d
    n_eff = sw * sw / sw2
    variance = total / sw
    var_up = max(2 * upper / sw, PI_SIDE_FLOOR * variance)
    var_down = max(2 * lower / sw, PI_SIDE_FLOOR * variance)
    bessel = n_eff / (n_eff - 1) if n_eff > 1 else 1.0
    quantization = _resolution(ys) ** 2 / 12          # incertidumbre mínima por redondeo del dato
    level_error = 1 + (pi / 2) / n_eff                # error de estimar el nivel con una mediana
    small = 1 + PI_SMALL_SAMPLE / n_eff
    return {
        "up": sqrt((var_up * bessel + quantization) * level_error) * small,
        "down": sqrt((var_down * bessel + quantization) * level_error) * small,
        "n_eff": n_eff,
        "df": max(n_eff - 1, 3.0),
        "scale": sqrt(variance),
    }


def _inflation(level: int, h: int) -> float:
    a, b = PI_INFLATION[level]
    return a + b * log(h)


def _window_start(xs: list[int], m: int, window: int) -> int:
    """Primer índice a con xs[a] > xs[m−1] − window (tramo [a, m))."""
    limit = xs[m - 1] - window
    a = 0
    while xs[a] <= limit:
        a += 1
    return a


def _fit_line(xs: list[int], ys: list[float]) -> dict | None:
    """Recta OLS con residuos explícitos. None si no se puede ajustar."""
    n = len(xs)
    if n < 3 or n != len(ys):
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx <= 0:
        return None
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    intercept = my - slope * mx
    if not (isfinite(intercept) and isfinite(slope)):
        return None
    residuals = [y - (intercept + slope * x) for x, y in zip(xs, ys)]
    sse = sum(e * e for e in residuals)
    syy = sum((y - my) ** 2 for y in ys)
    perfect = sse <= 1e-12 * syy
    r1 = 0.0
    if not perfect and sse > 0:
        r1 = sum(residuals[i] * residuals[i - 1] for i in range(1, n)) / sse
    return {"n": n, "intercept": intercept, "slope": slope, "sse": 0.0 if perfect else sse,
            "sxx": sxx, "mean_x": mx, "r1": r1, "perfect": perfect}


def assess_trend(xs: list[int], ys: list[float]) -> dict:
    """Tendencia de los últimos `TREND_WINDOW_DAYS` días: pendiente por día y si es significativa.

    Prueba t de la pendiente OLS con corrección por autocorrelación de orden 1 de los residuos
    (tamaño efectivo n·(1−r1)/(1+r1) cuando r1 > 0). Sobre ruido blanco su tasa de falsos positivos
    queda en el nivel nominal o algo por debajo; con ruido autocorrelacionado la corrección evita
    la mayor parte de las falsas tendencias de la prueba t simple.
    """
    start = _window_start(xs, len(xs), TREND_WINDOW_DAYS)
    wx, wy = xs[start:], ys[start:]
    out = {
        "direction": "undetermined", "slope_per_day": None, "slope_std_error": None,
        "t_statistic": None, "critical_value": None, "significant": False, "alpha": TREND_ALPHA,
        "lag1_autocorrelation": None, "effective_n": None, "window_days": TREND_WINDOW_DAYS,
        "n_points": len(wx), "extrapolated": False, "fit": None,
    }
    if len(wx) < TREND_MIN_POINTS:
        return out
    fit = _fit_line(wx, wy)
    if fit is None:
        return out
    n, slope = fit["n"], fit["slope"]
    out.update(fit=fit, slope_per_day=slope, lag1_autocorrelation=fit["r1"], effective_n=float(n))
    significant = False
    if fit["perfect"]:
        significant = slope != 0
        out["slope_std_error"] = 0.0
    else:
        se = sqrt(fit["sse"] / (n - 2) / fit["sxx"])
        t = abs(slope) / se
        df = float(n - 2)
        r1 = fit["r1"]
        if r1 > 0:
            n_eff = n * (1 - r1) / (1 + r1)
            out["effective_n"] = n_eff
            if n_eff - 2 < 3:
                t = 0.0  # demasiada dependencia serial para afirmar una tendencia
            else:
                t *= sqrt((n_eff - 2) / (n - 2))
                df = n_eff - 2
        critical = t_quantile(df, TREND_ALPHA)
        significant = t > critical
        out.update(slope_std_error=se, t_statistic=t, critical_value=critical)
    out["significant"] = significant
    out["direction"] = ("rising" if slope > 0 else "falling") if significant else "stable"
    return out


def rolling_validation(xs: list[int], ys: list[float], levels: list[float | None]) -> dict:
    """Validación de origen móvil dentro de la serie.

    Para cada origen interno (los m primeros puntos, m ≥ `VALIDATION_MIN_TRAIN`) se pronostican los
    días siguientes hasta `VALIDATION_MAX_STEP_DAYS` con tres modelos: el nivel robusto, la recta de
    tendencia de la ventana y el ingenuo (repetir el último valor). Devuelve el MAE de cada uno.
    """
    n = len(ys)
    # Sumas acumuladas (y centrada) para ajustar la recta de cualquier tramo en O(1).
    y0 = ys[0]
    px, py, pxx, pxy = [0.0], [0.0], [0.0], [0.0]
    for x, y in zip(xs, ys):
        px.append(px[-1] + x)
        py.append(py[-1] + (y - y0))
        pxx.append(pxx[-1] + x * x)
        pxy.append(pxy[-1] + x * (y - y0))
    e_level = e_naive = e_trend = 0.0
    k = 0
    for m in range(VALIDATION_MIN_TRAIN, n):
        level = levels[m]
        last = ys[m - 1]
        x_last = xs[m - 1]
        a = _window_start(xs, m, TREND_WINDOW_DAYS)
        cnt = m - a
        slope = intercept = None
        if cnt >= 3:
            sx = px[m] - px[a]
            sy = py[m] - py[a]
            sxx = pxx[m] - pxx[a] - sx * sx / cnt
            if sxx > 0:
                slope = (pxy[m] - pxy[a] - sx * sy / cnt) / sxx
                intercept = y0 + (sy - slope * sx) / cnt
        for j in range(m, n):
            h = xs[j] - x_last
            if h > VALIDATION_MAX_STEP_DAYS:
                break
            y = ys[j]
            e_level += abs(y - level)
            e_naive += abs(y - last)
            e_trend += abs(y - level) if slope is None else abs(y - (intercept + slope * xs[j]))
            k += 1
    if not k:
        return {"n_comparisons": 0, "mae_level": None, "mae_naive": None, "mae_trend": None}
    return {"n_comparisons": k, "mae_level": e_level / k, "mae_naive": e_naive / k, "mae_trend": e_trend / k}


def forecast_series(xs: list[int], ys: list[float], horizon_days: int = MAX_HORIZON) -> dict:
    """Pronóstico de una serie diaria (xs = día relativo, ys = valor) a 1..horizon_days días.

    Función pura: es la que usa `predict_indicator` y la que contrasta el backtest con datos reales.
    Devuelve siempre `status` ("ok", "model_not_reliable" o "insufficient_data"); con al menos
    `MIN_DAYS` días devuelve además los puntos pronosticados aunque el estado no sea "ok", para que
    el backtest pueda medir el error de los pronósticos rechazados.
    """
    n = len(ys)
    out = {
        "status": "insufficient_data", "n_days": n, "model": None, "level": None, "points": [],
        "trend": None, "validation": None, "skill_vs_naive": None, "mae_model": None,
        "mae_naive": None, "beta0": None, "beta1": None, "interval_base": None,
    }
    if n < MIN_DAYS or n != len(xs):
        return out

    levels = prefix_levels(xs, ys)
    level = levels[n]
    validation = rolling_validation(xs, ys, levels)
    trend = assess_trend(xs, ys)
    fit = trend.pop("fit")

    k = validation["n_comparisons"]
    mae_level, mae_naive, mae_trend = validation["mae_level"], validation["mae_naive"], validation["mae_trend"]
    use_trend = bool(
        trend["significant"] and fit is not None and k >= VALIDATION_MIN_COMPARISONS
        and mae_trend <= TREND_SKILL_RATIO * mae_level and mae_trend < mae_naive
    )
    trend["extrapolated"] = use_trend
    mae_model = mae_trend if use_trend else mae_level

    reliable = False
    skill = None
    if k >= VALIDATION_MIN_COMPARISONS:
        if mae_naive > 0:
            skill = 1 - mae_model / mae_naive
            reliable = mae_model < mae_naive
        else:  # serie constante en la validación: fiable solo si el modelo tampoco se equivoca
            skill = 0.0
            reliable = mae_model == 0

    x_last = xs[-1]
    points = []
    if use_trend:
        slope, intercept = fit["slope"], fit["intercept"]
        resid_var = fit["sse"] / (fit["n"] - 2)
        df = max((trend["effective_n"] or fit["n"]) - 2, 3.0)
        quantization = _resolution(ys) ** 2 / 12
        t_crit = {lv: t_quantile(df, 1 - lv / 100) for lv in INTERVAL_LEVELS}
        for h in range(1, horizon_days + 1):
            x = x_last + h
            spread = sqrt(resid_var * (1 + 1 / fit["n"] + (x - fit["mean_x"]) ** 2 / fit["sxx"]) + quantization)
            point = {"h": h, "value": intercept + slope * x}
            for lv in INTERVAL_LEVELS:
                half = _inflation(lv, h) * t_crit[lv] * spread
                point[f"lower_{lv}"] = point["value"] - half
                point[f"upper_{lv}"] = point["value"] + half
            points.append(point)
        out["beta0"], out["beta1"] = intercept, slope
    else:
        spread = _level_spread(xs, ys, level)
        t_crit = {lv: t_quantile(spread["df"], 1 - lv / 100) for lv in INTERVAL_LEVELS}
        for h in range(1, horizon_days + 1):
            point = {"h": h, "value": level}
            for lv in INTERVAL_LEVELS:
                k_h = _inflation(lv, h) * t_crit[lv]
                point[f"lower_{lv}"] = level - k_h * spread["down"]
                point[f"upper_{lv}"] = level + k_h * spread["up"]
            points.append(point)
        out["interval_base"] = {"up": spread["up"], "down": spread["down"], "scale": spread["scale"],
                                "t": t_crit, "n_eff": spread["n_eff"]}
        if trend["significant"] and fit is not None:
            out["beta0"], out["beta1"] = fit["intercept"], fit["slope"]
        else:
            out["beta0"], out["beta1"] = level, 0.0

    out.update(
        status="ok" if reliable else "model_not_reliable",
        model="trend" if use_trend else "level",
        level=level, points=points, trend=trend, validation=validation,
        skill_vs_naive=skill, mae_model=mae_model, mae_naive=mae_naive,
    )
    return out


@dataclass(frozen=True)
class ProjectionContext:
    """Lo que necesita el motor de alertas (`rules/evaluation.py`) para evaluar un nivel pronosticado."""

    indicator_code: str
    unit: str
    thresholds: Thresholds
    baseline: PersonalBaseline | None = None


def personal_scale(indicator_code: str, baseline: PersonalBaseline | None) -> tuple[float, float] | None:
    """(media, DE efectiva) con las que el motor de alertas calcula z para un nivel sostenido.

    None si no hay línea base válida. Es el mismo criterio que `evaluate_reading`: DE real (ni
    ausente, ni ≤ 0, ni de relleno), piso de DE de la calibración y, en los indicadores cuya regla
    usa la media móvil (sueño), DE de la media de la ventana. Lo comprueba
    `test_prediction_service.py::test_personal_scale_matches_the_alert_engine`.
    """
    if baseline is None or baseline.mean is None or not isfinite(baseline.mean):
        return None
    if not is_valid_std_dev(baseline.sd, baseline.is_simulated):
        return None
    cal = get_calibration(indicator_code)
    sd = max(float(baseline.sd), (cal.sd_floor if cal and cal.sd_floor else 0.0))
    if cal is not None and cal.rolling_days:
        sd /= sqrt(cal.rolling_days)
    return float(baseline.mean), sd


def evaluate_level(ctx: ProjectionContext, value: float) -> Evaluation:
    """Estado que daría el motor de alertas si el indicador se mantuviera en `value`.

    Envoltura fina de `evaluate_reading` (única fuente de verdad del estado). Como se evalúa un
    nivel sostenido y no una lectura aislada, la lectura anterior es el mismo valor (un desvío
    personal amarillo cuenta como confirmado) y, en los indicadores con regla de media móvil, la
    ventana completa está en ese valor. No se proyectan ni el valor secundario (la diastólica) ni
    la dosis acumulada de radiación.
    """
    cal = get_calibration(ctx.indicator_code)
    window = RollingWindow(mean=value, count=cal.rolling_days) if cal is not None and cal.rolling_days else None
    return evaluate_reading(
        ctx.indicator_code, value, None, ctx.thresholds, unit=ctx.unit, baseline=ctx.baseline,
        previous=PreviousReading(value=value), window=window,
    )


def evaluate_observed(ctx: ProjectionContext, xs: list[int], values: list[float]) -> Evaluation:
    """Estado del último valor diario observado, con su contexto real a resolución diaria.

    Como el motor al registrar una lectura: la lectura anterior solo cuenta si está dentro de la
    ventana de persistencia y, en los indicadores con media móvil, se usa la media de la ventana.
    """
    cal = get_calibration(ctx.indicator_code)
    previous = None
    if len(values) >= 2 and (xs[-1] - xs[-2]) * 24 <= PERSISTENCE_WINDOW_HOURS:
        previous = PreviousReading(value=values[-2])
    window = None
    if cal is not None and cal.rolling_days:
        recent = [v for x, v in zip(xs, values) if x > xs[-1] - cal.rolling_days]
        window = RollingWindow(mean=sum(recent) / len(recent), count=len(recent))
    return evaluate_reading(
        ctx.indicator_code, values[-1], None, ctx.thresholds, unit=ctx.unit, baseline=ctx.baseline,
        previous=previous, window=window,
    )


def _side(ev: Evaluation) -> str | None:
    """Lado del cruce: HIGH → above, LOW → below, PERSONAL → según el signo de z."""
    if ev.direction == HIGH:
        return "above"
    if ev.direction == LOW:
        return "below"
    if ev.direction == PERSONAL and ev.z is not None:
        return "above" if ev.z > 0 else "below"
    return None


def _crossing(ctx: ProjectionContext, ev: Evaluation) -> dict | None:
    """Estado, dirección y umbral cruzado de una evaluación del motor; None si es NORMAL.

    El umbral es el borde del rango absoluto que corresponde al estado o, cuando lo que decide es
    el desvío frente a la persona, media ± Z·DE (con la DE efectiva del motor).
    """
    if ev.state not in _STATE_SEVERITY or ev.state == "NORMAL":
        return None
    side = _side(ev)
    out = {"state": ev.state, "direction": side, "threshold": None, "reference": None, "alert_direction": ev.direction}
    if side is None:
        return out
    sign = 1 if side == "above" else -1
    th = ctx.thresholds
    scale = personal_scale(ctx.indicator_code, ctx.baseline)

    def edge(low: float, high: float) -> float:
        return high if sign > 0 else low

    if ev.direction == PERSONAL:
        if scale is not None:
            cut = Z_RED if ev.state == "WARNING" else Z_YELLOW
            out.update(threshold=scale[0] + sign * cut * scale[1], reference="personal_baseline")
        return out
    out["reference"] = "absolute_range"
    if ev.state == "CRITICAL":
        out["threshold"] = edge(th.warning_min, th.warning_max)
    elif ev.absolute_level == ABS_OBSERVE:
        out["threshold"] = edge(th.normal_min, th.normal_max)
    else:
        out["threshold"] = edge(th.monitor_min, th.monitor_max)
        if ev.state == "WARNING" and scale is not None:
            # Amarillo absoluto que además se aleja de la persona: manda el corte más exigente de los dos
            personal = scale[0] + sign * Z_YELLOW * scale[1]
            if (personal - out["threshold"]) * sign > 0:
                out.update(threshold=personal, reference="personal_baseline")
    return out


def _band_crossing(ctx: ProjectionContext, lower: float, upper: float) -> dict | None:
    """Peor estado que alcanza el tramo [lower, upper].

    El estado del motor solo empeora al alejarse por cada lado, así que basta evaluar los extremos.
    Si los dos salen del rango con la misma gravedad por lados distintos, la dirección es "both".
    """
    low = _crossing(ctx, evaluate_level(ctx, lower))
    high = _crossing(ctx, evaluate_level(ctx, upper))
    if low is None or high is None:
        return high or low
    if _STATE_SEVERITY[low["state"]] == _STATE_SEVERITY[high["state"]] and low["direction"] != high["direction"]:
        return {"state": high["state"], "direction": "both", "threshold": None, "reference": None, "alert_direction": None}
    return high if _STATE_SEVERITY[high["state"]] >= _STATE_SEVERITY[low["state"]] else low


def _personal_ranges(ctx: ProjectionContext) -> dict:
    """Banda personal amarilla (|z| ≥ 2) y roja (|z| ≥ 3) del indicador, si el motor la aplica."""
    cal = get_calibration(ctx.indicator_code)
    scale = personal_scale(ctx.indicator_code, ctx.baseline)
    if cal is None or not cal.deviation or scale is None:
        return {}
    mean, sd = scale
    upper = cal.deviation == "both"  # "low": solo alerta el desvío hacia abajo
    out = {"personal_yellow": [mean - Z_YELLOW * sd, mean + Z_YELLOW * sd if upper else None]}
    if cal.deviation_red:
        out["personal_red"] = [mean - Z_RED * sd, mean + Z_RED * sd if upper else None]
    return out


def _recommendation_texts(ctx: ProjectionContext, version, target: dict, out_now: bool) -> dict:
    """Recomendación del catálogo de alertas para el indicador y la dirección del cruce.

    Si el catálogo no tiene una entrada propia para ese indicador y dirección (solo la genérica),
    se usan las instrucciones de seguimiento de la versión de regla; y si la regla solo remite a
    la alerta, la entrada genérica del catálogo. La acción inmediata solo se da cuando el último
    valor ya está fuera de rango: ante un cruce previsto lo útil es la pauta para los próximos días.
    """
    direction = target.get("alert_direction")
    rec = get_recommendation(ctx.indicator_code, direction) if direction else None
    generic = any(rec is entry for key, entry in CATALOG.items() if key[0] == GENERIC)
    if rec is not None and not generic:
        return {
            "text": rec.followup,
            "immediate_action": build_alert_texts(ctx.indicator_code, direction, target["state"])[0] if out_now else None,
            "source": "alert_recommendation_catalog",
            "source_detail": rec.source,
        }
    rule_text = (version.followup_instructions or "").strip()
    if rule_text and rule_text != RULE_FOLLOWUP_INSTRUCTIONS:
        immediate = (version.immediate_instructions or "").strip()
        return {
            "text": rule_text,
            "immediate_action": immediate if out_now and immediate and immediate != RULE_IMMEDIATE_INSTRUCTIONS else None,
            "source": "clinical_rule_followup_instructions",
            "source_detail": version.protocol_source,
        }
    # Entrada genérica: por dirección, o la de "fuera de tu rango habitual" si la banda sale por los dos lados
    generic_key = {"above": HIGH, "below": LOW}.get(target.get("direction"), PERSONAL)
    rec = rec or CATALOG[(GENERIC, generic_key)]
    level_step = LEVEL_STEP.get(target["state"], LEVEL_STEP["MONITOR"])
    return {
        "text": rec.followup,
        "immediate_action": f"{rec.now}\n{level_step}" if out_now else None,
        "source": "alert_recommendation_catalog",
        "source_detail": rec.source,
    }


def project_thresholds(
    forecast: list[dict], ctx: ProjectionContext, current: Evaluation, rule, version,
) -> tuple[dict, dict]:
    """Proyecta el pronóstico contra el motor de alertas y arma la recomendación preventiva.

    Añade a cada día `projected_state` (estado que daría el motor al valor esperado),
    `worst_state_80/95` (peor estado que alcanza cada banda) e `interval_touches_threshold` (la
    banda del 95 % llega a un estado peor que el del valor esperado). `current` es la evaluación
    del último valor observado. Devuelve (threshold_projection, recommendation).
    """
    first_expected = None
    first_possible = None
    for point in forecast:
        expected = _crossing(ctx, evaluate_level(ctx, point["value"]))
        state = expected["state"] if expected else "NORMAL"
        c80 = _band_crossing(ctx, point["lower_80"], point["upper_80"])
        c95 = _band_crossing(ctx, point["lower_95"], point["upper_95"])
        point["projected_state"] = state
        point["worst_state_80"] = c80["state"] if c80 else "NORMAL"
        point["worst_state_95"] = c95["state"] if c95 else "NORMAL"
        point["interval_touches_threshold"] = _STATE_SEVERITY[point["worst_state_95"]] > _STATE_SEVERITY[state]
        when = {"date": point["date"], "days_ahead": point["t_ahead"]}
        if first_expected is None and expected is not None:
            first_expected = {**when, **expected, "basis": "expected_value"}
        if first_possible is None and first_expected is None and c80 is not None:
            first_possible = {**when, **c80, "basis": "interval_80"}
    for point in forecast:
        point.pop("t_ahead", None)

    th = ctx.thresholds
    now = _crossing(ctx, current)
    projection = {
        "rule_code": rule.rule_code,
        "rule_version": version.version_number,
        "protocol_source": version.protocol_source,
        "ranges": {
            "normal": [th.normal_min, th.normal_max],
            "monitor": [th.monitor_min, th.monitor_max],
            "warning": [th.warning_min, th.warning_max],
            **_personal_ranges(ctx),
        },
        "current_state": now["state"] if now else "NORMAL",
        "first_expected_crossing": first_expected,
        "first_possible_crossing": first_possible,
    }

    if now is not None:
        basis, target = "currently_out_of_range", {**now, "date": None, "days_ahead": 0}
    elif first_expected is not None:
        basis, target = "expected_crossing", first_expected
    elif first_possible is not None:
        basis, target = "possible_crossing", first_possible
    else:
        basis, target = "none", None
    recommendation = {
        "basis": basis,
        "state": target["state"] if target else None,
        "direction": target["direction"] if target else None,
        "threshold": target["threshold"] if target else None,
        "reference": target["reference"] if target else None,
        "alert_direction": target["alert_direction"] if target else None,
        "date": target["date"] if target else None,
        "days_ahead": target["days_ahead"] if target else None,
        "text": None,
        "immediate_action": None,
        "source": None,
        "source_detail": None,
        "rule_code": rule.rule_code,
        "rule_version": version.version_number,
    }
    if target is not None:
        recommendation.update(_recommendation_texts(ctx, version, target, out_now=now is not None))
    return projection, recommendation


# ============================================================================
# Acceso a datos
# ============================================================================

def _utc(dt: datetime) -> datetime:
    """Treat naive database timestamps as UTC (SQLite compatibility)."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _z_band(z: float) -> str:
    az = abs(z)
    if az < 1:
        return "within_baseline"
    if az < 2:
        return "mild_deviation"
    if az < 3:
        return "moderate_deviation"
    return "strong_deviation"


def _baseline_status(baseline: HealthBaseline | None) -> str:
    """Estado de la línea base personal, con el mismo criterio que el motor de alertas.

    Solo `available_unverified` permite calcular z (equivale a `rules.evaluation.is_valid_std_dev`):
    - `invalid_std_dev`: DE ausente, no finita o ≤ 0 (el seed demo pone 0.0 a los indicadores cuya
      DE no se puede derivar del dataset).
    - `placeholder_std_dev`: DE de relleno (`rules.calibration.is_placeholder_std_dev`: el valor por
      defecto del modelo, 5.0, o el 4.0 que ponía el seed demo a las líneas base simuladas).
    """
    if baseline is None:
        return "missing"
    if baseline.baseline_value is None or not isfinite(baseline.baseline_value):
        return "invalid_baseline"
    if baseline.std_dev is None or not isfinite(baseline.std_dev) or baseline.std_dev <= 0:
        return "invalid_std_dev"
    if is_placeholder_std_dev(baseline.std_dev, bool(baseline.is_simulated)):
        return "placeholder_std_dev"
    return "available_unverified"  # DE utilizable; su origen no está verificado


def _valid_measurement(m: HealthMeasurement, indicator: HealthIndicatorDefinition) -> bool:
    return (
        m.phase_code not in EXCLUDED_PHASES
        and m.data_quality in VALID_QUALITIES
        and m.calculated_state != "INVALID"
        and m.value is not None
        and isfinite(m.value)
        and indicator.min_valid_value <= m.value <= indicator.max_valid_value
        and m.measured_at is not None
        and m.unit == indicator.unit
    )


def _latest_segment(measurements: list[HealthMeasurement]) -> list[HealthMeasurement]:
    """Find the last uninterrupted run of the same phase/environment.

    Invalid measurements were already excluded. Gaps in calendar days are allowed
    (the model weights by elapsed days); a change of context breaks the segment.
    """
    if not measurements:
        return []
    key = (measurements[-1].phase_code, measurements[-1].environment_code)
    start = len(measurements) - 1
    while start >= 0 and (measurements[start].phase_code, measurements[start].environment_code) == key:
        start -= 1
    return measurements[start + 1:]


def _daily_series(measurements: list[HealthMeasurement]) -> tuple[list[date], list[float]]:
    buckets: dict[date, list[float]] = defaultdict(list)
    for m in measurements:
        buckets[_utc(m.measured_at).date()].append(float(m.value))
    days = sorted(buckets)
    return days, [float(median(buckets[d])) for d in days]


def _method_info(model_used: str | None = None) -> dict:
    return {
        "code": METHOD_CODE,
        "description": METHOD_DESCRIPTION,
        "model_used": model_used,  # "level" (pronóstico plano) o "trend" (recta extrapolada)
        "level_alpha": LEVEL_ALPHA,
        "level_half_life_days": round(log(0.5) / log(1 - LEVEL_ALPHA), 1),
        "trend_window_days": TREND_WINDOW_DAYS,
        "trend_alpha": TREND_ALPHA,
        "interval_levels": list(INTERVAL_LEVELS),
        "min_days": MIN_DAYS,
    }


def _empirical_validation(indicator_code: str) -> dict:
    validated = indicator_code in VALIDATED_INDICATORS
    return {
        "validated_with_real_data": validated,
        "dataset": VALIDATION_DATASET if validated else None,
        "is_spaceflight_data": False,
        "note": VALIDATION_NOTE_VALIDATED if validated else VALIDATION_NOTE_NOT_VALIDATED,
    }


def predict_indicator(
    db: Session,
    astronaut_id: int,
    mission_id: int,
    indicator_code: str,
    horizon_days: int,
    include_simulated: bool = True,
    now: datetime | None = None,
) -> PredictionResult:
    """Predict the next 1–14 UTC days for the latest compatible observation segment.

    `include_simulated=True` accepts both real and simulated observations. For
    production use, pass False to restrict to real observations. Mixed real and
    simulated series are NOT separated by this contract; callers must ensure
    their provenance is suitable for the intended analysis.

    If `now` is None, the history window is anchored to the newest measurement
    (supports historical seed data). With `now`, only data at/before that UTC
    instant are considered, and the window is anchored to that instant.

    Estados: `ok` (pronóstico con bandas), `insufficient_data` (menos de `MIN_DAYS` días),
    `model_not_reliable` (el método no mejora a repetir el último valor en la validación dentro de la
    serie, o no hay comparaciones suficientes), `not_assigned`, `unknown_indicator`.
    """
    if type(horizon_days) is not int or not 1 <= horizon_days <= MAX_HORIZON:
        raise ValueError("horizon_days must be an integer between 1 and 14")
    if now is not None and not isinstance(now, datetime):
        raise ValueError("now must be a datetime or None")

    result = PredictionResult(status="insufficient_data", indicator_code=indicator_code)
    assigned = db.query(MissionAssignment.id).filter(
        MissionAssignment.user_id == astronaut_id,
        MissionAssignment.mission_id == mission_id,
        MissionAssignment.is_active.is_(True),
        MissionAssignment.assignment_role == "ASTRONAUT",
    ).first()
    if assigned is None:
        result.status = "not_assigned"
        return result

    indicator = db.query(HealthIndicatorDefinition).filter(
        HealthIndicatorDefinition.code == indicator_code
    ).first()
    if indicator is None:
        result.status = "unknown_indicator"
        return result
    result.unit = indicator.unit
    result.method = _method_info()
    result.empirical_validation = _empirical_validation(indicator_code)

    baseline = db.query(HealthBaseline).filter(
        HealthBaseline.astronaut_id == astronaut_id,
        HealthBaseline.indicator_code == indicator_code,
    ).first()
    result.baseline_status = _baseline_status(baseline)
    personal = baseline_from_row(baseline)
    result.baseline_is_simulated = baseline.is_simulated if baseline is not None else None
    if baseline is not None and result.baseline_status not in ("missing", "invalid_baseline"):
        result.baseline_value = baseline.baseline_value

    # Construct one eligible-measurement query. SQL filtering prevents old or
    # rejected rows from consuming the MAX_ROWS safety limit.
    query = db.query(HealthMeasurement).filter(
        HealthMeasurement.astronaut_id == astronaut_id,
        HealthMeasurement.mission_id == mission_id,
        HealthMeasurement.indicator_code == indicator_code,
        HealthMeasurement.measured_at.isnot(None),
        HealthMeasurement.data_quality.in_(VALID_QUALITIES),
        HealthMeasurement.calculated_state != "INVALID",
        HealthMeasurement.phase_code.notin_(EXCLUDED_PHASES),
        HealthMeasurement.unit == indicator.unit,
        HealthMeasurement.value >= indicator.min_valid_value,
        HealthMeasurement.value <= indicator.max_valid_value,
    )
    if not include_simulated:
        query = query.filter(
            HealthMeasurement.is_simulated.is_(False),
            HealthMeasurement.data_quality == "VALIDATED",
        )

    # An explicit `now` selects a historical as-of window; otherwise anchor
    # to the newest eligible observation so historical missions work.
    if now is not None:
        anchor = _utc(now)
        query = query.filter(HealthMeasurement.measured_at <= anchor)
    else:
        latest = (
            query.order_by(
                HealthMeasurement.measured_at.desc(),
                HealthMeasurement.id.desc(),
            )
            .first()
        )
        if latest is None:
            return result
        anchor = _utc(latest.measured_at)

    cutoff = anchor - timedelta(days=MAX_HISTORY_DAYS)
    query = query.filter(HealthMeasurement.measured_at >= cutoff)
    rows = (
        query.order_by(
            HealthMeasurement.measured_at.desc(),
            HealthMeasurement.id.desc(),
        )
        .limit(MAX_ROWS + 1)
        .all()
    )
    if len(rows) > MAX_ROWS:
        raise ValueError(
            "Too many eligible measurements in the 90-day window; "
            "narrow the analysis window or aggregate high-frequency data first"
        )
    if not rows:
        return result

    valid = [
        measurement for measurement in reversed(rows)
        if _valid_measurement(measurement, indicator)
    ]
    segment = _latest_segment(valid)
    if not segment:
        return result
    result.phase_code = segment[-1].phase_code
    result.environment_code = segment[-1].environment_code
    dates, values = _daily_series(segment)
    result.n_days = len(dates)
    if len(dates) < MIN_DAYS:
        return result

    xs = [(d - dates[0]).days for d in dates]
    series = forecast_series(xs, values, horizon_days)
    if not all(isfinite(p[key]) for p in series["points"] for key in p if key != "h"):
        result.status = "model_not_reliable"
        return result

    result.method = _method_info(series["model"])
    result.trend = series["trend"]
    result.beta0, result.beta1 = series["beta0"], series["beta1"]
    result.mae_ols, result.mae_naive = series["mae_model"], series["mae_naive"]
    validation = series["validation"]
    result.reliability = {
        "criterion": "rolling_origin_skill_vs_last_value",
        "reliable": series["status"] == "ok",
        "skill_vs_naive": series["skill_vs_naive"],
        "mae_model": series["mae_model"],
        "mae_naive": series["mae_naive"],
        "mae_level": validation["mae_level"],
        "mae_trend": validation["mae_trend"],
        "n_comparisons": validation["n_comparisons"],
        "max_step_days": VALIDATION_MAX_STEP_DAYS,
    }
    if series["status"] != "ok":
        result.status = "model_not_reliable"
        return result

    # z como lo calcula el motor de alertas: None sin una DE real (ausente, ≤ 0 o de relleno)
    scale = personal_scale(indicator_code, personal)
    for point in series["points"]:
        h, value = point["h"], point["value"]
        z = band = direction = None
        if scale is not None:
            z = (value - scale[0]) / scale[1]
            if isfinite(z):
                band = _z_band(z)
                direction = "above" if z > 0 else "below" if z < 0 else "at_baseline"
            else:
                z = None
        result.forecast.append({
            "date": (dates[-1] + timedelta(days=h)).isoformat(),
            "t": xs[-1] + h,
            "value": value,
            "out_of_valid_range": not (indicator.min_valid_value <= value <= indicator.max_valid_value),
            "z_score": z,
            "z_band": band,
            "direction": direction,
            "lower_80": point["lower_80"],
            "upper_80": point["upper_80"],
            "lower_95": point["lower_95"],
            "upper_95": point["upper_95"],
            "baseline_delta": value - result.baseline_value if result.baseline_value is not None else None,
            "projected_state": None,
            "worst_state_80": None,
            "worst_state_95": None,
            "interval_touches_threshold": None,
            "t_ahead": h,
        })
    result.z_score = result.forecast[-1]["z_score"]
    result.z_band = result.forecast[-1]["z_band"]
    result.direction = result.forecast[-1]["direction"]

    rule, version = get_active_rule_version(db, indicator_code)
    if rule is not None and version is not None:
        ctx = ProjectionContext(
            indicator_code=indicator_code, unit=indicator.unit,
            thresholds=Thresholds.from_version(version), baseline=personal,
        )
        result.threshold_projection, result.recommendation = project_thresholds(
            result.forecast, ctx, evaluate_observed(ctx, xs, values), rule, version
        )
    else:
        for point in result.forecast:
            point.pop("t_ahead", None)
    result.status = "ok"
    return result
