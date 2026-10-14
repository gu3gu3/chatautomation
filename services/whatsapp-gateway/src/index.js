import express from 'express';
import cors from 'cors';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  generateWAMessageFromContent
} from '@whiskeysockets/baileys';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import {
  redis,
  msgRetryCounterCache,
  cacheSentMessage,
  getCachedSentMessage,
  updateSessionStatus,
  getSessionStatus,
  getTenantAdminInfo,
  getTenantConnectionMode,
  pauseAiForTenantJid,
  logHumanMessage
} from './sessionStore.js';
import { sendDisconnectionEmail } from './mailer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = pino({ name: 'whatsapp-gateway' });

/**
 * Optimiza efímeramente en RAM una imagen recibida (máx 800x800px, JPEG calidad 75%)
 * para reducir drásticamente uso de RAM en Redis, velocidad de red y tokens de visión en Gemini.
 */
async function optimizeImageBuffer(rawBuffer) {
  if (!rawBuffer || rawBuffer.length === 0) return null;
  try {
    const resizedBuffer = await sharp(rawBuffer)
      .resize({
        width: 800,
        height: 800,
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: 75, progressive: true })
      .toBuffer();

    const origKb = Math.round(rawBuffer.length / 1024);
    const optKb = Math.round(resizedBuffer.length / 1024);
    logger.info({ origKb: `${origKb}KB`, optKb: `${optKb}KB` }, '⚡ Imagen optimizada efímeramente en RAM con sharp (800x800 JPEG 75%)');

    return {
      buffer: resizedBuffer,
      mimeType: 'image/jpeg'
    };
  } catch (err) {
    logger.warn({ err: err.message }, 'No se pudo optimizar la imagen con sharp, usando buffer original como fallback');
    return {
      buffer: rawBuffer,
      mimeType: 'image/jpeg'
    };
  }
}
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Mapa de Sockets Baileys activos por tenantId
const activeSockets = new Map();
// Mapa de Clientes SSE conectados esperando QR por tenantId
const sseClients = new Map();
// Cache del último código QR en Base64 por tenantId para entrega inmediata
const latestQrMap = new Map();
// Registro de timestamp de conexión de sesión para filtrar ráfagas de sync
const sessionConnectedAtMap = new Map();

/**
 * Obtiene o crea la ruta local de auth auth_info por tenant
 */
