import re
from pathlib import Path

FRONTEND_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = FRONTEND_ROOT / "src" / "console" / "data"
VIEWS_DIR = FRONTEND_ROOT / "src" / "console" / "views"


def _dict_blocks(source):
    """Texto de cada idioma dentro de `const DICT = { es: {...}, en: {...} }` (formato de las vistas)."""
    start = source.index("const DICT = {")
    es_at = source.index("\n  es: {", start)
    en_at = source.index("\n  en: {", es_at)
    end = source.index("\n};", en_at)
    return source[es_at:en_at], source[en_at:end]


def _keys(block, indent):
    return set(re.findall(r"^" + " " * indent + r"(\w+):", block, re.M))


def test_measure_view_uses_only_the_api():
    # "Registrar medición" sale solo de la API (catálogo de /health/indicators y mediciones
    # de la base de datos): sin JSON de ejemplo, sin modo demo ni almacenamiento local
    measure_data_js = (DATA_DIR / "measure-data.js").read_text(encoding="utf-8")
    measure_js = (VIEWS_DIR / "measure.js").read_text(encoding="utf-8")

    assert not (DATA_DIR / "measure-demo.json").exists()
    assert not (FRONTEND_ROOT / "dev" / "measure-preview.html").exists()
    assert "measure-demo" not in measure_data_js
    assert "localStorage" not in measure_data_js
    assert "apiService.getHealthIndicators(" in measure_data_js
    assert "resetDemoData" not in measure_data_js and "resetDemoData" not in measure_js
    assert 'mode === "demo"' not in measure_js


def test_measure_registers_for_selected_astronaut():
    # El líder de misión registra para el tripulante elegido: nunca el id del usuario conectado
    measure_data_js = (DATA_DIR / "measure-data.js").read_text(encoding="utf-8")
    assert "astronaut_id: appState?.selectedAstronautId" in measure_data_js
    assert "mission_id: appState?.selectedMissionId" in measure_data_js
    assert "currentUser" not in measure_data_js


def test_measure_dict_languages_match():
    measure_js = (VIEWS_DIR / "measure.js").read_text(encoding="utf-8")
    es, en = _dict_blocks(measure_js)
    for indent in (4, 6):
        assert _keys(es, indent) == _keys(en, indent), (
            f"measure.js DICT es/en keys differ at indent {indent}: {sorted(_keys(es, indent) ^ _keys(en, indent))}"
        )
