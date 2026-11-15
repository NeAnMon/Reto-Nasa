/*
 * AstroVital · Consola · Vista "Mensajes" (centro de comunicación)
 *
 * Sustituye a renderCommunicationCenter (app/expansion_views.js) con el diseño de la consola:
 *  - lista de conversaciones 1-a-1 (tripulante ↔ líder en Tierra asignado) con no leídos y última actividad GMT
 *  - hilo con remitente, rol, categoría, GMT, estado de entrega en texto y referencia de respuesta
 *  - redacción con 8 categorías, adjunto por nombre, "importante", contador de caracteres
 *  - cola local sin enlace: NUNCA se muestra como entregado hasta que el servidor lo confirme
 *  - confirmaciones de lectura (leído / no leído / todo leído)
 *  - solicitudes de apoyo con ciclo REQUESTED → RECEIVED → IN_REVIEW → RESPONDED → CLOSED (+ ESCALATED)
 *  - administración: lectura del contenido solo con justificación auditada (por conversación) y en modo lectura
 *  - canal familiar "Conexión con Tierra" (docs/CONTRATO_AISLAMIENTO.md §4): selector Misión / Familia
 *    (ASTRONAUT; FAMILY_MEMBER solo Familia), contactos, texto + fotos (redimensionadas en cliente) +
 *    notas de voz (MediaRecorder), "guardar y enviar" sin streaming, retardo estimado según el entorno.
 *    Sin enlace, el texto va a la cola local existente y los archivos a IndexedDB (por owner_id); se suben
 *    al transmitir la cola, antes de enviar el mensaje. Administración nunca lee conversaciones FAMILY.
 *
 * Seguridad: todo texto de usuario o de la API pasa por escapeHtml (también en atributos) o textContent.
 * Los adjuntos se descargan con fetch autenticado → URL.createObjectURL (nunca la URL cruda).
 * Eventos: atributos propios data-msg-act / data-msg-form (no data-act/data-nav/data-form, que usa
 * el manejador delegado de console.js sobre el mismo contenedor). Los oyentes se enlazan a la raíz
 * de esta vista en cada pintado, así que mueren con ella. No hay sondeo; el único temporizador es el
 * contador de la grabación de voz, que se detiene (y libera el micrófono) si la vista deja de estar en pantalla.
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
    role: { ASTRONAUT: "Tripulante", MISSION_LEADER: "Líder en Tierra", ADMINISTRATOR: "Administración", FAMILY_MEMBER: "Familiar" },
    /* Canal familiar "Conexión con Tierra" */
    fam: {
      chAria: "Canal de mensajes",
      chMission: "Misión",
      chFamily: "Familia",
      title: "Conexión con Tierra",
      intro: "Mensajes, fotos y notas de voz con tus seres queridos. Se guardan y se envían: no hay llamadas en directo por el retardo de comunicación.",
      introFamily: "Mensajes, fotos y notas de voz con tu astronauta. Se guardan y se envían: no hay llamadas en directo por el retardo de comunicación.",
      contactsAria: "Contactos familiares",
      contactsFail: "No se pudieron cargar los contactos: {msg}",
      noContacts: "No hay contactos familiares autorizados.",
      contactNoConv: "Conversación no disponible todavía.",
      selectContact: "Elige a un familiar para ver la conversación y escribir.",
      attOnly: "[Adjunto]",
      privacy: "Solo tú y {name} pueden ver esta conversación.",
      privacyMore: "El equipo de misión y administración no tienen acceso a su contenido ni a sus adjuntos.",
      emptyThread: "Aún no hay mensajes. Escribe el primero: se entregará cuando haya enlace.",
      newMessage: "Nuevo mensaje",
      delayNow: "Llegará casi al instante.",
      delayEta: "Llegará en ~{d}.",
      delayMars: "Llegará en ~4–24 min (según la posición de Marte).",
      offlineHtml: "<strong>Sin enlace: se guardará y se enviará en el próximo contacto.</strong> Las fotos y notas de voz quedan en este dispositivo y el mensaje no figurará como entregado hasta que el servidor lo confirme.",
      toolsAria: "Añadir foto o nota de voz",
      photoPick: "Elegir foto",
      photoTake: "Sacar foto",
      voiceRec: "Grabar nota de voz",
      recAsking: "Solicitando acceso al micrófono…",
      recording: "Grabando",
      recAria: "Grabación de nota de voz en curso",
      recTimeAria: "Tiempo grabado",
      recStop: "Detener",
      recCancel: "Cancelar",
      recRedo: "Regrabar",
      recStarted: "Grabación iniciada. Máximo 3 minutos.",
      recStopped: "Nota de voz de {t} añadida. Puedes escucharla antes de enviar.",
      recMax: "Se alcanzó el máximo de 3 minutos.",
      recCancelled: "Grabación cancelada.",
      recEmpty: "La grabación está vacía; inténtalo de nuevo.",
      stopRecFirst: "Detén o cancela la grabación antes de enviar.",
      micUnsupported: "Este navegador no permite grabar notas de voz. Puedes seguir enviando texto y fotos.",
      micDenied: "Sin permiso para usar el micrófono. Actívalo en el navegador para grabar; texto y fotos siguen funcionando.",
      micMissing: "No se detecta ningún micrófono. Puedes seguir enviando texto y fotos.",
      micFail: "No se pudo iniciar la grabación: {msg}",
      attAria: "Adjuntos del mensaje",
      attCount: "{n} de {max} adjuntos · máx. 5 MB cada uno",
      photo: "Foto",
      voice: "Nota de voz",
      remove: "Quitar",
      removeAria: "Quitar {name}",
      redoAria: "Regrabar {name}",
      removed: "{name} quitado del mensaje.",
      previewAlt: "Vista previa: {name}",
      photoAlt: "Foto: {name}",
      voiceAria: "Nota de voz: {name}",
      attLoading: "Cargando adjunto…",
      attFail: "No se pudo cargar el adjunto.",
      maxAtt: "Máximo {n} adjuntos por mensaje.",
      tooBig: "{name} supera el límite de 5 MB.",
      badType: "{name} no es un tipo admitido (fotos JPEG, PNG o WebP; audio WebM, Ogg, MP4 o MP3).",
      imgFail: "No se pudo procesar la imagen {name}.",
      processing: "Procesando foto…",
      photoAdded: "Foto añadida ({size}). {n} de {max} adjuntos.",
      uploading: "Subiendo adjunto {i} de {n}…",
      writeOrAttach: "Escribe un mensaje o añade una foto o nota de voz antes de enviar.",
      queued: "Sin enlace: mensaje en cola local ({n} en cola){att}. Se enviará en el próximo contacto; no figura como entregado.",
      queuedAtt: " con {a} adjunto(s) guardado(s) en este dispositivo",
      idbFail: "No se pudieron guardar las fotos o notas de voz en este dispositivo. El texto queda en cola; los adjuntos siguen en el borrador para enviarlos cuando haya enlace.",
      idbFailNoText: "No se pudieron guardar las fotos o notas de voz en este dispositivo. Siguen en el borrador: envíalas cuando haya enlace.",
      pending: "{kind} pendiente de subir: {name} ({size})",
      lost: " {n} adjunto(s) no se pudieron recuperar o el servidor los rechazó.",
      dropped: " {n} mensaje(s) sin texto se descartaron porque sus adjuntos no se pudieron recuperar.",
      rejected: " El servidor rechazó un mensaje y se quitó de la cola ({reason}): «{text}». Reescríbelo si aún quieres enviarlo.",
      noTextPreview: "solo adjuntos, sin texto",
      photoWait: "Espera a que terminen de procesarse las fotos antes de enviar.",
      photoAddedOther: "Foto añadida al borrador de otra conversación ({size}).",
      famConv: "Canal familiar",
      gateTitle: "Conversación familiar privada",
      gateNote: "Las conversaciones del canal familiar son privadas entre el astronauta y su familiar. Administración no puede leer su contenido ni sus adjuntos: solo ve metadatos.",
      protectedPreview: "[Contenido privado del canal familiar]",
      msgCount: "{n} mensajes",
    },
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
    role: { ASTRONAUT: "Crew member", MISSION_LEADER: "Ground lead", ADMINISTRATOR: "Administration", FAMILY_MEMBER: "Family member" },
    fam: {
      chAria: "Message channel",
      chMission: "Mission",
      chFamily: "Family",
      title: "Earth Connection",
      intro: "Messages, photos and voice notes with your loved ones. They are stored and forwarded: there are no live calls because of the communication delay.",
      introFamily: "Messages, photos and voice notes with your astronaut. They are stored and forwarded: there are no live calls because of the communication delay.",
      contactsAria: "Family contacts",
      contactsFail: "Could not load contacts: {msg}",
      noContacts: "There are no authorized family contacts.",
      contactNoConv: "Conversation not available yet.",
      selectContact: "Choose a family member to see the conversation and write.",
      attOnly: "[Attachment]",
      privacy: "Only you and {name} can see this conversation.",
      privacyMore: "The mission team and administration have no access to its content or attachments.",
      emptyThread: "No messages yet. Write the first one: it will be delivered when there is a link.",
      newMessage: "New message",
      delayNow: "It will arrive almost instantly.",
      delayEta: "It will arrive in ~{d}.",
      delayMars: "It will arrive in ~4–24 min (depending on where Mars is).",
      offlineHtml: "<strong>No link: it will be stored and sent at the next contact.</strong> Photos and voice notes stay on this device and the message won't show as delivered until the server confirms it.",
      toolsAria: "Add a photo or voice note",
      photoPick: "Choose photo",
      photoTake: "Take photo",
      voiceRec: "Record voice note",
      recAsking: "Requesting microphone access…",
      recording: "Recording",
      recAria: "Voice note recording in progress",
      recTimeAria: "Recorded time",
      recStop: "Stop",
      recCancel: "Cancel",
      recRedo: "Record again",
      recStarted: "Recording started. Maximum 3 minutes.",
      recStopped: "{t} voice note added. You can listen to it before sending.",
      recMax: "The 3-minute maximum was reached.",
      recCancelled: "Recording cancelled.",
      recEmpty: "The recording is empty; please try again.",
      stopRecFirst: "Stop or cancel the recording before sending.",
      micUnsupported: "This browser can't record voice notes. You can keep sending text and photos.",
      micDenied: "No permission to use the microphone. Allow it in the browser to record; text and photos still work.",
      micMissing: "No microphone detected. You can keep sending text and photos.",
      micFail: "Could not start recording: {msg}",
      attAria: "Message attachments",
      attCount: "{n} of {max} attachments · max. 5 MB each",
      photo: "Photo",
      voice: "Voice note",
      remove: "Remove",
      removeAria: "Remove {name}",
      redoAria: "Record {name} again",
      removed: "{name} removed from the message.",
      previewAlt: "Preview: {name}",
      photoAlt: "Photo: {name}",
      voiceAria: "Voice note: {name}",
      attLoading: "Loading attachment…",
      attFail: "Could not load the attachment.",
      maxAtt: "Maximum {n} attachments per message.",
      tooBig: "{name} exceeds the 5 MB limit.",
      badType: "{name} is not a supported type (JPEG, PNG or WebP photos; WebM, Ogg, MP4 or MP3 audio).",
      imgFail: "Could not process the image {name}.",
      processing: "Processing photo…",
      photoAdded: "Photo added ({size}). {n} of {max} attachments.",
      uploading: "Uploading attachment {i} of {n}…",
      writeOrAttach: "Write a message or add a photo or voice note before sending.",
      queued: "No link: message in local queue ({n} queued){att}. It will be sent at the next contact; not shown as delivered.",
      queuedAtt: " with {a} attachment(s) stored on this device",
      idbFail: "Photos or voice notes could not be stored on this device. The text is queued; the attachments stay in the draft so you can send them when there is a link.",
      idbFailNoText: "Photos or voice notes could not be stored on this device. They stay in the draft: send them when there is a link.",
      pending: "{kind} waiting to upload: {name} ({size})",
      lost: " {n} attachment(s) could not be recovered or were rejected by the server.",
      dropped: " {n} message(s) without text were discarded because their attachments could not be recovered.",
      rejected: " The server rejected a message and it was removed from the queue ({reason}): “{text}”. Rewrite it if you still want to send it.",
      noTextPreview: "attachments only, no text",
      photoWait: "Wait for the photos to finish processing before sending.",
      photoAddedOther: "Photo added to another conversation's draft ({size}).",
      famConv: "Family channel",
      gateTitle: "Private family conversation",
      gateNote: "Family channel conversations are private between the astronaut and their family member. Administration cannot read their content or attachments: only metadata is visible.",
      protectedPreview: "[Private family channel content]",
      msgCount: "{n} messages",
    },
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

