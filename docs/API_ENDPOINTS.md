# Documentación de Endpoints REST — SEMSA (`/api/v1`)

La API de **SEMSA** sigue principios RESTful bajo el prefijo versionado `/api/v1`. Todos los endpoints protegidos requieren el encabezado `Authorization: Bearer <access_token>` obtenido al iniciar sesión, y validan permisos de rol (`ASTRONAUT`, `MISSION_LEADER`, `ADMINISTRATOR`) y aislamiento horizontal de datos en el servidor.

---

## 1. Autenticación (`/api/v1/auth`)

| Método | Ruta | Rol Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/login` | Público | Autentica credenciales (`email`, `password`), verifica estado de cuenta (`ACTIVE`) y bloqueo por intentos fallidos, y devuelve `access_token`, `csrf_token` y perfil. |
| `POST` | `/api/v1/auth/logout` | Autenticado | Revoca el token de sesión activo y registra el evento en auditoría. |
| `GET` | `/api/v1/auth/me` | Autenticado | Devuelve el perfil del usuario autenticado, sus permisos, misiones asignadas y hora UTC del servidor. |
| `POST` | `/api/v1/auth/password-recovery/request` | Público | Genera un token temporal de recuperación de contraseña con expiración de 30 minutos. Respuesta idéntica exista o no la cuenta; el token **nunca** se devuelve salvo con `DEMO_EXPOSE_RECOVERY_TOKEN=true` (solo demo local, por defecto `false`; ya no depende de `APP_ENV`). |
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
| `POST` | `/api/v1/environment/measurements` | `ADMINISTRATOR`, `MISSION_LEADER` o `ASTRONAUT` con asignación activa a la misión | Registra una medición ambiental asociada a una misión y fuente (misión inexistente → 404; `value` NaN/±inf → 422). Calcula `calculated_state` para los parámetros con umbral y crea o actualiza las alertas del motor `ENVIRONMENT` (o `RADIATION` para `RADIATION_DOSE`) para la tripulación (`crew_alerts_count`, `alerts_generated`). Ver "Alertas de todos los motores" en la sección 5. |
| `GET` | `/api/v1/environment/sources` | Autenticado | Lista el catálogo de fuentes de datos (`MANUAL_ENTRY`, `CSV_JSON_IMPORT`, `DEMO_SIMULATION`, `OFFLINE_QUEUE_SYNC`, etc.). |

---

## 4. Salud, Silueta Corporal (Body Explorer) e IA Asistiva (`/api/v1/health`)

| Método | Ruta | Rol Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/health/indicators` | Autenticado | Devuelve el catálogo de los 12 indicadores de salud, sus unidades, instrucciones paso a paso y versión de regla activa. |
| `GET` | `/api/v1/health/body-regions` | Autenticado (alcance verificado) | Devuelve las 10 regiones anatómicas del Body Explorer SVG, su estado visual agregado, indicadores vinculados y alertas activas. |
| `GET` | `/api/v1/health/summary` | Autenticado (alcance verificado) | Sintetiza el dashboard principal (`Mission Control`), tarjetas de indicadores, tendencias, cobertura temporal y telemetría ambiental. |
| `GET` | `/api/v1/health/measurements` | Autenticado (alcance verificado) | Consulta el historial de mediciones con filtros por indicador, fase, entorno, fuente y estado. |
| `POST` | `/api/v1/health/measurements` | Autenticado (propio o autorizado) | Valida y persiste una medición, ejecuta el motor determinista de reglas (`NORMAL`, `MONITOR`, `WARNING`, `CRITICAL`, `UNKNOWN`, `INVALID`), crea o actualiza la alerta del indicador y acredita participación en gamificación. Ver "Motor de alertas calibrado" más abajo. |
| `POST` | `/api/v1/health/measurements/import` | Autenticado | Importa lotes de mediciones en formato `CSV` o `JSON` con validación de límites y calidad. `alerts_generated` cuenta las alertas distintas creadas o actualizadas (una por indicador), no las lecturas anómalas. |
| `GET` | `/api/v1/health/measurements/{id}` | Autenticado (alcance verificado) | Obtiene el detalle de una medición específica. |
| `GET` | `/api/v1/health/explain/{indicator_code}` | Autenticado (alcance verificado) | Genera una explicación educativa descriptiva de tendencias y riesgos espaciales sin realizar diagnósticos médicos. |

---

## 5. Motor de Alertas y Seguimiento (`/api/v1/alerts`)

