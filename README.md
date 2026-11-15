# AstroVital — *Your health. Your mission. Your future.*
### Plataforma interactiva, gamificada y adaptativa para el monitoreo integral de la salud de astronautas
**NASA Space Apps Challenge — *Health Monitoring Software for Astronauts on Space Missions***

---

## 1. Visión General y Principio Central

**AstroVital** es una plataforma web full-stack diseñada para acompañar a los astronautas y al equipo de apoyo en tierra durante misiones espaciales de corta, mediana y larga duración frente a los **cinco grandes peligros de los vuelos espaciales**:
1. **Radiación espacial**
2. **Aislamiento y confinamiento**
3. **Distancia de la Tierra**
4. **Campos gravitacionales alterados**
5. **Entornos cerrados u hostiles**

> **Principio Central:** AstroVital ayuda a **observar, comprender, registrar y comunicar** información sobre la salud y el bienestar. **No diagnostica de manera autónoma**, no reemplaza a los profesionales sanitarios y no modifica protocolos médicos críticos por decisión de un algoritmo ni por cambios automáticos de entorno.

---

## 2. Características Principales Implementadas

1. **Mission Control Dashboard**: Encabezado de misión en tiempo real (UTC, MET, fase, entorno y fuente de determinación), resumen operativo sin falsos "porcentajes de salud clínica", 12 tarjetas dinámicas de indicadores fisiológicos y de bienestar, y tabla de telemetría ambiental (ECLSS/cabina/traje).
2. **Body Explorer (Silueta Humana SVG Interactiva)**: Silueta vectorial con **10 regiones anatómicas seleccionables** por mouse, teclado o pantalla táctil (`HEAD_BRAIN`, `EYES_VISION`, `HEART_CARDIO`, `LUNGS_RESP`, `IMMUNE_SYSTEM`, `DIGESTIVE_NUTRITION`, `BONES_SKELETAL`, `MUSCLES`, `SKIN_THERMO`, `GENERAL_WELLNESS`), iluminación dinámica según el estado operativo y cápsulas educativas sobre riesgos espaciales.
3. **My Health Check**: Flujo guiado paso a paso con validación de rangos y unidades, soporte para evaluaciones parciales cuando un sensor no está disponible, importación masiva en **CSV/JSON** y cola de sincronización sin conexión con clave de deduplicación.
4. **Motor Determinista de Reglas y Alertas (`backend/app/rules/engine.py`)**: Independiente de modelos de IA. Evalúa estados `NORMAL`, `MONITOR`, `WARNING`, `CRITICAL`, `UNKNOWN`, `STALE` e `INVALID`, desviaciones frente a la línea base individual y contradicciones entre fuentes. Cada alerta conserva el código y versión de la regla (`DEMO`) y permite reconocimiento, seguimiento y escalamiento.
5. **Context-Aware Environment Engine (`ContextResolver`)**: Soporta 13 perfiles ambientales (`EARTH_SURFACE`, `LOW_EARTH_ORBIT`, `DEEP_SPACE_TRANSIT`, `LUNAR_ORBIT`, `LUNAR_SURFACE`, `MARS_TRANSIT`, `MARS_ORBIT`, `MARS_SURFACE`, `PRESSURIZED_HABITAT`, `SPACECRAFT_CABIN`, `EXTRAVEHICULAR_ACTIVITY`, `UNKNOWN_ENVIRONMENT`, `SIMULATION_ENVIRONMENT`). Nunca utiliza el GPS de un teléfono para asumir ubicación fuera de la Tierra ni altera automáticamente los umbrales clínicos.
6. **Wellness Center con Privacidad Reforzada**: Cuestionario educativo de demostración claramente identificado como no diagnóstico, guardado de borradores, guía animada de respiración táctica 4-4-4-4 y catálogo de recomendaciones que suprime automáticamente el ejercicio si existe una alerta médica incompatible. Las respuestas detalladas son privadas por defecto.
7. **Gamificación Ética (`Daily Missions`)**: 10 misiones diarias, sistema de experiencia (XP) verificado en el backend, 5 niveles (`Cadet`, `Explorer`, `Specialist`, `Mission Expert`, `Wellbeing Champion`) y 7 insignias. Reconoce la constancia y el aprendizaje (nunca signos vitales "normales") y permite omitir tareas por restricciones operativas (`EXCUSED_OPERATIONAL_RESTRICTION`) sin penalizar la racha.
8. **Mission Analytics e Informes Descargables**: Gráficos longitudinales interactivos (Chart.js) con representación explícita de discontinuidades temporales, comparación por fases de misión y exportación auditada en **PDF, CSV y JSON**.
9. **Simulador Reproducible de Telemetría (9 Escenarios DEMO)**: Todos los datos sintéticos se etiquetan como **SIMULADO** e incluye reinicio seguro de datos de demostración.
10. **Seguridad, RBAC y Auditoría**: Tres roles (`ASTRONAUT`, `MISSION_LEADER`, `ADMINISTRATOR`), contraseñas con hash `PBKDF2-HMAC-SHA256`, bloqueo temporal por intentos fallidos, revocación de sesiones, protección frente a escalamiento horizontal y bitácora de auditoría (`audit_events`).
11. **Módulo 1 — Communication Center**: Centro de mensajería directa, privada y 1 a 1 entre cada astronauta y el líder en tierra asignado, con 8 categorías operativas (`GENERAL`, `HEALTH_UPDATE`, `COGNITIVE_SUPPORT`, `EMOTIONAL_SUPPORT`, `MISSION_COORDINATION`, `TECHNICAL_ISSUE`, `REQUEST_FOR_ASSISTANCE`, `URGENT_COMMUNICATION`), respuesta a mensajes específicos, cola sin conexión sin falsificar entrega antes de confirmación del servidor, bloqueo de lectura silenciosa por administradores sin auditoría y sistema estructurado de **Solicitudes de Apoyo** (`REQUESTED`, `RECEIVED`, `IN_REVIEW`, `RESPONDED`, `ESCALATED`, `CLOSED`) con integración directa desde alertas.
12. **Módulo 2 — Cognitive Performance Center**: Evaluación interactiva y seguimiento longitudinal en **9 dominios cognitivos independientes** (`VISUAL_LEARNING`, `MEMORY`, `ATTENTION`, `ABSTRACTION`, `SPATIAL_ORIENTATION`, `EMOTION_RECOGNITION`, `ABSTRACT_REASONING`, `COMPLEX_EXPLORATION`, `VISUAL_TRACKING`) con 3 niveles de dificultad (`BASIC`, `INTERMEDIATE`, `ADVANCED`), verificación previa de descanso/fatiga/estrés con opción de posponer sin penalización, comparación frente a la línea base personal únicamente bajo dominio/dificultad/versión equivalentes considerando el efecto de práctica, sin generar puntajes globales de CI ni diagnósticos neurológicos, e integrado con 8 insignias cognitivas no competitivas.
13. **Módulo 3 — Emotional Assessment Center**: Sistema dual de **Emotional Assessment Management** (para que el `ADMINISTRATOR` solicite cuestionarios emocionales a uno o varios astronautas y supervise exclusivamente el estado administrativo de cumplimiento `DRAFT` a `COMPLETED`) y **My Emotional Check-In** (para que el `ASTRONAUT` responda 12 dimensiones emocionales y 6 preguntas abiertas opcionales con soporte para *"Prefiero no responder"*), impulsado por el motor determinista `EmotionalWellnessEngine` con separación estricta de privacidad y protocolo inmediato de apoyo urgente.

