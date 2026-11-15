import ast
import re
from pathlib import Path

FRONTEND_ROOT = Path(__file__).resolve().parent.parent


def _dict_blocks(source):
    """Texto de cada idioma dentro de `const DICT = { es: {...}, en: {...} }` (formato de las vistas)."""
    start = source.index("const DICT = {")
    es_at = source.index("\n  es: {", start)
    en_at = source.index("\n  en: {", es_at)
    end = source.index("\n};", en_at)
    return source[es_at:en_at], source[en_at:end]


def _keys(block, indent):
    """Claves declaradas a un nivel de sangría dado (4 = primer nivel del idioma, 6 = anidadas)."""
    return set(re.findall(r"^" + " " * indent + r"(\w+):", block, re.M))


def test_frontend_files_exist_and_have_required_sections():
    index_html = (FRONTEND_ROOT / "index.html").read_text(encoding="utf-8")
    app_js = (FRONTEND_ROOT / "src" / "app" / "app.js").read_text(encoding="utf-8")
    main_css = (FRONTEND_ROOT / "src" / "styles" / "main.css").read_text(encoding="utf-8")

    # Secciones con entrada de navegación (pestañas globales + menú "Más") y ruta en app.js
    for nav_id in [
        "mission-control",
        "my-health-check",
        "wellbeing-hub",
        "recommendations",
        "daily-missions",
        "alerts-center",
        "crew-monitoring",
        "reports",
        "administration",
        "settings-help",
    ]:
        assert f'data-nav-section="{nav_id}"' in index_html, f"Missing nav section {nav_id}"
        assert f'sectionId === "{nav_id}"' in app_js, f"Missing handler for {nav_id}"

    # "Explorador corporal" y "Analítica de misión" salieron del menú "Más": el Resumen de la
    # consola ya los cubre (mapa corporal interactivo y tendencia por indicador). Sus ids antiguos
    # deben seguir funcionando: navigateToSection los redirige al Resumen.
    for legacy_id in ["body-explorer", "mission-analytics"]:
        assert f'data-nav-section="{legacy_id}"' not in index_html, f"{legacy_id} should not be a menu item"
        assert f'"{legacy_id}": "mission-control"' in app_js, f"Missing redirect for {legacy_id}"
    assert "SECTION_REDIRECTS[sectionId]" in app_js

    # Vista "Insights por entorno" (pestaña global, importmap y hoja de estilos versionadas)
    views_dir = FRONTEND_ROOT / "src" / "console" / "views"
    assert (views_dir / "environments.js").is_file()
    assert (views_dir / "environments.css").is_file()
    assert 'data-nav-section="environments"' in index_html
    assert "/src/console/views/environments.js?v=__BUILD__" in index_html
    assert "/src/console/views/environments.css?v=__BUILD__" in index_html
    assert 'sectionId === "environments"' in app_js
    assert "renderEnvironmentsView" in app_js
    assert "export async function renderEnvironmentsView" in (views_dir / "environments.js").read_text(encoding="utf-8")

    # Vistas del menú "Más" rediseñadas como módulos de la consola (antes vivían en app.js y
    # expansion_views.js): cada una con su export, su ruta, su entrada en el importmap y la hoja común
    for module, export_name in [
        ("cognitive", "renderCognitiveView"),
        ("emotional", "renderEmotionalView"),
        ("crew", "renderCrewView"),
        ("admin", "renderAdminView"),
        ("settings", "renderSettingsView"),
    ]:
        source = (views_dir / f"{module}.js").read_text(encoding="utf-8")
        assert f"export async function {export_name}" in source
        # Textos en un único diccionario por idioma (es / en) resuelto con tr(DICT) en cada render
        assert source.count("const DICT = {") == 1, f"{module}.js must keep its strings in a single DICT object"
        es_block, en_block = _dict_blocks(source)
        assert _keys(es_block, 4), f"{module}.js DICT.es is empty"
        assert _keys(en_block, 4), f"{module}.js DICT.en is empty"
        assert "tr(DICT)" in source, f"{module}.js must resolve its strings with tr(DICT)"
        assert export_name in app_js
        assert f"/src/console/views/{module}.js?v=__BUILD__" in index_html
    assert (views_dir / "more-common.js").is_file()
    assert "/src/console/views/more-common.js?v=__BUILD__" in index_html
    assert "/src/console/views/more.css?v=__BUILD__" in index_html
    # RBAC del menú: las entradas de supervisión se ocultan por rol y las vistas lo vuelven a comprobar
    assert 'sec === "administration" && role !== "ADMINISTRATOR"' in app_js
    assert 'sec === "crew-monitoring" && role === "ASTRONAUT"' in app_js
    assert "noAccessHTML" in (views_dir / "crew.js").read_text(encoding="utf-8")
    assert "noAccessHTML" in (views_dir / "admin.js").read_text(encoding="utf-8")
    # Pestaña principal "Bienestar" (aislamiento y confinamiento): vista, hoja, importmap, ruta y textos es/en
    wellbeing_js = (views_dir / "wellbeing.js").read_text(encoding="utf-8")
    assert (views_dir / "wellbeing.css").is_file()
    assert "export async function renderWellbeingView" in wellbeing_js
    assert "renderWellbeingView" in app_js
    assert 'sectionId === "wellbeing-hub"' in app_js
    assert '"/src/console/views/wellbeing.js": "/src/console/views/wellbeing.js?v=__BUILD__"' in index_html
    assert "/src/console/views/wellbeing.css?v=__BUILD__" in index_html
    assert 'data-i18n="tab.wellbeing"' in index_html
    i18n_src_wb = (FRONTEND_ROOT / "src" / "i18n" / "i18n.js").read_text(encoding="utf-8")
    assert i18n_src_wb.count('"tab.wellbeing":') == 2, "tab.wellbeing must exist in es and en"
    assert wellbeing_js.count("const DICT = {") == 1
    wb_es, wb_en = _dict_blocks(wellbeing_js)
    for indent in (4, 6):
        assert _keys(wb_es, indent) == _keys(wb_en, indent), (
            f"wellbeing.js DICT es/en keys differ at indent {indent}: "
            f"{sorted(_keys(wb_es, indent) ^ _keys(wb_en, indent))}"
        )
    # "Contacto con Tierra" ya no es una pestaña de Bienestar: es una recomendación que solo aparece como
    # alerta temprana (backend/app/rules/early_warnings.py), en Alertas (desplegables) y en el Resumen
    assert "renderEarth" not in wellbeing_js and '"earth"' not in wellbeing_js and "earthTitle" not in wellbeing_js
    assert "getFamilyContacts" not in wellbeing_js
    # Enlaces externos seguros
    assert 'rel="noopener noreferrer"' in wellbeing_js
    assert 'u.protocol === "https:"' in wellbeing_js
    # La vista no usa atributos que escuchan console.js (data-act) o app.js (data-nav-section)
    assert "data-nav-section" not in wellbeing_js.split("*/", 1)[1]
    assert "data-act=" not in wellbeing_js

    # Evaluación cognitiva y Check-in emocional salieron del menú "Más" y son pestañas de Bienestar
    # (issue #26), como Cuestionarios o Respiración; sus rutas antiguas abren Bienestar en esa pestaña
    for sub_id, tab in [("cognitive-center", "cognitive"), ("emotional-center", "emotional")]:
        assert f'data-nav-section="{sub_id}"' not in index_html, f"{sub_id} should not be a menu item"
        assert f'"{sub_id}": "wellbeing-hub"' in app_js, f"{sub_id} must redirect to Bienestar"
        assert f'"{sub_id}": "{tab}"' in app_js, f"{sub_id} must open the {tab} tab"
        assert f'"{tab}"' in wellbeing_js.split("const SUBS = ", 1)[1].split(";", 1)[0], f"Missing tab {tab}"
    assert "renderEmotionalView" in wellbeing_js and "renderCognitiveView" in wellbeing_js
    assert "toolsHTML" not in wellbeing_js

    # El cuestionario de bienestar psicológico volvió a Bienestar, en la pestaña interna
    # "Cuestionarios" (questionnaires.js) junto al chequeo del turno (shift-check.js: estrés, FC,
    # NASA-TLX y test de reacción tipo PVT). "Registrar medición" ya no lo incluye, la vista antigua
    # no existe y la ruta "wellness-center" abre Bienestar en esa pestaña.
    assert not (views_dir / "wellness.js").exists()
    assert not (views_dir / "measure-questionnaire.js").exists()
    assert "/src/console/views/wellness.js" not in index_html
    assert "measure-questionnaire" not in index_html
    assert "renderWellnessView" not in app_js
    assert "wellness-center" not in wellbeing_js
    assert 'data-nav-section="wellness-center"' not in index_html
    assert '"wellness-center": "wellbeing-hub"' in app_js
    assert '"wellness-center": "checks"' in app_js and "openWellbeingSub(WELLBEING_TAB_OF[" in app_js
    assert "export function openWellbeingSub" in wellbeing_js
    measure_js = (views_dir / "measure.js").read_text(encoding="utf-8")
    assert "questionnaire" not in measure_js.lower() and "WELLNESS_QUESTIONNAIRE" not in app_js
    assert ".av-ms-qtile" not in (views_dir / "measure.css").read_text(encoding="utf-8")
    assert '"checks"' in wellbeing_js and 'import { renderChecks } from "./questionnaires.js"' in wellbeing_js
    assert 'checks: "Cuestionarios"' in wellbeing_js and 'checks: "Questionnaires"' in wellbeing_js
    qz_js = (views_dir / "questionnaires.js").read_text(encoding="utf-8")
    sc_js = (views_dir / "shift-check.js").read_text(encoding="utf-8")
    assert (views_dir / "questionnaires.css").is_file()
    for module in ["questionnaires", "shift-check"]:
        assert f'"/src/console/views/{module}.js": "/src/console/views/{module}.js?v=__BUILD__"' in index_html
    assert "/src/console/views/questionnaires.css?v=__BUILD__" in index_html
    assert "export async function renderChecks" in qz_js
    assert 'data-wb-sub="checks"' in qz_js
    for call in ["getWellnessInstruments", "getWellnessAssessments", "createWellnessAssessment",
                 "getWellnessRecommendations", "getQuickCheckins"]:
        assert f"apiService.{call}(" in qz_js, f"questionnaires.js must use {call}"
    # Sueño y ánimo no se duplican: el chequeo del turno los toma del check-in de Hoy y enlaza a esa pestaña
    assert 'data-qz-tab="today"' in sc_js
    assert 'name="av-sc-sleep' not in sc_js and 'name="av-sc-mood' not in sc_js
    # NASA-TLX: seis escalas 0–100 y test de reacción con duración elegible, lapsos y falsos inicios
    assert 'const TLX_KEYS = ["md", "pd", "td", "pf", "ef", "fr"]' in sc_js
    assert 'type="range"' in sc_js and 'min="0" max="100"' in sc_js
    assert "durations: [60, 180, 300]" in sc_js and "lapseMs: 500" in sc_js
    assert "falseStarts" in sc_js and "mean_ms" in sc_js
    assert "localStorage" in sc_js and "catch" in sc_js
    # Mismas reglas que el resto de Bienestar: sin data-act / data-nav / data-wb-go en estos módulos
    for src in (qz_js, sc_js):
        body = src.split("*/", 1)[1]
        assert "data-act=" not in body and "data-nav" not in body and "data-wb-go" not in body
    for name, src in (("questionnaires.js", qz_js), ("shift-check.js", sc_js)):
        assert src.count("const DICT = {") == 1 and "tr(DICT)" in src
        es_block, en_block = _dict_blocks(src)
        for indent in (4, 6, 8):
            assert _keys(es_block, indent) == _keys(en_block, indent), (
                f"{name} DICT es/en keys differ at indent {indent}: "
                f"{sorted(_keys(es_block, indent) ^ _keys(en_block, indent))}"
            )
    # Escala 1–10 sin desbordes: rejilla de 10 columnas que pasa a 5 en pantallas estrechas
    qz_css = (views_dir / "questionnaires.css").read_text(encoding="utf-8")
    assert "repeat(10, minmax(0, 1fr))" in qz_css and "repeat(5, minmax(0, 1fr))" in qz_css
    # El contador de pendientes del check-in emocional pasa a la pestaña "Bienestar"
    tab_start = index_html.index('data-nav-section="wellbeing-hub"')
    assert "js-emo-badge" in index_html[tab_start:index_html.index("</button>", tab_start)]
    assert index_html.count("js-emo-badge") == 1

    # El antiguo expansion_views.js (sustituido por las vistas del menú "Más") ya no existe
    assert not (FRONTEND_ROOT / "src" / "app" / "expansion_views.js").exists()
    assert "expansion_views" not in index_html

    # Selector de idioma (es / en): núcleo i18n versionado en el importmap, selectores en el
    # encabezado (ya no hay pantalla de acceso), textos estáticos marcados y arranque en app.js
    i18n_js = FRONTEND_ROOT / "src" / "i18n" / "i18n.js"
    assert i18n_js.is_file()
    i18n_src = i18n_js.read_text(encoding="utf-8")
    for export_name in ["export function tr", "export function fmt", "export function initI18n", "export const STATIC"]:
        assert export_name in i18n_src, f"i18n.js missing {export_name}"
    assert '"/src/i18n/i18n.js": "/src/i18n/i18n.js?v=__BUILD__"' in index_html
    assert index_html.count("data-av-lang") >= 1, "Language selector missing in header"
    assert 'id="av-lang-select"' in index_html
    # interruptor segmentado ES | EN (radiogroup), ya no un <select>
    assert '<select id="av-lang-select"' not in index_html
    assert 'role="radiogroup" aria-labelledby="av-lang-lbl"' in index_html
    assert 'role="radio"' in i18n_src and "aria-checked" in i18n_src
    assert 'data-i18n="lang.label"' in index_html
    assert 'data-i18n="tab.summary"' in index_html
    assert "initI18n()" in app_js
    assert "onLangChange" in app_js

    # Verify accessibility & responsive support
    assert "prefers-reduced-motion" in main_css
    assert 'data-theme="high-contrast"' in main_css
    assert 'aria-label' in index_html



