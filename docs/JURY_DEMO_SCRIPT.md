# Guion de Demostración para el Jurado (5 Minutos — 10 Escenas)
## AstroVital — *Your health. Your mission. Your future.*
**Reto NASA Space Apps Challenge:** *Health Monitoring Software for Astronauts on Space Missions*

> **Nota de Transparencia:** Todas las escenas utilizan datos sintéticos reproducibles etiquetados explícitamente como **SIMULADO** y reglas marcadas como **DEMO**. AstroVital ayuda a observar, comprender, registrar y comunicar información preventiva sobre la salud; no realiza diagnósticos médicos autónomos ni reemplaza a los profesionales sanitarios.

---

### Escena 1 — Inicio de misión (0:00 – 0:30)
1. Abra `http://127.0.0.1:8000` e inicie sesión como la astronauta **Cmdr. Elena Rostova** (`elena.rostova@astrovital.demo` / `AstroCrew!2026`).
2. En **Mission Control**, destaque el encabezado superior:
   - Misión activa: `ARTEMIS-IV-DEMO` (*Lunar South Pole Outpost*).
   - Fase actual (`SURFACE`), entorno resuelto (`Superficie Lunar — 0.166 G`) con fuente explícita (`DEMO_SIMULATION`).
   - Resumen de misión: indicadores en rango normal, en seguimiento, alertas activas y el **índice de participación en rutinas** (aclarando que no se calcula un falso "porcentaje de salud clínica total").

### Escena 2 — Exploración corporal en Body Explorer (0:30 – 1:00)
1. En el menú lateral, abra **3. Body Explorer**.
2. Haga clic sobre el **Corazón (`HEART_CARDIO`)** en la silueta humana SVG interactiva (o navegue con `Tab` y `Enter`).
3. Muestre cómo se ilumina la región anatómica y se actualiza el panel lateral con:
   - Función cardiovascular, riesgos en microgravedad/hipogravedad (redistribución cefálica de fluidos e intolerancia ortostática).
   - Tarjetas de **Frecuencia Cardíaca** y **Presión Arterial**, su tendencia y el botón para abrir el gráfico histórico con explicación asistiva.

### Escena 3 — Evaluación personal en My Health Check (1:00 – 1:30)
1. Diríjase a **2. My Health Check**.
2. Seleccione **Frecuencia Cardíaca (`bpm`)** o **Hidratación Registrada (`mL/día`)**, revise las instrucciones paso a paso y limitaciones de dispositivo.
3. Ingrese una medición sintética (por ejemplo `74 bpm`), marque la casilla de confirmación y pulse **Validar y Guardar Medición**.
4. Muestre la validación inmediata, el estado `NORMAL` calculado por el motor de reglas y los puntos XP acreditados por participación.

### Escena 4 — Alerta y prevención determinista (1:30 – 2:00)
1. Regrese a **1. Mission Control**, seleccione en el Simulador el **Escenario 4: Evento de alerta que activa escalamiento urgente (CRITICAL)** (o **Escenario 3: Tendencia que requiere seguimiento**) y pulse **Ejecutar**.
2. Abra **7. Alerts Center** y muestre la alerta generada:
   - Conserva el código y versión de la regla (`RULE_SPO2_DEMO v1.0-DEMO`), la prioridad y las **instrucciones inmediatas del protocolo** sin depender de un modelo de IA.
3. Escriba una nota de actuación y pulse **Reconocer Alerta** para registrar la trazabilidad.

### Escena 5 — Gamificación ética en Daily Missions (2:00 – 2:30)
1. Abra **5. Daily Missions**.
2. Complete una misión pendiente (p. ej. **Sleep Log** o **Hydration Routine**) y muestre el incremento de XP, la barra de progreso hacia el siguiente nivel (`Explorer` / `Specialist`) y la colección de insignias.
3. En otra misión (como **Move Safely**), pulse **Omitir por Restricción** para demostrar que las restricciones operativas o alertas médicas **no penalizan la racha ni generan mensajes negativos**.

### Escena 6 — Bienestar psicológico con privacidad reforzada (2:30 – 3:00)
1. Abra **4. Wellness Center**.
2. Complete el **Cuestionario Educativo de Bienestar (DEMO)** incluyendo una reflexión privada y seleccionando *Solicitar charla preventiva*.
3. Inicie la animación de **Respiración Táctica Guiada (4-4-4-4)** y muestre cómo las recomendaciones de ejercicio físico se suprimen automáticamente por seguridad cuando existe una alerta médica activa.

### Escena 7 — Contexto ambiental y analítica longitudinal (3:00 – 3:30)
1. En **1. Mission Control**, cambie el entorno en `ContextResolver` a **Actividad Extravehicular (EVA)** y confirme que los umbrales clínicos permanecen intactos.
2. Abra **6. Mission Analytics** y muestre la serie temporal longitudinal de Frecuencia Cardíaca y la gráfica de **Comparación por Fases** (`TRAINING`, `LAUNCH`, `TRANSIT`, `SURFACE`, `EVA`), destacando la nota metodológica que distingue asociación temporal de causalidad.

### Escena 8 — Supervisión terrestre como Líder de Misión (3:30 – 4:00)
1. Cierre sesión e ingrese como **Líder en Tierra** (`leader@astrovital.demo` / `AstroLeader!2026`).
2. Abra **8. Crew Monitoring**:
   - Muestre que el líder puede supervisar a **Elena Rostova** y **Marcus Vance** (asignados a `ARTEMIS-IV-DEMO`), pero **no** tiene acceso al astronauta **Kenji Takahashi** (asignado a otra misión).
   - Muestre que en la sección de bienestar el líder recibe la señal operativa (`SUPPORT_RECOMMENDED`), pero el texto privado del astronauta aparece protegido (`🔒 Respuestas detalladas ocultas por política de privacidad`).

### Escena 9 — Administración y auditoría de seguridad (4:00 – 4:30)
1. Cierre sesión e ingrese como **Administradora** (`admin@astrovital.demo` / `AstroAdmin!2026`).
2. Abra **10. Administration**:
   - Cree un nuevo usuario de tripulación, asígnelo a la misión `ARTEMIS-IV-DEMO` y muestre el directorio de cuentas, las versiones de reglas `DEMO` y la tabla de **Eventos de Auditoría y Seguridad**.

### Escena 10 — Cierre, informes y trazabilidad (4:30 – 5:00)
1. Abra **9. Reports**, ingrese una justificación operativa y descargue el informe en **PDF**, **CSV** y **JSON**.
2. Concluya destacando cómo cada informe incluye cobertura temporal, fuentes de datos, etiqueta **SIMULADO** y aviso explícito de los límites no diagnósticos de la plataforma.

