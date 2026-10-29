# Documentación de Endpoints REST — AstroVital (`/api/v1`)

La API de **AstroVital** sigue principios RESTful bajo el prefijo versionado `/api/v1`. Todos los endpoints protegidos requieren el encabezado `Authorization: Bearer <access_token>` obtenido al iniciar sesión, y validan permisos de rol (`ASTRONAUT`, `MISSION_LEADER`, `ADMINISTRATOR`) y aislamiento horizontal de datos en el servidor.

---

## 1. Autenticación (`/api/v1/auth`)

| Método | Ruta | Rol Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/login` | Público | Autentica credenciales (`email`, `password`), verifica estado de cuenta (`ACTIVE`) y bloqueo por intentos fallidos, y devuelve `access_token`, `csrf_token` y perfil. |
| `POST` | `/api/v1/auth/logout` | Autenticado | Revoca el token de sesión activo y registra el evento en auditoría. |
| `GET` | `/api/v1/auth/me` | Autenticado | Devuelve el perfil del usuario autenticado, sus permisos, misiones asignadas y hora UTC del servidor. |
| `POST` | `/api/v1/auth/password-recovery/request` | Público | Genera un token temporal de recuperación de contraseña con expiración de 30 minutos. |
| `POST` | `/api/v1/auth/password-recovery/reset` | Público | Restablece la contraseña validando el token temporal y revoca todas las sesiones previas. |

---

## 2. Usuarios, Roles y Permisos (`/api/v1/users`, `/api/v1/roles`)

| Método | Ruta | Rol Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/roles` | Autenticado | Lista los roles configurados (`ASTRONAUT`, `MISSION_LEADER`, `ADMINISTRATOR`) y sus permisos asociados. |
| `GET` | `/api/v1/users` | Autenticado | Lista usuarios según el alcance autorizado del rol (propio para Astronauta, tripulación asignada para Líder, directorio completo para Administrador). |
| `POST` | `/api/v1/users` | `ADMINISTRATOR` | Crea un nuevo usuario con hash seguro PBKDF2-HMAC-SHA256, perfil de astronauta e inicialización de gamificación. |
| `GET` | `/api/v1/users/{user_id}` | Autenticado (con verificación de alcance) | Obtiene el detalle de un usuario autorizado. |
| `PATCH` | `/api/v1/users/{user_id}` | Propio o `ADMINISTRATOR` | Actualiza preferencias de tema, privacidad de señales de bienestar y perfil. |
| `PATCH` | `/api/v1/users/{user_id}/status` | `ADMINISTRATOR` | Suspende (`SUSPENDED`), inactiva o reactiva (`ACTIVE`) una cuenta, revocando sesiones activas y registrando auditoría. |
| `PATCH` | `/api/v1/users/{user_id}/role` | `ADMINISTRATOR` | Asigna o modifica el rol de un usuario con justificación auditada. |

---

## 3. Misiones y Context-Aware Environment Engine (`/api/v1/missions`, `/api/v1/environment`)

| Método | Ruta | Rol Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/missions` | Autenticado | Lista las misiones autorizadas, sus fases, tripulación asignada y el contexto activo resuelto por `ContextResolver`. |
| `POST` | `/api/v1/missions` | `ADMINISTRATOR` | Crea una nueva misión, su fase inicial y su contexto operativo. |
| `POST` | `/api/v1/missions/{mission_id}/assignments` | `ADMINISTRATOR` | Asigna un astronauta o líder en tierra a una misión. |
| `GET` | `/api/v1/missions/{mission_id}/context` | Autenticado | Resuelve el entorno actual, fuente de determinación, antigüedad y estado de conectividad. |
| `POST` | `/api/v1/missions/{mission_id}/context` | Autenticado | Actualiza el entorno y fase de misión. **Garantía clínica:** conserva intactos los umbrales de las reglas clínicas (`clinical_thresholds_modified: false`). |
| `GET` | `/api/v1/environment/profiles` | Autenticado | Devuelve los 13 perfiles ambientales configurados (`EARTH_SURFACE` a `EXTRAVEHICULAR_ACTIVITY`). |
| `GET` | `/api/v1/environment/measurements` | Autenticado | Lista las mediciones ambientales de cabina, soporte vital (ECLSS), radiación, CO₂ y traje espacial. |
| `POST` | `/api/v1/environment/measurements` | Autenticado | Registra una medición ambiental asociada a una misión y fuente. |
| `GET` | `/api/v1/environment/sources` | Autenticado | Lista el catálogo de fuentes de datos (`MANUAL_ENTRY`, `CSV_JSON_IMPORT`, `DEMO_SIMULATION`, `OFFLINE_QUEUE_SYNC`, etc.). |

---

## 4. Salud, Silueta Corporal (Body Explorer) e IA Asistiva (`/api/v1/health`)

| Método | Ruta | Rol Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/health/indicators` | Autenticado | Devuelve el catálogo de los 12 indicadores de salud, sus unidades, instrucciones paso a paso y versión de regla activa. |
| `GET` | `/api/v1/health/body-regions` | Autenticado (alcance verificado) | Devuelve las 10 regiones anatómicas del Body Explorer SVG, su estado visual agregado, indicadores vinculados y alertas activas. |
| `GET` | `/api/v1/health/summary` | Autenticado (alcance verificado) | Sintetiza el dashboard principal (`Mission Control`), tarjetas de indicadores, tendencias, cobertura temporal y telemetría ambiental. |
| `GET` | `/api/v1/health/measurements` | Autenticado (alcance verificado) | Consulta el historial de mediciones con filtros por indicador, fase, entorno, fuente y estado. |
| `POST` | `/api/v1/health/measurements` | Autenticado (propio o autorizado) | Valida y persiste una medición, ejecuta el motor determinista de reglas (`NORMAL`, `MONITOR`, `WARNING`, `CRITICAL`, `UNKNOWN`, `STALE`, `INVALID`), genera alertas si corresponde y acredita participación en gamificación. |
| `POST` | `/api/v1/health/measurements/import` | Autenticado | Importa lotes de mediciones en formato `CSV` o `JSON` con validación de límites y calidad. |
| `GET` | `/api/v1/health/measurements/{id}` | Autenticado (alcance verificado) | Obtiene el detalle de una medición específica. |
| `GET` | `/api/v1/health/explain/{indicator_code}` | Autenticado (alcance verificado) | Genera una explicación educativa descriptiva de tendencias y riesgos espaciales sin realizar diagnósticos médicos. |

