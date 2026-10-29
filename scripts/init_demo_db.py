"""Initialize AstroVital database schema and seed reproducible DEMO dataset."""
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.app.database.session import Base, SessionLocal, engine
from backend.app.database.seed import seed_database


def main():
    print("[AstroVital] Creando tablas relacionales e índices...")
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        print("[AstroVital] Sembrando datos sintéticos reproducibles (MODO DEMO)...")
        seed_database(db, force_reseed_sim=False)
        print("[AstroVital] Base de datos inicializada correctamente.")
    finally:
        db.close()


if __name__ == "__main__":
    main()

