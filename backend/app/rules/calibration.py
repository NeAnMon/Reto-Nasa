"""SEMSA · Reglas · Calibración del motor de alertas con el dataset del proyecto.

Fuente de verdad de los umbrales: repositorio `astronaut-health-dataset`
(`src/astrohealth/alertas.py`, `docs/alertas.md`, `docs/00-RESUMEN.md`, `docs/04-hrp-base-conocimiento.json`
y los CSV de `data/`). Este módulo es solo datos: el motor (`engine.py`) los aplica y el seed
(`database/seed.py`) los vuelca a `ClinicalRule` / `ClinicalRuleVersion`.

Cómo se guardan los umbrales
----------------------------
`ClinicalRuleVersion` guarda tres rangos "dentro de rango" (extremos incluidos), que es también lo que
pinta el frontend:
  - fuera de `warning_*`  → zona roja    (rojo absoluto del dataset → CRITICAL)
  - fuera de `monitor_*`  → zona amarilla (amarillo absoluto del dataset → WARNING o MONITOR según la persona)
  - fuera de `normal_*`   → banda de observación (MONITOR); solo la conservan los indicadores sin regla
    en el dataset. En los calibrados, `normal_*` es igual a `monitor_*`.
El dataset dispara con comparación inclusiva (p. ej. pulso ≥ 100). Aquí se guarda el último valor dentro
de rango a la resolución de la medición (pulso 99, temperatura 37,7 °C), de modo que "valor > 99" equivale
a "valor ≥ 100" para lecturas enteras. Una dirección sin umbral en el dataset se guarda con el límite
físico de validación del indicador (inalcanzable): el frontend no la pinta.

Honestidad sobre la procedencia
-------------------------------
`verified=True` solo cuando el dataset marca la cifra como verificada en su auditoría. Los cortes clínicos
generales (AHA/ACC, taquicardia, fiebre…) están en el dataset como `verificado=False` y aquí se anotan igual.
`dataset_backed=False` significa que el dataset no ofrece base para ese umbral: se conserva el valor previo
y se rotula "sin respaldo en el dataset".

Pisos de seguridad: donde el dataset tiene regla para el indicador pero no para una dirección peligrosa, se
conserva el corte de 1.0-DEMO rotulado "sin respaldo en el dataset" en vez de dejarla sin alerta: frecuencia
respiratoria baja (< 9 amarillo, < 8 rojo) y sistólica baja crítica (< 80 rojo). No se conservan la diastólica
baja, la temperatura 35,0–36,0 °C ni el sueño excesivo: eran la fuente de las falsas alarmas medidas sobre
UTMB y el desvío frente a la línea base personal ya los cubre.

No es un dispositivo médico.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Tuple

# Versión de regla que siembra esta calibración (una versión nueva deja de ser `is_current` la anterior).
CALIBRATION_VERSION = "2.0-DATASET"
LEGACY_DEMO_VERSION = "1.0-DEMO"
CALIBRATION_APPROVED_BY = "Equipo SEMSA · calibración con astronaut-health-dataset (no clínica)"
CALIBRATION_CHANGE_SUMMARY = (
    "Recalibración del motor de alertas con el dataset del proyecto (astronaut-health-dataset): umbrales "
    "absolutos de alertas.py, desvío frente a la línea base personal (z) y procedencia por umbral."
)

# Capa 2 del dataset: desvío frente a la línea base personal (alertas.py, reglas desvio_*: |z| ≥ 2 / ≥ 3).
Z_YELLOW = 2.0
Z_RED = 3.0
# Un desvío personal amarillo solo pasa a MONITOR si la lectura anterior (dentro de esta ventana) también
# estaba desviada en el mismo sentido. Es la "tendencia persistente" que el motor anterior anunciaba y no
# hacía. Medido sobre UTMB (2 938 sujeto-días): los días con alguna alerta bajan de alrededor de 27 % a
# 17,7 % sin cambiar WARNING ni CRITICAL (lo imprime y lo acota backend/tests/test_alert_calibration.py).
PERSISTENCE_WINDOW_HOURS = 72

# DE de relleno que no cuentan como línea base personal: 5.0 es el valor por defecto del modelo
# (HealthBaseline.std_dev) y 4.0 el que el seed demo ponía a todos los indicadores sin importar la unidad.
MODEL_DEFAULT_STD_DEV = 5.0
LEGACY_SEED_STD_DEV = 4.0

# Radiación: límite de carrera de NASA (HRP, radiation_cancer_2026 p. 43; verificado en el dataset).
RADIATION_CAREER_LIMIT_MSV = 600.0
RADIATION_CUMULATIVE_YELLOW_PCT = 50.0
RADIATION_CUMULATIVE_RED_PCT = 100.0

UNBACKED = "sin respaldo en el dataset"


@dataclass(frozen=True)
class IndicatorCalibration:
    code: str
    # Rangos dentro de rango (extremos incluidos) que se siembran en ClinicalRuleVersion.
    normal: Tuple[float, float]
    monitor: Tuple[float, float]
    warning: Tuple[float, float]
    # Texto corto para ClinicalRuleVersion.protocol_source (máx. 180 caracteres; se muestra en la alerta).
    source: str
    # Procedencia detallada, umbral por umbral (va a ClinicalRuleVersion.change_reason).
    provenance: str
    # ¿Los umbrales absolutos salen de una regla, cifra o distribución del dataset?
    dataset_backed: bool
    # ¿La cifra está marcada como verificada en la auditoría del dataset?
    verified: bool = False
    # Desvío personal como alerta propia: None, "both" (|z|) o "low" (solo z negativo).
    deviation: Optional[str] = None
    # ¿El desvío personal tiene nivel rojo (|z| ≥ 3 → WARNING)? El ánimo solo tiene amarillo en el dataset.
    deviation_red: bool = True
    # DE mínima que usa el dataset al calcular z (build.py, VARS). None = sin piso.
    sd_floor: Optional[float] = None
    # DE para la línea base de la tripulación demo, con su procedencia. None = el dataset no permite
    # derivarla: la línea base se siembra con DE 0 (no válida) y solo aplica la capa absoluta.
    demo_sd: Optional[float] = None
    demo_sd_source: str = ""
    # Valor secundario (diastólica): rangos dentro de rango, piso y DE de referencia.
    secondary_label: Optional[str] = None
    secondary_monitor: Optional[Tuple[float, float]] = None
    secondary_warning: Optional[Tuple[float, float]] = None
    secondary_sd_floor: Optional[float] = None
    secondary_reference_sd: Optional[float] = None
    # Regla sobre la media móvil (sueño): días de ventana y lecturas mínimas.
    rolling_days: Optional[int] = None
    rolling_min_count: Optional[int] = None
    # Tolerancia para el aviso de conflicto entre fuentes (calidad de datos, no es un umbral de alerta).
    source_conflict_delta: Optional[float] = None


def _cal(**kwargs) -> IndicatorCalibration:
    cal = IndicatorCalibration(**kwargs)
    if len(cal.source) > 180:
        raise ValueError(f"protocol_source de {cal.code} supera 180 caracteres ({len(cal.source)})")
    return cal


CALIBRATION: Dict[str, IndicatorCalibration] = {
    c.code: c
    for c in (
        _cal(
            code="HEART_RATE",
            normal=(51.0, 99.0), monitor=(51.0, 99.0), warning=(41.0, 119.0),
            source=(
                "Dataset alertas.py: pulso ≤50/≥100 amarillo, ≤40/≥120 rojo (criterio clínico general, "
                "no verificado); desvío personal |z| ≥2/≥3 (diseño del equipo)"
            ),
            provenance=(
                "Amarillo ≤ 50 y ≥ 100 lpm, rojo ≤ 40 y ≥ 120 lpm: reglas pulso_bajo y pulso_alto de "
                "astronaut-health-dataset/src/astrohealth/alertas.py (criterio clínico general de bradicardia y "
                "taquicardia; verificado=False en el dataset). Desvío personal |z| ≥ 2 amarillo y ≥ 3 rojo: regla "
                "desvio_pulso_lpm (diseño del equipo). DE mínima 6 lpm: build.py del dataset."
            ),
            dataset_backed=True, deviation="both", sd_floor=6.0,
            demo_sd=6.26, demo_sd_source="mediana de las DE personales de pulso en UTMB (29 sujetos, demo_lineas_base.csv)",
            source_conflict_delta=18.0,
        ),
        _cal(
            code="BLOOD_PRESSURE",
            normal=(91.0, 139.0), monitor=(91.0, 139.0), warning=(80.0, 179.0),
            source=(
                "Dataset alertas.py: PAS ≥140/≥180, PAD ≥90/≥120 (AHA/ACC 2017, no verificado), PAS ≤90 "
                "amarillo; |z| ≥2/≥3. PAS <80 rojo: sin respaldo en el dataset (1.0-DEMO, piso de seguridad)"
            ),
            provenance=(
                "Sistólica: amarillo ≥ 140 y rojo ≥ 180 mmHg (regla pa_alta, guía AHA/ACC 2017, verificado=False); "
                "amarillo ≤ 90 mmHg (regla pa_baja, criterio clínico general, verificado=False). El dataset no "
                "define nivel rojo para la sistólica baja: el rojo por debajo de 80 mmHg queda sin respaldo en el "
                "dataset; conservado de 1.0-DEMO como piso de seguridad. "
                "Diastólica: amarillo ≥ 90 y rojo ≥ 120 mmHg (regla pad_alta, AHA/ACC 2017, verificado=False); el "
                "dataset no define diastólica baja, así que deja de alertar por umbral absoluto. Desvío personal "
                "|z| ≥ 2 / ≥ 3 en ambas (reglas desvio_pas_mmhg y desvio_pad_mmhg, diseño del equipo). DE mínima "
                "8 mmHg (PAS) y 6 mmHg (PAD): build.py. La línea base de la app no guarda la DE de la diastólica: "
                "se usa la mediana de las DE personales de UTMB (6,94 mmHg)."
            ),
            dataset_backed=True, deviation="both", sd_floor=8.0,
            demo_sd=8.0, demo_sd_source="mediana de las DE personales de PAS en UTMB (29 sujetos, demo_lineas_base.csv)",
            secondary_label="Presión diastólica",
            secondary_monitor=(30.0, 89.0), secondary_warning=(30.0, 119.0),
            secondary_sd_floor=6.0, secondary_reference_sd=6.94,
            source_conflict_delta=16.0,
        ),
        _cal(
            code="BODY_TEMP",
            normal=(35.0, 37.7), monitor=(35.0, 37.7), warning=(35.0, 37.9),
            source=(
                "Dataset alertas.py: temperatura ≥37,8 °C amarillo, ≥38,0 °C rojo, <35 °C rojo (criterio "
                "clínico general, no verificado); desvío personal |z| ≥2/≥3"
            ),
            provenance=(
                "Amarillo ≥ 37,8 °C y rojo ≥ 38,0 °C (regla fiebre, criterio clínico general, verificado=False); rojo "
                "por debajo de 35 °C sin nivel amarillo (regla hipotermia, verificado=False). Desvío personal |z| ≥ 2 / "
                "≥ 3 (regla desvio_temp_c, diseño del equipo). DE mínima 0,3 °C: build.py."
            ),
            dataset_backed=True, deviation="both", sd_floor=0.3,
            demo_sd=0.30, demo_sd_source="mediana de las DE personales de temperatura en UTMB (27 sujetos, demo_lineas_base.csv)",
            source_conflict_delta=0.7,
        ),
        _cal(
            code="SPO2",
            normal=(95.0, 100.0), monitor=(95.0, 100.0), warning=(92.0, 100.0),
            source=(
                "Dataset alertas.py: SpO₂ <95 % amarillo, <92 % rojo (criterio clínico general, no "
                "verificado; la SpO₂ del dataset es simulada)"
            ),
            provenance=(
                "Amarillo por debajo de 95 % y rojo por debajo de 92 % (regla spo2_baja, criterio clínico general, "
                "verificado=False). La columna spo2_pct_sim del dataset es simulada (97,6 ± 0,7): no calibra el "
                "umbral, solo aporta la DE de la línea base demo."
            ),
            dataset_backed=True,
            demo_sd=0.68, demo_sd_source="mediana de las DE por sujeto de spo2_pct_sim (dato SIMULADO, demo_diario.csv)",
            source_conflict_delta=3.0,
        ),
        _cal(
            code="RESP_RATE",
            normal=(9.0, 20.0), monitor=(9.0, 20.0), warning=(8.0, 23.0),
            source=(
                "Dataset alertas.py: FR >20 rpm amarillo, ≥24 rpm rojo (criterio clínico general, no "
                "verificado). FR <9/<8 rpm: sin respaldo en el dataset (1.0-DEMO, piso de seguridad)"
            ),
            provenance=(
                "Amarillo por encima de 20 rpm y rojo ≥ 24 rpm (regla resp_alta, criterio clínico general, "
                "verificado=False). El dataset no define frecuencia respiratoria baja: el amarillo por debajo de "
                "9 rpm y el rojo por debajo de 8 rpm quedan sin respaldo en el dataset; conservados de 1.0-DEMO como "
                "piso de seguridad (en UTMB no hay ninguna lectura por debajo de 12 rpm). Tampoco define desvío "
                "personal para este indicador: la línea base solo atenúa el amarillo absoluto. DE mínima 1,5 rpm: "
                "build.py."
            ),
            dataset_backed=True, sd_floor=1.5,
            demo_sd=1.50, demo_sd_source="mediana de las DE personales de frecuencia respiratoria en UTMB (29 sujetos)",
            source_conflict_delta=4.0,
        ),
        _cal(
            code="BLOOD_GLUCOSE",
            normal=(70.0, 105.0), monitor=(70.0, 105.0), warning=(60.0, 180.0),
            source=(
                "Dataset demo_laboratorio.csv: rango de referencia i-STAT 70–105 mg/dL (amarillo fuera de "
                "rango); rojo <60/>180 mg/dL sin respaldo en el dataset"
            ),
            provenance=(
                "Amarillo fuera de 70–105 mg/dL: rango de referencia que el laboratorio de UTMB reporta para la "
                "glucosa i-STAT (columna rango_normal de demo_laboratorio.csv, 105 valores, doi:10.83263/rank-k271); "
                "el dataset no tiene regla de alerta de glucosa. Rojo < 60 y > 180 mg/dL: sin respaldo en el dataset, "
                "se conservan los cortes de la versión 1.0-DEMO."
            ),
            dataset_backed=True,
            demo_sd=2.62, demo_sd_source="mediana de las DE por sujeto de la glucosa i-STAT en UTMB (24 sujetos con ≥ 3 tomas)",
            source_conflict_delta=20.0,
        ),
        _cal(
            code="SLEEP_DURATION",
            normal=(6.0, 16.0), monitor=(6.0, 16.0), warning=(5.5, 16.0),
            source=(
                "Dataset alertas.py: media de 7 noches <6,0 h amarillo, <5,5 h rojo (Barger 2014, ISS 6,09 "
                "h/noche verificado; cortes decididos por el equipo)"
            ),
            provenance=(
                "Amarillo si la media de las últimas 7 noches baja de 6,0 h y rojo si baja de 5,5 h (regla "
                "sueno_corto; la cifra de Barger 2014, 6,09 h por noche en la ISS, está verificada; los cortes son "
                "decisión del equipo). Como en el dataset, hacen falta al menos 4 noches en la ventana; con menos, una "
                "noche aislada por debajo de 5,5 h solo queda en observación. El dataset no define sueño excesivo."
            ),
            dataset_backed=True, verified=True,
            demo_sd=0.52, demo_sd_source="mediana de las DE noche a noche por sujeto (actigrafía UTMB, 3 sujetos, 190 noches)",
            rolling_days=7, rolling_min_count=4,
            source_conflict_delta=1.8,
        ),
        _cal(
            code="HYDRATION",
            normal=(2100.0, 3400.0), monitor=(1600.0, 3800.0), warning=(1200.0, 4500.0),
            source="Umbrales sin respaldo en el dataset (no trae series de hidratación): se conservan los de 1.0-DEMO",
            provenance=(
                "Sin respaldo en el dataset: no hay series de hidratación ni un corte en mL/día en la base de "
                "conocimiento HRP. Se conservan los umbrales de la versión 1.0-DEMO. La recomendación sí cita el "
                "riesgo renal y la hidratación como contramedida (NASA HRP)."
            ),
            dataset_backed=False,
            source_conflict_delta=500.0,
        ),
        _cal(
            code="PHYSICAL_ACTIVITY",
            normal=(45.0, 150.0), monitor=(25.0, 180.0), warning=(10.0, 220.0),
            source="Umbrales sin respaldo en el dataset (no trae series de ejercicio): se conservan los de 1.0-DEMO",
            provenance=(
                "Sin respaldo en el dataset: no hay series de ejercicio. La única cifra relacionada es la pauta de la "
                "ISS (1,5 horas al día, 6 a 7 días por semana; NASA HRP, base de conocimiento HRP-R09), que se usa en "
                "la recomendación y no como corte. Se conservan los umbrales de la versión 1.0-DEMO."
            ),
            dataset_backed=False,
            source_conflict_delta=30.0,
        ),
        _cal(
            code="PERCEIVED_FATIGUE",
            normal=(1.0, 4.5), monitor=(1.0, 6.5), warning=(1.0, 7.9),
            source="Umbrales sin respaldo en el dataset (no trae series de fatiga): se conservan los de 1.0-DEMO",
            provenance=(
                "Sin respaldo en el dataset: no hay series de fatiga percibida ni un corte en la base de conocimiento "
                "HRP. Se conservan los umbrales de la versión 1.0-DEMO."
            ),
            dataset_backed=False,
            source_conflict_delta=2.5,
        ),
        _cal(
            code="MOOD_WELLNESS",
            normal=(6.0, 10.0), monitor=(4.5, 10.0), warning=(3.0, 10.0),
            source=(
                "Dataset alertas.py: ánimo z ≤ −2 frente a la línea base (diseño del equipo, dato simulado); "
                "umbrales absolutos sin respaldo en el dataset (1.0-DEMO)"
            ),
            provenance=(
                "Desvío personal z ≤ −2 frente a la línea base, solo amarillo (regla animo_bajo, diseño del equipo "
                "sobre ánimo simulado; DE mínima 0,5). Los umbrales absolutos (6,0 / 4,5 / 3,0) no tienen respaldo en "
                "el dataset y se conservan de la versión 1.0-DEMO."
            ),
            dataset_backed=False, deviation="low", deviation_red=False, sd_floor=0.5,
            demo_sd=0.56, demo_sd_source="mediana de las DE por sujeto de animo_0a10_sim en la fase previa (dato SIMULADO)",
            source_conflict_delta=2.0,
        ),
        _cal(
            code="RADIATION_EXPOSURE",
            normal=(0.0, 0.85), monitor=(0.0, 1.5), warning=(0.0, 2.5),
            source=(
                "Dataset alertas.py: dosis acumulada ≥50 %/≥100 % del límite de carrera de 600 mSv (NASA HRP, "
                "verificado); cortes de dosis diaria sin respaldo en el dataset"
            ),
            provenance=(
                "Dosis acumulada registrada ≥ 50 % (amarillo) y ≥ 100 % (rojo) del límite de carrera de 600 mSv: "
                "regla radiacion_acumulada (límite verificado en NASA HRP radiation_cancer_2026 p. 43; los cortes son "
                "decisión del equipo). Los cortes de dosis diaria (0,85 / 1,5 / 2,5 mSv/día) no tienen respaldo en el "
                "dataset y se conservan de la versión 1.0-DEMO; el dataset solo aporta la referencia de ~0,2–0,5 "
                "mSv/día en la ISS (Shavers 2023)."
            ),
            dataset_backed=True, verified=True,
            source_conflict_delta=0.6,
        ),
    )
}


def get_calibration(indicator_code: str) -> Optional[IndicatorCalibration]:
    return CALIBRATION.get(indicator_code)


def is_placeholder_std_dev(std_dev: Optional[float], is_simulated: bool = False) -> bool:
    """DE de relleno: el valor por defecto del modelo (5.0) o el 4.0 que ponía el seed demo."""
    if std_dev is None:
        return True
    if std_dev == MODEL_DEFAULT_STD_DEV:
        return True
    return bool(is_simulated) and std_dev == LEGACY_SEED_STD_DEV


def demo_std_dev(indicator_code: str) -> float:
    """DE para la línea base de la tripulación demo; 0.0 (no válida) si el dataset no permite derivarla."""
    cal = CALIBRATION.get(indicator_code)
    return float(cal.demo_sd) if cal and cal.demo_sd else 0.0
