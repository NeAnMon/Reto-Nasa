
"""SEMSA · Pruebas · Servicio de pronóstico de indicadores fisiológicos.

Run from repository root: pytest backend/tests/test_prediction_service.py -q
"""
from datetime import datetime, timedelta, timezone
from math import nan
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from backend.app.database.session import Base
from backend.app.models.models import (
    Alert, ClinicalRule, ClinicalRuleVersion,
    HealthBaseline, HealthIndicatorDefinition, HealthMeasurement,
    MissionAssignment, Mission, Role, User,
)
from backend.app.rules import recommendations as alert_rec
from backend.app.rules.calibration import CALIBRATION, Z_RED, Z_YELLOW
from backend.app.rules.engine import baseline_from_row, evaluate_measurement
from backend.app.rules.evaluation import (
    PersonalBaseline, PreviousReading, RollingWindow, Thresholds, evaluate_reading,
)
from backend.app.services import prediction_service as ps
from backend.app.services.prediction_service import predict_indicator

START = datetime(2025, 1, 1, 12, tzinfo=timezone.utc)


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


@pytest.fixture
def setup(db):
    # Populate only the columns required by the actual ORM schema.
    role = Role(id=1, code="ASTRONAUT", name="Astronaut")
    db.add(role)
    db.flush()
    user = User(id=1, role_id=1, crew_code="AST-001", email="astronaut@example.test", password_hash="test", full_name="Test Astronaut")
    mission = Mission(id=1, code="TEST", name="Test Mission", description="test", vehicle_or_habitat="test", current_phase="ORBIT")
    indicator = HealthIndicatorDefinition(
        code="HEART_RATE", name="Heart rate", category="CARDIOVASCULAR",
        body_region_code="CHEST", unit="bpm", min_valid_value=30, max_valid_value=200,
        step_by_step_instructions="test", educational_summary="test", spaceflight_risk_explanation="test",
    )
    db.add_all([user, mission, indicator])
    db.flush()
    db.add(MissionAssignment(user_id=1, mission_id=1, assignment_role="ASTRONAUT", is_active=True))
    db.commit()
    return indicator


def add_series(db, n=12, *, slope=2, offset=70, phase="ORBIT", env="LOW_EARTH_ORBIT", start=START):
    for i in range(n):
        db.add(HealthMeasurement(
            astronaut_id=1, mission_id=1, indicator_code="HEART_RATE", value=offset + slope * i,
            unit="bpm", measured_at=start + timedelta(days=i), phase_code=phase,
            environment_code=env, data_quality="SYNTHETIC_DEMO", calculated_state="NORMAL", is_simulated=True,
        ))
    db.commit()


def run(db, **kwargs):
    return predict_indicator(db, 1, 1, "HEART_RATE", 7, **kwargs)


def test_linear_series(db, setup):
    """Una tendencia que domina al ruido se detecta, se valida en la serie y se extrapola."""
    add_series(db)
    r = run(db)
    assert r.status == "ok"
    assert r.beta1 == pytest.approx(2)
    assert r.forecast[0]["value"] == pytest.approx(94)
    assert r.mae_ols == pytest.approx(0, abs=1e-9)
    assert r.mae_ols < r.mae_naive
    assert r.baseline_status == "missing"
    assert r.forecast[0]["z_score"] is None
    assert r.method["model_used"] == "trend"
    assert r.trend["direction"] == "rising"
    assert r.trend["significant"] is True and r.trend["extrapolated"] is True
    assert r.trend["slope_per_day"] == pytest.approx(2)
    assert r.reliability["reliable"] is True and r.reliability["skill_vs_naive"] == pytest.approx(1)


def test_unreliable_series(db, setup):
    """Tras un cambio brusco de nivel, repetir el último valor acierta más que el modelo: no se pronostica."""
    add_values(db, [70] * 7 + [60] * 6)
    r = run(db)
    assert r.status == "model_not_reliable"
    assert r.forecast == []
    assert r.mae_ols > r.mae_naive
    assert r.reliability["reliable"] is False and r.reliability["skill_vs_naive"] < 0
    assert r.trend["extrapolated"] is False
    assert r.threshold_projection is None and r.recommendation is None


def test_fewer_than_ten_days(db, setup):
    add_series(db, n=9)
    assert run(db).status == "insufficient_data"


