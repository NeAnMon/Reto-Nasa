"""Lecturas del dosímetro CAD: la vista Radiación las guarda y lee en la base de datos (API),
ya no en localStorage del navegador."""
import re
from pathlib import Path

FRONTEND_ROOT = Path(__file__).resolve().parent.parent
CONSOLE_JS = FRONTEND_ROOT / "src" / "console" / "console.js"
API_JS = FRONTEND_ROOT / "src" / "services" / "api.js"


def _console():
    return CONSOLE_JS.read_text(encoding="utf-8")


def test_cad_readings_are_not_written_to_local_storage():
    src = _console()
    set_items = [line for line in src.splitlines() if "localStorage.setItem(" in line]
    assert not [line for line in set_items if "cad" in line.lower()], set_items
    assert "function saveCad" not in src
    assert "saveCad(" not in src
    # la clave antigua solo se lee para migrarla y después se borra
    assert "av_cad_entries_" in src
    assert "localStorage.removeItem(LEGACY_CAD_KEY(" in src


def test_console_uses_dosimeter_api():
    src = _console()
    assert "apiService.getDosimeterReadings(" in src
    assert "apiService.createDosimeterReading(" in src
    # siempre el tripulante y la misión del selector (el líder registra para su tripulación)
    assert "st.selectedAstronautId" in src and "st.selectedMissionId" in src
    assert "currentUser.id" not in src
    # el formulario envía los campos del contrato
    for field in ("astronaut_id:", "mission_id:", "measured_at:", "dose_mgy:", "rate_ugy_h:", "location:", "dedup_key:"):
        assert field in src, field


def test_api_service_exposes_dosimeter_methods():
    api = API_JS.read_text(encoding="utf-8")
    assert "getDosimeterReadings(" in api
    assert "createDosimeterReading(" in api
    assert "/radiation/dosimeter-readings" in api


def test_cad_note_no_longer_claims_local_storage():
    src = _console()
    notes = re.findall(r"^    cadNote: \"([^\"]*)\",", src, re.M)
    assert len(notes) == 2, "cadNote debe existir en es y en"
    for text in notes:
        assert "este dispositivo" not in text
        assert "this device" not in text.lower()
        assert "CAD" in text and "CPD" in text
    # el texto de error de guardado local ya no existe (ni en es ni en en)
    assert "saveLocalFailed" not in src