# ---------------------------------------------------------------------------
# Módulo de aislamiento: traducciones EN de los textos sembrados y de los errores
# ---------------------------------------------------------------------------

PROJECT_ROOT = FRONTEND_ROOT.parent
I18N_DIR = FRONTEND_ROOT / "src" / "i18n"


def _norm(s):
    return re.sub(r"\s+", " ", s).strip()


def _en_keys(path):
    """Claves literales de `export const EXACT = {...}` (mismo criterio de normalización que bt())."""
    src = path.read_text(encoding="utf-8")
    start = src.index("export const EXACT = {")
    end = src.index("\n};", start)
    block = src[start:end]
    keys = re.findall(r'^\s*"((?:[^"\\]|\\.)*)"\s*:', block, re.M)
    return {_norm(k.replace('\\"', '"')) for k in keys}


def _seed_list(tree, name):
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == name for t in node.targets):
            return node.value.elts
    raise AssertionError(f"{name} not found in seed.py")


def _const(node):
    return ast.literal_eval(node)


def test_isolation_module_seed_texts_have_english_translation():
    seed_tree = ast.parse((PROJECT_ROOT / "backend" / "app" / "database" / "seed.py").read_text(encoding="utf-8"))
    seed_keys = _en_keys(I18N_DIR / "backend-en-seed.js")
    all_keys = seed_keys | _en_keys(I18N_DIR / "backend-en-runtime.js")

    expected = []
    # (code, title, category, minutes, description, how_to, solo_or_group, source)
    leisure = _seed_list(seed_tree, "LEISURE_ACTIVITIES_DATA")
    assert leisure, "empty leisure catalog"
    for row in leisure:
        expected += [_const(row.elts[1]), _const(row.elts[4]), *_const(row.elts[5])]
    # (code, title, description, minutes, category)
    templates = _seed_list(seed_tree, "CREW_ACTIVITY_TEMPLATES_DATA")
    assert templates, "empty crew templates"
    for row in templates:
        expected += [_const(row.elts[1]), _const(row.elts[2])]
    # (code, title, category, description, xp, educational_content)
    for row in _seed_list(seed_tree, "ISOLATION_XP_MISSIONS_DATA"):
        expected += [_const(row.elts[1]), _const(row.elts[3]), _const(row.elts[5])]

    missing = sorted({_norm(s) for s in expected} - seed_keys)
    assert not missing, f"backend-en-seed.js is missing English translations for: {missing}"

    # Errores (detail=) y consejos circadianos del router del módulo: cubiertos en seed o runtime
    router_tree = ast.parse(
        (PROJECT_ROOT / "backend" / "app" / "api" / "v1" / "isolation_router.py").read_text(encoding="utf-8")
    )
    router_texts = set()
    for node in ast.walk(router_tree):
        if isinstance(node, ast.Call):
            for kw in node.keywords:
                if kw.arg == "detail" and isinstance(kw.value, ast.Constant) and isinstance(kw.value.value, str):
                    router_texts.add(_norm(kw.value.value))
        if isinstance(node, ast.FunctionDef) and node.name == "_circadian_tip":
            for ret in ast.walk(node):
                if isinstance(ret, ast.Return) and isinstance(ret.value, ast.Constant):
                    router_texts.add(_norm(ret.value.value))
    assert router_texts, "no detail= texts found in isolation_router.py"
    missing_router = sorted(router_texts - all_keys)
    assert not missing_router, f"Missing English translations for isolation_router texts: {missing_router}"


