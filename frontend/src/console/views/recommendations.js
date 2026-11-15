/* Consola · vista "Recomendaciones" (issue #15)
 *
 * Último módulo de la barra de pestañas. Reúne, en cuadros desplegables, las mejoras que se
 * recomiendan para versiones futuras de la app: integrar biometría continua y el resto de
 * instrumentos de medida, comunicación con Tierra (sustituye al antiguo módulo "Mensajes"),
 * analítica, seguridad y operación autónoma.
 *
 * - Contenido estático y bilingüe (es / en) en un único DICT resuelto con tr(DICT).
 * - Cada cuadro es un <details class="av-fold"> (mismo patrón plegable que la vista Radiación);
 *   el estado abierto se conserva al repintar (cambio de idioma o nueva visita).
 * - No llama a la API: nada de lo descrito existe todavía en la app.
 */
import { tr } from "../../i18n/i18n.js";
import { esc } from "./more-common.js";

const DICT = {
  es: {
    title: "Recomendaciones",
    subtitle: "Mejoras propuestas para próximas versiones, con más tiempo de desarrollo y la integración de todos los instrumentos de medida",
    intro: "Nada de lo que aparece aquí está implementado todavía. Cada cuadro explica qué aportaría la mejora, qué haría falta para construirla y en qué plazo se recomienda.",
    expandAll: "Desplegar todo",
    collapseAll: "Plegar todo",
    countLabel: "{n} recomendaciones",
    benefitH: "Qué aporta",
    needsH: "Qué se necesita",
    horizonLbl: "Plazo",
    horizon: { SHORT: "Corto plazo", MID: "Medio plazo", LONG: "Largo plazo" },
    area: {
      BIO: "Biometría",
      MED: "Equipamiento médico",
      RAD: "Radiación",
      ENV: "Entorno",
      COMMS: "Comunicación",
      DATA: "Analítica",
      SEC: "Seguridad",
      OPS: "Operación",
    },
    items: [
      {
        id: "wearables",
        area: "BIO",
        horizon: "SHORT",
        title: "Biometría continua con dispositivos vestibles",
        summary: "Captar de forma automática las constantes que hoy se registran a mano.",
        benefit: [
          "Frecuencia cardiaca, variabilidad (VFC), SpO₂, temperatura cutánea y frecuencia respiratoria en continuo.",
          "Actigrafía para medir sueño y actividad sin depender del autoinforme.",
          "Detección temprana de tendencias entre dos mediciones manuales.",
        ],
        needs: [
          "Brazalete o camiseta con sensores validados para microgravedad.",
          "Sincronización a bordo (Bluetooth de baja energía) y cola de envío sin enlace.",
          "Reglas de calidad de señal para descartar lecturas con artefactos.",
        ],
      },
      {
        id: "medical-devices",
        area: "MED",
        horizon: "MID",
        title: "Integración de los instrumentos médicos de a bordo",
        summary: "Que tensiómetro, ECG, ecógrafo y analizadores envíen sus datos directamente.",
        benefit: [
          "Menos errores de transcripción en Registrar medición.",
          "ECG de 12 derivaciones y ecografía guiada adjuntos al registro del tripulante.",
          "Analítica de sangre y orina en el punto de atención con su historial.",
        ],
        needs: [
          "Conectores por dispositivo y un formato común de intercambio (por ejemplo, HL7 FHIR).",
          "Calibración y trazabilidad de cada equipo.",
          "Validación con el equipo de medicina de vuelo.",
        ],
      },
      {
        id: "dosimetry",
        area: "RAD",
        horizon: "SHORT",
        title: "Dosimetría personal en tiempo real",
        summary: "Un dosímetro activo por tripulante conectado a la vista Radiación.",
        benefit: [
          "Dosis individual en lugar de una estimación por módulo.",
          "Avisos de refugio más precisos al cruzar el flujo de protones (NOAA) con la dosis medida.",
          "Seguimiento de la dosis acumulada frente a los límites de carrera.",
        ],
        needs: [
          "Dosímetros activos con interfaz de datos.",
          "Modelo de blindaje por zona del hábitat.",
        ],
      },
      {
        id: "cabin-sensors",
        area: "ENV",
        horizon: "MID",
        title: "Sensores ambientales de cabina",
        summary: "CO₂, ruido, luz, temperatura y humedad relacionados con el sueño y el rendimiento.",
        benefit: [
          "Explicar alertas fisiológicas con causas del entorno (por ejemplo, CO₂ alto y cefalea).",
          "Recomendar ajustes de iluminación y horarios para proteger el sueño.",
          "Enriquecer la vista Entornos con datos medidos y no solo de referencia.",
        ],
        needs: [
          "Acceso a la telemetría del sistema de soporte vital del hábitat.",
          "Correlación temporal entre entorno y registros de cada tripulante.",
        ],
      },
      {
        id: "earth-channel",
        area: "COMMS",
        horizon: "MID",
        title: "Canal de comunicación con Tierra y con la familia",
        summary: "Retomar la mensajería, retirada en esta versión, como un canal asíncrono pensado para el retardo.",
        benefit: [
          "Mensajes de voz, texto y fotos que se envían en la próxima ventana de enlace.",
          "Contacto con el equipo de apoyo y con seres queridos frente al aislamiento.",
          "Indicación clara del retardo estimado y del estado de entrega.",
        ],
        needs: [
          "Infraestructura de mensajería tolerante a interrupciones (store-and-forward).",
          "Cifrado de extremo a extremo y reglas de privacidad acordadas con la tripulación.",
          "Sin videollamadas en directo: con retardo resultan frustrantes.",
        ],
      },
      {
        id: "predictive",
        area: "DATA",
        horizon: "LONG",
        title: "Modelos predictivos personalizados",
        summary: "Pasar de la regresión y el puntaje Z actuales a modelos entrenados con más datos por persona.",
        benefit: [
          "Líneas base individuales que se ajustan a lo largo de la misión.",
          "Predicción de riesgo (pérdida ósea y muscular, alteraciones del sueño, fatiga) con antelación.",
          "Explicación de cada predicción para que el médico de vuelo pueda revisarla.",
        ],
        needs: [
          "Volumen de datos suficiente de misiones análogas y reales.",
          "Validación clínica y control de sesgos antes de usarlos en decisiones.",
        ],
      },
      {
        id: "security",
        area: "SEC",
        horizon: "SHORT",
        title: "Seguridad, privacidad y cumplimiento",
        summary: "Preparar la app para datos médicos reales.",
        benefit: [
          "Cifrado de los datos en reposo y en tránsito.",
          "Control de acceso por rol y consentimiento granular de la tripulación.",
          "Registro de auditoría completo de quién consultó qué.",
        ],
        needs: [
          "Revisión frente a estándares de salud espacial (por ejemplo, NASA-STD-3001) y de protección de datos.",
          "Pruebas de seguridad periódicas.",
        ],
      },
      {
        id: "autonomy",
        area: "OPS",
        horizon: "LONG",
        title: "Operación autónoma y manos libres",
        summary: "Herramientas para misiones lejanas en las que Tierra no puede responder a tiempo.",
        benefit: [
          "Asistente a bordo que funciona sin conexión y guía los protocolos paso a paso.",
          "Control por voz cuando la tripulación tiene las manos ocupadas.",
          "Exportación de informes para el médico de vuelo en cada ventana de enlace.",
        ],
        needs: [
          "Modelos que funcionen en el hardware de a bordo.",
          "Protocolos médicos validados en formato estructurado.",
        ],
      },
    ],
  },
  en: {
    title: "Recommendations",
    subtitle: "Improvements proposed for future versions, with more development time and the integration of every measuring instrument",
    intro: "Nothing listed here is implemented yet. Each box explains what the improvement would bring, what it would take to build it and the recommended timeframe.",
    expandAll: "Expand all",
    collapseAll: "Collapse all",
    countLabel: "{n} recommendations",
    benefitH: "What it brings",
    needsH: "What it takes",
    horizonLbl: "Timeframe",
    horizon: { SHORT: "Short term", MID: "Medium term", LONG: "Long term" },
    area: {
      BIO: "Biometrics",
      MED: "Medical equipment",
      RAD: "Radiation",
      ENV: "Environment",
      COMMS: "Communication",
      DATA: "Analytics",
      SEC: "Security",
      OPS: "Operations",
    },
    items: [
      {
        id: "wearables",
        area: "BIO",
        horizon: "SHORT",
        title: "Continuous biometrics with wearable devices",
        summary: "Automatically capture the vital signs that are logged by hand today.",
        benefit: [
          "Continuous heart rate, heart rate variability (HRV), SpO₂, skin temperature and respiratory rate.",
          "Actigraphy to measure sleep and activity without relying on self-reports.",
          "Early detection of trends between two manual measurements.",
        ],
        needs: [
          "A wristband or shirt with sensors validated for microgravity.",
          "Onboard sync (Bluetooth Low Energy) and an offline send queue.",
          "Signal-quality rules to discard readings with artifacts.",
        ],
      },
      {
        id: "medical-devices",
        area: "MED",
        horizon: "MID",
        title: "Integration of onboard medical instruments",
        summary: "Let the blood pressure monitor, ECG, ultrasound and analyzers send their data directly.",
        benefit: [
          "Fewer transcription errors in Log measurement.",
          "12-lead ECG and guided ultrasound attached to the crew member's record.",
          "Point-of-care blood and urine tests with their history.",
        ],
        needs: [
          "Per-device connectors and a common exchange format (for example, HL7 FHIR).",
          "Calibration and traceability for each device.",
          "Validation with the flight medicine team.",
        ],
      },
      {
        id: "dosimetry",
        area: "RAD",
        horizon: "SHORT",
        title: "Real-time personal dosimetry",
        summary: "One active dosimeter per crew member connected to the Radiation view.",
        benefit: [
          "Individual dose instead of a per-module estimate.",
          "More accurate shelter warnings by combining proton flux (NOAA) with the measured dose.",
          "Tracking of accumulated dose against career limits.",
        ],
        needs: [
          "Active dosimeters with a data interface.",
          "A shielding model for each habitat zone.",
        ],
      },
      {
        id: "cabin-sensors",
        area: "ENV",
        horizon: "MID",
        title: "Cabin environment sensors",
        summary: "CO₂, noise, light, temperature and humidity linked to sleep and performance.",
        benefit: [
          "Explain physiological alerts with environmental causes (for example, high CO₂ and headache).",
          "Recommend lighting and schedule adjustments to protect sleep.",
          "Enrich the Environments view with measured data, not only reference values.",
        ],
        needs: [
          "Access to the habitat life-support telemetry.",
          "Time correlation between the environment and each crew member's records.",
        ],
      },
      {
        id: "earth-channel",
        area: "COMMS",
        horizon: "MID",
        title: "Communication channel with Earth and family",
        summary: "Bring messaging back, removed in this version, as an asynchronous channel designed for delay.",
        benefit: [
          "Voice, text and photo messages sent at the next link window.",
          "Contact with the support team and loved ones to counter isolation.",
          "Clear display of the estimated delay and delivery status.",
        ],
        needs: [
          "Disruption-tolerant (store-and-forward) messaging infrastructure.",
          "End-to-end encryption and privacy rules agreed with the crew.",
          "No live video calls: with delay they are frustrating.",
        ],
      },
      {
        id: "predictive",
        area: "DATA",
        horizon: "LONG",
        title: "Personalized predictive models",
        summary: "Move from the current regression and Z-score to models trained on more data per person.",
        benefit: [
          "Individual baselines that adjust throughout the mission.",
          "Early risk prediction (bone and muscle loss, sleep disruption, fatigue).",
          "An explanation for each prediction so the flight surgeon can review it.",
        ],
        needs: [
          "Enough data from analog and real missions.",
          "Clinical validation and bias checks before using them in decisions.",
        ],
      },
      {
        id: "security",
        area: "SEC",
        horizon: "SHORT",
        title: "Security, privacy and compliance",
        summary: "Prepare the app for real medical data.",
        benefit: [
          "Encryption of data at rest and in transit.",
          "Role-based access control and granular crew consent.",
          "A complete audit log of who viewed what.",
        ],
        needs: [
          "Review against space health standards (for example, NASA-STD-3001) and data protection rules.",
          "Regular security testing.",
        ],
      },
      {
        id: "autonomy",
        area: "OPS",
        horizon: "LONG",
        title: "Autonomous, hands-free operation",
        summary: "Tools for distant missions where Earth cannot answer in time.",
        benefit: [
          "An onboard assistant that works offline and guides protocols step by step.",
          "Voice control when the crew's hands are busy.",
          "Report export for the flight surgeon at every link window.",
        ],
        needs: [
          "Models that run on onboard hardware.",
          "Validated medical protocols in a structured format.",
        ],
      },
    ],
  },
};

