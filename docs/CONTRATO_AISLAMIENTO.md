# Contrato API — Módulo de aislamiento y confinamiento

Fecha: 2026-11-14. Fuente: NASA HRP, *Isolation and Confinement* y *Behavioral Health*; "Can space gardening help astronauts cope with isolation?".
Todas las rutas cuelgan de `/api/v1` y usan la sesión/CSRF existentes. Los textos que se guardan en la BD van en español (el frontend los traduce con `bt()` como el resto).
Este documento es el contrato entre backend y frontend; también se le entrega a Andrés (nivel 3 del plan SEMSA).

## 1. Check-in rápido (sueño + ánimo)

`POST /wellness/quick-checkin` (ASTRONAUT, para sí mismo)
```json
{ "sleep_hours": 6.5, "sleep_quality": 3, "mood": 4, "energy": 3, "feels_isolated": false, "note": "opcional, privado" }
```
- `sleep_hours` 0–16 (1 decimal); `sleep_quality`, `mood`, `energy` enteros 1–5; `note` ≤ 500, privada.
- Respuesta 201: el objeto guardado (`id`, campos, `created_at`, `operational_flag`).
- `operational_flag`: `"OK"` o `"NEEDS_CHECK_IN"` (si `mood <= 2` o `feels_isolated` en 3 de los últimos 3 registros, o sueño medio de 3 días < 6 h).
- Otorga XP una vez al día (misión diaria `MIND_CHECK` si existe; si no, sin XP).

`GET /wellness/quick-checkin?astronaut_id=&limit=14`
```json
{ "items": [ { "id": 1, "created_at": "…", "sleep_hours": 6.5, "sleep_quality": 3, "mood": 4, "energy": 3, "feels_isolated": false, "note": "…" } ],
  "summary": { "avg_sleep_hours_7d": 6.8, "nights_under_6h_7d": 2, "checkins_7d": 5, "operational_flag": "OK",
               "circadian_tip": "texto breve según sueño medio" } }
```
- La propia persona ve todo. Líder asignado / administración: `note`, `mood`, `energy` y `feels_isolated` llegan como `null`; ven sueño y `operational_flag` (privacidad por defecto, igual que bienestar).

## 2. Tiempo libre (hobbies breves)

`GET /wellness/leisure?max_minutes=&category=`
```json
{ "items": [ { "code": "PLANT_CARE", "title": "Cuidar las plantas del huerto", "category": "PLANTS",
  "duration_minutes": 15, "description": "…", "how_to": ["paso 1", "paso 2"],
  "solo_or_group": "SOLO", "source_title": "NASA — Can Space Gardening Help Astronauts Cope with Isolation?",
  "source_url": "https://www.nasa.gov/humans-in-space/can-space-gardening-help-astronauts-cope-with-isolation/" } ] }
```
- Categorías: `PLANTS`, `READING`, `GAMES`, `MUSIC`, `ART`, `PHOTOGRAPHY`, `WRITING`, `MOVEMENT`. Duraciones entre 5 y 30 min. Mínimo 10 actividades sembradas.

`POST /wellness/leisure/{code}/log` (ASTRONAUT) `{ "minutes": 15, "enjoyment": 4, "note": "opcional" }` → 201 `{ "id", "code", "minutes", "enjoyment", "created_at", "xp_awarded" }`. `enjoyment` 1–5.

`GET /wellness/leisure/log?astronaut_id=&limit=20` → `{ "items": [ … ], "minutes_7d": 95 }` (misma regla de privacidad: otros roles no ven `note`).

## 3. Actividades de integración de la tripulación

Estados: `SCHEDULED` → `COMPLETED` | `CANCELLED`. Respuestas: `PENDING`, `JOINED`, `DECLINED`. Asistencia: `attended` (bool).

`GET /crew-activities/catalog` → `{ "items": [ { "code": "SHARED_MEAL", "title": "Comida compartida", "description": "…", "duration_minutes": 45, "category": "MEAL" } ] }` (comida, noche de película, huerto en grupo, juego de mesa, observación de la Tierra, celebración).

