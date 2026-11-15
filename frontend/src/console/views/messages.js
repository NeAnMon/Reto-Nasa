/*
 * SEMSA · Consola · Vista "Mensajes" (centro de comunicación)
 *
 * Sustituye a renderCommunicationCenter (app/expansion_views.js) con el diseño de la consola:
 *  - lista de conversaciones 1-a-1 (tripulante ↔ líder en Tierra asignado) con no leídos y última actividad GMT
 *  - hilo con remitente, rol, categoría, GMT, estado de entrega en texto y referencia de respuesta
 *  - redacción con 8 categorías, adjunto por nombre, "importante", contador de caracteres
 *  - cola local sin enlace: NUNCA se muestra como entregado hasta que el servidor lo confirme
 *  - confirmaciones de lectura (leído / no leído / todo leído)
 *  - solicitudes de apoyo con ciclo REQUESTED → RECEIVED → IN_REVIEW → RESPONDED → CLOSED (+ ESCALATED)
 *  - administración: lectura del contenido solo con justificación auditada (por conversación) y en modo lectura
 *
 * Seguridad: todo texto de usuario o de la API pasa por escapeHtml (también en atributos) o textContent.
 * Eventos: atributos propios data-msg-act / data-msg-form (no data-act/data-nav/data-form, que usa
 * el manejador delegado de console.js sobre el mismo contenedor). Los oyentes se enlazan a la raíz
 * de esta vista en cada pintado, así que mueren con ella. No hay temporizadores ni sondeo.
 *
 * Idiomas: textos en DICT (es / en), resueltos en cada pintado con tr(DICT).
 */
import { escapeHtml, num, gmt } from "../console.js";
import { apiService } from "../../services/api.js";
import { tr, fmt, fmtNum, getLang } from "../../i18n/i18n.js";
import { bt, btLines, btPreview } from "/src/i18n/backend.js";

const esc = escapeHtml;
const MAX_LEN = 5000; // límite del backend (MessageCreateRequest.content)

/* ───────────────────────── textos ───────────────────────── */

