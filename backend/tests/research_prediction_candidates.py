"""SEMSA · Investigación · Comparación de candidatos de pronóstico puntual (no es una prueba de regresión).

Es la evidencia con la que se eligió el método de `prediction_service` (nivel robusto, sin
extrapolar la pendiente). pytest no lo recoge por defecto (el nombre no empieza por `test_`);
se ejecuta a propósito y solo imprime tablas:

    pytest backend/tests/research_prediction_candidates.py -s

Mismo backtest de origen móvil que `test_prediction_calibration.py` (vitales reales NASA UTMB,
reposo en cama: análogo terrestre, no vuelo espacial; mitades `tune` / `conf` de sujetos).
Candidatos: último valor, media y mediana móviles, media y mediana ponderadas exponencialmente,
Holt amortiguado, recta OLS, Theil–Sen, OLS encogido hacia el nivel y nivel + tendencia solo cuando
la pendiente es significativa (con y sin amortiguación). La segunda tabla mira solo los orígenes
con tendencia significativa: ahí es donde extrapolar debería ayudar si ayudara.
"""
import math
import time
from statistics import median

from backend.app.services import prediction_service as ps
from backend.tests.test_prediction_calibration import BUCKETS, H, HALVES, INDICATORS, _bucket, _load

REFERENCE = "media 7 d"


def _ewm(xs, ys, alpha):
    q, xn = 1 - alpha, xs[-1]
    sw = swy = 0.0
    for x, y in zip(xs, ys):
        w = q ** (xn - x)
        sw += w
        swy += w * y
    return swy / sw


def _holt_damped(ys, alpha, beta, phi):
    level, trend = ys[0], 0.0
    for y in ys[1:]:
        previous = level
        level = alpha * y + (1 - alpha) * (level + phi * trend)
        trend = beta * (level - previous) + (1 - beta) * phi * trend
    out, damp = [], 0.0
    for h in range(1, H + 1):
        damp += phi ** h
        out.append(level + trend * damp)
    return out


def _theil_sen(xs, ys):
    slopes = [(ys[j] - ys[i]) / (xs[j] - xs[i]) for i in range(len(xs) - 1) for j in range(i + 1, len(xs))]
    slope = median(slopes)
    return median([y - slope * x for x, y in zip(xs, ys)]), slope


def _damp(phi):
    out, total = [], 0.0
    for h in range(1, H + 1):
        total += phi ** h
        out.append(total)
    return out


DAMP = {phi: _damp(phi) for phi in (0.0, 0.5, 0.8, 1.0)}


def _candidates(xs, ys):
    """{nombre: [pronóstico h=1..14]} y si la tendencia de la ventana es significativa."""
    n, xn = len(ys), xs[-1]
    flat = lambda v: [v] * H
    out = {"último valor": flat(ys[-1]), "media segmento": flat(sum(ys) / n)}
    for k in (3, 7, 14, 28):
        out[f"media {k} d"] = flat(sum(ys[-k:]) / len(ys[-k:]))
    for k in (7, 21, 28):
        out[f"mediana {k} d"] = flat(median(ys[-k:]))
    for alpha in (0.03, 0.05, 0.07, 0.10, 0.20):
        out[f"media exp a={alpha}"] = flat(_ewm(xs, ys, alpha))
        out[f"mediana exp a={alpha}"] = flat(ps.prefix_levels(xs, ys, alpha)[n])
    level = out[f"mediana exp a={ps.LEVEL_ALPHA}"][0]
    for alpha, beta, phi in ((0.1, 0.05, 0.8), (0.1, 0.05, 0.95), (0.2, 0.1, 0.8), (0.3, 0.1, 0.95)):
        out[f"Holt amort. a={alpha} b={beta} phi={phi}"] = _holt_damped(ys, alpha, beta, phi)
    line = ps._fit_line(xs, ys)
    out["recta OLS (v1)"] = [line["intercept"] + line["slope"] * (xn + h) for h in range(1, H + 1)]
    for lam in (0.25, 0.5):
        out[f"nivel + {lam}·pendiente OLS"] = [level + lam * line["slope"] * h for h in range(1, H + 1)]
    b0, b1 = _theil_sen(xs, ys)
    out["Theil-Sen"] = [b0 + b1 * (xn + h) for h in range(1, H + 1)]
    # Nivel + tendencia solo si es significativa (misma prueba que el servicio, ventana de 45 días)
    trend = ps.assess_trend(xs, ys)
    significant = trend["significant"]
    fit = trend["fit"]
    end = fit["intercept"] + fit["slope"] * xn if fit else level
    for phi in DAMP:
        name = f"tendencia sig.: recta, phi={phi}"
        out[name] = [end + fit["slope"] * d for d in DAMP[phi]] if significant else flat(level)
    out["tendencia sig.: media(nivel, recta)"] = flat((level + end) / 2) if significant else flat(level)
    return out, significant