def test_daily_median(db, setup):
    add_series(db)
    # Day 1 has 70, 70, and 130: median=70 while mean=90.
    for minute, value in ((1, 70), (2, 130)):
        db.add(HealthMeasurement(
            astronaut_id=1, mission_id=1, indicator_code="HEART_RATE",
            value=value, unit="bpm",
            measured_at=START + timedelta(minutes=minute),
            phase_code="ORBIT", environment_code="LOW_EARTH_ORBIT",
            data_quality="VALIDATED", calculated_state="NORMAL",
        ))
    db.commit()
    result = run(db)
    assert result.status == "ok"
    assert result.beta1 == pytest.approx(2)
    assert result.forecast[0]["value"] == pytest.approx(94)


def test_invalid_and_training_rows_excluded(db, setup):
    add_series(db)
    for i, (value, quality, state, phase) in enumerate([
        (300, "VALIDATED", "NORMAL", "ORBIT"),
        (100, "INVALID", "NORMAL", "ORBIT"),
        (100, "VALIDATED", "INVALID", "ORBIT"),
        (100, "VALIDATED", "NORMAL", "TRAINING"),
        (100, "VALIDATED", "NORMAL", "PRE_MISSION_BASELINE"),
    ]):
        db.add(HealthMeasurement(astronaut_id=1, mission_id=1, indicator_code="HEART_RATE", value=value,
            unit="bpm", measured_at=START + timedelta(days=12 + i), phase_code=phase,
            environment_code="LOW_EARTH_ORBIT", data_quality=quality, calculated_state=state))
    db.commit()
    assert run(db).n_days == 12


def test_latest_contiguous_segment(db, setup):
    add_series(db, 12, start=START)
    add_series(db, 3, phase="SURFACE", env="MOON", start=START + timedelta(days=12))
    add_series(db, 11, start=START + timedelta(days=15))
    r = run(db)
    assert r.status == "ok"
    assert r.n_days == 11
    assert r.phase_code == "ORBIT"


def test_segment_too_short(db, setup):
    add_series(db, 12)
    add_series(db, 3, phase="SURFACE", env="MOON", start=START + timedelta(days=12))
    assert run(db).status == "insufficient_data"


@pytest.mark.parametrize("h", [0, 15, True, 1.5])
def test_invalid_horizon(db, setup, h):
    with pytest.raises(ValueError):
        predict_indicator(db, 1, 1, "HEART_RATE", h)


def test_baseline_std_zero(db, setup):
    add_series(db)
    db.add(HealthBaseline(astronaut_id=1, indicator_code="HEART_RATE", baseline_value=70, std_dev=0))
    db.commit()
    r = run(db)
    assert r.status == "ok"
    assert r.baseline_status == "invalid_std_dev"
    assert r.z_score is None


def test_baseline_z_score(db, setup):
    add_series(db)
    db.add(HealthBaseline(astronaut_id=1, indicator_code="HEART_RATE", baseline_value=70, std_dev=6.5, is_simulated=True))
    db.commit()
    r = run(db)
    assert r.status == "ok"
    assert r.baseline_status == "available_unverified"
    assert r.baseline_is_simulated is True
    assert r.baseline_value == 70
    last = r.forecast[-1]
    assert r.z_score == pytest.approx((last["value"] - 70) / 6.5)
    assert r.direction == "above" and r.z_band == "strong_deviation"
    assert last["baseline_delta"] == pytest.approx(last["value"] - 70)


def test_assignment_role_and_activity(db, setup):
    assignment = db.query(MissionAssignment).first()
    assignment.assignment_role = "MISSION_LEADER"
    db.commit()
    assert run(db).status == "not_assigned"
    assignment.assignment_role = "ASTRONAUT"
    assignment.is_active = False
    db.commit()
    assert run(db).status == "not_assigned"


def test_unknown_indicator(db, setup):
    assert predict_indicator(db, 1, 1, "UNKNOWN", 7).status == "unknown_indicator"


def test_simulated_filter(db, setup):
    add_series(db)
    assert run(db, include_simulated=False).status == "insufficient_data"




def test_real_series_accepted_when_simulated_excluded(db, setup):
    """A validated real series remains available with include_simulated=False."""
    for i in range(12):
        db.add(HealthMeasurement(
            astronaut_id=1, mission_id=1, indicator_code="HEART_RATE",
            value=70 + 2 * i, unit="bpm",
            measured_at=START + timedelta(days=i),
            phase_code="ORBIT", environment_code="LOW_EARTH_ORBIT",
            data_quality="VALIDATED", calculated_state="NORMAL",
            is_simulated=False,
        ))
    db.commit()
    result = run(db, include_simulated=False)
    assert result.status == "ok"
    assert result.beta1 == pytest.approx(2)