| Método | Ruta | Rol Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/alerts` | Autenticado (alcance verificado) | Lista alertas operativas con filtros por astronauta, misión, estado, prioridad y motor de origen (`source_engine`). Máximo 100: primero las abiertas (`NEW`, `ACKNOWLEDGED`, `IN_FOLLOWUP`, `ESCALATED`) y después las resueltas, cada grupo de la más reciente a la más antigua, para que ninguna abierta quede fuera del límite. |
| `GET` | `/api/v1/alerts/{alert_id}` | Autenticado (alcance verificado) | Obtiene el detalle completo de una alerta, incluyendo regla, versión, acciones inmediatas e historial de actuaciones. |
| `POST` | `/api/v1/alerts/{alert_id}/acknowledge` | Autenticado (alcance verificado) | Registra el reconocimiento de la alerta y la actuación inmediata del astronauta o líder. |
| `POST` | `/api/v1/alerts/{alert_id}/followup` | Autenticado (alcance verificado) | Registra notas de seguimiento o marca la alerta como `RESOLVED`. |
| `POST` | `/api/v1/alerts/{alert_id}/escalate` | Autenticado (alcance verificado) | Escala la alerta al protocolo de Medicina de Vuelo (`ESCALATED`) y audita la actuación. |

### Motor de alertas calibrado (versión de regla `2.0-DATASET`)

- **Umbrales**: salen del dataset del proyecto (`astronaut-health-dataset`) y su procedencia está en `backend/app/rules/calibration.py`; `GET /health/indicators` y `GET /admin/rules` devuelven la fuente en `protocol_source` (los umbrales sin base en el dataset dicen "sin respaldo en el dataset", incluidos los dos pisos de seguridad conservados de 1.0-DEMO: frecuencia respiratoria baja, < 9 / < 8 rpm, y sistólica baja crítica, < 80 mmHg). `normal_*`/`monitor_*`/`warning_*` son rangos dentro de rango: fuera de `monitor_*` es zona amarilla y fuera de `warning_*` zona roja; un extremo igual al límite físico de validación significa que no hay umbral en esa dirección.
- **Dos capas**: umbral absoluto + desvío frente a la línea base personal (z con la desviación estándar de la persona). `CRITICAL` = zona roja; `WARNING` = zona amarilla alejada de la línea base (o sin línea base válida) o desvío personal |z| ≥ 3; `MONITOR` = zona amarilla habitual para la persona, o desvío personal |z| ≥ 2 confirmado por la lectura anterior. El sueño se evalúa sobre la media de 7 noches (mínimo 4) y la radiación también sobre la dosis acumulada frente al límite de carrera de 600 mSv.
- **`STALE` ya no se guarda** en `calculated_state`: lo calcula `GET /health/summary` según la antigüedad del último dato. Una medición antigua lleva el aviso en `evaluation_reasons`.
- **Una sola alerta abierta por astronauta + indicador + regla**: una lectura anómala nueva actualiza la alerta abierta (último valor, motivos, recomendación y `updated_at`); el nivel y la prioridad solo suben, y si sube a `CRITICAL` pasa a `ESCALATED`. Tras `RESOLVED`, la siguiente lectura anómala crea una alerta nueva.
- **Respuesta de `POST /health/measurements`**: `alert_generated` conserva `id`, `priority`, `title` e `immediate_action` y añade `followup_recommendation` e `is_new` (`false` cuando se actualizó una alerta ya abierta). `recommended_next_step` es la acción inmediata de esa alerta.
- **Recomendación por alerta**: `immediate_action` (dos pasos: qué hacer ahora y qué implica el nivel) y `followup_recommendation` (cómo mejorar el indicador en los próximos días, cuándo avisar al médico de vuelo y la fuente) salen de `backend/app/rules/recommendations.py`, por indicador × dirección × nivel. No es un diagnóstico médico.

### Alertas de todos los motores (issue #30)

Todas las alertas, venga de donde venga, están en la tabla `alerts` y se listan en `GET /alerts`. Cada alerta del listado y del detalle trae dos campos derivados de `rule_code` (no hay columna nueva):

| Campo | Significado |
| :--- | :--- |
| `source_engine` | Motor que generó la alerta (para agrupar en el frontend). Se deduce del prefijo de `rule_code` y, para la radiación, de `indicator_code`, en `backend/app/rules/alert_sources.py`. Valores: `RULES`, `RADIATION`, `PREDICTION`, `COGNITIVE`, `EMOTIONAL`, `ISOLATION`, `ENVIRONMENT`, `SUPPORT`. |
| `is_early_warning` | `true` en las alertas tempranas: avisan antes de que el valor real (o el bienestar) salga de rango (`RULE_EARLY_*` y `RULE_PREDICTION_*`). |

| `source_engine` | Prefijo de `rule_code` | Origen | Cuándo alerta | `indicator_code` |
| :--- | :--- | :--- | :--- | :--- |
| `RULES` | cualquier otro (`RULE_<INDICADOR>_DEMO`, …) | Motor de reglas calibrado (`rules/engine.py`), `POST /health/measurements` e importación | Lectura en `MONITOR` / `WARNING` / `CRITICAL` (salvo radiación, que es `RADIATION`) | Indicador de salud (no `RADIATION*`) |
| `RADIATION` | el de `RULES` o `RULE_ENVIRONMENT_`, con `indicator_code` que empieza por `RADIATION` | Motor de reglas (dosis personal `RADIATION_EXPOSURE`, `RULE_RADIATION_EXPOSURE_DEMO`) y entorno (tasa de dosis ambiental, `RULE_ENVIRONMENT_RADIATION_DOSE`) | Dosis diaria o acumulada fuera de rango / tasa ambiental fuera del rango normal | `RADIATION_EXPOSURE` o `RADIATION_DOSE` |
| `PREDICTION` | `RULE_PREDICTION_` (`RULE_PREDICTION_EARLY_WARNING`) | Pronóstico (`rules/prediction_alerts.py`): solo tras cada lectura `NORMAL` en `POST /health/measurements` (el `GET /predictions/...` no escribe alertas) | El valor esperado del pronóstico cruza un umbral del motor calibrado (`recommendation.basis = expected_crossing`) mientras el último valor real sigue en rango (también para la dosis de radiación: sigue siendo `PREDICTION`) | Indicador de salud |
| `COGNITIVE` | `RULE_COGNITIVE_` | Actividades cognitivas (`services/cognitive_engine.py`) | Resultado que requiere revisión frente a la línea base | `PERCEIVED_FATIGUE` |
| `EMOTIONAL` | `RULE_EMOTIONAL_` | Cuestionario emocional (`services/emotional_engine.py`) | `SUPPORT_REQUESTED`, `PROFESSIONAL_REVIEW` o `URGENT_SUPPORT` | `MOOD_WELLNESS` |
| `ISOLATION` | `RULE_EARLY_` (`RULE_EARLY_EARTH_CONTACT`) | Aislamiento y confinamiento (`rules/early_warnings.py`): check-in rápido y dimensión de aislamiento del cuestionario | Señales repetidas de riesgo de aislamiento | `EARTH_CONTACT` |
| `ENVIRONMENT` | `RULE_ENVIRONMENT_` (`RULE_ENVIRONMENT_<PARÁMETRO>`) | Entorno de la misión (`rules/environment_alerts.py`), `POST /environment/measurements` | Parámetro fuera del rango normal: `CO2_LEVEL`, `PPO2`, `CABIN_TEMP` y `HUMIDITY` (`RADIATION_DOSE` sale como `RADIATION`) | Código del parámetro ambiental |
| `SUPPORT` | `RULE_SUPPORT_REQUEST_` | Solicitud de apoyo urgente del Communication Center (`api/v1/expansion_router.py`) | `is_emergency = true` | `MOOD_WELLNESS` |

- **Filtro**: `GET /alerts?source_engine=PREDICTION` (no distingue mayúsculas). Valores: `RULES`, `RADIATION`, `PREDICTION`, `COGNITIVE`, `EMOTIONAL`, `ISOLATION`, `ENVIRONMENT`, `SUPPORT`; otro valor → 422. `RULES` y `ENVIRONMENT` excluyen las de radiación; `RADIATION` reúne las de ambos motores con `indicator_code` `RADIATION*`. Se combina con el resto de filtros y con la regla de privacidad de las alertas `RULE_EARLY_*` (el líder no las ve si el astronauta no comparte sus señales de bienestar).
- **Sin duplicados**: las alertas nuevas (`PREDICTION`, `ENVIRONMENT`) siguen la regla de una sola alerta abierta por astronauta + indicador + regla; una evaluación nueva actualiza la abierta (la prioridad, y en `ENVIRONMENT` también el nivel, solo suben). Tras `RESOLVED`, el siguiente cruce abre otra.
- **Alerta temprana del pronóstico**: estado operativo siempre `MONITOR` y nunca se escala (es una proyección); `priority` refleja el nivel proyectado (`MONITOR` → `LOW`, `WARNING` → `MEDIUM`, `CRITICAL` → `HIGH`). `value_recorded` es el valor esperado el día del cruce y `rule_version_id` / `rule_version_label` son los de la regla calibrada cuyo umbral se cruza. No se crea si ya hay otra alerta abierta para ese astronauta e indicador (el valor real ya está fuera de rango). `immediate_action` = paso propio del pronóstico + paso del nivel de observación; `followup_recommendation` = pauta del catálogo para el indicador y la dirección del cruce (la misma que `recommendation.text` de la predicción). `POST /health/measurements` devuelve la alerta en `early_warning_alert` (`id`, `rule_code`, `source_engine`, `priority`, `title`, `immediate_action`, `followup_recommendation`, `is_new`; `null` si no hay cruce o la lectura no es `NORMAL`); un fallo del pronóstico nunca impide registrar la medición. **Solo ese flujo de escritura** crea, actualiza o retira la alerta; `GET /predictions/indicators/{code}` es de solo lectura y en `early_warning_alert_id` solo informa del id de la alerta temprana ya abierta (astronauta + indicador + misión) o `null`. Al actualizarla también se actualizan `is_simulated` y `data_quality` según los datos del último pronóstico.
- **Retirada automática de la alerta temprana**: pasa a `RESOLVED` (no se borra) con una nota de sistema en `followups[]` (`author_role = "SYSTEM"`, `action_type = "RESOLVED"`) cuando (a) un pronóstico fiable (`status = ok`) ya no tiene `expected_crossing`, (b) los datos están desfasados: el último dato tiene más de 7 días o la fecha de cruce prevista es anterior a hoy (UTC) — en ese caso tampoco se crea —, o (c) el motor de reglas abre o actualiza una alerta real del mismo astronauta e indicador. Un pronóstico no fiable no crea ni retira.
- **Entorno y radiación ambiental**: el entorno es compartido, así que se crea una alerta por cada astronauta asignado (activo) a la misión. Estados como en el motor de reglas (fuera de `normal` → `MONITOR`, fuera de `monitor` → `WARNING`, fuera de `warning` → `CRITICAL` y `ESCALATED`); prioridad `LOW` / `HIGH` / `CRITICAL`. `RADIATION_DOSE` (mSv/día) usa los cortes de dosis diaria de la regla calibrada `RADIATION_EXPOSURE` (y enlaza su versión); el resto son cortes de demostración tomados de NASA-STD-3001 Vol. 2 y de los límites SMAC de la NASA (CO₂), sin validación clínica. Un parámetro sin umbral, sin valor o con otra unidad conserva su estado y no alerta. El título usa el nombre canónico del parámetro (nunca el `parameter_name` libre que envía el cliente). Permisos: `ADMINISTRATOR`, `MISSION_LEADER` o un `ASTRONAUT` con asignación activa a esa misión (si no, 403); misión inexistente → 404; `value` no finito → 422. Respuesta: `id`, `parameter_code`, `calculated_state`, `crew_alerts_count` (alertas creadas o actualizadas en toda la tripulación) y `alerts_generated[]` (`id`, `astronaut_id`, `rule_code`, `source_engine`, `priority`, `operational_state`, `title`) **solo de los astronautas que el usuario supervisa** (administración: todos; líder: su tripulación; astronauta: la suya).
- **Recomendación y traducción**: cada alerta nueva lleva su propia recomendación (`immediate_action` de dos pasos y `followup_recommendation` con la fuente). Los textos fijos están en español en el backend y su traducción al inglés en `frontend/src/i18n/backend-en-runtime.js` (EXACT para los textos fijos y PATTERNS para títulos y explicaciones con valores), igual que `rules/recommendations.py`; `backend/tests/test_engine_alerts.py` lo comprueba.
- **Privacidad**: las alertas nuevas solo llevan datos del indicador o del hábitat (valor, umbral, fecha, regla); nunca nombres, notas ni respuestas de bienestar (mismo criterio que `rules/early_warnings.py`).

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
| `GET` | `/api/v1/analytics/expansion-overview` | Autenticado (alcance verificado) | Devuelve la analítica integrada de frecuencia de comunicación, evaluaciones cognitivas por dominio y cumplimiento de cuestionarios emocionales. |

---

## 9. Módulo 1 — Communication Center (`/api/v1/conversations`, `/api/v1/messages`, `/api/v1/support-requests`)

| Método | Ruta | Rol Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/conversations` | Autenticado | Lista las conversaciones privadas 1 a 1 del astronauta o de la tripulación asignada al líder. |
| `POST` | `/api/v1/conversations` | Autenticado | Crea o recupera una conversación 1 a 1 autorizada entre un astronauta y su líder en tierra asignado. |
| `GET` | `/api/v1/conversations/{id}` | Participante o `ADMINISTRATOR` (auditado) | Obtiene metadatos de una conversación. |
| `GET` | `/api/v1/conversations/{id}/messages` | Participante (Admin requiere `audit_justification`) | Obtiene el historial de mensajes, marca recibos de lectura y bloquea el acceso silencioso no justificado. |
| `POST` | `/api/v1/conversations/{id}/messages` | Participante | Envía un mensaje con categoría operativa, respuesta opcional (`reply_to_message_id`) y deduplicación de cola offline (`client_message_uid`). |
| `PATCH` | `/api/v1/messages/{id}/read` | Participante | Registra la lectura explícita de un mensaje. |
| `PATCH` | `/api/v1/messages/{id}/flags` | Participante | Marca o desmarca un mensaje como importante (`is_important`) o no leído (`mark_unread`). |
| `GET` | `/api/v1/support-requests` | Autenticado (alcance verificado) | Lista las solicitudes formales de apoyo (`REQUESTED`, `RECEIVED`, `IN_REVIEW`, `RESPONDED`, `ESCALATED`, `CLOSED`). |
| `POST` | `/api/v1/support-requests` | `ASTRONAUT` (o autorizado) | Crea una solicitud de apoyo vinculada a la conversación con el líder y devuelve instrucciones inmediatas si la prioridad es `URGENT` o `EMERGENCY`. |
| `PATCH` | `/api/v1/support-requests/{id}` | `MISSION_LEADER` / `ADMINISTRATOR` / propio | Actualiza el estado de atención, registra notas de seguimiento del líder o escala la solicitud. |

