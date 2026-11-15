"""SEMSA · Reglas · Evaluación pura de una lectura (sin base de datos).

`evaluate_reading` recibe el valor, los umbrales de la versión de regla y el contexto personal
(línea base, lectura anterior, ventana de sueño, dosis acumulada) y devuelve el estado, los motivos
y la dirección de la alerta. La usan el motor con BD (`engine.evaluate_measurement`), los seeds y la
prueba de calibración con datos reales (`backend/tests/test_alert_calibration.py`).

Dos capas, como el motor de referencia del dataset (`astronaut-health-dataset/src/astrohealth/alertas.py`):
  1. Umbral absoluto (seguridad).
  2. Desvío frente a la línea base personal: z = (valor − media) / DE de la persona.

Criterio de severidad
  - CRITICAL: zona roja absoluta. Nunca se retrasa ni se atenúa.
  - WARNING : zona amarilla absoluta que además se aleja de la línea base personal (z ≥ 2 en el mismo
              sentido) o sin línea base válida; o desvío personal rojo (|z| ≥ 3).
  - MONITOR : zona amarilla absoluta pero habitual para la persona; desvío personal amarillo (|z| ≥ 2)
              confirmado por la lectura anterior; o banda de observación de un indicador sin regla en
              el dataset.
  - NORMAL  : el resto. Un desvío personal amarillo aislado queda anotado como pendiente de confirmar.

Una DE ausente, ≤ 0 o de relleno no cuenta como línea base válida: solo se aplica la capa absoluta.

No es un dispositivo médico.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from math import isfinite, sqrt
from typing import List, Optional, Tuple

from backend.app.rules.calibration import (
    CALIBRATION_VERSION,
    RADIATION_CAREER_LIMIT_MSV,
    RADIATION_CUMULATIVE_RED_PCT,
    RADIATION_CUMULATIVE_YELLOW_PCT,
    Z_RED,
    Z_YELLOW,
    IndicatorCalibration,
    get_calibration,
    is_placeholder_std_dev,
)
from backend.app.rules.recommendations import CUMULATIVE, HIGH, LOW, PERSONAL

STATE_RANK = {"NORMAL": 0, "MONITOR": 1, "WARNING": 2, "CRITICAL": 3}

# Nivel de la capa absoluta
ABS_NONE, ABS_OBSERVE, ABS_YELLOW, ABS_RED = 0, 1, 2, 3

# Límites de validez de la diastólica (los mismos que aplicaba el motor anterior)
DIASTOLIC_MIN_VALID = 30.0
DIASTOLIC_MAX_VALID = 160.0


@dataclass(frozen=True)
class Thresholds:
    """Rangos dentro de rango (extremos incluidos) de una versión de regla."""

    normal_min: float
    normal_max: float
    monitor_min: float
    monitor_max: float
    warning_min: float
    warning_max: float

    @classmethod
    def from_version(cls, version) -> "Thresholds":
        return cls(
            normal_min=version.normal_min, normal_max=version.normal_max,
            monitor_min=version.monitor_min, monitor_max=version.monitor_max,
            warning_min=version.warning_min, warning_max=version.warning_max,
        )

    @classmethod
    def from_calibration(cls, cal: IndicatorCalibration) -> "Thresholds":
        return cls(
            normal_min=cal.normal[0], normal_max=cal.normal[1],
            monitor_min=cal.monitor[0], monitor_max=cal.monitor[1],
            warning_min=cal.warning[0], warning_max=cal.warning[1],
        )


@dataclass(frozen=True)
class PersonalBaseline:
    mean: Optional[float]
    sd: Optional[float]
    secondary_mean: Optional[float] = None
    secondary_sd: Optional[float] = None
    is_simulated: bool = False


@dataclass(frozen=True)
class PreviousReading:
    """Lectura válida anterior del mismo indicador, dentro de la ventana de persistencia."""

    value: float
    secondary_value: Optional[float] = None


@dataclass(frozen=True)
class RollingWindow:
    """Media de las lecturas de la ventana móvil, incluida la lectura que se evalúa."""

    mean: float
    count: int


@dataclass
class Evaluation:
    state: str
    reasons: List[str] = field(default_factory=list)
    direction: Optional[str] = None       # HIGH / LOW / PERSONAL / CUMULATIVE (None si NORMAL o INVALID)
    component: Optional[str] = None       # PRIMARY / SECONDARY / CUMULATIVE
    absolute_level: int = ABS_NONE        # peor nivel de la capa absoluta
    z: Optional[float] = None             # z del valor principal (None sin línea base válida)
    z_secondary: Optional[float] = None
    baseline_valid: bool = False
    pending_confirmation: bool = False    # desvío personal amarillo aislado, a la espera de otra lectura


def num(x: float) -> str:
    """Número compacto para los motivos (máx. 2 decimales, sin ceros de relleno)."""
    return f"{round(float(x), 2):g}"


def is_valid_std_dev(std_dev: Optional[float], is_simulated: bool = False) -> bool:
    if std_dev is None:
        return False
    try:
        sd = float(std_dev)
    except (TypeError, ValueError):
        return False
    return isfinite(sd) and sd > 0 and not is_placeholder_std_dev(sd, is_simulated)


def _absolute_level(value: float, th: Thresholds) -> Tuple[int, Optional[str]]:
    if value < th.warning_min:
        return ABS_RED, LOW
    if value > th.warning_max:
        return ABS_RED, HIGH
    if value < th.monitor_min:
        return ABS_YELLOW, LOW
    if value > th.monitor_max:
        return ABS_YELLOW, HIGH
    if value < th.normal_min:
        return ABS_OBSERVE, LOW
    if value > th.normal_max:
        return ABS_OBSERVE, HIGH
    return ABS_NONE, None


@dataclass
class _Component:
    state: str = "NORMAL"
    direction: Optional[str] = None
    reasons: List[str] = field(default_factory=list)
    level: int = ABS_NONE
    z: Optional[float] = None
    pending: bool = False


def _evaluate_component(
    *,
    label: str,
    value: float,
    unit: str,
    th: Thresholds,
    mean: Optional[float],
    sd: Optional[float],
    deviation: Optional[str],
    deviation_red: bool,
    previous_value: Optional[float],
    rule_label: str,
) -> _Component:
    out = _Component()
    vu = f"{num(value)} {unit}".strip()
    out.level, abs_dir = _absolute_level(value, th)
    if mean is not None and sd is not None and sd > 0:
        out.z = (value - mean) / sd
    z = out.z
    base_txt = f"{num(mean)} ± {num(sd)} {unit}".strip() if z is not None else ""

    # Capa 1: umbral absoluto
    if out.level == ABS_RED:
        out.state, out.direction = "CRITICAL", abs_dir
        out.reasons.append(
            f"{label} {vu} supera el umbral crítico del protocolo {rule_label} "
            f"[{num(th.warning_min)} - {num(th.warning_max)}]."
        )
    elif out.level == ABS_YELLOW:
        out.direction = abs_dir
        out.reasons.append(
            f"{label} {vu} requiere seguimiento según protocolo {rule_label} "
            f"[{num(th.monitor_min)} - {num(th.monitor_max)}]."
        )
        if z is None:
            out.state = "WARNING"
            out.reasons.append(f"{label} {vu}: sin línea base personal válida, se aplica solo el umbral absoluto.")
        elif (abs_dir == HIGH and z >= Z_YELLOW) or (abs_dir == LOW and z <= -Z_YELLOW):
            out.state = "WARNING"
            out.reasons.append(
                f"{label} {vu}: además se aleja de la línea base personal (z = {z:+.1f}; línea base {base_txt})."
            )
        else:
            out.state = "MONITOR"
            out.reasons.append(
                f"{label} {vu}: es habitual para esta persona (z = {z:+.1f}; línea base {base_txt}) y queda en observación."
            )
    elif out.level == ABS_OBSERVE:
        out.state, out.direction = "MONITOR", abs_dir
        out.reasons.append(
            f"{label} {vu} fuera del rango habitual de referencia [{num(th.normal_min)} - {num(th.normal_max)}]."
        )

    # Capa 2: desvío frente a la línea base personal
    if z is not None and deviation:
        applies = deviation == "both" or (deviation == "low" and z < 0)
        az = abs(z)
        if applies and az >= Z_YELLOW:
            if az >= Z_RED and deviation_red:
                if STATE_RANK[out.state] < STATE_RANK["WARNING"]:
                    out.state, out.direction = "WARNING", PERSONAL
                    out.reasons.append(
                        f"{label} {vu}: desvío fuerte frente a la línea base personal "
                        f"({base_txt}; z = {z:+.1f}; umbral |z| ≥ {num(Z_RED)})."
                    )
            elif STATE_RANK[out.state] < STATE_RANK["MONITOR"]:
                prev_z = (previous_value - mean) / sd if previous_value is not None else None
                confirmed = prev_z is not None and (
                    (z > 0 and prev_z >= Z_YELLOW) or (z < 0 and prev_z <= -Z_YELLOW)
                )
                if confirmed:
                    out.state, out.direction = "MONITOR", PERSONAL
                    out.reasons.append(
                        f"{label} {vu}: desvío frente a la línea base personal confirmado en dos lecturas seguidas "
                        f"({base_txt}; z = {z:+.1f}; umbral |z| ≥ {num(Z_YELLOW)})."
                    )
                else:
                    out.pending = True
                    out.reasons.append(
                        f"{label} {vu}: desvío aislado frente a la línea base personal (z = {z:+.1f}); "
                        "queda pendiente de confirmar con la próxima lectura."
                    )
    return out


def validity_reason(
    indicator_code: str,
    value: Optional[float],
    secondary_value: Optional[float],
    unit: str,
    min_valid: Optional[float],
    max_valid: Optional[float],
) -> Optional[str]:
    """Motivo por el que la lectura es INVALID, o None si es válida."""
    if value is None or not isfinite(value):
        return "Valor no numérico: la medición no se puede evaluar."
    if (min_valid is not None and value < min_valid) or (max_valid is not None and value > max_valid):
        return (
            f"Valor ({num(value)} {unit}) fuera de los límites físicos de validación "
            f"[{num(min_valid if min_valid is not None else value)} - {num(max_valid if max_valid is not None else value)}]."
        )
    if indicator_code == "BLOOD_PRESSURE" and secondary_value is not None:
        if (
            not isfinite(secondary_value)
            or secondary_value < DIASTOLIC_MIN_VALID
            or secondary_value > DIASTOLIC_MAX_VALID
            or secondary_value >= value
        ):
            return f"Presión diastólica ({num(secondary_value)} mmHg) inválida respecto a sistólica ({num(value)} mmHg)."
    return None


def evaluate_reading(
    indicator_code: str,
    value: float,
    secondary_value: Optional[float] = None,
    thresholds: Optional[Thresholds] = None,
    *,
    unit: str = "",
    min_valid: Optional[float] = None,
    max_valid: Optional[float] = None,
    baseline: Optional[PersonalBaseline] = None,
    previous: Optional[PreviousReading] = None,
    window: Optional[RollingWindow] = None,
    cumulative: Optional[float] = None,
    rule_label: Optional[str] = None,
) -> Evaluation:
    """Evalúa una lectura sin tocar la base de datos. Ver el criterio en la cabecera del módulo."""
    cal = get_calibration(indicator_code)
    if thresholds is None:
        if cal is None:
            raise ValueError(f"Sin umbrales para el indicador {indicator_code}")
        thresholds = Thresholds.from_calibration(cal)
    rule_label = rule_label or f"RULE_{indicator_code}_DEMO ({CALIBRATION_VERSION})"

    invalid = validity_reason(indicator_code, value, secondary_value, unit, min_valid, max_valid)
    if invalid:
        return Evaluation(state="INVALID", reasons=[invalid])

    # Línea base personal: solo cuenta con una DE real (ni ausente, ni ≤ 0, ni de relleno)
    mean = sd = sec_mean = sec_sd = None
    if baseline is not None and baseline.mean is not None and isfinite(baseline.mean) and is_valid_std_dev(
        baseline.sd, baseline.is_simulated
    ):
        mean = float(baseline.mean)
        sd = max(float(baseline.sd), (cal.sd_floor if cal and cal.sd_floor else 0.0))
        if cal is not None and baseline.secondary_mean is not None and isfinite(baseline.secondary_mean):
            raw = baseline.secondary_sd if is_valid_std_dev(baseline.secondary_sd) else cal.secondary_reference_sd
            if raw:
                sec_mean = float(baseline.secondary_mean)
                sec_sd = max(float(raw), cal.secondary_sd_floor or 0.0)

    deviation = cal.deviation if cal else None
    deviation_red = cal.deviation_red if cal else True
    notes: List[str] = []
    eval_value, eval_sd = float(value), sd

    # Regla sobre la media móvil (sueño): como en el dataset, hacen falta varias noches
    if cal is not None and cal.rolling_days:
        if window is not None and window.count >= (cal.rolling_min_count or 1):
            eval_value = float(window.mean)
            if sd is not None:
                eval_sd = sd / sqrt(window.count)
            notes.append(
                f"Se evalúa la media de las últimas {window.count} noches ({num(window.mean)} {unit}); "
                f"la última noche fue de {num(value)} {unit}."
            )
        else:
            ev = Evaluation(state="NORMAL", baseline_valid=sd is not None)
            if value < thresholds.warning_min:
                ev.state, ev.direction, ev.component = "MONITOR", LOW, "PRIMARY"
                ev.reasons.append(
                    f"Noche aislada de {num(value)} {unit}, por debajo de {num(thresholds.warning_min)} {unit}: "
                    f"la regla usa la media de {cal.rolling_days} noches y aún hay menos de "
                    f"{cal.rolling_min_count} registros, así que queda en observación."
                )
            else:
                ev.reasons.append(
                    f"Dentro de los límites operativos configurados "
                    f"[{num(thresholds.normal_min)} - {num(thresholds.normal_max)} {unit}]."
                )
                ev.reasons.append(
                    f"Aún hay menos de {cal.rolling_min_count} noches registradas en los últimos "
                    f"{cal.rolling_days} días: la media de sueño se evaluará cuando haya más registros."
                )
            return ev

    primary = _evaluate_component(
        label="Valor", value=eval_value, unit=unit, th=thresholds, mean=mean, sd=eval_sd,
        deviation=deviation, deviation_red=deviation_red,
        previous_value=previous.value if previous is not None else None, rule_label=rule_label,
    )
    ev = Evaluation(
        state=primary.state, reasons=notes + primary.reasons, direction=primary.direction,
        component="PRIMARY" if primary.state != "NORMAL" else None, absolute_level=primary.level,
        z=primary.z, baseline_valid=sd is not None, pending_confirmation=primary.pending,
    )

    # Valor secundario con umbrales propios (diastólica)
    if cal is not None and cal.secondary_monitor and secondary_value is not None:
        sec_th = Thresholds(
            normal_min=cal.secondary_monitor[0], normal_max=cal.secondary_monitor[1],
            monitor_min=cal.secondary_monitor[0], monitor_max=cal.secondary_monitor[1],
            warning_min=cal.secondary_warning[0], warning_max=cal.secondary_warning[1],
        )
        secondary = _evaluate_component(
            label=cal.secondary_label or "Valor secundario", value=float(secondary_value), unit=unit, th=sec_th,
            mean=sec_mean, sd=sec_sd, deviation=deviation, deviation_red=deviation_red,
            previous_value=previous.secondary_value if previous is not None else None, rule_label=rule_label,
        )
        ev.reasons.extend(secondary.reasons)
        ev.z_secondary = secondary.z
        ev.absolute_level = max(ev.absolute_level, secondary.level)
        ev.pending_confirmation = ev.pending_confirmation or secondary.pending
        if STATE_RANK[secondary.state] > STATE_RANK[ev.state]:
            ev.state, ev.direction, ev.component = secondary.state, secondary.direction, "SECONDARY"

    # Dosis acumulada frente al límite de carrera (radiación)
    if indicator_code == "RADIATION_EXPOSURE" and cumulative is not None and isfinite(cumulative):
        pct = cumulative / RADIATION_CAREER_LIMIT_MSV * 100.0
        level = None
        if pct >= RADIATION_CUMULATIVE_RED_PCT:
            level, cut = "CRITICAL", RADIATION_CUMULATIVE_RED_PCT
        elif pct >= RADIATION_CUMULATIVE_YELLOW_PCT:
            level, cut = "WARNING", RADIATION_CUMULATIVE_YELLOW_PCT
        if level:
            ev.reasons.append(
                f"Dosis acumulada registrada de {num(cumulative)} mSv: {num(pct)} % del límite de carrera de "
                f"{num(RADIATION_CAREER_LIMIT_MSV)} mSv (umbral {num(cut)} %)."
            )
            if STATE_RANK[level] > STATE_RANK[ev.state]:
                ev.state, ev.direction, ev.component = level, CUMULATIVE, "CUMULATIVE"
            if level == "CRITICAL":
                ev.absolute_level = ABS_RED

    if ev.state == "NORMAL":
        ev.direction = None
        ev.reasons.insert(
            0,
            f"Dentro de los límites operativos configurados "
            f"[{num(thresholds.normal_min)} - {num(thresholds.normal_max)} {unit}].",
        )
    return ev
