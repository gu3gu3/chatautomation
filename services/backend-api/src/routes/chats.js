import express from 'express';
import { pool, redis } from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://whatsapp-gateway:3001';

// GET /api/chats - Listar conversaciones activas del tenant (filtrando estrictamente grupos y NO_RESPONSE)
router.get('/', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;

  try {
    const result = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (sender_jid) 
                id, sender_jid, incoming_text, outgoing_response, handled_by_ai, created_at
         FROM message_logs
         WHERE tenant_id = $1
           AND sender_jid NOT LIKE '%@g.us'
           AND sender_jid NOT LIKE '%@broadcast'
           AND sender_jid NOT LIKE '%@newsletter'
           AND (outgoing_response IS NULL OR outgoing_response != 'NO_RESPONSE')
         ORDER BY sender_jid, created_at DESC
       ) latest_chats
       ORDER BY created_at DESC`,
      [tenantId]
    );

    // Obtener estado de Pausa IA desde Redis por cada JID
    const chats = await Promise.all(result.rows.map(async chat => {
      const isPaused = await redis.get(`ai_paused:${tenantId}:${chat.sender_jid}`);
      return {
        ...chat,
        aiPaused: isPaused === 'true'
      };
    }));

    res.json(chats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/chats/:senderJid/messages - Obtener historial completo de un contacto
router.get('/:senderJid/messages', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;
  const { senderJid } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM message_logs 
       WHERE tenant_id = $1 AND sender_jid = $2
         AND (outgoing_response IS NULL OR outgoing_response != 'NO_RESPONSE')
       ORDER BY created_at ASC`,
      [tenantId, senderJid]
    );

    const isPaused = await redis.get(`ai_paused:${tenantId}:${senderJid}`);

    res.json({
      senderJid,
      aiPaused: isPaused === 'true',
      messages: result.rows
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/chats/:senderJid/toggle-ai - Pausar o Reanudar la IA para un contacto
router.post('/:senderJid/toggle-ai', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;
  const { senderJid } = req.params;
  const { pause } = req.body; // boolean

  try {
    const redisKey = `ai_paused:${tenantId}:${senderJid}`;
    if (pause) {
      await redis.set(redisKey, 'true'); // Pausar IA indefinidamente hasta que el operador la reanude manualmente
    } else {
      await redis.del(redisKey);
    }

    res.json({ status: 'success', senderJid, aiPaused: !!pause });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/chats/send-human - Intervención Humana (Human Takeover)
router.post('/send-human', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;
  const { toJid, text } = req.body;

  if (!toJid || !text) {
    return res.status(400).json({ error: 'toJid y text son requeridos' });
  }

  try {
    // Pausar automáticamente la IA de forma indefinida al enviar respuesta humana
    await redis.set(`ai_paused:${tenantId}:${toJid}`, 'true');

    // Enviar a través del WhatsApp Gateway
    const response = await fetch(`${GATEWAY_URL}/api/gateway/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, toJid, text })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: 'Error enviando mensaje vía Gateway', details: errText });
    }

    // Registrar mensaje en logs como intervención humana
    await pool.query(
      `INSERT INTO message_logs (id, tenant_id, sender_jid, incoming_text, outgoing_response, handled_by_ai)
       VALUES ($1, $2, $3, NULL, $4, FALSE)`,
      [`log-human-${Date.now()}`, tenantId, toJid, text]
    );

    res.json({ status: 'sent', toJid, text, handled_by_ai: false });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
