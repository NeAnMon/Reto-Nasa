from typing import Dict, List, Optional
from sqlalchemy.orm import Session

from backend.app.core.config import settings
from backend.app.models.models import (
    Alert,
    EnvironmentProfile,
    HealthBaseline,
    HealthIndicatorDefinition,
    HealthMeasurement,
    WellnessRecommendation,
)


class AssistiveGuidanceService:
    """
    Assistive AI & Rule-Based Educational Guidance Layer (Section 12).
    Operates fully via deterministic rules and structured educational templates
    when no external AI provider is configured.
    Strictly enforces safety guardrails:
    - Never diagnoses diseases.
    - Never presents temporal coincidence/correlation as causality.
    - Never alters clinical thresholds or cancels critical alerts.
    - Never recommends vigorous exercise if an active cardiovascular/respiratory WARNING/CRITICAL alert exists.
    """

    DISCLAIMER = (
        "Aviso Operativo: AstroVital proporciona orientación educativa y preventiva basada en reglas "
        "configuradas (DEMO). No realiza diagnósticos médicos autónomos, no sustituye al personal "
        "sanitario de vuelo y no modifica protocolos clínicos."
    )

    @classmethod
    def explain_indicator_and_trend(
        cls,
        db: Session,
        astronaut_id: int,
        indicator_code: str,
        environment_code: Optional[str] = None,
    ) -> Dict[str, object]:
        defn = (
            db.query(HealthIndicatorDefinition)
            .filter(HealthIndicatorDefinition.code == indicator_code)
            .first()
        )
        if not defn:
            return {
                "indicator_code": indicator_code,
                "mode": "RULE_TEMPLATE_ENGINE",
                "summary": "Indicador no registrado en el catálogo.",
                "disclaimer": cls.DISCLAIMER,
            }

        measurements = (
            db.query(HealthMeasurement)
            .filter(
                HealthMeasurement.astronaut_id == astronaut_id,
                HealthMeasurement.indicator_code == indicator_code,
                HealthMeasurement.calculated_state != "INVALID",
            )
            .order_by(HealthMeasurement.measured_at.desc())
            .limit(10)
            .all()
        )
        baseline = (
            db.query(HealthBaseline)
            .filter(
                HealthBaseline.astronaut_id == astronaut_id,
                HealthBaseline.indicator_code == indicator_code,
            )
            .first()
        )
        env_profile = (
            db.query(EnvironmentProfile)
            .filter(EnvironmentProfile.code == (environment_code or "LOW_EARTH_ORBIT"))
            .first()
        )

        if not measurements:
            return {
                "indicator_code": defn.code,
                "indicator_name": defn.name,
                "mode": "RULE_TEMPLATE_ENGINE",
                "plain_explanation": defn.educational_summary,
                "spaceflight_context": defn.spaceflight_risk_explanation,
                "historical_summary": "Sin mediciones válidas registradas para calcular tendencia.",
                "causality_note": "Se requiere cobertura temporal verificada antes de analizar patrones.",
                "recommended_protocol_action": "Registrar una medición siguiendo el procedimiento guiado en My Health Check.",
                "disclaimer": cls.DISCLAIMER,
            }

        latest = measurements[0]
        values = [m.value for m in reversed(measurements)]
        min_v, max_v = min(values), max(values)
        avg_v = sum(values) / len(values)

        if len(values) >= 2:
            delta_recent = values[-1] - values[0]
            if abs(delta_recent) < 0.01:
                trend_desc = "estable sin variación neta en la ventana reciente"
            elif delta_recent > 0:
                trend_desc = f"con variación ascendente descriptiva (+{delta_recent:.1f} {defn.unit} en {len(values)} registros)"
            else:
                trend_desc = f"con variación descendente descriptiva ({delta_recent:.1f} {defn.unit} en {len(values)} registros)"
        else:
            trend_desc = "con un único punto válido disponible (insuficiente para tendencia longitudinal)"

        baseline_comparison = ""
        if baseline:
            diff_base = latest.value - baseline.baseline_value
            sign = "+" if diff_base >= 0 else ""
            baseline_comparison = (
                f"Comparado con la línea base individual pre-misión ({baseline.baseline_value} {defn.unit}), "
                f"el último registro presenta una diferencia de {sign}{diff_base:.1f} {defn.unit}."
            )

        env_note = ""
        if env_profile:
            env_note = (
                f"Entorno actual ({env_profile.name}, gravedad {env_profile.gravity_label}): "
                f"{env_profile.preventive_focus}"
            )

        return {
            "indicator_code": defn.code,
            "indicator_name": defn.name,
            "mode": "AI_ASSISTIVE_CONFIGURED" if settings.AI_PROVIDER_ENABLED else "RULE_TEMPLATE_ENGINE",
            "latest_state": latest.calculated_state,
            "latest_value": latest.value,
            "unit": defn.unit,
            "plain_explanation": defn.educational_summary,
            "spaceflight_context": defn.spaceflight_risk_explanation,
            "historical_summary": (
                f"En los últimos {len(values)} registros válidos, el indicador se observa {trend_desc} "
                f"(rango observado: {min_v:.1f}–{max_v:.1f} {defn.unit}, media: {avg_v:.1f} {defn.unit}). "
                f"{baseline_comparison}"
            ),
            "environmental_context_note": env_note,
            "causality_note": (
                "Nota metodológica: La coincidencia temporal entre cambios ambientales o fases de misión y "
                "variaciones fisiológicas representa una asociación descriptiva, no una prueba de causalidad directa."
            ),
            "recommended_protocol_action": (
                "Consultar el protocolo autorizado de medicina espacial y completar el seguimiento preventivo indicado."
                if latest.calculated_state in ("MONITOR", "WARNING", "CRITICAL")
                else "Mantener las rutinas preventivas autorizadas y la programación habitual de registros."
            ),
            "is_simulated": latest.is_simulated,
            "disclaimer": cls.DISCLAIMER,
        }

    @classmethod
    def filter_safe_wellness_recommendations(
        cls,
        db: Session,
        astronaut_id: int,
        wellness_state: str,
    ) -> Dict[str, object]:
        """
        Selects preventive wellness activities while checking active medical alerts.
        Blocks automatic exercise recommendations if an incompatible WARNING/CRITICAL alert is active.
        """
        active_high_alerts = (
            db.query(Alert)
            .filter(
                Alert.astronaut_id == astronaut_id,
                Alert.status.in_(["NEW", "ACKNOWLEDGED", "IN_FOLLOWUP", "ESCALATED"]),
                Alert.operational_state.in_(["WARNING", "CRITICAL"]),
            )
            .all()
        )
        has_medical_contraindication = len(active_high_alerts) > 0

        all_recs = db.query(WellnessRecommendation).all()
        compatible = []
        suppressed = []

        for rec in all_recs:
            states = [s.strip() for s in rec.applicable_states_csv.split(",")]
            if "ALL" not in states and wellness_state not in states:
                continue

            if rec.requires_medical_clearance_if_alert and has_medical_contraindication:
                suppressed.append(
                    {
                        "code": rec.code,
                        "title": rec.title,
                        "reason": (
                            "Suprimida automáticamente por precaución: existe una alerta operativa activa "
                            f"({active_high_alerts[0].title}). Priorice el protocolo médico antes de ejercicio físico."
                        ),
                    }
                )
                continue

            compatible.append(
                {
                    "code": rec.code,
                    "title": rec.title,
                    "category": rec.category,
                    "duration_minutes": rec.duration_minutes,
                    "instructions": rec.instructions,
                    "educational_rationale": rec.educational_rationale,
                }
            )

        return {
            "wellness_state": wellness_state,
            "has_active_medical_alert": has_medical_contraindication,
            "urgent_notice": (
                "Atención: Las actividades de relajación o bienestar son complementarias y nunca sustituyen "
                "la evaluación profesional ni la activación de protocolos urgentes."
            ),
            "recommendations": compatible,
            "suppressed_for_safety": suppressed,
            "disclaimer": cls.DISCLAIMER,
        }