const DICT = {
  es: {
    category: {
      GENERAL: "General",
      HEALTH_UPDATE: "Actualización de salud",
      COGNITIVE_SUPPORT: "Apoyo cognitivo",
      EMOTIONAL_SUPPORT: "Apoyo emocional",
      MISSION_COORDINATION: "Coordinación de misión",
      TECHNICAL_ISSUE: "Incidencia técnica",
      REQUEST_FOR_ASSISTANCE: "Solicitud de asistencia",
      URGENT_COMMUNICATION: "Comunicación urgente",
    },
    /* Motivos del formulario de solicitud de apoyo (mismos que la vista anterior) */
    srCategory: {
      REQUEST_FOR_ASSISTANCE: "Solicitud general de asistencia",
      HEALTH_UPDATE: "Consulta sobre un indicador fisiológico",
      COGNITIVE_SUPPORT: "Fatiga o apoyo cognitivo",
      EMOTIONAL_SUPPORT: "Acompañamiento emocional privado",
      TECHNICAL_ISSUE: "Incidencia con sensor o equipo",
      URGENT_COMMUNICATION: "Situación prioritaria o urgente",
    },
    sr: {
      REQUESTED: "Solicitada",
      RECEIVED: "Recibida",
      IN_REVIEW: "En revisión",
      RESPONDED: "Respondida",
      ESCALATED: "Escalada",
      CLOSED: "Cerrada",
    },
    conv: { OPEN: "Abierta", PENDING_FOLLOWUP: "Seguimiento pendiente", CLOSED: "Cerrada", ARCHIVED: "Archivada" },
    role: { ASTRONAUT: "Tripulante", MISSION_LEADER: "Líder en Tierra", ADMINISTRATOR: "Administración" },
    /* Aviso local cuando una urgencia queda en cola sin enlace (el del servidor llega al confirmar) */
    localEmergency:
      "Sin enlace de datos: tu solicitud urgente está en cola y todavía NO ha llegado a Tierra. " +
      "Aplica el protocolo de emergencia a bordo y usa el bucle de voz prioritario con el médico de vuelo y Dirección de Vuelo en cuanto haya contacto.",
    localUrgentMsg:
      "Sin enlace de datos: tu comunicación urgente está en cola y todavía NO ha llegado a Tierra. " +
      "Aplica el protocolo de emergencia a bordo y usa el bucle de voz prioritario con el médico de vuelo y Dirección de Vuelo en cuanto haya contacto.",
    unknownErr: "error desconocido",
    linkUnknown: "Desconocido",
    linkLosSim: "LOS · sin enlace (corte simulado)",
    linkLos: "LOS · sin enlace",
    linkDelayed: "AOS · con retardo",
    linkOnline: "AOS · en enlace",
    newOne: "1 mensaje nuevo",
    newMany: "{n} mensajes nuevos",
    newFrom: "{x} de {who}.",
    loading: "Cargando mensajes…",
    loadFail: "No se pudieron cargar los mensajes: {msg}",
    selConvAria: "Conversación seleccionada",
    emergencyTitle: "Protocolo de emergencia",
    understood: "Entendido",
    convFail: "No se pudieron cargar las conversaciones: {msg}",
    noConvs: "No hay conversaciones activas.",
    convListAria: "Lista de conversaciones",
    convNone: "Ninguna conversación coincide con el filtro.",
    convs: "Conversaciones",
    unreadTotal: "{n} sin leer",
    noPending: "Sin pendientes",
    channelNote: "Canal privado 1-a-1 entre tripulante y líder en Tierra asignado. Las categorías ordenan el seguimiento; no sustituyen el canal prioritario de emergencia.",
    searchConv: "Buscar conversación",
    searchConvPh: "Nombre, código o misión",
    status: "Estado",
    allStatuses: "Todos los estados",
    hiddenConvs: "{n} conversación(es) de otros líderes no se muestran: son privadas entre sus participantes.",
    adminNote: "Administración ve solo metadatos. Para leer el contenido de una conversación debes registrar una justificación que queda en auditoría.",
    urgentUnread: "URGENTE · SIN LEER",
    lastUrgent: "Último: urgente",
    followup: "Seguimiento",
    nUnread: "{n} sin leer",
    noMsgsYet: "Sin mensajes aún",
    lastActivity: "Última actividad {t} GMT",
    openWithLead: "Abrir canal con tu líder en Tierra",
    openWithSelected: "Abrir canal con el tripulante seleccionado",
    crewForChannel: "Tripulante para canal directo",
    openChannel: "Abrir canal",
    linkAria: "Estado del enlace tripulación–Tierra",
    linkLbl: "Enlace tripulación ↔ Tierra",
    delayLbl: "Retardo (un sentido)",
    minReply: "Respuesta mínima",
    yourQueue: "Tu cola local",
    flushBtn: "Transmitir cola ({n})",
    selectConv: "Selecciona una conversación para ver el historial y escribir.",
    noConvsYet: "Aún no hay conversaciones. Abre un canal para empezar.",
    threadFail: "No se pudo abrir la conversación: {msg}",
    retry: "Reintentar",
    loadingConv: "Cargando conversación…",
    convFallback: "Conversación",
    crewLbl: "Tripulante:",
    leadLbl: "Líder en Tierra:",
    searchThread: "Buscar en la conversación",
    readAll: "Marcar todo como leído ({n})",
    refresh: "Actualizar",
    audited: "AUDITADO",
    auditBar: "Acceso registrado en auditoría · justificación: «{j}». Solo lectura.",
    auditClose: "Cerrar acceso auditado",
    logAria: "Historial de mensajes",
    noMsgs: "No hay mensajes en esta conversación.",
    noMsgMatch: "Ningún mensaje coincide con la búsqueda.",
    gateTitle: "Conversación privada protegida",
    participants: "Participantes: {a} ↔ {l} · {m}",
    gateNoteHtml: "Por política de privacidad, administración gestiona asignaciones pero <strong>no puede leer en silencio</strong> el contenido de las conversaciones 1-a-1. Para inspeccionar esta conversación registra una justificación: el acceso queda en auditoría con tu identidad y solo se abre esta conversación, en modo lectura.",
    accessDenied: "Acceso no concedido: {msg}",
    justLabel: "Justificación de auditoría (mínimo 5 caracteres)",
    justBtn: "Registrar auditoría y mostrar conversación",
    dNoReceipt: "Sin confirmación de lectura del destinatario",
    dReadByRecipient: "Leído por el destinatario",
    dRead: "Leído",
    dDelivered: "Entregado · confirmado por el servidor",
    dSent: "Enviado · pendiente de confirmación de entrega",
    dQueued: "En cola local · sin confirmar",
    dUnknown: "Estado desconocido",
    dMarkedUnread: " · marcado como no leído",
    statusLbl: "Estado:",
    replyToQuote: "Respuesta a #{id}: «{c}»",
    replyTo: "Respuesta a #{id}",
    replyAria: "Responder al mensaje #{id}",
    reply: "Responder",
    important: "Importante",
    markRead: "Marcar leído",
    markUnread: "Marcar no leído",
    you: "tú",
    urgent: "URGENTE",
    unread: "Sin leer",
    attachment: "Adjunto: {a}",
    linkedAlert: "Vinculado a la alerta #{id}",
    queuedSince: "En cola desde {t} GMT",
    queuedMsgFoot: "En cola local · se enviará en el próximo contacto. No entregado.",
    offlineMsgHtml: "<strong>Sin enlace: se enviará en el próximo contacto.</strong> El mensaje queda en la cola local y no figurará como entregado hasta que el servidor lo confirme.",
    delayNote: "Retardo de enlace {d}: llegada estimada ≈ {eta} GMT; la respuesta no llegará antes de {d2}.",
    newMessage: "Nuevo mensaje",
    alertNote: "Mensaje precargado desde la alerta{id}. Revísalo antes de enviar.",
    toSr: "Convertir en solicitud de apoyo",
    discard: "Descartar",
    replying: "Respondiendo a #{id}: «{p}»",
    cancelReply: "Cancelar respuesta",
    categoryLbl: "Categoría",
    attLbl: "Adjunto (nombre de archivo, opcional)",
    attPh: "p. ej. ecg_log.txt",
    urgentNote: "Se marcará como importante y quedará resaltado para seguimiento. Este canal complementa, pero no reemplaza, el bucle de voz prioritario ni el protocolo de emergencia.",
    markImportant: "Marcar como importante",
    messageLbl: "Mensaje",
    queueBtn: "Poner en cola",
    send: "Enviar",
    counter: "{n} / {max} caracteres",
    srFail: "No se pudieron cargar las solicitudes: {msg}",
    srNoneStatus: "Ninguna solicitud con ese estado.",
    srNone: "No hay solicitudes de apoyo registradas.",
    srs: "Solicitudes de apoyo",
    total: "Total",
    readOnly: " · solo lectura",
    urgentOne: "URGENTE",
    urgentMany: "URGENTES",
    filterStatus: "Filtrar por estado",
    hiddenSups: "{n} solicitud(es) dirigida(s) a otros líderes no se muestran.",
    requestSupport: "Solicitar apoyo",
    hideForm: "Ocultar formulario",
    newRequest: "Nueva solicitud",
    srIntro: "Llega a tu líder en Tierra asignado y queda registrada también en tu canal privado.",
    reason: "Motivo",
    shortReason: "Motivo breve",
    description: "Descripción",
    wantPrivate: "Quiero una conversación privada 1-a-1",
    isEmergency: "Es una urgencia operativa o médica (se escala de inmediato)",
    offlineSrHtml: "<strong>Sin enlace: se enviará en el próximo contacto.</strong> La solicitud queda en la cola local y no llega a Tierra hasta que el servidor la confirme.",
    queueSr: "Poner solicitud en cola",
    sendSr: "Enviar solicitud",
    lifeAria: "Ciclo de la solicitud",
    completed: " (completado)",
    leadWho: "Líder: {n}",
    protected: "[Contenido protegido · requiere acceso auditado a la conversación]",
    manage: "Gestionar solicitud #{id}",
    newStatus: "Nuevo estado",
    respNote: "Nota de respuesta (visible para el tripulante; vacía conserva la anterior)",
    updateStatus: "Actualizar estado",
    closeSr: "Cerrar solicitud",
    privateSr: "Solicitud privada",
    emergency: "EMERGENCIA",
    escalated: "ESCALADA",
    leadResponse: "Respuesta del líder",
    noResponse: "Sin respuesta registrada.",
    createdUpdated: "Creada {t} GMT · actualizada {u} GMT",
    askedPrivate: " · pidió conversación privada",
    openConv: "Abrir conversación",
    queuedSrSince: "{cat} · en cola desde {t} GMT",
    queuedSrFoot: "En cola local · se enviará en el próximo contacto. No ha llegado a Tierra.",
    actionFail: "No se pudo completar la acción: {msg}",
    channelCreated: "Canal directo creado.",
    channelOpened: "Canal directo existente abierto.",
    flushed: "Cola transmitida: {s} confirmados por el servidor, {r} pendientes.",
    flushRejected: " El servidor rechazó un mensaje y se quitó de la cola ({reason}): «{text}». Reescríbelo si aún quieres enviarlo.",
    gotoMissing: "El mensaje original no está visible (puede estar filtrado por la búsqueda).",
    impOff: "Mensaje #{id}: ya no está marcado como importante.",
    impOn: "Mensaje #{id} marcado como importante.",
    readOk: "Mensaje #{id} marcado como leído. Se registró la confirmación de lectura.",
    unreadOk: "Mensaje #{id} marcado como no leído.",
    readAllOk: "{ok} de {n} mensajes marcados como leídos.",
    auditClosed: "Acceso auditado cerrado. El contenido vuelve a estar protegido.",
    srClosed: "Solicitud #{id} cerrada.",
    alertSrTitle: "Consulta sobre alerta #{id}",
    alertSrTitleNoId: "Consulta sobre una alerta",
    writeFirst: "Escribe un mensaje antes de enviar.",
    sendFail: "No se pudo enviar: {msg}. El borrador se conserva.",
    queuedMsg: "Sin enlace: mensaje en cola local ({n} en cola). Se enviará en el próximo contacto; no figura como entregado.",
    dupMsg: "El servidor ya tenía este mensaje: se evitó un duplicado.",
    confirmedMsg: "Mensaje confirmado por el servidor (DELIVERED) {at}.",
    atGmt: "a las {t} GMT",
    unexpected: "Respuesta inesperada del servidor: el mensaje no se da por entregado. Revisa el hilo.",
    justInvalid: "Escribe una justificación válida (mínimo 5 caracteres).",
    auditGranted: "Acceso auditado concedido y registrado. Vista de solo lectura.",
    srIncomplete: "Completa el motivo y la descripción (mínimo 3 caracteres cada uno).",
    srSendFail: "No se pudo enviar la solicitud: {msg}. El formulario se conserva.",
    srQueued: "Sin enlace: solicitud en cola local ({n} en cola). Se enviará en el próximo contacto; todavía no ha llegado a Tierra.",
    srOk: "Solicitud #{id} confirmada por el servidor y asignada a {lead}. Estado: {st}.",
    yourLead: "tu líder en Tierra",
    srOkNoData: "Solicitud confirmada por el servidor.",
    srUpdated: "Solicitud #{id} actualizada a {st} ({code}).{note}",
    noteRecorded: " Nota registrada.",
  },
  en: {
    category: {
      GENERAL: "General",
      HEALTH_UPDATE: "Health update",
      COGNITIVE_SUPPORT: "Cognitive support",
      EMOTIONAL_SUPPORT: "Emotional support",
      MISSION_COORDINATION: "Mission coordination",
      TECHNICAL_ISSUE: "Technical issue",
      REQUEST_FOR_ASSISTANCE: "Assistance request",
      URGENT_COMMUNICATION: "Urgent communication",
    },
    srCategory: {
      REQUEST_FOR_ASSISTANCE: "General assistance request",
      HEALTH_UPDATE: "Question about a physiological indicator",
      COGNITIVE_SUPPORT: "Fatigue or cognitive support",
      EMOTIONAL_SUPPORT: "Private emotional support",
      TECHNICAL_ISSUE: "Sensor or equipment issue",
      URGENT_COMMUNICATION: "Priority or urgent situation",
    },
    sr: {
      REQUESTED: "Requested",
      RECEIVED: "Received",
      IN_REVIEW: "In review",
      RESPONDED: "Responded",
      ESCALATED: "Escalated",
      CLOSED: "Closed",
    },
    conv: { OPEN: "Open", PENDING_FOLLOWUP: "Follow-up pending", CLOSED: "Closed", ARCHIVED: "Archived" },
    role: { ASTRONAUT: "Crew member", MISSION_LEADER: "Ground lead", ADMINISTRATOR: "Administration" },
    localEmergency:
      "No data link: your urgent request is queued and has NOT reached Ground yet. " +
      "Apply the onboard emergency protocol and use the priority voice loop with the flight surgeon and the Flight Director as soon as there is contact.",
    localUrgentMsg:
      "No data link: your urgent communication is queued and has NOT reached Ground yet. " +
      "Apply the onboard emergency protocol and use the priority voice loop with the flight surgeon and the Flight Director as soon as there is contact.",
    unknownErr: "unknown error",
    linkUnknown: "Unknown",
    linkLosSim: "LOS · no link (simulated loss)",
    linkLos: "LOS · no link",
    linkDelayed: "AOS · delayed",
    linkOnline: "AOS · link up",
    newOne: "1 new message",
    newMany: "{n} new messages",
    newFrom: "{x} from {who}.",
    loading: "Loading messages…",
    loadFail: "Could not load messages: {msg}",
    selConvAria: "Selected conversation",
    emergencyTitle: "Emergency protocol",
    understood: "Understood",
    convFail: "Could not load conversations: {msg}",
    noConvs: "No active conversations.",
    convListAria: "Conversation list",
    convNone: "No conversation matches the filter.",
    convs: "Conversations",
    unreadTotal: "{n} unread",
    noPending: "Nothing pending",
    channelNote: "Private 1-on-1 channel between the crew member and their assigned ground lead. Categories organize follow-up; they don't replace the priority emergency channel.",
    searchConv: "Search conversations",
    searchConvPh: "Name, code or mission",
    status: "Status",
    allStatuses: "All statuses",
    hiddenConvs: "{n} conversation(s) of other leads are hidden: they are private to their participants.",
    adminNote: "Administration sees metadata only. To read a conversation's content you must log a justification, which is recorded in the audit log.",
    urgentUnread: "URGENT · UNREAD",
    lastUrgent: "Last: urgent",
    followup: "Follow-up",
    nUnread: "{n} unread",
    noMsgsYet: "No messages yet",
    lastActivity: "Last activity {t} GMT",
    openWithLead: "Open channel with your ground lead",
    openWithSelected: "Open channel with the selected crew member",
    crewForChannel: "Crew member for direct channel",
    openChannel: "Open channel",
    linkAria: "Crew–Ground link status",
    linkLbl: "Crew ↔ Ground link",
    delayLbl: "Delay (one way)",
    minReply: "Minimum reply time",
    yourQueue: "Your local queue",
    flushBtn: "Transmit queue ({n})",
    selectConv: "Select a conversation to see its history and write.",
    noConvsYet: "No conversations yet. Open a channel to start.",
    threadFail: "Could not open the conversation: {msg}",
    retry: "Retry",
    loadingConv: "Loading conversation…",
    convFallback: "Conversation",
    crewLbl: "Crew member:",
    leadLbl: "Ground lead:",
    searchThread: "Search in conversation",
    readAll: "Mark all as read ({n})",
    refresh: "Refresh",
    audited: "AUDITED",
    auditBar: "Access recorded in the audit log · justification: “{j}”. Read-only.",
    auditClose: "Close audited access",
    logAria: "Message history",
    noMsgs: "No messages in this conversation.",
    noMsgMatch: "No message matches the search.",
    gateTitle: "Protected private conversation",
    participants: "Participants: {a} ↔ {l} · {m}",
    gateNoteHtml: "Under the privacy policy, administration manages assignments but <strong>cannot silently read</strong> the content of 1-on-1 conversations. To inspect this conversation, log a justification: access is audited under your identity and only this conversation opens, read-only.",
    accessDenied: "Access not granted: {msg}",
    justLabel: "Audit justification (minimum 5 characters)",
    justBtn: "Log audit and show conversation",
    dNoReceipt: "No read receipt from the recipient",
    dReadByRecipient: "Read by recipient",
    dRead: "Read",
    dDelivered: "Delivered · confirmed by server",
    dSent: "Sent · awaiting delivery confirmation",
    dQueued: "In local queue · unconfirmed",
    dUnknown: "Unknown status",
    dMarkedUnread: " · marked as unread",
    statusLbl: "Status:",
    replyToQuote: "Reply to #{id}: “{c}”",
    replyTo: "Reply to #{id}",
    replyAria: "Reply to message #{id}",
    reply: "Reply",
    important: "Important",
    markRead: "Mark read",
    markUnread: "Mark unread",
    you: "you",
    urgent: "URGENT",
    unread: "Unread",
    attachment: "Attachment: {a}",
    linkedAlert: "Linked to alert #{id}",
    queuedSince: "Queued since {t} GMT",
    queuedMsgFoot: "In local queue · will be sent at the next contact. Not delivered.",
    offlineMsgHtml: "<strong>No link: will be sent at the next contact.</strong> The message stays in the local queue and won't show as delivered until the server confirms it.",
    delayNote: "Link delay {d}: estimated arrival ≈ {eta} GMT; a reply can't arrive before {d2}.",
    newMessage: "New message",
    alertNote: "Message prefilled from alert{id}. Review it before sending.",
    toSr: "Convert to support request",
    discard: "Discard",
    replying: "Replying to #{id}: “{p}”",
    cancelReply: "Cancel reply",
    categoryLbl: "Category",
    attLbl: "Attachment (file name, optional)",
    attPh: "e.g. ecg_log.txt",
    urgentNote: "It will be marked important and highlighted for follow-up. This channel complements, but does not replace, the priority voice loop or the emergency protocol.",
    markImportant: "Mark as important",
    messageLbl: "Message",
    queueBtn: "Queue",
    send: "Send",
    counter: "{n} / {max} characters",
    srFail: "Could not load support requests: {msg}",
    srNoneStatus: "No requests with that status.",
    srNone: "No support requests logged.",
    srs: "Support requests",
    total: "Total",
    readOnly: " · read-only",
    urgentOne: "URGENT",
    urgentMany: "URGENT",
    filterStatus: "Filter by status",
    hiddenSups: "{n} request(s) addressed to other leads are hidden.",
    requestSupport: "Request support",
    hideForm: "Hide form",
    newRequest: "New request",
    srIntro: "Goes to your assigned ground lead and is also logged in your private channel.",
    reason: "Reason",
    shortReason: "Short summary",
    description: "Description",
    wantPrivate: "I want a private 1-on-1 conversation",
    isEmergency: "This is an operational or medical emergency (escalated immediately)",
    offlineSrHtml: "<strong>No link: will be sent at the next contact.</strong> The request stays in the local queue and doesn't reach Ground until the server confirms it.",
    queueSr: "Queue request",
    sendSr: "Send request",
    lifeAria: "Request lifecycle",
    completed: " (completed)",
    leadWho: "Lead: {n}",
    protected: "[Protected content · requires audited access to the conversation]",
    manage: "Manage request #{id}",
    newStatus: "New status",
    respNote: "Response note (visible to the crew member; leave empty to keep the previous one)",
    updateStatus: "Update status",
    closeSr: "Close request",
    privateSr: "Private request",
    emergency: "EMERGENCY",
    escalated: "ESCALATED",
    leadResponse: "Lead response",
    noResponse: "No response recorded.",
    createdUpdated: "Created {t} GMT · updated {u} GMT",
    askedPrivate: " · requested a private conversation",
    openConv: "Open conversation",
    queuedSrSince: "{cat} · queued since {t} GMT",
    queuedSrFoot: "In local queue · will be sent at the next contact. Has not reached Ground.",
    actionFail: "Could not complete the action: {msg}",
    channelCreated: "Direct channel created.",
    channelOpened: "Existing direct channel opened.",
    flushed: "Queue transmitted: {s} confirmed by the server, {r} pending.",
    flushRejected: " The server rejected a message and it was removed from the queue ({reason}): “{text}”. Rewrite it if you still want to send it.",
    gotoMissing: "The original message isn't visible (it may be filtered out by the search).",
    impOff: "Message #{id}: no longer marked as important.",
    impOn: "Message #{id} marked as important.",
    readOk: "Message #{id} marked as read. Read receipt recorded.",
    unreadOk: "Message #{id} marked as unread.",
    readAllOk: "{ok} of {n} messages marked as read.",
    auditClosed: "Audited access closed. The content is protected again.",
    srClosed: "Request #{id} closed.",
    alertSrTitle: "Query about alert #{id}",
    alertSrTitleNoId: "Query about an alert",
    writeFirst: "Write a message before sending.",
    sendFail: "Could not send: {msg}. The draft is kept.",
    queuedMsg: "No link: message in local queue ({n} queued). It will be sent at the next contact; not shown as delivered.",
    dupMsg: "The server already had this message: duplicate prevented.",
    confirmedMsg: "Message confirmed by the server (DELIVERED) {at}.",
    atGmt: "at {t} GMT",
    unexpected: "Unexpected server response: the message is not considered delivered. Check the thread.",
    justInvalid: "Enter a valid justification (minimum 5 characters).",
    auditGranted: "Audited access granted and logged. Read-only view.",
    srIncomplete: "Fill in the summary and the description (minimum 3 characters each).",
    srSendFail: "Could not send the request: {msg}. The form is kept.",
    srQueued: "No link: request in local queue ({n} queued). It will be sent at the next contact; it hasn't reached Ground yet.",
    srOk: "Request #{id} confirmed by the server and assigned to {lead}. Status: {st}.",
    yourLead: "your ground lead",
    srOkNoData: "Request confirmed by the server.",
    srUpdated: "Request #{id} updated to {st} ({code}).{note}",
    noteRecorded: " Note recorded.",
  },
};