function getTenantAuthDir(tenantId) {
  const dir = path.join(__dirname, `../sessions/${tenantId}`);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Emite actualización de QR o estado vía Server-Sent Events (SSE)
 */
function notifySseClients(tenantId, data) {
  if (data?.status === 'QR_READY' && data.qrDataUrl) {
    latestQrMap.set(tenantId, data.qrDataUrl);
  } else if (data?.status === 'CONNECTED' || data?.status === 'DISCONNECTED') {
    latestQrMap.delete(tenantId);
  }

  if (sseClients.has(tenantId)) {
    const clients = sseClients.get(tenantId);
    clients.forEach(res => {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (err) {}
    });
  }
}

/**
 * Inicia o reconecta una sesión de WhatsApp para un Tenant específico
 */
async function startTenantSession(tenantId) {
  if (activeSockets.has(tenantId)) {
    return activeSockets.get(tenantId);
  }

  const connectionMode = await getTenantConnectionMode(tenantId);
  if (connectionMode === 'RELAY') {
    logger.info(`Tenant ${tenantId} configurado en modo RELAY. El Gateway local no iniciará Baileys.`);
    const currentDbStatus = await getSessionStatus(tenantId);
    if (!currentDbStatus || !currentDbStatus.status) {
      await updateSessionStatus(tenantId, 'DISCONNECTED');
    }
    return null;
  }

  logger.info(`Iniciando sesión Baileys para Tenant: ${tenantId}`);
  await updateSessionStatus(tenantId, 'CONNECTING');

  const authDir = getTenantAuthDir(tenantId);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    browser: ['WebSavvy AI', 'Chrome', '1.0.0'],
    
    // Configuración de red y KeepAlive robusto para prevenir sockets zombies
    keepAliveIntervalMs: 15000,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    emitOwnEvents: false,

    // Configuración E2EE para prevenir "Waiting for this message"
    msgRetryCounterCache,
    retryRequestDelayMs: 250,
    maxMsgRetryCount: 5,
    syncFullHistory: false,

    getMessage: async (key) => {
      if (key && key.id) {
        const cached = await getCachedSentMessage(tenantId, key.id);
        if (cached) {
          return { conversation: cached };
        }
      }
      return { conversation: "Mensaje de Asistencia WebSavvy AI" };
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
        latestQrMap.set(tenantId, qrDataUrl);
        notifySseClients(tenantId, { status: 'QR_READY', qrDataUrl });
      } catch (err) {
        logger.error({ err }, 'Error generando DataURL del QR');
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      logger.warn(`Conexión cerrada para tenant ${tenantId}. Código: ${statusCode}. Reconectar: ${shouldReconnect}`);

      activeSockets.delete(tenantId);
      sessionConnectedAtMap.delete(tenantId);
      latestQrMap.delete(tenantId);
      await updateSessionStatus(tenantId, 'DISCONNECTED');
      notifySseClients(tenantId, { status: 'DISCONNECTED' });

      if (shouldReconnect) {
        setTimeout(() => startTenantSession(tenantId), 5000);
      } else {
        logger.error(`Sesión del tenant ${tenantId} cerrada permanentemente. Limpiando credenciales.`);
        fs.rmSync(authDir, { recursive: true, force: true });

        // Enviar correo de notificación al administrador
        getTenantAdminInfo(tenantId).then(info => {
          if (info && info.adminEmail) {
            sendDisconnectionEmail(info.adminEmail, tenantId, info.tenantName);
          } else {
            logger.warn(`No se encontró info de administrador para el tenant ${tenantId}`);
          }
        }).catch(err => logger.error({ err }, 'Error al intentar enviar correo de desconexión'));
      }
    } else if (connection === 'open') {
      sessionConnectedAtMap.set(tenantId, Date.now());
      latestQrMap.delete(tenantId);
      const phoneNumber = sock.user ? sock.user.id.split(':')[0] : 'Conectado';
      logger.info(`✅ WhatsApp Gateway activado para tenant ${tenantId} (+${phoneNumber})`);
      
      activeSockets.set(tenantId, sock);
      await updateSessionStatus(tenantId, 'CONNECTED', phoneNumber);
      notifySseClients(tenantId, { status: 'CONNECTED', phoneNumber });
    }
  });

  // Escuchar mensajes entrantes para enviarlos a la cola de procesamiento del AI Engine
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      const rawJid = msg.key.remoteJid || '';
      const participant = msg.key.participant || '';

      // Si Baileys proporciona remoteJidAlt en formato @s.whatsapp.net, usarlo preferentemente
      const targetJid = (msg.key.remoteJidAlt && msg.key.remoteJidAlt.endsWith('@s.whatsapp.net'))
        ? msg.key.remoteJidAlt
        : rawJid;

      // 1. FILTRADO ABSOLUTO DE GRUPOS, DIFUSIONES, CANALES Y ESTADOS DE WHATSAPP:
      const isGroupOrBroadcast = 
        targetJid.includes('@g.us') || 
        targetJid.includes('@broadcast') || 
        targetJid.includes('@newsletter') || 
        targetJid === 'status@broadcast' || 
        Boolean(participant) ||
        Boolean(msg.isGroup);

      if (isGroupOrBroadcast) {
        logger.info({ tenantId, remoteJid: targetJid, participant }, '⛔ GRUPO/DIFUSIÓN INTERCEPTADO Y DESCARTADO EN GATEWAY: No se encola ni procesa por el AI Engine.');
        continue;
      }

      // 2. SOLO PERMITIR CHATS INDIVIDUALES DIRECTOS DE USUARIOS (@s.whatsapp.net o @lid)
      const isIndividualUser = targetJid.endsWith('@s.whatsapp.net') || targetJid.endsWith('@lid');
      if (!isIndividualUser) {
        logger.info({ tenantId, remoteJid: targetJid }, '⛔ CHAT NO INDIVIDUAL DESCARTADO EN GATEWAY');
        continue;
      }

      const rawMsg = msg.message?.ephemeralMessage?.message || 
                     msg.message?.viewOnceMessage?.message || 
                     msg.message?.viewOnceMessageV2?.message || 
                     msg.message || {};

      let text = rawMsg.conversation || 
                 rawMsg.extendedTextMessage?.text || 
                 rawMsg.imageMessage?.caption || 
                 rawMsg.videoMessage?.caption || 
                 rawMsg.documentMessage?.caption || 
                 rawMsg.buttonsResponseMessage?.selectedButtonId || 
                 rawMsg.templateButtonReplyMessage?.selectedId || 
                 rawMsg.listResponseMessage?.singleSelectReply?.selectedRowId || 
                 '';

      // Captura de Intervención Humana (Mensaje enviado manualmente desde WhatsApp Web / Móvil en tiempo real)
      if (msg.key.fromMe) {
        // 1. Descartar si ocurrió durante la sincronización inicial de reconexión (primeros 20s de la sesión)
        const connectedAt = sessionConnectedAtMap.get(tenantId) || 0;
        if (Date.now() - connectedAt < 20000) {
          logger.info({ tenantId, remoteJid: targetJid }, '📜 Sincronización inicial de conexión detectada (fromMe). Omitiendo pausa de IA.');
          continue;
        }

        // 2. Extraer timestamp con alta fidelidad para descartar historial diferido
        const nowSec = Math.floor(Date.now() / 1000);
        const rawTs = msg.messageTimestamp;
        let msgSec = null;
        if (typeof rawTs === 'number') {
          msgSec = rawTs;
        } else if (rawTs && typeof rawTs === 'object') {
          if (typeof rawTs.toNumber === 'function') {
            msgSec = rawTs.toNumber();
          } else if (typeof rawTs.low === 'number') {
            msgSec = rawTs.unsigned ? rawTs.low >>> 0 : rawTs.low;
          }
        }

        if (msgSec !== null) {
          const ageSeconds = nowSec - msgSec;
          if (ageSeconds > 25) {
            logger.info({ tenantId, remoteJid: targetJid, ageSeconds }, '📜 Mensaje histórico sincronizado desde WhatsApp Web/Móvil. Omitiendo pausa de IA.');
            continue;
          }
        }

        const isBotMessage = await getCachedSentMessage(tenantId, msg.key.id);
        if (!isBotMessage) {
          const lowerText = (text || '').toLowerCase();
          const isAutoGreeting = lowerText.includes('saludo automático') || 
                                 lowerText.includes('saludo automatico') ||
                                 lowerText.includes('anuncio de facebook') ||
                                 lowerText.includes('gracias por consultar');

          if (!isAutoGreeting) {
            const manualText = text || '[Archivo/Imagen enviado manualmente desde WhatsApp Web/Móvil]';
            logger.info({ tenantId, remoteJid: targetJid, text: manualText }, '👤 Intervención humana manual en tiempo real detectada en WhatsApp Web/Móvil. Pausando IA por 30 min y registrando contexto.');
            await pauseAiForTenantJid(tenantId, targetJid, 1800);
            await logHumanMessage(tenantId, targetJid, msg.key.id, manualText);
          } else {
            logger.info({ tenantId, remoteJid: targetJid, text }, '🤖 Saludo automático o anuncio detectado (fromMe). Omitiendo pausa de IA.');
          }
        }
        continue; // No enviar a la cola de AI Engine
      }

      // Capturar metadatos de anuncios de Facebook / Meta Ads (Click-to-WhatsApp o Get Offer)
      const contextInfo = rawMsg.extendedTextMessage?.contextInfo || rawMsg.contextInfo || {};
      const ref = contextInfo.referral || contextInfo.externalAdReply;
      if (ref) {
        const headline = ref.headline || ref.title || '';
        const body = ref.body || ref.snippet || '';
        const refDetails = [headline, body].filter(Boolean).join(' - ');
        if (refDetails) {
          text = text ? `${text}\n[Origen Anuncio Meta/Facebook: ${refDetails}]` : `[Origen Anuncio Meta/Facebook: ${refDetails}]`;
        }
      }

      let mediaBase64 = null;
      let mediaMimeType = null;

      const imageMsg = rawMsg.imageMessage || msg.message?.imageMessage;
      if (imageMsg) {
        try {
          const rawBuffer = await downloadMediaMessage(msg, 'buffer', {});
          if (rawBuffer) {
            const opt = await optimizeImageBuffer(rawBuffer);
            mediaBase64 = opt.buffer.toString('base64');
            mediaMimeType = opt.mimeType;
            if (!text) {
              text = '[El cliente envió una imagen del producto]';
            }
          }
        } catch (mediaErr) {
          logger.error({ err: mediaErr.message }, 'Error descargando/comprimiendo imagen de WhatsApp en Gateway');
        }
      }

      if (targetJid && (text || mediaBase64)) {
        logger.info({ tenantId, remoteJid: targetJid, rawJid, text, hasImage: !!mediaBase64 }, 'Nuevo mensaje entrante de chat individual recibido en Gateway');

        // Publicar en la cola de Redis para que el AI Engine lo procese
        const payload = {
          tenantId,
          senderJid: targetJid,
          messageId: msg.key.id,
          text,
          mediaBase64,
          mediaMimeType,
          timestamp: new Date().toISOString()
        };

        await redis.rpush('whatsapp:incoming:queue', JSON.stringify(payload));
      }
    }
  });

  activeSockets.set(tenantId, sock);
  return sock;
}

