import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// -----------------------------------------------------------------------------
// GET /api/prompts/active — Obtener el System Prompt activo del tenant
// -----------------------------------------------------------------------------
router.get('/active', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;

  try {
    const result = await pool.query(
      `SELECT * FROM prompts WHERE tenant_id = $1 AND is_active = TRUE ORDER BY updated_at DESC LIMIT 1`,
      [tenantId]
    );

    if (result.rows.length === 0) {
      return res.json({
        id: null,
        title: 'Prompt Predeterminado',
        description: 'System prompt inicial por defecto',
        system_prompt: 'Eres un asistente amigable de WhatsApp. Responde las preguntas de los clientes con cortesía.',
        temperature: 0.7
      });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -----------------------------------------------------------------------------
// GET /api/prompts/versions — Obtener versiones de respaldo guardadas (máx 3)
// -----------------------------------------------------------------------------
router.get('/versions', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;

  try {
    const result = await pool.query(
      `SELECT id, tenant_id, title, description, system_prompt, temperature, is_active, created_at, updated_at
       FROM prompts 
       WHERE tenant_id = $1 AND is_active = FALSE 
       ORDER BY created_at DESC 
       LIMIT 3`,
      [tenantId]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -----------------------------------------------------------------------------
// POST /api/prompts/save — Guardar o actualizar el System Prompt Activo
// -----------------------------------------------------------------------------
router.post('/save', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;
  const { title, description, system_prompt, temperature } = req.body;

  if (!system_prompt) {
    return res.status(400).json({ error: 'El cuerpo del System Prompt no puede estar vacío' });
  }

  try {
    // Desactivar cualquier prompt activo anterior
    await pool.query(
      `UPDATE prompts SET is_active = FALSE WHERE tenant_id = $1 AND is_active = TRUE`,
      [tenantId]
    );

    const promptId = `prompt-${uuidv4().substring(0, 8)}`;
    const result = await pool.query(
      `INSERT INTO prompts (id, tenant_id, title, description, system_prompt, temperature, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW()) RETURNING *`,
      [promptId, tenantId, title || 'Prompt Principal', description || '', system_prompt, temperature || 0.7]
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -----------------------------------------------------------------------------
// POST /api/prompts/versions/create — Guardar una nueva versión de respaldo (máx 3)
// -----------------------------------------------------------------------------
router.post('/versions/create', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;
  const { title, description, system_prompt } = req.body;

  if (!system_prompt) {
    return res.status(400).json({ error: 'El texto del prompt no puede estar vacío' });
  }

  try {
    // Verificar cuántos respaldos inactivos existen para este tenant
    const existingCountRes = await pool.query(
      `SELECT id FROM prompts WHERE tenant_id = $1 AND is_active = FALSE ORDER BY created_at ASC`,
      [tenantId]
    );

    // Si ya existen 3 o más respaldos, purgar los más antiguos para mantener exactamente 2 y poder ingresar el nuevo
    if (existingCountRes.rows.length >= 3) {
      const toDeleteCount = existingCountRes.rows.length - 2;
      const idsToDelete = existingCountRes.rows.slice(0, toDeleteCount).map(r => r.id);
      await pool.query(
        `DELETE FROM prompts WHERE id = ANY($1::varchar[])`,
        [idsToDelete]
      );
    }

    const versionId = `version-${uuidv4().substring(0, 8)}`;
    const result = await pool.query(
      `INSERT INTO prompts (id, tenant_id, title, description, system_prompt, temperature, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 0.7, FALSE, NOW(), NOW()) RETURNING *`,
      [versionId, tenantId, title || 'Respaldo de Prompt', description || 'Versión de respaldo guardada', system_prompt]
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -----------------------------------------------------------------------------
// POST /api/prompts/versions/:id/restore — Restaurar una versión de respaldo como Activa
// -----------------------------------------------------------------------------
router.post('/versions/:id/restore', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;
  const { id } = req.params;

  try {
    // 1. Verificar que la versión existe para este tenant
    const targetRes = await pool.query(
      `SELECT * FROM prompts WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );

    if (targetRes.rows.length === 0) {
      return res.status(404).json({ error: 'La versión de respaldo no existe o no pertenece a este tenant' });
    }

    // 2. Marcar todos los prompts de este tenant como inactivos
    await pool.query(
      `UPDATE prompts SET is_active = FALSE WHERE tenant_id = $1`,
      [tenantId]
    );

    // 3. Activar la versión seleccionada
    const restoredRes = await pool.query(
      `UPDATE prompts SET is_active = TRUE, updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, tenantId]
    );

    res.json({
      message: 'Versión restaurada con éxito como System Prompt Principal activo',
      prompt: restoredRes.rows[0]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// -----------------------------------------------------------------------------
// DELETE /api/prompts/versions/:id — Eliminar una versión de respaldo
// -----------------------------------------------------------------------------
router.delete('/versions/:id', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;
  const { id } = req.params;

  try {
    const result = await pool.query(
      `DELETE FROM prompts WHERE id = $1 AND tenant_id = $2 AND is_active = FALSE RETURNING *`,
      [id, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No se encontró la versión de respaldo o ya está activa' });
    }

    res.json({ message: 'Versión de respaldo eliminada correctamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