def test_cutoff_applied_before_row_limit(db, setup, monkeypatch):
    """Old measurements do not consume the safety limit for the active window."""
    import backend.app.services.prediction_service as prediction_module
    monkeypatch.setattr(prediction_module, "MAX_ROWS", 15)
    for i in range(16):
        db.add(HealthMeasurement(
            astronaut_id=1, mission_id=1, indicator_code="HEART_RATE",
            value=70, unit="bpm",
            measured_at=START - timedelta(days=200) + timedelta(minutes=i),
            phase_code="ORBIT", environment_code="LOW_EARTH_ORBIT",
            data_quality="VALIDATED", calculated_state="NORMAL",
            is_simulated=True,
        ))
    db.commit()
    add_series(db, n=12)
    result = run(db)
    assert result.status == "ok"
    assert result.n_days == 12



def test_recent_row_limit_is_explicit(db, setup, monkeypatch):
    """More than MAX_ROWS eligible recent records must fail explicitly."""
    import backend.app.services.prediction_service as prediction_module
    monkeypatch.setattr(prediction_module, "MAX_ROWS", 10)
    add_series(db, n=12)
    with pytest.raises(ValueError, match="Too many eligible measurements"):
        run(db)


def test_real_measurements_not_removed_when_include_simulated_true(db, setup):
    """The inclusive flag accepts a purely real validated time series."""
    for i in range(12):
        db.add(HealthMeasurement(
            astronaut_id=1, mission_id=1, indicator_code="HEART_RATE",
            value=70 + 2 * i, unit="bpm",
            measured_at=START + timedelta(days=i),
            phase_code="ORBIT", environment_code="LOW_EARTH_ORBIT",
            data_quality="VALIDATED", calculated_state="NORMAL",
            is_simulated=False,
        ))
    db.commit()
    assert run(db, include_simulated=True).status == "ok"

def test_out_of_range_forecast_flag(db, setup):
    add_series(db, n=12, slope=8, offset=100)
    r = run(db)
    assert r.status == "ok"
    assert any(x["out_of_valid_range"] for x in r.forecast)


def test_historical_data_and_as_of(db, setup):
    add_series(db)
    assert run(db).status == "ok"
    assert run(db, now=START + timedelta(days=12)).status == "ok"
    assert run(db, now=START + timedelta(days=200)).status == "insufficient_data"


def test_nonfinite_value_rejected_by_preprocessor(setup):
    from backend.app.services.prediction_service import _valid_measurement
    m = SimpleNamespace(phase_code="ORBIT", data_quality="VALIDATED", calculated_state="NORMAL",
        value=nan, measured_at=START, unit="bpm")
    assert not _valid_measurement(m, setup)


# ============================================================
# Método calibrado: nivel robusto, bandas, tendencia, umbrales
# ============================================================

STABLE = [70, 73, 68, 71, 69, 74, 67, 72, 70, 66, 73, 69, 71, 68, 72, 70]
NEAR_LIMIT = [98, 100, 96, 99, 97, 100, 95, 99, 98, 96, 100, 97, 99, 96, 100, 98]


def add_values(db, values, *, code="HEART_RATE", unit="bpm", start=START):
    for i, value in enumerate(values):
        db.add(HealthMeasurement(
            astronaut_id=1, mission_id=1, indicator_code=code, value=value, unit=unit,
            measured_at=start + timedelta(days=i), phase_code="ORBIT", environment_code="LOW_EARTH_ORBIT",
            data_quality="VALIDATED", calculated_state="NORMAL", is_simulated=False,
        ))
    db.commit()


def add_rule(db, *, normal=(60, 100), monitor=(50, 110), warning=(40, 130), baseline_delta=None, code="HEART_RATE"):
    rule = ClinicalRule(rule_code=f"RULE_{code}_TEST", indicator_code=code, name="Regla de prueba", is_active=True)
    db.add(rule)
    db.flush()
    db.add(ClinicalRuleVersion(
        rule_id=rule.id, version_number="1.0-TEST",
        normal_min=normal[0], normal_max=normal[1], monitor_min=monitor[0], monitor_max=monitor[1],
        warning_min=warning[0], warning_max=warning[1], baseline_delta_threshold=baseline_delta,
        immediate_instructions="Instrucciones inmediatas de prueba.",
        followup_instructions="Registrar medición de seguimiento (texto de la regla).",
        escalation_conditions="Condiciones de prueba.", is_current=True,
    ))
    db.commit()