/* Canal familiar: límites del contrato (§4) y del cliente */
const CHANNEL_KEY = "av_messages_channel"; // la pestaña Bienestar pone "FAMILY" o "MISSION" para abrir aquí en ese canal
const MAX_ATT = 4; // adjuntos por mensaje
const MAX_ATT_BYTES = 5 * 1024 * 1024; // por adjunto, ya procesado
const MAX_RAW_IMG_BYTES = 40 * 1024 * 1024; // foto original antes de redimensionar (evita decodificar archivos enormes)
const MAX_IMG_SIDE = 1600;
const JPEG_QUALITY = 0.85;
const MAX_REC_SEC = 180;
const AUDIO_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg"];
const REC_MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mp4"];
const AUDIO_EXT = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/mpeg": "mp3" };

/* ───────────────────────── estado del módulo ───────────────────────── */

function freshState(userId) {
  return {
    userId,
    channel: "MISSION", // MISSION | FAMILY
    selByCh: { MISSION: null, FAMILY: null }, // conversación seleccionada al cambiar de canal
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
  // files: adjuntos reales del canal familiar { lid, kind, blob, name, mime, size, url, duration, attId }
  return { content: "", category: "GENERAL", attachment: "", important: false, replyTo: null, replyPreview: "", linkedAlertId: null, files: [] };
}

let S = freshState(null);
let D = {
  conversations: [], hiddenConvs: 0, hiddenSups: 0, convError: null, supports: [], supError: null, thread: null, threadError: null,
  fam: { contacts: [], convs: [], error: null }, // canal familiar
};
let ctx = null;
let seq = 0;

/* ───────────────────────── utilidades ───────────────────────── */

const role = () => ctx?.appState?.currentUser?.role_code || "ASTRONAUT";
const meId = () => ctx?.appState?.currentUser?.id;
const isAdmin = () => role() === "ADMINISTRATOR";
const isFamilyRole = () => role() === "FAMILY_MEMBER";
const isFam = () => S.channel === "FAMILY";
const isFamilyConv = (c) => Boolean(c) && String(c.channel || "").toUpperCase() === "FAMILY";
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
const newDedup = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
/* extra: campos adicionales del elemento (canal familiar: dedup_key propio, pending_blob_keys, pending_meta) */
function queueLocal(endpoint, payload, prefix, extra = {}) {
  const dedup_key = extra.dedup_key || newDedup(prefix);
  apiService.enqueueOfflineItem({ ...extra, endpoint, dedup_key, payload, owner_id: meId() });
  return { queued_offline: true, queue_size: offlineQueue().length };
}
/* Transmite solo los elementos propios de mensajería; el resto de la cola queda intacto.
 * Los mensajes familiares con adjuntos en IndexedDB suben antes cada archivo (POST /attachments) y
 * después envían el mensaje con attachment_ids. El avance se guarda en la cola tras cada subida.
 * Igual que la cola genérica de api.js: un rechazo definitivo (4xx salvo 408/429) saca el elemento de la
 * cola, borra sus blobs de IndexedDB y sus adjuntos ya subidos (huérfanos), y se informa a la persona con el
 * motivo y el inicio del texto para que pueda reescribirlo. Red caída, 408, 429 y 5xx: sigue en cola. */
async function flushMine() {
  const mine = offlineQueue();
  if (apiService.simulatedOfflineMode) return { synced: 0, remaining: mine.length, lost: 0, dropped: 0, rejected: [] };
  const sent = new Set();
  const rejected = [];
  let lost = 0;
  let dropped = 0;
  for (const item of mine) {
    let payload = item.payload || {};
    try {
      const hadBlobs = Array.isArray(item.pending_blob_keys);
      if (hadBlobs && item.pending_blob_keys.length) {
        const up = await uploadPendingBlobs(item);
        lost += up.lost;
        payload = up.payload;
      }
      if (hadBlobs && !String(payload.content || "").trim() && !(payload.attachment_ids || []).length) {
        // sin texto y sin ningún adjunto recuperable: no hay nada que enviar
        sent.add(item.dedup_key);
        dropped += 1;
        continue;
      }
      await apiService.request(item.endpoint, {
        method: "POST",
        body: JSON.stringify({ ...payload, dedup_key: item.dedup_key }),
      });
      sent.add(item.dedup_key);
    } catch (e) {
      if (isRetryable(e)) continue; // queda en cola
      // Rechazo definitivo: fuera de la cola, sin dejar blobs ni adjuntos huérfanos
      sent.add(item.dedup_key);
      const cur = (apiService.getOfflineQueue() || []).find((q) => q.dedup_key === item.dedup_key) || item;
      const keys = Array.isArray(cur.pending_blob_keys) ? cur.pending_blob_keys : [];
      if (keys.length) idbDelete(keys).catch(() => {});
      const ids = Array.isArray(payload.attachment_ids) ? payload.attachment_ids : (cur.payload?.attachment_ids || []);
      discardUploaded(ids);
      rejected.push({ text: String(payload.content || "").trim(), reason: errMsg(e) });
    }
  }
  if (sent.size) {
    // relee la cola para no pisar elementos encolados mientras tanto
    apiService.saveOfflineQueue((apiService.getOfflineQueue() || []).filter((q) => !sent.has(q.dedup_key)));
  }
  return { synced: sent.size - dropped - rejected.length, remaining: offlineQueue().length, lost, dropped, rejected };
}
/* Borra en el servidor adjuntos ya subidos que no llegarán a ningún mensaje (best effort: el servidor solo
 * lo permite a quien lo subió y si sigue huérfano; cualquier error se ignora). */
function discardUploaded(ids) {
  (Array.isArray(ids) ? ids : [ids]).forEach((id) => {
    if (id === null || id === undefined || id === "") return;
    try {
      Promise.resolve(apiService.request(`/attachments/${encodeURIComponent(id)}`, { method: "DELETE" })).catch(() => {});
    } catch {
      /* ignorado */
    }
  });
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

/* ───────────────────────── canal familiar: utilidades ───────────────────────── */

const baseMime = (t) => String(t || "").split(";")[0].trim().toLowerCase();
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const fmtClock = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
function fmtSize(bytes) {
  const b = Number(bytes) || 0;
  if (b < 1024 * 1024) return `${nm(Math.max(1, Math.round(b / 1024)))} KB`;
  return `${nm(b / (1024 * 1024), 1)} MB`;
}
function toUploadFile(f) {
  try {
    return new File([f.blob], f.name, { type: f.mime || f.blob.type });
  } catch {
    return f.blob; // navegadores sin constructor File: el nombre viaja en FormData
  }
}
const isMediaAtt = (a) => Boolean(a) && a.id !== null && a.id !== undefined && (a.kind === "IMAGE" || a.kind === "AUDIO");

/* Contacto familiar de una conversación (lista de GET /family/contacts) */
function famContact(convId) {
  return D.fam.contacts.find((c) => Number(c.conversation_id) === Number(convId)) || null;
}
/* Nombre de la otra persona de la conversación familiar */
function famOtherName(conv, contact) {
  if (contact && contact.name) return String(contact.name);
  if (conv?.family_contact?.name) return String(conv.family_contact.name);
  return String((isFamilyRole() ? conv?.astronaut_name : conv?.leader_name) || "—");
}

/* Retardo estimado (un sentido) según el entorno de la misión que ya conoce la app
 * (appState.healthSummary.context, igual que la barra de estado). Sin dato, no se muestra nada. */
function familyDelay() {
  const F = tr(DICT).fam;
  const c = ctx?.appState?.healthSummary?.context || {};
  const code = String(c.environment_code || "").toUpperCase();
  const mars = /mart|mars|marc/i.test(String(c.location_module || ""));
  if (code === "LOW_EARTH_ORBIT") return F.delayNow;
  if (code === "LUNAR_ORBIT" || code === "LUNAR_SURFACE" || (code === "PRESSURIZED_HABITAT" && !mars)) {
    return fmt(F.delayEta, { d: `${nm(1.3, 1)} s` });
  }
  if (code === "MARS_TRANSIT" || code === "MARS_ORBIT" || code === "MARS_SURFACE" || (code === "PRESSURIZED_HABITAT" && mars)) {
    return F.delayMars;
  }
  const d = Number(c.comms_delay_seconds);
  if (c.comms_delay_seconds !== undefined && c.comms_delay_seconds !== null && Number.isFinite(d)) {
    return d < 1 ? F.delayNow : fmt(F.delayEta, { d: fmtDelay(d) });
  }
  return null;
}

/* ── IndexedDB: blobs de adjuntos pendientes (no caben en localStorage) ──
 * Registro: { key: "<dedup_key>#<i>", owner_id, dedup_key, blob, name, mime, size, kind, duration } */
const IDB_NAME = "astrovital_msg_outbox";
const IDB_STORE = "attachments";
let idbPromise = null;
function idbOpen() {
  if (idbPromise) return idbPromise;
  idbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      if (typeof indexedDB === "undefined" || !indexedDB) throw new Error("IndexedDB no disponible");
      req = indexedDB.open(IDB_NAME, 1);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: "key" });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        idbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error || new Error("IndexedDB"));
    req.onblocked = () => reject(new Error("IndexedDB bloqueado"));
  });
  idbPromise.catch(() => {
    idbPromise = null;
  });
  return idbPromise;
}
async function idbTx(mode, fn) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    let out;
    try {
      const tx = db.transaction(IDB_STORE, mode);
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error || new Error("IndexedDB"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB"));
      fn(tx.objectStore(IDB_STORE), (v) => {
        out = v;
      });
    } catch (e) {
      reject(e);
    }
  });
}
const idbPut = (records) => idbTx("readwrite", (st) => records.forEach((r) => st.put(r)));
const idbGet = (key) => idbTx("readonly", (st, set) => {
  const r = st.get(key);
  r.onsuccess = () => set(r.result || null);
});
const idbDelete = (keys) => idbTx("readwrite", (st) => keys.forEach((k) => st.delete(k)));