/* Cuadros abiertos (por id): sobreviven a un repintado por cambio de idioma o a una nueva visita */
const openIds = new Set();

/* Títulos de las recomendaciones en el idioma vigente (los usa el Resumen en su cuadro de avance) */
export function recommendationTitles() {
  return tr(DICT).items.map((it) => ({ id: it.id, title: it.title, area: tr(DICT).area[it.area] }));
}

function listHTML(items) {
  return `<ul class="av-rec-list">${items.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>`;
}

function cardHTML(T, it) {
  const area = T.area[it.area] || it.area;
  const horizon = T.horizon[it.horizon] || it.horizon;
  const headId = `av-rec-h-${it.id}`;
  return `<details class="av-panel av-fold av-rec-card" data-rec-id="${esc(it.id)}"${openIds.has(it.id) ? " open" : ""}>
      <summary class="av-panel-head av-fold-head av-rec-head" title="${esc(it.title)}">
        <h3 class="av-h3" id="${headId}">${esc(it.title)}</h3>
      </summary>
      <div class="av-rec-body" aria-labelledby="${headId}">
        <div class="av-rec-tags">
          <span class="av-mx-tag">${esc(area)}</span>
          <span class="av-mx-tag av-rec-hz av-rec-hz-${esc(it.horizon.toLowerCase())}">${esc(T.horizonLbl)}: ${esc(horizon)}</span>
        </div>
        <p class="av-rec-sum">${esc(it.summary)}</p>
        <h4 class="av-lbl">${esc(T.benefitH)}</h4>
        ${listHTML(it.benefit)}
        <h4 class="av-lbl">${esc(T.needsH)}</h4>
        ${listHTML(it.needs)}
      </div>
    </details>`;
}