/**
 * Carga e inicia automáticamente todas las sesiones con credenciales válidas guardadas en disco al arrancar el Gateway
 */
async function autoLoadSavedSessions() {
  const sessionsDir = path.join(__dirname, '../sessions');
  if (fs.existsSync(sessionsDir)) {
    const folders = fs.readdirSync(sessionsDir).filter(f => {
      const dirPath = path.join(sessionsDir, f);
      return fs.statSync(dirPath).isDirectory() && fs.existsSync(path.join(dirPath, 'creds.json'));
    });

    for (const tenantId of folders) {
      logger.info(`Auto-iniciando sesión activa para Tenant: ${tenantId}`);
      try {
        await startTenantSession(tenantId);
      } catch (err) {
        logger.error({ err, tenantId }, 'Error al auto-iniciar sesión del tenant');
      }
    }
  }
}

// Webhook para recibir mensajes entrantes de los clientes Android en modo RELAY
app.post('/api/relay/webhook', async (req, res) => {
  const { tenantId, remoteJid, text, messageId, timestamp, mediaBase64, mediaMimeType, event, data } = req.body;

  if (!tenantId) {
    return res.status(400).json({ error: 'tenantId is required' });
  }

  // Notificación de estado de conexión desde Android Relay App
  if (event === 'relay.status') {
    const status = data?.status === 'CONNECTED' ? 'CONNECTED' : 'DISCONNECTED';
    const phoneNumber = data?.phoneNumber || null;
    logger.info({ tenantId, status, phoneNumber }, '📡 Actualización de estado recibida desde Android Relay App');
    await updateSessionStatus(tenantId, status, phoneNumber);
    if (status === 'CONNECTED') {
      await redis.set(`relay:last_seen:${tenantId}`, Date.now().toString(), 'EX', 60);
    } else {
      await redis.del(`relay:last_seen:${tenantId}`);
    }
    notifySseClients(tenantId, { status, phoneNumber, message: status === 'CONNECTED' ? 'Relay conectado' : 'Relay desvinculado' });
    return res.json({ success: true, status });
  }

  // Si llega un evento raw de Baileys desde Android Relay
  if (event === 'messages.upsert' && data?.messages) {
    const { messages, type } = data;
    if (type !== 'notify' && type !== 'append') {
      return res.json({ success: true, processed: 0 });
    }

    let processedCount = 0;
    for (const msg of messages) {
      const rJid = msg.key?.remoteJid || '';
      const participant = msg.key?.participant || '';

      const isGroupOrBroadcast = 
        rJid.includes('@g.us') || 
        rJid.includes('@broadcast') || 
        rJid.includes('@newsletter') || 
        rJid === 'status@broadcast' || 
        Boolean(participant) ||
        Boolean(msg.isGroup);

      if (isGroupOrBroadcast) {
        logger.info({ tenantId, remoteJid: rJid }, '⛔ GRUPO/DIFUSIÓN DESCARTADO EN RELAY WEBHOOK');
        continue;
      }

      const isIndividualUser = rJid.endsWith('@s.whatsapp.net') || rJid.endsWith('@lid');
      if (!isIndividualUser) continue;

      const rawMsg = msg.message?.ephemeralMessage?.message || 
                     msg.message?.viewOnceMessage?.message || 
                     msg.message?.viewOnceMessageV2?.message || 
                     msg.message || {};

      let msgText = rawMsg.conversation || 
                    rawMsg.extendedTextMessage?.text || 
                    rawMsg.imageMessage?.caption || 
                    rawMsg.videoMessage?.caption || 
                    rawMsg.documentMessage?.caption || 
                    rawMsg.buttonsResponseMessage?.selectedButtonId || 
                    rawMsg.templateButtonReplyMessage?.selectedId || 
                    rawMsg.listResponseMessage?.singleSelectReply?.selectedRowId || 
                    '';

      if (msg.key?.fromMe) {
        const isBotMessage = await getCachedSentMessage(tenantId, msg.key.id);
        if (!isBotMessage) {
          const lowerText = (msgText || '').toLowerCase();
          const isAutoGreeting = lowerText.includes('saludo automático') || 
                                 lowerText.includes('saludo automatico') ||
                                 lowerText.includes('anuncio de facebook') ||
                                 lowerText.includes('gracias por consultar');

          if (!isAutoGreeting) {
            const manualText = msgText || '[Archivo/Imagen enviado manualmente desde WhatsApp]';
            logger.info({ tenantId, remoteJid: rJid, text: manualText }, '👤 Intervención humana manual detectada en Relay. Pausando IA por 30 min y registrando contexto.');
            await pauseAiForTenantJid(tenantId, rJid, 1800);
            await logHumanMessage(tenantId, rJid, msg.key.id, manualText);
          } else {
            logger.info({ tenantId, remoteJid: rJid, text: msgText }, '🤖 Saludo automático o anuncio detectado en Relay (fromMe). Omitiendo pausa de IA.');
          }
        }
        continue;
      }

      const relayContextInfo = rawMsg.extendedTextMessage?.contextInfo || rawMsg.contextInfo || {};
      const relayRef = relayContextInfo.referral || relayContextInfo.externalAdReply;
      if (relayRef) {
        const headline = relayRef.headline || relayRef.title || '';
        const body = relayRef.body || relayRef.snippet || '';
        const refDetails = [headline, body].filter(Boolean).join(' - ');
        if (refDetails) {
          msgText = msgText ? `${msgText}\n[Origen Anuncio Meta/Facebook: ${refDetails}]` : `[Origen Anuncio Meta/Facebook: ${refDetails}]`;
        }
      }

      if (!msgText && (rawMsg.imageMessage || msg.message?.imageMessage)) {
        msgText = '[El cliente envió una imagen del producto]';
      }

      if (rJid && msgText) {
        logger.info({ tenantId, remoteJid: rJid, text: msgText }, '📲 Mensaje de Relay encolado exitosamente en Gateway');

        const payload = {
          tenantId,
          senderJid: rJid,
          messageId: msg.key?.id || `relay-${Date.now()}`,
          text: msgText,
          mediaBase64: null,
          mediaMimeType: null,
          timestamp: new Date().toISOString()
        };

        await redis.rpush('whatsapp:incoming:queue', JSON.stringify(payload));
        processedCount++;
      } else {
        logger.warn({ tenantId, remoteJid: rJid, rawMsgKeys: Object.keys(rawMsg) }, '⚠️ Mensaje de Relay omitido por falta de contenido de texto reconocido');
      }
    }
    return res.json({ success: true, queued: processedCount });
  }

  // Si llega un mensaje individual ya estructurado
  if (!remoteJid) {
    return res.status(400).json({ error: 'remoteJid is required for single message payloads' });
  }

  logger.info({ tenantId, remoteJid, hasImage: !!mediaBase64 }, 'Nuevo mensaje entrante recibido vía Webhook (Android Relay)');

  let processedMediaBase64 = mediaBase64 || null;
  let processedMediaMimeType = mediaMimeType || null;

  if (mediaBase64 && (mediaMimeType?.startsWith('image/') || !mediaMimeType)) {
    try {
      const rawBuffer = Buffer.from(mediaBase64, 'base64');
      const opt = await optimizeImageBuffer(rawBuffer);
      if (opt) {
        processedMediaBase64 = opt.buffer.toString('base64');
        processedMediaMimeType = opt.mimeType;
      }
    } catch (e) {}
  }

  let finalText = text || '';
  const singleRef = req.body.referral || req.body.contextInfo?.referral || req.body.contextInfo?.externalAdReply || req.body.externalAdReply || req.body.ad;
  const singleHeadline = req.body.adTitle || req.body.headline || singleRef?.headline || singleRef?.title || '';
  const singleAdBody = req.body.adBody || singleRef?.body || singleRef?.snippet || '';
  const singleRefDetails = [singleHeadline, singleAdBody].filter(Boolean).join(' - ');
  if (singleRefDetails && !finalText.includes('[Origen Anuncio Meta/Facebook:')) {
    finalText = finalText ? `${finalText}\n[Origen Anuncio Meta/Facebook: ${singleRefDetails}]` : `[Origen Anuncio Meta/Facebook: ${singleRefDetails}]`;
  }

  const payload = {
    tenantId,
    senderJid: remoteJid,
    messageId: messageId || `relay-${Date.now()}`,
    text: finalText,
    mediaBase64: processedMediaBase64,
    mediaMimeType: processedMediaMimeType,
    timestamp: timestamp || new Date().toISOString()
  };

  try {
    await redis.rpush('whatsapp:incoming:queue', JSON.stringify(payload));
    res.json({ success: true, queued: true });
  } catch (err) {
    logger.error({ err, tenantId }, 'Error encolando mensaje del webhook relay');
    res.status(500).json({ error: 'Failed to queue message' });
  }
});