/* Actualiza en la cola el avance de subida de un mensaje familiar */
function updateQueuedItem(dedupKey, ids, keys, meta) {
  const q = (apiService.getOfflineQueue() || []).map((x) =>
    x.dedup_key === dedupKey
      ? { ...x, payload: { ...(x.payload || {}), attachment_ids: ids }, pending_blob_keys: keys, pending_meta: meta }
      : x
  );
  apiService.saveOfflineQueue(q);
}

/* Sube los blobs pendientes de un elemento de la cola. Un fallo reintentable (red, 5xx) corta y deja el
 * elemento en cola con lo ya subido guardado como attachment_ids; un rechazo definitivo (4xx) o un blob
 * que ya no está en IndexedDB se cuenta como perdido y no bloquea el resto del mensaje. */
async function uploadPendingBlobs(item) {
  const ids = Array.isArray(item.payload?.attachment_ids) ? [...item.payload.attachment_ids] : [];
  const keys = [...item.pending_blob_keys];
  const meta = Array.isArray(item.pending_meta) ? [...item.pending_meta] : [];
  let lost = 0;
  while (keys.length) {
    const key = keys[0];
    const rec = await idbGet(key); // si IndexedDB falla aquí, el elemento se queda en cola intacto
    if (rec && rec.owner_id === meId() && rec.blob) {
      try {
        const att = await apiService.uploadAttachment(toUploadFile(rec), rec.name);
        if (att && att.id !== null && att.id !== undefined) ids.push(att.id);
        else lost += 1;
      } catch (e) {
        if (isRetryable(e)) throw e;
        lost += 1;
      }
    } else {
      lost += 1;
    }
    keys.shift();
    meta.shift();
    updateQueuedItem(item.dedup_key, ids, keys, meta);
    idbDelete([key]).catch(() => {});
  }
  const payload = { ...(item.payload || {}), attachment_ids: ids };
  if (!ids.length) delete payload.attachment_ids;
  return { payload, lost };
}

/* Encola un mensaje familiar sin enlace: texto en la cola local, archivos en IndexedDB.
 * ids: adjuntos ya subidos (p. ej. si el enlace cayó a mitad). */
async function queueFamilyMessage(endpoint, base, ids, files) {
  const dedup_key = newDedup("FAM-OFFLINE");
  const keys = [];
  const meta = [];
  let idbOk = true;
  if (files.length) {
    const owner = meId();
    const recs = files.map((f, i) => ({
      key: `${dedup_key}#${i}`, owner_id: owner, dedup_key, blob: f.blob, name: f.name, mime: f.mime, size: f.size, kind: f.kind, duration: f.duration ?? null,
    }));
    try {
      await idbPut(recs);
      recs.forEach((r) => {
        keys.push(r.key);
        meta.push({ kind: r.kind, name: r.name, size: r.size });
      });
    } catch {
      idbOk = false;
    }
  }
  if (!idbOk && !base.content && !ids.length) return { queued: false, idbFailed: true };
  const payload = { ...base };
  if (ids.length) payload.attachment_ids = ids;
  const r = queueLocal(endpoint, payload, null, idbOk && keys.length ? { dedup_key, pending_blob_keys: keys, pending_meta: meta } : { dedup_key });
  return { ...r, queued: true, idbFailed: !idbOk, stored: keys.length };
}

