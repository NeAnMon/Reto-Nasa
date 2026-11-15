"""SEMSA · Reglas · Catálogo de recomendaciones por alerta (indicador × dirección × nivel).

Cada alerta del motor lleva una recomendación concreta para mejorar esa condición:
  - `immediate_action` (qué hacer ahora): dos pasos, el específico del indicador y la dirección, y el del nivel.
  - `followup_recommendation`: cómo mejorar el indicador en los próximos días (contramedida concreta),
    cuándo avisar al médico de vuelo y la fuente.

Redacción a partir de los textos `accion` de `astronaut-health-dataset/src/astrohealth/alertas.py` (reglas
y catálogo de síntomas) y de las contramedidas de la base de conocimiento HRP
(`docs/04-hrp-base-conocimiento.json`). Tono preventivo y sin diagnóstico: SEMSA no es un dispositivo médico
(la nota va en la explicación de cada alerta).

Los textos son fijos (sin valores intercalados) para que el frontend pueda traducirlos al inglés con
`frontend/src/i18n/backend-en-runtime.js`; `frontend/tests/test_frontend_integrity.py` exige la traducción
de cada uno.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Tuple

# Direcciones de una alerta
HIGH = "HIGH"                    # por encima del umbral absoluto
LOW = "LOW"                      # por debajo del umbral absoluto
PERSONAL = "PERSONAL"            # dentro del rango absoluto, pero lejos de la línea base personal
CUMULATIVE = "CUMULATIVE"        # dosis acumulada (radiación)
SOURCE_CONFLICT = "SOURCE_CONFLICT"  # dos fuentes discrepan en pocos minutos
GENERIC = "GENERIC"

# Paso 2 de la acción inmediata, según el nivel
LEVEL_STEP: Dict[str, str] = {
    "MONITOR": "2. Nivel de observación: no necesitas interrumpir tus tareas; vuelve a medir en tu próximo control.",
    "WARNING": "2. Nivel de seguimiento: repite la medición en los próximos 10 minutos y deja constancia en el Centro de Alertas.",
    "CRITICAL": "2. Nivel crítico: suspende la actividad exigente y contacta ahora con el médico de vuelo.",
}

# Texto de reserva para cualquier alerta que llegue sin recomendación (ver models.Alert).
FALLBACK_IMMEDIATE = "Revisa esta alerta en el Centro de Alertas y repite el registro que la originó cuando puedas."
FALLBACK_FOLLOWUP = (
    "Si la situación se mantiene en tu próximo control, coméntala con el médico de vuelo o con tu equipo de apoyo."
)

# Instrucciones genéricas de la versión de regla calibrada (la recomendación concreta va en cada alerta).
RULE_IMMEDIATE_INSTRUCTIONS = (
    "La acción inmediata depende de la dirección y del nivel de cada alerta: consulta la recomendación que "
    "acompaña a la alerta (catálogo de recomendaciones calibrado con el dataset del proyecto)."
)
RULE_FOLLOWUP_INSTRUCTIONS = (
    "Cada alerta indica cómo mejorar el indicador en los próximos días y cuándo avisar al médico de vuelo."
)
RULE_ESCALATION_CONDITIONS = (
    "CRITICAL (zona roja del dataset): aviso inmediato al médico de vuelo. WARNING: avisar si se confirma al "
    "repetir la medición. MONITOR: observación en el próximo control."
)


@dataclass(frozen=True)
class Recommendation:
    now: str        # paso 1 de la acción inmediata
    followup: str   # cómo mejorar + cuándo avisar + fuente
    source: str     # procedencia resumida (para auditoría y pruebas)


def _rec(now: str, improve: str, notify: str, source: str) -> Recommendation:
    return Recommendation(
        now=f"1. {now}",
        followup=f"Para mejorar en los próximos días: {improve} {notify} Fuente: {source}",
        source=source,
    )


SRC_DATASET = "dataset del proyecto (astronaut-health-dataset, alertas.py)"

CATALOG: Dict[Tuple[str, str], Recommendation] = {
    # ------------------------------------------------------------------ Frecuencia cardíaca
    ("HEART_RATE", HIGH): _rec(
        "Siéntate, respira con calma y vuelve a medir el pulso tras 5 minutos de reposo.",
        "mantén la hidratación y el ejercicio pautado, cuida el sueño y registra el pulso en reposo a la misma hora.",
        "Avisa al médico de vuelo si sigue en 100 lpm o más al repetir la medición, y de inmediato si llega a "
        "120 lpm o aparece dolor en el pecho.",
        f"{SRC_DATASET}, regla pulso_alto (criterio clínico general, no verificado) y contramedidas NASA HRP "
        "para las adaptaciones cardiovasculares (ejercicio regular).",
    ),
    ("HEART_RATE", LOW): _rec(
        "Repite la medición en reposo y anota si notas mareo o fatiga: un pulso bajo es habitual en personas entrenadas.",
        "sigue con tu plan de ejercicio y controla el pulso en reposo a diario para confirmar si es tu valor habitual.",
        "Avisa al médico de vuelo si hay mareo, fatiga o desmayo, y de inmediato si el pulso baja a 40 lpm o menos.",
        f"{SRC_DATASET}, regla pulso_bajo (criterio clínico general, no verificado).",
    ),
    ("HEART_RATE", PERSONAL): _rec(
        "Tu pulso está fuera de tu rango habitual: repite la medición en reposo y revisa si tienes síntomas.",
        "revisa el sueño, la hidratación y la carga de ejercicio de las últimas 24 horas y mide el pulso en reposo "
        "a la misma hora para confirmar la tendencia.",
        "Avisa al médico de vuelo si el desvío se mantiene en dos controles seguidos o si aparecen palpitaciones, "
        "mareo o dolor en el pecho.",
        f"{SRC_DATASET}, desvío frente a la línea base personal (diseño del equipo) y NASA HRP, adaptaciones "
        "cardiovasculares.",
    ),
    # ------------------------------------------------------------------ Presión arterial
    ("BLOOD_PRESSURE", HIGH): _rec(
        "Repite la medición tras 5 minutos de reposo, sentado y con el brazalete a la altura del corazón.",
        "mantén el ejercicio pautado, elige las opciones bajas en sodio del menú, cuida el descanso y mide la "
        "presión a la misma hora.",
        "Avisa al médico de vuelo si sigue en 140/90 mmHg o más al repetir la medición, y de inmediato si llega a "
        "180/120 mmHg o aparece dolor en el pecho.",
        f"{SRC_DATASET}, reglas pa_alta y pad_alta (guía AHA/ACC 2017, no verificada) y contramedidas NASA HRP "
        "(ejercicio regular, dieta saludable y reducción del sodio).",
    ),
    ("BLOOD_PRESSURE", LOW): _rec(
        "Siéntate o recuéstate, bebe agua y repite la medición en unos minutos.",
        "aumenta la hidratación, levántate despacio y mantén el ejercicio pautado; antes de volver a un entorno con "
        "gravedad, sigue la pauta de hidratación abundante y usa las prendas de compresión.",
        "Avisa al médico de vuelo si hay mareo o desmayo.",
        f"{SRC_DATASET}, regla pa_baja (criterio clínico general, no verificado) y contramedidas NASA HRP para las "
        "adaptaciones cardiovasculares (hidratación y prendas de compresión).",
    ),
    ("BLOOD_PRESSURE", PERSONAL): _rec(
        "Tu presión arterial está fuera de tu rango habitual: repite la medición en reposo y revisa si tienes síntomas.",
        "revisa la hidratación, el descanso y el sodio de las últimas 24 horas y mide la presión a la misma hora "
        "para confirmar la tendencia.",
        "Avisa al médico de vuelo si el desvío se mantiene en dos controles seguidos o si hay mareo, desmayo o "
        "dolor en el pecho.",
        f"{SRC_DATASET}, desvío frente a la línea base personal (diseño del equipo) y NASA HRP, adaptaciones "
        "cardiovasculares.",
    ),
    # ------------------------------------------------------------------ Temperatura
    ("BODY_TEMP", HIGH): _rec(
        "Registra tus síntomas, bebe agua y repite la medición en 15 minutos, sin líquidos calientes ni ejercicio antes.",
        "descansa, mantén la hidratación y vuelve a medir la temperatura cada pocas horas; anota si hay "
        "escalofríos, tos o sarpullido.",
        "Avisa al médico de vuelo si la temperatura llega a 38,0 °C o si los síntomas empeoran.",
        f"{SRC_DATASET}, regla fiebre (criterio clínico general, no verificado) y NASA HRP, respuestas alteradas "
        "del sistema inmunológico.",
    ),
    ("BODY_TEMP", LOW): _rec(
        "Comprueba el termómetro, abrígate y repite la medición para descartar un error de lectura.",
        "mantente abrigado, revisa la temperatura de la cabina y repite el control con otro termómetro si es posible.",
        "Avisa al médico de vuelo si la temperatura sigue por debajo de 35 °C al repetir la medición.",
        f"{SRC_DATASET}, regla hipotermia (criterio clínico general, no verificado).",
    ),
    ("BODY_TEMP", PERSONAL): _rec(
        "Tu temperatura está fuera de tu rango habitual: repite la medición y revisa si tienes síntomas.",
        "descansa, mantén la hidratación y mide la temperatura a la misma hora y con el mismo termómetro para "
        "confirmar la tendencia.",
        "Avisa al médico de vuelo si el desvío se mantiene en dos controles seguidos o si aparecen escalofríos, "
        "tos o sarpullido.",
        f"{SRC_DATASET}, desvío frente a la línea base personal (diseño del equipo) y NASA HRP, respuestas "
        "alteradas del sistema inmunológico.",
    ),
    # ------------------------------------------------------------------ SpO2
    ("SPO2", LOW): _rec(
        "Revisa la colocación del sensor, mantén la mano quieta y templada y repite la medición.",
        "respira despacio y profundo, revisa el CO₂ y la ventilación de la cabina y evita el esfuerzo hasta repetir "
        "el control.",
        "Avisa al médico de vuelo si sigue por debajo de 95 % al repetir la medición, y de inmediato si baja de "
        "92 % o notas falta de aire.",
        f"{SRC_DATASET}, regla spo2_baja (criterio clínico general, no verificado; la SpO₂ del dataset es "
        "simulada) y NASA HRP, riesgo de hipoxia.",
    ),
    # ------------------------------------------------------------------ Frecuencia respiratoria
    ("RESP_RATE", HIGH): _rec(
        "Descansa unos minutos, mide tu SpO₂ y vuelve a contar las respiraciones durante 60 segundos.",
        "evita el esfuerzo hasta que se normalice, revisa el CO₂ de la cabina y repite el control en reposo.",
        "Avisa al médico de vuelo si sigue por encima de 20 rpm en reposo, y de inmediato si llega a 24 rpm o "
        "notas falta de aire.",
        f"{SRC_DATASET}, regla resp_alta (criterio clínico general, no verificado).",
    ),
    # ------------------------------------------------------------------ Glucosa
    ("BLOOD_GLUCOSE", LOW): _rec(
        "Repite la medición con el analizador y anota la hora de tu última comida.",
        "no te saltes comidas, sigue el menú pautado y mantén el ejercicio: la inactividad prolongada reduce la "
        "captación de glucosa del músculo.",
        "Avisa al médico de vuelo si el valor sigue por debajo de 70 mg/dL al repetir la medición o si notas "
        "debilidad o mareo.",
        "rango de referencia de la glucosa i-STAT en el laboratorio de UTMB (dataset del proyecto; sin regla de "
        "alerta propia en el dataset) y NASA HRP, alimentación y nutrición.",
    ),
    ("BLOOD_GLUCOSE", HIGH): _rec(
        "Repite la medición con el analizador y anota qué comiste y cuándo.",
        "sigue el menú pautado, reparte las comidas y mantén el ejercicio: la inactividad prolongada reduce la "
        "captación de glucosa del músculo.",
        "Avisa al médico de vuelo si el valor sigue por encima de 105 mg/dL en ayunas al repetir la medición.",
        "rango de referencia de la glucosa i-STAT en el laboratorio de UTMB (dataset del proyecto; sin regla de "
        "alerta propia en el dataset) y NASA HRP, alimentación y nutrición.",
    ),
    # ------------------------------------------------------------------ Sueño
    ("SLEEP_DURATION", LOW): _rec(
        "Protege tu horario de sueño de hoy y evita las tareas críticas hasta haber descansado.",
        "acuéstate y levántate a la misma hora, usa la iluminación que simula el ciclo día-noche, evita la cafeína "
        "antes de dormir y reserva un tiempo de relajación al final del día.",
        "Avisa al médico de vuelo si la media de 7 noches baja de 5,5 horas o si la falta de sueño afecta a tus tareas.",
        f"{SRC_DATASET}, regla sueno_corto (media de 7 noches; Barger 2014, cifra verificada) y contramedidas NASA "
        "HRP para el sueño inadecuado y los horarios irregulares.",
    ),
    # ------------------------------------------------------------------ Hidratación
    ("HYDRATION", LOW): _rec(
        "Bebe agua ahora y reparte el resto de tu pauta diaria en tomas regulares.",
        "programa recordatorios de hidratación, lleva la cuenta de las bolsas de bebida y bebe más los días de "
        "ejercicio o de actividad extravehicular.",
        "Avisa al médico de vuelo si no alcanzas tu pauta dos días seguidos o si notas dolor en el costado o "
        "sangre en la orina.",
        "umbral sin respaldo en el dataset (no trae series de hidratación); recomendación basada en NASA HRP "
        "(riesgo renal e hidratación como contramedida cardiovascular).",
    ),
    ("HYDRATION", HIGH): _rec(
        "Revisa el registro por si hay un error de suma y reparte la ingesta a lo largo del día.",
        "vuelve a tu pauta diaria y anota la ingesta toma a toma.",
        "Avisa al médico de vuelo si la ingesta sigue por encima de tu pauta varios días o si notas malestar.",
        "umbral sin respaldo en el dataset (no trae series de hidratación).",
    ),
    # ------------------------------------------------------------------ Actividad física
    ("PHYSICAL_ACTIVITY", LOW): _rec(
        "Programa hoy una sesión de ejercicio autorizado, aunque sea corta, si no tienes una restricción médica u operativa.",
        "recupera de forma progresiva la pauta de ejercicio de resistencia y aeróbico (en la ISS, 1,5 horas al día, "
        "6 a 7 días por semana) y repártela en bloques si la agenda no da para más.",
        "Avisa al médico de vuelo si llevas varios días sin poder entrenar o si el motivo es dolor o una lesión.",
        "umbral sin respaldo en el dataset (no trae series de ejercicio); recomendación basada en NASA HRP "
        "(reducción de la aptitud cardiorrespiratoria y musculoesquelética).",
    ),
    ("PHYSICAL_ACTIVITY", HIGH): _rec(
        "Baja la intensidad por hoy y deja tiempo de recuperación antes de la próxima sesión.",
        "vuelve a la pauta prescrita, alterna días de carga y de recuperación y cuida la hidratación y el sueño.",
        "Avisa al médico de vuelo si hay dolor, una lesión o un cansancio que no cede.",
        "umbral sin respaldo en el dataset (no trae series de ejercicio); recomendación basada en NASA HRP "
        "(reducción de la aptitud cardiorrespiratoria y musculoesquelética).",
    ),
    # ------------------------------------------------------------------ Fatiga
    ("PERCEIVED_FATIGUE", HIGH): _rec(
        "Haz una pausa de recuperación y evita las tareas críticas hasta que te sientas mejor.",
        "protege tu horario de sueño, reparte la carga de trabajo, reserva tiempo de relajación y autocuidado y "
        "mantén el ejercicio pautado.",
        "Avisa al médico de vuelo si la fatiga alta se mantiene dos días seguidos o afecta a tu seguridad en las tareas.",
        "umbral sin respaldo en el dataset (no trae series de fatiga); recomendación basada en NASA HRP (sueño "
        "inadecuado y horarios irregulares).",
    ),
    # ------------------------------------------------------------------ Ánimo
    ("MOOD_WELLNESS", LOW): _rec(
        "Tómate un momento para ti y cuéntale cómo te sientes a alguien de confianza de la tripulación o del equipo de apoyo.",
        "completa el check-in emocional, lleva un diario, reserva tiempo para una actividad que disfrutes y mantén "
        "el contacto con tus seres queridos.",
        "Habla con el equipo de apoyo psicológico si el ánimo bajo se mantiene varios días; si tienes pensamientos "
        "de hacerte daño, habla ya con el médico de vuelo o con el psicólogo.",
        f"{SRC_DATASET}, regla animo_bajo (diseño del equipo sobre datos simulados; umbrales absolutos sin "
        "respaldo en el dataset) y contramedidas NASA HRP para las condiciones conductuales.",
    ),
    # ------------------------------------------------------------------ Radiación
    ("RADIATION_EXPOSURE", HIGH): _rec(
        "Comprueba la lectura del dosímetro y consulta si hay aviso de evento solar; si lo hay, ve al refugio.",
        "limita el tiempo en las zonas menos blindadas, pospón la actividad extravehicular no esencial y revisa tu "
        "dosis acumulada con el equipo de radiación.",
        "Avisa al médico de vuelo si la dosis diaria sigue alta en la próxima lectura.",
        "cortes de dosis diaria sin respaldo en el dataset (referencia: 0,2 a 0,5 mSv al día en la ISS, Shavers "
        f"2023); acción de la regla radiacion_acumulada del {SRC_DATASET} y NASA HRP, cánceres inducidos por radiación.",
    ),
    ("RADIATION_EXPOSURE", CUMULATIVE): _rec(
        "Revisa tu dosis acumulada con el equipo de radiación antes de planificar nuevas exposiciones.",
        "prioriza las zonas mejor blindadas, limita las actividades extravehiculares y ve al refugio ante cualquier "
        "aviso de evento solar.",
        "Avisa al médico de vuelo: tu dosis acumulada registrada ya supera la mitad del límite de carrera de 600 mSv.",
        f"{SRC_DATASET}, regla radiacion_acumulada (límite de carrera de 600 mSv de NASA HRP, cifra verificada; "
        "cortes decididos por el equipo).",
    ),
    # ------------------------------------------------------------------ Genéricas (regla o dirección sin entrada propia)
    (GENERIC, HIGH): _rec(
        "Repite la medición en reposo para confirmar el valor alto.",
        "revisa el descanso, la hidratación y la actividad de las últimas 24 horas y repite el control a la misma hora.",
        "Avisa al médico de vuelo si el valor sigue fuera de rango al repetir la medición.",
        "recomendación general de SEMSA (sin regla específica en el dataset).",
    ),
    (GENERIC, LOW): _rec(
        "Repite la medición en reposo para confirmar el valor bajo.",
        "revisa el descanso, la hidratación y la actividad de las últimas 24 horas y repite el control a la misma hora.",
        "Avisa al médico de vuelo si el valor sigue fuera de rango al repetir la medición.",
        "recomendación general de SEMSA (sin regla específica en el dataset).",
    ),
    (GENERIC, PERSONAL): _rec(
        "El valor está fuera de tu rango habitual: repite la medición y revisa si tienes síntomas.",
        "revisa el descanso, la hidratación y la actividad de las últimas 24 horas y repite el control a la misma hora.",
        "Avisa al médico de vuelo si el desvío se mantiene en dos controles seguidos.",
        f"{SRC_DATASET}, desvío frente a la línea base personal (diseño del equipo).",
    ),
    (GENERIC, SOURCE_CONFLICT): _rec(
        "Dos fuentes dieron valores distintos en pocos minutos: repite la medición con el sensor mejor colocado.",
        "usa siempre el mismo sensor y la misma postura para este indicador y revisa la colocación antes de medir.",
        "Avisa al médico de vuelo si las dos fuentes siguen sin coincidir.",
        "control de calidad de datos de SEMSA (sin regla en el dataset).",
    ),
}

# Una dirección sin entrada propia reutiliza la más cercana del mismo indicador antes de caer en la genérica.
_ALIASES: Dict[Tuple[str, str], Tuple[str, str]] = {
    ("MOOD_WELLNESS", PERSONAL): ("MOOD_WELLNESS", LOW),
    ("SPO2", PERSONAL): ("SPO2", LOW),
    ("RESP_RATE", PERSONAL): ("RESP_RATE", HIGH),
    ("SLEEP_DURATION", PERSONAL): ("SLEEP_DURATION", LOW),
}


def get_recommendation(indicator_code: str, direction: Optional[str]) -> Recommendation:
    direction = direction or HIGH
    key = (indicator_code, direction)
    key = _ALIASES.get(key, key)
    rec = CATALOG.get(key)
    if rec is not None:
        return rec
    if direction == SOURCE_CONFLICT:
        return CATALOG[(GENERIC, SOURCE_CONFLICT)]
    if direction == CUMULATIVE:
        direction = HIGH
    return CATALOG.get((GENERIC, direction), CATALOG[(GENERIC, HIGH)])


def build_alert_texts(indicator_code: str, direction: Optional[str], state: str) -> Tuple[str, str]:
    """(immediate_action, followup_recommendation) de una alerta del motor. Nunca devuelve textos vacíos."""
    rec = get_recommendation(indicator_code, direction)
    level = LEVEL_STEP.get(state, LEVEL_STEP["MONITOR"])
    return f"{rec.now}\n{level}", rec.followup


def ensure_text(text: Optional[str], fallback: str) -> str:
    """Devuelve `text` si tiene contenido; si no, el texto de reserva."""
    return text if text and str(text).strip() else fallback


def all_texts() -> Dict[str, set]:
    """Textos visibles al usuario del catálogo (para la prueba de traducciones)."""
    return {
        "now": {r.now for r in CATALOG.values()},
        "followup": {r.followup for r in CATALOG.values()},
        "level": set(LEVEL_STEP.values()),
        "fixed": {
            FALLBACK_IMMEDIATE, FALLBACK_FOLLOWUP, RULE_IMMEDIATE_INSTRUCTIONS,
            RULE_FOLLOWUP_INSTRUCTIONS, RULE_ESCALATION_CONDITIONS,
        },
    }