def test_wellbeing_limits_dedup_and_api_errors():
    views_dir = FRONTEND_ROOT / "src" / "console" / "views"
    wellbeing_js = (views_dir / "wellbeing.js").read_text(encoding="utf-8")
    schemas = (PROJECT_ROOT / "backend" / "app" / "schemas" / "schemas.py").read_text(encoding="utf-8")

    # Límites del formulario = límites del backend
    assert "minutes: int = Field(..., ge=1, le=180)" in schemas
    assert "leisureMin: 1, leisureMax: 180" in wellbeing_js
    assert "title: Optional[str] = Field(default=None, min_length=3, max_length=150)" in schemas
    assert "crewTitleMin: 3, crewTitleMax: 150, crewDescMax: 1000" in wellbeing_js
    assert "duration_minutes: Optional[int] = Field(default=None, ge=5, le=240)" in schemas
    assert "crewDurMin: 5, crewDurMax: 240" in wellbeing_js
    assert "sleep_hours: float = Field(..., ge=0.0, le=16.0)" in schemas
    assert "sleepMin: 0, sleepMax: 16, noteMax: 500" in wellbeing_js
    assert 'max="240" step="1"' not in wellbeing_js  # el registro de ocio ya no admite 240 min

    # Ventana de asistencia del cliente = _attend_window del backend (−15 min … fin + 24 h)
    router = (PROJECT_ROOT / "backend" / "app" / "api" / "v1" / "isolation_router.py").read_text(encoding="utf-8")
    assert "ATTEND_OPENS_BEFORE = timedelta(minutes=15)" in router
    assert "ATTEND_CLOSES_AFTER_END = timedelta(hours=24)" in router
    assert "const ATTEND_OPENS_BEFORE_MS = 15 * 60 * 1000;" in wellbeing_js
    assert "const ATTEND_CLOSES_AFTER_END_MS = 24 * 60 * 60 * 1000;" in wellbeing_js
    assert "opensAt: start - ATTEND_OPENS_BEFORE_MS, closesAt: start + durMs + ATTEND_CLOSES_AFTER_END_MS" in wellbeing_js
    assert "Number(err.status) === 409" in wellbeing_js  # 409 por relojes desfasados → mensaje y repintado


    # Check-in: una dedup_key por envío, reutilizada al encolar
    assert "payload.dedup_key = newDedupKey()" in wellbeing_js
    assert "dedup_key: payload.dedup_key" in wellbeing_js

    # request(): un 422 con detail en lista no termina en "[object Object]"
    api_js = (FRONTEND_ROOT / "src" / "services" / "api.js").read_text(encoding="utf-8")
    assert "export function errorDetailText" in api_js
    assert "errMsg = errorDetailText(errData, errMsg)" in api_js
    assert "errData.detail || errData.message" not in api_js
    assert "err.status = response.status" in api_js