const CATEGORY_CODES = ["GENERAL", "HEALTH_UPDATE", "COGNITIVE_SUPPORT", "EMOTIONAL_SUPPORT", "MISSION_COORDINATION", "TECHNICAL_ISSUE", "REQUEST_FOR_ASSISTANCE", "URGENT_COMMUNICATION"];
const SR_CATEGORY_CODES = ["REQUEST_FOR_ASSISTANCE", "HEALTH_UPDATE", "COGNITIVE_SUPPORT", "EMOTIONAL_SUPPORT", "TECHNICAL_ISSUE", "URGENT_COMMUNICATION"];
const SR_STATUSES = ["REQUESTED", "RECEIVED", "IN_REVIEW", "RESPONDED", "ESCALATED", "CLOSED"];
const SR_FLOW = ["REQUESTED", "RECEIVED", "IN_REVIEW", "RESPONDED", "CLOSED"];

/* ───────────────────────── estado del módulo ───────────────────────── */

function freshState(userId) {
  return {
    userId,
    selectedId: null,
    convQuery: "",
    convStatus: "",
    threadQuery: "",
    srFilter: "",
    newAstro: null,
    drafts: {}, // borradores por conversación (evita enviar al destinatario equivocado)
    pendingAlert: null, // { id, text, category } recién llegado desde Alertas
    alert: null, // { id, text, convId } aviso visible en la redacción
    srOpen: false,
    srDraft: newSrDraft(),
    adminJust: {}, // justificación de auditoría por conversación (solo administración)
    emergency: null, // { key } (texto local, se traduce al pintar) o { text } (aviso del servidor)
    msg: { text: "", fresh: false },
    srMsg: { text: "", fresh: false },
    busy: false,
    loadingThread: false,
    scrollBottom: true,
    focusId: null,
    lastMsgIds: null,
    lastConvId: null,
  };
}
function newSrDraft() {
  return { category: "REQUEST_FOR_ASSISTANCE", title: "", desc: "", priv: true, emergency: false };
}
function newDraft() {
  return { content: "", category: "GENERAL", attachment: "", important: false, replyTo: null, replyPreview: "", linkedAlertId: null };
}

let S = freshState(null);
let D = { conversations: [], hiddenConvs: 0, hiddenSups: 0, convError: null, supports: [], supError: null, thread: null, threadError: null };
let ctx = null;
let seq = 0;

/* ───────────────────────── utilidades ───────────────────────── */

const role = () => ctx?.appState?.currentUser?.role_code || "ASTRONAUT";
const meId = () => ctx?.appState?.currentUser?.id;
const isAdmin = () => role() === "ADMINISTRATOR";
const isCategory = (c) => CATEGORY_CODES.includes(c);
const catLabel = (c) => tr(DICT).category[c] || String(c || "—");
const srLabel = (s) => tr(DICT).sr[s] || String(s || "—");
const convLabel = (s) => tr(DICT).conv[s] || String(s || "—");
const roleLabel = (r) => tr(DICT).role[r] || String(r || "—");
const errMsg = (e) => bt(e && e.message) || String(e || tr(DICT).unknownErr);
/* Cuerpo de mensaje: pasa por bt(), que solo traduce coincidencias exactas o patrones conocidos
 * (aviso automático "[SOLICITUD DE APOYO #N — …] …" y mensajes de demostración sembrados);
 * lo escrito por personas no coincide y se muestra tal cual. */
