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