---

## 10. Módulo 2 — Cognitive Assessment Center (`/api/v1/cognitive`)

| Método | Ruta | Rol Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/cognitive/domains` | Autenticado | Lista los 9 dominios cognitivos independientes y su propósito en misiones espaciales. |
| `GET` | `/api/v1/cognitive/tests` | Autenticado | Obtiene las pruebas interactivas, versiones equivalentes y reactivos por dominio y dificultad (`BASIC`, `INTERMEDIATE`, `ADVANCED`). |
| `POST` | `/api/v1/cognitive/assessments/start` | Autenticado | Registra el estado previo (sueño, fatiga, estrés) e inicia o pospone (`POSTPONED`) una evaluación cognitiva sin penalización. |
| `POST` | `/api/v1/cognitive/assessments/{id}/submit` | Autenticado | Registra respuestas parciales y tiempos de reacción en milisegundos. |
| `POST` | `/api/v1/cognitive/assessments/{id}/complete` | Autenticado | Finaliza la prueba, compara frente a la línea base personal bajo dominio/dificultad/versión equivalentes y otorga insignias cognitivas. |
| `GET` | `/api/v1/cognitive/assessments/{id}/results` | Autenticado (alcance verificado) | Obtiene el resultado detallado, interpretación contextual y aviso no diagnóstico. |
| `GET` | `/api/v1/cognitive/history` | Autenticado (alcance verificado) | Devuelve el historial de evaluaciones cognitivas, líneas base y programaciones. |
| `GET` | `/api/v1/cognitive/analytics` | Autenticado (alcance verificado) | Devuelve series longitudinales por dominio cognitivo sin mezclar niveles o versiones no equivalentes. |
| `POST` | `/api/v1/cognitive/schedules` | `MISSION_LEADER` / `ADMINISTRATOR` | Programa una evaluación cognitiva sugerida para un astronauta. |

---

## 11. Módulo 3 — Emotional Assessment Center (`/api/v1/emotional-assessments`)

| Método | Ruta | Rol Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/emotional-assessments/questionnaires` | Autenticado | Devuelve el cuestionario emocional (`EMOTIONAL_CHECKIN_DEMO_V1`) con sus 12 dimensiones en escala 1–5 y 6 preguntas abiertas opcionales. |
| `POST` | `/api/v1/emotional-assessments/requests` | `ADMINISTRATOR` | Crea solicitudes individuales de evaluación emocional para uno o varios astronautas con fecha límite, prioridad y mensaje personalizado. |
| `GET` | `/api/v1/emotional-assessments/requests` | `ADMINISTRATOR` / `MISSION_LEADER` | Lista las solicitudes creadas mostrando exclusivamente el estado administrativo de cumplimiento (`SENT`, `COMPLETED`, `OVERDUE`, etc.) sin exponer respuestas personales. |
| `GET` | `/api/v1/emotional-assessments/my-requests` | `ASTRONAUT` (o alcance verificado) | Lista las solicitudes de cuestionario emocional asignadas al astronauta. |
| `PATCH` | `/api/v1/emotional-assessments/requests/{id}` | Autenticado | Permite al administrador cancelar/reprogramar/enviar recordatorio, o al astronauta posponer con motivo justificado (`POSTPONED`). |
| `POST` | `/api/v1/emotional-assessments/{request_id}/start` | `ASTRONAUT` | Inicia o reanuda la respuesta de un cuestionario emocional solicitado. |
| `POST` | `/api/v1/emotional-assessments/{id}/responses` | `ASTRONAUT` | Guarda respuestas en borrador soportando *"Prefiero no responder"* (`prefer_not_to_answer`). |
| `POST` | `/api/v1/emotional-assessments/{id}/complete` | `ASTRONAUT` | Ejecuta `EmotionalWellnessEngine`, clasifica el estado operativo, activa protocolo urgente si aplica y actualiza la solicitud a `COMPLETED`. |
| `GET` | `/api/v1/emotional-assessments/{id}/results` | `ASTRONAUT` / `MISSION_LEADER` (resumen operativo) | El astronauta ve sus respuestas completas; el Líder recibe únicamente el estado operativo y recomendaciones; el Administrador tiene bloqueado el acceso sin justificación auditada. |
| `POST` | `/api/v1/emotional-assessments/{id}/follow-ups` | `MISSION_LEADER` / `ADMINISTRATOR` | Registra una nota de seguimiento operativo sobre la evaluación emocional. |



