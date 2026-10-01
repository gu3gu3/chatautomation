import Redis from 'ioredis';
import pg from 'pg';
import pino from 'pino';
import { GoogleGenAI, Type } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import { readSheetRange, appendSheetRow } from './tools/googleSheets.js';
import { checkAvailability, createCalendarEvent } from './tools/googleCalendar.js';
import { searchAndDownloadDriveFile } from './tools/googleDrive.js';

const logger = pino({ name: 'ai-engine' });
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://ws_admin:ws_secure_pass_2026@localhost:5433/whatsapp_automation'
});

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6380');
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3001';

const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

/**
 * Obtiene el System Prompt activo del Tenant
 */
async function getTenantPrompt(tenantId) {
  try {
    const res = await pool.query(
      `SELECT system_prompt, temperature FROM prompts WHERE tenant_id = $1 AND is_active = TRUE LIMIT 1`,
      [tenantId]
    );

    if (res.rows.length > 0) {
      return res.rows[0];
    }
  } catch (err) {
    logger.error({ err }, 'Error obteniendo prompt del tenant');
  }

  return {
    system_prompt: 'Eres un asistente virtual de soporte en WhatsApp. Responde con amabilidad y concisión.',
    temperature: 0.7
  };
}

/**
 * Obtiene las integraciones activas del Tenant
 */
async function getTenantIntegrations(tenantId) {
  try {
    const res = await pool.query(
      `SELECT integration_type, credentials_json, config FROM tenant_integrations WHERE tenant_id = $1 AND is_enabled = TRUE`,
      [tenantId]
    );
    const integrations = {};
    for (const row of res.rows) {
      integrations[row.integration_type] = {
        credentials: row.credentials_json,
        config: row.config || {},
      };
    }
    return integrations;
  } catch (err) {
    logger.error({ err }, 'Error obteniendo integraciones del tenant');
    return {};
  }
}

/**
 * Registra la interacción en message_logs guardando el conteo de tokens
 */
async function logMessage(tenantId, senderJid, incomingText, responseText, tokensUsed = 0, promptTokens = 0, completionTokens = 0) {
  try {
    await pool.query(
      `INSERT INTO message_logs (id, tenant_id, sender_jid, incoming_text, outgoing_response, handled_by_ai, tokens_used, prompt_tokens, completion_tokens)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8)`,
      [`log-${uuidv4().substring(0, 8)}`, tenantId, senderJid, incomingText, responseText, tokensUsed, promptTokens, completionTokens]
    );
  } catch (err) {
    logger.error({ err }, 'Error registrando log de mensaje en Postgres');
  }
}

function extractCleanPhoneNumber(senderJid) {
  if (!senderJid) return '';
  // Si el JID viene en formato LID de WhatsApp (@lid), los dígitos corresponden al LID interno y no al teléfono real.
  if (senderJid.includes('@lid')) {
    return 'Pendiente (Confirmar por Chat)';
  }
  const digits = senderJid.replace(/[^0-9]/g, '');
  if (digits.length === 8) {
    return `+505 ${digits.slice(0, 4)}-${digits.slice(4)}`;
  } else if (digits.length === 11 && digits.startsWith('505')) {
    return `+${digits.slice(0, 3)} ${digits.slice(3, 7)}-${digits.slice(7)}`;
  } else if (digits.length >= 8 && digits.length <= 12) {
    return `+${digits}`;
  }
  return 'Pendiente (Confirmar por Chat)';
}

/**
 * Obtiene el Estado de Sesión JSONB de la conversación
 */
async function getSessionState(tenantId, senderJid) {
  try {
    const res = await pool.query(
      `SELECT state_data FROM chat_session_states WHERE tenant_id = $1 AND sender_jid = $2 LIMIT 1`,
      [tenantId, senderJid]
    );
    if (res.rows.length > 0) {
      return res.rows[0].state_data || {};
    }
  } catch (err) {
    logger.error({ err }, 'Error obteniendo session state');
  }
  return {};
}

/**
 * Actualiza el Estado de Sesión JSONB de la conversación
 */
async function updateSessionState(tenantId, senderJid, partialState) {
  try {
    const currentState = await getSessionState(tenantId, senderJid);
    const newState = { ...currentState, ...partialState, updated_at: new Date().toISOString() };
    await pool.query(
      `INSERT INTO chat_session_states (tenant_id, sender_jid, state_data, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tenant_id, sender_jid)
       DO UPDATE SET state_data = $3, updated_at = NOW()`,
      [tenantId, senderJid, JSON.stringify(newState)]
    );
    return newState;
  } catch (err) {
    logger.error({ err }, 'Error actualizando session state');
    return {};
  }
}

/**
 * Envia un mensaje vía WhatsApp Gateway con soporte para presencia ("escribiendo...") y retardo aleatorio
 */
async function sendWhatsAppMessage(tenantId, toJid, text, options = { simulateTyping: true }) {
  try {
    const { mediaBase64, mediaMimeType, fileName, simulateTyping } = options || {};
    const res = await fetch(`${GATEWAY_URL}/api/gateway/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId,
        toJid,
        text,
        mediaBase64,
        mediaMimeType,
        fileName,
        options: { simulateTyping: simulateTyping !== false }
      })
    });
    return res.ok;
  } catch (err) {
    logger.error({ err, tenantId, toJid }, 'Error enviando mensaje vía Gateway');
    return false;
  }
}

/**
 * Envía una tarjeta de evento nativa de WhatsApp (Event Card) vía Gateway
 */
async function sendWhatsAppEventMessage(tenantId, toJid, eventData) {
  try {
    const { name, description, startTime, endTime, locationName } = eventData;
    const res = await fetch(`${GATEWAY_URL}/api/gateway/send-event-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantId,
        toJid,
        name,
        description,
        startTime,
        endTime,
        locationName
      })
    });
    return res.ok;
  } catch (err) {
    logger.error({ err, tenantId, toJid }, 'Error enviando tarjeta de evento nativa vía Gateway');
    return false;
  }
}