// Endpoint para que la app Android Relay consulte y obtenga mensajes salientes pendientes
app.get('/api/relay/pending/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  try {
    const messages = [];
    // Descolar hasta 10 mensajes pendientes en este ciclo
    for (let i = 0; i < 10; i++) {
      const raw = await redis.lpop(`relay:outbound:${tenantId}`);
      if (!raw) break;
      try {
        messages.push(JSON.parse(raw));
      } catch (e) {}
    }
    res.json({ tenantId, count: messages.length, messages });
  } catch (err) {
    logger.error({ err, tenantId }, 'Error consultando mensajes salientes pendientes para relay');
    res.status(500).json({ error: 'Failed to fetch pending messages' });
  }
});

// Soporte de alias para /api/gateway/relay en el proxy Nginx/Gateway
app.post('/api/gateway/relay/webhook', (req, res) => app.handle({ ...req, url: '/api/relay/webhook' }, res));
app.get('/api/gateway/relay/pending/:tenantId', (req, res) => app.handle({ ...req, url: `/api/relay/pending/${req.params.tenantId}` }, res));

// Endpoint para verificar estado en tiempo real del socket/sesión de WhatsApp
app.get('/api/gateway/status/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  const sock = activeSockets.get(tenantId);
  const isSocketActive = !!(sock && sock.user);

  const dbStatus = await getSessionStatus(tenantId);
  const connectionMode = await getTenantConnectionMode(tenantId);
  
  const connected = isSocketActive || (dbStatus?.status === 'CONNECTED');
  const phoneNumber = sock?.user?.id ? sock.user.id.split(':')[0] : (dbStatus?.phone_number || null);

  res.json({
    tenantId,
    connected,
    status: connected ? 'CONNECTED' : (dbStatus?.status || 'DISCONNECTED'),
    phoneNumber,
    socketActive: isSocketActive,
    lastConnectedAt: dbStatus?.last_connected_at || null,
    connectionMode
  });
});