---

## 3. Estructura del Proyecto

```text
Reto-Nasa/
├── backend/
│   ├── app/
│   │   ├── api/v1/router.py        # Endpoints REST bajo /api/v1
│   │   ├── core/config.py          # Configuración y variables de entorno
│   │   ├── database/
│   │   │   ├── session.py          # Motor SQLAlchemy (SQLite / PostgreSQL)
│   │   │   └── seed.py             # Semilla reproducible DEMO y reinicio seguro
│   │   ├── models/models.py        # 33 modelos relacionales SQLAlchemy
│   │   ├── rules/engine.py         # Motor determinista de reglas y ContextResolver
│   │   ├── schemas/schemas.py      # Esquemas de validación Pydantic
│   │   ├── security/auth.py        # Autenticación, RBAC, sesiones y auditoría
│   │   ├── services/
│   │   │   ├── ai_assistant.py     # Orientación asistiva basada en reglas y plantillas
│   │   │   ├── gamification.py     # Motor de XP, niveles e insignias en servidor
│   │   │   └── simulator.py        # Simulador de telemetría (9 escenarios DEMO)
│   │   └── main.py                 # Punto de entrada FastAPI + servidor estático SPA
│   └── tests/
│       └── test_astrovital.py      # Suite de pruebas automatizadas (Pytest)
├── frontend/
│   ├── index.html                  # Interfaz semántica y accesible (11 módulos)
│   └── src/
│       ├── app/app.js              # Lógica SPA, SVG Body Explorer, gráficos y flujos
│       ├── services/api.js         # Cliente HTTP y cola de sincronización offline
│       └── styles/main.css         # Sistema de diseño espacial (Dark, High-Contrast, Light)
├── migrations/
│   └── 001_initial_schema.sql      # Referencia de esquema relacional
├── scripts/
│   └── init_demo_db.py             # Script de inicialización manual de base de datos
├── docs/
│   ├── API_ENDPOINTS.md            # Documentación detallada de la API REST
│   └── JURY_DEMO_SCRIPT.md         # Guion de demostración de 5 minutos (10 escenas)
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── README.md
```

