/* =========================================================================
   Traducciones EN de textos del backend generados en tiempo de ejecución
   (rules/engine.py, services/*.py, api/v1/router.py, api/v1/expansion_router.py).
   Ver el contrato en src/i18n/backend.js.

   - EXACT: claves en español (se normalizan los espacios al cargar).
   - PATTERNS: [RegExp anclada, (m, bt) => string]; se prueban contra el texto
     completo ya normalizado. `bt` traduce sub-partes (nombres de indicadores,
     entornos, títulos de alerta...) de forma recursiva.
   - Los patrones más específicos van antes que los generales.
   ========================================================================= */

/* ---------- helpers ---------- */

// Unidades que llegan en español dentro de textos generados.
const UNITS = {
  "escala 1-10": "scale 1-10",
  "mL/día": "mL/day",
  "min/día": "min/day",
  "mSv/día": "mSv/day",
  "% aciertos": "% correct",
  "estado operativo": "operational state",
  "solicitud": "request",
  "horas": "hours",
  "días": "days",
};
const u = (s) => {
  const k = String(s || "").trim();
  return Object.prototype.hasOwnProperty.call(UNITS, k) ? UNITS[k] : k;
};

// Etiqueta del componente evaluado en los motivos del motor (valor principal o diastólica).
const lbl = (s) => (s === "Valor" ? "Value" : "Diastolic pressure");

