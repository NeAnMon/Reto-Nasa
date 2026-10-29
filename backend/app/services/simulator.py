from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from sqlalchemy.orm import Session

from backend.app.models.models import (
    Alert,
    DataQualityEvent,
    EnvironmentalMeasurement,
    HealthIndicatorDefinition,
    HealthMeasurement,
    Mission,
    MissionContext,
    PsychologicalWellnessAssessment,
    SensorRegistry,
    User,
)
from backend.app.rules.engine import compute_measurement_state, create_alert_if_needed
from backend.app.services.gamification import record_gamification_mission


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


DEMO_SCENARIOS = [
    {
        "code": "SCENARIO_1_STABLE_MISSION",
        "number": 1,
        "title": "1. Misión estable con indicadores dentro de límites DEMO",
        "description": "Genera un lote completo de mediciones fisiológicas y ambientales simuladas dentro de los rangos operativos de referencia.",
    },
    {
        "code": "SCENARIO_2_INCOMPLETE_OFFLINE",
        "number": 2,
        "title": "2. Datos incompletos y sensor sin conexión",
        "description": "Desconecta el sensor óptico biométrico simulado, registra un evento de calidad de datos y deja indicadores vencidos/sin datos.",
    },
    {
        "code": "SCENARIO_3_TREND_MONITORING",
        "number": 3,
        "title": "3. Tendencia que requiere seguimiento (MONITOR / WARNING)",
        "description": "Simula un incremento progresivo de frecuencia cardíaca y presión arterial en 3 puntos temporales que activa seguimiento preventivo.",
    },
    {
        "code": "SCENARIO_4_CRITICAL_ESCALATION",
        "number": 4,
        "title": "4. Evento de alerta que activa escalamiento urgente (CRITICAL)",
        "description": "Simula una lectura de saturación de oxígeno baja (SpO2 89%) y CO2 elevado en cabina, activando alerta CRITICAL e instrucciones inmediatas.",
    },
    {
        "code": "SCENARIO_5_SLEEP_FATIGUE",
        "number": 5,
        "title": "5. Disminución del descanso y aumento de fatiga percibida",
        "description": "Registra reducción de horas de sueño (4.2 h) y aumento de fatiga percibida (8/10), generando alerta preventiva de descanso.",
    },
    {
        "code": "SCENARIO_6_ENVIRONMENT_SHIFT",
        "number": 6,
        "title": "6. Cambio de entorno y fase de misión (EVA / Superficie Lunar)",
        "description": "Actualiza el contexto verificado a EXTRAVEHICULAR_ACTIVITY (EVA), registra telemetría de traje y mantiene umbrales clínicos intactos.",
    },
    {
        "code": "SCENARIO_7_PSYCHOLOGICAL_SUPPORT",
        "number": 7,
        "title": "7. Solicitud de apoyo psicológico con privacidad reforzada",
        "description": "Registra una evaluación de bienestar demostrativa con solicitud de apoyo prioritario; protege las respuestas privadas frente al líder.",
    },
    {
        "code": "SCENARIO_8_SELF_CARE_ROUTINE",
        "number": 8,
        "title": "8. Rutina de autocuidado completada y recompensa gamificada",
        "description": "Completa misiones de autocuidado e hidratación verificadas en servidor, otorgando XP e insignias sin premiar valores clínicos.",
    },
    {
        "code": "SCENARIO_9_OFFLINE_SYNC_RECOVERY",
        "number": 9,
        "title": "9. Sincronización tras interrupción de conectividad",
        "description": "Simula la recepción diferida de un lote de mediciones tomadas sin conexión con deduplicación garantizada y actualización de estado.",
    },
]