---

## 12. Módulo de Aislamiento y Confinamiento (contrato: `docs/CONTRATO_AISLAMIENTO.md`)

| Método | Ruta | Rol Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/wellness/quick-checkin` | `ASTRONAUT` (para sí mismo) | Check-in rápido de sueño (0–16 h) y ánimo/energía/calidad (1–5), `feels_isolated` y nota privada (≤ 500). Calcula `operational_flag` (`OK` / `NEEDS_CHECK_IN`), otorga XP `MIND_CHECK` una vez al día y acepta `dedup_key` opcional (reenvío sin enlace sin duplicar). |
| `GET` | `/api/v1/wellness/quick-checkin?astronaut_id=&limit=14` | Propio / Líder asignado / Administración | Historial y resumen de 7 días (`avg_sleep_hours_7d`, `nights_under_6h_7d`, `checkins_7d`, `operational_flag`, `circadian_tip`). Para líder y administración `note`, `mood`, `energy` y `feels_isolated` llegan como `null`. |
| `GET` | `/api/v1/wellness/leisure?max_minutes=&category=` | Autenticado | Catálogo de actividades breves de tiempo libre (5–30 min) con pasos y fuente NASA. |
| `POST` | `/api/v1/wellness/leisure/{code}/log` | `ASTRONAUT` | Registra minutos y disfrute (1–5); XP una vez al día. |
| `GET` | `/api/v1/wellness/leisure/log?astronaut_id=&limit=20` | Propio / Líder asignado / Administración | Registros y `minutes_7d`; la nota solo la ve la propia persona. |
| `GET` | `/api/v1/crew-activities/catalog` | `ASTRONAUT` / `MISSION_LEADER` / `ADMINISTRATOR` | Plantillas: comida compartida, noche de película, huerto en grupo, juego de mesa, observación de la Tierra, celebración. |
| `GET` | `/api/v1/crew-activities?mission_id=&status=` | Tripulación o líder asignados / Administración | Actividades de la misión (por defecto la misión activa), participantes, quórum (mayoría simple) y `weekly_goal`. |
| `POST` | `/api/v1/crew-activities` | `ASTRONAUT` de la misión / `MISSION_LEADER` asignado / `ADMINISTRATOR` | Crea una actividad (plantilla o título); participantes = astronautas asignados. |
| `POST` | `/api/v1/crew-activities/{id}/respond` | Participante | `JOINED` / `DECLINED` (solo actividades `SCHEDULED`). |
| `POST` | `/api/v1/crew-activities/{id}/attend` | Participante con `JOINED` | Marca asistencia (solo de `scheduled_for − 15 min` a fin + 24 h; si no, 409); con quórum pasa a `COMPLETED`. XP solo con ≥ 2 asistentes, una vez por persona y actividad y como máximo una vez al día. Atómico ante peticiones simultáneas; autocura actividades con quórum que quedaron `SCHEDULED`. |
| `POST` | `/api/v1/crew-activities/{id}/cancel` | Creador / líder asignado / administración | Cancela una actividad programada. |



---

## 13. Pronóstico de indicadores fisiológicos (`/api/v1/predictions`)

| Método | Ruta | Rol Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/predictions/indicators/{indicator_code}?mission_id=&horizon_days=7&include_simulated=false` | `ASTRONAUT` con asignación activa a la misión (para sí mismo; `astronaut_id` se deduce de la sesión) | Pronostica la **tendencia** del indicador a 1–14 días con bandas de predicción, la proyecta contra los rangos de la regla clínica vigente y devuelve una recomendación preventiva. Es una estimación estadística: **no predice enfermedades ni es un diagnóstico**, y no crea alertas. |