def test_family_channel_not_in_frontend():
    """El canal familiar ("Conexión con Tierra") no se construye: solo queda como recomendación en Bienestar."""
    forbidden = ["FAMILY_MEMBER", "uploadAttachment", "MediaRecorder", "astrovital_msg_outbox", "semsa_msg_outbox", "av_messages_channel"]
    hits = []
    for path in (FRONTEND_ROOT / "src").rglob("*"):
        if path.suffix not in {".js", ".css", ".html"} or not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        hits += [f"{path.relative_to(FRONTEND_ROOT)}: {word}" for word in forbidden if word in text]
    assert not hits, f"Family channel leftovers in frontend/src: {hits}"


def test_messages_module_replaced_by_recommendations():
    """Issue #15: el módulo Mensajes se elimina y la última pestaña es "Recomendaciones" (cuadros desplegables)."""
    index_html = (FRONTEND_ROOT / "index.html").read_text(encoding="utf-8")
    app_js = (FRONTEND_ROOT / "src" / "app" / "app.js").read_text(encoding="utf-8")
    i18n_src = (FRONTEND_ROOT / "src" / "i18n" / "i18n.js").read_text(encoding="utf-8")
    views_dir = FRONTEND_ROOT / "src" / "console" / "views"

    # Mensajes ya no existe: ni archivos, ni pestaña, ni ruta, ni insignia de no leídos
    assert not (views_dir / "messages.js").exists()
    assert not (views_dir / "messages.css").exists()
    assert "messages.js" not in index_html and "messages.css" not in index_html
    assert 'data-nav-section="communication-center"' not in index_html
    assert "js-comm-badge" not in index_html and "js-comm-badge" not in app_js
    assert 'sectionId === "communication-center"' not in app_js
    assert "renderMessagesView" not in app_js
    assert '"tab.messages"' not in i18n_src
    # El id antiguo sigue funcionando: se redirige a Recomendaciones
    assert '"communication-center": "recommendations"' in app_js
    # Nada en la interfaz enlaza ya a Mensajes
    for path in (FRONTEND_ROOT / "src").rglob("*.js"):
        text = path.read_text(encoding="utf-8")
        for needle in ('data-nav="communication-center"', 'data-wb-go="communication-center"', 'navigateToSection("communication-center")'):
            assert needle not in text, f"{path.name} still links to Mensajes ({needle})"

    # Recomendaciones: última pestaña de la barra global, con vista, hoja e importmap versionados
    tabs = re.findall(r'class="av-tab"[^>]*data-nav-section="([\w-]+)"', index_html)
    assert tabs[-1] == "recommendations", f"Recomendaciones must be the last tab, got {tabs}"
    assert 'data-i18n="tab.recommendations"' in index_html
    assert i18n_src.count('"tab.recommendations":') == 2, "tab.recommendations must exist in es and en"
    assert '"/src/console/views/recommendations.js": "/src/console/views/recommendations.js?v=__BUILD__"' in index_html
    assert "/src/console/views/recommendations.css?v=__BUILD__" in index_html
    assert 'sectionId === "recommendations"' in app_js
    assert "renderRecommendationsView" in app_js

    rec_js = (views_dir / "recommendations.js").read_text(encoding="utf-8")
    assert (views_dir / "recommendations.css").is_file()
    assert "export async function renderRecommendationsView" in rec_js
    assert rec_js.count("const DICT = {") == 1 and "tr(DICT)" in rec_js
    es_block, en_block = _dict_blocks(rec_js)
    for indent in (4, 6, 8):
        assert _keys(es_block, indent) == _keys(en_block, indent), (
            f"recommendations.js DICT es/en keys differ at indent {indent}: "
            f"{sorted(_keys(es_block, indent) ^ _keys(en_block, indent))}"
        )
    # Mismas recomendaciones (mismos ids y en el mismo orden) en los dos idiomas
    ids_es = re.findall(r'id: "([\w-]+)"', es_block)
    ids_en = re.findall(r'id: "([\w-]+)"', en_block)
    assert ids_es and ids_es == ids_en
    assert "wearables" in ids_es, "Biometric integration must be one of the recommendations"
    # Cuadros desplegables con el patrón plegable de la consola
    assert '<details class="av-panel av-fold av-rec-card"' in rec_js
    assert 'class="av-panel-head av-fold-head av-rec-head"' in rec_js
    # La vista no usa atributos que escuchan console.js (data-act / data-nav) ni llama a la API
    assert "data-act=" not in rec_js and "data-nav=" not in rec_js
    assert "apiService" not in rec_js

    # Resumen: el cuadro "Mensajes sin leer" pasa a ser un acceso a Recomendaciones
    console_js = (FRONTEND_ROOT / "src" / "console" / "console.js").read_text(encoding="utf-8")
    assert 'data-nav="recommendations"' in console_js
    assert "unread_messages_count" not in console_js


