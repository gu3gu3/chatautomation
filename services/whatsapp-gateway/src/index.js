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
import {
  redis,
  msgRetryCounterCache,
  cacheSentMessage,
  getCachedSentMessage,
  updateSessionStatus,
  getSessionStatus
} from './sessionStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = pino({ name: 'whatsapp-gateway' });
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Mapa de Sockets Baileys activos por tenantId
const activeSockets = new Map();
// Mapa de Clientes SSE conectados esperando QR por tenantId
const sseClients = new Map();

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
  if (sseClients.has(tenantId)) {
    const clients = sseClients.get(tenantId);
    clients.forEach(res => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
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

  logger.info(`Iniciando sesión Baileys para Tenant: ${tenantId}`);
  await updateSessionStatus(tenantId, 'CONNECTING');

  const authDir = getTenantAuthDir(tenantId);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' }),
    browser: ['WebSavvy AI', 'Chrome', '1.0.0'],
    
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
      await updateSessionStatus(tenantId, 'DISCONNECTED');
      notifySseClients(tenantId, { status: 'DISCONNECTED' });

      if (shouldReconnect) {
        setTimeout(() => startTenantSession(tenantId), 5000);
      } else {
        logger.error(`Sesión del tenant ${tenantId} cerrada permanentemente. Limpiando credenciales.`);
        fs.rmSync(authDir, { recursive: true, force: true });
      }
    } else if (connection === 'open') {
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
      if (msg.key.fromMe) continue; // Ignorar mensajes propios

      const remoteJid = msg.key.remoteJid || '';
      const participant = msg.key.participant || '';

      // 1. FILTRADO ABSOLUTO DE GRUPOS, DIFUSIONES, CANALES Y ESTADOS DE WHATSAPP:
      // Cualquier mensaje proveniente de @g.us, @broadcast, @newsletter, status@broadcast o con campo participant SE DESCARTA DE INMEDIATO EN GATEWAY.
      const isGroupOrBroadcast = 
        remoteJid.includes('@g.us') || 
        remoteJid.includes('@broadcast') || 
        remoteJid.includes('@newsletter') || 
        remoteJid === 'status@broadcast' || 
        Boolean(participant) ||
        Boolean(msg.isGroup);

      if (isGroupOrBroadcast) {
        logger.info({ tenantId, remoteJid, participant }, '⛔ GRUPO/DIFUSIÓN INTERCEPTADO Y DESCARTADO EN GATEWAY: No se encola ni procesa por el AI Engine.');
        continue; // NUNCA se procesa ni responde a mensajes de grupos
      }

      // 2. SOLO PERMITIR CHATS INDIVIDUALES DIRECTOS DE USUARIOS (@s.whatsapp.net o @lid)
      const isIndividualUser = remoteJid.endsWith('@s.whatsapp.net') || remoteJid.endsWith('@lid');
      if (!isIndividualUser) {
        logger.info({ tenantId, remoteJid }, '⛔ CHAT NO INDIVIDUAL DESCARTADO EN GATEWAY');
        continue;
      }

      let text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '';
      let mediaBase64 = null;
      let mediaMimeType = null;

      if (msg.message?.imageMessage) {
        try {
          const buffer = await downloadMediaMessage(msg, 'buffer', {});
          if (buffer) {
            mediaBase64 = buffer.toString('base64');
            mediaMimeType = msg.message.imageMessage.mimetype || 'image/jpeg';
            if (!text) {
              text = '[El cliente envió una imagen del producto]';
            }
          }
        } catch (mediaErr) {
          logger.error({ err: mediaErr.message }, 'Error descargando imagen de WhatsApp en Gateway');
        }
      }

      if (remoteJid && (text || mediaBase64)) {
        logger.info({ tenantId, remoteJid, text, hasImage: !!mediaBase64 }, 'Nuevo mensaje entrante de chat individual recibido en Gateway');

        // Publicar en la cola de Redis para que el AI Engine lo procese
        const payload = {
          tenantId,
          senderJid: remoteJid,
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

// Endpoint para verificar estado en tiempo real del socket/sesión de WhatsApp
app.get('/api/gateway/status/:tenantId', async (req, res) => {
  const { tenantId } = req.params;
  const sock = activeSockets.get(tenantId);
  const isSocketActive = !!(sock && sock.user);

  const dbStatus = await getSessionStatus(tenantId);
  const connected = isSocketActive || (dbStatus?.status === 'CONNECTED');
  const phoneNumber = sock?.user?.id ? sock.user.id.split(':')[0] : (dbStatus?.phone_number || null);

  res.json({
    tenantId,
    connected,
    status: connected ? 'CONNECTED' : (dbStatus?.status || 'DISCONNECTED'),
    phoneNumber,
    socketActive: isSocketActive,
    lastConnectedAt: dbStatus?.last_connected_at || null
  });
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

  // Si el socket ya está activo y autenticado, emitir inmediatamente el estado CONNECTED
  const sock = activeSockets.get(tenantId);
  if (sock && sock.user) {
    const phoneNumber = sock.user.id ? sock.user.id.split(':')[0] : 'Conectado';
    res.write(`data: ${JSON.stringify({ status: 'CONNECTED', phoneNumber })}\n\n`);
  } else {
    // También verificar si en DB ya figura como CONNECTED
    const dbStatus = await getSessionStatus(tenantId);
    if (dbStatus && dbStatus.status === 'CONNECTED') {
      res.write(`data: ${JSON.stringify({ status: 'CONNECTED', phoneNumber: dbStatus.phone_number || 'Conectado' })}\n\n`);
    }
  }

  // Iniciar la sesión Baileys para este tenant si aún no está activa
  startTenantSession(tenantId);

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
  if (!sock) {
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

app.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Multi-Tenant WhatsApp Gateway escuchando en el puerto ${PORT}`);
  autoLoadSavedSessions();
});