def test_stable_noisy_series_gives_flat_forecast_with_widening_bands(db, setup):
    """Sin tendencia significativa no se extrapola ninguna pendiente: nivel robusto y bandas."""
    add_values(db, STABLE)
    r = run(db)
    assert r.status == "ok"
    assert r.method["code"] == "robust_level_v1" and r.method["model_used"] == "level"
    assert r.trend["direction"] == "stable"
    assert r.trend["significant"] is False and r.trend["extrapolated"] is False
    assert r.beta1 == 0
    values = [p["value"] for p in r.forecast]
    assert len(set(values)) == 1 and 68 <= values[0] <= 72
    assert r.beta0 == pytest.approx(values[0])
    assert r.reliability["reliable"] is True and 0 < r.reliability["skill_vs_naive"] < 1
    assert r.mae_ols < r.mae_naive
    for p in r.forecast:
        assert p["lower_95"] < p["lower_80"] < p["value"] < p["upper_80"] < p["upper_95"]
    widths = [p["upper_80"] - p["lower_80"] for p in r.forecast]
    assert all(b > a for a, b in zip(widths, widths[1:]))
    # La banda del 80 % tiene un ancho del orden de la dispersión de la serie (DE cercana a 2,3)
    assert 3 < widths[0] < 12


def test_baseline_placeholder_std_dev_default_is_not_published_as_z(db, setup):
    """La desviación por defecto del modelo (5.0) es un relleno: no se publica puntaje Z."""
    add_series(db)
    db.add(HealthBaseline(astronaut_id=1, indicator_code="HEART_RATE", baseline_value=70))
    db.commit()
    r = run(db)
    assert r.status == "ok"
    assert r.baseline_status == "placeholder_std_dev"
    assert r.z_score is None and r.z_band is None and r.direction is None
    assert all(p["z_score"] is None and p["z_band"] is None for p in r.forecast)
    # El valor de la línea base sí es utilizable: se informa la diferencia en unidades
    assert r.baseline_value == 70
    assert r.forecast[0]["baseline_delta"] == pytest.approx(24)


def test_baseline_placeholder_matches_the_alert_engine(db, setup):
    """Misma detección de relleno que el motor de alertas: 4.0 solo es relleno en una línea base
    simulada (seed demo anterior); con una DE real hay Z, calculado con el piso de DE del motor."""
    add_series(db)
    row = HealthBaseline(astronaut_id=1, indicator_code="HEART_RATE", baseline_value=70, std_dev=4.0, is_simulated=True)
    db.add(row)
    db.commit()
    r = run(db)
    assert r.baseline_status == "placeholder_std_dev"
    assert r.z_score is None and all(p["z_score"] is None for p in r.forecast)
    row.is_simulated = False
    db.commit()
    r = run(db)
    assert r.baseline_status == "available_unverified"
    # el motor usa una DE mínima de 6 lpm para el pulso: z no se infla con una DE de 4.0
    assert r.z_score == pytest.approx((r.forecast[-1]["value"] - 70) / 6.0)


def test_personal_scale_matches_the_alert_engine():
    """La media y la DE efectiva del pronóstico son las del motor: mismo z con piso de DE y con media móvil."""
    for code, mean, sd, value in (
        ("HEART_RATE", 62.0, 3.0, 75.0),       # DE por debajo del piso (6 lpm)
        ("BODY_TEMP", 36.5, 0.45, 37.4),
        ("SLEEP_DURATION", 7.2, 0.52, 6.4),    # regla sobre la media de 7 noches
        ("MOOD_WELLNESS", 7.5, 0.56, 6.0),
    ):
        baseline = PersonalBaseline(mean=mean, sd=sd)
        ctx = ps.ProjectionContext(code, "u", Thresholds.from_calibration(CALIBRATION[code]), baseline)
        ev = ps.evaluate_level(ctx, value)
        scale = ps.personal_scale(code, baseline)
        assert ev.baseline_valid and ev.z == pytest.approx((value - scale[0]) / scale[1]), code
    # sin una DE real no hay escala, igual que en el motor (ausente, 0, de relleno)
    for sd, simulated in ((None, False), (0.0, False), (5.0, False), (4.0, True)):
        baseline = PersonalBaseline(mean=70.0, sd=sd, is_simulated=simulated)
        assert ps.personal_scale("HEART_RATE", baseline) is None
        ctx = ps.ProjectionContext("HEART_RATE", "lpm", Thresholds.from_calibration(CALIBRATION["HEART_RATE"]), baseline)
        assert ps.evaluate_level(ctx, 80.0).baseline_valid is False


