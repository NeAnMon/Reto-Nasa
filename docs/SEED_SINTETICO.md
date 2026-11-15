# Precarga de datos sintéticos por API (issue #24)

`scripts/seed_synthetic_api.py` genera una tripulación y una misión **ficticias** y les carga un histórico
diario de indicadores fisiológicos, mediciones ambientales, evaluaciones de bienestar, check-ins y misiones
diarias **a través de los endpoints de FastAPI** (`/api/v1/...`). Sirve para probar predicciones, gráficas,
comparación de fases, alertas, entorno y bienestar con datos suficientes.

- **El backend decide**: cada medición pasa por `POST /health/measurements`, así que el estado
  (`NORMAL`/`MONITOR`/`WARNING`/`CRITICAL`) y las alertas los calcula el motor calibrado. El script solo
  apunta a los tramos de la regla vigente (leídos de `GET /health/indicators`) para las anomalías controladas.
- **Todo es SIMULADO**: `is_simulated=true`, calidad `SYNTHETIC_DEMO`, fuente `DEMO_SIMULATION`, notas
  `[SIMULADO] Precarga sintética issue #24`, misión `is_simulated=true`. No hay datos médicos reales.
- **Reproducible**: misma `--seed` y misma `--end-date` ⇒ mismos valores.
- **Idempotente**: cada medición lleva una `dedup_key` determinista (`seed24:<misión>:<crew>:<indicador>:<día>`)
  y antes de enviar se consulta lo existente. Una segunda ejecución el mismo día no crea nada; un día después
  solo añade el día nuevo.

## Requisitos

- La API levantada (`uvicorn backend.app.main:app ...` o Docker) con las cuentas demo del seed
  (`SEED_DEMO_DATA=true`).
- `httpx` (ya está en `requirements.txt`).

## Uso

```powershell
# API local en http://127.0.0.1:8000, credenciales demo tomadas de .env / backend/app/core/config.py
.\.venv\Scripts\python scripts/seed_synthetic_api.py

# Con líneas base sintéticas (ejecutar donde la API comparte DATABASE_URL, p. ej. dentro del contenedor)
.\.venv\Scripts\python scripts/seed_synthetic_api.py --baselines-db
```

Docker: `docker compose exec <servicio> python scripts/seed_synthetic_api.py --baselines-db`.

Al terminar imprime un resumen JSON: entidades creadas/omitidas/fallidas, estados calculados por el backend,
mediciones que generaron alerta, estados ambientales (`environment_states_created`) y alertas ambientales
creadas o actualizadas (`environment_alerts`, una por astronauta de la misión) y una **verificación** (días por indicador, serie temporal, comparación de
fases, resumen de salud, predicciones por astronauta e indicador, alertas, entorno y bienestar).
Código de salida: `0` todo correcto, `1` hubo fallos o alguna verificación no se cumplió, `2` error de
configuración/conexión.

### Credenciales (nunca en el código)

| Variable | Alternativa | Uso |
| --- | --- | --- |
| `SEMSA_ADMIN_EMAIL` / `SEMSA_ADMIN_PASSWORD` | `DEMO_ADMIN_EMAIL` / `DEMO_ADMIN_PASSWORD` | Crea usuarios, misión, asignaciones y carga mediciones |
| `SEMSA_LEADER_EMAIL` | `DEMO_LEADER_EMAIL` | Líder demo asignado a la misión sintética (ve a la tripulación en su consola) |
| `SEMSA_SYNTH_PASSWORD` | `DEMO_ASTRONAUT1_PASSWORD` | Contraseña de los astronautas sintéticos (predicciones, bienestar, gamificación) |

Si no hay variables y el paquete `backend` es importable, se usan las cuentas demo ya definidas en
`backend/app/core/config.py`.

### Opciones

| Opción | Variable | Defecto | Descripción |
| --- | --- | --- | --- |
| `--base-url` | `SEMSA_API_URL` | `http://127.0.0.1:8000` | URL base de la API |
| `--astronauts` | `SEMSA_SEED_ASTRONAUTS` | `3` | Astronautas sintéticos (`SYN24-01`…) |
| `--days` | `SEMSA_SEED_DAYS` | `45` | Días UTC de histórico |
| `--seed` | `SEMSA_SEED` | `24` | Semilla aleatoria |
| `--end-date` | `SEMSA_SEED_END_DATE` | hoy (UTC) | Último día del histórico (`AAAA-MM-DD`) |
| `--mission-code` | `SEMSA_SEED_MISSION` | `SYNTH-SEED-24` | Misión sintética (si existe y no es simulada, se aborta) |
| `--crew-prefix` | `SEMSA_SEED_CREW_PREFIX` | `SYN24` | Prefijo de códigos y correos (`syn24.astro1@semsa.demo`) |
| `--indicators` | `SEMSA_SEED_INDICATORS` | los 10 del issue | Lista separada por comas |
| `--modules` | `SEMSA_SEED_MODULES` | `health,environment,wellness,gamification` | Módulos habilitados |
| `--baselines-db` | — | no | Crea líneas base con SQLAlchemy (no existe endpoint). Prohibida con `--allow-remote` |
| `--reset --confirm-reset` | — | no | Llama a `POST /simulator/reset` antes de cargar (ver abajo) |
| `--allow-remote` | — | no | Permite un host no local (solo desarrollo/pruebas, **nunca producción**). Exige URL `https`, `SEMSA_SYNTH_PASSWORD` explícita (no se reutiliza la contraseña demo) y no admite `--baselines-db` |
| `--no-verify` | — | no | Omite la verificación posterior |

