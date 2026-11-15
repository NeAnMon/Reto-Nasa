"""SEMSA · Pruebas · Calibración del pronóstico con datos reales (NASA UTMB, reposo en cama).

Backtest de origen móvil de la lógica pura de `prediction_service.forecast_series` sobre
`backend/tests/data/utmb_vitales_diarios.csv`: 29 voluntarios en reposo en cama con la cabeza
inclinada (análogo terrestre de la microgravedad; NO son datos de vuelo espacial), fase `mision`,
un dato por sujeto y día. En cada día con al menos 10 días de historia se pronostican los 1–14 días
siguientes con lo que el servicio habría visto ese día (ventana de 90 días) y se compara con el
valor real.

Los hiperparámetros se afinaron en una mitad de los sujetos (`tune`) y se confirmaron en la otra
(`conf`); las tablas se imprimen por mitad. Las cotas protegen contra regresiones:

- error del método ≤ error de la media de 7 días (margen pequeño) y < error del último valor;
- cobertura real de las bandas del 80 % y 95 % a ±5 puntos de la nominal;
- la compuerta de fiabilidad separa pronósticos con más error;
- la prueba de tendencia no supera su tasa nominal de falsos positivos sobre ruido blanco.

Ver las tablas: pytest backend/tests/test_prediction_calibration.py -s
"""
import csv
import math
import random
import time
from pathlib import Path

import pytest

from backend.app.services import prediction_service as ps

DATA = Path(__file__).resolve().parent / "data" / "utmb_vitales_diarios.csv"
# indicador de SEMSA -> columna del dataset
INDICATORS = {
    "HEART_RATE": "pulso_lpm",
    "BLOOD_PRESSURE": "pas_mmhg",   # el servicio pronostica el valor principal: la sistólica
    "BODY_TEMP": "temp_c",
    "RESP_RATE": "resp_rpm",
}
BUCKETS = ("h1", "h2-3", "h4-7", "h8-14")
HALVES = ("tune", "conf")
H = ps.MAX_HORIZON
SEED = 20261115


def _bucket(h):
    return "h1" if h == 1 else "h2-3" if h <= 3 else "h4-7" if h <= 7 else "h8-14"