/* ── Adjuntos del hilo: descarga autenticada → object URL (caché por id; se revocan al dejar de mostrarse) ── */
const attCache = new Map(); // id → Promise<url>
const attUrls = new Map(); // id → url
function attUrl(id, kind) {
  const key = String(id);
  if (attCache.has(key)) return attCache.get(key);
  const p = apiService.getAttachmentBlob(id).then((blob) => {
    const t = baseMime(blob.type);
    const ok = kind === "IMAGE" ? t.startsWith("image/") && t !== "image/svg+xml" : t.startsWith("audio/");
    if (!ok) throw new Error("tipo inesperado");
    const url = URL.createObjectURL(blob);
    if (attCache.get(key) === p) attUrls.set(key, url);
    else URL.revokeObjectURL(url); // se descartó mientras se descargaba
    return url;
  });
  p.catch(() => {
    if (attCache.get(key) === p) attCache.delete(key);
  });
  attCache.set(key, p);
  return p;
}
function pruneAttCache(keep) {
  for (const key of Array.from(attCache.keys())) {
    if (keep.has(key)) continue;
    const url = attUrls.get(key);
    if (url) URL.revokeObjectURL(url);
    attUrls.delete(key);
    attCache.delete(key);
  }
}
function hydrateMedia(root) {
  const F = tr(DICT).fam;
  const log = root.querySelector("#av-msg-log");
  root.querySelectorAll("[data-att-id]").forEach((el) => {
    const id = el.getAttribute("data-att-id");
    const kind = el.getAttribute("data-att-kind");
    const name = el.getAttribute("data-att-name") || `#${id}`;
    attUrl(id, kind)
      .then((url) => {
        if (!el.isConnected) return;
        el.textContent = "";
        if (kind === "IMAGE") {
          const img = document.createElement("img");
          img.alt = fmt(F.photoAlt, { name });
          img.decoding = "async";
          img.addEventListener("load", () => {
            // si el hilo estaba abajo del todo, sigue abajo al crecer la imagen
            if (log && log.scrollHeight - log.scrollTop - log.clientHeight < 480) log.scrollTop = log.scrollHeight;
          });
          img.src = url;
          el.appendChild(img);
        } else {
          const audio = document.createElement("audio");
          audio.controls = true;
          audio.preload = "metadata";
          audio.setAttribute("aria-label", fmt(F.voiceAria, { name }));
          audio.src = url;
          el.appendChild(audio);
        }
      })
      .catch(() => {
        if (el.isConnected) el.textContent = F.attFail;
      });
  });
}