const msgText = (c) => (c === null || c === undefined ? c : bt(String(c)));
const trunc = (s, n) => {
  const t = String(s ?? "");
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
/* Número según idioma: en español se conserva el formato de la consola */
const nm = (v, dec = 0) => (getLang() === "es" ? num(v, dec) : fmtNum(v, dec));

function draft() {
  const key = String(S.selectedId ?? "none");
  if (!S.drafts[key]) S.drafts[key] = newDraft();
  return S.drafts[key];
}

/* GMT DDD/HH:MM */
function when(iso) {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  return gmt(d, false);
}
function fullDate(iso) {
  if (!iso) return "";
  try {
    return ctx?.helpers?.formatDateUTC ? String(ctx.helpers.formatDateUTC(iso)) : String(iso);
  } catch {
    return String(iso);
  }
}
function timeTag(iso) {
  return `<time class="av-mono" datetime="${esc(iso || "")}" title="${esc(fullDate(iso))}">${esc(when(iso))}</time>`;
}

function fmtDelay(sec) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "—";
  if (sec < 60) return `${nm(sec, sec < 10 ? 1 : 0)} s`;
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return `${m} min ${s} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/* Estado del enlace a partir del contexto de misión y del modo sin conexión simulado */
function linkInfo() {
  const T = tr(DICT);
  const c = ctx?.appState?.healthSummary?.context || {};
  const simulated = Boolean(apiService.simulatedOfflineMode);
  const raw = String(c.connectivity_status || "").toUpperCase();
  const d = Number(c.comms_delay_seconds);
  const delay = c.comms_delay_seconds !== undefined && c.comms_delay_seconds !== null && Number.isFinite(d) ? d : null;
  const offline = simulated || raw === "OFFLINE";
  const delayed = !offline && (raw === "DELAYED" || (delay !== null && delay >= 1));
  let label = T.linkUnknown;
  if (offline) label = simulated ? T.linkLosSim : T.linkLos;
  else if (raw === "DELAYED") label = T.linkDelayed;
  else if (raw === "ONLINE") label = T.linkOnline;
  else if (raw) label = raw;
  return { offline, simulated, raw, delay, delayed, label };
}

/*
 * La cola local (localStorage) es del dispositivo, no del usuario: puede contener elementos de otra sesión.
 * Esta vista solo muestra, cuenta y transmite los elementos de mensajería que encoló el usuario actual
 * (owner_id), para no atribuir a un tripulante/líder lo que escribió otra persona en el mismo terminal.
 */
const isMsgEndpoint = (ep) => ep === "/support-requests" || /^\/conversations\/\d+\/messages$/.test(String(ep || ""));
function offlineQueue() {
  try {
    const me = meId();
    return (apiService.getOfflineQueue() || []).filter((q) => q && me != null && q.owner_id === me && isMsgEndpoint(q.endpoint));
  } catch {
    return [];
  }
}
function queueLocal(endpoint, payload, prefix) {
  const dedup_key = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  apiService.enqueueOfflineItem({ endpoint, dedup_key, payload, owner_id: meId() });
  return { queued_offline: true, queue_size: offlineQueue().length };
}
/* Transmite solo los elementos propios de mensajería; el resto de la cola queda intacto.
 * Igual que la cola genérica de api.js: un rechazo definitivo (4xx salvo 408/429) saca el elemento de la
 * cola y se informa a la persona con el motivo y el inicio del texto para que pueda reescribirlo.
 * Red caída, 408, 429 y 5xx: sigue en cola. */
async function flushMine() {
  const mine = offlineQueue();
  if (apiService.simulatedOfflineMode) return { synced: 0, remaining: mine.length, rejected: [] };
  const sent = new Set();
  const rejected = [];
  for (const item of mine) {
    try {
      await apiService.request(item.endpoint, {
        method: "POST",
        body: JSON.stringify({ ...item.payload, dedup_key: item.dedup_key }),
      });
      sent.add(item.dedup_key);
    } catch (e) {
      if (isRetryable(e)) continue; // queda en cola
      sent.add(item.dedup_key); // rechazo definitivo: fuera de la cola
      // las solicitudes de apoyo no tienen "content": se identifican por su motivo (reason_title)
      const p = item.payload || {};
      rejected.push({ text: String(p.content || p.reason_title || "").trim(), reason: errMsg(e) });
    }
  }
  if (sent.size) {
    // relee la cola para no pisar elementos encolados mientras tanto
    apiService.saveOfflineQueue((apiService.getOfflineQueue() || []).filter((q) => !sent.has(q.dedup_key)));
  }
  return { synced: sent.size - rejected.length, remaining: offlineQueue().length, rejected };
}
function isNetworkError(e) {
  return e instanceof TypeError && /fetch|network|load/i.test(String(e.message || ""));
}
/* Error que merece reintento (red, tiempo de espera, saturación o fallo del servidor) */
function isRetryable(e) {
  if (isNetworkError(e)) return true;
  const st = e && e.status;
  return !st || st === 408 || st === 429 || st >= 500;
}

function setMsg(text) {
  S.msg = { text: String(text || ""), fresh: true };
}
function setSrMsg(text) {
  S.srMsg = { text: String(text || ""), fresh: true };
}

function ensureCss() {
  if (document.querySelector("link[data-av-msg-css]")) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./messages.css", import.meta.url).href;
  link.setAttribute("data-av-msg-css", "");
  document.head.appendChild(link);
}

/* ¿Sigue esta vista en pantalla? (evita pintar encima de otra sección tras un await) */
function alive(token) {
  if (!ctx || ctx.token !== token) return false;
  const root = ctx.container.querySelector("[data-av-msg-root]");
  return Boolean(root) && root.getAttribute("data-av-msg-root") === token && document.body.contains(ctx.container);
}

async function refreshGlobal() {
  try {
    await ctx?.helpers?.refreshGlobalHeaderAndSummary?.();
  } catch {
    /* la cabecera global no es crítica para esta vista */
  }
}

/* ───────────────────────── entrada ───────────────────────── */

export async function renderMessagesView(container, appState, helpers) {
  ensureCss();
  const me = appState?.currentUser || {};
  if (S.userId !== me.id) {
    // otra sesión: no se arrastran borradores, selección ni justificaciones
    S = freshState(me.id);
  }
  S.msg = { text: "", fresh: false };
  S.srMsg = { text: "", fresh: false };
  S.scrollBottom = true;
  const token = `m${++seq}`;
  ctx = { container, appState, helpers: helpers || {}, token };
  takeAlertPrefill(appState);

  container.innerHTML = `<div class="av-console av-msg" data-av-msg-root="${token}"><div class="av-grid"><div class="av-panel av-msg-full av-msg-pad" role="status">${esc(tr(DICT).loading)}</div></div></div>`;
  try {
    await loadAll();
  } catch (e) {
    if (!alive(token)) return;
    container.innerHTML = `<div class="av-console av-msg" data-av-msg-root="${token}"><div class="av-grid"><div class="av-panel av-msg-full av-msg-pad" role="alert">${esc(fmt(tr(DICT).loadFail, { msg: errMsg(e) }))}</div></div></div>`;
    return;
  }
  if (!alive(token)) return;
  paint();
}

/* Precarga desde Alertas (app.js: pendingAlertMessagePrefill / pendingAlertCategoryPrefill) */
function takeAlertPrefill(appState) {
  const text = appState.pendingAlertMessagePrefill;
  if (text) {
    const cat = appState.pendingAlertCategoryPrefill;
    let id = Number(appState.pendingAlertIdPrefill);
    if (!Number.isInteger(id) || id <= 0) {
      // el texto precargado puede venir en español ("Alerta #") o en inglés ("Alert #")
      const m = /Alerta? #(\d+)/.exec(String(text));
      id = m ? Number(m[1]) : null;
    }
    S.pendingAlert = { id, text: String(text), category: isCategory(cat) ? cat : "HEALTH_UPDATE" };
  }
  appState.pendingAlertMessagePrefill = null;
  appState.pendingAlertCategoryPrefill = null;
  if ("pendingAlertIdPrefill" in appState) appState.pendingAlertIdPrefill = null;
}

/* ───────────────────────── datos ───────────────────────── */

async function loadAll() {
  const { appState } = ctx;
  const mission = appState.selectedMissionId;
  const [c, s] = await Promise.allSettled([
    apiService.getConversations({ mission_id: mission }),
    apiService.getSupportRequests(mission),
  ]);

  if (c.status === "fulfilled") {
    let list = c.value?.conversations || [];
    D.hiddenConvs = 0;
    if (role() === "MISSION_LEADER") {
      // el líder solo ve las conversaciones en las que participa
      const all = list.length;
      list = list.filter((x) => x.leader_id === meId());
      D.hiddenConvs = all - list.length;
    }
    D.conversations = list;
    D.convError = null;
  } else {
    D.conversations = [];
    D.convError = errMsg(c.reason);
  }

  if (s.status === "fulfilled") {
    let sups = s.value?.support_requests || [];
    D.hiddenSups = 0;
    if (role() === "MISSION_LEADER") {
      // igual que las conversaciones: el líder solo gestiona las solicitudes dirigidas a él
      const all = sups.length;
      sups = sups.filter((x) => x.leader_id === meId());
      D.hiddenSups = all - sups.length;
    }
    D.supports = sups;
    D.supError = null;
  } else {
    D.supports = [];
    D.supError = errMsg(s.reason);
  }

  const ids = D.conversations.map((x) => x.id);
  let sel = S.selectedId ?? (appState.selectedConversationId != null ? Number(appState.selectedConversationId) : null);
  if (!ids.includes(sel)) sel = ids.length ? ids[0] : null;
  setSelected(sel);

  if (S.pendingAlert && !isAdmin()) {
    const d = draft();
    d.content = S.pendingAlert.text.slice(0, MAX_LEN);
    d.category = S.pendingAlert.category;
    d.linkedAlertId = S.pendingAlert.id;
    d.replyTo = null;
    S.alert = { id: S.pendingAlert.id, text: S.pendingAlert.text, convId: S.selectedId };
    S.focusId = "av-msg-text";
  }
  S.pendingAlert = null;

  await loadThread();
}

function setSelected(id) {
  const next = id === null || id === undefined ? null : Number(id);
  if (next !== S.selectedId) {
    S.threadQuery = "";
    S.scrollBottom = true;
    S.lastMsgIds = null;
    S.lastConvId = null;
    D.thread = null;
    D.threadError = null;
  }
  S.selectedId = next;
  if (ctx) ctx.appState.selectedConversationId = next;
}

async function loadThread() {
  D.thread = null;
  D.threadError = null;
  const id = S.selectedId;
  if (!id) return;
  const admin = isAdmin();
  if (admin && !S.adminJust[id]) return; // la puerta de auditoría se pinta en threadHTML
  S.loadingThread = true;
  try {
    const res = await apiService.getConversationMessages(id, admin ? { audit_justification: S.adminJust[id] } : {});
    const conv = res?.conversation || D.conversations.find((x) => x.id === id) || {};
    D.thread = { conversation: conv, messages: res?.messages || [] };
    // refresca contadores de la lista (no en administración: la lista sigue con vista previa protegida)
    if (!admin && res?.conversation) {
      D.conversations = D.conversations.map((x) => (x.id === id ? res.conversation : x));
    }
    const ids = D.thread.messages.map((m) => m.id);
    if (S.lastMsgIds && S.lastConvId === id) {
      const fresh = D.thread.messages.filter((m) => !S.lastMsgIds.includes(m.id) && m.sender_id !== meId());
      if (fresh.length) {
        const T = tr(DICT);
        const who = fresh[fresh.length - 1].sender_name || "—";
        setMsg(fmt(T.newFrom, { x: fresh.length === 1 ? T.newOne : fmt(T.newMany, { n: fresh.length }), who }));
        S.scrollBottom = true;
      }
    }
    S.lastMsgIds = ids;
    S.lastConvId = id;
  } catch (e) {
    D.threadError = errMsg(e);
    if (admin) delete S.adminJust[id]; // justificación rechazada o acceso denegado: se vuelve a pedir
  } finally {
    S.loadingThread = false;
  }
}

/* ───────────────────────── pintado ───────────────────────── */

function paint() {
  const { container } = ctx;
  const active = document.activeElement;
  const prevFocus = active && container.contains(active) && active.id ? active.id : null;
  const prevLog = container.querySelector("#av-msg-log");
  const prevScroll = prevLog ? prevLog.scrollTop : null;

  container.innerHTML = `<div class="av-console av-msg" data-av-msg-root="${ctx.token}"><div class="av-grid">
    ${emergencyHTML()}
    ${convColHTML()}
    <section class="av-col-b" aria-label="${esc(tr(DICT).selConvAria)}">
      ${linkHTML()}
      <p id="av-msg-status" class="av-msg-status" role="status" aria-live="polite">${S.msg.fresh ? "" : esc(S.msg.text)}</p>
      ${threadHTML()}
    </section>
    ${srColHTML()}
  </div></div>`;

  const root = container.querySelector("[data-av-msg-root]");
  bind(root);
  applyConvFilter(root);
  applyThreadFilter(root);

  const log = root.querySelector("#av-msg-log");
  if (log) {
    if (S.scrollBottom) log.scrollTop = log.scrollHeight;
    else if (prevScroll !== null) log.scrollTop = prevScroll;
  }
  S.scrollBottom = false;

  const byId = (id) => (id ? root.querySelector(`#${CSS.escape(id)}`) : null);
  const target = byId(S.focusId) || byId(prevFocus);
  S.focusId = null;
  if (target) target.focus();

  // anuncios: se escriben tras insertar la región para que el lector de pantalla los lea
  const a = S.msg.fresh ? S.msg.text : null;
  const b = S.srMsg.fresh ? S.srMsg.text : null;
  S.msg.fresh = false;
  S.srMsg.fresh = false;
  if (a !== null || b !== null) {
    setTimeout(() => {
      if (a !== null) {
        const el = root.querySelector("#av-msg-status");
        if (el) el.textContent = a;
      }
      if (b !== null) {
        const el = root.querySelector("#av-msg-sr-status");
        if (el) el.textContent = b;
      }
    }, 60);
  }
}

function emergencyHTML() {
  if (!S.emergency) return "";
  const T = tr(DICT);
  const text = S.emergency.key ? T[S.emergency.key] : btLines(S.emergency.text);
  return `<div class="av-msg-full av-alarm av-alarm-W" role="alert">
    <strong style="letter-spacing:.04em;text-transform:uppercase">${esc(T.emergencyTitle)}</strong>
    <span class="av-msg-grow">${esc(text)}</span>
    <button type="button" class="av-btn" data-msg-act="dismiss-emergency" id="av-msg-emerg-ok">${esc(T.understood)}</button>
  </div>`;
}

/* ── Columna izquierda: conversaciones ── */
function convColHTML() {
  const T = tr(DICT);
  const r = role();
  const list = D.conversations;
  const statuses = Array.from(new Set(["OPEN", "PENDING_FOLLOWUP", ...list.map((c) => c.status).filter(Boolean)]));
  const totalUnread = list.reduce((n, c) => n + (Number(c.unread_count) || 0), 0);

  let body;
  if (D.convError) body = `<p class="av-msg-err" role="alert">${esc(fmt(T.convFail, { msg: D.convError }))}</p>`;
  else if (!list.length) body = `<p class="av-msg-note">${esc(T.noConvs)}</p>`;
  else body = `<ul class="av-msg-conv-list" aria-label="${esc(T.convListAria)}">${list.map(convItemHTML).join("")}</ul>
    <p class="av-msg-note" id="av-msg-conv-none" hidden>${esc(T.convNone)}</p>`;

  return `<aside class="av-panel av-col-a" aria-labelledby="av-msg-conv-h">
    <div class="av-card-head">
      <h2 class="av-h2" id="av-msg-conv-h">${esc(T.convs)}</h2>
      <span class="av-sub">${totalUnread ? fmt(esc(T.unreadTotal), { n: `<strong>${esc(totalUnread)}</strong>` }) : esc(T.noPending)}</span>
    </div>
    <p class="av-msg-note">${esc(T.channelNote)}</p>
    ${newConvHTML()}
    <div class="av-field"><label for="av-msg-conv-q">${esc(T.searchConv)}</label>
      <input type="search" id="av-msg-conv-q" class="av-input" value="${esc(S.convQuery)}" placeholder="${esc(T.searchConvPh)}" autocomplete="off"></div>
    <div class="av-field"><label for="av-msg-conv-st">${esc(T.status)}</label>
      <select id="av-msg-conv-st" class="av-input">
        <option value="">${esc(T.allStatuses)}</option>
        ${statuses.map((s) => `<option value="${esc(s)}" ${s === S.convStatus ? "selected" : ""}>${esc(convLabel(s))}</option>`).join("")}
      </select></div>
    ${body}
    ${r === "MISSION_LEADER" && D.hiddenConvs > 0 ? `<p class="av-msg-note">${esc(fmt(T.hiddenConvs, { n: D.hiddenConvs }))}</p>` : ""}
    ${r === "ADMINISTRATOR" ? `<p class="av-msg-note">${esc(T.adminNote)}</p>` : ""}
  </aside>`;
}