def _insert_sim_measurement(
    db: Session,
    astronaut_id: int,
    mission_id: int,
    indicator_code: str,
    value: float,
    secondary_value: Optional[float] = None,
    measured_at: Optional[datetime] = None,
    phase_code: str = "SURFACE",
    environment_code: str = "LUNAR_SURFACE",
    source_code: str = "DEMO_SIMULATION",
    notes: str = "Dato sintético generado por Simulador AstroVital (SIMULADO)",
    dedup_key: Optional[str] = None,
) -> Optional[HealthMeasurement]:
    if dedup_key:
        existing = (
            db.query(HealthMeasurement)
            .filter(HealthMeasurement.dedup_key == dedup_key)
            .first()
        )
        if existing:
            return existing

    defn = (
        db.query(HealthIndicatorDefinition)
        .filter(HealthIndicatorDefinition.code == indicator_code)
        .first()
    )
    if not defn:
        return None

    meas_dt = measured_at or utcnow()
    state, rule, version, reasons = compute_measurement_state(
        db=db,
        definition=defn,
        astronaut_id=astronaut_id,
        mission_id=mission_id,
        value=value,
        secondary_value=secondary_value,
        measured_at=meas_dt,
        source_code=source_code,
    )

    m = HealthMeasurement(
        dedup_key=dedup_key,
        astronaut_id=astronaut_id,
        mission_id=mission_id,
        indicator_code=indicator_code,
        value=value,
        secondary_value=secondary_value,
        unit=defn.unit,
        measured_at=meas_dt,
        received_at=utcnow(),
        phase_code=phase_code,
        environment_code=environment_code,
        source_code=source_code,
        data_quality="SYNTHETIC_DEMO",
        calculated_state=state,
        rule_version_id=version.id if version else None,
        is_simulated=True,
        notes=notes,
    )
    db.add(m)
    db.flush()

    create_alert_if_needed(db, m, defn, rule, version, reasons)
    return m