def test_early_warnings_dropdowns_and_summary_recommendations():
    """Issue #14: las alertas tempranas (p. ej. "Contacto con Tierra") van en desplegables en Alertas
    y su recomendación en el cuadro "Recomendaciones" del Resumen; la acción lleva a la pestaña
    Recomendaciones con el cuadro earth-channel desplegado (sin Mensajes, issue #15); los textos del
    backend tienen traducción al inglés y no mencionan Mensajes."""
    console_dir = FRONTEND_ROOT / "src" / "console"
    alerts_js = (console_dir / "views" / "alerts.js").read_text(encoding="utf-8")
    console_js = (console_dir / "console.js").read_text(encoding="utf-8")
    classes_js = (console_dir / "alert-classes.js").read_text(encoding="utf-8")
    assert 'export const isEarlyAlert = (a) => String(a?.rule_code || "").startsWith("RULE_EARLY_");' in classes_js
    assert '<details class="av-fold av-al-early-item"' in alerts_js
    assert 'data-al-zone="early"' in alerts_js
    assert 'root.addEventListener("toggle"' in alerts_js
    # Un solo cuadro "Recomendaciones" en el Resumen (columna de 2 cuadros, issues #3 y #15)
    assert "${p1}${table}" in console_js
    assert "${activeRecsHTML(appState, alerts, T)}" in console_js
    assert "recsHTML(" not in console_js and "av-recs" not in console_js
    # Ir al cuadro earth-channel de Recomendaciones
    rec_js = (console_dir / "views" / "recommendations.js").read_text(encoding="utf-8")
    assert 'data-nav="recommendations" data-rec-open="earth-channel"' in console_js
    assert 'data-al-act="go-rec" data-al-rec="earth-channel"' in alerts_js
    for src in (console_js, alerts_js, rec_js):
        assert 'sessionStorage.setItem("av_rec_open"' in src or 'sessionStorage.getItem("av_rec_open")' in src
    assert 'id: "earth-channel"' in rec_js
    assert 'data-al-act="contact"' not in alerts_js
    al_es, al_en = _dict_blocks(alerts_js)
    early_keys = {k for k in _keys(al_es, 4) if k.startswith("early")}
    assert len(early_keys) >= 8 and early_keys == {k for k in _keys(al_en, 4) if k.startswith("early")}
    for key in ("recsActive", "recsActiveN", "recsAria", "recsPlanned", "recsFor", "recsSeeAlert", "recsSeeEarth"):
        assert console_js.count(f"    {key}: ") == 2, f"console.js DICT needs {key} in es and en"

    tree = ast.parse((PROJECT_ROOT / "backend" / "app" / "rules" / "early_warnings.py").read_text(encoding="utf-8"))
    texts = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name) and node.targets[0].id.startswith("EARTH_CONTACT_"):
            values = node.value.values if isinstance(node.value, ast.Dict) else [node.value]
            for v in values:
                if isinstance(v, ast.Constant) and isinstance(v.value, str) and " " in v.value:
                    texts.add(_norm(v.value))
    assert len(texts) >= 5, texts
    assert not [t for t in texts if re.search(r"mensaje|communication", t, re.I)], "early warnings must not point to Mensajes"
    missing = sorted(texts - _en_keys(I18N_DIR / "backend-en-runtime.js"))
    assert not missing, f"Missing English translations for early_warnings texts: {missing}"