Errores: `401` sin sesión, `403` si el rol no es `ASTRONAUT` o no hay asignación activa, `404` indicador desconocido, `422` parámetros no válidos (`horizon_days` fuera de 1–14, `mission_id` ≤ 0), `503` si el volumen de mediciones supera el límite de proceso. Los estados estadísticos (`insufficient_data`, `model_not_reliable`) responden `200`.

### Método (`method.code = "robust_level_v1"`)

1. **Datos**: medianas diarias (día UTC) del último segmento de misma fase y entorno dentro de una ventana de 90 días; se excluyen mediciones no válidas, de entrenamiento y de línea base previa. Mínimo 10 días.
2. **Pronóstico puntual**: nivel robusto = mediana ponderada exponencialmente (peso ×0,93 por día de antigüedad; vida media ≈ 9,6 días). El pronóstico es plano.
3. **Tendencia**: recta OLS de los últimos 45 días con prueba t corregida por autocorrelación de orden 1 (α = 0,01). Se informa siempre en `trend`; solo se extrapola (`trend.extrapolated = true`, `method.model_used = "trend"`) si es significativa **y** en la validación dentro de la propia serie su error es ≤ 0,5 × el del nivel y menor que el de repetir el último valor.
4. **Compuerta de fiabilidad**: validación de origen móvil dentro de la serie (pasos de 1–7 días). `status = "ok"` solo si el método se equivoca menos que repetir el último valor; si no, `model_not_reliable` y `forecast = []`.
5. **Bandas de predicción** al 80 % y 95 %: dispersión propia de la serie a cada lado del nivel (pueden ser asimétricas), cuantil t e inflación empírica que crece con el horizonte.
6. **Proyección contra umbrales**: el estado de cada día lo da el motor de alertas (`rules/evaluation.evaluate_reading`, la misma función que evalúa una lectura al registrarla), con sus dos capas: umbral absoluto de la versión vigente de la regla y desvío frente a la línea base personal (z = (valor − media) / DE; amarillo con |z| ≥ 2 y rojo con |z| ≥ 3). Un amarillo absoluto solo es `WARNING` si además se aleja de la persona (o si no hay línea base válida); si es habitual para ella queda en `MONITOR`. El nivel pronosticado se evalúa como sostenido: la lectura anterior es el mismo valor (un desvío personal amarillo cuenta como confirmado) y, en los indicadores con regla de media móvil (sueño), la ventana completa está en ese valor. No se proyectan la diastólica (para `BLOOD_PRESSURE` solo la sistólica) ni la dosis acumulada de radiación.