def execute_demo_scenario(
    db: Session,
    scenario_code: str,
    astronaut_id: int,
    mission_id: int,
    environment_code: Optional[str] = None,
    actor_user: Optional[User] = None,
) -> Dict[str, object]:
    now = utcnow()
    mission = db.query(Mission).filter(Mission.id == mission_id).first()
    phase_code = mission.current_phase if mission else "SURFACE"
    env_code = environment_code or "LUNAR_SURFACE"

    created_measurements = 0
    created_alerts = 0
    events_summary: List[str] = []

    if scenario_code == "SCENARIO_1_STABLE_MISSION":
        samples = [
            ("HEART_RATE", 68.0, None),
            ("BLOOD_PRESSURE", 116.0, 74.0),
            ("BODY_TEMP", 36.7, None),
            ("SPO2", 98.0, None),
            ("RESP_RATE", 14.0, None),
            ("BLOOD_GLUCOSE", 92.0, None),
            ("SLEEP_DURATION", 7.6, 8.5),
            ("HYDRATION", 2500.0, None),
            ("PHYSICAL_ACTIVITY", 75.0, 320.0),
            ("PERCEIVED_FATIGUE", 2.5, None),
            ("MOOD_WELLNESS", 8.4, None),
            ("RADIATION_EXPOSURE", 0.42, None),
        ]
        for code, val, sec in samples:
            m = _insert_sim_measurement(
                db,
                astronaut_id=astronaut_id,
                mission_id=mission_id,
                indicator_code=code,
                value=val,
                secondary_value=sec,
                measured_at=now,
                phase_code=phase_code,
                environment_code=env_code,
                notes="[SIMULADO - Escenario 1] Medición estable dentro de límites DEMO.",
            )
            if m:
                created_measurements += 1
        # Ensure sensors are online
        for s in db.query(SensorRegistry).filter(SensorRegistry.astronaut_id == astronaut_id).all():
            s.status = "SIMULATED_ONLINE"
            s.last_seen_at = now
        events_summary.append(
            "Se registraron 12 mediciones sintéticas en estado NORMAL (etiquetadas como SIMULADO)."
        )

    elif scenario_code == "SCENARIO_2_INCOMPLETE_OFFLINE":
        sensors = (
            db.query(SensorRegistry)
            .filter(SensorRegistry.astronaut_id == astronaut_id)
            .all()
        )
        for s in sensors:
            s.status = "OFFLINE"
        dq = DataQualityEvent(
            astronaut_id=astronaut_id,
            mission_id=mission_id,
            indicator_code="SPO2",
            event_type="SENSOR_OFFLINE",
            severity="WARNING",
            details="[SIMULADO - Escenario 2] Sensor biométrico de muñeca desconectado. Lecturas de SpO2 y Glucosa no disponibles.",
            recorded_at=now,
        )
        db.add(dq)
        # Insert a stale measurement (72 hours old) for BODY_TEMP
        _insert_sim_measurement(
            db,
            astronaut_id=astronaut_id,
            mission_id=mission_id,
            indicator_code="BODY_TEMP",
            value=36.6,
            measured_at=now - timedelta(hours=72),
            phase_code=phase_code,
            environment_code=env_code,
            notes="[SIMULADO - Escenario 2] Medición antigua para demostrar detección de estado STALE.",
        )
        created_measurements += 1
        events_summary.append(
            "Sensores biométricos simulados puestos en estado OFFLINE y evento de calidad de datos registrado."
        )

    elif scenario_code == "SCENARIO_3_TREND_MONITORING":
        steps = [
            (now - timedelta(hours=6), 76.0, 124.0, 80.0),
            (now - timedelta(hours=3), 88.0, 132.0, 85.0),
            (now, 98.0, 138.0, 88.0),
        ]
        for dt_step, hr_val, sys_val, dia_val in steps:
            _insert_sim_measurement(
                db,
                astronaut_id=astronaut_id,
                mission_id=mission_id,
                indicator_code="HEART_RATE",
                value=hr_val,
                measured_at=dt_step,
                phase_code=phase_code,
                environment_code=env_code,
                notes="[SIMULADO - Escenario 3] Serie de tendencia ascendente para revisión preventiva.",
            )
            _insert_sim_measurement(
                db,
                astronaut_id=astronaut_id,
                mission_id=mission_id,
                indicator_code="BLOOD_PRESSURE",
                value=sys_val,
                secondary_value=dia_val,
                measured_at=dt_step,
                phase_code=phase_code,
                environment_code=env_code,
                notes="[SIMULADO - Escenario 3] Serie de presión arterial en zona de seguimiento.",
            )
            created_measurements += 2
        created_alerts += 2
        events_summary.append(
            "Serie temporal de 3 puntos generada para Frecuencia Cardíaca (hasta 98 bpm) y Presión Arterial (138/88 mmHg), activando alertas de seguimiento (MONITOR/WARNING)."
        )

    elif scenario_code == "SCENARIO_4_CRITICAL_ESCALATION":
        _insert_sim_measurement(
            db,
            astronaut_id=astronaut_id,
            mission_id=mission_id,
            indicator_code="SPO2",
            value=89.0,
            measured_at=now,
            phase_code=phase_code,
            environment_code=env_code,
            notes="[SIMULADO - Escenario 4] Evento crítico simulado de hipoxemia operativa para demostración de escalamiento.",
        )
        _insert_sim_measurement(
            db,
            astronaut_id=astronaut_id,
            mission_id=mission_id,
            indicator_code="HEART_RATE",
            value=118.0,
            measured_at=now,
            phase_code=phase_code,
            environment_code=env_code,
            notes="[SIMULADO - Escenario 4] Taquicardia asociada en escenario de escalamiento DEMO.",
        )
        env_co2 = EnvironmentalMeasurement(
            mission_id=mission_id,
            environment_code=env_code,
            phase_code=phase_code,
            parameter_code="CO2_LEVEL",
            parameter_name="Concentración de CO₂ en Cabina",
            value=4.8,
            unit="mmHg",
            source_code="DEMO_SIMULATION",
            data_quality="SYNTHETIC_DEMO",
            availability_status="AVAILABLE",
            calculated_state="WARNING",
            measured_at=now,
            is_simulated=True,
        )
        db.add(env_co2)
        created_measurements += 2
        created_alerts += 2
        events_summary.append(
            "Alerta CRITICAL activada inmediatamente (SpO2 89%, FC 118 bpm, CO2 4.8 mmHg) con instrucciones de protocolo de emergencia y escalamiento inmediato sin depender de IA."
        )

    elif scenario_code == "SCENARIO_5_SLEEP_FATIGUE":
        _insert_sim_measurement(
            db,
            astronaut_id=astronaut_id,
            mission_id=mission_id,
            indicator_code="SLEEP_DURATION",
            value=4.2,
            secondary_value=4.0,
            measured_at=now,
            phase_code=phase_code,
            environment_code=env_code,
            notes="[SIMULADO - Escenario 5] Disminución del sueño nocturno.",
        )
        _insert_sim_measurement(
            db,
            astronaut_id=astronaut_id,
            mission_id=mission_id,
            indicator_code="PERCEIVED_FATIGUE",
            value=8.2,
            measured_at=now,
            phase_code=phase_code,
            environment_code=env_code,
            notes="[SIMULADO - Escenario 5] Incremento de fatiga subjetiva percibida.",
        )
        created_measurements += 2
        created_alerts += 2
        events_summary.append(
            "Registrada disminución de sueño (4.2 h) y fatiga elevada (8.2/10), activando recomendaciones de higiene del sueño y pausa de recuperación."
        )

    elif scenario_code == "SCENARIO_6_ENVIRONMENT_SHIFT":
        target_env = environment_code or "EXTRAVEHICULAR_ACTIVITY"
        for old_ctx in (
            db.query(MissionContext)
            .filter(
                MissionContext.mission_id == mission_id,
                MissionContext.astronaut_id == astronaut_id,
                MissionContext.is_active.is_(True),
            )
            .all()
        ):
            old_ctx.is_active = False

        new_ctx = MissionContext(
            mission_id=mission_id,
            astronaut_id=astronaut_id,
            environment_code=target_env,
            phase_code="EVA" if target_env == "EXTRAVEHICULAR_ACTIVITY" else phase_code,
            location_module="Exclusa Exterior / Traje Presurizado EMU-Sim" if target_env == "EXTRAVEHICULAR_ACTIVITY" else f"Módulo {target_env}",
            determination_source="DEMO_SIMULATION",
            confidence="HIGH",
            connectivity_status="ONLINE",
            conflict_notes="Cambio de contexto ejecutado en simulador DEMO. Los límites clínicos permanecen intactos.",
            confirmed_by_user_id=actor_user.id if actor_user else astronaut_id,
            recorded_at=now,
            is_active=True,
            is_simulated=True,
        )
        db.add(new_ctx)
        suit_meas = EnvironmentalMeasurement(
            mission_id=mission_id,
            environment_code=target_env,
            phase_code="EVA" if target_env == "EXTRAVEHICULAR_ACTIVITY" else phase_code,
            parameter_code="SUIT_STATE",
            parameter_name="Estado del Traje Espacial (Presión / Soporte Vital)",
            value=4.3,
            text_state="NOMINAL_EVA_PRESSURE (4.3 psi O2)",
            unit="psi",
            source_code="DEMO_SIMULATION",
            data_quality="SYNTHETIC_DEMO",
            availability_status="AVAILABLE",
            calculated_state="NORMAL",
            measured_at=now,
            is_simulated=True,
        )
        db.add(suit_meas)
        events_summary.append(
            f"Contexto actualizado a {target_env} con fuente DEMO_SIMULATION. Los umbrales clínicos de referencia se conservaron sin alteración automática."
        )

    elif scenario_code == "SCENARIO_7_PSYCHOLOGICAL_SUPPORT":
        assessment = PsychologicalWellnessAssessment(
            astronaut_id=astronaut_id,
            mission_id=mission_id,
            instrument_code="SPACE_WELLNESS_CHECK_DEMO",
            is_draft=False,
            mood_score=4,
            stress_score=8,
            sleep_quality_score=4,
            sleep_hours=5.0,
            fatigue_score=7,
            concentration_score=5,
            isolation_score=8,
            adaptation_score=5,
            social_support_score=4,
            recovery_score=4,
            request_additional_support=True,
            support_urgency="PRIORITY_REVIEW",
            private_reflection="[CONFIDENCIAL - DEMO] Siento sobrecarga por el aislamiento prolongado y solicito sesión privada con el especialista de apoyo psicológico.",
            share_operational_signal_with_leader=True,
            operational_wellness_state="SUPPORT_RECOMMENDED",
            phase_code=phase_code,
            environment_code=env_code,
            is_simulated=True,
            created_at=now,
        )
        db.add(assessment)
        events_summary.append(
            "Evaluación de bienestar registrada con solicitud de apoyo (SUPPORT_RECOMMENDED). La reflexión detallada permanece cifrada/privada y sólo la señal operativa autorizada es visible para el líder."
        )

    elif scenario_code == "SCENARIO_8_SELF_CARE_ROUTINE":
        res1 = record_gamification_mission(
            db,
            user_id=astronaut_id,
            daily_mission_code="HYDRATION_ROUTINE",
            status_mode="COMPLETED",
            reflection_note="[SIMULADO - Escenario 8] Hidratación fraccionada completada.",
            is_simulated=True,
        )
        res2 = record_gamification_mission(
            db,
            user_id=astronaut_id,
            daily_mission_code="LEARNING_MISSION",
            status_mode="COMPLETED",
            reflection_note="[SIMULADO - Escenario 8] Lectura sobre redistribución cefálica de fluidos.",
            is_simulated=True,
        )
        events_summary.append(
            f"Rutinas de autocuidado y aprendizaje completadas (+{res1['xp_awarded'] + res2['xp_awarded']} XP verificados en backend)."
        )

    elif scenario_code == "SCENARIO_9_OFFLINE_SYNC_RECOVERY":
        batch_keys = [
            ("HEART_RATE", 72.0, now - timedelta(minutes=45), "SYNC-DEMO-HR-45M"),
            ("HYDRATION", 2350.0, now - timedelta(minutes=30), "SYNC-DEMO-HYD-30M"),
            ("RESP_RATE", 15.0, now - timedelta(minutes=15), "SYNC-DEMO-RR-15M"),
        ]
        for code, val, dt_val, dkey in batch_keys:
            m = _insert_sim_measurement(
                db,
                astronaut_id=astronaut_id,
                mission_id=mission_id,
                indicator_code=code,
                value=val,
                measured_at=dt_val,
                phase_code=phase_code,
                environment_code=env_code,
                source_code="OFFLINE_QUEUE_SYNC",
                notes="[SIMULADO - Escenario 9] Sincronizado tras recuperación de enlace con clave de deduplicación.",
                dedup_key=dkey,
            )
            if m:
                created_measurements += 1
        events_summary.append(
            "Lote de 3 mediciones pendientes en cola sin conexión sincronizado correctamente sin duplicados."
        )

    else:
        raise ValueError(f"Escenario de demostración '{scenario_code}' no reconocido.")

    db.commit()
    return {
        "scenario_code": scenario_code,
        "astronaut_id": astronaut_id,
        "mission_id": mission_id,
        "environment_code": env_code,
        "is_simulated": True,
        "created_measurements": created_measurements,
        "created_alerts": created_alerts,
        "events_summary": events_summary,
        "executed_at": now.isoformat(),
    }