function convItemHTML(c) {
  const T = tr(DICT);
  const r = role();
  const sel = c.id === S.selectedId;
  const astro = `${c.astronaut_name || "—"}${c.astronaut_crew_code ? ` (${c.astronaut_crew_code})` : ""}`;
  const title = r === "ASTRONAUT" ? c.leader_name || "—" : r === "MISSION_LEADER" ? astro : `${astro} ↔ ${c.leader_name || "—"}`;
  const p = c.last_message_preview;
  const urgent = Boolean(p && p.category === "URGENT_COMMUNICATION");
  const unread = Number(c.unread_count) || 0;
  let tag = "";
  if (urgent && unread) tag = `<span class="av-badge av-b-W">${esc(T.urgentUnread)}</span>`;
  else if (urgent) tag = `<span class="av-msg-tag">${esc(T.lastUrgent)}</span>`;
  else if (c.is_highlighted && c.status === "PENDING_FOLLOWUP") tag = `<span class="av-msg-tag">${esc(T.followup)}</span>`;
  return `<li><button type="button" id="av-msg-c-${esc(c.id)}" class="av-msg-conv${urgent && unread ? " av-msg-conv-urgent" : ""}"
      data-msg-act="select-conv" data-id="${esc(c.id)}" data-status="${esc(c.status || "")}" aria-current="${sel ? "true" : "false"}">
    <span class="av-msg-conv-top"><span class="av-msg-conv-name">${esc(title)}</span>${unread ? `<span class="av-badge av-b-A">${esc(fmt(T.nUnread, { n: unread }))}</span>` : ""}</span>
    <span class="av-msg-conv-line">${esc(c.mission_code || "—")} · ${esc(convLabel(c.status))}</span>
    ${tag ? `<span class="av-msg-conv-line">${tag}</span>` : ""}
    <span class="av-msg-preview">${p ? `[${esc(catLabel(p.category))}] ${esc(btPreview(p.content))}` : esc(T.noMsgsYet)}</span>
    <span class="av-msg-conv-line">${fmt(esc(T.lastActivity), { t: timeTag(c.last_message_at) })}</span>
  </button></li>`;
}

function newConvHTML() {
  const T = tr(DICT);
  const r = role();
  if (r === "ASTRONAUT") {
    return `<button type="button" class="av-btn" id="av-msg-new" data-msg-act="new-conv">${esc(T.openWithLead)}</button>`;
  }
  if (r === "MISSION_LEADER") {
    const astros = (ctx.appState.usersList || []).filter((u) => u.role_code === "ASTRONAUT");
    const cur = S.newAstro ?? ctx.appState.selectedAstronautId;
    if (!astros.length) {
      return cur ? `<button type="button" class="av-btn" id="av-msg-new" data-msg-act="new-conv">${esc(T.openWithSelected)}</button>` : "";
    }
    return `<div class="av-field"><label for="av-msg-new-astro">${esc(T.crewForChannel)}</label>
        <select id="av-msg-new-astro" class="av-input">
          ${astros.map((u) => `<option value="${esc(u.id)}" ${Number(u.id) === Number(cur) ? "selected" : ""}>${esc(u.full_name)}${u.crew_code ? ` (${esc(u.crew_code)})` : ""}</option>`).join("")}
        </select></div>
      <button type="button" class="av-btn" id="av-msg-new" data-msg-act="new-conv">${esc(T.openChannel)}</button>`;
  }
  return "";
}

/* ── Enlace ── */
function linkHTML() {
  const T = tr(DICT);
  const L = linkInfo();
  const qTotal = offlineQueue().length;
  return `<div class="av-panel av-msg-link${L.offline ? " av-msg-link-los" : ""}" role="group" aria-label="${esc(T.linkAria)}">
    <span><span class="av-lbl">${esc(T.linkLbl)}</span><strong class="av-mono">${esc(L.label)}</strong></span>
    <span><span class="av-lbl">${esc(T.delayLbl)}</span><span class="av-mono">${esc(fmtDelay(L.delay))}</span></span>
    ${!L.offline && L.delay !== null && L.delay >= 1 ? `<span><span class="av-lbl">${esc(T.minReply)}</span><span class="av-mono">${esc(fmtDelay(L.delay * 2))}</span></span>` : ""}
    <span><span class="av-lbl">${esc(T.yourQueue)}</span><span class="av-mono">${esc(qTotal)}</span></span>
    ${!L.offline && qTotal ? `<button type="button" class="av-btn" id="av-msg-flush" data-msg-act="flush">${esc(fmt(T.flushBtn, { n: qTotal }))}</button>` : ""}
  </div>`;
}

/* ── Columna central: hilo ── */
function threadHTML() {
  const T = tr(DICT);
  const id = S.selectedId;
  if (!id) {
    return `<section class="av-panel av-msg-thread av-msg-pad"><p class="av-msg-note">${esc(D.conversations.length ? T.selectConv : T.noConvsYet)}</p></section>`;
  }
  const conv = D.thread?.conversation || D.conversations.find((x) => x.id === id) || {};
  if (isAdmin() && !S.adminJust[id]) return auditGateHTML(conv);
  if (D.threadError) {
    return `<section class="av-panel av-msg-thread av-msg-pad">
      <p class="av-msg-err" role="alert">${esc(fmt(T.threadFail, { msg: D.threadError }))}</p>
      <button type="button" class="av-btn" id="av-msg-refresh" data-msg-act="refresh">${esc(T.retry)}</button>
    </section>`;
  }
  if (!D.thread) {
    return `<section class="av-panel av-msg-thread av-msg-pad"><p class="av-msg-note">${esc(T.loadingConv)}</p></section>`;
  }

  const msgs = D.thread.messages;
  const me = meId();
  const canAct = !isAdmin();
  const unread = msgs.filter((m) => m.recipient_id === me && !readByRecipient(m)).length;
  const queued = offlineQueue().filter((q) => q.endpoint === `/conversations/${id}/messages`);

  const items = msgs.map((m) => msgHTML(m)).join("") + queued.map(queuedMsgHTML).join("");
  return `<section class="av-panel av-msg-thread" aria-labelledby="av-msg-th-h">
    <div class="av-panel-head">
      <div class="av-msg-th-title">
        <h2 class="av-h2" id="av-msg-th-h" tabindex="-1">${esc(bt(conv.subject) || T.convFallback)}</h2>
        <span class="av-sub">${esc(T.crewLbl)} <strong>${esc(conv.astronaut_name || "—")}${conv.astronaut_crew_code ? ` (${esc(conv.astronaut_crew_code)})` : ""}</strong>
          ↔ ${esc(T.leadLbl)} <strong>${esc(conv.leader_name || "—")}${conv.leader_crew_code ? ` (${esc(conv.leader_crew_code)})` : ""}</strong>
          · ${esc(conv.mission_code || "—")} · ${esc(convLabel(conv.status))}</span>
      </div>
      <div class="av-msg-tools">
        <div class="av-field"><label for="av-msg-th-q">${esc(T.searchThread)}</label>
          <input type="search" id="av-msg-th-q" class="av-input" value="${esc(S.threadQuery)}" autocomplete="off"></div>
        ${canAct && unread ? `<button type="button" class="av-btn" id="av-msg-readall" data-msg-act="read-all">${esc(fmt(T.readAll, { n: unread }))}</button>` : ""}
        <button type="button" class="av-btn" id="av-msg-refresh" data-msg-act="refresh">${esc(T.refresh)}</button>
      </div>
    </div>
    ${isAdmin() ? `<div class="av-msg-auditbar"><span class="av-badge av-b-A">${esc(T.audited)}</span>
      <span class="av-msg-grow">${esc(fmt(T.auditBar, { j: S.adminJust[id] }))}</span>
      <button type="button" class="av-btn" id="av-msg-audit-close" data-msg-act="audit-close">${esc(T.auditClose)}</button></div>` : ""}
    <div id="av-msg-log" class="av-msg-log" role="log" aria-label="${esc(T.logAria)}" tabindex="0">
      ${items ? `<ol class="av-msg-list">${items}</ol>` : `<p class="av-msg-note">${esc(T.noMsgs)}</p>`}
      <p class="av-msg-note" id="av-msg-th-none" hidden>${esc(T.noMsgMatch)}</p>
    </div>
    ${canAct ? composerHTML() : ""}
  </section>`;
}

function auditGateHTML(conv) {
  const T = tr(DICT);
  return `<section class="av-panel av-msg-thread av-msg-pad av-msg-form" aria-labelledby="av-msg-gate-h">
    <h2 class="av-h2" id="av-msg-gate-h">${esc(T.gateTitle)}</h2>
    <p class="av-sub">${esc(fmt(T.participants, { a: conv.astronaut_name || "—", l: conv.leader_name || "—", m: conv.mission_code || "—" }))}</p>
    <p class="av-msg-note">${T.gateNoteHtml}</p>
    ${D.threadError ? `<p class="av-msg-err" role="alert">${esc(fmt(T.accessDenied, { msg: D.threadError }))}</p>` : ""}
    <form data-msg-form="audit" class="av-msg-form">
      <div class="av-field"><label for="av-msg-just">${esc(T.justLabel)}</label>
        <textarea id="av-msg-just" name="just" class="av-input" rows="2" minlength="5" maxlength="500" required></textarea></div>
      <div><button type="submit" class="av-btn av-btn-primary" id="av-msg-just-go">${esc(T.justBtn)}</button></div>
    </form>
  </section>`;
}

/* ¿Lo leyó el destinatario? Un recibo de otra persona (administración o el propio remitente) no cuenta;
 * sin ningún recibo se confía en el estado del servidor (datos antiguos). */
function readByRecipient(m) {
  if (String(m.delivery_status || "").toUpperCase() !== "READ" || m.marked_unread_by_recipient) return false;
  const rr = m.read_receipts || [];
  return !rr.length || rr.some((x) => x.user_id === m.recipient_id);
}

function deliveryHTML(m, mine) {
  const T = tr(DICT);
  const st = String(m.delivery_status || "").toUpperCase();
  const code = st === "PENDING_OFFLINE_SYNC" ? "QUEUED" : st || "—";
  const receipts = m.read_receipts || [];
  // solo cuenta la confirmación del destinatario (no la de administración ni la del remitente)
  const rr = receipts.find((x) => x.user_id === m.recipient_id);
  let txt;
  if (code === "READ" && !m.marked_unread_by_recipient && !readByRecipient(m)) txt = T.dNoReceipt;
  else if (code === "READ") txt = `${mine ? T.dReadByRecipient : T.dRead}${rr ? ` ${when(rr.read_at)} GMT` : ""}`;
  else if (code === "DELIVERED") txt = T.dDelivered;
  else if (code === "SENT") txt = T.dSent;
  else if (code === "QUEUED") txt = T.dQueued;
  else txt = T.dUnknown;
  if (m.marked_unread_by_recipient) txt += T.dMarkedUnread;
  return `${esc(T.statusLbl)} <span class="av-mono">${esc(code)}</span> ${esc(txt)}`;
}