/* Vistas previas locales del borrador */
function revokeDraftFiles(state) {
  Object.values(state?.drafts || {}).forEach((d) => (d.files || []).forEach((f) => f.url && URL.revokeObjectURL(f.url)));
}
const newLid = () => `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* ── Fotos: redimensionado en cliente (máx. 1600 px, JPEG 0.85). El canvas descarta EXIF (incluida la ubicación). ── */
async function decodeImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* respaldo con <img> */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("decode"));
    };
    img.src = url;
  });
}
async function resizeToJpeg(file) {
  const src = await decodeImage(file);
  const w0 = src.naturalWidth || src.width;
  const h0 = src.naturalHeight || src.height;
  if (!w0 || !h0) throw new Error("decode");
  const k = Math.min(1, MAX_IMG_SIDE / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k));
  const h = Math.max(1, Math.round(h0 * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("canvas");
  g.fillStyle = "#fff"; // fondo para PNG/WebP con transparencia
  g.fillRect(0, 0, w, h);
  g.drawImage(src, 0, 0, w, h);
  if (typeof src.close === "function") src.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", JPEG_QUALITY);
  });
}

/* Fotos en proceso: mientras haya alguna, el envío familiar queda bloqueado (si no, el borrador se
 * reemplazaría al enviar y la foto acabaría en un objeto descartado). */
let photoJobs = 0;
async function addPhotos(fileList) {
  const F = tr(DICT).fam;
  if (!ctx || !S.selectedId || !isFam()) return;
  const token = ctx.token;
  const convKey = String(S.selectedId);
  const owner = S.userId;
  // borrador vigente de la conversación en cada momento (no una referencia capturada al inicio)
  const target = () => {
    if (!S.drafts[convKey]) S.drafts[convKey] = newDraft();
    return S.drafts[convKey];
  };
  const notes = [];
  photoJobs += 1;
  const sendBtn = ctx.container.querySelector('form[data-msg-form="fam-send"] #av-msg-send');
  if (sendBtn) sendBtn.disabled = true;
  try {
    for (const file of Array.from(fileList || [])) {
      const name = String(file.name || F.photo).slice(0, 120);
      if (target().files.length >= MAX_ATT) {
        notes.push(fmt(F.maxAtt, { n: MAX_ATT }));
        break;
      }
      const type = baseMime(file.type);
      if (!type.startsWith("image/") || type === "image/svg+xml") {
        notes.push(fmt(F.badType, { name }));
        continue;
      }
      if (file.size > MAX_RAW_IMG_BYTES) {
        notes.push(fmt(F.tooBig, { name }));
        continue;
      }
      setLive(F.processing);
      try {
        const blob = await resizeToJpeg(file);
        if (S.userId !== owner) return; // otra sesión: nada que añadir ni anunciar
        if (blob.size > MAX_ATT_BYTES) {
          notes.push(fmt(F.tooBig, { name }));
          continue;
        }
        const d = target();
        if (d.files.length >= MAX_ATT) {
          notes.push(fmt(F.maxAtt, { n: MAX_ATT }));
          break;
        }
        d.files.push({
          lid: newLid(), kind: "IMAGE", blob, name: `foto-${stamp()}-${d.files.length + 1}.jpg`, mime: "image/jpeg",
          size: blob.size, url: URL.createObjectURL(blob), duration: null, attId: null,
        });
        notes.push(String(S.selectedId) === convKey
          ? fmt(F.photoAdded, { size: fmtSize(blob.size), n: d.files.length, max: MAX_ATT })
          : fmt(F.photoAddedOther, { size: fmtSize(blob.size) }));
      } catch {
        notes.push(fmt(F.imgFail, { name }));
      }
    }
  } finally {
    photoJobs -= 1;
  }
  if (S.userId !== owner || !ctx) return;
  if (!alive(token)) {
    // la vista se volvió a pintar mientras tanto: solo se libera el envío que quedó bloqueado
    const btn = ctx.container.querySelector('form[data-msg-form="fam-send"] #av-msg-send');
    if (btn && !photoJobs && !S.busy) btn.disabled = false;
    return;
  }
  setMsg(notes.join(" "));
  S.focusId = "av-msg-photo-pick";
  paint();
}

/* ── Notas de voz (MediaRecorder) ── */
const REC = { state: "idle", recorder: null, stream: null, chunks: [], startedAt: 0, timer: null, mime: "", token: null, convId: null };
let recGen = 0; // invalida peticiones de micrófono antiguas (cancelar mientras se pide permiso)
const micSupported = () =>
  typeof navigator !== "undefined" && Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && typeof MediaRecorder !== "undefined";
function pickRecMime() {
  const can = typeof MediaRecorder.isTypeSupported === "function" ? (t) => MediaRecorder.isTypeSupported(t) : () => false;
  return REC_MIME_CANDIDATES.find((t) => can(t)) || "";
}
function stopTracks(stream) {
  try {
    (stream?.getTracks?.() || []).forEach((t) => t.stop());
  } catch {
    /* nada que liberar */
  }
}
function resetRec() {
  if (REC.timer) clearInterval(REC.timer);
  Object.assign(REC, { state: "idle", recorder: null, stream: null, chunks: [], startedAt: 0, timer: null, mime: "", token: null, convId: null });
}
const recSeconds = () => Math.min(MAX_REC_SEC, Math.floor((Date.now() - REC.startedAt) / 1000));

async function startRecording() {
  const F = tr(DICT).fam;
  if (REC.state !== "idle" || !S.selectedId) return;
  if (!micSupported()) {
    setMsg(F.micUnsupported);
    paint();
    return;
  }
  if (draft().files.length >= MAX_ATT) {
    setMsg(fmt(F.maxAtt, { n: MAX_ATT }));
    paint();
    return;
  }
  const gen = ++recGen;
  const token = ctx.token;
  const convId = S.selectedId;
  REC.state = "starting";
  REC.token = token;
  setMsg(F.recAsking);
  paint();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    if (gen !== recGen) return; // ya cancelada mientras se pedía permiso
    resetRec();
    const n = e && e.name;
    if (n === "NotAllowedError" || n === "SecurityError") setMsg(F.micDenied);
    else if (n === "NotFoundError" || n === "OverconstrainedError" || n === "NotReadableError") setMsg(F.micMissing);
    else setMsg(fmt(F.micFail, { msg: errMsg(e) }));
    if (alive(token)) paint();
    return;
  }
  // la vista, la conversación o el estado cambiaron mientras se pedía permiso: se libera el micrófono
  if (gen !== recGen || !alive(token) || S.selectedId !== convId || REC.state !== "starting") {
    stopTracks(stream);
    if (gen === recGen) resetRec();
    return;
  }
  const mime = pickRecMime();
  let recorder;
  try {
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : { audioBitsPerSecond: 64000 });
  } catch (e) {
    stopTracks(stream);
    resetRec();
    setMsg(fmt(F.micFail, { msg: errMsg(e) }));
    paint();
    return;
  }
  Object.assign(REC, { state: "recording", recorder, stream, chunks: [], startedAt: Date.now(), mime: recorder.mimeType || mime, token, convId });
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size) REC.chunks.push(ev.data);
  };
  try {
    recorder.start(1000);
  } catch (e) {
    stopTracks(stream);
    resetRec();
    setMsg(fmt(F.micFail, { msg: errMsg(e) }));
    paint();
    return;
  }
  REC.timer = setInterval(recTick, 500);
  setMsg(F.recStarted);
  S.focusId = "av-msg-rec-stop";
  paint();
}

function recTick() {
  if (REC.state !== "recording") return;
  if (!alive(REC.token)) {
    endRecording(false); // cambio de vista: se descarta y se libera el micrófono
    return;
  }
  const secs = recSeconds();
  const el = ctx.container.querySelector("#av-msg-rec-time");
  if (el) el.textContent = `${fmtClock(secs)} / ${fmtClock(MAX_REC_SEC)}`;
  if (secs >= MAX_REC_SEC) endRecording(true, true);
}

/* Termina la grabación: keep=true añade la nota al borrador de su conversación; false la descarta.
 * Siempre libera las pistas del micrófono. */
function endRecording(keep, byMax = false) {
  const F = tr(DICT).fam;
  if (REC.state === "starting") {
    recGen += 1;
    resetRec(); // startRecording verá el cambio y liberará el micrófono al volver de getUserMedia
    return;
  }
  if (REC.state !== "recording") return;
  const { recorder, stream, chunks, convId, token } = REC;
  const mimeGuess = REC.mime;
  const secs = Math.max(1, recSeconds());
  const userId = S.userId;
  if (REC.timer) clearInterval(REC.timer);
  REC.timer = null;
  REC.state = "stopping";
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    stopTracks(stream);
    resetRec();
    const live = alive(token);
    if (!keep || S.userId !== userId) {
      if (live && keep === false && !byMax) {
        setMsg(F.recCancelled);
        paint();
      }
      return;
    }
    const type = baseMime(recorder.mimeType || mimeGuess) || "audio/webm";
    const blob = new Blob(chunks, { type });
    const d = S.drafts[String(convId)] || (S.drafts[String(convId)] = newDraft());
    let note;
    if (!blob.size) note = F.recEmpty;
    else if (!AUDIO_TYPES.includes(type)) note = fmt(F.badType, { name: F.voice });
    else if (blob.size > MAX_ATT_BYTES) note = fmt(F.tooBig, { name: F.voice });
    else if (d.files.length >= MAX_ATT) note = fmt(F.maxAtt, { n: MAX_ATT });
    else {
      d.files.push({
        lid: newLid(), kind: "AUDIO", blob, name: `nota-de-voz-${stamp()}.${AUDIO_EXT[type] || "webm"}`, mime: type,
        size: blob.size, url: URL.createObjectURL(blob), duration: secs, attId: null,
      });
      note = `${byMax ? `${F.recMax} ` : ""}${fmt(F.recStopped, { t: fmtClock(secs) })}`;
    }
    if (live) {
      setMsg(note);
      S.focusId = "av-msg-voice";
      paint();
    }
  };
  recorder.onstop = finish;
  recorder.onerror = finish;
  try {
    if (recorder.state !== "inactive") recorder.stop();
    else finish();
  } catch {
    finish();
  }
}

/* Escribe en la región viva sin repintar (progreso de subida, procesado de fotos) */
function setLive(text) {
  S.msg = { text: String(text || ""), fresh: false };
  const el = ctx?.container?.querySelector("#av-msg-status");
  if (el) el.textContent = S.msg.text;
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
  // una grabación de un pintado anterior (otra vista, cambio de idioma…) se descarta y libera el micrófono
  endRecording(false);
  pruneAttCache(new Set());
  if (S.userId !== me.id) {
    // otra sesión: no se arrastran borradores, selección ni justificaciones
    revokeDraftFiles(S);
    S = freshState(me.id);
    D.fam = { contacts: [], convs: [], error: null };
  }
  S.msg = { text: "", fresh: false };
  S.srMsg = { text: "", fresh: false };
  S.scrollBottom = true;
  const token = `m${++seq}`;
  ctx = { container, appState, helpers: helpers || {}, token };
  takeAlertPrefill(appState);

  // Canal: FAMILY_MEMBER solo Familia; líder y administración solo Misión; el tripulante elige.
  // La señal de Bienestar ("FAMILY" o "MISSION") se consume siempre, sea cual sea su valor.
  let wantChannel = null;
  try {
    const v = sessionStorage.getItem(CHANNEL_KEY);
    if (v !== null) {
      sessionStorage.removeItem(CHANNEL_KEY);
      if (v === "FAMILY" || v === "MISSION") wantChannel = v;
    }
  } catch {
    /* sessionStorage no disponible */
  }
  const r = me.role_code || "ASTRONAUT";
  if (r === "FAMILY_MEMBER") setChannel("FAMILY");
  else if (r !== "ASTRONAUT" || S.pendingAlert) setChannel("MISSION"); // la precarga desde Alertas va al canal de misión
  else if (wantChannel) setChannel(wantChannel);

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

/* Cambia de canal guardando la conversación seleccionada de cada uno */
function setChannel(ch) {
  const next = ch === "FAMILY" ? "FAMILY" : "MISSION";
  if (S.channel === next) return;
  S.selByCh[S.channel] = S.selectedId;
  S.channel = next;
  setSelected(S.selByCh[next] ?? null);
}

/* Canal familiar: contactos (GET /family/contacts) + conversaciones FAMILY (no leídos y vista previa) */
async function loadFamily() {
  const [c, v] = await Promise.allSettled([
    apiService.getFamilyContacts(),
    apiService.getConversationsByChannel("FAMILY"),
  ]);
  if (c.status === "fulfilled") {
    D.fam.contacts = (c.value?.items || []).filter((x) => x && typeof x === "object");
    D.fam.error = null;
  } else {
    D.fam.contacts = [];
    D.fam.error = errMsg(c.reason);
  }
  D.fam.convs = v.status === "fulfilled" ? (v.value?.conversations || []).filter((x) => x && (!x.channel || isFamilyConv(x))) : [];
  const ids = D.fam.contacts.map((x) => Number(x.conversation_id)).filter((x) => Number.isInteger(x) && x > 0);
  let sel = S.selectedId;
  if (!ids.includes(sel)) sel = ids.length ? ids[0] : null;
  setSelected(sel);
  await loadThread();
}

async function loadAll() {
  if (isFam()) {
    await loadFamily();
    return;
  }
  const { appState } = ctx;
  const mission = appState.selectedMissionId;
  const [c, s] = await Promise.allSettled([
    apiService.getConversations({ mission_id: mission }),
    apiService.getSupportRequests(mission),
  ]);

  if (c.status === "fulfilled") {
    let list = c.value?.conversations || [];
    D.hiddenConvs = 0;
    // canal de misión: las conversaciones FAMILY nunca se listan aquí (salvo metadatos para administración)
    if (!isAdmin()) list = list.filter((x) => !isFamilyConv(x));
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
  if (ctx && S.channel === "MISSION") ctx.appState.selectedConversationId = next;
}

async function loadThread() {
  D.thread = null;
  D.threadError = null;
  const id = S.selectedId;
  if (!id) return;
  const admin = isAdmin();
  // administración: nunca se pide el contenido de una conversación FAMILY (el backend responde 403)
  if (admin && isFamilyConv(D.conversations.find((x) => x.id === id))) return;
  if (admin && !S.adminJust[id]) return; // la puerta de auditoría se pinta en threadHTML
  S.loadingThread = true;
  try {
    const res = await apiService.getConversationMessages(id, admin ? { audit_justification: S.adminJust[id] } : {});
    const fam = isFam();
    const list = fam ? D.fam.convs : D.conversations;
    const conv = res?.conversation || list.find((x) => x.id === id) || {};
    D.thread = { conversation: conv, messages: res?.messages || [] };
    // refresca contadores de la lista (no en administración: la lista sigue con vista previa protegida)
    if (!admin && res?.conversation) {
      if (fam) D.fam.convs = D.fam.convs.map((x) => (x.id === id ? res.conversation : x));
      else D.conversations = D.conversations.map((x) => (x.id === id ? res.conversation : x));
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

  const fam = isFam();
  // el familiar no tiene contexto de enlace de la misión: el panel solo aparece si tiene cola que transmitir
  const showLink = !isFamilyRole() || offlineQueue().length > 0;
  container.innerHTML = `<div class="av-console av-msg" data-av-msg-root="${ctx.token}"><div class="av-grid">
    ${emergencyHTML()}
    ${fam ? famColHTML() : convColHTML()}
    <section class="av-col-b" aria-label="${esc(tr(DICT).selConvAria)}">
      ${showLink ? linkHTML() : ""}
      <p id="av-msg-status" class="av-msg-status" role="status" aria-live="polite">${S.msg.fresh ? "" : esc(S.msg.text)}</p>
      ${fam ? famThreadHTML() : threadHTML()}
    </section>
    ${fam ? "" : srColHTML()}
  </div></div>`;

  const root = container.querySelector("[data-av-msg-root]");
  bind(root);
  applyConvFilter(root);
  applyThreadFilter(root);
  // adjuntos del hilo: descarga autenticada; se revocan las URL de lo que ya no se muestra
  const keep = new Set();
  (D.thread?.messages || []).forEach((m) => (m.attachments || []).forEach((a) => isMediaAtt(a) && keep.add(String(a.id))));
  pruneAttCache(keep);
  hydrateMedia(root);

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
    ${channelSwitchHTML()}
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
  if (isFamilyConv(c)) {
    // canal familiar (solo podría llegar aquí a administración): solo metadatos, nunca contenido
    return `<li><button type="button" id="av-msg-c-${esc(c.id)}" class="av-msg-conv" data-msg-act="select-conv" data-id="${esc(c.id)}" data-status="${esc(c.status || "")}" aria-current="${sel ? "true" : "false"}">
      <span class="av-msg-conv-top"><span class="av-msg-conv-name">${esc(title)}</span><span class="av-msg-tag">${esc(T.fam.famConv)}</span></span>
      <span class="av-msg-preview">${esc(T.fam.protectedPreview)}</span>
      <span class="av-msg-conv-line">${fmt(esc(T.lastActivity), { t: timeTag(c.last_message_at) })}</span>
    </button></li>`;
  }
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
  if (isAdmin() && isFamilyConv(conv)) return familyGateHTML(conv);
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

/* Administración ante una conversación FAMILY: sin acción de lectura auditada, solo metadatos */
function familyGateHTML(conv) {
  const T = tr(DICT);
  const F = T.fam;
  const count = conv.message_count ?? conv.messages_count;
  return `<section class="av-panel av-msg-thread av-msg-pad av-msg-form" aria-labelledby="av-msg-gate-h">
    <h2 class="av-h2" id="av-msg-gate-h">${esc(F.gateTitle)}</h2>
    <p class="av-sub">${fmt(esc(T.lastActivity), { t: timeTag(conv.last_message_at) })}${count !== undefined && count !== null ? ` · ${esc(fmt(F.msgCount, { n: count }))}` : ""}</p>
    <p class="av-msg-note">${esc(F.gateNote)}</p>
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
  const fam = isFam();
  const id = esc(m.id);
  // adjuntos reales (foto / nota de voz, con `kind`) se muestran como medios; el resto, por nombre como siempre
  const media = (m.attachments || []).filter(isMediaAtt);
  const atts = (m.attachments || []).filter((a) => !isMediaAtt(a)).map((a) => esc(a.file_name)).join(", ");

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
      ${fam ? "" : `<button type="button" class="av-btn av-msg-act" id="av-msg-a-imp-${id}" data-msg-act="important" data-id="${id}" data-on="${m.is_important ? "1" : "0"}" aria-pressed="${m.is_important ? "true" : "false"}">${esc(T.important)}</button>`}
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
      ${fam ? "" : `<span class="av-msg-tag">${esc(catLabel(m.category))}</span>`}
      ${m.is_important && !fam ? `<span class="av-msg-tag">${esc(T.important)}</span>` : ""}
      ${unreadForMe ? `<span class="av-badge av-b-A">${esc(T.unread)}</span>` : ""}
      <span class="av-msg-time">#${id} · ${timeTag(m.created_at)} GMT</span>
    </div>
    ${reply}
    ${m.content || !media.length ? `<div class="av-msg-body">${esc(msgText(m.content))}</div>` : ""}
    ${media.length ? `<div class="av-msg-media">${media.map(mediaHTML).join("")}</div>` : ""}
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
  const fam = isFam();
  const F = T.fam;
  const pend = Array.isArray(q.pending_meta) ? q.pending_meta : [];
  return `<li class="av-msg-item av-msg-mine av-msg-queued${urgent ? " av-msg-urgent" : ""}">
    <div class="av-msg-meta">
      <strong>${esc(me.full_name || "—")}</strong><span class="av-sub">${esc(T.you)}</span>
      ${urgent ? `<span class="av-badge av-b-W">${esc(T.urgent)}</span>` : ""}
      ${fam ? "" : `<span class="av-msg-tag">${esc(catLabel(p.category))}</span>`}
      ${p.is_important && !fam ? `<span class="av-msg-tag">${esc(T.important)}</span>` : ""}
      <span class="av-msg-time">${fmt(esc(T.queuedSince), { t: timeTag(q.queued_at) })}</span>
    </div>
    ${p.reply_to_message_id ? `<span class="av-sub">${esc(fmt(T.replyTo, { id: p.reply_to_message_id }))}</span>` : ""}
    ${p.content || !pend.length ? `<div class="av-msg-body">${esc(p.content)}</div>` : ""}
    ${p.attachment_file_name ? `<span class="av-sub">${esc(fmt(T.attachment, { a: p.attachment_file_name }))}</span>` : ""}
    ${pend.map((a) => `<span class="av-sub">${esc(fmt(F.pending, { kind: a && a.kind === "AUDIO" ? F.voice : F.photo, name: a?.name || "—", size: fmtSize(a?.size) }))}</span>`).join("")}
    <div class="av-msg-foot"><span>${esc(T.statusLbl)} <span class="av-mono">QUEUED</span> ${esc(T.queuedMsgFoot)}</span></div>
  </li>`;
}