---

## 4. Requisitos e Instalación Local

### 4.1 Crear entorno virtual e instalar dependencias
```powershell
python -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
```

### 4.2 Configurar variables de entorno (Opcional en desarrollo)
```powershell
Copy-Item .env.example .env
```
> **Advertencia de Seguridad:** Sustituya `SECRET_KEY` y todas las contraseñas de demostración antes de cualquier despliegue en un entorno público o de producción.

### 4.3 Inicializar base de datos y datos sintéticos DEMO
La aplicación inicializa y siembra automáticamente la base de datos SQLite (`astrovital.db`) al arrancar, o puede ejecutar manualmente:
```powershell
.\.venv\Scripts\python scripts/init_demo_db.py
```

### 4.4 Ejecutar la aplicación
```powershell
.\.venv\Scripts\uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```
- **Interfaz Web (SPA)**: `http://127.0.0.1:8000`
- **Documentación Interactiva OpenAPI (Swagger)**: `http://127.0.0.1:8000/docs`

---

## 5. Credenciales Ficticias para Demostración Local

> *Exclusivamente para evaluación local en modo DEMO:*

| Rol | Nombre Ficticio | Correo Electrónico | Contraseña Local DEMO | Misión Asignada |
| :--- | :--- | :--- | :--- | :--- |
| **Astronauta 1** | Cmdr. Elena Rostova | `elena.rostova@astrovital.demo` | `AstroCrew!2026` | `ARTEMIS-IV-DEMO` |
| **Astronauta 2** | Dr. Marcus Vance | `marcus.vance@astrovital.demo` | `AstroCrew!2026` | `ARTEMIS-IV-DEMO` |
| **Astronauta 3** | Spec. Kenji Takahashi | `kenji.takahashi@astrovital.demo` | `AstroCrew!2026` | `ARES-PATHFINDER-DEMO` |
| **Líder en Tierra** | Dir. Carlos Ibáñez | `leader@astrovital.demo` | `AstroLeader!2026` | `ARTEMIS-IV-DEMO` |
| **Administradora** | Dra. Valeria Mendoza | `admin@astrovital.demo` | `AstroAdmin!2026` | Supervisión de Plataforma |

> **Todas estas cuentas solo se crean con `SEED_DEMO_DATA=true`.** Con `SEED_DEMO_DATA=false` no se crea ninguna cuenta demo, ni siquiera sobre una BD existente (los catálogos del módulo de aislamiento sí se mantienen al día). Desactívelo y cambie las contraseñas `DEMO_*` antes de cualquier despliegue accesible.

> **Recuperación de contraseña:** `POST /api/v1/auth/password-recovery/request` nunca devuelve el token en la respuesta. Solo para una demo local aislada puede activarse `DEMO_EXPOSE_RECOVERY_TOKEN=true` (por defecto `false`; el arranque lo avisa en el log), que permitiría a cualquiera restablecer la contraseña de cualquier cuenta. `APP_ENV` es solo informativo.

---

## 5.1 Despliegue con Docker

```bash
docker compose up -d --build
```
- La BD SQLite vive en el volumen `astrovital_data` montado en `/app/data`.
- `docker-compose.yml` usa `.env.example` (valores de demostración). Para producción use su propio `.env` con `SECRET_KEY` aleatoria, `SEED_DEMO_DATA=false` y `DEMO_EXPOSE_RECOVERY_TOKEN=false`; si no, el arranque registra avisos `CONFIGURACIÓN INSEGURA`.

---

## 6. Ejecución de Pruebas Automatizadas

Para ejecutar la suite completa de pruebas automatizadas con `pytest`:
```powershell
.\.venv\Scripts\pytest -v
```

---

## 7. Fuentes de Datos, Simulación y Limitaciones Conocidas

1. **Datos Sintéticos (`SIMULADO`)**: Los valores precargados y los generados por los 9 escenarios del simulador son sintéticos con fines educativos y de demostración. No corresponden a datos médicos reales de astronautas.
2. **Reglas Operativas (`DEMO`)**: Los umbrales de referencia incluidos están etiquetados como `1.0-DEMO` y sirven para verificar el funcionamiento determinista del motor de reglas; en un despliegue operativo real deben ser cargados y firmados por autoridades médicas de vuelo certificadas.
3. **Integraciones de Hardware**: No se afirma conexión directa con sensores espaciales ni monitores clínicos reales; se incluye el adaptador preparado (`BIOMETRIC_HARNESS_STUB`) y la importación estructurada CSV/JSON.
4. **Cuestionario de Bienestar**: El instrumento `SPACE_WELLNESS_CHECK_DEMO` es una herramienta educativa de autoevaluación y comunicación preventiva, no una prueba psicométrica clínica validada.