function msgHTML(m) {
  const T = tr(DICT);
  const me = meId();
  const mine = m.sender_id === me;
  const toMe = m.recipient_id === me;
  const urgent = m.category === "URGENT_COMMUNICATION";
  const unreadForMe = toMe && !readByRecipient(m);
  const canAct = !isAdmin();
  const id = esc(m.id);
  const atts = (m.attachments || []).map((a) => esc(a.file_name)).join(", ");

  let reply = "";
  if (m.reply_to_preview) {
    reply = `<button type="button" class="av-msg-replyref" data-msg-act="goto" data-target="${esc(m.reply_to_preview.id)}">${esc(fmt(T.replyToQuote, { id: m.reply_to_preview.id, c: trunc(btPreview(m.reply_to_preview.content), 100) }))}</button>`;
  } else if (m.reply_to_message_id) {
    reply = `<span class="av-sub">${esc(fmt(T.replyTo, { id: m.reply_to_message_id }))}</span>`;
  }

  let actions = "";
  if (canAct) {
    actions = `<div class="av-msg-actions">
      <button type="button" class="av-btn av-msg-act" id="av-msg-a-reply-${id}" data-msg-act="reply" data-id="${id}" aria-label="${esc(fmt(T.replyAria, { id: m.id }))}">${esc(T.reply)}</button>
      <button type="button" class="av-btn av-msg-act" id="av-msg-a-imp-${id}" data-msg-act="important" data-id="${id}" data-on="${m.is_important ? "1" : "0"}" aria-pressed="${m.is_important ? "true" : "false"}">${esc(T.important)}</button>
      ${toMe ? (unreadForMe
        ? `<button type="button" class="av-btn av-msg-act" id="av-msg-a-read-${id}" data-msg-act="read" data-id="${id}">${esc(T.markRead)}</button>`
        : `<button type="button" class="av-btn av-msg-act" id="av-msg-a-unread-${id}" data-msg-act="unread" data-id="${id}">${esc(T.markUnread)}</button>`) : ""}
    </div>`;
  }

  return `<li id="av-msg-m-${id}" class="av-msg-item${mine ? " av-msg-mine" : ""}${urgent ? " av-msg-urgent" : ""}${unreadForMe ? " av-msg-unread" : ""}" tabindex="-1">
    <div class="av-msg-meta">
      <strong>${esc(m.sender_name || "—")}</strong>
      <span class="av-sub">${esc(roleLabel(m.sender_role))}${mine ? ` · ${esc(T.you)}` : ""}</span>
      ${urgent ? `<span class="av-badge av-b-W">${esc(T.urgent)}</span>` : ""}
      <span class="av-msg-tag">${esc(catLabel(m.category))}</span>
      ${m.is_important ? `<span class="av-msg-tag">${esc(T.important)}</span>` : ""}
      ${unreadForMe ? `<span class="av-badge av-b-A">${esc(T.unread)}</span>` : ""}
      <span class="av-msg-time">#${id} · ${timeTag(m.created_at)} GMT</span>
    </div>
    ${reply}
    <div class="av-msg-body">${esc(msgText(m.content))}</div>
    ${atts ? `<span class="av-sub">${fmt(esc(T.attachment), { a: atts })}</span>` : ""}
    ${m.linked_alert_id ? `<span class="av-sub">${esc(fmt(T.linkedAlert, { id: m.linked_alert_id }))}</span>` : ""}
    <div class="av-msg-foot"><span>${deliveryHTML(m, mine)}</span>${actions}</div>
  </li>`;
}

function queuedMsgHTML(q) {
  const T = tr(DICT);
  const p = q.payload || {};
  const me = ctx.appState.currentUser || {};
  const urgent = p.category === "URGENT_COMMUNICATION";
  return `<li class="av-msg-item av-msg-mine av-msg-queued${urgent ? " av-msg-urgent" : ""}">
    <div class="av-msg-meta">
      <strong>${esc(me.full_name || "—")}</strong><span class="av-sub">${esc(T.you)}</span>
      ${urgent ? `<span class="av-badge av-b-W">${esc(T.urgent)}</span>` : ""}
      <span class="av-msg-tag">${esc(catLabel(p.category))}</span>
      ${p.is_important ? `<span class="av-msg-tag">${esc(T.important)}</span>` : ""}
      <span class="av-msg-time">${fmt(esc(T.queuedSince), { t: timeTag(q.queued_at) })}</span>
    </div>
    ${p.reply_to_message_id ? `<span class="av-sub">${esc(fmt(T.replyTo, { id: p.reply_to_message_id }))}</span>` : ""}
    <div class="av-msg-body">${esc(p.content)}</div>
    ${p.attachment_file_name ? `<span class="av-sub">${esc(fmt(T.attachment, { a: p.attachment_file_name }))}</span>` : ""}
    <div class="av-msg-foot"><span>${esc(T.statusLbl)} <span class="av-mono">QUEUED</span> ${esc(T.queuedMsgFoot)}</span></div>
  </li>`;
}

function composerHTML() {
  const T = tr(DICT);
  const d = draft();
  const L = linkInfo();
  const urgent = d.category === "URGENT_COMMUNICATION";
  const showAlert = S.alert && S.alert.convId === S.selectedId;
  let linkNote = "";
  if (L.offline) {
    linkNote = `<p class="av-msg-offline" role="note">${T.offlineMsgHtml}</p>`;
  } else if (L.delay !== null && L.delay >= 1) {
    const eta = new Date(Date.now() + L.delay * 1000);
    linkNote = `<p class="av-msg-note" role="note">${fmt(esc(T.delayNote), { d: esc(fmtDelay(L.delay)), eta: `<span class="av-mono">${esc(when(eta))}</span>`, d2: esc(fmtDelay(L.delay * 2)) })}</p>`;
  }
  return `<form class="av-msg-composer" data-msg-form="send" aria-labelledby="av-msg-comp-h">
    <h3 class="av-h3" id="av-msg-comp-h">${esc(T.newMessage)}</h3>
    ${showAlert ? `<div class="av-msg-alertnote"><span class="av-msg-grow">${fmt(esc(T.alertNote), { id: S.alert.id ? ` #${esc(S.alert.id)}` : "" })}</span>
      ${role() === "ASTRONAUT" ? `<button type="button" class="av-btn" id="av-msg-alert-sr" data-msg-act="alert-to-sr">${esc(T.toSr)}</button>` : ""}
      <button type="button" class="av-btn" id="av-msg-alert-clear" data-msg-act="alert-clear">${esc(T.discard)}</button></div>` : ""}
    ${d.replyTo ? `<div class="av-msg-replybar"><span class="av-msg-grow">${esc(fmt(T.replying, { id: d.replyTo, p: d.replyPreview }))}</span>
      <button type="button" class="av-btn" id="av-msg-cancel-reply" data-msg-act="cancel-reply">${esc(T.cancelReply)}</button></div>` : ""}
    ${linkNote}
    <div class="av-form-grid">
      <div class="av-field"><label for="av-msg-cat">${esc(T.categoryLbl)}</label>
        <select id="av-msg-cat" name="category" class="av-input">
          ${CATEGORY_CODES.map((code) => `<option value="${esc(code)}" ${code === d.category ? "selected" : ""}>${esc(T.category[code])}</option>`).join("")}
        </select></div>
      <div class="av-field"><label for="av-msg-att">${esc(T.attLbl)}</label>
        <input type="text" id="av-msg-att" name="attachment" class="av-input" maxlength="180" value="${esc(d.attachment)}" placeholder="${esc(T.attPh)}" autocomplete="off"></div>
    </div>
    <p id="av-msg-urgent-note" class="av-msg-urgent-note" ${urgent ? "" : "hidden"}><span class="av-badge av-b-W">${esc(T.urgent)}</span>
      <span>${esc(T.urgentNote)}</span></p>
    <label class="av-msg-check"><input type="checkbox" id="av-msg-imp" name="important" ${d.important ? "checked" : ""}> ${esc(T.markImportant)}</label>
    <div class="av-field"><label for="av-msg-text">${esc(T.messageLbl)}</label>
      <textarea id="av-msg-text" name="content" class="av-input av-msg-textarea" rows="3" maxlength="${MAX_LEN}" required aria-describedby="av-msg-count">${esc(d.content)}</textarea></div>
    <div class="av-msg-send-row">
      <span id="av-msg-count" class="av-sub av-mono">${esc(counterText(d.content.length))}</span>
      <button type="submit" class="av-btn av-btn-primary" id="av-msg-send">${esc(L.offline ? T.queueBtn : T.send)}</button>
    </div>
  </form>`;
}
function counterText(n) {
  return fmt(tr(DICT).counter, { n, max: MAX_LEN });
}

/* ── Columna derecha: solicitudes de apoyo ── */
function srColHTML() {
  const T = tr(DICT);
  const r = role();
  const all = D.supports;
  const list = S.srFilter ? all.filter((s) => s.status === S.srFilter) : all;
  const queued = r === "ASTRONAUT" ? offlineQueue().filter((q) => q.endpoint === "/support-requests") : [];
  const urgentOpen = all.filter((s) => (s.is_emergency || s.status === "ESCALATED") && s.status !== "CLOSED").length;

  let body;
  if (D.supError) body = `<p class="av-msg-err" role="alert">${esc(fmt(T.srFail, { msg: D.supError }))}</p>`;
  else if (!list.length && !queued.length) body = `<p class="av-msg-note">${esc(S.srFilter ? T.srNoneStatus : T.srNone)}</p>`;
  else body = `<ul class="av-msg-sr-list">${queued.map(queuedSrHTML).join("")}${list.map(srItemHTML).join("")}</ul>`;

  return `<aside class="av-col-c" aria-label="${esc(T.srs)}">
    ${r === "ASTRONAUT" ? srCreateHTML() : ""}
    <section class="av-panel" aria-labelledby="av-msg-sr-h">
      <div class="av-panel-head">
        <h2 class="av-h2" id="av-msg-sr-h">${esc(T.srs)}</h2>
        <span class="av-sub">${esc(T.total)} <span class="av-mono">${esc(all.length)}</span>${r === "ADMINISTRATOR" ? esc(T.readOnly) : ""}${urgentOpen ? ` · <span class="av-badge av-b-W">${esc(urgentOpen)} ${esc(urgentOpen > 1 ? T.urgentMany : T.urgentOne)}</span>` : ""}</span>
      </div>
      <div class="av-msg-pad av-msg-form">
        <div class="av-field"><label for="av-msg-sr-filter">${esc(T.filterStatus)}</label>
          <select id="av-msg-sr-filter" class="av-input">
            <option value="">${esc(T.allStatuses)}</option>
            ${SR_STATUSES.map((s) => `<option value="${esc(s)}" ${s === S.srFilter ? "selected" : ""}>${esc(srLabel(s))}</option>`).join("")}
          </select></div>
        <p id="av-msg-sr-status" class="av-msg-status" role="status" aria-live="polite">${S.srMsg.fresh ? "" : esc(S.srMsg.text)}</p>
        ${body}
        ${r === "MISSION_LEADER" && D.hiddenSups > 0 ? `<p class="av-msg-note">${esc(fmt(T.hiddenSups, { n: D.hiddenSups }))}</p>` : ""}
      </div>
    </section>
  </aside>`;
}