**Calibración** (`backend/tests/test_prediction_calibration.py`, backtest de origen móvil sobre vitales reales de NASA UTMB — reposo en cama con la cabeza inclinada, un **análogo terrestre** de la microgravedad, no datos de vuelo espacial; 29 sujetos, 93 592 pronósticos; hiperparámetros afinados en una mitad de los sujetos y confirmados en la otra):

- Error (MAE) frente a la media de 7 días: −2 % pulso, −4 % presión sistólica, −7 % temperatura, −10 % frecuencia respiratoria; frente a repetir el último valor: −21 % a −25 %; frente a la recta OLS de la primera versión: −12 % a −18 %. La ganancia sobre la media móvil es modesta (marginal en el pulso).
- Extrapolar la pendiente, incluso cuando es significativa, **empeoraba** el error en los cuatro indicadores; por eso en estos datos el pronóstico es siempre de nivel (la rama de tendencia no se activa nunca) y queda reservada para derivas que dominan claramente al ruido.
- Cobertura real de las bandas, por indicador: 78–83 % (nominal 80 %) y 94–96 % (nominal 95 %).
- Prueba de tendencia sobre ruido blanco: 0,6–0,8 % de falsos positivos (nominal 1 %); con ruido autocorrelacionado AR(1) 0,5 sube a 2–5 %.
- Compuerta: acepta el 93 % de los pronósticos. Los rechazados tienen más error en pulso (+8 %), temperatura (+21 %) y frecuencia respiratoria (+23 %), no en presión sistólica (solo el 1 % de rechazos); en error relativo a la dispersión de cada serie, 0,83 frente a 0,92. La discriminación es modesta porque con estas series el nivel casi siempre mejora al último valor. En series sintéticas pasa el ruido blanco alrededor de un nivel estable (85 % con 10 días, ≥ 99 % desde 20) y rechaza el 98 % de los paseos aleatorios de 90 días.
- Las bandas de la rama de tendencia usan el intervalo de predicción de la regresión con la misma inflación; no se pudieron contrastar con datos reales porque esa rama no se activa en UTMB.
- Solo pulso (`HEART_RATE`), presión sistólica (`BLOOD_PRESSURE`), temperatura (`BODY_TEMP`) y frecuencia respiratoria (`RESP_RATE`) están contrastados con datos reales; para los demás indicadores el método se aplica igual pero `empirical_validation.validated_with_real_data = false`.