CALIBRATED_HR = {"normal": (51, 99), "monitor": (51, 99), "warning": (41, 119)}  # rangos de rules/calibration.py


def test_projected_state_is_the_alert_engine_state(db, setup):
    """Una sola fuente de verdad: el estado proyectado de cada día es el que da `evaluate_reading`
    (y el motor con BD al registrar esa lectura) para los mismos datos."""
    add_series(db)  # 70 … 92; pronóstico 94 … 106
    add_rule(db, **CALIBRATED_HR)
    row = HealthBaseline(astronaut_id=1, indicator_code="HEART_RATE", baseline_value=62, std_dev=6.5, is_simulated=False)
    db.add(row)
    db.commit()
    r = run(db)
    assert r.status == "ok"
    thresholds = Thresholds(51, 99, 51, 99, 41, 119)
    baseline = baseline_from_row(row)

    def engine_state(value):
        return evaluate_reading(
            "HEART_RATE", value, None, thresholds, unit="bpm", baseline=baseline, previous=PreviousReading(value=value)
        ).state

    rank = {"NORMAL": 0, "MONITOR": 1, "WARNING": 2, "CRITICAL": 3}
    for p in r.forecast:
        assert p["projected_state"] == engine_state(p["value"])
        for level in (80, 95):
            worst = max(engine_state(p[f"lower_{level}"]), engine_state(p[f"upper_{level}"]), key=rank.get)
            assert p[f"worst_state_{level}"] == worst
    # dentro del rango absoluto (≤ 99) pero a más de 3 DE de la persona: WARNING por desvío personal
    assert r.forecast[0]["value"] == pytest.approx(94) and r.forecast[0]["projected_state"] == "WARNING"
    # y el motor con BD, al registrar esa misma lectura al día siguiente, da el mismo estado
    stored = evaluate_measurement(db, setup, 1, 1, r.forecast[0]["value"], None, START + timedelta(days=12), "MANUAL_ENTRY")
    assert stored.state == r.forecast[0]["projected_state"]

    # la envoltura no añade criterio propio: coincide con evaluate_reading en todo el rango, con y sin línea base
    for personal in (None, baseline, PersonalBaseline(mean=62.0, sd=5.0), PersonalBaseline(mean=62.0, sd=0.0)):
        ctx = ps.ProjectionContext("HEART_RATE", "bpm", thresholds, personal)
        for value in range(30, 131):
            direct = evaluate_reading(
                "HEART_RATE", float(value), None, thresholds, unit="bpm", baseline=personal,
                previous=PreviousReading(value=float(value)),
            )
            wrapped = ps.evaluate_level(ctx, float(value))
            assert (wrapped.state, wrapped.direction, wrapped.z) == (direct.state, direct.direction, direct.z)


def test_rolling_mean_indicator_is_projected_with_a_full_window(db, setup):
    """Sueño: la regla usa la media de 7 noches, así que el nivel pronosticado se evalúa como ventana completa."""
    db.add(HealthIndicatorDefinition(
        code="SLEEP_DURATION", name="Sueño", category="TEST", body_region_code="HEAD", unit="horas",
        min_valid_value=0, max_valid_value=16, step_by_step_instructions="test",
        educational_summary="test", spaceflight_risk_explanation="test",
    ))
    db.commit()
    add_values(db, [5.8, 6.0, 5.6, 5.9, 5.7, 6.0, 5.5, 5.9, 5.8, 5.6, 6.0, 5.8], code="SLEEP_DURATION", unit="horas")
    add_rule(db, normal=(6.0, 16.0), monitor=(6.0, 16.0), warning=(5.5, 16.0), code="SLEEP_DURATION")
    r = predict_indicator(db, 1, 1, "SLEEP_DURATION", 7)
    assert r.status == "ok"
    level = r.forecast[0]["value"]
    assert 5.5 <= level < 6.0
    thresholds = Thresholds(6.0, 16.0, 6.0, 16.0, 5.5, 16.0)
    with_window = evaluate_reading(
        "SLEEP_DURATION", level, None, thresholds, unit="horas", previous=PreviousReading(value=level),
        window=RollingWindow(mean=level, count=CALIBRATION["SLEEP_DURATION"].rolling_days),
    )
    assert with_window.state == "WARNING"  # media por debajo de 6,0 h y sin línea base personal
    assert all(p["projected_state"] == with_window.state for p in r.forecast)
    # sin la ventana el motor trataría el nivel como una noche aislada y no alertaría
    assert evaluate_reading("SLEEP_DURATION", level, None, thresholds, unit="horas").state == "NORMAL"
    rec = r.recommendation
    assert rec["alert_direction"] == "LOW" and rec["direction"] == "below" and rec["threshold"] == 6.0
    assert rec["text"] == alert_rec.get_recommendation("SLEEP_DURATION", "LOW").followup