/* ───────────────────────── canal familiar: pintado ───────────────────────── */

function mediaHTML(a) {
  const kind = a.kind === "AUDIO" ? "AUDIO" : "IMAGE";
  return `<div class="av-msg-att av-msg-att-${kind === "AUDIO" ? "audio" : "image"}" data-att-id="${esc(a.id)}" data-att-kind="${kind}" data-att-name="${esc(a.file_name || "")}">
    <span class="av-sub">${esc(tr(DICT).fam.attLoading)}</span></div>`;
}

/* Selector Misión / Familia (solo tripulante) */
function channelSwitchHTML() {
  if (role() !== "ASTRONAUT") return "";
  const F = tr(DICT).fam;
  const btn = (ch, label) =>
    `<button type="button" class="av-btn av-msg-ch" id="av-msg-ch-${ch}" data-msg-act="channel" data-ch="${ch}" aria-pressed="${S.channel === ch ? "true" : "false"}">${esc(label)}</button>`;
  return `<div class="av-msg-channel" role="group" aria-label="${esc(F.chAria)}">${btn("MISSION", F.chMission)}${btn("FAMILY", F.chFamily)}</div>`;
}

function famColHTML() {
  const T = tr(DICT);
  const F = T.fam;
  const contacts = D.fam.contacts;
  const totalUnread = D.fam.convs.reduce((n, c) => n + (Number(c.unread_count) || 0), 0);
  let body;
  if (D.fam.error) body = `<p class="av-msg-err" role="alert">${esc(fmt(F.contactsFail, { msg: D.fam.error }))}</p>`;
  else if (!contacts.length) body = `<p class="av-msg-note">${esc(F.noContacts)}</p>`;
  else body = `<ul class="av-msg-conv-list" aria-label="${esc(F.contactsAria)}">${contacts.map(famItemHTML).join("")}</ul>`;
  return `<aside class="av-panel av-col-a" aria-labelledby="av-msg-conv-h">
    ${channelSwitchHTML()}
    <div class="av-card-head">
      <h2 class="av-h2" id="av-msg-conv-h">${esc(F.title)}</h2>
      <span class="av-sub">${totalUnread ? fmt(esc(T.unreadTotal), { n: `<strong>${esc(totalUnread)}</strong>` }) : esc(T.noPending)}</span>
    </div>
    <p class="av-msg-note">${esc(isFamilyRole() ? F.introFamily : F.intro)}</p>
    ${body}
  </aside>`;
}