### Respuesta

Campos de la primera versión (se conservan nombre y tipo):

| Campo | Significado |
| :--- | :--- |
| `status` | `ok`, `insufficient_data` o `model_not_reliable` (`not_assigned` → 403 y `unknown_indicator` → 404 no llegan al cuerpo). |
| `indicator_code`, `unit`, `phase_code`, `environment_code`, `n_days` | Indicador, unidad, segmento analizado y días con dato. |
| `beta0`, `beta1` | Recta de tendencia observada (`valor = beta0 + beta1·t`). `beta1` = pendiente por día si es significativa y `0` si no lo es. Solo generan el pronóstico cuando `trend.extrapolated` es `true`; con pronóstico plano y sin tendencia significativa `beta0` es el nivel. |
| `mae_ols`, `mae_naive` | MAE del método y de repetir el último valor en la validación dentro de la serie (el nombre `mae_ols` se conserva por compatibilidad). |
| `forecast[]` | Un elemento por día: `date`, `t`, `value`, `out_of_valid_range`, `z_score`, `z_band`, `direction` (respecto a la línea base: `above` / `below` / `at_baseline`). |
| `z_score`, `z_band`, `direction` | Los del último día pronosticado. El z es el del motor de alertas: DE de la persona con el piso de la calibración y, en los indicadores de media móvil, DE de la media de la ventana. `null` si la línea base no tiene una DE válida. |
| `baseline_status` | `missing`, `invalid_baseline`, `invalid_std_dev` (DE ausente o ≤ 0; el seed demo pone 0.0 a los indicadores cuya DE no se puede derivar del dataset), **`placeholder_std_dev`** (DE de relleno: el valor por defecto 5.0, o el 4.0 del seed demo anterior en una línea base simulada) o `available_unverified`. Solo con `available_unverified` hay z: es el mismo criterio que usa el motor de alertas (`is_valid_std_dev`). |
| `baseline_is_simulated`, `disclaimer` | Origen de la línea base y descargo (estimación estadística, no diagnóstico). |