def test_threshold_projection_expected_crossing_and_recommendation(db, setup):
    """El valor esperado sale del rango normal: fecha, nivel, dirección, umbral y recomendación del catálogo."""
    add_series(db)  # 70, 72, ... 92; pronóstico 94, 96, 98, 100, 102, 104, 106
    add_rule(db)
    r = run(db)
    assert r.status == "ok"
    assert [p["projected_state"] for p in r.forecast] == ["NORMAL"] * 4 + ["MONITOR"] * 3
    tp = r.threshold_projection
    assert tp["rule_code"] == "RULE_HEART_RATE_TEST" and tp["rule_version"] == "1.0-TEST"
    assert tp["ranges"] == {"normal": [60, 100], "monitor": [50, 110], "warning": [40, 130]}  # sin línea base: sin banda personal
    assert tp["current_state"] == "NORMAL"
    crossing = tp["first_expected_crossing"]
    assert crossing["days_ahead"] == 5 and crossing["date"] == r.forecast[4]["date"]
    assert crossing["state"] == "MONITOR" and crossing["direction"] == "above" and crossing["threshold"] == 100
    assert crossing["reference"] == "absolute_range" and crossing["alert_direction"] == "HIGH"
    assert crossing["basis"] == "expected_value"
    rec = r.recommendation
    assert rec["basis"] == "expected_crossing" and rec["state"] == "MONITOR" and rec["days_ahead"] == 5
    # recomendación específica del indicador y la dirección, con su fuente; no el texto genérico de la regla
    catalog = alert_rec.get_recommendation("HEART_RATE", "HIGH")
    assert rec["text"] == catalog.followup and "Fuente:" in rec["text"]
    assert rec["source"] == "alert_recommendation_catalog" and rec["source_detail"] == catalog.source
    assert rec["immediate_action"] is None  # todavía no está fuera de rango: solo la pauta preventiva
    # El pronóstico nunca crea alertas
    assert db.query(Alert).count() == 0


def test_threshold_projection_band_touches_threshold(db, setup):
    """El valor esperado sigue en rango, pero la banda del 80 % alcanza el umbral: cruce posible."""
    add_values(db, NEAR_LIMIT)
    add_rule(db, normal=(60, 99))
    r = run(db)
    assert r.status == "ok" and r.method["model_used"] == "level"
    assert all(p["projected_state"] == "NORMAL" for p in r.forecast)
    assert all(p["worst_state_80"] == "MONITOR" and p["interval_touches_threshold"] for p in r.forecast)
    tp = r.threshold_projection
    assert tp["current_state"] == "NORMAL" and tp["first_expected_crossing"] is None
    possible = tp["first_possible_crossing"]
    assert possible["days_ahead"] == 1 and possible["basis"] == "interval_80"
    assert possible["state"] == "MONITOR" and possible["direction"] == "above" and possible["threshold"] == 99
    assert r.recommendation["basis"] == "possible_crossing"
    assert r.recommendation["text"] == alert_rec.get_recommendation("HEART_RATE", "HIGH").followup


def test_threshold_projection_far_from_limits_gives_no_recommendation(db, setup):
    add_values(db, STABLE)
    add_rule(db, normal=(40, 120), monitor=(35, 140), warning=(30, 160))
    r = run(db)
    assert r.status == "ok"
    assert all(p["projected_state"] == "NORMAL" and p["worst_state_95"] == "NORMAL" for p in r.forecast)
    assert not any(p["interval_touches_threshold"] for p in r.forecast)
    assert r.threshold_projection["first_expected_crossing"] is None
    assert r.threshold_projection["first_possible_crossing"] is None
    rec = r.recommendation
    assert rec["basis"] == "none" and rec["text"] is None and rec["immediate_action"] is None and rec["source"] is None