def test_prediction_service_texts_have_english_translation():
    """Los textos en español que el servicio de predicción devuelve al usuario (descripción del método y
    nota de validación) tienen traducción al inglés; describen pronósticos de tendencia, no diagnósticos."""
    tree = ast.parse(
        (PROJECT_ROOT / "backend" / "app" / "services" / "prediction_service.py").read_text(encoding="utf-8")
    )
    texts = set()
    for node in tree.body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name == "METHOD_DESCRIPTION" or name.startswith("VALIDATION_NOTE_"):
                assert isinstance(node.value, ast.Constant) and isinstance(node.value.value, str), name
                texts.add(_norm(node.value.value))
    assert len(texts) == 3, texts
    assert not [t for t in texts if re.search(r"enfermedad|diagn[oó]stic", t, re.I)], texts
    missing = sorted(texts - _en_keys(I18N_DIR / "backend-en-runtime.js"))
    assert not missing, f"Missing English translations for prediction_service texts: {missing}"


def test_branding_is_semsa_and_status_bar_shows_telecreation_mission():
    """Issue #14: la app se llama SEMSA y la barra superior muestra SEMSA + misión TeleCreation UTS."""
    console_js = (FRONTEND_ROOT / "src" / "console" / "console.js").read_text(encoding="utf-8")
    assert 'const BRAND_LABEL = "TeleCreation UTS";' in console_js
    assert 'const APP_NAME = "SEMSA";' in console_js
    assert "${esc(APP_NAME)}</span></div>" in console_js
    hits = []
    for path in [FRONTEND_ROOT / "index.html", *(FRONTEND_ROOT / "src").rglob("*")]:
        if path.suffix not in {".js", ".css", ".html"} or not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        if path.name == "api.js":  # migra una vez las claves antiguas "astrovital_*" del almacenamiento
            text = re.sub(r'"astrovital_(session_token|csrf_token|offline_queue)"', "", text)
        hits += [f"{path.relative_to(FRONTEND_ROOT)}: {word}" for word in ("AstroVital", "astrovital", "ARTEMIS-IV") if word in text]
    assert not hits, f"Restos de la marca anterior: {hits}"


def test_alert_recommendations_and_rule_sources_have_english_translation():
    """Motor de alertas calibrado con el dataset: cada recomendación del catálogo (paso del indicador,
    paso del nivel y seguimiento), los textos de reserva, las instrucciones de la versión de regla y la
    fuente de cada umbral tienen traducción al inglés; el bloque de dos pasos y los motivos nuevos tienen
    su patrón. Los límites amarillo/rojo se pintan también cuando el rango normal coincide con el amarillo."""
    from backend.app.rules import recommendations as rec
    from backend.app.rules.calibration import CALIBRATION, CALIBRATION_APPROVED_BY

    runtime_js = (I18N_DIR / "backend-en-runtime.js").read_text(encoding="utf-8")
    runtime_keys = _en_keys(I18N_DIR / "backend-en-runtime.js")
    seed_keys = _en_keys(I18N_DIR / "backend-en-seed.js")

    texts = rec.all_texts()
    alert_texts = texts["now"] | texts["followup"] | texts["level"] | {rec.FALLBACK_IMMEDIATE, rec.FALLBACK_FOLLOWUP}
    assert len(texts["now"]) >= 20 and len(texts["followup"]) >= 20 and len(texts["level"]) == 3
    missing = sorted({_norm(t) for t in alert_texts} - runtime_keys)
    assert not missing, f"backend-en-runtime.js is missing English translations for: {missing}"

    rule_texts = {
        rec.RULE_IMMEDIATE_INSTRUCTIONS, rec.RULE_FOLLOWUP_INSTRUCTIONS, rec.RULE_ESCALATION_CONDITIONS,
        CALIBRATION_APPROVED_BY, *(cal.source for cal in CALIBRATION.values()),
    }
    missing_rule = sorted({_norm(t) for t in rule_texts} - seed_keys)
    assert not missing_rule, f"backend-en-seed.js is missing English translations for: {missing_rule}"

    # Acción inmediata = "1. <paso>\n2. Nivel ...": se traduce con un patrón que traduce cada paso
    assert r"(2\. Nivel (?:de observación|de seguimiento|crítico): .+)$/" in runtime_js
    for state, step in rec.LEVEL_STEP.items():
        assert re.match(r"^2\. Nivel (de observación|de seguimiento|crítico): .+$", step), state
    # Motivos nuevos del motor (rules/evaluation.py y rules/engine.py)
    for fragment in (
        "sin línea base personal válida, se aplica solo el umbral absoluto",
        "además se aleja de la línea base personal",
        "es habitual para esta persona",
        "desvío fuerte frente a la línea base personal",
        "desvío frente a la línea base personal confirmado en dos lecturas seguidas",
        "desvío aislado frente a la línea base personal",
        "Se evalúa la media de las últimas",
        "Noche aislada de",
        "Aún hay menos de",
        "Dosis acumulada registrada de",
        "Última lectura en nivel",
    ):
        assert fragment in runtime_js, f"backend-en-runtime.js needs a pattern for: {fragment}"
    evaluation_src = (PROJECT_ROOT / "backend" / "app" / "rules" / "evaluation.py").read_text(encoding="utf-8")
    engine_src = (PROJECT_ROOT / "backend" / "app" / "rules" / "engine.py").read_text(encoding="utf-8")
    for fragment in ("sin línea base personal válida", "es habitual para esta persona", "Noche aislada de",
                     "Dosis acumulada registrada de"):
        assert fragment in evaluation_src
    assert "Última lectura en nivel" in engine_src

    # Límites: en las reglas calibradas normal == amarillo, así que la comparación incluye la igualdad
    console_js = (FRONTEND_ROOT / "src" / "console" / "console.js").read_text(encoding="utf-8")
    trends_js = (FRONTEND_ROOT / "src" / "console" / "views" / "logbook-trends.js").read_text(encoding="utf-8")
    assert "lo <= r.normal_min" in console_js and "hi >= r.normal_max" in console_js
    assert "Number(v) <= nLo" in trends_js and "Number(v) >= nHi" in trends_js