function famItemHTML(c) {
  const T = tr(DICT);
  const F = T.fam;
  const convId = Number(c.conversation_id);
  const ok = Number.isInteger(convId) && convId > 0;
  const conv = ok ? D.fam.convs.find((x) => x.id === convId) : null;
  const unread = Number(conv?.unread_count) || 0;
  const sel = ok && convId === S.selectedId;
  const p = conv?.last_message_preview;
  const preview = p ? (p.content ? btPreview(p.content) : F.attOnly) : ok ? T.noMsgsYet : F.contactNoConv;
  return `<li><button type="button" id="av-msg-c-${ok ? esc(convId) : `k${esc(c.id)}`}" class="av-msg-conv" data-msg-act="select-conv" data-id="${ok ? esc(convId) : ""}" aria-current="${sel ? "true" : "false"}" ${ok ? "" : "disabled"}>
    <span class="av-msg-conv-top"><span class="av-msg-conv-name">${esc(c.name || "—")}</span>${unread ? `<span class="av-badge av-b-A">${esc(fmt(T.nUnread, { n: unread }))}</span>` : ""}</span>
    ${c.relationship ? `<span class="av-msg-conv-line">${esc(bt(String(c.relationship)))}</span>` : ""}
    <span class="av-msg-preview">${esc(preview)}</span>
    ${conv?.last_message_at ? `<span class="av-msg-conv-line">${fmt(esc(T.lastActivity), { t: timeTag(conv.last_message_at) })}</span>` : ""}
  </button></li>`;
}

function famThreadHTML() {
  const T = tr(DICT);
  const F = T.fam;
  const id = S.selectedId;
  if (!id) {
    return `<section class="av-panel av-msg-thread av-msg-pad"><p class="av-msg-note">${esc(D.fam.contacts.length ? F.selectContact : F.noContacts)}</p></section>`;
  }
  if (D.threadError) {
    return `<section class="av-panel av-msg-thread av-msg-pad">
      <p class="av-msg-err" role="alert">${esc(fmt(T.threadFail, { msg: D.threadError }))}</p>
      <button type="button" class="av-btn" id="av-msg-refresh" data-msg-act="refresh">${esc(T.retry)}</button>
    </section>`;
  }
  if (!D.thread) {
    return `<section class="av-panel av-msg-thread av-msg-pad"><p class="av-msg-note">${esc(T.loadingConv)}</p></section>`;
  }
  const conv = D.thread.conversation || {};
  const contact = famContact(id);
  const other = famOtherName(conv, contact);
  const rel = contact?.relationship || conv.family_contact?.relationship || "";
  const msgs = D.thread.messages;
  const me = meId();
  const unread = msgs.filter((m) => m.recipient_id === me && !readByRecipient(m)).length;
  const queued = offlineQueue().filter((q) => q.endpoint === `/conversations/${id}/messages`);
  const items = msgs.map((m) => msgHTML(m)).join("") + queued.map(queuedMsgHTML).join("");
  return `<section class="av-panel av-msg-thread" aria-labelledby="av-msg-th-h">
    <div class="av-panel-head">
      <div class="av-msg-th-title">
        <h2 class="av-h2" id="av-msg-th-h" tabindex="-1">${esc(other)}</h2>
        ${rel ? `<span class="av-sub">${esc(bt(String(rel)))}</span>` : ""}
      </div>
      <div class="av-msg-tools">
        ${unread ? `<button type="button" class="av-btn" id="av-msg-readall" data-msg-act="read-all">${esc(fmt(T.readAll, { n: unread }))}</button>` : ""}
        <button type="button" class="av-btn" id="av-msg-refresh" data-msg-act="refresh">${esc(T.refresh)}</button>
      </div>
    </div>
    <p class="av-msg-privacy" role="note">${esc(fmt(F.privacy, { name: other }))} ${esc(F.privacyMore)}</p>
    <div id="av-msg-log" class="av-msg-log" role="log" aria-label="${esc(T.logAria)}" tabindex="0">
      ${items ? `<ol class="av-msg-list">${items}</ol>` : `<p class="av-msg-note">${esc(F.emptyThread)}</p>`}
      <p class="av-msg-note" id="av-msg-th-none" hidden>${esc(T.noMsgMatch)}</p>
    </div>
    ${famComposerHTML()}
  </section>`;
}

function famComposerHTML() {
  const T = tr(DICT);
  const F = T.fam;
  const d = draft();
  const L = linkInfo();
  const delay = familyDelay();
  let linkNote = "";
  if (L.offline) linkNote = `<p class="av-msg-offline" role="note">${F.offlineHtml}</p>`;
  else if (delay) linkNote = `<p class="av-msg-note av-msg-eta" role="note">${esc(delay)}</p>`;
  const full = d.files.length >= MAX_ATT;
  const recActive = REC.state !== "idle" && REC.token === ctx.token && REC.convId === S.selectedId;
  const starting = REC.state === "starting" && REC.token === ctx.token;
  let coarse = false;
  try {
    coarse = window.matchMedia("(pointer: coarse)").matches;
  } catch {
    coarse = false;
  }

  let rec;
  if (starting) {
    rec = `<div class="av-msg-rec" role="group" aria-label="${esc(F.recAria)}">
      <span>${esc(F.recAsking)}</span>
      <button type="button" class="av-btn" id="av-msg-rec-cancel" data-msg-act="rec-cancel">${esc(F.recCancel)}</button></div>`;
  } else if (recActive) {
    rec = `<div class="av-msg-rec" role="group" aria-label="${esc(F.recAria)}">
      <span class="av-msg-rec-dot" aria-hidden="true"></span><strong>${esc(F.recording)}</strong>
      <span id="av-msg-rec-time" class="av-mono" role="timer" aria-live="off" aria-label="${esc(F.recTimeAria)}">${esc(`${fmtClock(recSeconds())} / ${fmtClock(MAX_REC_SEC)}`)}</span>
      <button type="button" class="av-btn av-btn-primary" id="av-msg-rec-stop" data-msg-act="rec-stop">${esc(F.recStop)}</button>
      <button type="button" class="av-btn" id="av-msg-rec-cancel" data-msg-act="rec-cancel">${esc(F.recCancel)}</button></div>`;
  } else {
    rec = `<div class="av-msg-famtools" role="group" aria-label="${esc(F.toolsAria)}">
      <button type="button" class="av-btn" id="av-msg-photo-pick" data-msg-act="photo-pick" ${full ? "disabled" : ""}>${esc(F.photoPick)}</button>
      ${coarse ? `<button type="button" class="av-btn" id="av-msg-photo-take" data-msg-act="photo-take" ${full ? "disabled" : ""}>${esc(F.photoTake)}</button>` : ""}
      <button type="button" class="av-btn" id="av-msg-voice" data-msg-act="rec-start" ${full ? "disabled" : ""}>${esc(F.voiceRec)}</button>
      <input type="file" id="av-msg-photo-input" class="av-msg-vh" accept="image/*" multiple tabindex="-1" aria-hidden="true">
      <input type="file" id="av-msg-camera-input" class="av-msg-vh" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true">
    </div>`;
  }

  const files = d.files.length
    ? `<ul class="av-msg-attlist" aria-label="${esc(F.attAria)}">${d.files.map(attPreviewHTML).join("")}</ul>`
    : "";

  return `<form class="av-msg-composer" data-msg-form="fam-send" aria-labelledby="av-msg-comp-h">
    <h3 class="av-h3" id="av-msg-comp-h">${esc(F.newMessage)}</h3>
    ${d.replyTo ? `<div class="av-msg-replybar"><span class="av-msg-grow">${esc(fmt(T.replying, { id: d.replyTo, p: d.replyPreview }))}</span>
      <button type="button" class="av-btn" id="av-msg-cancel-reply" data-msg-act="cancel-reply">${esc(T.cancelReply)}</button></div>` : ""}
    ${linkNote}
    <div class="av-field"><label for="av-msg-text">${esc(T.messageLbl)}</label>
      <textarea id="av-msg-text" name="content" class="av-input av-msg-textarea" rows="3" maxlength="${MAX_LEN}" aria-describedby="av-msg-count av-msg-att-count">${esc(d.content)}</textarea></div>
    ${rec}
    ${files}
    <div class="av-msg-send-row">
      <span class="av-sub av-mono"><span id="av-msg-count">${esc(counterText(d.content.length))}</span> · <span id="av-msg-att-count">${esc(fmt(F.attCount, { n: d.files.length, max: MAX_ATT }))}</span></span>
      <button type="submit" class="av-btn av-btn-primary" id="av-msg-send" ${photoJobs ? `disabled aria-busy="true" title="${esc(F.photoWait)}"` : ""}>${esc(L.offline ? T.queueBtn : T.send)}</button>
    </div>
  </form>`;
}

