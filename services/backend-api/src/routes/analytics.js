import express from 'express';
import pg from 'pg';
import pino from 'pino';

const logger = pino({ name: 'analytics-routes' });
const router = express.Router();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://ws_admin:ws_secure_pass_2026@localhost:5433/whatsapp_automation'
});

// Tarifas estándar Gemini 2.5 Flash ($ por token)
const GEMINI_PROMPT_RATE = 0.000000075; // $0.075 per 1M tokens
const GEMINI_COMPLETION_RATE = 0.0000003; // $0.30 per 1M tokens

/**
 * Función de purga automática: Elimina registros de message_logs mayores a 90 días (3 meses)
 */
export async function purgeOldLogs() {
  try {
    const res = await pool.query(
      `DELETE FROM message_logs WHERE created_at < NOW() - INTERVAL '90 days'`
    );
    if (res.rowCount > 0) {
      logger.info({ deletedCount: res.rowCount }, '🧹 Purga de logs de WhatsApp antiguos (> 90 días) ejecutada con éxito');
    }
  } catch (err) {
    logger.error({ err }, 'Error ejecutando la purga automática de message_logs');
  }
}

// Iniciar tarea programada de purga diaria cada 24 horas
setInterval(purgeOldLogs, 24 * 60 * 60 * 1000);
// Ejecutar una verificación inicial al arrancar el servicio
setTimeout(purgeOldLogs, 10000);

/**
 * GET /api/analytics/token-metrics
 * Retorna las métricas agregadas de tokens y desglose por tenant
 */
router.get('/token-metrics', async (req, res) => {
  const { period = '30days', tenantId } = req.query;

  let dateCondition = "m.created_at >= NOW() - INTERVAL '30 days'";
  let globalDateCondition = "created_at >= NOW() - INTERVAL '30 days'";

  if (period === 'today') {
    dateCondition = "m.created_at >= CURRENT_DATE";
    globalDateCondition = "created_at >= CURRENT_DATE";
  } else if (period === '7days') {
    dateCondition = "m.created_at >= NOW() - INTERVAL '7 days'";
    globalDateCondition = "created_at >= NOW() - INTERVAL '7 days'";
  } else if (period === '90days') {
    dateCondition = "m.created_at >= NOW() - INTERVAL '90 days'";
    globalDateCondition = "created_at >= NOW() - INTERVAL '90 days'";
  } else if (period === 'this_month') {
    dateCondition = "m.created_at >= DATE_TRUNC('month', CURRENT_DATE)";
    globalDateCondition = "created_at >= DATE_TRUNC('month', CURRENT_DATE)";
  }

  try {
    // 1. Totales globales
    let globalQuery = `
      SELECT 
        COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
        COALESCE(SUM(tokens_used), 0) as total_tokens,
        COUNT(id) as total_messages
      FROM message_logs
      WHERE ${globalDateCondition}
    `;

    const globalParams = [];
    if (tenantId) {
      globalQuery += ` AND tenant_id = $1`;
      globalParams.push(tenantId);
    }

    const globalRes = await pool.query(globalQuery, globalParams);
    const globalRow = globalRes.rows[0];

    const totalPrompt = parseInt(globalRow.total_prompt_tokens, 10);
    const totalCompletion = parseInt(globalRow.total_completion_tokens, 10);
    const totalTokens = parseInt(globalRow.total_tokens, 10);
    const totalMessages = parseInt(globalRow.total_messages, 10);

    const estimatedCostUsd = (totalPrompt * GEMINI_PROMPT_RATE) + (totalCompletion * GEMINI_COMPLETION_RATE);

    // 2. Desglose comparativo por Tenant
    let tenantQuery = `
      SELECT 
        t.id as tenant_id,
        t.name as tenant_name,
        t.plan as plan_id,
        COALESCE(SUM(m.prompt_tokens), 0) as prompt_tokens,
        COALESCE(SUM(m.completion_tokens), 0) as completion_tokens,
        COALESCE(SUM(m.tokens_used), 0) as total_tokens,
        COUNT(m.id) as message_count
      FROM tenants t
      LEFT JOIN message_logs m ON t.id = m.tenant_id AND ${dateCondition}
    `;

    const tenantParams = [];
    if (tenantId) {
      tenantQuery += ` WHERE t.id = $1`;
      tenantParams.push(tenantId);
    }

    tenantQuery += ` GROUP BY t.id, t.name, t.plan ORDER BY total_tokens DESC`;

    const tenantRes = await pool.query(tenantQuery, tenantParams);

    const tenantsBreakdown = tenantRes.rows.map(row => {
      const pTokens = parseInt(row.prompt_tokens, 10);
      const cTokens = parseInt(row.completion_tokens, 10);
      const tTokens = parseInt(row.total_tokens, 10);
      const cost = (pTokens * GEMINI_PROMPT_RATE) + (cTokens * GEMINI_COMPLETION_RATE);

      return {
        tenantId: row.tenant_id,
        tenantName: row.tenant_name,
        planId: row.plan_id,
        promptTokens: pTokens,
        completionTokens: cTokens,
        totalTokens: tTokens,
        messageCount: parseInt(row.message_count, 10),
        estimatedCostUsd: parseFloat(cost.toFixed(6))
      };
    });

    res.json({
      period,
      summary: {
        totalPromptTokens: totalPrompt,
        totalCompletionTokens: totalCompletion,
        totalTokens,
        totalMessages,
        estimatedCostUsd: parseFloat(estimatedCostUsd.toFixed(6))
      },
      tenants: tenantsBreakdown
    });
  } catch (error) {
    logger.error({ error }, 'Error calculando métricas de observabilidad de tokens');
    res.status(500).json({ error: error.message });
  }
});

export default router;