def test_predictions_view_wired_and_handles_all_states():
    """Issue #28: pestaña Predicciones (solo astronautas), gráfica propia en SVG y estados del modelo."""
    index_html = (FRONTEND_ROOT / "index.html").read_text(encoding="utf-8")
    app_js = (FRONTEND_ROOT / "src" / "app" / "app.js").read_text(encoding="utf-8")
    api_js = (FRONTEND_ROOT / "src" / "services" / "api.js").read_text(encoding="utf-8")
    i18n_src = (FRONTEND_ROOT / "src" / "i18n" / "i18n.js").read_text(encoding="utf-8")
    views_dir = FRONTEND_ROOT / "src" / "console" / "views"
    view_js = (views_dir / "predictions.js").read_text(encoding="utf-8")
    chart_js = (views_dir / "prediction-chart.js").read_text(encoding="utf-8")

    # Módulos, hojas e importmap versionados
    for name in ("predictions", "prediction-chart"):
        assert (views_dir / f"{name}.css").is_file()
        assert f"/src/console/views/{name}.js?v=__BUILD__" in index_html
        assert f"/src/console/views/{name}.css?v=__BUILD__" in index_html

    # Pestaña antes de Recomendaciones (que sigue siendo la última), textos es/en y ruta en app.js
    tabs = re.findall(r'class="av-tab"[^>]*data-nav-section="([\w-]+)"', index_html)
    assert "predictions" in tabs and tabs[-1] == "recommendations"
    assert i18n_src.count('"tab.predictions":') == 2, "tab.predictions must exist in es and en"
    assert 'sectionId === "predictions"' in app_js
    assert "renderPredictions(container, appState" in app_js
    # El endpoint responde 403 a quien no es astronauta: la pestaña se oculta por rol
    assert 'sec === "predictions" && role !== "ASTRONAUT"' in app_js

    # Cliente de la API
    assert "getIndicatorPrediction(" in api_js
    assert "/predictions/indicators/" in api_js
    for param in ("mission_id", "horizon_days", "include_simulated"):
        assert param in api_js

    # Vista: export, DICT es/en con las mismas claves, estados del servicio y aviso no diagnóstico
    assert "export async function renderPredictions" in view_js
    assert view_js.count("const DICT = {") == 1
    es_block, en_block = _dict_blocks(view_js)
    for indent in (4, 6):
        assert _keys(es_block, indent) == _keys(en_block, indent), f"predictions.js DICT es/en differ at indent {indent}"
    assert "tr(DICT)" in view_js
    for state in ("ok", "insufficient_data", "model_not_reliable"):
        assert state in view_js, f"predictions.js must handle status {state}"
    assert 'p.status === "ok"' in view_js and '"model_not_reliable"' in view_js
    for code in ("403", "404", "422", "503"):
        assert code in view_js, f"predictions.js must map HTTP {code}"
    assert "getAnalyticsTimeseries" in view_js  # historial y baseline (la predicción no los trae)
    assert "disclaimer" in view_js

    # Gráfica: módulo propio, sin librerías externas
    assert "export function renderPredictionChart" in chart_js
    assert 'from "./prediction-chart.js"' in view_js
    assert not re.search(r'["/]chart(\.umd)?(\.min)?\.js', index_html, re.I), "no external Chart.js"
    assert "new Chart(" not in view_js