Campos añadidos (todos opcionales):

| Campo | Significado |
| :--- | :--- |
| `forecast[].lower_80`, `upper_80`, `lower_95`, `upper_95` | Bandas de predicción del día; se ensanchan con el horizonte. |
| `forecast[].baseline_delta` | `value` − valor de la línea base, en unidades del indicador. |
| `forecast[].projected_state` | Estado (`NORMAL`, `MONITOR`, `WARNING`, `CRITICAL`) que daría el motor de alertas si el indicador se mantuviera en el valor esperado. |
| `forecast[].worst_state_80`, `worst_state_95` | Peor estado que alcanza cada banda. |
| `forecast[].interval_touches_threshold` | `true` si la banda del 95 % llega a un estado peor que el del valor esperado. |
| `baseline_value` | Valor de la línea base personal, si es válido. |
| `method` | `code`, `description` (texto en español), `model_used` (`level` / `trend`), `level_alpha`, `level_half_life_days`, `trend_window_days`, `trend_alpha`, `interval_levels`, `min_days`. |
| `trend` | `direction` (`rising` / `falling` / `stable` / `undetermined`), `slope_per_day`, `slope_std_error`, `t_statistic`, `critical_value`, `significant`, `alpha`, `lag1_autocorrelation`, `effective_n`, `window_days`, `n_points`, `extrapolated`. |
| `reliability` | `criterion`, `reliable`, `skill_vs_naive` (1 − MAE método / MAE último valor), `mae_model`, `mae_naive`, `mae_level`, `mae_trend`, `n_comparisons`, `max_step_days`. |
| `empirical_validation` | `validated_with_real_data`, `dataset`, `is_spaceflight_data` (siempre `false`), `note`. |
| `threshold_projection` | Solo con `status = ok` y regla vigente: `rule_code`, `rule_version`, `protocol_source`, `ranges`, `current_state` (estado del último valor diario observado, con su lectura anterior real), `first_expected_crossing` (primer día en que el valor esperado deja de ser `NORMAL`) y `first_possible_crossing` (primer día, anterior al esperado, en que la banda del 80 % deja de serlo). `ranges` trae los rangos absolutos de la regla (`normal`, `monitor`, `warning`) y, si hay línea base válida y el indicador tiene alerta por desvío personal, la banda personal `personal_yellow` (media ± 2·DE) y `personal_red` (media ± 3·DE); un extremo `null` significa que ese lado no alerta (el ánimo solo alerta a la baja). Cada cruce trae `date`, `days_ahead`, `state`, `direction` (`above` / `below` / `both`), `threshold`, `reference` (`absolute_range` o `personal_baseline`: el umbral es el borde del rango de la regla o media ± Z·DE), `alert_direction` (dirección del motor: `HIGH`, `LOW` o `PERSONAL`) y `basis`. Con `direction = both` (la banda sale por los dos lados con la misma gravedad) no hay un único umbral: `threshold` es `null` y `sides` trae el de cada lado, `{"below": {"threshold", "reference"}, "above": {...}}`; `reference` solo se informa si los dos lados comparten la misma y `alert_direction` es `PERSONAL` si en ambos decide el desvío frente a la persona. |
| `recommendation` | `basis` (`currently_out_of_range`, `expected_crossing`, `possible_crossing` o `none`), `state`, `direction`, `threshold`, `reference`, `alert_direction`, `sides` (solo con `direction = both`), `date`, `days_ahead` y los textos del catálogo de alertas (`rules/recommendations.py`) para el indicador y la dirección del cruce: `text` (cómo mejorar el indicador en los próximos días, cuándo avisar y la fuente) e `immediate_action` (los dos pasos de la acción inmediata; solo cuando el último valor ya está fuera de rango). `source` = `alert_recommendation_catalog`, con la procedencia en `source_detail`. Si el catálogo no tiene una entrada propia para ese indicador y dirección, se usan las instrucciones de seguimiento de la versión de regla (`source` = `clinical_rule_followup_instructions`) y, si la regla solo remite a la alerta, la entrada genérica del catálogo. Con `basis = none` los textos y `source` son `null`. |
| `early_warning_alert_id` | Solo lectura: id de la alerta temprana (`RULE_PREDICTION_EARLY_WARNING`, motor `PREDICTION`) que ya está abierta para este astronauta, indicador y misión; `null` si no hay ninguna. Este endpoint nunca crea, actualiza ni retira alertas (lo hace `POST /health/measurements`), así que el valor puede no coincidir con `recommendation` hasta la próxima lectura. Ver "Alertas de todos los motores" en la sección 5. |