def test_threshold_projection_when_already_out_of_range(db, setup):
    add_series(db)  # último valor 92
    add_rule(db, normal=(60, 90))
    r = run(db)
    assert r.threshold_projection["current_state"] == "MONITOR"
    rec = r.recommendation
    assert rec["basis"] == "currently_out_of_range"
    assert rec["direction"] == "above" and rec["threshold"] == 90 and rec["days_ahead"] == 0
    # ya fuera de rango: además de la pauta, la acción inmediata del catálogo para ese nivel
    assert rec["text"] == alert_rec.get_recommendation("HEART_RATE", "HIGH").followup
    assert rec["immediate_action"] == alert_rec.build_alert_texts("HEART_RATE", "HIGH", "MONITOR")[0]


def test_threshold_projection_uses_personal_deviation_like_the_alert_engine(db, setup):
    """Como el motor: dentro del rango absoluto, pero a 3 DE o más de la línea base personal, es WARNING
    por desvío personal; el umbral cruzado es media + 3·DE y los rangos traen la banda personal."""
    add_values(db, STABLE)  # nivel cercano a 70, último valor 70, anterior 72
    add_rule(db, **CALIBRATED_HR)
    db.add(HealthBaseline(astronaut_id=1, indicator_code="HEART_RATE", baseline_value=48, std_dev=6.5, is_simulated=False))
    db.commit()
    r = run(db)
    assert r.status == "ok"
    assert all(p["projected_state"] == "WARNING" for p in r.forecast)
    tp = r.threshold_projection
    assert "baseline_delta" not in tp["ranges"]
    assert tp["ranges"]["normal"] == [51, 99] and tp["ranges"]["warning"] == [41, 119]
    assert tp["ranges"]["personal_yellow"] == pytest.approx([48 - Z_YELLOW * 6.5, 48 + Z_YELLOW * 6.5])
    assert tp["ranges"]["personal_red"] == pytest.approx([48 - Z_RED * 6.5, 48 + Z_RED * 6.5])
    assert tp["current_state"] == "WARNING"
    crossing = tp["first_expected_crossing"]
    assert crossing["days_ahead"] == 1 and crossing["state"] == "WARNING"
    assert crossing["direction"] == "above" and crossing["threshold"] == pytest.approx(67.5)
    assert crossing["reference"] == "personal_baseline" and crossing["alert_direction"] == "PERSONAL"
    rec = r.recommendation
    assert rec["basis"] == "currently_out_of_range" and rec["threshold"] == pytest.approx(67.5)
    assert rec["text"] == alert_rec.get_recommendation("HEART_RATE", "PERSONAL").followup
    assert rec["immediate_action"] == alert_rec.build_alert_texts("HEART_RATE", "PERSONAL", "WARNING")[0]
    # z publicado = z del motor
    assert r.z_score == pytest.approx((r.forecast[-1]["value"] - 48) / 6.5)


@pytest.mark.parametrize("baseline, expected", [
    (None, "WARNING"),                # sin línea base: solo el umbral absoluto
    ((100, 6.5, False), "MONITOR"),   # habitual para la persona: queda en observación
    ((80, 6.5, False), "WARNING"),    # además se aleja de la persona (z ≥ 2)
    ((100, 5.0, False), "WARNING"),   # DE de relleno: no cuenta como línea base
    ((100, 0.0, False), "WARNING"),   # DE no derivable (seed demo): tampoco
])
def test_absolute_yellow_is_warning_only_if_it_also_deviates_from_the_person(db, setup, baseline, expected):
    add_values(db, [v + 6 for v in NEAR_LIMIT])  # nivel cercano a 104 lpm: zona amarilla absoluta (> 99)
    add_rule(db, **CALIBRATED_HR)
    if baseline:
        mean, sd, simulated = baseline
        db.add(HealthBaseline(astronaut_id=1, indicator_code="HEART_RATE", baseline_value=mean, std_dev=sd, is_simulated=simulated))
        db.commit()
    r = run(db)
    assert r.status == "ok"
    assert all(p["projected_state"] == expected for p in r.forecast)
    crossing = r.threshold_projection["first_expected_crossing"]
    assert crossing["direction"] == "above" and crossing["alert_direction"] == "HIGH"
    assert crossing["threshold"] == 99 and crossing["reference"] == "absolute_range"
    assert (r.z_score is not None) == (baseline is not None and baseline[1] == 6.5)


