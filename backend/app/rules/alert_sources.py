"""SEMSA · Reglas · Motor de origen de cada alerta (issue #30).

Todas las alertas viven en la misma tabla `alerts` y se listan en `GET /alerts`. El motor que la generó
se deduce del prefijo de `rule_code` y, para la radiación, de `indicator_code` (no hace falta columna nueva
ni migración):

  RULES        reglas clínicas calibradas sobre mediciones (`rules/engine.py`): RULE_<INDICADOR>_DEMO, ...
  RADIATION    radiación: alertas del motor de reglas o del entorno cuyo `indicator_code` empieza por
               RADIATION (dosis personal `RADIATION_EXPOSURE` y tasa de dosis ambiental `RADIATION_DOSE`)
  PREDICTION   pronóstico que cruza un umbral del motor calibrado (`rules/prediction_alerts.py`): RULE_PREDICTION_*
  COGNITIVE    actividades cognitivas (`services/cognitive_engine.py`): RULE_COGNITIVE_*
  EMOTIONAL    cuestionario emocional (`services/emotional_engine.py`): RULE_EMOTIONAL_*
  ISOLATION    aislamiento / "Contacto con Tierra" (`rules/early_warnings.py`): RULE_EARLY_*
  ENVIRONMENT  entorno de la misión (`rules/environment_alerts.py`): RULE_ENVIRONMENT_* (salvo radiación)
  SUPPORT      solicitud de apoyo urgente del Communication Center (`api/v1/expansion_router.py`): RULE_SUPPORT_REQUEST_*

Una regla que no encaja en ningún prefijo es del motor de reglas (RULES), que es el que crea las reglas
clínicas por indicador. La alerta temprana del pronóstico sobre la dosis de radiación sigue siendo
PREDICTION (es una proyección, no una lectura).
"""
from __future__ import annotations

from typing import Dict, Optional, Tuple

from sqlalchemy import and_, not_, or_

ENGINE_RULES = "RULES"
ENGINE_RADIATION = "RADIATION"
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
# Radiación: indicador con este prefijo en una alerta que, por su regla, sería de uno de estos motores
RADIATION_INDICATOR_PREFIX = "RADIATION"
RADIATION_BASE_ENGINES: Tuple[str, ...] = (ENGINE_RULES, ENGINE_ENVIRONMENT)
SOURCE_ENGINES: Tuple[str, ...] = (ENGINE_RULES, ENGINE_RADIATION, *ENGINE_RULE_PREFIXES)

# Alertas tempranas: avisan antes de que el valor real (o el bienestar) salga de rango.
EARLY_WARNING_PREFIXES: Tuple[str, ...] = ("RULE_EARLY_", "RULE_PREDICTION_")


def _rule_engine(rule_code: Optional[str]) -> str:
    code = str(rule_code or "")
    for engine, prefixes in ENGINE_RULE_PREFIXES.items():
        if code.startswith(prefixes):
            return engine
    return ENGINE_RULES


def alert_source_engine(rule_code: Optional[str], indicator_code: Optional[str] = None) -> str:
    engine = _rule_engine(rule_code)
    if engine in RADIATION_BASE_ENGINES and str(indicator_code or "").startswith(RADIATION_INDICATOR_PREFIX):
        return ENGINE_RADIATION
    return engine


def is_early_warning_alert(rule_code: Optional[str]) -> bool:
    return str(rule_code or "").startswith(EARLY_WARNING_PREFIXES)


def _rule_engine_clause(rule_code_column, engine: str):
    if engine == ENGINE_RULES:
        every = [p for prefixes in ENGINE_RULE_PREFIXES.values() for p in prefixes]
        return and_(*[not_(rule_code_column.like(f"{p}%")) for p in every])
    prefixes = ENGINE_RULE_PREFIXES[engine]
    return or_(*[rule_code_column.like(f"{p}%") for p in prefixes])


def source_engine_clause(rule_code_column, engine: str, indicator_code_column):
    """Condición SQL equivalente a `alert_source_engine(rule_code, indicator_code) == engine`."""
    is_radiation = indicator_code_column.like(f"{RADIATION_INDICATOR_PREFIX}%")
    if engine == ENGINE_RADIATION:
        return and_(is_radiation, or_(*[_rule_engine_clause(rule_code_column, e) for e in RADIATION_BASE_ENGINES]))
    clause = _rule_engine_clause(rule_code_column, engine)
    if engine in RADIATION_BASE_ENGINES:
        return and_(clause, not_(is_radiation))
    return clause
