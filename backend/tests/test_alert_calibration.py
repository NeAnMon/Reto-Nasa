"""SEMSA · Pruebas · Calibración del motor de alertas con los vitales reales de UTMB.

Pasa la función pura del motor (`rules.evaluation.evaluate_reading`) por todas las filas de
`backend/tests/data/utmb_vitales_diarios.csv` (29 voluntarios sanos en reposo en cama, 2 938 sujeto-días)
con la línea base personal de `utmb_lineas_base.csv`, y:

  a) imprime la tabla de tasas por indicador y por sujeto-día, antes (motor 1.0-DEMO) y después
     (motor calibrado con el dataset). Verla con: pytest backend/tests/test_alert_calibration.py -s
  b) fija cotas que protegen contra regresiones;
  c) cubre los 16 casos borde de `dataset-testing/muestra/casos_prueba.csv`.

Las líneas base se pasan como las tiene la app: media y DE del valor principal y media del secundario
(la tabla `health_baselines` no guarda la DE de la diastólica; el motor usa la mediana de UTMB).
Origen y licencia de los datos: backend/tests/data/LEEME.md.

Run from repository root: pytest backend/tests/test_alert_calibration.py -q -s
"""
import csv
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from backend.app.rules.calibration import CALIBRATION, PERSISTENCE_WINDOW_HOURS
from backend.app.rules.evaluation import (
    PersonalBaseline,
    PreviousReading,
    RollingWindow,
    evaluate_reading,
)

DATA_DIR = Path(__file__).resolve().parent / "data"
VITALS_CSV = DATA_DIR / "utmb_vitales_diarios.csv"
BASELINES_CSV = DATA_DIR / "utmb_lineas_base.csv"

RANK = {"NORMAL": 0, "MONITOR": 1, "WARNING": 2, "CRITICAL": 3}
STATES = ("NORMAL", "MONITOR", "WARNING", "CRITICAL")

# indicador -> (columna valor, columna secundaria, columnas de línea base: media, DE, media secundaria, DE secundaria)
INDICATORS = {
    "HEART_RATE": ("pulso_lpm", None, "pulso_lpm_media", "pulso_lpm_de", None, None),
    "BLOOD_PRESSURE": ("pas_mmhg", "pad_mmhg", "pas_mmhg_media", "pas_mmhg_de", "pad_mmhg_media", "pad_mmhg_de"),
    "BODY_TEMP": ("temp_c", None, "temp_c_media", "temp_c_de", None, None),
    "RESP_RATE": ("resp_rpm", None, "resp_rpm_media", "resp_rpm_de", None, None),
}
# Límites físicos de validación de la app (seed.INDICATORS_DATA)
VALID = {
    "HEART_RATE": (25.0, 240.0),
    "BLOOD_PRESSURE": (60.0, 250.0),
    "BODY_TEMP": (33.0, 42.5),
    "RESP_RATE": (6.0, 45.0),
}
UNITS = {"HEART_RATE": "bpm", "BLOOD_PRESSURE": "mmHg", "BODY_TEMP": "°C", "RESP_RATE": "rpm"}

# Motor anterior (versión 1.0-DEMO): umbrales fijos del seed y delta absoluto frente a la línea base.
# (normal_min, normal_max, monitor_min, monitor_max, warning_min, warning_max, baseline_delta)
LEGACY = {
    "HEART_RATE": (52.0, 90.0, 45.0, 102.0, 38.0, 115.0, 18.0),
    "BLOOD_PRESSURE": (95.0, 128.0, 88.0, 139.0, 80.0, 159.0, 16.0),
    "BODY_TEMP": (36.1, 37.3, 35.7, 37.8, 35.0, 38.4, 0.7),
    "RESP_RATE": (11.0, 18.0, 9.0, 22.0, 8.0, 26.0, 4.0),
}


def _num(raw):
    raw = (raw or "").strip()
    return float(raw) if raw else None