function srCreateHTML() {
  const T = tr(DICT);
  const f = S.srDraft;
  const L = linkInfo();
  return `<section class="av-panel" aria-labelledby="av-msg-src-h">
    <div class="av-panel-head">
      <h2 class="av-h2" id="av-msg-src-h">${esc(T.requestSupport)}</h2>
      <button type="button" class="av-btn" id="av-msg-sr-toggle" data-msg-act="sr-toggle" aria-expanded="${S.srOpen ? "true" : "false"}" aria-controls="av-msg-sr-form">${esc(S.srOpen ? T.hideForm : T.newRequest)}</button>
    </div>
    <form id="av-msg-sr-form" data-msg-form="sr-create" class="av-msg-pad av-msg-form" ${S.srOpen ? "" : "hidden"}>
      <p class="av-msg-note">${esc(T.srIntro)}</p>
      <div class="av-field"><label for="av-msg-sr-cat">${esc(T.reason)}</label>
        <select id="av-msg-sr-cat" name="category" class="av-input">
          ${SR_CATEGORY_CODES.map((c) => `<option value="${esc(c)}" ${c === f.category ? "selected" : ""}>${esc(T.srCategory[c])}</option>`).join("")}
        </select></div>
      <div class="av-field"><label for="av-msg-sr-title">${esc(T.shortReason)}</label>
        <input type="text" id="av-msg-sr-title" name="title" class="av-input" minlength="3" maxlength="180" required value="${esc(f.title)}" autocomplete="off"></div>
      <div class="av-field"><label for="av-msg-sr-desc">${esc(T.description)}</label>
        <textarea id="av-msg-sr-desc" name="desc" class="av-input" rows="3" minlength="3" maxlength="4000" required>${esc(f.desc)}</textarea></div>
      <label class="av-msg-check"><input type="checkbox" name="priv" id="av-msg-sr-priv" ${f.priv ? "checked" : ""}> ${esc(T.wantPrivate)}</label>
      <label class="av-msg-check"><input type="checkbox" name="emergency" id="av-msg-sr-emerg" ${f.emergency ? "checked" : ""}> ${esc(T.isEmergency)}</label>
      ${L.offline ? `<p class="av-msg-offline" role="note">${T.offlineSrHtml}</p>` : ""}
      <div><button type="submit" class="av-btn av-btn-primary" id="av-msg-sr-send">${esc(L.offline ? T.queueSr : T.sendSr)}</button></div>
    </form>
  </section>`;
}

function lifecycleHTML(st) {
  const T = tr(DICT);
  const idx = SR_FLOW.indexOf(st);
  return `<ol class="av-msg-life" aria-label="${esc(T.lifeAria)}">${SR_FLOW.map((s, i) => {
    const cur = s === st;
    const done = idx >= 0 && i < idx;
    return `<li class="${done ? "av-msg-life-done" : ""}" ${cur ? 'aria-current="step"' : ""}>${esc(srLabel(s))}${done ? `<span class="av-msg-vh">${esc(T.completed)}</span>` : ""}</li>`;
  }).join("")}</ol>`;
}

function srItemHTML(sr) {
  const T = tr(DICT);
  const r = role();
  const id = esc(sr.id);
  const st = String(sr.status || "");
  const urgent = Boolean(sr.is_emergency) || st === "ESCALATED";
  const open = st !== "CLOSED";
  const convOk = sr.conversation_id && D.conversations.some((c) => c.id === sr.conversation_id);
  const who = r === "ASTRONAUT"
    ? esc(fmt(T.leadWho, { n: sr.leader_name || "—" }))
    : `${esc(sr.astronaut_name || "—")}${sr.astronaut_crew_code ? ` (${esc(sr.astronaut_crew_code)})` : ""}`;

  // administración: solo lectura; el contenido (motivo, descripción, nota) solo con acceso auditado a su conversación
  const admin = r === "ADMINISTRATOR";
  const hidden = admin && !(sr.conversation_id && S.adminJust[sr.conversation_id]);
  const PROT = `<span class="av-sub">${esc(T.protected)}</span>`;

  let manage = "";
  if (r === "MISSION_LEADER") {
    manage = `<details><summary>${esc(fmt(T.manage, { id: sr.id }))}</summary>
      <form data-msg-form="sr-update" data-id="${id}" class="av-msg-form">
        <div class="av-field"><label for="av-msg-sr-st-${id}">${esc(T.newStatus)}</label>
          <select id="av-msg-sr-st-${id}" name="status" class="av-input">
            ${SR_STATUSES.map((s) => `<option value="${esc(s)}" ${s === st ? "selected" : ""}>${esc(srLabel(s))} (${esc(s)})</option>`).join("")}
          </select></div>
        <div class="av-field"><label for="av-msg-sr-n-${id}">${esc(T.respNote)}</label>
          <textarea id="av-msg-sr-n-${id}" name="notes" class="av-input" rows="2" maxlength="2000"></textarea></div>
        <div><button type="submit" class="av-btn" id="av-msg-sr-go-${id}">${esc(T.updateStatus)}</button></div>
      </form></details>`;
  } else if (r === "ASTRONAUT" && open) {
    manage = `<div><button type="button" class="av-btn" id="av-msg-sr-close-${id}" data-msg-act="sr-close" data-id="${id}">${esc(T.closeSr)}</button></div>`;
  }

  return `<li class="av-msg-sr${urgent ? " av-msg-sr-urgent" : ""}" id="av-msg-sr-${id}" tabindex="-1">
    <div class="av-card-head">
      <h3 class="av-h3">#${id} · ${hidden ? esc(T.privateSr) : esc(sr.reason_title || "—")}</h3>
      ${urgent ? `<span class="av-badge av-b-W">${esc(sr.is_emergency ? T.emergency : T.escalated)}</span>` : ""}
    </div>
    <span class="av-sub">${esc(catLabel(sr.category))} · ${who}${admin ? ` ↔ ${esc(sr.leader_name || "—")}` : ""}</span>
    <p>${esc(T.statusLbl)} <strong>${esc(srLabel(st))}</strong> <span class="av-mono av-sub">${esc(st)}</span></p>
    ${lifecycleHTML(st)}
    <p class="av-msg-sr-desc">${hidden ? PROT : esc(sr.description)}</p>
    <p class="av-msg-sr-desc"><span class="av-lbl">${esc(T.leadResponse)}</span><br>${hidden ? PROT : sr.leader_response_notes ? esc(sr.leader_response_notes) : `<span class="av-sub">${esc(T.noResponse)}</span>`}</p>
    <span class="av-sub">${fmt(esc(T.createdUpdated), { t: timeTag(sr.created_at), u: timeTag(sr.updated_at) })}${sr.wants_private_conversation ? esc(T.askedPrivate) : ""}</span>
    ${convOk ? `<div><button type="button" class="av-btn" id="av-msg-sr-conv-${id}" data-msg-act="select-conv" data-id="${esc(sr.conversation_id)}">${esc(T.openConv)}</button></div>` : ""}
    ${manage}
  </li>`;
}

function queuedSrHTML(q) {
  const T = tr(DICT);
  const p = q.payload || {};
  return `<li class="av-msg-sr av-msg-queued${p.is_emergency ? " av-msg-sr-urgent" : ""}">
    <div class="av-card-head"><h3 class="av-h3">${esc(p.reason_title || "—")}</h3>
      ${p.is_emergency ? `<span class="av-badge av-b-W">${esc(T.emergency)}</span>` : ""}</div>
    <span class="av-sub">${fmt(esc(T.queuedSrSince), { cat: esc(catLabel(p.category)), t: timeTag(q.queued_at) })}</span>
    <p>${esc(T.statusLbl)} <span class="av-mono">QUEUED</span> ${esc(T.queuedSrFoot)}</p>
    <p class="av-msg-sr-desc">${esc(p.description)}</p>
  </li>`;
}

/* ───────────────────────── filtros sin repintar ───────────────────────── */

function applyConvFilter(root) {
  const q = S.convQuery.trim().toLowerCase();
  const st = S.convStatus;
  const items = root.querySelectorAll(".av-msg-conv");
  let shown = 0;
  items.forEach((btn) => {
    const ok = (!q || btn.textContent.toLowerCase().includes(q)) && (!st || btn.getAttribute("data-status") === st);
    btn.parentElement.hidden = !ok;
    if (ok) shown += 1;
  });
  const none = root.querySelector("#av-msg-conv-none");
  if (none) none.hidden = !(items.length && !shown);
}

function applyThreadFilter(root) {
  const q = S.threadQuery.trim().toLowerCase();
  const items = root.querySelectorAll(".av-msg-item");
  let shown = 0;
  items.forEach((li) => {
    const ok = !q || li.textContent.toLowerCase().includes(q);
    li.hidden = !ok;
    if (ok) shown += 1;
  });
  const none = root.querySelector("#av-msg-th-none");
  if (none) none.hidden = !(items.length && !shown);
}

/* ───────────────────────── eventos ───────────────────────── */

function bind(root) {
  root.addEventListener("click", onClick);
  root.addEventListener("submit", onSubmit);
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
}

/* Ejecuta una acción asíncrona con bloqueo anti doble clic y repinta si la vista sigue viva */
async function run(el, fn) {
  if (S.busy) return;
  S.busy = true;
  const token = ctx.token;
  if (el) el.disabled = true;
  let repaint = true;
  try {
    repaint = (await fn(token)) !== false;
  } catch (e) {
    setMsg(fmt(tr(DICT).actionFail, { msg: errMsg(e) }));
  } finally {
    S.busy = false;
  }
  if (!alive(token)) return;
  if (repaint) paint();
  else if (el && el.isConnected) el.disabled = false;
}

