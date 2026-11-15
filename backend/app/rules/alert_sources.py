"""SEMSA · Reglas · Motor de origen de cada alerta (issue #30).

Todas las alertas viven en la misma tabla `alerts` y se listan en `GET /alerts`. El motor que la generó
se deduce del prefijo de `rule_code` (no hace falta columna nueva ni migración):

  RULES        reglas clínicas calibradas sobre mediciones (`rules/engine.py`): RULE_<INDICADOR>_DEMO, ...
  PREDICTION   pronóstico que cruza un umbral del motor calibrado (`rules/prediction_alerts.py`): RULE_PREDICTION_*
  COGNITIVE    actividades cognitivas (`services/cognitive_engine.py`): RULE_COGNITIVE_*
  EMOTIONAL    cuestionario emocional (`services/emotional_engine.py`): RULE_EMOTIONAL_*
  ISOLATION    aislamiento / "Contacto con Tierra" (`rules/early_warnings.py`): RULE_EARLY_*
  ENVIRONMENT  entorno y radiación ambiental de la misión (`rules/environment_alerts.py`): RULE_ENVIRONMENT_*
  SUPPORT      solicitud de apoyo urgente del Communication Center (`api/v1/expansion_router.py`): RULE_SUPPORT_REQUEST_*

Una regla que no encaja en ningún prefijo es del motor de reglas (RULES), que es el que crea las reglas
clínicas por indicador.
"""
from __future__ import annotations

from typing import Dict, Optional, Tuple

from sqlalchemy import and_, not_, or_

ENGINE_RULES = "RULES"
ENGINE_PREDICTION = "PREDICTION"
ENGINE_COGNITIVE = "COGNITIVE"
ENGINE_EMOTIONAL = "EMOTIONAL"
ENGINE_ISOLATION = "ISOLATION"
ENGINE_ENVIRONMENT = "ENVIRONMENT"
ENGINE_SUPPORT = "SUPPORT"

# Prefijo de rule_code → motor (el orden no importa: los prefijos no se solapan)
ENGINE_RULE_PREFIXES: Dict[str, Tuple[str, ...]] = {
    ENGINE_PREDICTION: ("RULE_PREDICTION_",),
    ENGINE_COGNITIVE: ("RULE_COGNITIVE_",),
    ENGINE_EMOTIONAL: ("RULE_EMOTIONAL_",),
    ENGINE_ISOLATION: ("RULE_EARLY_",),
    ENGINE_ENVIRONMENT: ("RULE_ENVIRONMENT_",),
    ENGINE_SUPPORT: ("RULE_SUPPORT_REQUEST_",),
}
SOURCE_ENGINES: Tuple[str, ...] = (ENGINE_RULES, *ENGINE_RULE_PREFIXES)

# Alertas tempranas: avisan antes de que el valor real (o el bienestar) salga de rango.
EARLY_WARNING_PREFIXES: Tuple[str, ...] = ("RULE_EARLY_", "RULE_PREDICTION_")


def alert_source_engine(rule_code: Optional[str]) -> str:
    code = str(rule_code or "")
    for engine, prefixes in ENGINE_RULE_PREFIXES.items():
        if code.startswith(prefixes):
            return engine
    return ENGINE_RULES


def is_early_warning_alert(rule_code: Optional[str]) -> bool:
    return str(rule_code or "").startswith(EARLY_WARNING_PREFIXES)


def source_engine_clause(rule_code_column, engine: str):
    """Condición SQL equivalente a `alert_source_engine(rule_code) == engine`."""
    if engine == ENGINE_RULES:
        every = [p for prefixes in ENGINE_RULE_PREFIXES.values() for p in prefixes]
        return and_(*[not_(rule_code_column.like(f"{p}%")) for p in every])
    prefixes = ENGINE_RULE_PREFIXES[engine]
    return or_(*[rule_code_column.like(f"{p}%") for p in prefixes])