def test_compare_candidates():
    started = time.time()
    series, half = _load()
    acc, cond, n_sig = {}, {}, {}
    for (code, subject), points in series.items():
        hf = half[subject]
        days = [p[0] for p in points]
        values = [p[1] for p in points]
        for i in range(len(points)):
            lo = 0
            while days[lo] < days[i] - ps.MAX_HISTORY_DAYS:
                lo += 1
            xs = [d - days[lo] for d in days[lo:i + 1]]
            ys = values[lo:i + 1]
            targets = [(days[j] - days[i], values[j]) for j in range(i + 1, len(points)) if days[j] - days[i] <= H]
            if len(ys) < ps.MIN_DAYS or not targets:
                continue
            forecasts, significant = _candidates(xs, ys)
            count = n_sig.setdefault((hf, code), [0, 0])
            count[0] += significant
            count[1] += 1
            for name, fc in forecasts.items():
                for h, actual in targets:
                    e = abs(actual - fc[h - 1])
                    for key in ((name, hf, code, _bucket(h)), (name, hf, code, "all")):
                        cell = acc.setdefault(key, [0.0, 0])
                        cell[0] += e
                        cell[1] += 1
                    if significant:
                        cell = cond.setdefault((name, hf, code), [0.0, 0])
                        cell[0] += e
                        cell[1] += 1

    def mae(name, hf, code, b="all"):
        cell = acc[(name, hf, code, b)]
        return cell[0] / cell[1]

    def ratio(name, hf, code, b="all"):
        return mae(name, hf, code, b) / mae(REFERENCE, hf, code, b)

    def gmean(values):
        return math.exp(sum(math.log(v) for v in values) / len(values))

    names = sorted({k[0] for k in acc}, key=lambda nm: gmean([ratio(nm, "tune", c) for c in INDICATORS]))
    codes = list(INDICATORS)
    print(f"\n== Candidatos: MAE / MAE(media de 7 días); < 1 es mejor. Orden: media geométrica (MG) en la mitad de afinado. {time.time() - started:.0f} s ==")
    print(f"{'candidato':38s}| afinado: " + " ".join(c[:6].rjust(6) for c in codes) + "     MG |   h1  h2-3  h4-7 h8-14 | confirm.: "
          + " ".join(c[:6].rjust(6) for c in codes) + "     MG |   h1  h2-3  h4-7 h8-14")
    for name in names:
        cells = []
        for hf in HALVES:
            per_ind = [ratio(name, hf, c) for c in codes]
            per_h = [gmean([ratio(name, hf, c, b) for c in codes]) for b in BUCKETS]
            cells.append(" ".join(f"{v:6.3f}" for v in per_ind) + f" {gmean(per_ind):6.3f} | " + " ".join(f"{v:5.3f}" for v in per_h))
        print(f"{name:38s}|          {cells[0]} |           {cells[1]}")

    chosen = f"mediana exp a={ps.LEVEL_ALPHA}"
    shown = ["media 7 d", f"media exp a={ps.LEVEL_ALPHA}", "tendencia sig.: recta, phi=0.0", "tendencia sig.: recta, phi=0.5",
             "tendencia sig.: recta, phi=0.8", "tendencia sig.: recta, phi=1.0", "tendencia sig.: media(nivel, recta)"]
    print(f"\n== Solo orígenes con tendencia significativa (alfa={ps.TREND_ALPHA}, ventana {ps.TREND_WINDOW_DAYS} d): MAE / MAE del nivel elegido ({chosen}) ==")
    for hf in HALVES:
        for code in codes:
            base = cond[(chosen, hf, code)]
            sig, total = n_sig[(hf, code)]
            row = "  ".join(f"{nm.replace('tendencia sig.: ', '')}={(cond[(nm, hf, code)][0] / cond[(nm, hf, code)][1]) / (base[0] / base[1]):.3f}" for nm in shown)
            print(f"  {hf:5s} {code:15s} sig.={100 * sig / total:4.1f} % n={base[1]:5d} MAE nivel={base[0] / base[1]:.3f} | {row}")