// Traduce un bloque de varias frases (p. ej. motivos de evaluación unidos por espacios).
const sentences = (s, bt) =>
  String(s)
    .split(/(?<=\.)\s+(?=[A-ZÁÉÍÓÚÑ¿¡[])/)
    .map((x) => bt(x))
    .join(" ");

// Descripción de tendencia de ai_assistant.explain_indicator_and_trend
function trendDesc(s) {
  let m;
  if (s === "estable sin variación neta en la ventana reciente")
    return "a stable profile with no net change in the recent window";
  if (s === "con un único punto válido disponible (insuficiente para tendencia longitudinal)")
    return "only one valid data point (insufficient for a longitudinal trend)";
  if ((m = s.match(/^con variación ascendente descriptiva \(([-+]?[\d.,]+) (.+?) en (\d+) registros\)$/)))
    return `a descriptive upward variation (${m[1]} ${u(m[2])} over ${m[3]} records)`;
  if ((m = s.match(/^con variación descendente descriptiva \(([-+]?[\d.,]+) (.+?) en (\d+) registros\)$/)))
    return `a descriptive downward variation (${m[1]} ${u(m[2])} over ${m[3]} records)`;
  return s;
}

/* =========================================================================
   EXACT
   ========================================================================= */
export const EXACT = {
  // ── frontend: location_module que envía el selector de entorno (console.js CREW_ENVIRONMENTS) ──
  "Cabina de la nave (tránsito en espacio profundo)": "Spacecraft cabin (deep-space transit)",
  "Módulo de la estación orbital (LEO)": "Orbital station module (LEO)",
  "Rover presurizado (superficie lunar)": "Pressurized rover (lunar surface)",
  "Base marciana (hábitat presurizado)": "Mars base (pressurized habitat)",
  "Superficie lunar (base Polo Sur)": "Lunar surface (South Pole base)",
  /* ---------- unidades sueltas (campos "unit" de alertas) ---------- */
  "escala 1-10": "scale 1-10",
  "mL/día": "mL/day",
  "min/día": "min/day",
  "mSv/día": "mSv/day",
  "% aciertos": "% correct",
  "estado operativo": "operational state",
  "solicitud": "request",

  /* ---------- rules/engine.py ---------- */
  // ContextResolver
  "Telemetría verificada de nave/hábitat": "Verified spacecraft/habitat telemetry",
  "Identificador de misión asignada": "Assigned mission identifier",
  "Confirmación manual por usuario autorizado": "Manual confirmation by authorized user",
  "Conjunto de datos ambientales importado": "Imported environmental dataset",
  "Simulación explícita (Modo DEMO)": "Explicit simulation (DEMO Mode)",
  "Entorno no confirmado": "Unconfirmed environment",
  "Sin confirmar": "Unconfirmed",
  "Entorno no confirmado (Sin telemetría ni confirmación manual)":
    "Unconfirmed environment (no telemetry or manual confirmation)",
  "No se encontró fuente verificada. Nunca se asume ubicación por GPS local.":
    "No verified source found. Location is never inferred from local GPS.",
  // Evaluación de mediciones
  "No existe versión de regla activa configurada para este indicador.":
    "No active rule version is configured for this indicator.",
  "Nota: Esta alerta es una señal operativa preventiva y no constituye un diagnóstico médico.":
    "Note: This alert is a preventive operational signal and does not constitute a medical diagnosis.",
  "SEMSA DEMO Reference Protocol (Ilustrativo / No Clínico)":
    "SEMSA DEMO Reference Protocol (Illustrative / Non-Clinical)",
  "Valor no numérico: la medición no se puede evaluar.": "Non-numeric value: the measurement cannot be evaluated.",

  /* ---------- rules/recommendations.py: recomendación de cada alerta (indicador × dirección × nivel) ---------- */
  "1. Baja la intensidad por hoy y deja tiempo de recuperación antes de la próxima sesión.":
    "1. Lower the intensity for today and allow recovery time before your next session.",
  "1. Bebe agua ahora y reparte el resto de tu pauta diaria en tomas regulares.":
    "1. Drink water now and spread the rest of your daily target over regular intakes.",
  "1. Comprueba el termómetro, abrígate y repite la medición para descartar un error de lectura.":
    "1. Check the thermometer, keep warm and repeat the measurement to rule out a reading error.",
  "1. Comprueba la lectura del dosímetro y consulta si hay aviso de evento solar; si lo hay, ve al refugio.":
    "1. Check the dosimeter reading and find out whether there is a solar event warning; if there is, go to the shelter.",
  "1. Descansa unos minutos, mide tu SpO₂ y vuelve a contar las respiraciones durante 60 segundos.":
    "1. Rest for a few minutes, measure your SpO₂ and count your breaths again for 60 seconds.",
  "1. Dos fuentes dieron valores distintos en pocos minutos: repite la medición con el sensor mejor colocado.":
    "1. Two sources gave different values within a few minutes: repeat the measurement with the better-placed sensor.",
  "1. El valor está fuera de tu rango habitual: repite la medición y revisa si tienes síntomas.":
    "1. The value is outside your usual range: repeat the measurement and check whether you have symptoms.",
  "1. Haz una pausa de recuperación y evita las tareas críticas hasta que te sientas mejor.":
    "1. Take a recovery break and avoid critical tasks until you feel better.",
  "1. Programa hoy una sesión de ejercicio autorizado, aunque sea corta, si no tienes una restricción médica u operativa.":
    "1. Schedule an authorized exercise session today, even a short one, unless you have a medical or operational restriction.",
  "1. Protege tu horario de sueño de hoy y evita las tareas críticas hasta haber descansado.":
    "1. Protect your sleep schedule today and avoid critical tasks until you have rested.",
  "1. Registra tus síntomas, bebe agua y repite la medición en 15 minutos, sin líquidos calientes ni ejercicio antes.":
    "1. Log your symptoms, drink water and repeat the measurement in 15 minutes, with no hot drinks or exercise beforehand.",
  "1. Repite la medición con el analizador y anota la hora de tu última comida.":
    "1. Repeat the measurement with the analyzer and note the time of your last meal.",
  "1. Repite la medición con el analizador y anota qué comiste y cuándo.":
    "1. Repeat the measurement with the analyzer and note what you ate and when.",
  "1. Repite la medición en reposo para confirmar el valor alto.":
    "1. Repeat the measurement at rest to confirm the high value.",
  "1. Repite la medición en reposo para confirmar el valor bajo.":
    "1. Repeat the measurement at rest to confirm the low value.",
  "1. Repite la medición en reposo y anota si notas mareo o fatiga: un pulso bajo es habitual en personas entrenadas.":
    "1. Repeat the measurement at rest and note any dizziness or fatigue: a low pulse is common in trained people.",
  "1. Repite la medición tras 5 minutos de reposo, sentado y con el brazalete a la altura del corazón.":
    "1. Repeat the measurement after 5 minutes of rest, seated and with the cuff at heart level.",
  "1. Revisa el registro por si hay un error de suma y reparte la ingesta a lo largo del día.":
    "1. Check the log for an adding error and spread your intake across the day.",
  "1. Revisa la colocación del sensor, mantén la mano quieta y templada y repite la medición.":
    "1. Check the sensor placement, keep your hand still and warm, and repeat the measurement.",
  "1. Revisa tu dosis acumulada con el equipo de radiación antes de planificar nuevas exposiciones.":
    "1. Review your cumulative dose with the radiation team before planning new exposures.",
  "1. Siéntate o recuéstate, bebe agua y repite la medición en unos minutos.":
    "1. Sit or lie down, drink water and repeat the measurement in a few minutes.",
  "1. Siéntate, respira con calma y vuelve a medir el pulso tras 5 minutos de reposo.":
    "1. Sit down, breathe calmly and measure your pulse again after 5 minutes of rest.",
  "1. Tu presión arterial está fuera de tu rango habitual: repite la medición en reposo y revisa si tienes síntomas.":
    "1. Your blood pressure is outside your usual range: repeat the measurement at rest and check whether you have symptoms.",
  "1. Tu pulso está fuera de tu rango habitual: repite la medición en reposo y revisa si tienes síntomas.":
    "1. Your pulse is outside your usual range: repeat the measurement at rest and check whether you have symptoms.",
  "1. Tu temperatura está fuera de tu rango habitual: repite la medición y revisa si tienes síntomas.":
    "1. Your temperature is outside your usual range: repeat the measurement and check whether you have symptoms.",
  "1. Tómate un momento para ti y cuéntale cómo te sientes a alguien de confianza de la tripulación o del equipo de apoyo.":
    "1. Take a moment for yourself and tell someone you trust in the crew or the support team how you feel.",
  "Para mejorar en los próximos días: acuéstate y levántate a la misma hora, usa la iluminación que simula el ciclo día-noche, evita la cafeína antes de dormir y reserva un tiempo de relajación al final del día. Avisa al médico de vuelo si la media de 7 noches baja de 5,5 horas o si la falta de sueño afecta a tus tareas. Fuente: dataset del proyecto (astronaut-health-dataset, alertas.py), regla sueno_corto (media de 7 noches; Barger 2014, cifra verificada) y contramedidas NASA HRP para el sueño inadecuado y los horarios irregulares.":
    "To improve over the next few days: go to bed and get up at the same time, use the lighting that simulates the day-night cycle, avoid caffeine before sleeping and set aside some time to wind down at the end of the day. Tell the flight surgeon if the 7-night average drops below 5.5 hours or if lack of sleep affects your tasks. Source: project dataset (astronaut-health-dataset, alertas.py), rule sueno_corto (7-night average; Barger 2014, verified figure) and NASA HRP countermeasures for inadequate sleep and irregular schedules.",
  "Para mejorar en los próximos días: aumenta la hidratación, levántate despacio y mantén el ejercicio pautado; antes de volver a un entorno con gravedad, sigue la pauta de hidratación abundante y usa las prendas de compresión. Avisa al médico de vuelo si hay mareo o desmayo. Fuente: dataset del proyecto (astronaut-health-dataset, alertas.py), regla pa_baja (criterio clínico general, no verificado) y contramedidas NASA HRP para las adaptaciones cardiovasculares (hidratación y prendas de compresión).":
    "To improve over the next few days: drink more fluids, stand up slowly and keep to your prescribed exercise; before returning to a gravity environment, follow the fluid-loading plan and wear the compression garments. Tell the flight surgeon if you feel dizzy or faint. Source: project dataset (astronaut-health-dataset, alertas.py), rule pa_baja (general clinical criterion, not verified) and NASA HRP countermeasures for cardiovascular adaptations (hydration and compression garments).",
  "Para mejorar en los próximos días: completa el check-in emocional, lleva un diario, reserva tiempo para una actividad que disfrutes y mantén el contacto con tus seres queridos. Habla con el equipo de apoyo psicológico si el ánimo bajo se mantiene varios días; si tienes pensamientos de hacerte daño, habla ya con el médico de vuelo o con el psicólogo. Fuente: dataset del proyecto (astronaut-health-dataset, alertas.py), regla animo_bajo (diseño del equipo sobre datos simulados; umbrales absolutos sin respaldo en el dataset) y contramedidas NASA HRP para las condiciones conductuales.":
    "To improve over the next few days: complete the emotional check-in, keep a journal, set aside time for an activity you enjoy and stay in touch with your loved ones. Talk to the psychological support team if the low mood lasts several days; if you have thoughts of harming yourself, talk to the flight surgeon or the psychologist right away. Source: project dataset (astronaut-health-dataset, alertas.py), rule animo_bajo (team design on simulated data; absolute thresholds not backed by the dataset) and NASA HRP countermeasures for behavioral conditions.",
  "Para mejorar en los próximos días: descansa, mantén la hidratación y mide la temperatura a la misma hora y con el mismo termómetro para confirmar la tendencia. Avisa al médico de vuelo si el desvío se mantiene en dos controles seguidos o si aparecen escalofríos, tos o sarpullido. Fuente: dataset del proyecto (astronaut-health-dataset, alertas.py), desvío frente a la línea base personal (diseño del equipo) y NASA HRP, respuestas alteradas del sistema inmunológico.":
    "To improve over the next few days: rest, stay hydrated and measure your temperature at the same time and with the same thermometer to confirm the trend. Tell the flight surgeon if the deviation persists over two consecutive checks or if chills, cough or a rash appear. Source: project dataset (astronaut-health-dataset, alertas.py), deviation from the personal baseline (team design) and NASA HRP, altered immune system responses.",
  "Para mejorar en los próximos días: descansa, mantén la hidratación y vuelve a medir la temperatura cada pocas horas; anota si hay escalofríos, tos o sarpullido. Avisa al médico de vuelo si la temperatura llega a 38,0 °C o si los síntomas empeoran. Fuente: dataset del proyecto (astronaut-health-dataset, alertas.py), regla fiebre (criterio clínico general, no verificado) y NASA HRP, respuestas alteradas del sistema inmunológico.":
    "To improve over the next few days: rest, stay hydrated and measure your temperature again every few hours; note any chills, cough or rash. Tell the flight surgeon if your temperature reaches 38.0 °C or if the symptoms get worse. Source: project dataset (astronaut-health-dataset, alertas.py), rule fiebre (general clinical criterion, not verified) and NASA HRP, altered immune system responses.",
  "Para mejorar en los próximos días: evita el esfuerzo hasta que se normalice, revisa el CO₂ de la cabina y repite el control en reposo. Avisa al médico de vuelo si sigue por encima de 20 rpm en reposo, y de inmediato si llega a 24 rpm o notas falta de aire. Fuente: dataset del proyecto (astronaut-health-dataset, alertas.py), regla resp_alta (criterio clínico general, no verificado).":
    "To improve over the next few days: avoid exertion until it returns to normal, check the cabin CO₂ and repeat the check at rest. Tell the flight surgeon if it stays above 20 rpm at rest, and immediately if it reaches 24 rpm or you feel short of breath. Source: project dataset (astronaut-health-dataset, alertas.py), rule resp_alta (general clinical criterion, not verified).",
  "Para mejorar en los próximos días: limita el tiempo en las zonas menos blindadas, pospón la actividad extravehicular no esencial y revisa tu dosis acumulada con el equipo de radiación. Avisa al médico de vuelo si la dosis diaria sigue alta en la próxima lectura. Fuente: cortes de dosis diaria sin respaldo en el dataset (referencia: 0,2 a 0,5 mSv al día en la ISS, Shavers 2023); acción de la regla radiacion_acumulada del dataset del proyecto (astronaut-health-dataset, alertas.py) y NASA HRP, cánceres inducidos por radiación.":
    "To improve over the next few days: limit your time in the least shielded areas, postpone non-essential extravehicular activity and review your cumulative dose with the radiation team. Tell the flight surgeon if the daily dose is still high at the next reading. Source: daily dose cut-offs not backed by the dataset (reference: 0.2 to 0.5 mSv per day on the ISS, Shavers 2023); action from rule radiacion_acumulada of the project dataset (astronaut-health-dataset, alertas.py) and NASA HRP, radiation-induced cancers.",
  "Para mejorar en los próximos días: mantente abrigado, revisa la temperatura de la cabina y repite el control con otro termómetro si es posible. Avisa al médico de vuelo si la temperatura sigue por debajo de 35 °C al repetir la medición. Fuente: dataset del proyecto (astronaut-health-dataset, alertas.py), regla hipotermia (criterio clínico general, no verificado).":
    "To improve over the next few days: keep warm, check the cabin temperature and repeat the check with another thermometer if possible. Tell the flight surgeon if your temperature is still below 35 °C when you repeat the measurement. Source: project dataset (astronaut-health-dataset, alertas.py), rule hipotermia (general clinical criterion, not verified).",
  "Para mejorar en los próximos días: mantén el ejercicio pautado, elige las opciones bajas en sodio del menú, cuida el descanso y mide la presión a la misma hora. Avisa al médico de vuelo si sigue en 140/90 mmHg o más al repetir la medición, y de inmediato si llega a 180/120 mmHg o aparece dolor en el pecho. Fuente: dataset del proyecto (astronaut-health-dataset, alertas.py), reglas pa_alta y pad_alta (guía AHA/ACC 2017, no verificada) y contramedidas NASA HRP (ejercicio regular, dieta saludable y reducción del sodio).":
    "To improve over the next few days: keep to your prescribed exercise, choose the low-sodium options on the menu, look after your rest and measure your blood pressure at the same time of day. Tell the flight surgeon if it stays at 140/90 mmHg or higher when you repeat the measurement, and immediately if it reaches 180/120 mmHg or chest pain appears. Source: project dataset (astronaut-health-dataset, alertas.py), rules pa_alta and pad_alta (AHA/ACC 2017 guideline, not verified) and NASA HRP countermeasures (regular exercise, healthy diet and sodium reduction).",
  "Para mejorar en los próximos días: mantén la hidratación y el ejercicio pautado, cuida el sueño y registra el pulso en reposo a la misma hora. Avisa al médico de vuelo si sigue en 100 lpm o más al repetir la medición, y de inmediato si llega a 120 lpm o aparece dolor en el pecho. Fuente: dataset del proyecto (astronaut-health-dataset, alertas.py), regla pulso_alto (criterio clínico general, no verificado) y contramedidas NASA HRP para las adaptaciones cardiovasculares (ejercicio regular).":
    "To improve over the next few days: stay hydrated and keep to your prescribed exercise, look after your sleep and log your resting pulse at the same time of day. Tell the flight surgeon if it stays at 100 bpm or higher when you repeat the measurement, and immediately if it reaches 120 bpm or chest pain appears. Source: project dataset (astronaut-health-dataset, alertas.py), rule pulso_alto (general clinical criterion, not verified) and NASA HRP countermeasures for cardiovascular adaptations (regular exercise).",
  "Para mejorar en los próximos días: no te saltes comidas, sigue el menú pautado y mantén el ejercicio: la inactividad prolongada reduce la captación de glucosa del músculo. Avisa al médico de vuelo si el valor sigue por debajo de 70 mg/dL al repetir la medición o si notas debilidad o mareo. Fuente: rango de referencia de la glucosa i-STAT en el laboratorio de UTMB (dataset del proyecto; sin regla de alerta propia en el dataset) y NASA HRP, alimentación y nutrición.":
    "To improve over the next few days: do not skip meals, follow the prescribed menu and keep exercising: prolonged inactivity reduces muscle glucose uptake. Tell the flight surgeon if the value is still below 70 mg/dL when you repeat the measurement or if you feel weak or dizzy. Source: i-STAT glucose reference range from the UTMB laboratory (project dataset; the dataset has no alert rule of its own) and NASA HRP, food and nutrition.",
  "Para mejorar en los próximos días: prioriza las zonas mejor blindadas, limita las actividades extravehiculares y ve al refugio ante cualquier aviso de evento solar. Avisa al médico de vuelo: tu dosis acumulada registrada ya supera la mitad del límite de carrera de 600 mSv. Fuente: dataset del proyecto (astronaut-health-dataset, alertas.py), regla radiacion_acumulada (límite de carrera de 600 mSv de NASA HRP, cifra verificada; cortes decididos por el equipo).":
    "To improve over the next few days: favor the best-shielded areas, limit extravehicular activities and go to the shelter at any solar event warning. Tell the flight surgeon: your recorded cumulative dose is already more than half of the 600 mSv career limit. Source: project dataset (astronaut-health-dataset, alertas.py), rule radiacion_acumulada (NASA HRP 600 mSv career limit, verified figure; cut-offs decided by the team).",
  "Para mejorar en los próximos días: programa recordatorios de hidratación, lleva la cuenta de las bolsas de bebida y bebe más los días de ejercicio o de actividad extravehicular. Avisa al médico de vuelo si no alcanzas tu pauta dos días seguidos o si notas dolor en el costado o sangre en la orina. Fuente: umbral sin respaldo en el dataset (no trae series de hidratación); recomendación basada en NASA HRP (riesgo renal e hidratación como contramedida cardiovascular).":
    "To improve over the next few days: set hydration reminders, keep count of your drink bags and drink more on exercise or extravehicular activity days. Tell the flight surgeon if you miss your target two days in a row or if you notice flank pain or blood in your urine. Source: threshold not backed by the dataset (it has no hydration series); recommendation based on NASA HRP (renal risk, and hydration as a cardiovascular countermeasure).",
  "Para mejorar en los próximos días: protege tu horario de sueño, reparte la carga de trabajo, reserva tiempo de relajación y autocuidado y mantén el ejercicio pautado. Avisa al médico de vuelo si la fatiga alta se mantiene dos días seguidos o afecta a tu seguridad en las tareas. Fuente: umbral sin respaldo en el dataset (no trae series de fatiga); recomendación basada en NASA HRP (sueño inadecuado y horarios irregulares).":
    "To improve over the next few days: protect your sleep schedule, spread out your workload, set aside time for relaxation and self-care and keep to your prescribed exercise. Tell the flight surgeon if high fatigue lasts two days in a row or affects your safety during tasks. Source: threshold not backed by the dataset (it has no fatigue series); recommendation based on NASA HRP (inadequate sleep and irregular schedules).",
  "Para mejorar en los próximos días: recupera de forma progresiva la pauta de ejercicio de resistencia y aeróbico (en la ISS, 1,5 horas al día, 6 a 7 días por semana) y repártela en bloques si la agenda no da para más. Avisa al médico de vuelo si llevas varios días sin poder entrenar o si el motivo es dolor o una lesión. Fuente: umbral sin respaldo en el dataset (no trae series de ejercicio); recomendación basada en NASA HRP (reducción de la aptitud cardiorrespiratoria y musculoesquelética).":
    "To improve over the next few days: gradually return to the resistance and aerobic exercise plan (on the ISS, 1.5 hours a day, 6 to 7 days a week) and split it into blocks if the schedule allows no more. Tell the flight surgeon if you have been unable to train for several days or if the reason is pain or an injury. Source: threshold not backed by the dataset (it has no exercise series); recommendation based on NASA HRP (reduced cardiorespiratory and musculoskeletal fitness).",
  "Para mejorar en los próximos días: respira despacio y profundo, revisa el CO₂ y la ventilación de la cabina y evita el esfuerzo hasta repetir el control. Avisa al médico de vuelo si sigue por debajo de 95 % al repetir la medición, y de inmediato si baja de 92 % o notas falta de aire. Fuente: dataset del proyecto (astronaut-health-dataset, alertas.py), regla spo2_baja (criterio clínico general, no verificado; la SpO₂ del dataset es simulada) y NASA HRP, riesgo de hipoxia.":
    "To improve over the next few days: breathe slowly and deeply, check the cabin CO₂ and ventilation and avoid exertion until you repeat the check. Tell the flight surgeon if it stays below 95 % when you repeat the measurement, and immediately if it drops below 92 % or you feel short of breath. Source: project dataset (astronaut-health-dataset, alertas.py), rule spo2_baja (general clinical criterion, not verified; SpO₂ in the dataset is simulated) and NASA HRP, risk of hypoxia.",
  "Para mejorar en los próximos días: revisa el descanso, la hidratación y la actividad de las últimas 24 horas y repite el control a la misma hora. Avisa al médico de vuelo si el desvío se mantiene en dos controles seguidos. Fuente: dataset del proyecto (astronaut-health-dataset, alertas.py), desvío frente a la línea base personal (diseño del equipo).":
    "To improve over the next few days: review your rest, hydration and activity over the last 24 hours and repeat the check at the same time of day. Tell the flight surgeon if the deviation persists over two consecutive checks. Source: project dataset (astronaut-health-dataset, alertas.py), deviation from the personal baseline (team design).",
  "Para mejorar en los próximos días: revisa el descanso, la hidratación y la actividad de las últimas 24 horas y repite el control a la misma hora. Avisa al médico de vuelo si el valor sigue fuera de rango al repetir la medición. Fuente: recomendación general de SEMSA (sin regla específica en el dataset).":
    "To improve over the next few days: review your rest, hydration and activity over the last 24 hours and repeat the check at the same time of day. Tell the flight surgeon if the value is still out of range when you repeat the measurement. Source: general SEMSA recommendation (no specific rule in the dataset).",
  "Para mejorar en los próximos días: revisa el sueño, la hidratación y la carga de ejercicio de las últimas 24 horas y mide el pulso en reposo a la misma hora para confirmar la tendencia. Avisa al médico de vuelo si el desvío se mantiene en dos controles seguidos o si aparecen palpitaciones, mareo o dolor en el pecho. Fuente: dataset del proyecto (astronaut-health-dataset, alertas.py), desvío frente a la línea base personal (diseño del equipo) y NASA HRP, adaptaciones cardiovasculares.":
    "To improve over the next few days: review your sleep, hydration and exercise load over the last 24 hours and measure your resting pulse at the same time of day to confirm the trend. Tell the flight surgeon if the deviation persists over two consecutive checks or if palpitations, dizziness or chest pain appear. Source: project dataset (astronaut-health-dataset, alertas.py), deviation from the personal baseline (team design) and NASA HRP, cardiovascular adaptations.",
  "Para mejorar en los próximos días: revisa la hidratación, el descanso y el sodio de las últimas 24 horas y mide la presión a la misma hora para confirmar la tendencia. Avisa al médico de vuelo si el desvío se mantiene en dos controles seguidos o si hay mareo, desmayo o dolor en el pecho. Fuente: dataset del proyecto (astronaut-health-dataset, alertas.py), desvío frente a la línea base personal (diseño del equipo) y NASA HRP, adaptaciones cardiovasculares.":
    "To improve over the next few days: review your hydration, rest and sodium intake over the last 24 hours and measure your blood pressure at the same time of day to confirm the trend. Tell the flight surgeon if the deviation persists over two consecutive checks or if you feel dizzy, faint or have chest pain. Source: project dataset (astronaut-health-dataset, alertas.py), deviation from the personal baseline (team design) and NASA HRP, cardiovascular adaptations.",
  "Para mejorar en los próximos días: sigue con tu plan de ejercicio y controla el pulso en reposo a diario para confirmar si es tu valor habitual. Avisa al médico de vuelo si hay mareo, fatiga o desmayo, y de inmediato si el pulso baja a 40 lpm o menos. Fuente: dataset del proyecto (astronaut-health-dataset, alertas.py), regla pulso_bajo (criterio clínico general, no verificado).":
    "To improve over the next few days: carry on with your exercise plan and check your resting pulse daily to confirm whether this is your usual value. Tell the flight surgeon if you feel dizzy, fatigued or faint, and immediately if your pulse drops to 40 bpm or lower. Source: project dataset (astronaut-health-dataset, alertas.py), rule pulso_bajo (general clinical criterion, not verified).",
  "Para mejorar en los próximos días: sigue el menú pautado, reparte las comidas y mantén el ejercicio: la inactividad prolongada reduce la captación de glucosa del músculo. Avisa al médico de vuelo si el valor sigue por encima de 105 mg/dL en ayunas al repetir la medición. Fuente: rango de referencia de la glucosa i-STAT en el laboratorio de UTMB (dataset del proyecto; sin regla de alerta propia en el dataset) y NASA HRP, alimentación y nutrición.":
    "To improve over the next few days: follow the prescribed menu, space out your meals and keep exercising: prolonged inactivity reduces muscle glucose uptake. Tell the flight surgeon if the fasting value is still above 105 mg/dL when you repeat the measurement. Source: i-STAT glucose reference range from the UTMB laboratory (project dataset; the dataset has no alert rule of its own) and NASA HRP, food and nutrition.",
  "Para mejorar en los próximos días: usa siempre el mismo sensor y la misma postura para este indicador y revisa la colocación antes de medir. Avisa al médico de vuelo si las dos fuentes siguen sin coincidir. Fuente: control de calidad de datos de SEMSA (sin regla en el dataset).":
    "To improve over the next few days: always use the same sensor and the same posture for this indicator and check the placement before measuring. Tell the flight surgeon if the two sources still disagree. Source: SEMSA data quality check (no rule in the dataset).",
  "Para mejorar en los próximos días: vuelve a la pauta prescrita, alterna días de carga y de recuperación y cuida la hidratación y el sueño. Avisa al médico de vuelo si hay dolor, una lesión o un cansancio que no cede. Fuente: umbral sin respaldo en el dataset (no trae series de ejercicio); recomendación basada en NASA HRP (reducción de la aptitud cardiorrespiratoria y musculoesquelética).":
    "To improve over the next few days: return to the prescribed plan, alternate load and recovery days and look after your hydration and sleep. Tell the flight surgeon if there is pain, an injury or tiredness that does not ease. Source: threshold not backed by the dataset (it has no exercise series); recommendation based on NASA HRP (reduced cardiorespiratory and musculoskeletal fitness).",
  "Para mejorar en los próximos días: vuelve a tu pauta diaria y anota la ingesta toma a toma. Avisa al médico de vuelo si la ingesta sigue por encima de tu pauta varios días o si notas malestar. Fuente: umbral sin respaldo en el dataset (no trae series de hidratación).":
    "To improve over the next few days: return to your daily target and log your intake drink by drink. Tell the flight surgeon if your intake stays above your target for several days or if you feel unwell. Source: threshold not backed by the dataset (it has no hydration series).",
  "2. Nivel de observación: no necesitas interrumpir tus tareas; vuelve a medir en tu próximo control.":
    "2. Observation level: you do not need to interrupt your tasks; measure again at your next check.",
  "2. Nivel de seguimiento: repite la medición en los próximos 10 minutos y deja constancia en el Centro de Alertas.":
    "2. Follow-up level: repeat the measurement within the next 10 minutes and record it in the Alert Center.",
  "2. Nivel crítico: suspende la actividad exigente y contacta ahora con el médico de vuelo.":
    "2. Critical level: stop strenuous activity and contact the flight surgeon now.",
  "Revisa esta alerta en el Centro de Alertas y repite el registro que la originó cuando puedas.":
    "Review this alert in the Alert Center and repeat the record that triggered it when you can.",
  "Si la situación se mantiene en tu próximo control, coméntala con el médico de vuelo o con tu equipo de apoyo.":
    "If the situation persists at your next check, raise it with the flight surgeon or your support team.",

  /* ---------- services/ai_assistant.py ---------- */
  "Aviso Operativo: SEMSA proporciona orientación educativa y preventiva basada en reglas configuradas (DEMO). No realiza diagnósticos médicos autónomos, no sustituye al personal sanitario de vuelo y no modifica protocolos clínicos.":
    "Operational Notice: SEMSA provides educational and preventive guidance based on configured rules (DEMO). It does not make autonomous medical diagnoses, does not replace flight medical personnel, and does not modify clinical protocols.",
  "Indicador no registrado en el catálogo.": "Indicator not registered in the catalog.",
  "Sin mediciones válidas registradas para calcular tendencia.":
    "No valid measurements recorded to compute a trend.",
  "Se requiere cobertura temporal verificada antes de analizar patrones.":
    "Verified temporal coverage is required before analyzing patterns.",
  "Registrar una medición siguiendo el procedimiento guiado en My Health Check.":
    "Record a measurement following the guided procedure in My Health Check.",
  "estable sin variación neta en la ventana reciente": "stable, with no net change in the recent window",
  "con un único punto válido disponible (insuficiente para tendencia longitudinal)":
    "with only one valid data point (insufficient for a longitudinal trend)",
  "Nota metodológica: La coincidencia temporal entre cambios ambientales o fases de misión y variaciones fisiológicas representa una asociación descriptiva, no una prueba de causalidad directa.":
    "Methodological note: Temporal coincidence between environmental changes or mission phases and physiological variations represents a descriptive association, not proof of direct causality.",
  "Consultar el protocolo autorizado de medicina espacial y completar el seguimiento preventivo indicado.":
    "Consult the authorized space medicine protocol and complete the indicated preventive follow-up.",
  "Mantener las rutinas preventivas autorizadas y la programación habitual de registros.":
    "Maintain authorized preventive routines and the usual recording schedule.",
  "Atención: Las actividades de relajación o bienestar son complementarias y nunca sustituyen la evaluación profesional ni la activación de protocolos urgentes.":
    "Attention: Relaxation and wellness activities are complementary and never replace professional evaluation or the activation of urgent protocols.",

  /* ---------- services/gamification.py ---------- */
  "Rutina completada: tu constancia fortalece la seguridad de toda la misión.":
    "Routine completed: your consistency strengthens the safety of the whole mission.",
  "Buen trabajo: registraste tu evaluación de forma transparente y trazable.":
    "Good work: you recorded your assessment in a transparent and traceable way.",
  "Tu seguimiento quedó registrado. Observar y comunicar a tiempo es parte del éxito espacial.":
    "Your follow-up has been recorded. Observing and communicating in time is part of spaceflight success.",
  "Módulo de autocuidado registrado: priorizar tu descanso y bienestar protege a la tripulación.":
    "Self-care module recorded: prioritizing your rest and wellbeing protects the crew.",
  "Completaste un registro validado de evaluación de salud.": "You completed a validated health assessment record.",
  "Mantuviste constancia en tus rutinas preventivas sin penalización.":
    "You stayed consistent with your preventive routines, with no penalty.",
  "Registraste tu rutina de descanso y sueño.": "You logged your rest and sleep routine.",
  "Exploraste contenido educativo sobre fisiología espacial.": "You explored educational content on space physiology.",
  "Demostraste compromiso con el autocuidado integral.": "You showed commitment to comprehensive self-care.",
  "Completaste un seguimiento preventivo o comunicación recomendada.":
    "You completed a preventive follow-up or recommended communication.",
  "Completaste una actividad cognitiva interactiva.": "You completed an interactive cognitive activity.",
  "Participaste en entrenamiento de memoria de trabajo.": "You took part in working memory training.",
  "Participaste en entrenamiento de atención selectiva.": "You took part in selective attention training.",
  "Alcanzaste un hito de participación y aprendizaje en la misión.":
    "You reached a participation and learning milestone in the mission.",
  "Participación activa en el Cognitive Assessment Center.": "Active participation in the Cognitive Assessment Center.",
  "Esta misión ya fue registrada hoy. Tu progreso está conservado de forma segura.":
    "This mission was already recorded today. Your progress is safely preserved.",
  "Actividad omitida por restricción operativa o indisponibilidad de sensor. Tu racha y progreso se conservan sin ninguna penalización.":
    "Activity skipped due to an operational restriction or sensor unavailability. Your streak and progress are preserved with no penalty.",

  /* ---------- services/simulator.py ---------- */
  // Escenarios
  "1. Misión estable con indicadores dentro de límites DEMO": "1. Stable mission with indicators within DEMO limits",
  "Genera un lote completo de mediciones fisiológicas y ambientales simuladas dentro de los rangos operativos de referencia.":
    "Generates a full batch of simulated physiological and environmental measurements within the operational reference ranges.",
  "2. Datos incompletos y sensor sin conexión": "2. Incomplete data and offline sensor",
  "Desconecta el sensor óptico biométrico simulado, registra un evento de calidad de datos y deja indicadores vencidos/sin datos.":
    "Disconnects the simulated optical biometric sensor, logs a data quality event and leaves indicators stale/without data.",
  "3. Tendencia que requiere seguimiento (MONITOR / WARNING)": "3. Trend requiring follow-up (MONITOR / WARNING)",
  "Simula un incremento progresivo de frecuencia cardíaca y presión arterial en 3 puntos temporales que activa seguimiento preventivo.":
    "Simulates a progressive increase in heart rate and blood pressure over 3 time points that triggers preventive follow-up.",
  "4. Evento de alerta que activa escalamiento urgente (CRITICAL)": "4. Alert event triggering urgent escalation (CRITICAL)",
  "Simula una lectura de saturación de oxígeno baja (SpO2 89%) y CO2 elevado en cabina, activando alerta CRITICAL e instrucciones inmediatas.":
    "Simulates a low oxygen saturation reading (SpO2 89%) and elevated cabin CO2, triggering a CRITICAL alert and immediate instructions.",
  "5. Disminución del descanso y aumento de fatiga percibida": "5. Reduced rest and increased perceived fatigue",
  "Registra reducción de horas de sueño (4.2 h) y aumento de fatiga percibida (8/10), generando alerta preventiva de descanso.":
    "Logs reduced sleep hours (4.2 h) and increased perceived fatigue (8/10), generating a preventive rest alert.",
  "6. Cambio de entorno y fase de misión (EVA / Superficie Lunar)": "6. Environment and mission phase change (EVA / Lunar Surface)",
  "Actualiza el contexto verificado a EXTRAVEHICULAR_ACTIVITY (EVA), registra telemetría de traje y mantiene umbrales clínicos intactos.":
    "Updates the verified context to EXTRAVEHICULAR_ACTIVITY (EVA), logs suit telemetry and keeps clinical thresholds unchanged.",
  "7. Solicitud de apoyo psicológico con privacidad reforzada": "7. Psychological support request with enhanced privacy",
  "Registra una evaluación de bienestar demostrativa con solicitud de apoyo prioritario; protege las respuestas privadas frente al líder.":
    "Logs a demonstration wellness assessment with a priority support request; private answers stay protected from the leader.",
  "8. Rutina de autocuidado completada y recompensa gamificada": "8. Self-care routine completed and gamified reward",
  "Completa misiones de autocuidado e hidratación verificadas en servidor, otorgando XP e insignias sin premiar valores clínicos.":
    "Completes server-verified self-care and hydration missions, awarding XP and badges without rewarding clinical values.",
  "9. Sincronización tras interrupción de conectividad": "9. Synchronization after a connectivity outage",
  "Simula la recepción diferida de un lote de mediciones tomadas sin conexión con deduplicación garantizada y actualización de estado.":
    "Simulates delayed receipt of a batch of measurements taken offline, with guaranteed deduplication and state update.",
  // Notas de mediciones simuladas (sin el prefijo "[SIMULADO - Escenario N]")
  "Dato sintético generado por Simulador SEMSA (SIMULADO)": "Synthetic data generated by the SEMSA Simulator (SIMULATED)",
  "Medición estable dentro de límites DEMO.": "Stable measurement within DEMO limits.",
  "Sensor biométrico de muñeca desconectado. Lecturas de SpO2 y Glucosa no disponibles.":
    "Wrist biometric sensor disconnected. SpO2 and Glucose readings unavailable.",
  "Medición antigua para demostrar detección de estado STALE.": "Old measurement to demonstrate STALE state detection.",
  "Serie de tendencia ascendente para revisión preventiva.": "Upward trend series for preventive review.",
  "Serie de presión arterial en zona de seguimiento.": "Blood pressure series in the follow-up zone.",
  "Evento crítico simulado de hipoxemia operativa para demostración de escalamiento.":
    "Simulated critical operational hypoxemia event to demonstrate escalation.",
  "Taquicardia asociada en escenario de escalamiento DEMO.": "Associated tachycardia in the DEMO escalation scenario.",
  "Disminución del sueño nocturno.": "Reduced nighttime sleep.",
  "Incremento de fatiga subjetiva percibida.": "Increased subjective perceived fatigue.",
  "Hidratación fraccionada completada.": "Split hydration completed.",
  "Lectura sobre redistribución cefálica de fluidos.": "Reading on headward fluid redistribution.",
  "Sincronizado tras recuperación de enlace con clave de deduplicación.":
    "Synchronized after link recovery with a deduplication key.",
  // Resumen de eventos
  "Se registraron 12 mediciones sintéticas en estado NORMAL (etiquetadas como SIMULADO).":
    "12 synthetic measurements were recorded in NORMAL state (labeled as SIMULATED).",
  "Sensores biométricos simulados puestos en estado OFFLINE y evento de calidad de datos registrado.":
    "Simulated biometric sensors set to OFFLINE and a data quality event was logged.",
  "Serie temporal de 3 puntos generada para Frecuencia Cardíaca (hasta 98 bpm) y Presión Arterial (138/88 mmHg), activando alertas de seguimiento (MONITOR/WARNING).":
    "3-point time series generated for Heart Rate (up to 98 bpm) and Blood Pressure (138/88 mmHg), triggering follow-up alerts (MONITOR/WARNING).",
  "Alerta CRITICAL activada inmediatamente (SpO2 89%, FC 118 bpm, CO2 4.8 mmHg) con instrucciones de protocolo de emergencia y escalamiento inmediato sin depender de IA.":
    "CRITICAL alert triggered immediately (SpO2 89%, HR 118 bpm, CO2 4.8 mmHg) with emergency protocol instructions and immediate escalation, independent of AI.",
  "Registrada disminución de sueño (4.2 h) y fatiga elevada (8.2/10), activando recomendaciones de higiene del sueño y pausa de recuperación.":
    "Reduced sleep (4.2 h) and elevated fatigue (8.2/10) recorded, triggering sleep hygiene recommendations and a recovery break.",
  "Evaluación de bienestar registrada con solicitud de apoyo (SUPPORT_RECOMMENDED). La reflexión detallada permanece cifrada/privada y sólo la señal operativa autorizada es visible para el líder.":
    "Wellness assessment recorded with a support request (SUPPORT_RECOMMENDED). The detailed reflection remains encrypted/private and only the authorized operational signal is visible to the leader.",
  "Lote de 3 mediciones pendientes en cola sin conexión sincronizado correctamente sin duplicados.":
    "Batch of 3 pending offline-queue measurements synchronized successfully with no duplicates.",
  // Telemetría y contexto simulados
  "Concentración de CO₂ en Cabina": "Cabin CO₂ Concentration",
  "Estado del Traje Espacial (Presión / Soporte Vital)": "Spacesuit Status (Pressure / Life Support)",
  "Exclusa Exterior / Traje Presurizado EMU-Sim": "External Airlock / Pressurized Suit EMU-Sim",
  "Cambio de contexto ejecutado en simulador DEMO. Los límites clínicos permanecen intactos.":
    "Context change executed in the DEMO simulator. Clinical limits remain unchanged.",
  "Siento sobrecarga por el aislamiento prolongado y solicito sesión privada con el especialista de apoyo psicológico.":
    "I feel overloaded by the prolonged isolation and request a private session with the psychological support specialist.",

  /* ---------- services/cognitive_engine.py ---------- */
  // A. Visual Learning
  "A. Aprendizaje Visual (Visual Learning)": "A. Visual Learning",
  "Observar la capacidad de aprender, codificar y reconocer secuencias de patrones y símbolos visuales presentados brevemente.":
    "Observe the ability to learn, encode and recognize briefly presented sequences of visual patterns and symbols.",
  "Actividad de seguimiento operativo (DEMO). Describe el desempeño observado en reconocimiento visual; no constituye diagnóstico neuropsicológico.":
    "Operational follow-up activity (DEMO). Describes observed performance in visual recognition; it does not constitute a neuropsychological diagnosis.",
  "Codificación y Reconocimiento de Patrones Orbitales": "Orbital Pattern Encoding and Recognition",
  "1. Observe la secuencia de emblemas geométricos durante unos segundos.\n2. Al ocultarse la muestra, identifique cuál par o figura formaba parte de la secuencia original.":
    "1. Observe the sequence of geometric emblems for a few seconds.\n2. Once the sample is hidden, identify which pair or figure was part of the original sequence.",
  "Ejemplo de práctica: Si vio [▲ Azul, ● Cian, ◆ Verde], ¿cuál símbolo estaba en el centro?":
    "Practice example: If you saw [▲ Blue, ● Cyan, ◆ Green], which symbol was in the center?",
  "▲ Azul": "▲ Blue",
  "● Cian": "● Cyan",
  "■ Rojo": "■ Red",
  "★ Ámbar": "★ Amber",
  "◆ Verde": "◆ Green",
  "Muestra estudiada: [Hexágono-Alfa, Círculo-Beta, Triángulo-Gamma]. ¿Qué elemento seguía inmediatamente a Hexágono-Alfa?":
    "Studied sample: [Hexagon-Alpha, Circle-Beta, Triangle-Gamma]. Which element immediately followed Hexagon-Alpha?",
  "⬢ Alfa": "⬢ Alpha",
  "■ Épsilon": "■ Epsilon",
  "Pares asociados: [Módulo-1 → Panel Solar], [Módulo-2 → Antena], [Módulo-3 → Esclusa]. ¿Qué elemento corresponde a Módulo-2?":
    "Associated pairs: [Module-1 → Solar Panel], [Module-2 → Antenna], [Module-3 → Airlock]. Which element corresponds to Module-2?",
  "Módulo-1": "Module-1",
  "Módulo-2": "Module-2",
  "Módulo-3": "Module-3",
  "Panel Solar": "Solar Panel",
  "Antena": "Antenna",
  "Esclusa": "Airlock",
  "Radiador": "Radiator",
  "Patrón de cuadrícula aprendido: Esquina superior izquierda = Cian; Centro = Verde; Inferior derecha = Ámbar. ¿Qué color ocupaba el centro?":
    "Learned grid pattern: Top-left corner = Cyan; Center = Green; Bottom-right = Amber. Which color occupied the center?",
  "Cian": "Cyan",
  "Verde": "Green",
  "Ámbar": "Amber",
  "Violeta": "Violet",
  // B. Memory
  "B. Memoria de Trabajo y Secuencial (Memory)": "B. Working and Sequential Memory",
  "Observar la retención a corto plazo de secuencias numéricas, espaciales y simbólicas operativas.":
    "Observe short-term retention of operational numeric, spatial and symbolic sequences.",
  "Tarea de memoria de trabajo en pantalla (DEMO). Sujeta a efecto de práctica; no mide capacidad mnésica clínica global.":
    "On-screen working memory task (DEMO). Subject to practice effects; it does not measure overall clinical memory capacity.",
  "Retención de Secuencias de Telemetría y Posición": "Telemetry and Position Sequence Retention",
  "1. Memorice la secuencia de códigos y coordenadas mostrada.\n2. Reproduzca el orden exacto o el elemento solicitado sin ayudas externas.":
    "1. Memorize the sequence of codes and coordinates shown.\n2. Reproduce the exact order or the requested element without external aids.",
  "Ejemplo: Secuencia [4 - 9 - 2]. ¿Cuál es la secuencia en orden inverso?":
    "Example: Sequence [4 - 9 - 2]. What is the sequence in reverse order?",
  "Secuencia presentada: [7 - 3 - 8 - 1 - 5]. Seleccione la reproducción exacta:":
    "Sequence presented: [7 - 3 - 8 - 1 - 5]. Select the exact reproduction:",
  "Secuencia en orden INVERSO de [A2 - B5 - C9 - D4]:": "Sequence in REVERSE order of [A2 - B5 - C9 - D4]:",
  "Posiciones iluminadas en matriz 3x3: [Fila 1 Col 2] → [Fila 2 Col 3] → [Fila 3 Col 1]. ¿Cuál fue la segunda posición?":
    "Positions lit on a 3x3 matrix: [Row 1 Col 2] → [Row 2 Col 3] → [Row 3 Col 1]. What was the second position?",
  "Fila 1 Col 2": "Row 1 Col 2",
  "Fila 2 Col 3": "Row 2 Col 3",
  "Fila 3 Col 1": "Row 3 Col 1",
  "Fila 2 Col 2": "Row 2 Col 2",
  // C. Attention
  "C. Atención Selectiva y Sostenida (Attention)": "C. Selective and Sustained Attention",
  "Observar la detección de estímulos objetivo entre distractores, registrando aciertos, omisiones y variabilidad de respuesta.":
    "Observe detection of target stimuli among distractors, recording hits, omissions and response variability.",
  "Actividad de vigilancia atencional (DEMO). Sensible a fatiga puntual e iluminación ambiental.":
    "Attentional vigilance activity (DEMO). Sensitive to transient fatigue and ambient lighting.",
  "Discriminación de Estímulos Objetivo entre Distractores": "Target Stimulus Discrimination Among Distractors",
  "1. Identifique únicamente el símbolo objetivo '⊕' entre los distractores ('⊗', '⊘', '⊙').\n2. Responda con rapidez y precisión evitando falsas alarmas.":
    "1. Identify only the target symbol '⊕' among the distractors ('⊗', '⊘', '⊙').\n2. Respond quickly and accurately, avoiding false alarms.",
  "Ejemplo: En la fila [⊗  ⊕  ⊘  ⊕  ⊙], ¿cuántas veces aparece el objetivo '⊕'?":
    "Example: In the row [⊗  ⊕  ⊘  ⊕  ⊙], how many times does the target '⊕' appear?",
  "Matriz de barrido: [⊗ ⊕ ⊘ ⊙ ⊕ ⊗ ⊕ ⊘]. ¿Cuántos objetivos '⊕' están presentes?":
    "Scan matrix: [⊗ ⊕ ⊘ ⊙ ⊕ ⊗ ⊕ ⊘]. How many '⊕' targets are present?",
  "Detección de cambio en telemetría: Serie A=[101.2, 101.2, 101.2, 98.4, 101.2]. ¿En qué posición ocurre la anomalía?":
    "Telemetry change detection: Series A=[101.2, 101.2, 101.2, 98.4, 101.2]. At which position does the anomaly occur?",
  "Posición 2": "Position 2",
  "Posición 3": "Position 3",
  "Posición 4": "Position 4",
  "Sin cambio": "No change",
  "Filtro selectivo: Seleccione el único código que comienza con vocal y termina en número par:":
    "Selective filter: Select the only code that starts with a vowel and ends in an even number:",
  // D. Abstraction
  "D. Abstracción y Categorización (Abstraction)": "D. Abstraction and Categorization",
  "Observar la capacidad para identificar reglas generales, clasificar elementos y detectar el elemento discordante.":
    "Observe the ability to identify general rules, classify elements and detect the odd one out.",
  "Tarea de categorización conceptual y visual (DEMO).": "Conceptual and visual categorization task (DEMO).",
  "Clasificación de Patrones y Deducción de Reglas": "Pattern Classification and Rule Deduction",
  "1. Analice las propiedades compartidas por el conjunto de figuras o conceptos.\n2. Seleccione la regla general o el elemento que no pertenece a la categoría.":
    "1. Analyze the properties shared by the set of figures or concepts.\n2. Select the general rule or the element that does not belong to the category.",
  "Ejemplo: [Oxígeno, Nitrógeno, Dióxido de Carbono, Titanio]. ¿Cuál elemento NO pertenece a la categoría de gases atmosféricos?":
    "Example: [Oxygen, Nitrogen, Carbon Dioxide, Titanium]. Which element does NOT belong to the category of atmospheric gases?",
  "Oxígeno": "Oxygen",
  "Nitrógeno": "Nitrogen",
  "Titanio": "Titanium",
  "Dióxido de Carbono": "Carbon Dioxide",
  "Conjunto: [Triángulo (3 lados), Cuadrado (4 lados), Pentágono (5 lados), Círculo (0 lados rectos)]. ¿Cuál es el elemento discordante?":
    "Set: [Triangle (3 sides), Square (4 sides), Pentagon (5 sides), Circle (0 straight sides)]. Which is the odd element?",
  "Triángulo": "Triangle",
  "Cuadrado": "Square",
  "Pentágono": "Pentagon",
  "Círculo": "Circle",
  "Regla de clasificación: Grupo Alfa=[2, 4, 8, 16]; Grupo Beta=[3, 9, 27, 81]. ¿Qué regla define ambos grupos?":
    "Classification rule: Group Alpha=[2, 4, 8, 16]; Group Beta=[3, 9, 27, 81]. Which rule defines both groups?",
  "Progresión geométrica por potencias de la base inicial": "Geometric progression by powers of the initial base",
  "Suma constante de números primos": "Constant sum of prime numbers",
  "Alternancia de pares e impares": "Alternation of even and odd numbers",
  "División sucesiva entre 2": "Successive division by 2",
  "Complete la pareja conceptual: [Termómetro → Temperatura] es equivalente a [Dosímetro → ___]:":
    "Complete the conceptual pair: [Thermometer → Temperature] is equivalent to [Dosimeter → ___]:",
  "Presión arterial": "Blood pressure",
  "Radiación ionizante": "Ionizing radiation",
  "Humedad relativa": "Relative humidity",
  "Velocidad orbital": "Orbital velocity",
  // E. Spatial Orientation
  "E. Orientación Espacial y Rotación Mental (Spatial Orientation)": "E. Spatial Orientation and Mental Rotation",
  "Observar la comprensión de relaciones espaciales 2D/3D, rotaciones de acoplamiento y cambios de perspectiva en microgravedad.":
    "Observe understanding of 2D/3D spatial relationships, docking rotations and perspective changes in microgravity.",
  "Actividad de rotación espacial (DEMO). Útil para seguimiento durante la adaptación neuro-vestibular.":
    "Spatial rotation activity (DEMO). Useful for follow-up during neurovestibular adaptation.",
  "Rotación Mental de Módulos y Acoplamiento 3D": "Mental Rotation of Modules and 3D Docking",
  "1. Visualice el módulo espacial con su vector de referencia.\n2. Aplique mentalmente la rotación indicada (guiñada/cabeceo/alabeo) y elija la orientación resultante.":
    "1. Visualize the spacecraft module with its reference vector.\n2. Mentally apply the indicated rotation (yaw/pitch/roll) and choose the resulting orientation.",
  "Ejemplo: Si una flecha apunta al NORTE (↑) y gira 90° en sentido horario, ¿hacia dónde apunta?":
    "Example: If an arrow points NORTH (↑) and rotates 90° clockwise, where does it point?",
  "ESTE (→)": "EAST (→)",
  "SUR (↓)": "SOUTH (↓)",
  "OESTE (←)": "WEST (←)",
  "NORTE (↑)": "NORTH (↑)",
  "El puerto de acoplamiento de una nave apunta hacia ARRIBA (+Z) con el panel solar a la IZQUIERDA (-Y). Si la nave rota 180° sobre su eje longitudinal (Roll), ¿dónde queda el panel solar?":
    "A spacecraft's docking port points UP (+Z) with the solar panel on the LEFT (-Y). If the spacecraft rotates 180° about its longitudinal axis (Roll), where does the solar panel end up?",
  "A la DERECHA (+Y)": "On the RIGHT (+Y)",
  "A la IZQUIERDA (-Y)": "On the LEFT (-Y)",
  "Atrás (-X)": "Aft (-X)",
  "Forma en 'L' con brazo largo vertical hacia arriba y base hacia la derecha (└). Tras rotar 90° en sentido horario, ¿qué orientación adopta?":
    "L-shape with the long arm vertical pointing up and the base to the right (└). After rotating 90° clockwise, what orientation does it take?",
  "Brazo largo horizontal a la derecha y base hacia abajo (┌)": "Long arm horizontal to the right and base pointing down (┌)",
  "Brazo largo hacia abajo y base a la izquierda (┐)": "Long arm pointing down and base to the left (┐)",
  "Brazo largo a la izquierda y base hacia arriba (┘)": "Long arm to the left and base pointing up (┘)",
  "Permanece idéntica (└)": "Remains identical (└)",
  "Desde la cúpula de observación mirando hacia la proa (+X), el brazo robótico está a estribor (derecha). Si usted flota boca abajo (invertido 180° en eje Z) mirando hacia la misma proa (+X), ¿de qué lado percibe el brazo robótico?":
    "From the observation cupola looking toward the bow (+X), the robotic arm is to starboard (right). If you float upside down (inverted 180° about the Z axis) looking toward the same bow (+X), on which side do you perceive the robotic arm?",
  "A su izquierda subjetiva": "On your subjective left",
  "A su derecha subjetiva": "On your subjective right",
  "Detrás de usted": "Behind you",
  "Arriba del cenit": "Above the zenith",
  // F. Emotion Recognition
  "F. Reconocimiento de Expresiones en Estímulos Controlados (Emotion Recognition)":
    "F. Expression Recognition in Controlled Stimuli",
  "Evaluar la identificación de expresiones faciales esquemáticas estandarizadas para apoyar la empatía y comunicación de tripulación.":
    "Assess identification of standardized schematic facial expressions to support crew empathy and communication.",
  "AVISO ÉTICO Y CIENTÍFICO: Utiliza ilustraciones esquemáticas estandarizadas. NUNCA utiliza cámara ni reconocimiento facial sobre el usuario, ni infiere el estado emocional real o personalidad del astronauta.":
    "ETHICAL AND SCIENTIFIC NOTICE: Uses standardized schematic illustrations. It NEVER uses the camera or facial recognition on the user, nor does it infer the astronaut's actual emotional state or personality.",
  "Identificación de Expresiones en Estímulos Visuales Controlados": "Expression Identification in Controlled Visual Stimuli",
  "1. Observe la ilustración esquemática estandarizada descrita.\n2. Seleccione la etiqueta emocional que mejor corresponde a los rasgos visuales del estímulo.":
    "1. Observe the standardized schematic illustration described.\n2. Select the emotional label that best matches the visual features of the stimulus.",
  "Ejemplo: Ilustración con comisuras labiales elevadas en arco y arrugas perioculares suaves. ¿Qué expresión representa el estímulo?":
    "Example: Illustration with mouth corners raised in an arc and soft periocular wrinkles. What expression does the stimulus represent?",
  "Alegría / Calma positiva": "Joy / Positive calm",
  "Ira": "Anger",
  "Sorpresa": "Surprise",
  "Miedo": "Fear",
  "Estímulo controlado #1: Cejas arqueadas y elevadas simétricamente, párpados ampliamente abiertos y boca ovalada relajada.":
    "Controlled stimulus #1: Eyebrows arched and symmetrically raised, eyelids wide open and a relaxed oval mouth.",
  "Sorpresa / Alerta súbita": "Surprise / Sudden alertness",
  "Tristeza": "Sadness",
  "Enojo": "Annoyance",
  "cansancio": "tiredness",
  "Estímulo controlado #2: Cejas fruncidas hacia el centro e inclinadas hacia abajo, mirada fija y labios tensos comprimidos.":
    "Controlled stimulus #2: Eyebrows furrowed toward the center and slanted downward, fixed gaze and tense, compressed lips.",
  "Tensión / Frustración": "Tension / Frustration",
  "Alegría": "Joy",
  "Neutralidad": "Neutrality",
  "Somnolencia": "Drowsiness",
  "Estímulo controlado #3: Extremos internos de las cejas elevados, párpados superiores ligeramente caídos y comisuras de la boca descendidas.":
    "Controlled stimulus #3: Inner ends of the eyebrows raised, upper eyelids slightly drooping and mouth corners turned down.",
  "Tristeza / Abatimiento": "Sadness / Dejection",
  "Entusiasmo": "Enthusiasm",
  // G. Abstract Reasoning
  "G. Razonamiento Abstracto y Lógico (Abstract Reasoning)": "G. Abstract and Logical Reasoning",
  "Observar la resolución de problemas de series lógicas, matrices de relaciones y deducción secuencial.":
    "Observe problem solving with logical series, relationship matrices and sequential deduction.",
  "Tarea de razonamiento lógico (DEMO). No representa un cociente intelectual ni diagnóstico clínico.":
    "Logical reasoning task (DEMO). It does not represent an intelligence quotient or a clinical diagnosis.",
  "Matrices Lógicas y Series de Símbolos": "Logic Matrices and Symbol Series",
  "1. Examine cómo cambian los elementos en cada fila y columna de la serie.\n2. Deduzca la pieza que completa lógicamente la matriz.":
    "1. Examine how the elements change in each row and column of the series.\n2. Deduce the piece that logically completes the matrix.",
  "Ejemplo: Serie [1, 4, 9, 16, ?]. ¿Qué número completa la serie de cuadrados perfectos?":
    "Example: Series [1, 4, 9, 16, ?]. Which number completes the series of perfect squares?",
  "Matriz lógica: Fila 1=[1 círculo, 2 círculos, 3 círculos]; Fila 2=[2 triángulos, 4 triángulos, 6 triángulos]; Fila 3=[3 rombos, 6 rombos, ?]:":
    "Logic matrix: Row 1=[1 circle, 2 circles, 3 circles]; Row 2=[2 triangles, 4 triangles, 6 triangles]; Row 3=[3 rhombuses, 6 rhombuses, ?]:",
  "7 rombos": "7 rhombuses",
  "8 rombos": "8 rhombuses",
  "9 rombos": "9 rhombuses",
  "12 rombos": "12 rhombuses",
  "Serie simbólica: [A1-Z, B2-Y, C3-X, D4-W, ?]. ¿Cuál es el siguiente término?":
    "Symbolic series: [A1-Z, B2-Y, C3-X, D4-W, ?]. What is the next term?",
  "Deducción condicional: Si (Soporte Vital Nominal ⇒ Presión = 101 kPa) y actualmente (Presión ≠ 101 kPa), ¿qué conclusión lógica es válida?":
    "Conditional deduction: If (Life Support Nominal ⇒ Pressure = 101 kPa) and currently (Pressure ≠ 101 kPa), which logical conclusion is valid?",
  "El Soporte Vital NO está en estado Nominal": "Life Support is NOT in Nominal state",
  "La temperatura ha subido": "The temperature has risen",
  "El Soporte Vital está Nominal": "Life Support is Nominal",
  "No se puede deducir nada": "Nothing can be deduced",
  // H. Complex Exploration
  "H. Exploración Compleja y Toma de Decisiones (Complex Exploration)": "H. Complex Exploration and Decision-Making",
  "Observar la planificación de rutas, priorización de múltiples objetivos y adaptación ante restricciones cambiantes.":
    "Observe route planning, prioritization of multiple objectives and adaptation to changing constraints.",
  "Escenario interactivo de planificación operativa (DEMO).": "Interactive operational planning scenario (DEMO).",
  "Planificación de Ruta Lunar Multi-Objetivo": "Multi-Objective Lunar Route Planning",
  "1. Analice el mapa de nodos lunares, consumo de reserva de O₂ y prioridades.\n2. Seleccione la secuencia de decisiones que cumple los objetivos sin agotar márgenes de seguridad.":
    "1. Analyze the lunar node map, O₂ reserve consumption and priorities.\n2. Select the decision sequence that meets the objectives without depleting safety margins.",
  "Ejemplo: Dispone de 30 min de reserva. Ruta A tarda 18 min y Ruta B tarda 35 min. ¿Cuál ruta respeta el margen de seguridad?":
    "Example: You have 30 min of reserve. Route A takes 18 min and Route B takes 35 min. Which route respects the safety margin?",
  "Ruta A (18 min)": "Route A (18 min)",
  "Ruta B (35 min)": "Route B (35 min)",
  "Ambas": "Both",
  "Ninguna": "Neither",
  "Escenario Lunar: Usted está en Base Selene con 100 unidades de energía. Debe recolectar Muestra Geológica (Nodo Norte: costo 30), reparar Sensor Solar (Nodo Este: costo 25) y regresar a Esclusa (costo 25). Evite el Cráter Sombra (costo 60). ¿Cuál ruta completa ambos objetivos dentro del límite?":
    "Lunar scenario: You are at Selene Base with 100 energy units. You must collect a Geological Sample (North Node: cost 30), repair the Solar Sensor (East Node: cost 25) and return to the Airlock (cost 25). Avoid Shadow Crater (cost 60). Which route completes both objectives within the limit?",
  "Base → Nodo Norte → Nodo Este → Esclusa (Total: 80 u)": "Base → North Node → East Node → Airlock (Total: 80 u)",
  "Base → Cráter Sombra → Nodo Norte → Esclusa (Total: 115 u)": "Base → Shadow Crater → North Node → Airlock (Total: 115 u)",
  "Base → Cráter Sombra → Nodo Este → Esclusa (Total: 110 u)": "Base → Shadow Crater → East Node → Airlock (Total: 110 u)",
  "Permanecer sin recolectar muestras": "Stay put without collecting samples",
  "Cambio dinámico en exploración: A mitad de ruta se detecta incremento de radiación solar. ¿Qué secuencia de decisión prioriza la seguridad según protocolo?":
    "Dynamic change during exploration: Midway along the route, an increase in solar radiation is detected. Which decision sequence prioritizes safety per protocol?",
  "Guardar coordenada actual, suspender recolección secundaria y dirigirse al refugio presurizado más cercano":
    "Save the current coordinate, suspend secondary collection and head to the nearest pressurized shelter",
  "Acelerar hacia el punto más lejano sin avisar a Tierra": "Speed toward the farthest point without notifying Earth",
  "Apagar el dosímetro para ahorrar batería": "Turn off the dosimeter to save battery",
  "Ignorar el aviso hasta terminar todos los objetivos": "Ignore the warning until all objectives are completed",
  "Optimización de recursos en mapa de 4 sectores: Sector 1 (Agua +20), Sector 2 (Sin datos), Sector 3 (Antena +15), Sector 4 (Tormenta de polvo).Si solo puede visitar 2 sectores seguros para maximizar recursos y comunicaciones:":
    "Resource optimization on a 4-sector map: Sector 1 (Water +20), Sector 2 (No data), Sector 3 (Antenna +15), Sector 4 (Dust storm). If you can only visit 2 safe sectors to maximize resources and communications:",
  "Sector 1 y Sector 3": "Sector 1 and Sector 3",
  "Sector 2 y Sector 4": "Sector 2 and Sector 4",
  "Sector 1 y Sector 4": "Sector 1 and Sector 4",
  "Sector 3 y Sector 4": "Sector 3 and Sector 4",
  // I. Visual Tracking
  "I. Seguimiento Visual Interactivo en Pantalla (Visual Tracking)": "I. Interactive On-Screen Visual Tracking",
  "Observar la capacidad de seguir objetos en movimiento e identificar sus trayectorias y posiciones finales.":
    "Observe the ability to follow moving objects and identify their trajectories and final positions.",
  "IMPORTANTE: Seguimiento visual interactivo basado en pantalla (mouse/teclado/táctil). NO equivale a una medición clínica oculomotora ni utiliza hardware de eye-tracking.":
    "IMPORTANT: Interactive screen-based visual tracking (mouse/keyboard/touch). It is NOT equivalent to a clinical oculomotor measurement and does not use eye-tracking hardware.",
  "Seguimiento de Objetivos Orbitales en Movimiento (Basado en Pantalla)": "Tracking of Moving Orbital Targets (Screen-Based)",
  "1. Siga visualmente el marcador objetivo en la zona de simulación.\n2. Indique el cuadrante o marcador final al detenerse el movimiento.":
    "1. Visually follow the target marker in the simulation area.\n2. Indicate the final quadrant or marker when the movement stops.",
  "Ejemplo: El satélite Alfa inicia en el Cuadrante I, se desplaza hacia abajo al Cuadrante IV y luego a la izquierda al Cuadrante III. ¿Dónde terminó?":
    "Example: Satellite Alpha starts in Quadrant I, moves down to Quadrant IV and then left to Quadrant III. Where did it end up?",
  "Cuadrante I": "Quadrant I",
  "Cuadrante II": "Quadrant II",
  "Cuadrante III": "Quadrant III",
  "Cuadrante IV": "Quadrant IV",
  "Rastreo de 2 objetos: Sonda-1 (inicia en X=10, Y=20; velocidad +15 en X, +5 en Y por segundo durante 2 s). ¿Cuál es la posición final de Sonda-1?":
    "Tracking 2 objects: Probe-1 (starts at X=10, Y=20; velocity +15 in X, +5 in Y per second for 2 s). What is Probe-1's final position?",
  "Cruce de trayectorias en pantalla: Tres balizas (A, B, C) rotan 90° en sentido antihorario alrededor del centro. Si 'A' estaba ARRIBA (Norte), ¿en qué posición final se detiene 'A'?":
    "On-screen crossing trajectories: Three beacons (A, B, C) rotate 90° counterclockwise around the center. If 'A' was at the TOP (North), at which final position does 'A' stop?",
  "IZQUIERDA (Oeste)": "LEFT (West)",
  "DERECHA (Este)": "RIGHT (East)",
  "ABAJO (Sur)": "DOWN (South)",
  "ARRIBA (Norte)": "UP (North)",
  "Seguimiento multi-objetivo: El marcador Objetivo-Alfa se mueve [Centro → Superior-Derecha → Inferior-Derecha → Centro-Izquierda]. ¿Cuál fue su última posición?":
    "Multi-target tracking: The Target-Alpha marker moves [Center → Top-Right → Bottom-Right → Center-Left]. What was its last position?",
  "Centro-Izquierda": "Center-Left",
  "Inferior-Derecha": "Bottom-Right",
  "Superior-Derecha": "Top-Right",
  "Centro": "Center",
  // Alerta cognitiva
  "Revisar horas de sueño recientes y considerar una pausa de recuperación neurocognitiva.":
    "Review recent sleep hours and consider a neurocognitive recovery break.",
  "Repetir la actividad en condiciones descansadas cuando el protocolo lo indique.":
    "Repeat the activity under rested conditions when the protocol indicates.",

  /* ---------- services/emotional_engine.py ---------- */
  "PROTOCOLO URGENTE DE ACOMPAÑAMIENTO ACTIVO: 1. Su solicitud prioritaria de apoyo ha sido activada de inmediato.\n2. Establezca contacto directo mediante el canal privado prioritario con el Oficial Médico de Tripulación (CMO) o el especialista de soporte en Tierra.\n3. Suspenda tareas operativas exigentes y priorice su seguridad y acompañamiento.":
    "URGENT SUPPORT PROTOCOL ACTIVE: 1. Your priority support request has been activated immediately.\n2. Establish direct contact through the priority private channel with the Crew Medical Officer (CMO) or the ground support specialist.\n3. Suspend demanding operational tasks and prioritize your safety and support.",
  "Cuestionario emocional en borrador (pendiente de envío final).": "Emotional questionnaire in draft (final submission pending).",
  "Tus respuestas parciales se han guardado de forma privada. Puedes continuar cuando lo desees.":
    "Your partial answers have been saved privately. You can continue whenever you wish.",
  "Completar las preguntas pendientes a tu propio ritmo.": "Complete the pending questions at your own pace.",
  "Sin respuestas registradas.": "No answers recorded.",
  "No se encontraron respuestas evaluables.": "No assessable answers were found.",
  "Iniciar el cuestionario o solicitar acompañamiento directo.": "Start the questionnaire or request direct support.",
  "Señal operativa URGENT_SUPPORT activada por regla de protocolo DEMO. Requiere contacto prioritario de acompañamiento (respuestas detalladas protegidas).":
    "URGENT_SUPPORT operational signal triggered by a DEMO protocol rule. Requires priority support contact (detailed answers protected).",
  "Gracias por responder con confianza. Hemos activado de inmediato las instrucciones de apoyo prioritario para que cuentes con acompañamiento oportuno.":
    "Thank you for answering openly. We have immediately activated the priority support instructions so you receive timely support.",
  "Tu cuestionario emocional fue registrado de forma privada. Se ha generado una señal de acompañamiento para facilitar el contacto con el equipo de apoyo.":
    "Your emotional questionnaire was recorded privately. A support signal has been generated to facilitate contact with the support team.",
  "Pide apoyo desde Bienestar (check-in emocional) o coméntalo con tu especialista de apoyo en el próximo contacto con Tierra.":
    "Ask for support from Wellbeing (emotional check-in) or talk it over with your support specialist at the next contact with Earth.",
  "Accede al Wellness Center o abre un canal privado en Communication Center con tu líder o especialista.":
    "Go to the Wellness Center or open a private channel in the Communication Center with your leader or specialist.",
  "Estado operativo EMOTIONAL_WELLNESS_MONITORING: se recomienda seguimiento preventivo de descanso y carga operativa.":
    "Operational state EMOTIONAL_WELLNESS_MONITORING: preventive follow-up of rest and operational workload is recommended.",
  "Se observan algunas dimensiones de carga o cansancio que vale la pena acompañar con pausas de recuperación.":
    "Some workload or tiredness dimensions are observed that are worth supporting with recovery breaks.",
  "Revisar en Bienestar los recursos de descanso, respiración guiada y tiempo libre, y mantener el contacto social autorizado.":
    "Review the rest, guided breathing and free-time resources in Wellbeing, and keep up authorized social contact.",
  "Revisar recursos de descanso, respiración guiada y contacto social autorizado en el Wellness Center.":
    "Review rest, guided breathing and authorized social contact resources in the Wellness Center.",
  "Estado operativo EMOTIONAL_WELLNESS_STABLE: cuestionario completado dentro de parámetros habituales.":
    "Operational state EMOTIONAL_WELLNESS_STABLE: questionnaire completed within usual parameters.",
  "Tu registro emocional quedó guardado de forma privada. Continúa con tus rutinas habituales de autocuidado y descanso.":
    "Your emotional check-in was saved privately. Continue with your usual self-care and rest routines.",
  "Mantener las pautas de descanso, recreación y comunicación periódica.":
    "Maintain rest, recreation and regular communication guidelines.",
  "Generada desde My Emotional Check-In": "Generated from My Emotional Check-In",
  "Coordinar acompañamiento privado respetando las preferencias de confidencialidad del astronauta.":
    "Coordinate private support while respecting the astronaut's confidentiality preferences.",

  /* ---------- rules/early_warnings.py: alerta temprana "Contacto con Tierra" ---------- */
  "[ALERTA TEMPRANA] Contacto con Tierra recomendado": "[EARLY WARNING] Contact with Earth recommended",
  "Alerta temprana: los check-ins de Bienestar de los últimos días muestran señales repetidas de riesgo de aislamiento. El programa de investigación humana de la NASA (HRP) señala el aislamiento y el confinamiento como un riesgo para el ánimo, el sueño y la convivencia; el apoyo de los seres queridos es uno de los recursos que más lo amortiguan. Los valores individuales (ánimo, aislamiento, notas) son privados y no se muestran en esta alerta.":
    "Early warning: the Wellbeing check-ins of the last few days show repeated signs of isolation risk. NASA's Human Research Program (HRP) identifies isolation and confinement as a risk to mood, sleep and getting along with others; support from loved ones is one of the things that cushions it most. Individual values (mood, isolation, notes) are private and are not shown in this alert.",
  "Alerta temprana: el cuestionario emocional registró preocupación en la dimensión de aislamiento. El programa de investigación humana de la NASA (HRP) señala el aislamiento y el confinamiento como un riesgo para el ánimo, el sueño y la convivencia; el apoyo de los seres queridos es uno de los recursos que más lo amortiguan. Las respuestas individuales son privadas y no se muestran en esta alerta.":
    "Early warning: the emotional questionnaire recorded concern in the isolation dimension. NASA's Human Research Program (HRP) identifies isolation and confinement as a risk to mood, sleep and getting along with others; support from loved ones is one of the things that cushions it most. Individual answers are private and are not shown in this alert.",
  "Recomendación: reserva hoy un momento para el contacto con tus seres queridos y con tu equipo en Tierra. Lo más adecuado es un canal asíncrono (notas de voz, chat o fotos del día a día) que se entrega cuando hay enlace; la propuesta está en la pestaña Recomendaciones: «Canal de comunicación con Tierra y con la familia».":
    "Recommendation: set aside a moment today for contact with your loved ones and your team on Earth. The best fit is an asynchronous channel (voice notes, chat or everyday photos) delivered when there is a link; the proposal is in the Recommendations tab: “Communication channel with Earth and family”.",
  "Sin videollamadas: con el retardo de la comunicación una conversación en directo resulta frustrante. Repite el check-in de Bienestar en 24 h; si las señales continúan, coméntalo con tu especialista de apoyo en el próximo contacto con Tierra.":
    "No video calls: with the communication delay, a live conversation becomes frustrating. Repeat the Wellbeing check-in in 24 h; if the signs continue, talk it over with your support specialist at the next contact with Earth.",

  /* ---------- api/v1/router.py ---------- */
  // Catálogo de regiones corporales (BODY_REGIONS_CATALOG)
  "Cabeza, Cerebro y Ritmo Circadiano": "Head, Brain and Circadian Rhythm",
  "Regulación neurocognitiva, control autonómico, equilibrio vestibular, vigilia y arquitectura del sueño.":
    "Neurocognitive regulation, autonomic control, vestibular balance, wakefulness and sleep architecture.",
  "Desplazamiento cefálico de fluidos en microgravedad, alteración del ciclo circadiano por órbitas rápidas o iluminación artificial, cinetosis espacial y fatiga cognitiva por aislamiento.":
    "Headward fluid shift in microgravity, circadian disruption from rapid orbits or artificial lighting, space motion sickness and cognitive fatigue from isolation.",
  "Mantener rutina de higiene circadiana pre-sueño, pausas cognitivas programadas y registro honesto de fatiga antes de actividades críticas.":
    "Maintain a pre-sleep circadian hygiene routine, scheduled cognitive breaks and honest fatigue reporting before critical activities.",
  "Ojos y Sistema Neuro-Ocular": "Eyes and Neuro-Ocular System",
  "Agudeza visual, acomodación, presión intraocular y transmisión óptica al córtex visual.":
    "Visual acuity, accommodation, intraocular pressure and optical transmission to the visual cortex.",
  "Síndrome Neuro-Ocular Asociado a Vuelos Espaciales (SANS) por congestión venosa cefálica, irritación por partículas de polvo lunar/marciano y fosfenos por radiación cósmica.":
    "Spaceflight-Associated Neuro-ocular Syndrome (SANS) from cephalic venous congestion, irritation from lunar/Martian dust particles and phosphenes from cosmic radiation.",
  "Vigilar presión arterial y niveles de CO₂ ambiental en cabina, realizar pausas visuales de enfoque lejano y usar protección ocular post-EVA.":
    "Monitor blood pressure and cabin ambient CO₂ levels, take distance-focus visual breaks and use eye protection post-EVA.",
  "Corazón y Sistema Cardiovascular": "Heart and Cardiovascular System",
  "Bombeo hemodinámico, perfusión tisular, regulación barorrefleja y transporte de oxígeno.":
    "Hemodynamic pumping, tissue perfusion, baroreflex regulation and oxygen transport.",
  "Redistribución de ~2 litros de fluido hacia el tórax al entrar en microgravedad, disminución del volumen plasmático, remodelado cardíaco e intolerancia ortostática al regresar a gravedad.":
    "Redistribution of ~2 liters of fluid toward the thorax on entering microgravity, reduced plasma volume, cardiac remodeling and orthostatic intolerance on return to gravity.",
  "Completar sesiones aeróbicas autorizadas, mantener hidratación estructurada y registrar pulso y presión arterial en reposo.":
    "Complete authorized aerobic sessions, maintain structured hydration and record resting pulse and blood pressure.",
  "Pulmones y Sistema Respiratorio": "Lungs and Respiratory System",
  "Intercambio alveolar de oxígeno (O₂) y eliminación de dióxido de carbono (CO₂).":
    "Alveolar exchange of oxygen (O₂) and removal of carbon dioxide (CO₂).",
  "Homogeneización de ventilación-perfusión en microgravedad, exposición a bolsas de CO₂ en compartimentos mal ventilados, descompresión en EVA e inhalación accidental de polvo regolítico.":
    "Ventilation-perfusion homogenization in microgravity, exposure to CO₂ pockets in poorly ventilated compartments, decompression during EVA and accidental inhalation of regolith dust.",
  "Verificar estado de ventilación ECLSS, supervisar SpO₂ y frecuencia respiratoria, y ejecutar protocolos de descontaminación de trajes.":
    "Verify ECLSS ventilation status, monitor SpO₂ and respiratory rate, and execute suit decontamination protocols.",
  "Sistema Inmunológico y Hematopoyético (Área Funcional Ilustrativa)":
    "Immune and Hematopoietic System (Illustrative Functional Area)",
  "Defensa frente a patógenos, vigilancia celular, hematopoyesis y respuesta inflamatoria.":
    "Defense against pathogens, cellular surveillance, hematopoiesis and inflammatory response.",
  "Disregulación inmunitaria inducida por estrés, reactivación de virus latentes en confinamiento y daño hematopoyético/celular por radiación cósmica galáctica y eventos solares.":
    "Stress-induced immune dysregulation, reactivation of latent viruses in confinement and hematopoietic/cellular damage from galactic cosmic radiation and solar events.",
  "Monitorear dosimetría personal de radiación, asegurar descanso reparador, nutrición equilibrada y manejo del estrés.":
    "Monitor personal radiation dosimetry and ensure restorative rest, balanced nutrition and stress management.",
  "Sistema Digestivo, Metabólico y Renal": "Digestive, Metabolic and Renal System",
  "Absorción de nutrientes, homeostasis glucémica, balance hidroelectrolítico y excreción renal.":
    "Nutrient absorption, glucose homeostasis, fluid-electrolyte balance and renal excretion.",
  "Enlentecimiento del tránsito gastrointestinal inicial, resistencia subclínica a la insulina y riesgo elevado de litiasis renal por hipercalciuria e hipohidratación.":
    "Initial slowing of gastrointestinal transit, subclinical insulin resistance and elevated risk of kidney stones from hypercalciuria and hypohydration.",
  "Cumplir la meta diaria de hidratación (Hydration Routine), fraccionar la ingesta de líquidos y registrar glucosa cuando el protocolo lo indique.":
    "Meet the daily hydration goal (Hydration Routine), split fluid intake and record glucose when the protocol indicates.",
  "Huesos y Sistema Esquelético": "Bones and Skeletal System",
  "Soporte estructural biomecánico, protección visceral y reservorio mineral de calcio y fósforo.":
    "Biomechanical structural support, visceral protection and mineral reservoir of calcium and phosphorus.",
  "Desmineralización ósea acelerada (1–1.5% mensual en cadera y columna lumbar) por ausencia de carga gravitatoria mecánica.":
    "Accelerated bone demineralization (1–1.5% per month in the hip and lumbar spine) due to the absence of gravitational mechanical loading.",
  "Realizar cargas resistivas autorizadas (ARED/Move Safely), mantener ingesta hídrica para proteger el riñón del calcio movilizado y evitar cargas bruscas al reingreso.":
    "Perform authorized resistive loading (ARED/Move Safely), maintain fluid intake to protect the kidneys from mobilized calcium and avoid abrupt loads on reentry.",
  "Músculos y Sistema Locomotor": "Muscles and Locomotor System",
  "Generación de fuerza contráctil, control postural antigravitatorio y locomoción en superficie o EVA.":
    "Contractile force generation, antigravity postural control and locomotion on the surface or during EVA.",
  "Atrofia de fibras musculares posturales (sóleo, cuádriceps, paravertebrales) y fatiga muscular de tren superior durante operaciones en traje presurizado.":
    "Atrophy of postural muscle fibers (soleus, quadriceps, paraspinals) and upper-body muscle fatigue during pressurized-suit operations.",
  "Completar la rutina diaria de actividad física autorizada y alternar grupos musculares con periodos de recuperación.":
    "Complete the authorized daily physical activity routine and alternate muscle groups with recovery periods.",
  "Piel y Termorregulación": "Skin and Thermoregulation",
  "Barrera epitelial protectora, sensibilidad táctil y disipación térmica por sudoración y vasodilatación.":
    "Protective epithelial barrier, tactile sensitivity and heat dissipation through sweating and vasodilation.",
  "Menor disipación convectiva del calor en microgravedad, sequedad o abrasión cutánea por baja humedad y puntos de fricción dentro del traje EVA.":
    "Reduced convective heat dissipation in microgravity, skin dryness or abrasion from low humidity and friction points inside the EVA suit.",
  "Vigilar temperatura corporal antes y después del ejercicio o EVA, revisar humedad ambiental del hábitat e hidratar la piel.":
    "Monitor body temperature before and after exercise or EVA, check habitat ambient humidity and moisturize the skin.",
  "Estado General y Bienestar Psicosocial": "General Condition and Psychosocial Wellbeing",
  "Integración mente-cuerpo, regulación emocional, motivación, cohesión de tripulación y resiliencia.":
    "Mind-body integration, emotional regulation, motivation, crew cohesion and resilience.",
  "Aislamiento y confinamiento, distancia visual y comunicativa de la Tierra, sobrecarga de trabajo y monotonía sensorial.":
    "Isolation and confinement, visual and communication distance from Earth, work overload and sensory monotony.",
  "Usar Bienestar (check-in privado, cuestionarios y respiración guiada), mantener enlaces familiares autorizados y solicitar apoyo sin estigma.":
    "Use Wellbeing (private check-in, questionnaires and guided breathing), maintain authorized family links and request support without stigma.",
  "Utilizar el Wellness Center privado, practicar respiración guiada, mantener enlaces familiares autorizados y solicitar apoyo sin estigma.":
    "Use the private Wellness Center, practice guided breathing, maintain authorized family links and request support without stigma.",
  // Auth / usuarios
  "Sesión cerrada correctamente.": "Signed out successfully.",
  "Si el correo está registrado, se ha generado el token de recuperación.":
    "If the email is registered, a recovery token has been generated.",
  "Contraseña actualizada correctamente.": "Password updated successfully.",
  "Especialista de Misión": "Mission Specialist",
  "Sin restricciones operativas": "No operational restrictions",
  "Asignación registrada correctamente.": "Assignment recorded successfully.",
  // Resumen de salud / silueta
  "La silueta corporal es una herramienta interactiva de navegación y educación; no diagnostica enfermedades por sí misma.":
    "The body silhouette is an interactive navigation and education tool; it does not diagnose diseases by itself.",
  "Sin datos": "No data",
  "Sin historial suficiente": "Insufficient history",
  "Estable frente a medición previa": "Stable vs previous measurement",
  "Única medición disponible": "Only one measurement available",
  "SEMSA no calcula un 'porcentaje de salud total' arbitrario. Se presentan estados operativos verificables por indicador e índices de participación en autocuidado.":
    "SEMSA does not compute an arbitrary 'total health percentage'. Verifiable operational states are shown per indicator, along with self-care participation indices.",
  // Mediciones
  "Medición previamente sincronizada (duplicado evitado).": "Measurement already synchronized (duplicate prevented).",
  "Medición dentro de los límites configurados. Continúe con su plan preventivo habitual.":
    "Measurement within configured limits. Continue with your usual preventive plan.",
  "El JSON debe contener una lista de objetos de medición.": "The JSON must contain a list of measurement objects.",
  "Formato no soportado. Use JSON o CSV.": "Unsupported format. Use JSON or CSV.",
  "Importado por lote CSV/JSON": "Imported via CSV/JSON batch",
  // Bienestar
  "El astronauta configuró privacidad reforzada para este registro.":
    "The astronaut configured enhanced privacy for this record.",
  "Vista operativa autorizada: las respuestas detalladas y reflexiones personales están protegidas por defecto.":
    "Authorized operational view: detailed answers and personal reflections are protected by default.",
  "Chequeo de bienestar completado (recompensa por participación, independiente del estado emocional).":
    "Wellness check completed (participation reward, independent of emotional state).",
  "Actividad de bienestar registrada correctamente.": "Wellness activity recorded successfully.",
  // Gamificación / contramedidas
  "Las recompensas reconocen la participación, el aprendizaje y la constancia en el autocuidado. Nunca se otorgan puntos por signos vitales 'normales' ni se penaliza por reportar síntomas o restricciones de misión.":
    "Rewards recognize participation, learning and consistency in self-care. Points are never awarded for 'normal' vital signs, and reporting symptoms or mission restrictions is never penalized.",
  "Contramedida en pausa por seguridad: hay una alerta de precaución o aviso activa. Resuélvela con tu líder o regístrala como excusada por restricción operativa.":
    "Countermeasure paused for safety: there is an active caution or warning alert. Resolve it with your leader or log it as excused due to an operational restriction.",
  // Analítica / informes
  "Las mediciones separadas por intervalos prolongados incluyen marcadores explícitos de discontinuidad. La asociación temporal con fases o cambios ambientales no implica causalidad directa.":
    "Measurements separated by long intervals include explicit discontinuity markers. Temporal association with phases or environmental changes does not imply direct causality.",
  "SIMULADO — Datos sintéticos de demostración": "SIMULATED — Synthetic demonstration data",
  "SEMSA ayuda a observar, comprender, registrar y comunicar información sobre la salud. No diagnostica de manera autónoma ni reemplaza al personal médico.":
    "SEMSA helps observe, understand, record and communicate health information. It does not diagnose autonomously or replace medical personnel.",
  "Datos sintéticos de demostración reiniciados de forma segura (los datos reales se conservan intactos).":
    "Synthetic demonstration data safely reset (real data is preserved intact).",
  "SIMULADO": "SIMULATED",
  // Auditoría (estáticos)
  "Inicio de sesión exitoso.": "Successful sign-in.",
  "Sesión cerrada y revocada correctamente.": "Session closed and revoked successfully.",
  "Token temporal de recuperación generado.": "Temporary recovery token generated.",
  "Contraseña restablecida y sesiones previas revocadas.": "Password reset and previous sessions revoked.",
  "Perfil / preferencias de privacidad actualizadas.": "Profile / privacy preferences updated.",

  /* ---------- api/v1/expansion_router.py ---------- */
  "PROTOCOLO DE EMERGENCIA DE VUELO ACTIVO: El Communication Center complementa pero NO reemplaza el canal prioritario de emergencia médica/operativa. Contacte de inmediato al Oficial Médico de Tripulación (CMO) y a Dirección de Vuelo por bucle de voz prioritario.":
    "FLIGHT EMERGENCY PROTOCOL ACTIVE: The Communication Center complements but does NOT replace the priority medical/operational emergency channel. Contact the Crew Medical Officer (CMO) and Flight Director immediately via the priority voice loop.",
  "[Contenido privado 1-a-1 protegido por política de confidencialidad]":
    "[Private 1-to-1 content protected by confidentiality policy]",
  "Revisión de mensajes de misión en Communication Center.": "Review of mission messages in the Communication Center.",
  "Adjunto operativo verificado": "Verified operational attachment",
  "Establecer contacto prioritario de inmediato.": "Establish priority contact immediately.",
  "Las actividades cognitivas de SEMSA registran métricas específicas por dominio (aciertos, errores, omisiones y tiempo de respuesta) comparadas únicamente con la línea base personal del mismo dominio, dificultad y versión. No calculan un puntaje global único de capacidad mental ni diagnostican deterioro cognitivo.":
    "SEMSA cognitive activities record domain-specific metrics (correct answers, errors, omissions and response time) compared only against the personal baseline for the same domain, difficulty and version. They do not compute a single global mental capacity score or diagnose cognitive impairment.",
  "Evaluación pospuesta sin penalización. Podrás retomarla cuando tus condiciones de descanso u operación lo permitan.":
    "Assessment postponed with no penalty. You can resume it when your rest or operational conditions allow.",
  "Sólo deben compararse directamente resultados obtenidos con la misma prueba, el mismo dominio, la misma dificultad y la misma versión.":
    "Only results obtained with the same test, domain, difficulty and version should be compared directly.",
  "SEMSA presenta métricas longitudinales separadas por dominio cognitivo. No combina dominios distintos en un 'puntaje de inteligencia' o 'capacidad mental total' y advierte explícitamente el efecto de práctica por repetición.":
    "SEMSA presents longitudinal metrics separated by cognitive domain. It does not combine different domains into an 'intelligence score' or 'total mental capacity', and explicitly flags the practice effect from repetition.",
  "Resumen operativo restringido por preferencia de privacidad del astronauta.":
    "Operational summary restricted by the astronaut's privacy preference.",
  "Recordatorio de Cuestionario Emocional": "Emotional Questionnaire Reminder",
  "Tienes un cuestionario emocional disponible en My Emotional Check-In.":
    "You have an emotional questionnaire available in My Emotional Check-In.",
  "Cuestionario emocional completado (recompensa por participación).":
    "Emotional questionnaire completed (participation reward).",
  "Canal directo sincronizado": "Direct channel synchronized",
  "Ninguno": "None",
  "Evaluación específica por dominio (sin puntaje global único).": "Domain-specific assessment (no single global score).",
  "Evaluación específica por dominio (sin puntaje global único ni diagnóstico médico).":
    "Domain-specific assessment (no single global score or medical diagnosis).",
  "Respuestas individuales protegidas con privacidad reforzada.": "Individual answers protected with enhanced privacy.",
  "La frecuencia de mensajes es un indicador puramente operativo de coordinación; no constituye una métrica psicológica ni un indicador de productividad.":
    "Message frequency is a purely operational coordination indicator; it is not a psychological metric or a productivity indicator.",
  "Series separadas por dominio cognitivo. La variación temporal puede reflejar efecto de práctica, fatiga puntual o cambio de entorno; asociación temporal no implica causalidad directa.":
    "Series separated by cognitive domain. Temporal variation may reflect practice effects, transient fatigue or an environment change; temporal association does not imply direct causality.",
  "Se muestran únicamente estados operativos de cumplimiento y seguimiento sin exponer respuestas privadas.":
    "Only operational completion and follow-up states are shown, without exposing private answers.",
  // Auditoría (estáticos)
  "Intento de acceso administrativo a conversación privada sin justificación explícita.":
    "Administrative access attempt to a private conversation without explicit justification.",
  "El administrador no puede leer conversaciones privadas silenciosamente sin justificación de auditoría.":
    "The administrator cannot silently read private conversations without an audit justification.",
  "Intento de lectura de respuestas detalladas emocionales denegado por política de privacidad.":
    "Attempt to read detailed emotional answers denied by privacy policy.",
  "El líder de misión sólo visualiza señales operativas autorizadas, no respuestas individuales.":
    "The mission leader only sees authorized operational signals, not individual answers.",

  /* ---------- Mensajes de error HTTP (detail) ---------- */
  "Usuario no encontrado.": "User not found.",
  "Solicitud no encontrada.": "Request not found.",
  "Misión no encontrada.": "Mission not found.",
  "Evaluación cognitiva no encontrada.": "Cognitive assessment not found.",
  "Alerta no encontrada.": "Alert not found.",
  "Conversación no encontrada.": "Conversation not found.",
  "Solicitud de cuestionario emocional no encontrada.": "Emotional questionnaire request not found.",
  "Prueba cognitiva no encontrada.": "Cognitive test not found.",
  "Prueba cognitiva no encontrada para el dominio.": "Cognitive test not found for the domain.",
  "No autorizado.": "Not authorized.",
  "Mensaje no encontrado.": "Message not found.",
  "Indicador no encontrado.": "Indicator not found.",
  "Indicador de salud no encontrado.": "Health indicator not found.",
  "Evaluación emocional no encontrada.": "Emotional assessment not found.",
  "Dominio cognitivo no encontrado.": "Cognitive domain not found.",
  "Credenciales inválidas.": "Invalid credentials.",
  "Token de recuperación inválido o expirado.": "Invalid or expired recovery token.",
  "Solo puede responder su propio cuestionario emocional.": "You can only answer your own emotional questionnaire.",
  "Solo puede registrar sus propias mediciones.": "You can only record your own measurements.",
  "Solo puede registrar su propia evaluación de bienestar.": "You can only record your own wellness assessment.",
  "Solo puede posponer su propia evaluación.": "You can only postpone your own assessment.",
  "Solo puede finalizar su propio cuestionario emocional.": "You can only complete your own emotional questionnaire.",
  "Solo puede finalizar su propia evaluación.": "You can only complete your own assessment.",
  "Solo puede enviar respuestas a su propia evaluación.": "You can only submit answers to your own assessment.",
  "Solo puede editar su propio perfil o ser Administrador.": "You can only edit your own profile unless you are an Administrator.",
  "Solo el líder destinatario puede gestionar esta solicitud.": "Only the recipient leader can manage this request.",
  "Solo el líder destinatario puede escribir la respuesta.": "Only the recipient leader can write the response.",
  "Solo el destinatario puede marcar un mensaje como no leído.": "Only the recipient can mark a message as unread.",
  "Solo el destinatario puede confirmar la lectura de un mensaje.": "Only the recipient can confirm reading a message.",
  "Solo el astronauta y el líder asignado pueden escribir o modificar mensajes en esta conversación privada.":
    "Only the astronaut and the assigned leader can write or modify messages in this private conversation.",
  "Solo el astronauta destinatario puede iniciar este cuestionario.": "Only the recipient astronaut can start this questionnaire.",
  "Solicitud de apoyo no encontrada.": "Support request not found.",
  "Rol no válido.": "Invalid role.",
  "Rol no encontrado.": "Role not found.",
  "Regla no encontrada.": "Rule not found.",
  "Perfil ambiental no reconocido.": "Environment profile not recognized.",
  "No se encontró líder asignado a la misión.": "No leader assigned to the mission was found.",
  "No hay líder en tierra asignado a esta misión.": "There is no ground leader assigned to this mission.",
  "No hay astronautas asignados.": "There are no assigned astronauts.",
  "Medición no encontrada.": "Measurement not found.",
  "Indique astronaut_id y leader_id.": "Provide astronaut_id and leader_id.",
  "Formato no soportado. Use PDF, CSV o JSON.": "Unsupported format. Use PDF, CSV or JSON.",
  "Este botón de solicitud directa está destinado a los astronautas.": "This direct request button is intended for astronauts.",
  "Estado no válido.": "Invalid status.",
  "El líder en tierra sólo puede ver el resumen operativo autorizado, nunca las respuestas detalladas privadas.":
    "The ground leader can only see the authorized operational summary, never the private detailed answers.",
  "El código de tripulación ya existe.": "The crew code already exists.",
  "El código de misión ya existe.": "The mission code already exists.",
  "El correo electrónico ya está registrado.": "The email address is already registered.",
  "El astronauta solo puede cerrar su propia solicitud.": "The astronaut can only close their own request.",
  "Debe indicar el astronauta destinatario.": "You must specify the recipient astronaut.",
  "Cuestionario emocional no encontrado.": "Emotional questionnaire not found.",
  "Cuenta bloqueada temporalmente por múltiples intentos fallidos. Intente más tarde.":
    "Account temporarily locked after multiple failed attempts. Try again later.",
  "Archivo importado excede el tamaño máximo permitido (250 KB).": "Imported file exceeds the maximum allowed size (250 KB).",
  "Administración tiene acceso de solo lectura a las solicitudes de apoyo.": "Administration has read-only access to support requests.",
  "Acceso denegado: solo el astronauta y el líder asignado pueden acceder a esta conversación privada.":
    "Access denied: only the astronaut and the assigned leader can access this private conversation.",
  "Acceso denegado.": "Access denied.",
  "Privacidad de Comunicaciones: El administrador no puede acceder silenciosamente a conversaciones privadas 1-a-1 sin autorización y justificación explícita registrada en auditoría.":
    "Communications Privacy: The administrator cannot silently access private 1-to-1 conversations without authorization and an explicit justification recorded in the audit log.",
  "Privacidad Emocional Reforzada: El administrador puede gestionar solicitudes y ver el estado operativo de cumplimiento, pero no puede inspeccionar respuestas detalladas sin consentimiento del astronauta y justificación explícita de auditoría.":
    "Enhanced Emotional Privacy: The administrator can manage requests and view the operational completion status, but cannot inspect detailed answers without the astronaut's consent and an explicit audit justification.",
};

/* =========================================================================
   PATTERNS  (anclados; los más específicos primero)
   ========================================================================= */
export const PATTERNS = [
  /* ---------- rules/engine.py: títulos de alerta ---------- */
  // Emotional engine: "[STATE] Seguimiento de Cuestionario Emocional (#12)"
  [/^\[([A-Z_]+)\] Seguimiento de Cuestionario Emocional \(#(\d+)\)$/,
    (m) => `[${m[1]}] Emotional Questionnaire Follow-up (#${m[2]})`],
  // Cognitive engine: "[MONITOR] Variación observada en tarea cognitiva (MEMORY)"
  [/^\[([A-Z_]+)\] Variación observada en tarea cognitiva \(([^)]+)\)$/,
    (m) => `[${m[1]}] Observed variation in cognitive task (${m[2]})`],
  // Expansion router: "[CRITICAL] Solicitud de Apoyo Urgente: <motivo escrito por el usuario>"
  [/^\[([A-Z_]+)\] Solicitud de Apoyo Urgente: (.*)$/,
    (m) => `[${m[1]}] Urgent Support Request: ${m[2]}`],
  // Engine: "[WARNING] Frecuencia Cardíaca: 115 bpm" / "[CRITICAL] Presión Arterial: 150/100 mmHg"
  [/^\[([A-Z_]+)\] (.+?): ([-+]?[\d.,]+(?:\/[-+]?[\d.,]+)?)(?: (.+))?$/,
    (m, bt) => `[${m[1]}] ${bt(m[2])}: ${m[3]}${m[4] ? " " + u(m[4]) : ""}`],

  /* ---------- rules/engine.py: explicación de alerta ---------- */
  // "<motivos> (Regla: RULE_X v1.0-DEMO — <fuente>). Nota: Esta alerta es ..."
  [/^(.*?)\s*\(Regla: (\S+) v(\S+) — (.+)\)\. Nota: Esta alerta es una señal operativa preventiva y no constituye un diagnóstico médico\.$/,
    (m, bt) =>
      `${m[1] ? sentences(m[1], bt) + " " : ""}(Rule: ${m[2]} v${m[3]} — ${bt(m[4])}). ` +
      "Note: This alert is a preventive operational signal and does not constitute a medical diagnosis."],

  /* ---------- rules/engine.py: motivos de evaluación / calidad de datos ---------- */
  [/^Valor \(([-+]?[\d.,]+) (.*?)\) fuera de los límites físicos de validación \[([-+]?[\d.,]+) - ([-+]?[\d.,]+)\]\.$/,
    (m) => `Value (${m[1]} ${u(m[2])}) outside the physical validation limits [${m[3]} - ${m[4]}].`],
  [/^Presión diastólica \(([-+]?[\d.,]+) mmHg\) inválida respecto a sistólica \(([-+]?[\d.,]+) mmHg\)\.$/,
    (m) => `Diastolic pressure (${m[1]} mmHg) invalid relative to systolic (${m[2]} mmHg).`],
  [/^Valor ([-+]?[\d.,]+) (.*?) supera el umbral crítico del protocolo (\S+) \(([^)]+)\) \[([-+]?[\d.,]+) - ([-+]?[\d.,]+)\]\.$/,
    (m) => `Value ${m[1]} ${u(m[2])} exceeds the critical threshold of protocol ${m[3]} (${m[4]}) [${m[5]} - ${m[6]}].`],
  [/^Valor ([-+]?[\d.,]+) (.*?) requiere seguimiento según protocolo (\S+) \(([^)]+)\) \[([-+]?[\d.,]+) - ([-+]?[\d.,]+)\]\.$/,
    (m) => `Value ${m[1]} ${u(m[2])} requires follow-up per protocol ${m[3]} (${m[4]}) [${m[5]} - ${m[6]}].`],
  [/^Valor ([-+]?[\d.,]+) (.*?) fuera del rango habitual de referencia \[([-+]?[\d.,]+) - ([-+]?[\d.,]+)\]\.$/,
    (m) => `Value ${m[1]} ${u(m[2])} outside the usual reference range [${m[3]} - ${m[4]}].`],
  [/^Presión diastólica \(([-+]?[\d.,]+) mmHg\) en rango crítico de protocolo DEMO\.$/,
    (m) => `Diastolic pressure (${m[1]} mmHg) in the DEMO protocol critical range.`],
  [/^Presión diastólica \(([-+]?[\d.,]+) mmHg\) en rango de alerta de seguimiento\.$/,
    (m) => `Diastolic pressure (${m[1]} mmHg) in the follow-up alert range.`],
  [/^Presión diastólica \(([-+]?[\d.,]+) mmHg\) en zona de observación\.$/,
    (m) => `Diastolic pressure (${m[1]} mmHg) in the observation zone.`],
  [/^Cambio significativo \(([-+]?[\d.,]+) (.*?)\) respecto a la línea base individual \(([-+]?[\d.,]+) (.*?)\)\.$/,
    (m) => `Significant change (${m[1]} ${u(m[2])}) from the individual baseline (${m[3]} ${u(m[4])}).`],
  [/^Discrepancia detectada entre fuentes \((\S+): ([-+]?[\d.,]+) vs (\S+): ([-+]?[\d.,]+) (.*?)\) en ventana <15 min\.$/,
    (m) => `Source discrepancy detected (${m[1]}: ${m[2]} vs ${m[3]}: ${m[4]} ${u(m[5])}) within a <15 min window.`],
  [/^Contradicción entre fuentes \((\S+) vs (\S+)\); se recomienda confirmar medición\.$/,
    (m) => `Source contradiction (${m[1]} vs ${m[2]}); confirming the measurement is recommended.`],
  [/^Dentro de los límites operativos configurados \[([-+]?[\d.,]+) - ([-+]?[\d.,]+) (.*?)\]\.$/,
    (m) => `Within the configured operational limits [${m[1]} - ${m[2]} ${u(m[3])}].`],
  [/^Medición con antigüedad superior a ([-+]?[\d.,]+) h \(([-+]?[\d.,]+) h\)\.$/,
    (m) => `Measurement older than ${m[1]} h (${m[2]} h).`],

  /* ---------- rules/evaluation.py + rules/engine.py: motor calibrado con el dataset (2.0-DATASET) ---------- */
  // Acción inmediata de una alerta: "1. <paso del indicador> 2. Nivel ...: <paso del nivel>" (rules/recommendations.py)
  [/^(1\. .+?) (2\. Nivel (?:de observación|de seguimiento|crítico): .+)$/,
    (m, bt) => `${bt(m[1])}\n${bt(m[2])}`],
  // Umbral absoluto de la diastólica (mismo texto que el del valor principal)
  [/^Presión diastólica ([-+]?[\d.,]+) (.*?) supera el umbral crítico del protocolo (\S+) \(([^)]+)\) \[([-+]?[\d.,]+) - ([-+]?[\d.,]+)\]\.$/,
    (m) => `Diastolic pressure ${m[1]} ${u(m[2])} exceeds the critical threshold of protocol ${m[3]} (${m[4]}) [${m[5]} - ${m[6]}].`],
  [/^Presión diastólica ([-+]?[\d.,]+) (.*?) requiere seguimiento según protocolo (\S+) \(([^)]+)\) \[([-+]?[\d.,]+) - ([-+]?[\d.,]+)\]\.$/,
    (m) => `Diastolic pressure ${m[1]} ${u(m[2])} requires follow-up per protocol ${m[3]} (${m[4]}) [${m[5]} - ${m[6]}].`],
  // Capa personal: z frente a la línea base de la persona
  [/^(Valor|Presión diastólica) ([-+]?[\d.,]+) (.*?): sin línea base personal válida, se aplica solo el umbral absoluto\.$/,
    (m) => `${lbl(m[1])} ${m[2]} ${u(m[3])}: no valid personal baseline, only the absolute threshold applies.`],
  [/^(Valor|Presión diastólica) ([-+]?[\d.,]+) (.*?): además se aleja de la línea base personal \(z = ([-+]?[\d.,]+); línea base ([-+]?[\d.,]+) ± ([\d.,]+) (.*?)\)\.$/,
    (m) => `${lbl(m[1])} ${m[2]} ${u(m[3])}: it is also far from the personal baseline (z = ${m[4]}; baseline ${m[5]} ± ${m[6]} ${u(m[7])}).`],
  [/^(Valor|Presión diastólica) ([-+]?[\d.,]+) (.*?): es habitual para esta persona \(z = ([-+]?[\d.,]+); línea base ([-+]?[\d.,]+) ± ([\d.,]+) (.*?)\) y queda en observación\.$/,
    (m) => `${lbl(m[1])} ${m[2]} ${u(m[3])}: usual for this person (z = ${m[4]}; baseline ${m[5]} ± ${m[6]} ${u(m[7])}), kept under observation.`],
  [/^(Valor|Presión diastólica) ([-+]?[\d.,]+) (.*?): desvío fuerte frente a la línea base personal \(([-+]?[\d.,]+) ± ([\d.,]+) (.*?); z = ([-+]?[\d.,]+); umbral \|z\| ≥ ([\d.,]+)\)\.$/,
    (m) => `${lbl(m[1])} ${m[2]} ${u(m[3])}: strong deviation from the personal baseline (${m[4]} ± ${m[5]} ${u(m[6])}; z = ${m[7]}; threshold |z| ≥ ${m[8]}).`],
  [/^(Valor|Presión diastólica) ([-+]?[\d.,]+) (.*?): desvío frente a la línea base personal confirmado en dos lecturas seguidas \(([-+]?[\d.,]+) ± ([\d.,]+) (.*?); z = ([-+]?[\d.,]+); umbral \|z\| ≥ ([\d.,]+)\)\.$/,
    (m) => `${lbl(m[1])} ${m[2]} ${u(m[3])}: deviation from the personal baseline confirmed in two consecutive readings (${m[4]} ± ${m[5]} ${u(m[6])}; z = ${m[7]}; threshold |z| ≥ ${m[8]}).`],
  [/^(Valor|Presión diastólica) ([-+]?[\d.,]+) (.*?): desvío aislado frente a la línea base personal \(z = ([-+]?[\d.,]+)\); queda pendiente de confirmar con la próxima lectura\.$/,
    (m) => `${lbl(m[1])} ${m[2]} ${u(m[3])}: isolated deviation from the personal baseline (z = ${m[4]}); pending confirmation with the next reading.`],
  // Sueño: regla sobre la media de 7 noches
  [/^Se evalúa la media de las últimas (\d+) noches \(([-+]?[\d.,]+) (.*?)\); la última noche fue de ([-+]?[\d.,]+) (.*?)\.$/,
    (m) => `The average of the last ${m[1]} nights is evaluated (${m[2]} ${u(m[3])}); the last night was ${m[4]} ${u(m[5])}.`],
  [/^Noche aislada de ([-+]?[\d.,]+) (.*?), por debajo de ([-+]?[\d.,]+) (.*?): la regla usa la media de (\d+) noches y aún hay menos de (\d+) registros, así que queda en observación\.$/,
    (m) => `Single night of ${m[1]} ${u(m[2])}, below ${m[3]} ${u(m[4])}: the rule uses the ${m[5]}-night average and there are still fewer than ${m[6]} records, so it is kept under observation.`],
  [/^Aún hay menos de (\d+) noches registradas en los últimos (\d+) días: la media de sueño se evaluará cuando haya más registros\.$/,
    (m) => `There are still fewer than ${m[1]} nights logged in the last ${m[2]} days: the sleep average will be evaluated once there are more records.`],
  // Radiación: dosis acumulada frente al límite de carrera
  [/^Dosis acumulada registrada de ([-+]?[\d.,]+) mSv: ([-+]?[\d.,]+) % del límite de carrera de ([\d.,]+) mSv \(umbral ([\d.,]+) %\)\.$/,
    (m) => `Recorded cumulative dose of ${m[1]} mSv: ${m[2]} % of the ${m[3]} mSv career limit (threshold ${m[4]} %).`],
  // Alerta abierta que se actualiza con una lectura menos grave
  [/^Última lectura en nivel ([A-Z]+); la alerta se mantiene en ([A-Z]+) hasta que se resuelva\.$/,
    (m) => `Latest reading at ${m[1]} level; the alert stays at ${m[2]} until it is resolved.`],

  /* ---------- services/ai_assistant.py ---------- */
  [/^En los últimos (\d+) registros válidos, el indicador se observa (.+?) \(rango observado: ([-+]?[\d.,]+)–([-+]?[\d.,]+) (.+?), media: ([-+]?[\d.,]+) (.+?)\)\.(?: (.*))?$/,
    (m, bt) =>
      `Over the last ${m[1] === "1" ? "valid record" : m[1] + " valid records"}, the indicator shows ${trendDesc(m[2])} ` +
      `(observed range: ${m[3]}–${m[4]} ${u(m[5])}, mean: ${m[6]} ${u(m[7])}).` +
      (m[8] ? " " + bt(m[8]) : "")],
  [/^con variación ascendente descriptiva \(([-+]?[\d.,]+) (.+?) en (\d+) registros\)$/,
    (m) => `with a descriptive upward variation (${m[1]} ${u(m[2])} over ${m[3]} records)`],
  [/^con variación descendente descriptiva \(([-+]?[\d.,]+) (.+?) en (\d+) registros\)$/,
    (m) => `with a descriptive downward variation (${m[1]} ${u(m[2])} over ${m[3]} records)`],
  [/^Comparado con la línea base individual pre-misión \(([-+]?[\d.,]+) (.+?)\), el último registro presenta una diferencia de ([-+]?[\d.,]+) (.+?)\.$/,
    (m) => `Compared with the individual pre-mission baseline (${m[1]} ${u(m[2])}), the latest record shows a difference of ${m[3]} ${u(m[4])}.`],
  [/^Entorno actual \((.+?), gravedad (.+?)\): (.*)$/,
    (m, bt) => `Current environment (${bt(m[1])}, gravity ${bt(m[2])}): ${bt(m[3])}`],
  [/^Suprimida automáticamente por precaución: existe una alerta operativa activa \((.+)\)\. Priorice el protocolo médico antes de ejercicio físico\.$/,
    (m, bt) => `Automatically suppressed as a precaution: there is an active operational alert (${bt(m[1])}). Prioritize the medical protocol before physical exercise.`],

  /* ---------- services/gamification.py ---------- */
  [/^Completaste una sesión interactiva del dominio (\S+)\.$/,
    (m) => `You completed an interactive session in the ${m[1]} domain.`],
  [/^Misión diaria '(.+)' no encontrada o inactiva\.$/,
    (m) => `Daily mission '${m[1]}' not found or inactive.`],

  /* ---------- services/simulator.py ---------- */
  [/^\[SIMULADO - Escenario (\d+)\] (.+)$/,
    (m, bt) => `[SIMULATED - Scenario ${m[1]}] ${bt(m[2])}`],
  [/^\[CONFIDENCIAL - DEMO\] (.+)$/,
    (m, bt) => `[CONFIDENTIAL - DEMO] ${bt(m[1])}`],
  [/^Módulo (\S+)$/, (m) => `Module ${m[1]}`],
  [/^Contexto actualizado a (\S+) con fuente DEMO_SIMULATION\. Los umbrales clínicos de referencia se conservaron sin alteración automática\.$/,
    (m) => `Context updated to ${m[1]} with source DEMO_SIMULATION. Clinical reference thresholds were preserved with no automatic change.`],
  [/^Rutinas de autocuidado y aprendizaje completadas \(\+(\d+) XP verificados en backend\)\.$/,
    (m) => `Self-care and learning routines completed (+${m[1]} XP verified by the backend).`],
  [/^Escenario de demostración '(.+)' no reconocido\.$/,
    (m) => `Demo scenario '${m[1]}' not recognized.`],

  /* ---------- services/cognitive_engine.py ---------- */
  [/^Intento #(\d+) en dificultad (\S+) \(v([^)]+)\)\. Nota metodológica: La mejora progresiva en precisión o tiempo puede reflejar el efecto de práctica \(familiaridad con la tarea\) y sólo es comparable con evaluaciones del mismo dominio, dificultad y versión\.$/,
    (m) => `Attempt #${m[1]} at ${m[2]} difficulty (v${m[3]}). Methodological note: Progressive improvement in accuracy or time may reflect the practice effect (familiarity with the task) and is only comparable with assessments of the same domain, difficulty and version.`],
  [/^Desempeño observado en (\S+) \((\S+)\): (\d+)\/(\d+) aciertos \(([-+]?[\d.,]+)%\), tiempo medio de respuesta ([-+]?[\d.,]+) ms \(variabilidad ±([-+]?[\d.,]+) ms\)\. Condición reportada al iniciar: (\S+)\. Este resultado describe la ejecución en una actividad específica y no constituye un diagnóstico neuropsicológico\.$/,
    (m) => `Observed performance in ${m[1]} (${m[2]}): ${m[3]}/${m[4]} correct (${m[5]}%), mean response time ${m[6]} ms (variability ±${m[7]} ms). Condition reported at start: ${m[8]}. This result describes performance on a specific activity and does not constitute a neuropsychological diagnosis.`],
  [/^Se observó una variación respecto a la línea base comparable en (\S+) \(([-+]?[\d.,]+)% vs base ([-+]?[\d.,]+)%\)\. No representa un diagnóstico clínico; se sugiere revisar descanso, fatiga y condiciones de realización\.$/,
    (m) => `A variation from the comparable baseline was observed in ${m[1]} (${m[2]}% vs baseline ${m[3]}%). This is not a clinical diagnosis; reviewing rest, fatigue and test conditions is suggested.`],

  /* ---------- services/emotional_engine.py ---------- */
  [/^Estado operativo (\S+): el tripulante solicitó contacto de apoyo o registró dimensiones que ameritan seguimiento preventivo autorizado\.$/,
    (m) => `Operational state ${m[1]}: the crew member requested support contact or reported dimensions that warrant authorized preventive follow-up.`],
  [/^(.+?) Nota de privacidad: Las respuestas individuales y comentarios abiertos permanecen confidenciales y no se exponen en esta alerta\.$/,
    (m, bt) => `${bt(m[1])} Privacy note: Individual answers and open comments remain confidential and are not exposed in this alert.`],

  /* ---------- api/v1/router.py ---------- */
  [/^([-+]?[\d.,]+) (.*?) frente a anterior$/,
    (m) => `${m[1]} ${u(m[2])} vs previous`],
  [/^(\d+)\/(\d+) rutinas hoy \(Indicador de participación, no medida médica\)$/,
    (m) => `${m[1]}/${m[2]} routines today (participation indicator, not a medical measure)`],
  [/^Registro validado de (.+)$/, (m, bt) => `Validated record of ${bt(m[1])}`],
  [/^Reconocimiento de alerta #(\d+)$/, (m) => `Alert acknowledgment #${m[1]}`],
  [/^Fase Inicial \((.+)\)$/, (m) => `Initial Phase (${m[1]})`],
  [/^La cuenta se encuentra (\S+)\. Contacte al administrador\.$/,
    (m) => `The account is ${m[1]}. Contact the administrator.`],
  [/^Estado inválido\. Use uno de: (.+)$/, (m) => `Invalid status. Use one of: ${m[1]}`],
  [/^Error al procesar archivo importado: (.*)$/, (m) => `Error processing imported file: ${m[1]}`],
  // Auditoría
  [/^Intento de inicio de sesión con correo no registrado: (.+)$/,
    (m) => `Sign-in attempt with unregistered email: ${m[1]}`],
  [/^Cuenta en estado (\S+) intentó iniciar sesión\.$/, (m) => `Account in ${m[1]} status attempted to sign in.`],
  [/^Contraseña incorrecta \(intento #(\d+)\)\.$/, (m) => `Incorrect password (attempt #${m[1]}).`],
  [/^Usuario '(.+)' creado con rol '(.+)'\.$/, (m) => `User '${m[1]}' created with role '${m[2]}'.`],
  [/^Estado de cuenta cambiado de (\S+) a (\S+)\.$/, (m) => `Account status changed from ${m[1]} to ${m[2]}.`],
  [/^Rol modificado de (\S+) a (\S+)\.$/, (m) => `Role changed from ${m[1]} to ${m[2]}.`],
  [/^Misión '(.+)' creada\.$/, (m) => `Mission '${m[1]}' created.`],
  [/^Usuario (\S+) vinculado a misión (\S+) como (\S+)\.$/,
    (m) => `User ${m[1]} linked to mission ${m[2]} as ${m[3]}.`],
  [/^Entorno cambiado a (\S+) \(Fase: (\S+), Fuente: (\S+)\)\. Los límites clínicos NO fueron alterados\.$/,
    (m) => `Environment changed to ${m[1]} (Phase: ${m[2]}, Source: ${m[3]}). Clinical limits were NOT altered.`],
  [/^Importados (\d+) registros \((\S+)\), inválidos=(\d+), alertas=(\d+)\.$/,
    (m) => `Imported ${m[1]} records (${m[2]}), invalid=${m[3]}, alerts=${m[4]}.`],
  [/^Alerta #(\d+) reconocida: (.*)$/, (m) => `Alert #${m[1]} acknowledged: ${m[2]}`],
  [/^Seguimiento \((\S+)\) en alerta #(\d+): (.*)$/, (m) => `Follow-up (${m[1]}) on alert #${m[2]}: ${m[3]}`],
  [/^Alerta #(\d+) escalada a equipo médico: (.*)$/, (m) => `Alert #${m[1]} escalated to the medical team: ${m[2]}`],
  [/^Informe exportado en formato (\S+) para astronauta (\S+) en misión (\S+)\.$/,
    (m) => `Report exported in ${m[1]} format for astronaut ${m[2]} on mission ${m[3]}.`],
  [/^Escenario DEMO '(.+)' ejecutado \(SIMULADO\)\.$/, (m) => `DEMO scenario '${m[1]}' executed (SIMULATED).`],
  [/^Escenario sintético DEMO reiniciado de forma segura: (.*)$/,
    (m) => `Synthetic DEMO scenario safely reset: ${m[1]}`],
  [/^Nueva versión auditada (\S+) para (\S+) aprobada por '(.*)'\.$/,
    (m) => `New audited version ${m[1]} for ${m[2]} approved by '${m[3]}'.`],

  /* ---------- api/v1/expansion_router.py ---------- */
  [/^Nuevo mensaje \(([^)]+)\) de (.+)$/, (m) => `New message (${m[1]}) from ${m[2]}`],
  [/^Nuevo cuestionario emocional solicitado \(([^)]+)\)$/,
    (m) => `New emotional questionnaire requested (${m[1]})`],
  [/^Se ha solicitado completar '(.+)'\.$/, (m, bt) => `You have been asked to complete '${bt(m[1])}'.`],
  [/^Canal Directo: (.+) ↔ (.+)$/, (m) => `Direct Channel: ${m[1]} ↔ ${m[2]}`],
  // Mensaje automático al crear una solicitud de apoyo (motivo y descripción son texto del usuario: se conservan)
  // f"[SOLICITUD DE APOYO #{id} — {reason_title}] {description} {'(Conversación privada solicitada)' | ''}"
  [/^\[SOLICITUD DE APOYO #(\d+) — (.*?)\](?: (.*?))?(?: ?\(Conversación privada solicitada\))?$/,
    (m) => {
      const priv = /\(Conversación privada solicitada\)$/.test(m[0]);
      const desc = m[3] ? ` ${m[3]}` : "";
      return `[SUPPORT REQUEST #${m[1]} — ${m[2]}]${desc}${priv ? " (Private conversation requested)" : ""}`;
    }],
  [/^El astronauta (.+) activó una solicitud de apoyo urgente en Communication Center\.$/,
    (m) => `Astronaut ${m[1]} activated an urgent support request in the Communication Center.`],
  [/^(\d+) mensaje\(s\) sin leer$/, (m) => `${m[1]} unread message${m[1] === "1" ? "" : "s"}`],
  [/^Seguimiento de solicitud de apoyo #(\d+)$/, (m) => `Support request follow-up #${m[1]}`],
  [/^Actividad cognitiva completada en dominio (\S+)\.$/, (m) => `Cognitive activity completed in domain ${m[1]}.`],
  [/^Entrenamiento de memoria \((\S+)\)\.$/, (m) => `Memory training (${m[1]}).`],
  [/^Entrenamiento de atención visual \((\S+)\)\.$/, (m) => `Visual attention training (${m[1]}).`],
  // Auditoría
  [/^Acceso administrativo justificado a conversación #(\d+)\.$/,
    (m) => `Justified administrative access to conversation #${m[1]}.`],
  [/^Acceso administrativo auditado a conversación #(\d+)\.$/,
    (m) => `Audited administrative access to conversation #${m[1]}.`],
  [/^Usuario (\S+) \((\S+)\) intentó acceder a conversación no asignada #(\d+)\.$/,
    (m) => `User ${m[1]} (${m[2]}) attempted to access unassigned conversation #${m[3]}.`],
  [/^Usuario \((\S+)\) no participante intentó (.+) en la conversación #(\d+)\.$/,
    (m) => `Non-participant user (${m[1]}) attempted ${m[2]} in conversation #${m[3]}.`],
  [/^Solicitud de apoyo #(\d+) actualizada a (\S+)\.$/, (m) => `Support request #${m[1]} updated to ${m[2]}.`],
  [/^Acceso auditado autorizado por el astronauta a respuestas emocionales de solicitud #(\d+)\.$/,
    (m) => `Audited access authorized by the astronaut to emotional answers for request #${m[1]}.`],
  [/^Creadas (\d+) solicitudes de cuestionario emocional para astronautas (.+)\.$/,
    (m) => `Created ${m[1]} emotional questionnaire requests for astronauts ${m[2]}.`],
  [/^Seguimiento operativo \((\S+)\) registrado en solicitud emocional #(\d+)\.$/,
    (m) => `Operational follow-up (${m[1]}) recorded on emotional request #${m[2]}.`],
];