/**
 * Genera el arreglo de declaraciones de funciones para Gemini
 */
function buildFunctionDeclarations(integrations) {
  const declarations = [];

  if (integrations.GOOGLE_SHEETS) {
    declarations.push({
      name: 'read_google_sheet',
      description: 'Lee un rango de celdas de una Hoja de Cálculo de Google (para consultar catálogos, precios o preguntas frecuentes).',
      parameters: {
        type: Type.OBJECT,
        properties: {
          range: {
            type: Type.STRING,
            description: 'Rango a consultar en la hoja, ej: "Sheet1!A1:D50" o "Precios!A:C"',
          },
        },
      },
    });

    declarations.push({
      name: 'append_lead_to_google_sheet',
      description: 'Registra una nueva fila con datos de un cliente o lead (nombre, teléfono, correo, servicio de interés, notas) en Google Sheets.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          values: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Lista de valores ordenados a insertar como fila, ej: ["Juan Pérez", "+50499998888", "juan@mail.com", "Rastreo GPS", "2026-09-18"]',
          },
          range: {
            type: Type.STRING,
            description: 'Nombre de la pestaña/rango opcional, por defecto usa la pestaña configurada.',
          },
        },
        required: ['values'],
      },
    });
  }

  if (integrations.GOOGLE_CALENDAR) {
    declarations.push({
      name: 'check_calendar_availability',
      description: 'Verifica la disponibilidad de horarios en Google Calendar dentro de un rango de tiempo.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          time_min: {
            type: Type.STRING,
            description: 'Fecha y hora de inicio de la búsqueda en formato ISO 8601 (ej: 2026-09-18T09:00:00Z)',
          },
          time_max: {
            type: Type.STRING,
            description: 'Fecha y hora de fin de la búsqueda en formato ISO 8601 (ej: 2026-09-18T18:00:00Z)',
          },
        },
        required: ['time_min', 'time_max'],
      },
    });

    declarations.push({
      name: 'create_calendar_appointment',
      description: 'Crea un evento o agendamiento de cita en la agenda de Google Calendar.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          summary: {
            type: Type.STRING,
            description: 'Título o resumen de la cita, ej: "Demostración WebSavvy - Carlos López"',
          },
          description: {
            type: Type.STRING,
            description: 'Detalles adicionales, teléfono o notas de la cita.',
          },
          start_iso: {
            type: Type.STRING,
            description: 'Fecha y hora de inicio en formato ISO 8601 (ej: 2026-09-18T15:00:00Z)',
          },
          end_iso: {
            type: Type.STRING,
            description: 'Fecha y hora de fin en formato ISO 8601 (ej: 2026-09-18T15:30:00Z)',
          },
          attendee_email: {
            type: Type.STRING,
            description: 'Correo electrónico del asistente para enviar la invitación.',
          },
        },
        required: ['summary', 'start_iso', 'end_iso'],
      },
    });
  }

  if (integrations.GOOGLE_DRIVE) {
    declarations.push({
      name: 'send_drive_media',
      description: 'Busca y envía nativamente por WhatsApp una imagen, folleto, promoción o documento PDF desde la carpeta de Google Drive según la necesidad del cliente.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          file_query: {
            type: Type.STRING,
            description: 'Nombre o palabra clave del archivo a buscar en Google Drive (ej: "promocion facial", "catalogo 2026", "pdf membresia", "lista de precios"). Obligatorio.',
          },
          caption: {
            type: Type.STRING,
            description: 'Texto explicativo o mensaje promocional breve que acompañará la imagen o documento enviada al cliente.',
          },
        },
        required: ['file_query'],
      },
    });
  }

  // Herramienta de Creación y Despacho de Pedidos Logísticos (Delivery)
  declarations.push({
    name: 'dispatch_delivery_order',
    description: 'Crea y despacha una orden de delivery a los repartidores asignados. Requiere obligatorio: buyer_name, buyer_address, product_code y cash_amount. El bot DEBE preguntar al cliente: "¿Con cuánto Dinero va a cancelar? Para llevarle su cambio" para notificar el cambio exacto al repartidor. El teléfono (contact_phone) se solicita pero si el cliente objeta o declina, NO INSISTIR y pasar "Solicitar al comercio".',
    parameters: {
      type: Type.OBJECT,
      properties: {
        product_code: {
          type: Type.STRING,
          description: 'Código o nombre del producto/artículos a entregar (ej: NB1002-2, Perfume Sauvage). Obligatorio.',
        },
        size: {
          type: Type.STRING,
          description: 'Talla o variante seleccionada por el cliente (ej: 38, M, XL, 100ml).',
        },
        price: {
          type: Type.NUMBER,
          description: 'Precio total del producto.',
        },
        buyer_name: {
          type: Type.STRING,
          description: 'Nombre completo del cliente comprador. Obligatorio.',
        },
        buyer_address: {
          type: Type.STRING,
          description: 'Dirección exacta de entrega brindada por el cliente. Obligatorio.',
        },
        payment_method: {
          type: Type.STRING,
          description: 'Método de pago (ej: Efectivo, Transferencia).',
        },
        cash_amount: {
          type: Type.STRING,
          description: 'Monto de dinero con que pagará el cliente o especificación del cambio/vuelto (ej: Paga con C$1,000 / Cambio C$250, o Pago Exacto). Preguntar siempre: "¿Con cuánto Dinero va a cancelar? Para llevarle su cambio". Obligatorio.',
        },
        contact_phone: {
          type: Type.STRING,
          description: 'Número telefónico de contacto del cliente. Si el cliente declina u objeta ("es este mismo número", "deberías de verlo", "no quiero darlo"), enviar "Solicitar al comercio".',
        },
      },
      required: ['product_code', 'buyer_name', 'buyer_address', 'cash_amount'],
    },
  });

  // Alias compatible create_customer_order
  declarations.push({
    name: 'create_customer_order',
    description: 'Alias de despacho de pedido a delivery.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        product_name: { type: Type.STRING },
        price: { type: Type.NUMBER },
        buyer_name: { type: Type.STRING },
        buyer_address: { type: Type.STRING },
      },
      required: ['product_name', 'buyer_name', 'buyer_address'],
    },
  });

  // Herramienta de Consulta Silenciosa a Distribuidor
  declarations.push({
    name: 'notify_distributor_stock_query',
    description: 'Envía una consulta silenciosa por WhatsApp al Distribuidor asignado para verificar disponibilidad/stock real de un producto de parte del comercio/tienda.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        distributor_letter: {
          type: Type.STRING,
          description: 'Letra del distribuidor (A, B, C, D, E, F). Opcional.',
        },
        product_code: {
          type: Type.STRING,
          description: 'Código del producto a consultar (ej: NB1002-2, K906-6).',
        },
        product_name: {
          type: Type.STRING,
          description: 'Nombre o descripción del producto/artículo (ej: Perfume Sauvage, Zapatos Oxford).',
        },
        size: {
          type: Type.STRING,
          description: 'Talla, variante o especificación del producto (ej: 38, 100ml).',
        },
      },
      required: [],
    },
  });

  return declarations;
}

