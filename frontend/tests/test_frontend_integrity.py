from pathlib import Path

FRONTEND_ROOT = Path(__file__).resolve().parent.parent


def test_frontend_files_exist_and_have_required_sections():
    index_html = (FRONTEND_ROOT / "index.html").read_text(encoding="utf-8")
    app_js = (FRONTEND_ROOT / "src" / "app" / "app.js").read_text(encoding="utf-8")
    main_css = (FRONTEND_ROOT / "src" / "styles" / "main.css").read_text(encoding="utf-8")

    # Verify all 11 navigation modules exist
    for nav_id in [
        "mission-control",
        "my-health-check",
        "body-explorer",
        "wellness-center",
        "daily-missions",
        "mission-analytics",
        "alerts-center",
        "crew-monitoring",
        "reports",
        "administration",
        "settings-help",
    ]:
        assert nav_id in index_html, f"Missing nav section {nav_id}"
        assert nav_id in app_js, f"Missing handler for {nav_id}"

    # Verify accessibility & responsive support
    assert "prefers-reduced-motion" in main_css
    assert 'data-theme="high-contrast"' in main_css
    assert 'aria-label' in index_html