def test_predictions_view_follows_calibrated_forecast_contract():
    """La vista de Predicciones describe el método calibrado (nivel robusto, no una recta OLS) y pinta lo
    que añade el contrato: tendencia, bandas de predicción, proyección contra umbrales, recomendación y
    validación empírica. Todo lo nuevo es opcional: con un servidor anterior se pinta como antes."""
    views_dir = FRONTEND_ROOT / "src" / "console" / "views"
    view_js = (views_dir / "predictions.js").read_text(encoding="utf-8")
    chart_js = (views_dir / "prediction-chart.js").read_text(encoding="utf-8")
    chart_css = (views_dir / "prediction-chart.css").read_text(encoding="utf-8")
    view_css = (views_dir / "predictions.css").read_text(encoding="utf-8")
    es_block, en_block = _dict_blocks(view_js)

    # 1. Textos coherentes con el método: ni OLS, ni recta de regresión, ni "3 días de validación"
    for block in (es_block, en_block):
        assert not re.search(r"OLS|regresi[oó]n|regression|3 días de validación|3 validation days", block), (
            "predictions.js DICT still describes the OLS line"
        )
        assert "{model}" in block and "{ols}" not in block
    assert "repetir el último valor" in es_block and "validación dentro de la propia serie" in es_block
    assert "nivel robusto" in es_block and "robust level" in en_block

    # 2. Tendencia desde el objeto `trend`; el corte sobre beta1 queda solo como respaldo del servidor anterior
    assert "function trendCardHTML" in view_js
    for field in ("p.trend", "t.direction", "t.significant", "t.extrapolated", "t.slope_per_day"):
        assert field in view_js, f"predictions.js must read {field}"
    assert "p.beta1" in view_js
    trend_keys = {"trendUp", "trendDown", "trendFlat", "trendUnknown", "trendProjected", "trendNotProjected", "trendNone"}
    assert trend_keys <= _keys(es_block, 4)
    assert "no se proyecta porque no reduce el error" in es_block

    # 3. Línea base con desviación de relleno
    assert es_block.count("placeholder_std_dev:") == 1 and en_block.count("placeholder_std_dev:") == 1

    # 4. Bandas de predicción en la gráfica: datos, área, leyenda, tooltip y eje Y
    for field in ("lower_80", "upper_80", "lower_95", "upper_95"):
        assert field in view_js and field in chart_js, f"prediction bands need {field}"
    assert {"band80", "band95"} <= _keys(es_block, 6)
    for cls in ("av-pc-band80", "av-pc-band95", "av-pc-key-b80", "av-pc-key-b95", "av-pc-tip-band"):
        assert cls in chart_js and cls in chart_css, f"prediction-chart needs {cls}"
    assert "vals.push(p.b95[0], p.b95[1])" in chart_js  # el dominio del eje Y incluye las bandas
    assert "function bandOf" in chart_js and "return lo <= v && v <= hi ? [lo, hi] : null" in chart_js

    # 5. Proyección contra umbrales y recomendación, antes de la gráfica
    assert "function projectionHTML" in view_js
    for field in ("threshold_projection", "first_expected_crossing", "first_possible_crossing", "current_state",
                  "recommendation", "rec.basis", "rec.text", "days_ahead"):
        assert field in view_js, f"predictions.js must read {field}"
    assert "projectionHTML(r) + chartPanelHTML(r)" in view_js
    assert {"projH", "projExpected", "projPossible", "projNow", "projNone", "projNoRule", "recH"} <= _keys(es_block, 4)
    assert {"NORMAL", "MONITOR", "WARNING", "CRITICAL", "above", "below", "both"} <= _keys(es_block, 6)
    assert "esc(bt(recText))" in view_js  # el texto de la regla llega del backend: se traduce y se escapa
    assert ".av-pr-proj" in view_css and ".av-pr-rec" in view_css
    # La proyección usa el motor de alertas: umbral del rango de la regla o de la banda personal
    # (línea base ± Z·DE), banda personal en los rangos y, si ya está fuera de rango, la acción inmediata
    for field in ("c.reference", "personal_baseline", "tp.ranges.personal_yellow", "rec.immediate_action"):
        assert field in view_js, f"predictions.js must read {field}"
    assert "baseline_delta" not in view_js.replace("f.baseline_delta", "")
    assert {"projPersonal", "projPersonalLow", "projRefPersonal", "recNowH"} <= _keys(es_block, 4)
    assert "esc(bt(nowText))" in view_js

    # Los textos de recomendación que puede devolver el pronóstico son los del catálogo de alertas
    # (ya traducidos: test_alert_recommendations_and_rule_sources_have_english_translation) y el bloque
    # de dos pasos de la acción inmediata tiene su patrón en bt()
    service_src = (PROJECT_ROOT / "backend" / "app" / "services" / "prediction_service.py").read_text(encoding="utf-8")
    for name in ("get_recommendation(", "build_alert_texts(", "rec.followup", "LEVEL_STEP"):
        assert name in service_src, f"prediction_service.py must take its recommendation from the alert catalog ({name})"
    from backend.app.rules import recommendations as rec

    runtime_keys = _en_keys(I18N_DIR / "backend-en-runtime.js")
    generic = {rec.CATALOG[(rec.GENERIC, d)] for d in (rec.HIGH, rec.LOW, rec.PERSONAL)}
    missing = sorted({_norm(t) for g in generic for t in (g.now, g.followup)} - runtime_keys)
    assert not missing, f"Missing English translations for the generic recommendations: {missing}"

    # 6. Validación empírica: validado con datos reales o no
    assert "empirical_validation" in view_js and "validated_with_real_data" in view_js
    assert {"valYes", "valNo"} <= _keys(es_block, 4)
    assert "esc(bt(String(ev.note)))" in view_js

    # 7. Tolerancia: sin los campos nuevos no se pinta el bloque ni las bandas, y no hay errores
    assert '!("threshold_projection" in p) && !("recommendation" in p)' in view_js
    assert 't && typeof t === "object"' in view_js
    assert "innerHTML" in view_js and "${rec.text}" not in view_js and "${ev.note}" not in view_js