`GET /crew-activities?mission_id=&status=`
```json
{ "items": [ { "id": 1, "mission_id": 1, "template_code": "SHARED_MEAL", "title": "…", "description": "…",
  "scheduled_for": "2026-11-15T19:00:00Z", "duration_minutes": 45, "status": "SCHEDULED",
  "created_by": { "id": 2, "name": "…" }, "quorum": 2, "attended_count": 0, "my_response": "PENDING",
  "participants": [ { "user_id": 3, "name": "…", "response": "JOINED", "attended": false } ] } ],
  "weekly_goal": { "target": 1, "completed_this_week": 0 } }
```
- `mission_id` opcional: por defecto la misión activa de la persona. Participantes = tripulación asignada (ASTRONAUT) de la misión.
- `quorum` = mayoría simple de participantes (⌊n/2⌋ + 1).

`POST /crew-activities` (ASTRONAUT de la misión, MISSION_LEADER asignado o ADMINISTRATOR)
`{ "mission_id": 1, "template_code": "SHARED_MEAL", "title": "opcional si hay plantilla", "description": "opcional", "scheduled_for": "ISO-8601", "duration_minutes": 45 }` → 201 actividad.

`POST /crew-activities/{id}/respond` (participante) `{ "response": "JOINED" | "DECLINED" }` → actividad.
`POST /crew-activities/{id}/attend` (participante, solo si `JOINED` y la actividad no está cancelada) → actividad; cuando `attended_count >= quorum` pasa a `COMPLETED` y se otorga XP a los asistentes.

**Reglas de asistencia y XP** (anti-abuso y concurrencia):
- **Ventana de asistencia:** solo se puede marcar asistencia desde `scheduled_for − 15 min` hasta `scheduled_for + duration_minutes + 24 h`. Fuera de ella → 409 `"Solo puedes registrar asistencia desde 15 minutos antes del inicio hasta 24 horas después del final de la actividad."` Repetir `/attend` cuando ya se asistió es idempotente (200, sin comprobar la ventana).
- **XP mínimo de grupo:** solo se otorga XP si la actividad está `COMPLETED` y asistieron **al menos 2 personas**. En una misión de 1 tripulante (quórum 1) la actividad se completa, pero sin XP; si más tarde asiste otra persona, ambas reciben XP.
- **Límite diario:** el XP de `CREW_INTEGRATION` (25) se otorga como máximo **una vez al día (UTC) por persona**, aunque asista a varias actividades. Cada participante se marca `xp_awarded` una sola vez por actividad, haya recibido XP ese día o no.
- **Atomicidad:** el recuento de asistentes se hace en BD; la transición `SCHEDULED → COMPLETED` es un `UPDATE … WHERE status = 'SCHEDULED'` y el XP de cada participante se reclama con `UPDATE … WHERE xp_awarded = false` (solo una petición lo otorga aunque lleguen varias a la vez).
- **Autocuración:** una actividad `SCHEDULED` que ya cumple quórum (datos antiguos) se completa y reparte XP de forma idempotente en cualquier `POST /attend` o `GET /crew-activities`.
`POST /crew-activities/{id}/cancel` (creador, líder asignado o administración) → actividad.

## 4. Canal familiar ("Conexión con Tierra")

- Nuevo rol `FAMILY_MEMBER`: solo puede iniciar sesión, ver `/auth/me` y usar sus conversaciones `FAMILY` y adjuntos. Sin acceso a salud, alertas, misiones ni otros módulos (403).
- Nueva tabla de contactos autorizados: `FamilyContact { id, astronaut_id, user_id (FAMILY_MEMBER), relationship ("Pareja", "Hija", …), is_active }`. Sembrar 2 familiares para el astronauta demo, con usuarios y contraseña demo documentados en el README igual que los demás.
- `Conversation.channel`: `"MISSION"` (por defecto, todo lo existente) o `"FAMILY"`. En `FAMILY`, `leader_id` = id del usuario familiar (no se renombra la columna).

`GET /conversations?channel=FAMILY|MISSION` → mismo formato actual + campo `channel` en cada conversación (y `family_contact: { name, relationship }` si es FAMILY). Sin `channel` → solo `MISSION` (compatibilidad). Si quien consulta es `FAMILY_MEMBER`, `mission_code`, `mission_name`, `astronaut_crew_code` y `astronaut_callsign` llegan como `null` (no necesita datos operativos de la misión).
`GET /family/contacts` (ASTRONAUT: los suyos; FAMILY_MEMBER: el/los astronautas con los que tiene vínculo) → `{ "items": [ { "id", "user_id", "name", "relationship", "conversation_id" } ] }`. Se crea la conversación FAMILY bajo demanda si no existe.

