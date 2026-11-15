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

## 4. Recomendación (no implementada): canal con seres queridos

Decisión de producto: este canal **no se construye** en esta versión; queda como recomendación para una fase futura.

- **Por qué:** el NASA HRP (*Isolation and Confinement*, *Behavioral Health*) señala la separación de familia y amigos como un factor de riesgo psicosocial en misiones largas; el contacto regular con los seres queridos es un factor protector.
- **Forma recomendada:** mensajes asíncronos de texto, foto y nota de voz ("grabar, guardar y enviar"), sin videollamadas ni streaming: el retardo de comunicación (≈ 1,3 s por trayecto en la Luna, 4–24 min en Marte) los haría inviables.
- **Privacidad estricta:** solo el astronauta y el familiar autorizado verían el contenido; ni el líder de misión ni la administración, ni siquiera con acceso auditado. Las cuentas de familiares tendrían acceso mínimo (solo ese canal) y la auditoría guardaría solo metadatos.
- **Antes de implementarlo:** definir almacenamiento persistente de adjuntos (volumen, permisos, límites de tamaño en el proxy y validación del tipo real de archivo) y la gestión de vínculos autorizados.