def test_recommendation_falls_back_to_rule_text_without_catalog_entry(db, setup):
    """Un indicador sin entrada propia en el catálogo usa las instrucciones de la versión de regla; si la
    regla solo remite a la alerta, la entrada genérica del catálogo."""
    db.add(HealthIndicatorDefinition(
        code="CUSTOM_INDEX", name="Índice propio", category="TEST", body_region_code="CHEST", unit="pts",
        min_valid_value=0, max_valid_value=200, step_by_step_instructions="test",
        educational_summary="test", spaceflight_risk_explanation="test",
    ))
    db.commit()
    add_values(db, STABLE, code="CUSTOM_INDEX", unit="pts")
    add_rule(db, normal=(40, 65), monitor=(35, 140), warning=(30, 160), code="CUSTOM_INDEX")
    r = predict_indicator(db, 1, 1, "CUSTOM_INDEX", 7)
    assert r.status == "ok" and r.threshold_projection["current_state"] == "MONITOR"
    rec = r.recommendation
    assert rec["basis"] == "currently_out_of_range" and rec["direction"] == "above" and rec["threshold"] == 65
    assert rec["text"] == "Registrar medición de seguimiento (texto de la regla)."
    assert rec["immediate_action"] == "Instrucciones inmediatas de prueba."
    assert rec["source"] == "clinical_rule_followup_instructions"

    version = db.query(ClinicalRuleVersion).one()
    version.followup_instructions = alert_rec.RULE_FOLLOWUP_INSTRUCTIONS
    version.immediate_instructions = alert_rec.RULE_IMMEDIATE_INSTRUCTIONS
    db.commit()
    rec = predict_indicator(db, 1, 1, "CUSTOM_INDEX", 7).recommendation
    generic = alert_rec.CATALOG[(alert_rec.GENERIC, alert_rec.HIGH)]
    assert rec["text"] == generic.followup and rec["source"] == "alert_recommendation_catalog"
    assert rec["immediate_action"] == f"{generic.now}\n{alert_rec.LEVEL_STEP['MONITOR']}"


def test_no_rule_means_no_threshold_projection(db, setup):
    add_values(db, STABLE)
    r = run(db)
    assert r.status == "ok"
    assert r.threshold_projection is None and r.recommendation is None
    assert all(p["projected_state"] is None and p["interval_touches_threshold"] is None for p in r.forecast)
    assert "t_ahead" not in r.forecast[0]


def test_empirical_validation_flag(db, setup):
    """Solo pulso, presión sistólica, temperatura y frecuencia respiratoria se contrastaron con datos reales."""
    add_values(db, STABLE)
    r = run(db)
    assert r.empirical_validation["validated_with_real_data"] is True
    assert r.empirical_validation["is_spaceflight_data"] is False
    assert "análogo terrestre" in r.empirical_validation["note"]
    db.add(HealthIndicatorDefinition(
        code="SLEEP_DURATION", name="Sueño", category="TEST", body_region_code="HEAD", unit="horas",
        min_valid_value=0, max_valid_value=24, step_by_step_instructions="test",
        educational_summary="test", spaceflight_risk_explanation="test",
    ))
    db.commit()
    add_values(db, [7, 7.5, 6.5, 7, 8, 6, 7, 7.5, 6.5, 7, 7.5, 7], code="SLEEP_DURATION", unit="horas")
    other = predict_indicator(db, 1, 1, "SLEEP_DURATION", 7)
    assert other.status == "ok"
    assert other.empirical_validation["validated_with_real_data"] is False
    assert "sin validación empírica" in other.empirical_validation["note"]
    # El servicio pronostica tendencias de indicadores: ningún texto habla de predecir enfermedades
    for text in (r.method["description"], r.empirical_validation["note"], other.empirical_validation["note"], r.disclaimer):
        assert "enfermedad" not in text.lower() and "disease" not in text.lower()


def test_trend_reported_but_not_extrapolated_when_noise_dominates(db, setup):
    """Deriva real pequeña frente al ruido (como el pulso en reposo en cama): se informa, no se extrapola."""
    noise = [3, -4, 1, 5, -2, -5, 4, 0, -3, 2, 5, -1, -4, 3, 1, -2, 4, -5, 0, 2,
             -3, 5, -1, 1, -4, 3, 0, -2, 4, -5, 2, 1, -3, 5, -1, -4, 3, 0, 2, -2]
    add_values(db, [60 + 0.3 * i + 1.6 * e for i, e in enumerate(noise)])
    r = run(db)
    assert r.status == "ok"
    assert r.trend["direction"] == "rising" and r.trend["significant"] is True
    assert r.trend["slope_per_day"] == pytest.approx(0.3, abs=0.15)
    assert r.trend["extrapolated"] is False and r.method["model_used"] == "level"
    assert r.beta1 == pytest.approx(r.trend["slope_per_day"])  # compatibilidad: beta1 = pendiente observada
    assert len({p["value"] for p in r.forecast}) == 1