---

## 5. Motor de Alertas y Seguimiento (`/api/v1/alerts`)

| Método | Ruta | Rol Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/alerts` | Autenticado (alcance verificado) | Lista alertas operativas con filtros por astronauta, misión, estado y prioridad. |
| `GET` | `/api/v1/alerts/{alert_id}` | Autenticado (alcance verificado) | Obtiene el detalle completo de una alerta, incluyendo regla, versión, acciones inmediatas e historial de actuaciones. |
| `POST` | `/api/v1/alerts/{alert_id}/acknowledge` | Autenticado (alcance verificado) | Registra el reconocimiento de la alerta y la actuación inmediata del astronauta o líder. |
| `POST` | `/api/v1/alerts/{alert_id}/followup` | Autenticado (alcance verificado) | Registra notas de seguimiento o marca la alerta como `RESOLVED`. |
| `POST` | `/api/v1/alerts/{alert_id}/escalate` | Autenticado (alcance verificado) | Escala la alerta al protocolo de Medicina de Vuelo (`ESCALATED`) y audita la actuación. |

---

## 6. Wellness Center — Salud Psicológica y Privacidad (`/api/v1/wellness`)

| Método | Ruta | Rol Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/wellness/instruments` | Autenticado | Devuelve el cuestionario educativo de demostración (`SPACE_WELLNESS_CHECK_DEMO`) con su aviso explícito de no validación clínica. |
| `GET` | `/api/v1/wellness/assessments` | Autenticado (con filtro de privacidad) | El astronauta ve sus respuestas completas; el Líder en Tierra **únicamente** recibe la señal operativa (`operational_wellness_state`) sin acceso a puntuaciones crudas ni reflexiones privadas; el Administrador requiere justificación explícita auditada. |
| `POST` | `/api/v1/wellness/assessments` | `ASTRONAUT` (propio) | Guarda una evaluación de bienestar o borrador (`is_draft=true`), calcula el estado operativo y devuelve recomendaciones seguras. |
| `GET` | `/api/v1/wellness/recommendations` | Autenticado | Devuelve actividades preventivas filtrando automáticamente recomendaciones de ejercicio si existe una alerta médica incompatible. |
| `POST` | `/api/v1/wellness/feedback` | Autenticado | Registra la finalización y valoración de una actividad de bienestar. |

---

## 7. Gamificación Ética (`/api/v1/gamification`)

| Método | Ruta | Rol Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/gamification/profile` | Autenticado (alcance verificado) | Devuelve XP total, nivel (`Cadet` a `Wellbeing Champion`), racha activa, colección de 7 insignias e historial de eventos. |
| `GET` | `/api/v1/gamification/missions` | Autenticado (alcance verificado) | Lista las 10 misiones diarias configurables y su estado en la fecha actual. |
| `POST` | `/api/v1/gamification/missions/complete` | Autenticado | Registra en el backend una misión como `COMPLETED` o `EXCUSED_OPERATIONAL_RESTRICTION` (sin penalización de racha). |

---

## 8. Analítica Longitudinal, Informes, Simulador y Auditoría

| Método | Ruta | Rol Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/analytics/timeseries` | Autenticado (alcance verificado) | Devuelve series temporales con marcadores explícitos de discontinuidad cuando existen intervalos sin datos. |
| `GET` | `/api/v1/analytics/phase-comparison` | Autenticado (alcance verificado) | Compara media, mínimo y máximo de un indicador a través de las fases de misión (`TRAINING`, `LAUNCH`, `TRANSIT`, `SURFACE`, `EVA`). |
| `POST` | `/api/v1/reports/export` | Autenticado (alcance verificado) | Genera y descarga un informe en formato `PDF`, `CSV` o `JSON`, registrando la exportación en `audit_events`. |
| `GET` | `/api/v1/simulator/scenarios` | Autenticado | Lista los 9 escenarios reproducibles del simulador de telemetría. |
| `POST` | `/api/v1/simulator/run` | Autenticado | Ejecuta un escenario sintético etiquetado como `SIMULADO`. |
| `POST` | `/api/v1/simulator/reset` | Autenticado | Reinicia de forma segura únicamente los datos sintéticos (`is_simulated=True`). |
| `GET` | `/api/v1/admin/rules` | Autenticado | Lista el catálogo de reglas clínicas y sus versiones aprobadas. |
| `POST` | `/api/v1/admin/rules/{rule_id}/versions` | `ADMINISTRATOR` | Crea una nueva versión auditada de una regla operativa con motivo de cambio obligatorio. |
| `GET` | `/api/v1/admin/system-status` | `ADMINISTRATOR` | Consulta el estado operativo de la base de datos, motor de reglas y métricas de plataforma. |
| `GET` | `/api/v1/audit/events` | `ADMINISTRATOR` | Consulta el registro histórico de eventos de seguridad y auditoría. |