def legacy_state(code, value, secondary, baseline_mean):
    """Réplica del motor 1.0-DEMO (engine.py antes de la calibración), solo para la columna "antes"."""
    nmin, nmax, mmin, mmax, wmin, wmax, delta = LEGACY[code]
    if value < wmin or value > wmax:
        state = "CRITICAL"
    elif value < mmin or value > mmax:
        state = "WARNING"
    elif value < nmin or value > nmax:
        state = "MONITOR"
    else:
        state = "NORMAL"
    if code == "BLOOD_PRESSURE" and secondary is not None:
        if secondary >= 110 or secondary < 50:
            state = "CRITICAL"
        elif (secondary >= 95 or secondary < 55) and state != "CRITICAL":
            state = "WARNING"
        elif (secondary >= 86 or secondary < 60) and state == "NORMAL":
            state = "MONITOR"
    if baseline_mean is not None and state == "NORMAL" and abs(value - baseline_mean) >= delta:
        state = "MONITOR"
    return state


def dataset_red(code, value, secondary):
    """Rojo absoluto según las reglas del dataset (alertas.py), escrito aparte del motor."""
    if code == "HEART_RATE":
        return value >= 120 or value <= 40
    if code == "BLOOD_PRESSURE":
        return value >= 180 or (secondary is not None and secondary >= 120)
    if code == "BODY_TEMP":
        return value >= 38.0 or value <= 34.9
    if code == "RESP_RATE":
        return value >= 24
    return False


def dataset_yellow_or_red(code, value, secondary):
    if code == "HEART_RATE":
        return value >= 100 or value <= 50
    if code == "BLOOD_PRESSURE":
        return value >= 140 or value <= 90 or (secondary is not None and secondary >= 90)
    if code == "BODY_TEMP":
        return value >= 37.8 or value <= 34.9
    if code == "RESP_RATE":
        return value >= 21
    return False


@pytest.fixture(scope="module")
def baselines():
    with BASELINES_CSV.open(newline="", encoding="utf-8") as fh:
        return {row["sujeto"]: row for row in csv.DictReader(fh)}


@pytest.fixture(scope="module")
def subject_of(baselines):
    return {row["astronauta_id"]: sujeto for sujeto, row in baselines.items()}