// Endpoint para desvincular manualmente WhatsApp de un tenant
app.post('/api/gateway/disconnect/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  logger.info(`Llegó petición de desconexión para: ${tenantId}`);
  const sock = activeSockets.get(tenantId);
  latestQrMap.delete(tenantId);
  sessionConnectedAtMap.delete(tenantId);
  
  try {
    if (sock) {
      try {
        await sock.logout();
      } catch (e) {
        try { sock.end(undefined); } catch (e2) {}
      }
      activeSockets.delete(tenantId);
    }
    
    // Limpiamos siempre las credenciales en disco
    const authDir = getTenantAuthDir(tenantId);
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
    }
    await updateSessionStatus(tenantId, 'DISCONNECTED');
    notifySseClients(tenantId, { status: 'DISCONNECTED' });

    logger.info(`Desvinculación manual ejecutada para tenant ${tenantId}`);
    res.json({ status: 'success', message: 'WhatsApp desvinculado correctamente' });
  } catch (error) {
    logger.error({ error, tenantId }, 'Error al desvincular WhatsApp manualmente');
    res.status(500).json({ error: error.message });
  }
});

// Endpoint SSE para streaming de QR al Frontend PWA
app.get('/api/gateway/qr-stream/:tenantId', async (req, res) => {
  const { tenantId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!sseClients.has(tenantId)) {
    sseClients.set(tenantId, []);
  }
  sseClients.get(tenantId).push(res);

  // 1. Si el socket ya está activo y autenticado, emitir inmediatamente el estado CONNECTED
  const sock = activeSockets.get(tenantId);
  if (sock && sock.user) {
    const phoneNumber = sock.user.id ? sock.user.id.split(':')[0] : 'Conectado';
    res.write(`data: ${JSON.stringify({ status: 'CONNECTED', phoneNumber })}\n\n`);
  } else if (latestQrMap.has(tenantId)) {
    // 2. Si ya hay un QR fresco generado en memoria, emitirlo de inmediato para que el frontend lo dibuje sin esperar
    res.write(`data: ${JSON.stringify({ status: 'QR_READY', qrDataUrl: latestQrMap.get(tenantId) })}\n\n`);
  } else {
    // 3. Verificar si en DB ya figura como CONNECTED
    const dbStatus = await getSessionStatus(tenantId);
    if (dbStatus && dbStatus.status === 'CONNECTED') {
      res.write(`data: ${JSON.stringify({ status: 'CONNECTED', phoneNumber: dbStatus.phone_number || 'Conectado' })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ status: 'CONNECTING' })}\n\n`);
    }
  }

  // Si se solicita forzar reconexión o si no hay socket activo, iniciar sesión Baileys
  if (req.query.reconnect === 'true' && (!sock || !sock.user)) {
    activeSockets.delete(tenantId);
    latestQrMap.delete(tenantId);
    startTenantSession(tenantId);
  } else if (!activeSockets.has(tenantId)) {
    startTenantSession(tenantId);
  }

  req.on('close', () => {
    const clients = sseClients.get(tenantId) || [];
    sseClients.set(tenantId, clients.filter(c => c !== res));
  });
});

