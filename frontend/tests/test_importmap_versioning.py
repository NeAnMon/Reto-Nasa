"""Cada módulo JS del frontend debe estar en el importmap con ?v=__BUILD__.

Si falta, el navegador (y Cloudflare, max-age 4 h) sigue sirviendo la versión anterior del
módulo tras un despliegue. Pasó con measure-data.js: tras pasar el catálogo a la BD, los
navegadores seguían pidiendo el measure-demo.json ya borrado (404).
"""
from pathlib import Path

FRONTEND_ROOT = Path(__file__).resolve().parent.parent


def test_every_src_module_is_versioned_in_importmap():
    index_html = (FRONTEND_ROOT / "index.html").read_text(encoding="utf-8")
    missing = []
    for js in sorted((FRONTEND_ROOT / "src").rglob("*.js")):
        rel = "/" + js.relative_to(FRONTEND_ROOT).as_posix()
        if f'"{rel}": "{rel}?v=__BUILD__"' not in index_html:
            missing.append(rel)
    assert not missing, f"Módulos sin versionar en el importmap de index.html: {missing}"