/**
 * Ejecuta la herramienta requerida por Gemini
 */
async function executeToolCall(call, integrations, tenantId, senderJid) {
  const { name, args } = call;
  logger.info({ name, args }, 'Ejecutando llamada a herramienta requerida por Gemini...');

  if (name === 'read_google_sheet') {
    const sheetConfig = integrations.GOOGLE_SHEETS;
    if (!sheetConfig || !sheetConfig.credentials) {
      return { error: 'Integración de Google Sheets no configurada o inactiva' };
    }
    const spreadsheetId = sheetConfig.config.spreadsheet_id;
    const range = args.range || sheetConfig.config.default_sheet_name || 'Sheet1!A1:Z100';
    return await readSheetRange({ credentials: sheetConfig.credentials, spreadsheetId, range });
  }

  if (name === 'append_lead_to_google_sheet') {
    const sheetConfig = integrations.GOOGLE_SHEETS;
    if (!sheetConfig || !sheetConfig.credentials) {
      return { error: 'Integración de Google Sheets no configurada o inactiva' };
    }
    const spreadsheetId = sheetConfig.config.spreadsheet_id;
    const range = args.range || sheetConfig.config.default_sheet_name || 'Sheet1!A:Z';
    return await appendSheetRow({ credentials: sheetConfig.credentials, spreadsheetId, range, values: args.values });
  }

  if (name === 'check_calendar_availability') {
    const calConfig = integrations.GOOGLE_CALENDAR;
    if (!calConfig || !calConfig.credentials) {
      return { error: 'Integración de Google Calendar no configurada o inactiva' };
    }
    const calendarId = calConfig.config.calendar_id || 'primary';
    const timeZone = calConfig.config.timezone || 'America/Tegucigalpa';
    return await checkAvailability({
      credentials: calConfig.credentials,
      calendarId,
      timeMin: args.time_min,
      timeMax: args.time_max,
      timeZone,
    });
  }

  if (name === 'create_calendar_appointment') {
    const calConfig = integrations.GOOGLE_CALENDAR;
    if (!calConfig || !calConfig.credentials) {
      return { error: 'Integración de Google Calendar no configurada o inactiva' };
    }
    const calendarId = calConfig.config.calendar_id || 'primary';
    const timeZone = calConfig.config.timezone || 'America/Tegucigalpa';
    const calResult = await createCalendarEvent({
      credentials: calConfig.credentials,
      calendarId,
      summary: args.summary,
      description: args.description,
      startIso: args.start_iso,
      endIso: args.end_iso,
      attendeeEmail: args.attendee_email,
      timeZone,
    });

    if (calResult && calResult.success && senderJid) {
      logger.info({ tenantId, senderJid, summary: args.summary }, 'Enviando tarjeta de evento nativa de WhatsApp en tándem...');
      await sendWhatsAppEventMessage(tenantId, senderJid, {
        name: args.summary || 'Cita Agendada',
        description: args.description || 'Evento agendado exitosamente',
        startTime: args.start_iso,
        endTime: args.end_iso,
        locationName: calConfig.config?.location || ''
      });
    }

    return calResult;
  }

  if (name === 'send_drive_media') {
    const driveConfig = integrations.GOOGLE_DRIVE;
    if (!driveConfig || !driveConfig.credentials) {
      return { error: 'Integración de Google Drive no configurada o inactiva' };
    }
    const folderId = driveConfig.config?.folder_id || '';
    const result = await searchAndDownloadDriveFile({
      credentials: driveConfig.credentials,
      folderId,
      fileQuery: args.file_query,
    });

    if (result.success && result.mediaBase64) {
      const captionText = args.caption || `📎 Te comparto el archivo de ${result.fileName}`;
      const sentOk = await sendWhatsAppMessage(tenantId, senderJid, captionText, {
        mediaBase64: result.mediaBase64,
        mediaMimeType: result.mimeType,
        fileName: result.fileName,
        simulateTyping: true,
      });

      if (sentOk) {
        return {
          success: true,
          fileName: result.fileName,
          message: `El archivo ${result.fileName} ha sido enviado exitosamente al cliente por WhatsApp.`
        };
      } else {
        return { success: false, error: 'No se pudo enviar el archivo multimedia a través del Gateway de WhatsApp.' };
      }
    } else {
      return { success: false, error: result.error || 'No se encontró el archivo solicitado en Google Drive.' };
    }
  }

  if (name === 'dispatch_delivery_order' || name === 'create_customer_order') {
    try {
      const orderId = `ord-${uuidv4().substring(0, 8)}`;
      const productName = args.product_code || args.product_name || 'Producto';
      const sizeStr = args.size ? ` (Talla: ${args.size})` : '';
      
      const rawPhone = (args.contact_phone || '').trim();
      let customerPhone = 'Solicitar al comercio';
      if (rawPhone && !rawPhone.toLowerCase().includes('solicitar') && !rawPhone.toLowerCase().includes('mismo') && !rawPhone.toLowerCase().includes('declin') && !rawPhone.toLowerCase().includes('objec')) {
        customerPhone = rawPhone;
      } else {
        const cleanExtracted = extractCleanPhoneNumber(senderJid);
        if (cleanExtracted && cleanExtracted.length >= 8) {
          customerPhone = cleanExtracted;
        } else {
          customerPhone = 'Solicitar al comercio';
        }
      }

      await pool.query(
        `INSERT INTO orders (id, tenant_id, buyer_jid, buyer_name, buyer_address, product_name, price, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'BROADCASTING_DELIVERY')`,
        [orderId, tenantId, senderJid, args.buyer_name, args.buyer_address, `${productName}${sizeStr}`, args.price || 0.00]
      );

      // Actualizar estado persistente de la sesión
      await updateSessionState(tenantId, senderJid, {
        product_code: productName,
        size_selected: args.size || null,
        buyer_name: args.buyer_name,
        buyer_address: args.buyer_address,
        payment_method: args.payment_method || 'Efectivo',
        contact_phone: customerPhone,
        last_order_id: orderId,
        order_status: 'DISPATCHED_TO_DELIVERY'
      });

      // Obtener repartidores del tenant para enviar Broadcast WhatsApp
      const driversRes = await pool.query(
        `SELECT phone_whatsapp, name FROM tenant_delivery_drivers WHERE tenant_id = $1 AND is_active = TRUE`,
        [tenantId]
      );

      const cashStr = args.cash_amount ? `\n💵 *Monto / Vuelto*: ${args.cash_amount}` : '';
      const currencySymbol = (args.price && args.price > 100) ? 'C$' : '$';

      const broadcastMessage = `🛵 *NUEVO PEDIDO DE DELIVERY #${orderId}*\n\n` +
        `📦 *Producto*: ${productName}${sizeStr}\n` +
        `💰 *Precio*: ${currencySymbol}${args.price || 0.00}\n` +
        `👤 *Cliente*: ${args.buyer_name}\n` +
        `📞 *Teléfono del Cliente*: ${customerPhone}\n` +
        `📍 *Dirección de Entrega*: ${args.buyer_address}\n` +
        `💳 *Método de Pago*: ${args.payment_method || 'Efectivo'}${cashStr}\n\n` +
        ` Responde *"1"* o *"Acepto"* a este mensaje para tomar este pedido.`;

      for (let i = 0; i < driversRes.rows.length; i++) {
        const driver = driversRes.rows[i];
        let driverJid = driver.phone_whatsapp.replace(/[^0-9]/g, '');
        if (!driverJid.includes('@s.whatsapp.net')) {
          driverJid = `${driverJid}@s.whatsapp.net`;
        }

        if (i > 0) {
          const staggerDelayMs = 2000 + Math.floor(Math.random() * 2500);
          logger.info({ driverJid, staggerDelayMs }, 'Aplicando retardo aleatorio entre envíos a repartidores');
          await new Promise(resolve => setTimeout(resolve, staggerDelayMs));
        }

        await sendWhatsAppMessage(tenantId, driverJid, broadcastMessage, { simulateTyping: true });
      }

      // Auto-pausar la IA del comprador por 30 minutos (1800s) tras completar el pedido
      await redis.setex(`ai_paused:${tenantId}:${senderJid}`, 1800, 'true');
      logger.info({ tenantId, senderJid, orderId }, 'IA auto-pausada por 30 minutos tras completar despacho de pedido');

      logger.info({ tenantId, orderId, driverCount: driversRes.rows.length, customerPhone }, 'Pedido registrado y broadcast enviado a repartidores con teléfono del cliente');
      return {
        success: true,
        orderId,
        customerPhone,
        message: 'Pedido registrado con éxito. Se ha enviado la notificación de delivery a los repartidores disponibles.'
      };
    } catch (err) {
      logger.error({ err }, 'Error creando orden logística');
      return { success: false, error: err.message };
    }
  }

  if (name === 'notify_distributor_stock_query') {
    try {
      const letter = (args.distributor_letter || 'A').toUpperCase();
      const distRes = await pool.query(
        `SELECT id, phone_whatsapp, name FROM tenant_distributors WHERE tenant_id = $1 AND (distributor_letter = $2 OR is_active = TRUE) ORDER BY created_at ASC LIMIT 1`,
        [tenantId, letter]
      );

      let distributorName = `Distribuidor ${letter}`;
      let distJid = null;

      if (distRes.rows.length > 0) {
        distributorName = distRes.rows[0].name || distributorName;
        const cleanPhone = distRes.rows[0].phone_whatsapp.replace(/[^0-9]/g, '');
        distJid = `${cleanPhone}@s.whatsapp.net`;
      }

      // Obtener el nombre comercial del Tenant / Empresa
      const tenantRes = await pool.query(`SELECT name FROM tenants WHERE id = $1`, [tenantId]);
      const storeName = tenantRes.rows.length > 0 ? tenantRes.rows[0].name : 'Nuestra Tienda';

      const itemLabel = args.product_name || args.product_code || 'el artículo solicitado';
      const codeSuffix = (args.product_code && args.product_name) ? ` (Código: ${args.product_code})` : '';
      const sizeSuffix = args.size ? ` (Talla/Variante: ${args.size})` : '';

      const queryMsg = `Hola *${distributorName}*, les saludamos de parte de *${storeName}*.\n\n` +
        `¿Tienen disponibilidad del artículo *${itemLabel}*${codeSuffix}${sizeSuffix}?\n\n` +
        `Por favor confirmarnos si hay existencias disponibles en bodega. ¡Muchas gracias!`;

      if (distJid) {
        await sendWhatsAppMessage(tenantId, distJid, queryMsg, { simulateTyping: true });
        logger.info({ tenantId, distJid, itemLabel, storeName, distributorName }, 'Consulta de disponibilidad enviada al distribuidor vía WhatsApp');
      }

      return {
        success: true,
        distributor: distributorName,
        store_name: storeName,
        product: itemLabel,
        message: `Consulta de stock enviada exitosamente al ${distributorName} de parte de ${storeName} para verificar disponibilidad del artículo ${itemLabel}. Informa al cliente que estás verificando la existencia en bodega.`
      };
    } catch (err) {
      logger.error({ err }, 'Error notificando al distribuidor');
      return { success: false, error: err.message };
    }
  }

  return { error: `Herramienta desconocida: ${name}` };
}