def _load():
    """{(indicador, sujeto): [(día de misión, valor)]} y la mitad (tune/conf) de cada sujeto."""
    series, campaign = {}, {}
    with open(DATA, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            if row["fase"] != "mision":
                continue
            subject = row["sujeto"]
            campaign[subject] = row["campana"]
            day = int(float(row["dia_mision"]))
            for code, column in INDICATORS.items():
                raw = (row[column] or "").strip()
                if raw:
                    series.setdefault((code, subject), []).append((day, float(raw)))
    for points in series.values():
        points.sort()
    # Mitades deterministas y equilibradas por campaña: sujetos ordenados, alternando.
    ordered = sorted(campaign, key=lambda s: (campaign[s], s))
    half = {s: HALVES[i % 2] for i, s in enumerate(ordered)}
    return series, half


def _quantile(sorted_values, p):
    i = p * (len(sorted_values) - 1)
    lo = int(math.floor(i))
    hi = min(lo + 1, len(sorted_values) - 1)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (i - lo)


def _log_fit(by_h):
    xs = [math.log(h) for h in sorted(by_h)]
    ys = [by_h[h] for h in sorted(by_h)]
    mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    return my - b * mx, b


@pytest.fixture(scope="module")
def backtest():
    started = time.time()
    series, half = _load()
    err = {}       # (mitad, indicador, tramo) -> [n, método, último, media7, ols]
    cover = {}     # (mitad, indicador, tramo) -> [n, dentro80, arriba80, abajo80, dentro95, arriba95, abajo95]
    by_n = {}      # (tamaño de serie) -> igual que cover
    gate = {}      # (indicador, ok/rej) -> [orígenes, n, método, último, método/escala, n con escala]
    trend = {}     # indicador -> [orígenes, significativa, extrapolada, subiendo, bajando]
    ratios = {80: {}, 95: {}}  # nivel -> h -> [|e| / (semiamplitud base · t)] en la mitad de afinado
    n_origins = 0

    def add(table, key, values):
        row = table.setdefault(key, [0.0] * len(values))
        for i, v in enumerate(values):
            row[i] += v

    for (code, subject), points in series.items():
        hf = half[subject]
        days = [p[0] for p in points]
        values = [p[1] for p in points]
        for i in range(len(points)):
            day = days[i]
            lo = 0
            while days[lo] < day - ps.MAX_HISTORY_DAYS:
                lo += 1
            xs = [d - days[lo] for d in days[lo:i + 1]]
            ys = values[lo:i + 1]
            if len(ys) < ps.MIN_DAYS:
                continue
            targets = [(days[j] - day, values[j]) for j in range(i + 1, len(points)) if days[j] - day <= H]
            if not targets:
                continue
            n_origins += 1
            res = ps.forecast_series(xs, ys, H)
            assert res["status"] in ("ok", "model_not_reliable") and len(res["points"]) == H
            last = ys[-1]
            mean7 = sum(ys[-7:]) / len(ys[-7:])
            line = ps._fit_line(xs, ys)  # recta OLS de la primera versión del servicio (sin compuerta)
            base = res["interval_base"]
            ok = "ok" if res["status"] == "ok" else "rej"
            tr = res["trend"]
            add(trend, code, [1, tr["significant"], tr["extrapolated"], tr["direction"] == "rising", tr["direction"] == "falling"])
            add(gate, (code, ok), [1, 0, 0, 0, 0, 0])
            size = "n10-19" if len(ys) < 20 else "n20-39" if len(ys) < 40 else "n40+"
            for h, actual in targets:
                p = res["points"][h - 1]
                e = actual - p["value"]
                ols = line["intercept"] + line["slope"] * (xs[-1] + h)
                row = [1, abs(e), abs(actual - last), abs(actual - mean7), abs(actual - ols)]
                in80 = p["lower_80"] <= actual <= p["upper_80"]
                in95 = p["lower_95"] <= actual <= p["upper_95"]
                crow = [1, in80, (not in80) and e > 0, (not in80) and e < 0, in95, (not in95) and e > 0, (not in95) and e < 0]
                for b in (_bucket(h), "all"):
                    add(err, (hf, code, b), row)
                    add(cover, (hf, code, b), crow)
                add(by_n, size, crow)
                scaled = abs(e) / base["scale"] if base and base["scale"] > 0 else None
                add(gate, (code, ok), [0, 1, abs(e), abs(actual - last), scaled or 0.0, scaled is not None])
                if hf == "tune" and base:
                    side = base["up"] if e >= 0 else base["down"]
                    if side > 0:
                        for level in (80, 95):
                            ratios[level].setdefault(h, []).append(abs(e) / (side * base["t"][level]))
    return {
        "err": err, "cover": cover, "by_n": by_n, "gate": gate, "trend": trend, "ratios": ratios,
        "n_origins": n_origins, "seconds": time.time() - started,
    }


def _sum_rows(table, keys):
    rows = [table[k] for k in keys if k in table]
    return [sum(r[i] for r in rows) for i in range(len(rows[0]))]


def test_point_forecast_beats_naive_baselines(backtest):
    err = backtest["err"]
    print(f"\n== Backtest UTMB: {backtest['n_origins']} orígenes, {int(sum(v[0] for k, v in err.items() if k[2] == 'all'))} "
          f"pronósticos, {backtest['seconds']:.1f} s ==")
    print("MAE fuera de muestra (unidades del indicador). Razones < 1: el método es mejor.")
    for hf in HALVES + ("todos",):
        print(f"-- mitad {hf}")
        print(f"{'indicador':15s}{'horiz.':7s}{'n':>7s}{'método':>8s}{'último':>8s}{'media7':>8s}{'OLS v1':>8s}"
              f"{'mét/últ':>9s}{'mét/med7':>9s}{'mét/OLS':>9s}")
        for code in INDICATORS:
            for b in BUCKETS + ("all",):
                keys = [(h, code, b) for h in (HALVES if hf == "todos" else (hf,))]
                n, m, last, m7, ols = _sum_rows(err, keys)
                print(f"{code:15s}{b:7s}{int(n):7d}{m / n:8.3f}{last / n:8.3f}{m7 / n:8.3f}{ols / n:8.3f}"
                      f"{m / last:9.3f}{m / m7:9.3f}{m / ols:9.3f}")
                # Cotas: nunca peor que el último valor; como mucho un 2 % peor que la media de 7 días
                # en un tramo o mitad concretos, y no peor (margen del 1 %) en el total del indicador.
                assert m < last, (hf, code, b)
                assert m <= 1.02 * m7, (hf, code, b)
                if hf == "todos" and b == "all":
                    assert m <= 1.01 * m7, code
                    assert m < ols, code


def test_prediction_intervals_are_calibrated(backtest):
    cover = backtest["cover"]

    def line(row):
        n = row[0]
        return (f"n={int(n):6d}  80 % -> {100 * row[1] / n:5.1f} (fuera: arriba {100 * row[2] / n:4.1f} / abajo {100 * row[3] / n:4.1f})"
                f"   95 % -> {100 * row[4] / n:5.1f} (arriba {100 * row[5] / n:4.1f} / abajo {100 * row[6] / n:4.1f})")

    print("\n== Cobertura real de las bandas de predicción ==")
    for hf in HALVES + ("todos",):
        halves = HALVES if hf == "todos" else (hf,)
        print(f"-- mitad {hf}")
        for code in INDICATORS:
            row = _sum_rows(cover, [(h, code, "all") for h in halves])
            print(f"  {code:15s} {line(row)}")
            # Objetivo: cobertura real a ±5 puntos de la nominal, por indicador y en cada mitad.
            assert abs(100 * row[1] / row[0] - 80) <= 5, (hf, code, "80")
            assert abs(100 * row[4] / row[0] - 95) <= 5, (hf, code, "95")
        for b in BUCKETS:
            row = _sum_rows(cover, [(h, code, b) for h in halves for code in INDICATORS])
            print(f"  {'horizonte ' + b:15s} {line(row)}")
            assert abs(100 * row[1] / row[0] - 80) <= 5 and abs(100 * row[4] / row[0] - 95) <= 5, (hf, b)
    print("-- por longitud de la serie (todos)")
    for size in ("n10-19", "n20-39", "n40+"):
        print(f"  {size:15s} {line(backtest['by_n'][size])}")

    # Las constantes de inflación del servicio son las ajustadas en la mitad de afinado.
    print("-- inflación c_p(h) = a + b·ln(h) reajustada en la mitad de afinado frente a la del servicio")
    for level in ps.INTERVAL_LEVELS:
        by_h = {h: _quantile(sorted(v), level / 100) for h, v in backtest["ratios"][level].items()}
        a, b = _log_fit(by_h)
        sa, sb = ps.PI_INFLATION[level]
        print(f"  {level} %: ajuste a={a:.4f} b={b:.4f} | servicio a={sa:.4f} b={sb:.4f}")
        assert abs(a - sa) <= 0.02 and abs(b - sb) <= 0.01, level
        assert sb > 0  # la banda se ensancha con el horizonte

    # La banda se ensancha con el horizonte y la del 95 % contiene a la del 80 %.
    rng = random.Random(SEED)
    ys = [70 + rng.gauss(0, 4) for _ in range(40)]
    points = ps.forecast_series(list(range(40)), ys, H)["points"]
    widths80 = [p["upper_80"] - p["lower_80"] for p in points]
    widths95 = [p["upper_95"] - p["lower_95"] for p in points]
    assert all(b > a for a, b in zip(widths80, widths80[1:]))
    assert all(b > a for a, b in zip(widths95, widths95[1:]))
    assert all(p["lower_95"] < p["lower_80"] < p["value"] < p["upper_80"] < p["upper_95"] for p in points)


def test_reliability_gate_discriminates(backtest):
    gate = backtest["gate"]
    print("\n== Compuerta de fiabilidad (habilidad frente al último valor en la validación dentro de la serie) ==")
    print(f"{'indicador':15s}{'% ok':>7s}{'MAE ok':>9s}{'MAE rech.':>10s}{'MAE/escala ok':>15s}{'rech.':>7s}{'mét/últ ok':>12s}{'rech.':>7s}")
    total = {"ok": [0.0] * 6, "rej": [0.0] * 6}
    for code in INDICATORS:
        ok = gate.get((code, "ok"), [0.0] * 6)
        rej = gate.get((code, "rej"), [0.0] * 6)
        for name, row in (("ok", ok), ("rej", rej)):
            total[name] = [a + b for a, b in zip(total[name], row)]
        share_rej = rej[0] / (ok[0] + rej[0])
        mae_ok, mae_rej = ok[2] / ok[1], (rej[2] / rej[1] if rej[1] else float("nan"))
        print(f"{code:15s}{100 * (1 - share_rej):7.1f}{mae_ok:9.3f}{mae_rej:10.3f}{ok[4] / ok[5]:15.3f}"
              f"{(rej[4] / rej[5] if rej[5] else float('nan')):7.3f}{ok[2] / ok[3]:12.3f}{(rej[2] / rej[3] if rej[3] else float('nan')):7.3f}")
        # Donde la compuerta rechaza una parte apreciable (≥ 3 %), lo rechazado tiene más error.
        if share_rej >= 0.03:
            assert mae_rej > mae_ok, code
    ok, rej = total["ok"], total["rej"]
    print(f"{'TODOS':15s}{100 * ok[0] / (ok[0] + rej[0]):7.1f}{'':9s}{'':10s}{ok[4] / ok[5]:15.3f}{rej[4] / rej[5]:7.3f}")
    # En conjunto (error relativo a la dispersión de cada serie) lo aceptado se equivoca menos.
    assert ok[4] / ok[5] < rej[4] / rej[5]
    assert 0.5 < ok[0] / (ok[0] + rej[0]) < 1.0

    # Series sintéticas: el ruido blanco alrededor de un nivel estable SÍ es pronosticable como nivel
    # (pronóstico plano con banda), así que debe pasar; un paseo aleatorio no, y debe rechazarse.
    rng = random.Random(SEED)
    print("-- series sintéticas sin tendencia: % que pasa como 'ok' / % en que se extrapola una tendencia")
    rates = {}
    for kind in ("ruido blanco", "AR(1) 0,5", "paseo aleatorio"):
        for n in (10, 20, 45, 90):
            reps = 400
            passed = extrapolated = 0
            for _ in range(reps):
                ys, prev = [], 0.0
                for _i in range(n):
                    e = rng.gauss(0, 1)
                    prev = e if kind == "ruido blanco" else 0.5 * prev + e if kind == "AR(1) 0,5" else prev + e
                    ys.append(70 + 5 * prev)
                res = ps.forecast_series(list(range(n)), ys, 7)
                passed += res["status"] == "ok"
                extrapolated += res["trend"]["extrapolated"]
            rates[(kind, n)] = (passed / reps, extrapolated / reps)
            print(f"  {kind:16s} n={n:2d}: ok={100 * passed / reps:5.1f} %  tendencia extrapolada={100 * extrapolated / reps:4.1f} %")
    assert rates[("ruido blanco", 45)][0] >= 0.95 and rates[("ruido blanco", 90)][0] >= 0.95
    assert rates[("paseo aleatorio", 90)][0] <= 0.10 and rates[("paseo aleatorio", 45)][0] <= 0.25
    assert all(rates[("ruido blanco", n)][1] <= 0.01 for n in (10, 20, 45, 90))


def test_trend_test_false_positive_rate_on_white_noise(backtest):
    rng = random.Random(SEED)
    print(f"\n== Prueba de tendencia (alfa nominal = {ps.TREND_ALPHA}): % de series SIN tendencia declaradas significativas ==")
    total = hits = 0
    for n in (10, 20, 45, 90):
        reps = 4000
        count = 0
        for _ in range(reps):
            ys = [70 + 5 * rng.gauss(0, 1) for _ in range(n)]
            count += ps.assess_trend(list(range(n)), ys)["significant"]
        total += reps
        hits += count
        print(f"  ruido blanco n={n:2d}: {100 * count / reps:.2f} %")
        assert count / reps <= 2 * ps.TREND_ALPHA, n   # cada tamaño: como mucho el doble de la nominal
    print(f"  ruido blanco, todos los tamaños: {100 * hits / total:.2f} % (nominal {100 * ps.TREND_ALPHA:.0f} %)")
    assert 0.2 * ps.TREND_ALPHA <= hits / total <= 1.5 * ps.TREND_ALPHA

    for n in (20, 45, 90):  # informativo: ruido autocorrelacionado (no es ruido blanco)
        count = 0
        for _ in range(1000):
            ys, prev = [], 0.0
            for _i in range(n):
                prev = 0.5 * prev + rng.gauss(0, 1)
                ys.append(70 + 5 * prev)
            count += ps.assess_trend(list(range(n)), ys)["significant"]
        print(f"  AR(1) 0,5 n={n:2d}: {100 * count / 1000:.2f} %")

    # Control positivo: una deriva real se detecta y, si domina al ruido, se extrapola.
    print("-- deriva real (control positivo): % significativa / % extrapolada")
    for label, slope, sd, min_sig, min_used in (("0,3/día con ruido 5 (como el pulso en reposo en cama)", 0.3, 5.0, 0.90, None),
                                                ("1/día con ruido 3", 1.0, 3.0, 0.99, 0.95)):
        sig = used = 0
        reps = 300
        for _ in range(reps):
            ys = [70 + slope * i + sd * rng.gauss(0, 1) for i in range(45)]
            res = ps.forecast_series(list(range(45)), ys, 7)
            sig += res["trend"]["significant"] and res["trend"]["direction"] == "rising"
            used += res["trend"]["extrapolated"]
        print(f"  {label}: {100 * sig / reps:.1f} % / {100 * used / reps:.1f} %")
        assert sig / reps >= min_sig
        if min_used is not None:
            assert used / reps >= min_used

    print("-- datos reales UTMB: % de orígenes con tendencia significativa (subiendo/bajando) y % extrapolada")
    for code, row in backtest["trend"].items():
        print(f"  {code:15s} significativa={100 * row[1] / row[0]:5.1f} % (sube {100 * row[3] / row[0]:4.1f} / baja {100 * row[4] / row[0]:4.1f})"
              f"  extrapolada={100 * row[2] / row[0]:.2f} %")
        # En reposo en cama ninguna pendiente domina al ruido: el pronóstico real es siempre de nivel.
        assert row[2] / row[0] <= 0.01


# ============================================================================
# Banda que sale del rango normal por los dos lados ("both")
# ============================================================================

from types import SimpleNamespace  # noqa: E402

from backend.app.rules import recommendations as alert_rec  # noqa: E402
from backend.app.rules.evaluation import Evaluation, PersonalBaseline, Thresholds  # noqa: E402

TH_HR = Thresholds(60, 100, 50, 110, 40, 130)  # normal / vigilar / precaución (sin línea base: solo capa absoluta)
RULE = SimpleNamespace(rule_code="RULE_HR_BOTH_TEST")


def _version(followup=alert_rec.RULE_FOLLOWUP_INSTRUCTIONS, immediate=alert_rec.RULE_IMMEDIATE_INSTRUCTIONS):
    return SimpleNamespace(version_number="1.0-TEST", protocol_source="test", followup_instructions=followup,
                           immediate_instructions=immediate)


def _point(day, value, b80, b95):
    return {"date": f"2026-11-{15 + day:02d}", "t_ahead": day, "value": value,
            "lower_80": b80[0], "upper_80": b80[1], "lower_95": b95[0], "upper_95": b95[1]}


def _ctx(baseline=None, thresholds=TH_HR):
    return ps.ProjectionContext("HEART_RATE", "bpm", thresholds, baseline)


def test_band_crossing_both_sides_same_severity_is_both():
    ctx = _ctx()
    both = ps._band_crossing(ctx, 55, 105)  # MONITOR por abajo y MONITOR por arriba
    assert both == {
        "state": "MONITOR", "direction": "both", "threshold": None, "reference": "absolute_range", "alert_direction": None,
        # sin un único umbral: el de cada lado va en `sides` (bordes del rango normal)
        "sides": {"below": {"threshold": 60, "reference": "absolute_range"},
                  "above": {"threshold": 100, "reference": "absolute_range"}},
    }
    # misma gravedad en rojo por los dos lados
    crit = ps._band_crossing(ctx, 35, 135)
    assert crit["state"] == "CRITICAL" and crit["direction"] == "both" and crit["alert_direction"] is None
    assert (crit["sides"]["below"]["threshold"], crit["sides"]["above"]["threshold"]) == (40, 130)
    # un cruce por un solo lado no trae `sides`
    assert "sides" not in ps._band_crossing(ctx, 70, 105)
    # sin cruce por ningún lado
    assert ps._band_crossing(ctx, 61, 99) is None


def test_band_crossing_both_sides_different_severity_keeps_the_worse_side():
    ctx = _ctx()
    low = ps._band_crossing(ctx, 45, 105)   # WARNING abajo, MONITOR arriba
    assert (low["state"], low["direction"], low["threshold"], low["alert_direction"]) == ("WARNING", "below", 50, "LOW")
    high = ps._band_crossing(ctx, 55, 115)  # MONITOR abajo, WARNING arriba
    assert (high["state"], high["direction"], high["threshold"], high["alert_direction"]) == ("WARNING", "above", 110, "HIGH")
    # toda la banda por encima: mismo lado, gana el extremo peor (no es "both")
    same = ps._band_crossing(ctx, 105, 115)
    assert same["direction"] == "above" and same["state"] == "WARNING"


def test_projection_both_sides_possible_crossing_gives_a_non_directional_recommendation():
    """Valor esperado en rango y banda del 80 % fuera por los dos lados: cruce posible "both" y una
    recomendación que no presupone dirección (ni la de pulso alto ni la de pulso bajo)."""
    forecast = [_point(d, 80.0, (55, 105), (45, 115)) for d in (1, 2, 3)]
    tp, rec = ps.project_thresholds(forecast, _ctx(), Evaluation(state="NORMAL"), RULE, _version())
    for p in forecast:
        assert p["projected_state"] == "NORMAL"
        assert p["worst_state_80"] == "MONITOR" and p["worst_state_95"] == "WARNING"
        assert p["interval_touches_threshold"] is True and "t_ahead" not in p
    assert tp["current_state"] == "NORMAL" and tp["first_expected_crossing"] is None
    possible = tp["first_possible_crossing"]
    assert possible["days_ahead"] == 1 and possible["basis"] == "interval_80"
    assert possible["direction"] == "both" and possible["threshold"] is None and possible["state"] == "MONITOR"
    assert rec["basis"] == "possible_crossing" and rec["direction"] == "both"
    assert rec["threshold"] is None and rec["reference"] == "absolute_range" and rec["alert_direction"] is None
    assert rec["sides"] == possible["sides"] == {"below": {"threshold": 60, "reference": "absolute_range"},
                                                 "above": {"threshold": 100, "reference": "absolute_range"}}
    assert rec["days_ahead"] == 1 and rec["state"] == "MONITOR"
    # la regla calibrada solo remite a la alerta: se usa la entrada genérica "fuera de tu rango habitual"
    assert rec["text"] == alert_rec.CATALOG[(alert_rec.GENERIC, alert_rec.PERSONAL)].followup
    assert rec["source"] == "alert_recommendation_catalog"
    for direction in (alert_rec.HIGH, alert_rec.LOW):
        assert rec["text"] != alert_rec.get_recommendation("HEART_RATE", direction).followup
    assert rec["immediate_action"] is None  # nada fuera de rango todavía


def test_projection_both_sides_uses_the_rule_followup_when_the_rule_has_its_own():
    forecast = [_point(1, 80.0, (55, 105), (45, 115))]
    version = _version(followup="Pauta propia de la regla.", immediate="Acción propia.")
    _, rec = ps.project_thresholds(forecast, _ctx(), Evaluation(state="NORMAL"), RULE, version)
    assert rec["direction"] == "both"
    assert rec["text"] == "Pauta propia de la regla." and rec["source"] == "clinical_rule_followup_instructions"
    assert rec["immediate_action"] is None  # solo con el último valor ya fuera de rango


def test_projection_expected_crossing_wins_over_an_earlier_both_sides_band():
    """Si después el valor esperado cruza por un lado, manda ese cruce (con su dirección y su texto) y
    el cruce posible "both" anterior se conserva en la proyección."""
    forecast = [
        _point(1, 80.0, (55, 105), (45, 115)),
        _point(2, 92.0, (70, 108), (65, 112)),
        _point(3, 103.0, (90, 109), (85, 112)),
    ]
    tp, rec = ps.project_thresholds(forecast, _ctx(), Evaluation(state="NORMAL"), RULE, _version())
    assert tp["first_possible_crossing"]["direction"] == "both" and tp["first_possible_crossing"]["days_ahead"] == 1
    expected = tp["first_expected_crossing"]
    assert expected["days_ahead"] == 3 and expected["direction"] == "above" and expected["threshold"] == 100
    assert rec["basis"] == "expected_crossing" and rec["direction"] == "above" and rec["alert_direction"] == "HIGH"
    assert rec["text"] == alert_rec.get_recommendation("HEART_RATE", alert_rec.HIGH).followup


def test_projection_both_sides_of_the_personal_band():
    """Con línea base personal la banda puede salir de la banda habitual (± 2 DE) por los dos lados sin
    tocar el rango absoluto: también es "both", sin umbral, y la recomendación no presupone dirección."""
    th = Thresholds(51, 99, 51, 99, 41, 119)
    ctx = _ctx(PersonalBaseline(mean=66.0, sd=6.0), th)  # banda habitual 54 – 78
    both = ps._band_crossing(ctx, 52, 80)
    assert both["direction"] == "both" and both["state"] == "MONITOR" and both["threshold"] is None
    # los umbrales de cada lado son los de la banda habitual, no los del rango normal
    assert both["reference"] == "personal_baseline" and both["alert_direction"] == alert_rec.PERSONAL
    assert both["sides"] == {"below": {"threshold": pytest.approx(54.0), "reference": "personal_baseline"},
                             "above": {"threshold": pytest.approx(78.0), "reference": "personal_baseline"}}
    forecast = [_point(1, 66.0, (52, 80), (50, 82))]
    tp, rec = ps.project_thresholds(forecast, ctx, Evaluation(state="NORMAL"), RULE, _version())
    assert tp["ranges"]["personal_yellow"] == [pytest.approx(54.0), pytest.approx(78.0)]
    assert rec["direction"] == "both" and rec["alert_direction"] == alert_rec.PERSONAL and rec["threshold"] is None
    assert rec["sides"] == both["sides"]
    # el pulso tiene una entrada propia de desvío personal: se usa esa, no la genérica ni las direccionales
    assert rec["text"] == alert_rec.CATALOG[("HEART_RATE", alert_rec.PERSONAL)].followup
    for direction in (alert_rec.HIGH, alert_rec.LOW):
        assert rec["text"] != alert_rec.get_recommendation("HEART_RATE", direction).followup


def test_projection_both_sides_personal_never_uses_a_directional_alias(monkeypatch):
    """Un indicador sin entrada propia de desvío personal resuelve PERSONAL con un alias hacia "alto" o
    "bajo" (así están el ánimo, la SpO2, la respiración y el sueño). Con la banda fuera por los dos lados
    ese alias sería una recomendación con dirección: se usa la entrada genérica."""
    high_text = alert_rec.CATALOG[("HEART_RATE", alert_rec.HIGH)].followup
    monkeypatch.delitem(alert_rec.CATALOG, ("HEART_RATE", alert_rec.PERSONAL))
    monkeypatch.setitem(alert_rec._ALIASES, ("HEART_RATE", alert_rec.PERSONAL), ("HEART_RATE", alert_rec.HIGH))
    assert alert_rec.get_recommendation("HEART_RATE", alert_rec.PERSONAL).followup == high_text  # el alias actúa

    ctx = _ctx(PersonalBaseline(mean=66.0, sd=6.0), Thresholds(51, 99, 51, 99, 41, 119))
    forecast = [_point(1, 66.0, (52, 80), (50, 82))]
    _, rec = ps.project_thresholds(forecast, ctx, Evaluation(state="NORMAL"), RULE, _version())
    assert rec["direction"] == "both" and rec["alert_direction"] == alert_rec.PERSONAL
    assert rec["text"] == alert_rec.CATALOG[(alert_rec.GENERIC, alert_rec.PERSONAL)].followup
    assert rec["text"] != high_text