// Endpoint para enviar mensaje saliente desde el AI Engine / Backend
app.post('/api/gateway/send-message', async (req, res) => {
  const { tenantId, toJid, text, options = {} } = req.body;
  const mediaBase64 = req.body.mediaBase64 || options.mediaBase64;
  const mediaMimeType = req.body.mediaMimeType || options.mediaMimeType;
  const fileName = req.body.fileName || options.fileName;
  const simulateTyping = options.simulateTyping !== false; // Por defecto TRUE para simular presencia humana

  if (!tenantId || !toJid || (!text && !mediaBase64)) {
    return res.status(400).json({ error: 'Faltan parámetros requeridos: tenantId, toJid, y text o mediaBase64' });
  }

  const sock = activeSockets.get(tenantId);
  const connectionMode = await getTenantConnectionMode(tenantId);

  if (!sock) {
    if (connectionMode === 'RELAY') {
      logger.info({ tenantId, toJid }, 'Encolando mensaje saliente para despacho por Android Relay App...');
      const outboundMsg = {
        toJid,
        text,
        mediaBase64,
        mediaMimeType,
        fileName,
        timestamp: new Date().toISOString()
      };
      await redis.rpush(`relay:outbound:${tenantId}`, JSON.stringify(outboundMsg));
      return res.json({ status: 'queued_for_relay', success: true, messageId: `relay-out-${Date.now()}` });
    }
    return res.status(503).json({ error: `La sesión de WhatsApp para el tenant ${tenantId} no está activa` });
  }

  try {
    if (simulateTyping) {
      // 1. Enviar estado "escribiendo..." (composing) al destinatario
      await sock.sendPresenceUpdate('composing', toJid).catch(err => {
        logger.warn({ err }, 'No se pudo enviar presence update (composing)');
      });

      // 2. Calibrar un retardo orgánico según la longitud del texto (aprox. 20-30 ms por caracter) + variación aleatoria
      const textLen = text ? text.length : 15;
      const typingTimeMs = 1200 + Math.min(textLen * 20, 3500) + Math.floor(Math.random() * 1000);

      logger.info({ tenantId, toJid, typingTimeMs }, 'Simulando estado de escritura (composing) en WhatsApp...');
      await new Promise(resolve => setTimeout(resolve, typingTimeMs));
    }

    let messageContent = { text: text || '' };

    if (mediaBase64) {
      const buffer = Buffer.from(mediaBase64, 'base64');
      const ext = fileName ? fileName.split('.').pop().toLowerCase() : '';
      const isImage = (mediaMimeType && mediaMimeType.startsWith('image/')) ||
                      ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext);
      const isVideo = (mediaMimeType && mediaMimeType.startsWith('video/')) ||
                      ['mp4', 'mov', 'avi', 'mkv'].includes(ext);
      const isAudio = (mediaMimeType && mediaMimeType.startsWith('audio/')) ||
                      ['mp3', 'ogg', 'wav', 'm4a'].includes(ext);

      if (isImage) {
        messageContent = {
          image: buffer,
          caption: text || '',
          mimetype: mediaMimeType && mediaMimeType.startsWith('image/') ? mediaMimeType : `image/${ext === 'png' ? 'png' : 'jpeg'}`
        };
      } else if (isVideo) {
        messageContent = {
          video: buffer,
          caption: text || '',
          mimetype: mediaMimeType && mediaMimeType.startsWith('video/') ? mediaMimeType : 'video/mp4'
        };
      } else if (isAudio) {
        messageContent = { audio: buffer, ptt: false, mimetype: mediaMimeType || 'audio/mp4' };
      } else {
        // Mapeo automático de MIME Types para Documentos comunes si se requiere fallback
        const mimeTypeMap = {
          pdf: 'application/pdf',
          doc: 'application/msword',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          xls: 'application/vnd.ms-excel',
          xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          csv: 'text/csv',
          ppt: 'application/vnd.ms-powerpoint',
          pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          txt: 'text/plain',
          zip: 'application/zip',
          rar: 'application/x-rar-compressed'
        };

        const documentMimeType = (mediaMimeType && mediaMimeType !== 'application/octet-stream')
          ? mediaMimeType
          : (mimeTypeMap[ext] || 'application/pdf');

        // Documento o PDF de Google Drive / Bodega
        messageContent = {
          document: buffer,
          mimetype: documentMimeType,
          fileName: fileName || (ext ? `Documento.${ext}` : 'Documento.pdf'),
          caption: text || ''
        };
      }
    }

    const sent = await sock.sendMessage(toJid, messageContent);

    if (simulateTyping) {
      // 3. Pausar estado de presencia
      await sock.sendPresenceUpdate('paused', toJid).catch(() => {});
    }

    if (sent?.key?.id) {
      // Guardar en caché Redis para E2EE retry
      await cacheSentMessage(tenantId, sent.key.id, text || '[Archivo Multimedia]');
    }

    res.json({ status: 'sent', messageId: sent?.key?.id });
  } catch (error) {
    logger.error({ error }, 'Error enviando mensaje vía Baileys');
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para enviar una tarjeta de evento nativa de WhatsApp (eventMessage)
app.post('/api/gateway/send-event-message', async (req, res) => {
  const { tenantId, toJid, name, description, startTime, endTime, locationName } = req.body;

  if (!tenantId || !toJid || !name || !startTime) {
    return res.status(400).json({ error: 'Faltan parámetros requeridos: tenantId, toJid, name, startTime' });
  }

  const sock = activeSockets.get(tenantId);
  if (!sock) {
    return res.status(503).json({ error: `La sesión de WhatsApp para el tenant ${tenantId} no está activa` });
  }

  try {
    // Convertir startTime y endTime a segundos Unix (entero)
    let startSec = typeof startTime === 'number'
      ? (startTime > 1e11 ? Math.floor(startTime / 1000) : startTime)
      : Math.floor(new Date(startTime).getTime() / 1000);

    let endSec = endTime
      ? (typeof endTime === 'number'
          ? (endTime > 1e11 ? Math.floor(endTime / 1000) : endTime)
          : Math.floor(new Date(endTime).getTime() / 1000))
      : (startSec + 3600);

    if (isNaN(startSec)) startSec = Math.floor(Date.now() / 1000);
    if (isNaN(endSec)) endSec = startSec + 3600;

    const waMsg = generateWAMessageFromContent(toJid, {
      eventMessage: {
        isCanceled: false,
        name: name,
        description: description || '',
        location: locationName ? { name: locationName } : undefined,
        startTime: startSec,
        endTime: endSec,
        extraData: 0
      }
    }, {});

    await sock.relayMessage(toJid, waMsg.message, { messageId: waMsg.key.id });

    if (waMsg?.key?.id) {
      await cacheSentMessage(tenantId, waMsg.key.id, `[Tarjeta de Evento: ${name}]`);
    }

    logger.info({ tenantId, toJid, name, messageId: waMsg?.key?.id }, '✅ Tarjeta de Evento WhatsApp enviada con éxito');
    res.json({ status: 'sent', messageId: waMsg?.key?.id });
  } catch (error) {
    logger.error({ error, tenantId, toJid }, 'Error enviando tarjeta de evento nativa de WhatsApp vía Baileys');
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'whatsapp-gateway', activeSocketsCount: activeSockets.size });
});
app.get('/api/gateway/health', (req, res) => {
  res.json({ status: 'ok', service: 'whatsapp-gateway', activeSocketsCount: activeSockets.size });
});

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Multi-Tenant WhatsApp Gateway escuchando en el puerto ${PORT}`);
  autoLoadSavedSessions();
});
