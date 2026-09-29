import express from 'express';
import { pool } from '../db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/plans - Listar todos los planes de suscripción disponibles
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM subscription_plans WHERE is_active = TRUE ORDER BY max_distributors ASC, max_drivers ASC`
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/plans - Crear un nuevo plan (Solo Superadmin MSP)
router.post('/', authenticateToken, requireRole('SUPERADMIN_MSP'), async (req, res) => {
  const { id, name, max_distributors, max_drivers, description } = req.body;

  if (!name || max_distributors === undefined || max_drivers === undefined) {
    return res.status(400).json({ error: 'Nombre, Cuota de Distribuidores y Cuota de Repartidores son obligatorios' });
  }

  const planId = (id || name.toLowerCase().replace(/[^a-z0-9]/g, '_')).trim();

  try {
    const result = await pool.query(
      `INSERT INTO subscription_plans (id, name, max_distributors, max_drivers, description, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       ON CONFLICT (id) DO UPDATE SET name = $2, max_distributors = $3, max_drivers = $4, description = $5, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [planId, name, parseInt(max_distributors, 10), parseInt(max_drivers, 10), description || '']
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/plans/:id - Editar un plan existente (Solo Superadmin MSP)
router.put('/:id', authenticateToken, requireRole('SUPERADMIN_MSP'), async (req, res) => {
  const { id } = req.params;
  const { name, max_distributors, max_drivers, description } = req.body;

  try {
    const result = await pool.query(
      `UPDATE subscription_plans 
       SET name = COALESCE($1, name), 
           max_distributors = COALESCE($2, max_distributors), 
           max_drivers = COALESCE($3, max_drivers), 
           description = COALESCE($4, description),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING *`,
      [name, max_distributors !== undefined ? parseInt(max_distributors, 10) : null, max_drivers !== undefined ? parseInt(max_drivers, 10) : null, description, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Plan no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/plans/:id - Desactivar un plan (Solo Superadmin MSP)
router.delete('/:id', authenticateToken, requireRole('SUPERADMIN_MSP'), async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query(
      `UPDATE subscription_plans SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id]
    );
    res.json({ success: true, message: 'Plan desactivado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