function onClick(ev) {
  const el = ev.target.closest("[data-msg-act]");
  if (!el || !ev.currentTarget.contains(el)) return;
  const act = el.getAttribute("data-msg-act");
  const id = Number(el.getAttribute("data-id"));
  const T = tr(DICT);

  switch (act) {
    case "select-conv":
      if (!Number.isFinite(id) || id <= 0) return;
      run(el, async () => {
        setSelected(id);
        S.focusId = `av-msg-c-${id}`;
        await loadThread();
      });
      break;

    case "new-conv":
      run(el, async () => {
        const { appState } = ctx;
        const payload = { mission_id: appState.selectedMissionId, is_simulated: true };
        if (role() === "MISSION_LEADER") {
          const sel = ctx.container.querySelector("#av-msg-new-astro");
          payload.astronaut_id = Number(sel ? sel.value : appState.selectedAstronautId) || null;
        } else {
          payload.astronaut_id = appState.selectedAstronautId || null;
        }
        const res = await apiService.createOrGetConversation(payload);
        if (res?.conversation?.id) {
          setSelected(res.conversation.id);
          // si había un borrador sin conversación (p. ej. precargado desde una alerta), pasa al canal abierto
          const orphan = S.drafts.none;
          const target = draft();
          if (orphan && orphan.content && !target.content) {
            S.drafts[String(S.selectedId)] = orphan;
            delete S.drafts.none;
            if (S.alert && S.alert.convId === null) S.alert.convId = S.selectedId;
          }
        }
        setMsg(res?.created ? tr(DICT).channelCreated : tr(DICT).channelOpened);
        S.focusId = "av-msg-new";
        await loadAll();
      });
      break;

    case "refresh":
      run(el, async () => {
        await loadAll();
        S.focusId = "av-msg-refresh";
      });
      break;

    case "flush":
      run(el, async () => {
        const res = await flushMine();
        setMsg(
          fmt(tr(DICT).flushed, { s: res?.synced ?? 0, r: res?.remaining ?? 0 }) +
            (res?.rejected || []).map((x) => fmt(tr(DICT).flushRejected, { reason: x.reason, text: trunc(x.text || "—", 60) })).join("")
        );
        S.scrollBottom = true;
        await loadAll();
        await refreshGlobal();
      });
      break;

    case "reply": {
      const m = (D.thread?.messages || []).find((x) => x.id === id);
      if (!m) return;
      const d = draft();
      d.replyTo = m.id;
      d.replyPreview = trunc(msgText(m.content), 80);
      S.focusId = "av-msg-text";
      paint();
      break;
    }

    case "cancel-reply": {
      const d = draft();
      d.replyTo = null;
      d.replyPreview = "";
      S.focusId = "av-msg-text";
      paint();
      break;
    }

    case "goto": {
      const t = el.getAttribute("data-target");
      const target = t ? ev.currentTarget.querySelector(`#${CSS.escape(`av-msg-m-${t}`)}`) : null;
      if (target && !target.hidden) {
        target.scrollIntoView({ block: "center" });
        target.focus();
      } else {
        setMsg(T.gotoMissing);
        paint();
      }
      break;
    }

    case "important":
      run(el, async () => {
        const on = el.getAttribute("data-on") === "1";
        await apiService.updateMessageFlags(id, { is_important: !on });
        setMsg(fmt(on ? tr(DICT).impOff : tr(DICT).impOn, { id }));
        S.focusId = `av-msg-a-imp-${id}`;
        await loadThread();
      });
      break;

    case "read":
      run(el, async () => {
        await apiService.markMessageRead(id);
        setMsg(fmt(tr(DICT).readOk, { id }));
        S.focusId = `av-msg-a-unread-${id}`;
        await loadThread();
        await refreshGlobal();
      });
      break;

    case "unread":
      run(el, async () => {
        await apiService.updateMessageFlags(id, { marked_unread_by_recipient: true });
        setMsg(fmt(tr(DICT).unreadOk, { id }));
        S.focusId = `av-msg-a-read-${id}`;
        await loadThread();
        await refreshGlobal();
      });
      break;

    case "read-all":
      run(el, async () => {
        const me = meId();
        const pending = (D.thread?.messages || []).filter((m) => m.recipient_id === me && !readByRecipient(m));
        let ok = 0;
        for (const m of pending) {
          try {
            await apiService.markMessageRead(m.id);
            ok += 1;
          } catch {
            /* se informa en el recuento */
          }
        }
        setMsg(fmt(tr(DICT).readAllOk, { ok, n: pending.length }));
        S.focusId = "av-msg-refresh";
        await loadThread();
        await refreshGlobal();
      });
      break;

    case "dismiss-emergency":
      S.emergency = null;
      S.focusId = "av-msg-conv-q";
      paint();
      break;

    case "audit-close":
      delete S.adminJust[S.selectedId];
      D.thread = null;
      setMsg(T.auditClosed);
      S.focusId = "av-msg-just";
      paint();
      break;

    case "sr-toggle":
      S.srOpen = !S.srOpen;
      S.focusId = S.srOpen ? "av-msg-sr-cat" : "av-msg-sr-toggle";
      paint();
      break;

    case "sr-close":
      run(el, async () => {
        await apiService.updateSupportRequestStatus(id, "CLOSED", "");
        setSrMsg(fmt(tr(DICT).srClosed, { id }));
        S.focusId = "av-msg-sr-filter";
        await loadAll();
        await refreshGlobal();
      });
      break;

    case "alert-to-sr": {
      if (!S.alert) return;
      S.srOpen = true;
      S.srDraft = {
        category: "HEALTH_UPDATE",
        title: (S.alert.id ? fmt(T.alertSrTitle, { id: S.alert.id }) : T.alertSrTitleNoId).slice(0, 180),
        desc: S.alert.text.slice(0, 4000),
        priv: true,
        emergency: false,
      };
      S.focusId = "av-msg-sr-title";
      paint();
      break;
    }

    case "alert-clear": {
      const d = draft();
      if (S.alert && d.content === S.alert.text.slice(0, MAX_LEN)) d.content = "";
      d.linkedAlertId = null;
      S.alert = null;
      S.focusId = "av-msg-text";
      paint();
      break;
    }

    default:
      break;
  }
}

function onSubmit(ev) {
  const form = ev.target.closest("form[data-msg-form]");
  if (!form || !ev.currentTarget.contains(form)) return;
  ev.preventDefault();
  const kind = form.getAttribute("data-msg-form");
  const btn = form.querySelector('button[type="submit"]');
  if (kind === "send") submitMessage(form, btn);
  else if (kind === "audit") submitAudit(form, btn);
  else if (kind === "sr-create") submitSupport(form, btn);
  else if (kind === "sr-update") submitSupportUpdate(form, btn);
}

function submitMessage(form, btn) {
  const d = draft();
  d.content = form.querySelector("#av-msg-text")?.value ?? d.content;
  const content = d.content.trim();
  if (!content) {
    setMsg(tr(DICT).writeFirst);
    S.focusId = "av-msg-text";
    paint();
    return;
  }
  const convId = S.selectedId;
  if (!convId) return;
  const payload = {
    content: content.slice(0, MAX_LEN),
    category: isCategory(d.category) ? d.category : "GENERAL",
    is_important: Boolean(d.important),
    reply_to_message_id: d.replyTo || null,
    attachment_file_name: d.attachment.trim() || null,
    linked_alert_id: d.linkedAlertId || null,
    is_simulated: true,
  };
  run(btn, async () => {
    const L = linkInfo();
    const endpoint = `/conversations/${convId}/messages`;
    let res;
    try {
      // sin enlace (contexto de misión o corte simulado): se encola con propietario, sin intentar el envío
      if (L.offline) res = queueLocal(endpoint, payload, "MSG-OFFLINE");
      else res = await apiService.sendMessage(convId, payload);
    } catch (e) {
      if (!isNetworkError(e)) {
        setMsg(fmt(tr(DICT).sendFail, { msg: errMsg(e) }));
        S.focusId = "av-msg-text";
        return true;
      }
      res = queueLocal(endpoint, payload, "MSG-OFFLINE"); // fallo de red: se trata como pérdida de enlace
    }

    const T = tr(DICT);
    if (res?.queued_offline) {
      if (payload.category === "URGENT_COMMUNICATION") S.emergency = { key: "localUrgentMsg" };
      setMsg(fmt(T.queuedMsg, { n: res.queue_size ?? "?" }));
    } else if (res?.server_confirmed_delivery || res?.message) {
      if (res.urgent_protocol_notice) S.emergency = { text: res.urgent_protocol_notice };
      const t = res.message?.sent_at || res.message?.created_at;
      setMsg(res.duplicate_prevented
        ? T.dupMsg
        : fmt(T.confirmedMsg, { at: t ? fmt(T.atGmt, { t: when(t) }) : "" }));
    } else {
      setMsg(T.unexpected);
    }
    if (S.alert && S.alert.convId === convId) S.alert = null;
    S.drafts[String(convId)] = newDraft();
    S.scrollBottom = true;
    S.focusId = "av-msg-text";
    await loadAll();
    await refreshGlobal();
    return true;
  });
}

function submitAudit(form, btn) {
  const val = String(form.querySelector("#av-msg-just")?.value || "").trim();
  if (val.length < 5) {
    setMsg(tr(DICT).justInvalid);
    S.focusId = "av-msg-just";
    paint();
    return;
  }
  const id = S.selectedId;
  run(btn, async () => {
    S.adminJust[id] = val.slice(0, 500);
    S.scrollBottom = true;
    await loadThread();
    if (S.adminJust[id]) {
      setMsg(tr(DICT).auditGranted);
      S.focusId = "av-msg-th-h";
    } else {
      S.focusId = "av-msg-just";
    }
  });
}

function submitSupport(form, btn) {
  const f = S.srDraft;
  f.category = form.querySelector("#av-msg-sr-cat")?.value || f.category;
  f.title = form.querySelector("#av-msg-sr-title")?.value ?? f.title;
  f.desc = form.querySelector("#av-msg-sr-desc")?.value ?? f.desc;
  f.priv = Boolean(form.querySelector("#av-msg-sr-priv")?.checked);
  f.emergency = Boolean(form.querySelector("#av-msg-sr-emerg")?.checked);
  const title = f.title.trim();
  const desc = f.desc.trim();
  if (title.length < 3 || desc.length < 3) {
    setSrMsg(tr(DICT).srIncomplete);
    S.focusId = title.length < 3 ? "av-msg-sr-title" : "av-msg-sr-desc";
    paint();
    return;
  }
  const payload = {
    mission_id: ctx.appState.selectedMissionId || null,
    category: f.category,
    reason_title: title.slice(0, 180),
    description: desc.slice(0, 4000),
    wants_private_conversation: f.priv,
    is_emergency: f.emergency,
    is_simulated: true,
  };
  run(btn, async () => {
    const L = linkInfo();
    let res = null;
    let queued = null;
    try {
      if (L.offline) queued = queueLocal("/support-requests", payload, "SR-OFFLINE");
      else res = await apiService.createSupportRequest(payload);
    } catch (e) {
      if (!isNetworkError(e)) {
        setSrMsg(fmt(tr(DICT).srSendFail, { msg: errMsg(e) }));
        S.focusId = "av-msg-sr-send";
        return true;
      }
      queued = queueLocal("/support-requests", payload, "SR-OFFLINE");
    }

    const T = tr(DICT);
    if (queued) {
      if (payload.is_emergency) S.emergency = { key: "localEmergency" };
      setSrMsg(fmt(T.srQueued, { n: queued.queue_size ?? "?" }));
    } else {
      const sr = res?.support_request;
      if (res?.emergency_protocol_instructions) S.emergency = { text: res.emergency_protocol_instructions };
      setSrMsg(sr
        ? fmt(T.srOk, { id: sr.id, lead: sr.leader_name || T.yourLead, st: srLabel(sr.status) })
        : T.srOkNoData);
      if (sr?.conversation_id) setSelected(sr.conversation_id);
      S.scrollBottom = true;
    }
    S.srDraft = newSrDraft();
    S.srOpen = false;
    if (S.alert) S.alert = null;
    S.focusId = "av-msg-sr-toggle";
    await loadAll();
    await refreshGlobal();
    return true;
  });
}

function submitSupportUpdate(form, btn) {
  const id = Number(form.getAttribute("data-id"));
  const status = String(form.querySelector('[name="status"]')?.value || "");
  const notes = String(form.querySelector('[name="notes"]')?.value || "").trim().slice(0, 2000);
  if (!SR_STATUSES.includes(status) || !Number.isFinite(id)) return;
  run(btn, async () => {
    await apiService.updateSupportRequestStatus(id, status, notes);
    const T = tr(DICT);
    setSrMsg(fmt(T.srUpdated, { id, st: srLabel(status), code: status, note: notes ? T.noteRecorded : "" }));
    S.focusId = `av-msg-sr-${id}`;
    await loadAll();
    await refreshGlobal();
  });
}

function onInput(ev) {
  const t = ev.target;
  const root = ev.currentTarget;
  switch (t.id) {
    case "av-msg-conv-q":
      S.convQuery = t.value;
      applyConvFilter(root);
      break;
    case "av-msg-th-q":
      S.threadQuery = t.value;
      applyThreadFilter(root);
      break;
    case "av-msg-text": {
      draft().content = t.value;
      const c = root.querySelector("#av-msg-count");
      if (c) c.textContent = counterText(t.value.length);
      break;
    }
    case "av-msg-att":
      draft().attachment = t.value;
      break;
    case "av-msg-sr-title":
      S.srDraft.title = t.value;
      break;
    case "av-msg-sr-desc":
      S.srDraft.desc = t.value;
      break;
    default:
      break;
  }
}

function onChange(ev) {
  const t = ev.target;
  const root = ev.currentTarget;
  switch (t.id) {
    case "av-msg-conv-st":
      S.convStatus = t.value;
      applyConvFilter(root);
      break;
    case "av-msg-cat": {
      draft().category = t.value;
      const note = root.querySelector("#av-msg-urgent-note");
      if (note) note.hidden = t.value !== "URGENT_COMMUNICATION";
      break;
    }
    case "av-msg-imp":
      draft().important = t.checked;
      break;
    case "av-msg-new-astro":
      S.newAstro = Number(t.value) || null;
      break;
    case "av-msg-sr-filter":
      S.srFilter = t.value;
      S.focusId = "av-msg-sr-filter";
      paint();
      break;
    case "av-msg-sr-cat":
      S.srDraft.category = t.value;
      break;
    case "av-msg-sr-priv":
      S.srDraft.priv = t.checked;
      break;
    case "av-msg-sr-emerg":
      S.srDraft.emergency = t.checked;
      break;
    default:
      break;
  }
}
