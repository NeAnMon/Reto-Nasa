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
    # "Contacto con Tierra" es solo una tarjeta de recomendación: enlaza al módulo Recomendaciones y a la fuente NASA
    assert 'data-wb-go="recommendations">${esc(T.earthOpen)}' in wellbeing_js
    assert 'const EARTH_SOURCE_URL = "https://www.nasa.gov/hrp/"' in wellbeing_js
    assert "getFamilyContacts" not in wellbeing_js
    # Enlaces externos seguros
    assert 'rel="noopener noreferrer"' in wellbeing_js
    assert 'u.protocol === "https:"' in wellbeing_js
    # La vista no usa atributos que escuchan console.js (data-act) o app.js (data-nav-section)
    assert "data-nav-section" not in wellbeing_js.split("*/", 1)[1]
    assert "data-act=" not in wellbeing_js

    # Evaluación cognitiva y Check-in emocional salieron del menú "Más":
    # se abren desde Bienestar → Hoy, y sus rutas siguen funcionando
    for sub_id in ["cognitive-center", "emotional-center"]:
        assert f'data-nav-section="{sub_id}"' not in index_html, f"{sub_id} should not be a menu item"
        assert f'sectionId === "{sub_id}"' in app_js, f"Missing handler for {sub_id}"
        assert f'tool("{sub_id}"' in wellbeing_js, f"Bienestar → Hoy must link to {sub_id}"
    assert 'data-wb-go="${sec}"' in wellbeing_js

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
    assert 'openWellbeingSub("checks")' in app_js
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