/**
 * Revisa si el mensaje entrante proviene de un Repartidor registrando acciones del pedido.
 * Soporta emparejamiento por número de teléfono, JID directo o aprendizaje dinámico de identificadores WhatsApp @lid.
 */
async function checkDriverResponse(tenantId, senderJid, text) {
  const normalizedText = text.trim().toLowerCase();
  const phoneClean = senderJid.split('@')[0];

  // 1. Buscar coincidencia por driver_jid directo, phone_whatsapp o dígitos limpia
  let driverRes = await pool.query(
    `SELECT * FROM tenant_delivery_drivers 
     WHERE tenant_id = $1 
       AND (driver_jid = $2 OR phone_whatsapp LIKE $3 OR phone_whatsapp LIKE $4) 
       AND is_active = TRUE 
     LIMIT 1`,
    [tenantId, senderJid, `%${phoneClean}%`, `%${phoneClean.substring(phoneClean.length - 8)}%`]
  );

  let driver = driverRes.rows.length > 0 ? driverRes.rows[0] : null;

  // 2. Si no hay coincidencia directa (ej: senderJid es un @lid no guardado previamente) y el texto es un comando de repartidor
  const isDriverKeyword = normalizedText === '1' || 
    normalizedText.includes('acepto') || 
    normalizedText.includes('tomo pedido') || 
    normalizedText.includes('voy en camino') || 
    normalizedText.includes('entregad') || 
    normalizedText.includes('cancelad') || 
    normalizedText.includes('rechazad');

  if (!driver && isDriverKeyword) {
    // Buscar si hay un repartidor activo en el tenant
    const fallbackDriverRes = await pool.query(
      `SELECT * FROM tenant_delivery_drivers WHERE tenant_id = $1 AND is_active = TRUE ORDER BY created_at ASC LIMIT 1`,
      [tenantId]
    );

    if (fallbackDriverRes.rows.length > 0) {
      driver = fallbackDriverRes.rows[0];
      // Aprender dinámicamente el driver_jid (@lid) y vincularlo
      await pool.query(
        `UPDATE tenant_delivery_drivers SET driver_jid = $1, updated_at = NOW() WHERE id = $2`,
        [senderJid, driver.id]
      );
      logger.info({ tenantId, driverId: driver.id, senderJid }, 'Vinculado dinámicamente driver_jid (@lid) al repartidor');
    }
  }

  if (!driver) {
    return false; // No es un repartidor registrado, continuar con la atención normal al cliente
  }

  // Si se emparejó el repartidor y no tenía driver_jid guardado, actualizarlo
  if (!driver.driver_jid) {
    await pool.query(
      `UPDATE tenant_delivery_drivers SET driver_jid = $1, updated_at = NOW() WHERE id = $2`,
      [senderJid, driver.id]
    );
  }

  // A) ACEPACIÓN DE PEDIDO ("1", "acepto", "tomo pedido", "voy en camino")
  if (normalizedText === '1' || normalizedText.includes('acepto') || normalizedText.includes('tomo pedido') || normalizedText.includes('voy en camino')) {
    const orderRes = await pool.query(
      `SELECT * FROM orders WHERE tenant_id = $1 AND status = 'BROADCASTING_DELIVERY' ORDER BY created_at DESC LIMIT 1`,
      [tenantId]
    );

    if (orderRes.rows.length === 0) {
      await sendWhatsAppMessage(tenantId, senderJid, `Hola ${driver.name}, actualmente no hay pedidos pendientes por tomar.`);
      return true;
    }

    const order = orderRes.rows[0];

    await pool.query(
      `UPDATE orders SET driver_id = $1, status = 'ASSIGNED_DRIVER', updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [driver.id, order.id]
    );

    await sendWhatsAppMessage(tenantId, senderJid, 
      `¡Excelente ${driver.name}! Has tomado el pedido #${order.id}.\n\n` +
      `👤 Cliente: ${order.buyer_name}\n` +
      `📍 Dirección: ${order.buyer_address}\n` +
      `📦 Producto: ${order.product_name} ($${order.price})`
    );

    await sendWhatsAppMessage(tenantId, order.buyer_jid, 
      `🛵 *¡Tu pedido ha sido asignado a un repartidor!*\n\n` +
      `Tu producto *${order.product_name}* va en camino con nuestro repartidor *${driver.name}* (+${driver.phone_whatsapp}).`
    );

    logger.info({ tenantId, orderId: order.id, driverId: driver.id }, 'Pedido asignado a repartidor tras aceptación por WhatsApp');
    return true;
  }

  // B) CONFIRMACIÓN DE ENTREGA ("entregado", "completado", "listo entregado")
  if (normalizedText.includes('entregad') || normalizedText.includes('completad') || normalizedText.includes('entregue') || normalizedText.includes('entregué')) {
    const orderRes = await pool.query(
      `SELECT * FROM orders WHERE tenant_id = $1 AND (driver_id = $2 OR status = 'ASSIGNED_DRIVER') ORDER BY updated_at DESC LIMIT 1`,
      [tenantId, driver.id]
    );

    if (orderRes.rows.length === 0) {
      await sendWhatsAppMessage(tenantId, senderJid, `Hola ${driver.name}, no tienes pedidos activos en camino para marcar como entregados.`);
      return true;
    }

    const order = orderRes.rows[0];

    await pool.query(
      `UPDATE orders SET status = 'DELIVERED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [order.id]
    );

    await sendWhatsAppMessage(tenantId, senderJid, 
      `✅ *¡Gran trabajo ${driver.name}!* El pedido #${order.id} ha sido registrado como *ENTREGADO CON ÉXITO*.`
    );

    await sendWhatsAppMessage(tenantId, order.buyer_jid, 
      `🎉 *¡Tu pedido ha sido entregado con éxito!*\n\n` +
      `Muchas gracias por tu compra. Esperamos que disfrutes tu producto.`
    );

    logger.info({ tenantId, orderId: order.id, driverId: driver.id }, 'Pedido marcado como DELIVERED tras confirmación del repartidor');
    return true;
  }

  // C) CANCELACIÓN / RECHAZO / NO RECIBIDO ("cancelado", "rechazado", "no recibido", "declinado")
  if (normalizedText.includes('cancelad') || normalizedText.includes('rechazad') || normalizedText.includes('no recibid') || normalizedText.includes('declinad') || normalizedText.includes('no quizo') || normalizedText.includes('no quiso')) {
    const orderRes = await pool.query(
      `SELECT * FROM orders WHERE tenant_id = $1 AND (driver_id = $2 OR status IN ('ASSIGNED_DRIVER', 'BROADCASTING_DELIVERY')) ORDER BY updated_at DESC LIMIT 1`,
      [tenantId, driver.id]
    );

    if (orderRes.rows.length === 0) {
      await sendWhatsAppMessage(tenantId, senderJid, `Hola ${driver.name}, no tienes pedidos activos asignados para cancelar.`);
      return true;
    }

    const order = orderRes.rows[0];

    await pool.query(
      `UPDATE orders SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [order.id]
    );

    await sendWhatsAppMessage(tenantId, senderJid, 
      `⚠️ *Registrado*: El pedido #${order.id} ha sido marcado como *CANCELADO / NO ENTREGADO*.`
    );

    await sendWhatsAppMessage(tenantId, order.buyer_jid, 
      `⚠️ *Reporte de Envío*: Se ha notificado que tu pedido #${order.id} no pudo ser entregado o fue cancelado. Si requieres asistencia, un asesor te responderá a la brevedad.`
    );

    logger.info({ tenantId, orderId: order.id, driverId: driver.id }, 'Pedido marcado como CANCELLED tras reporte del repartidor');
    return true;
  }

  // D) CUALQUIER OTRO MENSAJE DE UN REPARTIDOR REGISTRADO
  await sendWhatsAppMessage(tenantId, senderJid, 
    `Hola ${driver.name}, como repartidor puedes responder:\n` +
    `• *"1"* o *"Acepto"* para tomar un nuevo pedido.\n` +
    `• *"Entregado"* al finalizar la entrega al cliente.\n` +
    `• *"Cancelado"* si el cliente rechazó o declinó la compra.`
  );
  return true;
}