function attPreviewHTML(f) {
  const F = tr(DICT).fam;
  const lid = esc(f.lid);
  const label = f.kind === "AUDIO" ? F.voice : F.photo;
  const media = f.kind === "AUDIO"
    ? `<audio controls preload="metadata" src="${esc(f.url)}" aria-label="${esc(fmt(F.voiceAria, { name: f.name }))}"></audio>`
    : `<img src="${esc(f.url)}" alt="${esc(fmt(F.previewAlt, { name: f.name }))}">`;
  return `<li class="av-msg-attprev av-msg-attprev-${f.kind === "AUDIO" ? "audio" : "image"}">
    ${media}
    <span class="av-sub">${esc(label)} · ${esc(fmtSize(f.size))}${f.duration ? ` · ${esc(fmtClock(f.duration))}` : ""}</span>
    <span class="av-msg-attprev-act">
      ${f.kind === "AUDIO" ? `<button type="button" class="av-btn av-msg-act" id="av-msg-redo-${lid}" data-msg-act="rec-redo" data-lid="${lid}" aria-label="${esc(fmt(F.redoAria, { name: f.name }))}">${esc(F.recRedo)}</button>` : ""}
      <button type="button" class="av-btn av-msg-act" id="av-msg-rm-${lid}" data-msg-act="att-remove" data-lid="${lid}" aria-label="${esc(fmt(F.removeAria, { name: f.name }))}">${esc(F.remove)}</button>
    </span>
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
  if (isFam()) return; // la lista de contactos familiares no tiene filtros
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
      if (REC.state !== "idle" && id !== S.selectedId) endRecording(false);
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
        const F = tr(DICT).fam;
        setMsg(
          fmt(tr(DICT).flushed, { s: res?.synced ?? 0, r: res?.remaining ?? 0 }) +
            (res?.lost ? fmt(F.lost, { n: res.lost }) : "") +
            (res?.dropped ? fmt(F.dropped, { n: res.dropped }) : "") +
            (res?.rejected || []).map((x) => fmt(F.rejected, { reason: x.reason, text: x.text ? trunc(x.text, 60) : F.noTextPreview })).join("")
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

    /* ── canal familiar ── */
    case "channel": {
      const ch = el.getAttribute("data-ch");
      if (role() !== "ASTRONAUT" || (ch !== "MISSION" && ch !== "FAMILY") || ch === S.channel) return;
      endRecording(false);
      run(el, async () => {
        setChannel(ch);
        S.msg = { text: "", fresh: false };
        S.scrollBottom = true;
        S.focusId = `av-msg-ch-${ch}`;
        await loadAll();
      });
      break;
    }

    case "photo-pick":
    case "photo-take": {
      const input = ev.currentTarget.querySelector(act === "photo-take" ? "#av-msg-camera-input" : "#av-msg-photo-input");
      if (!input) return;
      if (draft().files.length >= MAX_ATT) {
        setMsg(fmt(T.fam.maxAtt, { n: MAX_ATT }));
        paint();
        return;
      }
      input.click();
      break;
    }

    case "rec-start":
      startRecording();
      break;

    case "rec-stop":
      endRecording(true);
      break;

    case "rec-cancel":
      endRecording(false);
      if (REC.state === "idle") {
        // cancelado mientras se pedía permiso: no habrá evento de parada
        setMsg(T.fam.recCancelled);
        S.focusId = "av-msg-voice";
        paint();
      }
      break;

    case "rec-redo":
    case "att-remove": {
      const lid = el.getAttribute("data-lid");
      const d = draft();
      const i = d.files.findIndex((f) => f.lid === lid);
      if (i < 0) return;
      const [f] = d.files.splice(i, 1);
      if (f.url) URL.revokeObjectURL(f.url);
      // ya subido en un intento anterior y ahora fuera del borrador: se borra del servidor (best effort).
      // Con un envío en curso no se toca: ese envío puede estar usándolo.
      if (f.attId !== null && f.attId !== undefined && !S.busy) discardUploaded(f.attId);
      if (act === "rec-redo") {
        startRecording();
      } else {
        setMsg(fmt(T.fam.removed, { name: f.name }));
        S.focusId = "av-msg-photo-pick";
        paint();
      }
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
  else if (kind === "fam-send") submitFamily(form, btn);
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

/* Canal familiar: sube los adjuntos y envía el mensaje (categoría GENERAL). Sin enlace (o si el enlace cae
 * a mitad), el texto va a la cola local y los archivos aún no subidos a IndexedDB. Nunca se da por
 * entregado hasta que el servidor lo confirme. */
function submitFamily(form, btn) {
  const T = tr(DICT);
  const F = T.fam;
  if (REC.state !== "idle") {
    setMsg(F.stopRecFirst);
    S.focusId = REC.state === "recording" ? "av-msg-rec-stop" : "av-msg-rec-cancel";
    paint();
    return;
  }
  if (photoJobs > 0) {
    // fotos aún procesándose: enviar ahora reemplazaría el borrador y las perdería
    setLive(F.photoWait);
    return;
  }
  const d = draft();
  d.content = form.querySelector("#av-msg-text")?.value ?? d.content;
  const content = d.content.trim();
  if (!content && !d.files.length) {
    setMsg(F.writeOrAttach);
    S.focusId = "av-msg-text";
    paint();
    return;
  }
  const convId = S.selectedId;
  if (!convId) return;
  const files = d.files.slice(0, MAX_ATT);
  const base = {
    content: content.slice(0, MAX_LEN),
    category: "GENERAL",
    reply_to_message_id: d.replyTo || null,
    is_simulated: true,
  };
  run(btn, async () => {
    const L = linkInfo();
    const endpoint = `/conversations/${convId}/messages`;
    let res = null;
    let queued = null;
    if (L.offline) {
      const has = (f) => f.attId !== null && f.attId !== undefined; // ya subidos en un intento anterior
      queued = await queueFamilyMessage(endpoint, base, files.filter(has).map((f) => f.attId), files.filter((f) => !has(f)));
    } else {
      const ids = [];
      try {
        for (let i = 0; i < files.length; i += 1) {
          const f = files[i];
          if (f.attId === null || f.attId === undefined) {
            setLive(fmt(F.uploading, { i: i + 1, n: files.length }));
            const att = await apiService.uploadAttachment(toUploadFile(f), f.name);
            if (!att || att.id === null || att.id === undefined) throw new Error(T.unexpected);
            f.attId = att.id; // si después falla el envío, no se vuelve a subir
          }
          ids.push(f.attId);
        }
        res = await apiService.sendMessage(convId, ids.length ? { ...base, attachment_ids: ids } : base);
      } catch (e) {
        if (!isNetworkError(e)) {
          setMsg(fmt(T.sendFail, { msg: errMsg(e) }));
          S.focusId = "av-msg-text";
          return true;
        }
        // el enlace cayó a mitad: lo ya subido viaja por id; el resto, a IndexedDB
        queued = await queueFamilyMessage(endpoint, base, ids, files.slice(ids.length));
      }
    }

    let keepFiles = [];
    if (queued) {
      if (!queued.queued) {
        // IndexedDB no disponible y no hay texto: el borrador (con sus adjuntos) se conserva
        setMsg(F.idbFailNoText);
        S.focusId = "av-msg-send";
        return true;
      }
      if (queued.idbFailed) {
        keepFiles = files.filter((f) => f.attId === null || f.attId === undefined);
        setMsg(F.idbFail);
      } else {
        setMsg(fmt(F.queued, { n: queued.queue_size ?? "?", att: queued.stored ? fmt(F.queuedAtt, { a: queued.stored }) : "" }));
      }
    } else if (res?.server_confirmed_delivery || res?.message) {
      const t = res.message?.sent_at || res.message?.created_at;
      setMsg(res.duplicate_prevented ? T.dupMsg : fmt(T.confirmedMsg, { at: t ? fmt(T.atGmt, { t: when(t) }) : "" }));
    } else {
      setMsg(T.unexpected);
    }
    // borrador nuevo; se conservan los adjuntos que no se pudieron guardar y los añadidos durante el envío
    const cur = S.drafts[String(convId)] || d;
    const late = cur.files.filter((f) => !files.includes(f));
    cur.files.forEach((f) => {
      if (!keepFiles.includes(f) && !late.includes(f) && f.url) URL.revokeObjectURL(f.url);
    });
    const next = newDraft();
    next.files = [...keepFiles, ...late].slice(0, MAX_ATT);
    S.drafts[String(convId)] = next;
    S.scrollBottom = true;
    S.focusId = "av-msg-text";
    await loadAll();
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
  if (isFamilyConv(D.conversations.find((x) => x.id === id))) return; // nunca se audita contenido FAMILY
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
    case "av-msg-photo-input":
    case "av-msg-camera-input": {
      const files = Array.from(t.files || []);
      t.value = ""; // permite volver a elegir el mismo archivo
      if (files.length) addPhotos(files);
      break;
    }
    default:
      break;
  }
}