## Qué genera

**Tripulación y misión.** `POST /users` (rol `ASTRONAUT`, perfil con callsign y especialidad ficticios),
`POST /missions` (`is_simulated=true`) y `POST /missions/{id}/assignments` (astronautas + líder demo).
La misión es nueva y separada de las del seed demo, así el segmento reciente de fase/entorno no se mezcla
con los datos demo existentes.

**Fases y entornos.** El primer tercio del histórico es `TRANSIT` / `LUNAR_ORBIT` y el resto `SURFACE` /
`LUNAR_SURFACE` (fase vigente). El backend toma fase y entorno del contexto activo al recibir cada lectura,
así que el script cambia el contexto del astronauta (`POST /missions/{id}/context`) solo cuando le faltan
lecturas de ese bloque. Con 45 días quedan 30 días en el segmento reciente (≥ 10 que exige el predictor).

**Indicadores.** `HEART_RATE`, `BLOOD_PRESSURE` (con diastólica), `BODY_TEMP`, `SPO2`, `RESP_RATE`,
`SLEEP_DURATION`, `PERCEIVED_FATIGUE`, `HYDRATION`, `PHYSICAL_ACTIVITY` y `BLOOD_GLUCOSE`: una lectura diaria
alrededor de la línea base personal ficticia de cada astronauta. `BLOOD_GLUCOSE` solo se registra los
últimos 5 días, para comprobar `insufficient_data`.

**Escenarios** (por turno):

| Astronauta | Escenario | Contenido |
| --- | --- | --- |
| `SYN24-01` | `ESTABLE` | Series estables → predicciones `ok` |
| `SYN24-02` | `TENDENCIAS` | Pulso creciente, sueño e hidratación decrecientes, actividad creciente, temperatura como paseo aleatorio (candidato a `model_not_reliable`) |
| `SYN24-03` | `ANOMALIAS` | SpO₂ e hidratación descendentes y lecturas anómalas controladas en los últimos días (tramos crítico, aviso y observación de la regla vigente) y un pico a mitad del histórico |

En la prueba de integración (3 astronautas, 30 días) salen predicciones `ok`, `insufficient_data` y
`model_not_reliable`, y alertas `MONITOR`, `WARNING` y `CRITICAL`; el estado exacto lo deciden el predictor y
el motor de alertas, así que con otras opciones el reparto puede variar (la verificación lo informa).

**Entorno.** Una instantánea diaria por fase de `CABIN_TEMP`, `HUMIDITY`, `CABIN_PRESSURE`, `CO2_LEVEL`,
`PPO2`, `RADIATION_DOSE` y `AIR_QUALITY` (`POST /environment/measurements`). Las medias están dentro del
rango normal del motor ambiental con margen (CO₂ 2,0 ± 0,1 mmHg, +0,2 en órbita; normal ≤ 2,5), así que el
ruido no genera alertas. La única anomalía ambiental es **intencional** y está fijada en el script
(`ENV_ANOMALIES`): en la fase de tránsito (`LUNAR_ORBIT`) el CO₂ queda en 3,1 mmHg (depurador del módulo
cislunar degradado, ficticio), fuera del rango normal pero dentro del de observación, y el motor abre una
alerta `MONITOR` / `LOW` por astronauta de la misión (`environment_alerts` en el resumen).

**Bienestar y gamificación** (con la sesión de cada astronauta): una evaluación al día
(`POST /wellness/assessments`, puntuaciones ficticias de ánimo, estrés, sueño, fatiga, concentración y
adaptación), una valoración de la primera recomendación (`POST /wellness/feedback`), un check-in rápido
(`POST /wellness/quick-checkin`, con `dedup_key`) y hasta dos misiones diarias
(`POST /gamification/missions/complete`; las pausadas por seguridad se omiten).

**Líneas base** (`--baselines-db`): una por astronauta e indicador, `is_simulated=true`, con la DE demo de
`rules/calibration.demo_std_dev` (la misma que usa el seed).

## Reinicio

`--reset --confirm-reset` llama a `POST /simulator/reset`, que borra **todos** los registros simulados
(incluido el escenario demo, que se regenera) y conserva usuarios, misiones y líneas base. Sin
`--confirm-reset` el script se niega. Ojo: cualquier otra llamada a ese endpoint (p. ej. desde la consola del
simulador) también borra estos datos; basta con volver a ejecutar el script.

## Limitaciones conocidas / pendientes

- **Líneas base**: no hay endpoint de escritura; solo con `--baselines-db` (acceso directo a la BD).
- **Histórico ambiental, de bienestar y check-ins**: esos endpoints fijan la fecha al momento de la
  petición, así que solo se carga el día actual (las ejecuciones en días sucesivos van acumulando historia).
- **`POST /health/measurements/import`** ignora `measured_at` (usa la hora actual): no sirve para histórico;
  el script usa `POST /health/measurements` lectura a lectura.
- **Evaluaciones cognitivas, emocionales, comunicación y actividades de tripulación**: tienen flujos de
  varios pasos (solicitud, inicio, respuestas, cierre); no se cubren todavía.
- **Reconocimiento/seguimiento de alertas** (`AlertAcknowledgement`, `FollowUpAction`): no se generan.
- **Reinicio selectivo** solo de esta misión: no hay endpoint; `--reset` es global para datos simulados.