@pytest.fixture(scope="module")
def vitals():
    with VITALS_CSV.open(newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    rows.sort(key=lambda r: (r["sujeto"], r["fecha"]))
    return rows


def personal_baseline(base_row, code):
    """Línea base tal como la guarda la app (sin DE de la diastólica). None si el sujeto no la tiene."""
    if base_row is None:
        return None
    _, _, mean_col, sd_col, sec_mean_col, _ = INDICATORS[code]
    mean, sd = _num(base_row[mean_col]), _num(base_row[sd_col])
    if mean is None or sd is None:
        return None
    return PersonalBaseline(mean=mean, sd=sd, secondary_mean=_num(base_row[sec_mean_col]) if sec_mean_col else None)


def worst_abs_z(code, value, secondary, base_row):
    """Mayor |z| de la lectura con la DE real de la persona (también la de la diastólica), o None."""
    if base_row is None:
        return None
    _, _, mean_col, sd_col, sec_mean_col, sec_sd_col = INDICATORS[code]
    zs = []
    mean, sd = _num(base_row[mean_col]), _num(base_row[sd_col])
    if mean is not None and sd:
        zs.append(abs(value - mean) / sd)
    if sec_mean_col and secondary is not None:
        sec_mean, sec_sd = _num(base_row[sec_mean_col]), _num(base_row[sec_sd_col])
        if sec_mean is not None and sec_sd:
            zs.append(abs(secondary - sec_mean) / sec_sd)
    return max(zs) if zs else None


def evaluate_all(vitals, baselines):
    """Evalúa cada lectura válida con el motor nuevo y con la réplica del anterior."""
    out = []
    previous = {}  # (sujeto, indicador) -> (fecha, PreviousReading)
    window = timedelta(hours=PERSISTENCE_WINDOW_HOURS)
    for row in vitals:
        base_row = baselines.get(row["sujeto"])
        when = datetime.strptime(row["fecha"], "%Y-%m-%d")
        for code, (col, sec_col, *_rest) in INDICATORS.items():
            value = _num(row[col])
            if value is None:
                continue
            secondary = _num(row[sec_col]) if sec_col else None
            baseline = personal_baseline(base_row, code)
            prev = previous.get((row["sujeto"], code))
            ev = evaluate_reading(
                code, value, secondary,
                unit=UNITS[code], min_valid=VALID[code][0], max_valid=VALID[code][1],
                baseline=baseline,
                previous=prev[1] if prev and when - prev[0] <= window else None,
            )
            if ev.state == "INVALID":
                continue
            previous[(row["sujeto"], code)] = (when, PreviousReading(value=value, secondary_value=secondary))
            out.append({
                "sujeto": row["sujeto"], "fecha": row["fecha"], "fase": row["fase"], "code": code,
                "value": value, "secondary": secondary, "new": ev.state, "ev": ev,
                # Variante sin la regla de confirmación: el desvío amarillo aislado alertaría (MONITOR)
                "new_unconfirmed": "MONITOR" if ev.state == "NORMAL" and ev.pending_confirmation else ev.state,
                "old": legacy_state(code, value, secondary, baseline.mean if baseline else None),
                "z": worst_abs_z(code, value, secondary, base_row),
            })
    return out


@pytest.fixture(scope="module")
def results(vitals, baselines):
    return evaluate_all(vitals, baselines)


def summarize(results, key):
    """Tasas del motor `key` ("old" o "new")."""
    per_ind = defaultdict(Counter)
    day_worst = {}
    for r in results:
        per_ind[r["code"]][r[key]] += 1
        k = (r["sujeto"], r["fecha"])
        if k not in day_worst or RANK[r[key]] > RANK[day_worst[k][0]]:
            day_worst[k] = (r[key], r["fase"])
    days = Counter(state for state, _ in day_worst.values())
    n_days = len(day_worst)
    phase_total, phase_alert, phase_wc = Counter(), Counter(), Counter()
    for state, fase in day_worst.values():
        phase_total[fase] += 1
        phase_alert[fase] += state != "NORMAL"
        phase_wc[fase] += state in ("WARNING", "CRITICAL")
    subj_days, subj_alert = Counter(), Counter()
    for (sujeto, _), (state, _) in day_worst.items():
        subj_days[sujeto] += 1
        subj_alert[sujeto] += state != "NORMAL"
    with_z = [r for r in results if r["z"] is not None]
    alerts_z = [r for r in with_z if r[key] != "NORMAL"]
    wc_z = [r for r in with_z if r[key] in ("WARNING", "CRITICAL")]
    # Desvíos fuertes (|z| ≥ 3) en los indicadores con regla de desvío personal en el dataset
    strong = [r for r in with_z if r["z"] >= 3 and CALIBRATION[r["code"]].deviation]
    return {
        "per_ind": per_ind,
        "n_days": n_days,
        "days": days,
        "day_alert_rate": (n_days - days["NORMAL"]) / n_days,
        "day_wc_rate": (days["WARNING"] + days["CRITICAL"]) / n_days,
        "phase": {f: (phase_total[f], phase_alert[f] / phase_total[f], phase_wc[f] / phase_total[f]) for f in phase_total},
        "alerts_within_2sd": sum(r["z"] < 2 for r in alerts_z) / max(len(alerts_z), 1),
        "n_alerts_z": len(alerts_z),
        "wc_within_2sd": sum(r["z"] < 2 for r in wc_z) / max(len(wc_z), 1),
        "n_wc_z": len(wc_z),
        "strong_missed": sum(r[key] in ("NORMAL", "MONITOR") for r in strong) / max(len(strong), 1),
        "n_strong": len(strong),
        "subjects": len(subj_days),
        "subjects_half": sum(subj_alert[s] / subj_days[s] >= 0.5 for s in subj_days),
        "subject_max": max(subj_alert[s] / subj_days[s] for s in subj_days),
    }


def _pct(x):
    return f"{100 * x:5.1f} %"


def test_calibration_table_and_regression_bounds(results):
    """(a) Tabla antes → después y (b) cotas contra regresiones, sobre los 2 938 sujeto-días de UTMB."""
    old, new = summarize(results, "old"), summarize(results, "new")

    lines = ["", "=== Motor de alertas sobre UTMB: antes (1.0-DEMO) → después (calibrado con el dataset) ==="]
    lines.append(f"Lecturas válidas: {len(results)} · sujeto-días: {new['n_days']} · sujetos: {new['subjects']}")
    lines.append("")
    lines.append("Por lectura (indicador)        n      NORMAL            MONITOR           WARNING           CRITICAL")
    for code in INDICATORS:
        n = sum(old["per_ind"][code].values())
        cells = "   ".join(
            f"{_pct(old['per_ind'][code][s] / n)}→{_pct(new['per_ind'][code][s] / n)}" for s in STATES
        )
        lines.append(f"  {code:<16} {n:>6}   {cells}")
        lines.append(
            f"  {'':<16} {'':>6}   (n: "
            + ", ".join(f"{s} {old['per_ind'][code][s]}→{new['per_ind'][code][s]}" for s in STATES) + ")"
        )
    lines.append("")
    lines.append("Por sujeto-día (peor estado de los 4 vitales)")
    for s in STATES:
        lines.append(
            f"  {s:<9} {old['days'][s]:>5} días ({_pct(old['days'][s] / old['n_days'])}) → "
            f"{new['days'][s]:>5} días ({_pct(new['days'][s] / new['n_days'])})"
        )
    lines.append(f"  Días con alguna alerta (≥ MONITOR): {_pct(old['day_alert_rate'])} → {_pct(new['day_alert_rate'])}")
    lines.append(f"  Días con WARNING o CRITICAL:        {_pct(old['day_wc_rate'])} → {_pct(new['day_wc_rate'])}")
    for fase in ("pre", "mision", "post"):
        if fase in new["phase"]:
            n, a_old, w_old = old["phase"][fase]
            _, a_new, w_new = new["phase"][fase]
            lines.append(
                f"  fase {fase:<7} n={n:>4}  ≥ MONITOR {_pct(a_old)} → {_pct(a_new)}   WARNING+CRITICAL {_pct(w_old)} → {_pct(w_new)}"
            )
    lines.append("")
    lines.append("Coherencia con la línea base personal (z con la DE real de cada sujeto)")
    lines.append(
        f"  Alertas (≥ MONITOR) con |z| < 2:   {_pct(old['alerts_within_2sd'])} de {old['n_alerts_z']} → "
        f"{_pct(new['alerts_within_2sd'])} de {new['n_alerts_z']}"
    )
    lines.append(
        f"  WARNING/CRITICAL con |z| < 2:      {_pct(old['wc_within_2sd'])} de {old['n_wc_z']} → "
        f"{_pct(new['wc_within_2sd'])} de {new['n_wc_z']}"
    )
    lines.append(
        f"  Lecturas con |z| ≥ 3 que quedan en NORMAL o MONITOR: {_pct(old['strong_missed'])} → "
        f"{_pct(new['strong_missed'])} de {new['n_strong']}"
    )
    lines.append(
        f"  Sujetos con alerta en ≥ 50 % de sus días: {old['subjects_half']} → {new['subjects_half']} de {new['subjects']} "
        f"(máximo {_pct(old['subject_max'])} → {_pct(new['subject_max'])})"
    )
    pending = sum(r["ev"].pending_confirmation and r["new"] == "NORMAL" for r in results)
    lines.append(f"  Desvíos personales amarillos aislados que esperan confirmación (no alertan): {pending} lecturas")
    unconfirmed = summarize(results, "new_unconfirmed")
    lines.append(
        "  Efecto de exigir confirmación al desvío amarillo: días con alguna alerta "
        f"{_pct(unconfirmed['day_alert_rate'])} (sin exigirla) → {_pct(new['day_alert_rate'])}; "
        f"WARNING+CRITICAL {_pct(unconfirmed['day_wc_rate'])} → {_pct(new['day_wc_rate'])}; "
        f"sujetos con alerta en ≥ 50 % de sus días {unconfirmed['subjects_half']} → {new['subjects_half']}"
    )
    print("\n".join(lines))

    # El conjunto de datos es el esperado (misma copia que usa el agente de predicción)
    assert new["subjects"] == 29
    assert new["n_days"] == 2938

    # Línea base 1.0-DEMO: reproduce lo medido antes de calibrar (52 % de días con alerta, 9,4 % W+C)
    assert 0.50 <= old["day_alert_rate"] <= 0.54
    assert 0.09 <= old["day_wc_rate"] <= 0.10

    # Cotas del motor calibrado (medido: 17,7 % de días con alerta y 7,9 % con WARNING o CRITICAL)
    assert new["day_alert_rate"] <= 0.20
    assert new["day_alert_rate"] <= 0.5 * old["day_alert_rate"]
    assert new["day_wc_rate"] <= 0.085
    assert new["day_wc_rate"] < old["day_wc_rate"]
    # En la fase previa (voluntarios sanos, ambulatorios) las alertas graves son raras
    assert new["phase"]["pre"][2] <= 0.04

    # Las alertas ya no ignoran la línea base personal. Medido con el mayor |z| de la lectura (DE real
    # de la persona, diastólica incluida): antes 71 % de las alertas y 49 % de las WARNING/CRITICAL
    # tenían |z| < 2; ahora 39 % (casi todo MONITOR "amarillo pero habitual") y 4 %.
    assert old["alerts_within_2sd"] >= 0.65
    assert old["wc_within_2sd"] >= 0.40
    assert new["alerts_within_2sd"] <= 0.45
    # Lo que queda son rojos absolutos con |z| < 2 (nunca se atenúan) y diastólicas evaluadas con la DE
    # de referencia de UTMB porque la app no guarda la DE personal de la diastólica.
    assert new["wc_within_2sd"] <= 0.06
    # ...ni dejan pasar un desvío fuerte (antes 7 de cada 10 lecturas con |z| ≥ 3 quedaban en NORMAL o
    # MONITOR). El resto (medido: 13 de 191) son diastólicas con |z| ≥ 3 por la DE personal pero < 3
    # con la DE de referencia.
    assert old["strong_missed"] >= 0.50
    assert new["strong_missed"] <= 0.10

    # La "tendencia" del motor anterior (código muerto) es ahora esta regla de confirmación, y se mide:
    # quita alrededor de un tercio de los días con alerta sin tocar WARNING ni CRITICAL
    assert unconfirmed["day_wc_rate"] == new["day_wc_rate"]
    assert 0.25 <= unconfirmed["day_alert_rate"] <= 0.30
    assert new["day_alert_rate"] <= 0.7 * unconfirmed["day_alert_rate"]

    # Menos personas con alerta crónica
    assert new["subjects_half"] <= 3
    assert new["subjects_half"] < old["subjects_half"]


def test_every_dataset_absolute_red_is_critical(results):
    """El rojo absoluto del dataset nunca se retrasa ni se atenúa: siempre CRITICAL, y solo él lo es."""
    reds = [r for r in results if dataset_red(r["code"], r["value"], r["secondary"])]
    assert len(reds) >= 5, "el dataset tiene lecturas en zona roja (p. ej. pulso 130, temperatura 34,5 °C)"
    assert all(r["new"] == "CRITICAL" for r in reds), [
        (r["sujeto"], r["fecha"], r["code"], r["value"], r["new"]) for r in reds if r["new"] != "CRITICAL"
    ]
    criticals = [r for r in results if r["new"] == "CRITICAL"]
    assert len(criticals) == len(reds)
    # Un rojo con |z| < 2 (p. ej. bradicardia de un sujeto entrenado) también es CRITICAL
    assert any(r["z"] is not None and r["z"] < 2 for r in reds)


def test_warning_always_has_a_reason_from_the_dataset(results):
    """WARNING = amarillo absoluto del dataset alejado de la línea base (o sin ella), o desvío personal rojo."""
    for r in results:
        if r["new"] != "WARNING":
            continue
        yellow = dataset_yellow_or_red(r["code"], r["value"], r["secondary"])
        strong = r["z"] is not None and r["z"] >= 3
        ev = r["ev"]
        deviates = any(z is not None and abs(z) >= 2 for z in (ev.z, ev.z_secondary))
        assert (yellow and (deviates or not ev.baseline_valid)) or strong or deviates, (
            r["sujeto"], r["fecha"], r["code"], r["value"], r["secondary"], ev.reasons,
        )


def test_monitor_from_personal_deviation_needs_two_readings(results):
    """Un desvío personal amarillo aislado no alerta; el confirmado por la lectura anterior sí (MONITOR)."""
    personal_monitor = [r for r in results if r["new"] == "MONITOR" and r["ev"].direction == "PERSONAL"]
    pending = [r for r in results if r["new"] == "NORMAL" and r["ev"].pending_confirmation]
    assert personal_monitor and pending
    assert all("confirmado en dos lecturas seguidas" in " ".join(r["ev"].reasons) for r in personal_monitor)
    assert all("pendiente de confirmar" in " ".join(r["ev"].reasons) for r in pending)


# --------------------------------------------------------------------------------------------------
# (c) Los 16 casos borde de dataset-testing/muestra/casos_prueba.csv
# --------------------------------------------------------------------------------------------------
# (caso, astronauta_id, fecha original, {indicador: estado esperado con el motor calibrado})
CASES_FROM_VITALS = [
    (1, "UTMB-26", "2007-10-23", {"HEART_RATE": "CRITICAL", "BLOOD_PRESSURE": "NORMAL"}),      # FC 130: rojo
    (2, "UTMB-26", "2007-10-17", {"HEART_RATE": "WARNING", "BLOOD_PRESSURE": "NORMAL"}),       # FC 115 amarillo + z 2,7
    (3, "UTMB-05", "2005-04-13", {"HEART_RATE": "CRITICAL", "BODY_TEMP": "NORMAL"}),           # FC 38: rojo aunque z −1,4
    (4, "UTMB-21", "2006-08-21", {"BODY_TEMP": "CRITICAL", "HEART_RATE": "NORMAL"}),           # T 34,5: rojo
    (5, "UTMB-21", "2006-06-17", {"BODY_TEMP": "WARNING"}),                                    # T 37,8: borde amarillo + z 2,9
    (6, "UTMB-34", "2009-03-14", {"BODY_TEMP": "WARNING"}),                                    # T 37,9 amarillo + z 2,1
    (7, "UTMB-01", "2005-03-05", {"BLOOD_PRESSURE": "WARNING"}),                               # 161/90: amarillo, ya no CRITICAL
    (8, "UTMB-22", "2007-04-24", {"BLOOD_PRESSURE": "WARNING"}),                               # PAS 156 + z 3,7
    (9, "UTMB-01", "2005-05-17", {"BLOOD_PRESSURE": "WARNING"}),                               # 120/46: desvío de la PAD, ya no CRITICAL
    (10, "UTMB-05", "2005-04-08", {"HEART_RATE": "WARNING"}),                                  # FC 90 con base 51: z 4,3
    (11, "UTMB-14", "2010-02-14", {"BODY_TEMP": "WARNING"}),                                   # T 35,1: z −4,4
    (12, "UTMB-13", "2009-09-21", {"BODY_TEMP": "WARNING", "HEART_RATE": "NORMAL"}),           # T 37,6: z 3,9
    (13, "UTMB-07", "2008-01-16", {"RESP_RATE": "MONITOR"}),                                   # FR 22 habitual (base 19,4)
    (14, "UTMB-05", "2005-02-27", {"HEART_RATE": "MONITOR", "BLOOD_PRESSURE": "NORMAL"}),      # FC 44 habitual (base 51)
]


@pytest.mark.parametrize("case, astronaut, fecha, expected", CASES_FROM_VITALS, ids=[f"caso{c[0]}" for c in CASES_FROM_VITALS])
def test_edge_cases_from_real_vitals(results, subject_of, case, astronaut, fecha, expected):
    sujeto = subject_of[astronaut]
    by_code = {r["code"]: r for r in results if r["sujeto"] == sujeto and r["fecha"] == fecha}
    assert by_code, f"caso {case}: no hay fila para {astronaut} ({sujeto}) el {fecha}"
    got = {code: by_code[code]["new"] for code in expected}
    assert got == expected, {code: by_code[code]["ev"].reasons for code in expected}


def test_edge_case_details(results, subject_of):
    """Dirección y componente de algunos casos: de ahí sale la recomendación de la alerta."""
    def ev(astronaut, fecha, code):
        sujeto = subject_of[astronaut]
        return next(r["ev"] for r in results if r["sujeto"] == sujeto and r["fecha"] == fecha and r["code"] == code)

    assert ev("UTMB-26", "2007-10-23", "HEART_RATE").direction == "HIGH"
    assert ev("UTMB-05", "2005-04-13", "HEART_RATE").direction == "LOW"
    assert ev("UTMB-21", "2006-08-21", "BODY_TEMP").direction == "LOW"
    # Caso 2: PAS 122 con z 2,1 pero la víspera no estaba desviada → queda pendiente, sin alerta
    assert ev("UTMB-26", "2007-10-17", "BLOOD_PRESSURE").pending_confirmation is True
    # Caso 7: la sistólica (161, z 2,2) manda; la diastólica 90 es amarilla pero habitual
    case7 = ev("UTMB-01", "2005-03-05", "BLOOD_PRESSURE")
    assert (case7.direction, case7.component) == ("HIGH", "PRIMARY")
    assert any("Presión diastólica 90 mmHg" in reason and "habitual" in reason for reason in case7.reasons)
    # Caso 9: PAD 46 no tiene umbral absoluto en el dataset; alerta por desvío personal de la diastólica
    case9 = ev("UTMB-01", "2005-05-17", "BLOOD_PRESSURE")
    assert (case9.direction, case9.component) == ("PERSONAL", "SECONDARY")
    assert case9.absolute_level == 0
    # Caso 10: dentro del rango absoluto, alerta solo por la línea base personal
    case10 = ev("UTMB-05", "2005-04-08", "HEART_RATE")
    assert case10.direction == "PERSONAL" and case10.absolute_level == 0
    # Caso 13 y 14: amarillo absoluto pero habitual para la persona
    assert ev("UTMB-07", "2008-01-16", "RESP_RATE").direction == "HIGH"
    assert ev("UTMB-05", "2005-02-27", "HEART_RATE").direction == "LOW"


def test_edge_case_15_glucose_only_in_app():
    """Caso 15 (UTMB-01, laboratorio día 91): glucosa 63 mg/dL. Por debajo del rango de referencia i-STAT
    del dataset (70–105) → amarillo; sin línea base → WARNING. El rojo (< 60) no tiene respaldo en el dataset."""
    ev = evaluate_reading("BLOOD_GLUCOSE", 63.0, unit="mg/dL", min_valid=40.0, max_valid=400.0)
    assert (ev.state, ev.direction) == ("WARNING", "LOW")
    assert evaluate_reading("BLOOD_GLUCOSE", 81.0, unit="mg/dL").state == "NORMAL"
    assert "sin respaldo en el dataset" in CALIBRATION["BLOOD_GLUCOSE"].source


def test_edge_case_16_sleep_window_and_mood_baseline():
    """Caso 16 (UTMB-38, días −1 a 1): sueño 7,7–7,9 h y ánimo 5,9 y 4,5.
    Sueño: la regla del dataset usa la media de 7 noches (mínimo 4): con 3 noches no alerta.
    Ánimo: línea base de la fase previa del sujeto en el dataset (6,49 ± 0,67, dato simulado)."""
    nights = [7.733, 7.833, 7.867]
    window = RollingWindow(mean=sum(nights) / len(nights), count=len(nights))
    assert evaluate_reading("SLEEP_DURATION", nights[-1], unit="h", window=window).state == "NORMAL"
    full = RollingWindow(mean=7.75, count=7)
    assert evaluate_reading("SLEEP_DURATION", 7.7, unit="h", window=full).state == "NORMAL"

    mood_base = PersonalBaseline(mean=6.49, sd=0.671)
    day0 = evaluate_reading("MOOD_WELLNESS", 5.9, unit="escala 1-10", baseline=mood_base)
    day1 = evaluate_reading(
        "MOOD_WELLNESS", 4.5, unit="escala 1-10", baseline=mood_base, previous=PreviousReading(value=5.9)
    )
    # 5,9 y 4,5 caen en la banda de observación absoluta (umbrales de 1.0-DEMO, sin respaldo en el dataset)
    assert day0.state == "MONITOR" and day1.state == "MONITOR"
    # La regla del dataset (z ≤ −2) ve el 4,5 (z −3,0) pero no el 5,9 (z −0,9); nunca pasa de MONITOR
    assert day0.z > -2 and day1.z <= -2
    assert "sin respaldo en el dataset" in CALIBRATION["MOOD_WELLNESS"].source