/**
 * Revisa si el mensaje entrante proviene de un Distribuidor respondiendo a una consulta de stock.
 */
async function checkDistributorResponse(tenantId, senderJid, text) {
  const phoneClean = senderJid.split('@')[0];

  const distRes = await pool.query(
    `SELECT * FROM tenant_distributors 
     WHERE tenant_id = $1 
       AND (phone_whatsapp LIKE $2 OR phone_whatsapp LIKE $3) 
       AND is_active = TRUE 
     LIMIT 1`,
    [tenantId, `%${phoneClean}%`, `%${phoneClean.substring(phoneClean.length - 8)}%`]
  );

  if (distRes.rows.length === 0) {
    return false; // No es un distribuidor registrado
  }

  const distributor = distRes.rows[0];
  const normalizedText = text.trim().toLowerCase();

  if (normalizedText === '1' || normalizedText.includes('si') || normalizedText.includes('sí') || normalizedText.includes('disponible') || normalizedText.includes('tengo') || normalizedText.includes('hay stock') || normalizedText.includes('confirmad')) {
    await sendWhatsAppMessage(tenantId, senderJid,
      `¡Muchas gracias *${distributor.name}*! Queda confirmada la disponibilidad del producto. Prosigo con la atención.`
    );
    logger.info({ tenantId, distributorName: distributor.name, text }, 'Distribuidor confirmó disponibilidad de stock por WhatsApp');
    return true;
  }

  if (normalizedText.includes('no') || normalizedText.includes('agotad') || normalizedText.includes('sin stock') || normalizedText.includes('no hay')) {
    await sendWhatsAppMessage(tenantId, senderJid,
      `Entendido *${distributor.name}*, anotamos que no hay existencias por el momento. ¡Muchas gracias!`
    );
    logger.info({ tenantId, distributorName: distributor.name, text }, 'Distribuidor reportó agotado/sin stock por WhatsApp');
    return true;
  }

  return false;
}