export async function renderRecommendationsView(container) {
  const T = tr(DICT);
  const count = T.countLabel.replace("{n}", String(T.items.length));

  container.innerHTML = `
  <div class="av-console av-rec-root" data-rec-root>
    <section class="av-rec-wrap" aria-labelledby="av-rec-title">
      <div class="av-panel">
        <div class="av-panel-head">
          <div>
            <h2 id="av-rec-title" class="av-h2">${esc(T.title)}</h2>
            <div class="av-sub">${esc(T.subtitle)}</div>
          </div>
          <div class="av-rec-tools">
            <span class="av-sub">${esc(count)}</span>
            <button type="button" class="av-btn av-btn-sm" data-rec-all="open">${esc(T.expandAll)}</button>
            <button type="button" class="av-btn av-btn-sm" data-rec-all="close">${esc(T.collapseAll)}</button>
          </div>
        </div>
        <p class="av-rec-intro">${esc(T.intro)}</p>
      </div>
      <div class="av-rec-grid">${T.items.map((it) => cardHTML(T, it)).join("")}</div>
    </section>
  </div>`;

  const root = container.querySelector("[data-rec-root]");

  // Recuerda qué cuadros están abiertos (el evento toggle no burbujea: se escucha en captura)
  root.addEventListener(
    "toggle",
    (ev) => {
      const card = ev.target.closest?.("[data-rec-id]");
      if (!card) return;
      const id = card.getAttribute("data-rec-id");
      if (card.open) openIds.add(id);
      else openIds.delete(id);
    },
    true
  );

  root.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-rec-all]");
    if (!btn || !root.contains(btn)) return;
    const open = btn.getAttribute("data-rec-all") === "open";
    root.querySelectorAll("[data-rec-id]").forEach((card) => {
      card.open = open;
    });
  });
}