Mensajes FAMILY: mismas rutas `/conversations/{id}/messages` (GET/POST). La categoría se fuerza a `GENERAL`.

**Privacidad (obligatoria):**
- Solo los dos participantes ven el contenido y los adjuntos de una conversación FAMILY.
- MISSION_LEADER: no las ve en ningún listado. ADMINISTRATOR: la lectura auditada de contenido devuelve 403 para FAMILY; como mucho ve metadatos (fecha, número de mensajes).
- Los eventos de auditoría de FAMILY guardan solo metadatos, nunca contenido.

**Adjuntos (foto y nota de voz, "guardar y enviar"; no hay streaming):**
`POST /attachments` (multipart, campo `file`; participante de alguna conversación) → 201 `{ "id", "file_name", "mime_type", "kind": "IMAGE"|"AUDIO", "file_size_bytes", "duration_seconds": null }`.
- Tipos permitidos: `image/jpeg`, `image/png`, `image/webp` (≤ 5 MB); `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/mpeg` (≤ 5 MB). Se valida por *magic bytes*, no por el nombre. Se guarda en disco con nombre aleatorio bajo `settings.UPLOAD_DIR` (configurable por entorno, por defecto `./uploads`, ignorado por git). Nunca se usa el nombre del cliente como ruta.
- El adjunto queda "huérfano" hasta que un mensaje lo referencia; solo quien lo subió puede adjuntarlo.
- **Límite de tamaño antes de parsear:** el servidor rechaza la petición antes de leer el cuerpo si falta `Content-Length` (411 `"Falta la cabecera Content-Length: no se aceptan subidas sin tamaño declarado."`) o si supera 5 MB + 64 KB de margen multipart (413 `"El adjunto supera el tamaño máximo de 5 MB."`). `Content-Length` no numérico → 400 `"Cabecera Content-Length no válida."`.
- **Validación de audio:** MP3 = `ID3` o cabecera de frame MPEG válida (sync de 11 bits, versión/capa/bitrate/frecuencia no reservados). MP4/M4A = caja `ftyp` con marca de audio (`M4A `, `M4B `, `M4P `, `F4A `, `F4B `) o genérica (`isom`, `iso2`, `iso4`, `iso5`, `iso6`, `mp41`, `mp42`, `dash`, las que escriben Safari y Chrome con MediaRecorder); en cualquier caso se rechaza si contiene una pista de vídeo (`hdlr` = `vide`) y, con marca genérica, se exige una pista de sonido (`hdlr` = `soun`). WebM (`1A45DFA3` + `webm`) y Ogg (`OggS`) sin cambios.
- **Pendientes y caducidad:** cada usuario puede tener como máximo `MAX_PENDING_ATTACHMENTS_PER_USER` (20) huérfanos (429 si se supera). Los huérfanos con más de `ORPHAN_ATTACHMENT_TTL_HOURS` (24 h) se purgan (fila + archivo) al arrancar y, de forma oportunista, cada vez que esa persona sube un adjunto.

`DELETE /attachments/{id}` (solo quien lo subió) → 204 sin cuerpo; borra la fila y el archivo. Solo para huérfanos: si ya está en un mensaje → 409 `"Solo se pueden descartar adjuntos que aún no se han enviado."`; si no existe o es de otra persona → 404 `"Adjunto no encontrado."`.

`POST /conversations/{id}/messages` acepta además `"attachment_ids": [12, 13]` (máx. 4). El contenido de texto puede ir vacío si hay al menos un adjunto. La respuesta incluye `attachments: [ { id, file_name, mime_type, kind, file_size_bytes, url: "/api/v1/attachments/12" } ]`.
`GET /attachments/{id}` → el binario con su `Content-Type`, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, `Cache-Control: private`. Solo participantes de la conversación del mensaje (o quien lo subió mientras sea huérfano). FAMILY: nunca administración ni líder.

**Retardo de comunicación:** lo calcula el frontend según el entorno de la misión (LEO ≈ 0 s, órbita/superficie lunar ≈ 1,3 s por trayecto, tránsito/superficie de Marte 4–24 min). Se muestra junto al envío: "Llegará en ~X". Nada de videollamadas ni streaming.
