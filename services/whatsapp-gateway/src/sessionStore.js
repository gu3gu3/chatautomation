import NodeCache from 'node-cache';
import Redis from 'ioredis';
import pg from 'pg';
import pino from 'pino';

const logger = pino({ name: 'session-store' });
const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://ws_admin:ws_secure_pass_2026@localhost:5433/whatsapp_automation'
});

export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6380');

// NodeCache local para el contador de reintentos E2EE de Baileys
export const msgRetryCounterCache = new NodeCache();

/**
 * Guarda un mensaje saliente en Redis durante 1 hora para atender peticiones getMessage E2EE
 */
export async function cacheSentMessage(tenantId, messageId, text) {
  if (!tenantId || !messageId || !text) return;
  try {
    const redisKey = `msg:${tenantId}:${messageId}`;
    await redis.set(redisKey, text, 'EX', 3600); // 1 hora de expiración
  } catch (err) {
    logger.error({ err }, 'Error guardando mensaje en caché de Redis para E2EE');
  }
}

/**
 * Recupera un mensaje enviado previamente para responder solicitudes de re-encriptación de WhatsApp
 */
export async function getCachedSentMessage(tenantId, messageId) {
  if (!tenantId || !messageId) return null;
  try {
    const redisKey = `msg:${tenantId}:${messageId}`;
    return await redis.get(redisKey);
  } catch (err) {
    logger.error({ err }, 'Error consultando mensaje en Redis para E2EE');
    return null;
  }
}

/**
 * Actualiza el estado de la conexión en PostgreSQL
 */
export async function updateSessionStatus(tenantId, status, phoneNumber = null) {
  try {
    await pool.query(
      `INSERT INTO whatsapp_sessions (tenant_id, status, phone_number, last_connected_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (tenant_id) 
       DO UPDATE SET status = $2, phone_number = $3, updated_at = NOW()`,
      [tenantId, status, phoneNumber]
    );
  } catch (err) {
    logger.error({ err }, 'Error actualizando estado de sesión en Postgres');
  }
}

/**
 * Obtiene el estado de la conexión desde PostgreSQL
 */
export async function getSessionStatus(tenantId) {
  try {
    const res = await pool.query(
      `SELECT status, phone_number, last_connected_at FROM whatsapp_sessions WHERE tenant_id = $1`,
      [tenantId]
    );
    if (res.rows.length > 0) {
      return res.rows[0];
    }
  } catch (err) {
    logger.error({ err }, 'Error obteniendo estado de sesión en Postgres');
  }
  return null;
}

/**
 * Obtiene el correo del administrador y nombre de un tenant desde PostgreSQL
 */
export async function getTenantAdminInfo(tenantId) {
  try {
    const res = await pool.query(
      `SELECT u.email as admin_email, t.name as tenant_name 
       FROM users u 
       JOIN tenants t ON t.id = u.tenant_id 
       WHERE u.tenant_id = $1 AND u.role = 'TENANT_OWNER' 
       LIMIT 1`,
      [tenantId]
    );
    if (res.rows.length > 0) {
      return {
        adminEmail: res.rows[0].admin_email,
        tenantName: res.rows[0].tenant_name
      };
    }
  } catch (err) {
    logger.error({ err }, 'Error obteniendo admin_email y nombre del tenant en Postgres');
  }
  return null;
}

/**
 * Obtiene el modo de conexión del tenant ('CENTRALIZED' o 'RELAY')
 */
export async function getTenantConnectionMode(tenantId) {
  try {
    const res = await pool.query(
      `SELECT connection_mode FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId]
    );
    if (res.rows.length > 0) {
      return res.rows[0].connection_mode || 'CENTRALIZED';
    }
  } catch (err) {
    logger.error({ err }, 'Error obteniendo connection_mode del tenant en Postgres');
  }
  return 'CENTRALIZED'; // Default fallback
}

/**
 * Pausa la respuesta automática de IA para un cliente (Human Takeover) por X segundos (default 30 min / 1800s)
 */
export async function pauseAiForTenantJid(tenantId, senderJid, durationSeconds = 1800) {
  if (!tenantId || !senderJid) return;
  try {
    const redisKey = `ai_paused:${tenantId}:${senderJid}`;
    await redis.set(redisKey, 'true', 'EX', durationSeconds);
    logger.info({ tenantId, senderJid, durationSeconds }, '⏸️ IA auto-pausada por intervención humana en WhatsApp Web/Móvil');
  } catch (err) {
    logger.error({ err }, 'Error pausando la IA en Redis para Human Takeover');
  }
}

/**
 * Registra en message_logs un mensaje enviado manualmente desde WhatsApp Web/Móvil (handled_by_ai = false)
 */
export async function logHumanMessage(tenantId, senderJid, messageId, text) {
  if (!tenantId || !senderJid || !text) return;
  try {
    const logId = `msg-manual-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    await pool.query(
      `INSERT INTO message_logs (id, tenant_id, sender_jid, message_id, incoming_text, outgoing_response, handled_by_ai, created_at)
       VALUES ($1, $2, $3, $4, NULL, $5, FALSE, NOW())`,
      [logId, tenantId, senderJid, messageId || logId, text]
    );
    logger.info({ tenantId, senderJid, messageId }, '📝 Mensaje manual de WhatsApp Web registrado en message_logs (handled_by_ai = false)');
  } catch (err) {
    logger.error({ err }, 'Error registrando mensaje manual en message_logs');
  }
}