/**
 * Procesa un mensaje entrante mediante la API de Gemini con apoyo de Herramientas
 */
async function processIncomingMessage(payload) {
  const { tenantId, senderJid, text, mediaBase64, mediaMimeType } = payload;
  logger.info({ tenantId, senderJid, text, hasImage: !!mediaBase64 }, 'Procesando mensaje con Gemini AI...');

  // Guard de Grupos y Difusiones (Doble Capa de Seguridad en AI Engine)
  if (!senderJid || senderJid.includes('@g.us') || senderJid.includes('@broadcast') || senderJid.includes('@newsletter')) {
    logger.warn({ tenantId, senderJid }, '⛔ AI Engine: Interceptado mensaje de grupo en la cola. Abortando sin responder.');
    return;
  }

  // Verificar si la IA está pausada por Human Takeover
  const isPaused = await redis.get(`ai_paused:${tenantId}:${senderJid}`);
  if (isPaused === 'true') {
    logger.info({ tenantId, senderJid }, 'IA en pausa por intervención humana. Omitiendo respuesta automática.');
    return;
  }

  // Intercepta si el mensaje es de un Repartidor aceptando una carrera
  const isDriverAccepted = await checkDriverResponse(tenantId, senderJid, text);
  if (isDriverAccepted) {
    return;
  }

  // Intercepta si el mensaje es de un Distribuidor respondiendo sobre la consulta de stock
  const isDistributorHandled = await checkDistributorResponse(tenantId, senderJid, text);
  if (isDistributorHandled) {
    return;
  }

  // Guard de anomalías y código aislado: Si el texto es un código suelto como "X2", "+1", etc., y no hay historial previo
  const cleanLower = (text || '').trim().toLowerCase();
  const anomalyPatterns = ['x2', 'x 2', '+1', 'x', 'x3', 'x4', 'x5', '2x', '3x'];
  if (anomalyPatterns.includes(cleanLower)) {
    const historyRes = await pool.query(
      `SELECT id FROM message_logs WHERE tenant_id = $1 AND sender_jid = $2 LIMIT 1`,
      [tenantId, senderJid]
    );
    if (historyRes.rows.length === 0) {
      logger.info({ tenantId, senderJid, text }, 'Anomalía o código suelto detectado ("X2", "+1", etc.) sin historial. Omitiendo respuesta.');
      return;
    }
  }

  const promptConfig = await getTenantPrompt(tenantId);
  const integrations = await getTenantIntegrations(tenantId);
  const functionDeclarations = buildFunctionDeclarations(integrations);

  const sessionState = await getSessionState(tenantId, senderJid);
  const stateSummaryText = Object.keys(sessionState).length > 0
    ? `\n\n[ESTADO ESTRUCTURADO ACTUAL DE LA SESIÓN (NUNCA OLVIDAR NI PEDIR DE NUEVO DATOS QUE YA FIGURAN AQUÍ)]\n${JSON.stringify(sessionState, null, 2)}`
    : '';

  const nowIso = new Date().toISOString();
  const globalFormatRules = `\n\n[REGLAS OBLIGATORIAS DE FORMATO EN WHATSAPP, CONTINUIDAD Y ATENCIÓN A CLIENTES]\n` +
    `1. FORMATO DE ENLACES: NUNCA uses corchetes ni formato markdown de links como [texto](url) o [url](url). En WhatsApp escribe la URL directamente en texto plano sin corchetes (ejemplo correcto: "Puedes ver la demo en https://menuview.app/bella-vista").\n` +
    `2. MEMORIA DE CONVERSACIÓN Y SEGUIMIENTO DE PEDIDOS: Revisa la secuencia previa de conversación y el ESTADO ESTRUCTURADO ACTUAL. Si el cliente ya realizó un pedido (ej: se le entregó un número de orden "ord-XXXX"), reconócelo amablemente cuando vuelva a escribir. Si el cliente confirma con palabras cortas como "Sí", "Claro", "Ok", responde DIRECTAMENTE a su solicitud.\n` +
    `3. SALUDOS Y ATENCIÓN HUMANA (NUNCA IGNORAR SALUDOS): NUNCA respondas NO_RESPONSE a saludos legítimos como "Buenas tardes", "Buenas noches", "Buenos días", "Hola" o consultas de clientes. Responde SIEMPRE con amabilidad y educación. La palabra clave NO_RESPONSE se reserva ÚNICAMENTE para texto ininteligible/spam de letras aleatorias (ej: "asdfgh", "x2 suelto").\n` +
    `4. PROCESAMIENTO MULTIMODAL DE IMÁGENES Y COSTO DE TOKENS: Si el cliente envía una imagen o foto, analízala visualmente buscando el código de producto (ej: K906-6, NB1002-2, etc.) e invoca de inmediato read_google_sheet(range="A:Z") para verificar el catálogo. Si la imagen NO contiene un código de producto legible (foto sin etiqueta/texto), informa amablemente que no identificas el código en la foto y transfiere la atención a un asesor humano o solicita que te escriban el código en texto. NUNCA pidas imágenes activamente como primera opción ("Envíame fotos") para ahorrar consumo de tokens de visión.\n` +
    `5. MANEJO DE TELÉFONO DE CONTACTO Y OBJECIONES: Durante el checkout de un pedido para delivery, solicita el número telefónico de contacto. SI EL CLIENTE DECLINA O MENCIONA OBJECIONES (ejemplo: "es este mismo número del que escribo", "deberías de verlo", "no quiero darlo"), NO INSISTAS BAJO NINGUNA CIRCUNSTANCIA. Procede de inmediato al cierre de la venta e invoca la herramienta dispatch_delivery_order asignando contact_phone="Solicitar al comercio".\n` +
    `6. ENVÍO DE PUBLICIDAD, FOLLETOS Y DOCUMENTOS DE GOOGLE DRIVE (send_drive_media): Cuando el cliente solicite información detallada de un servicio, folleto en PDF, lista de precios, catálogo o promociones vigentes, invoca de inmediato la herramienta send_drive_media(file_query="...") indicando la palabra clave del archivo deseado para enviarlo directamente como archivo adjunto nativo en WhatsApp.`;

  const fullSystemInstruction = `${promptConfig.system_prompt}${globalFormatRules}${stateSummaryText}\n\n[Contexto del Sistema]\nFecha y hora actual UTC: ${nowIso}. Usa este contexto para interpretar referencias relativas como "hoy", "mañana", "lunes", etc.`;

  let responseText = '';
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  if (!ai) {
    responseText = `[Asistente IA Demo]: Recibí tu mensaje: "${text}". Gracias por escribir a nuestro servicio de WhatsApp.`;
  } else {
    try {
      const config = {
        systemInstruction: fullSystemInstruction,
        temperature: parseFloat(promptConfig.temperature) || 0.7,
      };

      if (functionDeclarations.length > 0) {
        config.tools = [{ functionDeclarations }];
      }

      // Cargar historial de conversación reciente (ampliado a 14 turnos) para máxima profundidad de memoria
      const historyRes = await pool.query(
        `SELECT incoming_text, outgoing_response 
         FROM message_logs 
         WHERE tenant_id = $1 AND sender_jid = $2 
         ORDER BY created_at DESC LIMIT 14`,
        [tenantId, senderJid]
      );

      const rawTurnList = [];
      const historyRows = (historyRes.rows || []).reverse();

      for (const row of historyRows) {
        if (row.incoming_text && row.incoming_text.trim()) {
          rawTurnList.push({ role: 'user', text: row.incoming_text.trim() });
        }
        if (row.outgoing_response && row.outgoing_response.trim()) {
          rawTurnList.push({ role: 'model', text: row.outgoing_response.trim() });
        }
      }

      rawTurnList.push({ role: 'user', text: (text || '[Imagen sin texto]').trim() });

      // Sanitizar la secuencia para garantizar alternancia estricta user <-> model exigida por Gemini
      let contents = [];
      for (const item of rawTurnList) {
        if (contents.length > 0 && contents[contents.length - 1].role === item.role) {
          contents[contents.length - 1].parts[0].text += `\n${item.text}`;
        } else {
          contents.push({
            role: item.role,
            parts: [{ text: item.text }]
          });
        }
      }

      // Adjuntar la imagen en formato inlineData al último turno del usuario si la solicitud contiene imagen
      if (mediaBase64 && mediaMimeType && contents.length > 0) {
        const lastTurn = contents[contents.length - 1];
        if (lastTurn.role === 'user') {
          lastTurn.parts.push({
            inlineData: {
              mimeType: mediaMimeType,
              data: mediaBase64
            }
          });
        }
      }

      let response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents,
        config,
      });

      if (response?.usageMetadata) {
        totalPromptTokens += response.usageMetadata.promptTokenCount || 0;
        totalCompletionTokens += response.usageMetadata.candidatesTokenCount || 0;
      }

      let functionCalls = response.functionCalls || [];

      if ((!functionCalls || functionCalls.length === 0) && response.candidates?.[0]?.content?.parts) {
        functionCalls = response.candidates[0].content.parts
          .filter(part => part.functionCall)
          .map(part => part.functionCall);
      }

      let toolIteration = 0;
      while (functionCalls && functionCalls.length > 0 && toolIteration < 3) {
        toolIteration++;
        logger.info({ toolCount: functionCalls.length, toolIteration }, 'Gemini requiere ejecución de herramientas');

        const modelContent = response.candidates?.[0]?.content || {
          role: 'model',
          parts: functionCalls.map(fc => ({ functionCall: fc })),
        };
        contents.push(modelContent);

        const functionResponseParts = [];
        for (const call of functionCalls) {
          const result = await executeToolCall(call, integrations, tenantId, senderJid);
          functionResponseParts.push({
            functionResponse: {
              name: call.name,
              response: { result },
            },
          });
        }

        contents.push({
          role: 'user',
          parts: functionResponseParts,
        });

        response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents,
          config,
        });

        if (response?.usageMetadata) {
          totalPromptTokens += response.usageMetadata.promptTokenCount || 0;
          totalCompletionTokens += response.usageMetadata.candidatesTokenCount || 0;
        }

        functionCalls = response.functionCalls || [];
        if ((!functionCalls || functionCalls.length === 0) && response.candidates?.[0]?.content?.parts) {
          functionCalls = response.candidates[0].content.parts
            .filter(part => part.functionCall)
            .map(part => part.functionCall);
        }
      }

      responseText = response.text || 'Disculpa, no pude generar una respuesta en este momento.';
    } catch (error) {
      logger.error({ errorMsg: error.message || error, stack: error.stack, status: error.status }, 'Error invocando Gemini API con herramientas');
      responseText = 'En este momento estamos experimentando una breve interrupción. Un ejecutivo responderá a la brevedad.';
    }
  }

  if (responseText.trim().includes('NO_RESPONSE')) {
    logger.info({ tenantId, senderJid, text }, 'Gemini detectó anomalía o texto ininteligible/sin solicitud ("NO_RESPONSE"). Omitiendo respuesta.');
    return;
  }

  const totalTokens = totalPromptTokens + totalCompletionTokens;

  // Enviar respuesta a través del WhatsApp Gateway con presencia "composing" y retardo humano
  try {
    const sentOk = await sendWhatsAppMessage(tenantId, senderJid, responseText, { simulateTyping: true });
    if (sentOk) {
      logger.info({ tenantId, senderJid, totalTokens, totalPromptTokens, totalCompletionTokens }, 'Respuesta enviada con éxito a WhatsApp');
      await logMessage(tenantId, senderJid, text, responseText, totalTokens, totalPromptTokens, totalCompletionTokens);
    } else {
      logger.error({ tenantId, senderJid }, 'Error al enviar respuesta al Gateway de WhatsApp');
    }
  } catch (err) {
    logger.error({ err }, 'Error de conexión enviando respuesta al Gateway');
  }
}

/**
 * Worker Loop: Escucha continua de la cola Redis
 */
async function startWorker() {
  logger.info('🤖 AI Engine Worker activo y escuchando la cola redis (whatsapp:incoming:queue)...');

  while (true) {
    try {
      const data = await redis.blpop('whatsapp:incoming:queue', 0);
      if (data && data[1]) {
        const payload = JSON.parse(data[1]);
        await processIncomingMessage(payload);
      }
    } catch (err) {
      logger.error({ err }, 'Error en el worker loop de AI Engine');
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

startWorker();
