import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

/**
 * Retorna los límites de cuotas según el plan del Tenant (desde la base de datos o fallback)
 */
async function getPlanLimits(plan) {
  const p = (plan || 'starter').toLowerCase().trim();
  try {
    const res = await pool.query(`SELECT * FROM subscription_plans WHERE LOWER(id) = $1 AND is_active = TRUE`, [p]);
    if (res.rows.length > 0) {
      const row = res.rows[0];
      return { planName: row.name, maxDistributors: row.max_distributors, maxDrivers: row.max_drivers };
    }
  } catch (e) {}

  if (p === 'emprendedor') return { planName: 'Emprendedor', maxDistributors: 3, maxDrivers: 1 };
  if (p === 'emprendedor_plus' || p === 'plus') return { planName: 'Emprendedor Plus', maxDistributors: 6, maxDrivers: 2 };
  if (p === 'emprendedor_pro' || p === 'pro') return { planName: 'Emprendedor Pro', maxDistributors: 9, maxDrivers: 3 };
  if (p === 'enterprise') return { planName: 'Enterprise', maxDistributors: 99, maxDrivers: 99 };
  return { planName: 'Starter', maxDistributors: 0, maxDrivers: 0 };
}

// GET /api/logistics/summary - Resumen de cuotas y uso del Tenant actual
router.get('/summary', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;

  try {
    const tenantRes = await pool.query(`SELECT id, name, plan FROM tenants WHERE id = $1`, [tenantId]);
    if (tenantRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant no encontrado' });
    }

    const tenant = tenantRes.rows[0];
    const limits = await getPlanLimits(tenant.plan);

    const distRes = await pool.query(
      `SELECT COUNT(*)::int as count FROM tenant_distributors WHERE tenant_id = $1 AND is_active = TRUE`,
      [tenantId]
    );

    const driverRes = await pool.query(
      `SELECT COUNT(*)::int as count FROM tenant_delivery_drivers WHERE tenant_id = $1 AND is_active = TRUE`,
      [tenantId]
    );

    const ordersRes = await pool.query(
      `SELECT COUNT(*)::int as count FROM orders WHERE tenant_id = $1`,
      [tenantId]
    );

    res.json({
      tenantId: tenant.id,
      tenantName: tenant.name,
      plan: tenant.plan,
      planDisplayName: limits.planName,
      distributors: {
        current: distRes.rows[0].count,
        max: limits.maxDistributors,
        canAdd: distRes.rows[0].count < limits.maxDistributors,
      },
      drivers: {
        current: driverRes.rows[0].count,
        max: limits.maxDrivers,
        canAdd: driverRes.rows[0].count < limits.maxDrivers,
      },
      totalOrders: ordersRes.rows[0].count,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/logistics/distributors - Listar distribuidores del tenant
router.get('/distributors', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;
  try {
    const result = await pool.query(
      `SELECT * FROM tenant_distributors WHERE tenant_id = $1 AND is_active = TRUE ORDER BY created_at DESC`,
      [tenantId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/logistics/distributors - Registrar distribuidor con validación estricta de cuota
router.post('/distributors', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;
  const { name, phone_whatsapp, address_location } = req.body;

  if (!name || !phone_whatsapp) {
    return res.status(400).json({ error: 'Nombre y Teléfono WhatsApp son requeridos' });
  }

  try {
    const tenantRes = await pool.query(`SELECT plan FROM tenants WHERE id = $1`, [tenantId]);
    const tenantPlan = tenantRes.rows[0]?.plan || 'starter';
    const limits = await getPlanLimits(tenantPlan);

    const countRes = await pool.query(
      `SELECT COUNT(*)::int as count FROM tenant_distributors WHERE tenant_id = $1 AND is_active = TRUE`,
      [tenantId]
    );
    const currentCount = countRes.rows[0].count;

    if (currentCount >= limits.maxDistributors) {
      return res.status(403).json({
        error: `Límite de distribuidores alcanzado (${currentCount}/${limits.maxDistributors}) para tu plan actual "${limits.planName}". Solicita una actualización de plan a tu administrador MSP.`,
      });
    }

    const distId = `dist-${uuidv4().substring(0, 8)}`;
    const result = await pool.query(
      `INSERT INTO tenant_distributors (id, tenant_id, name, phone_whatsapp, address_location, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING *`,
      [distId, tenantId, name, phone_whatsapp, address_location || '']
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/logistics/distributors/:id - Desactivar distribuidor
router.delete('/distributors/:id', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;
  const { id } = req.params;

  try {
    await pool.query(
      `UPDATE tenant_distributors SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    res.json({ success: true, message: 'Distribuidor eliminado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/logistics/drivers - Listar repartidores del tenant
router.get('/drivers', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;
  try {
    const result = await pool.query(
      `SELECT * FROM tenant_delivery_drivers WHERE tenant_id = $1 AND is_active = TRUE ORDER BY created_at DESC`,
      [tenantId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/logistics/drivers - Registrar repartidor con validación estricta de cuota
router.post('/drivers', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;
  const { name, phone_whatsapp, vehicle_type } = req.body;

  if (!name || !phone_whatsapp) {
    return res.status(400).json({ error: 'Nombre y Teléfono WhatsApp son requeridos' });
  }

  try {
    const tenantRes = await pool.query(`SELECT plan FROM tenants WHERE id = $1`, [tenantId]);
    const tenantPlan = tenantRes.rows[0]?.plan || 'starter';
    const limits = await getPlanLimits(tenantPlan);


    const countRes = await pool.query(
      `SELECT COUNT(*)::int as count FROM tenant_delivery_drivers WHERE tenant_id = $1 AND is_active = TRUE`,
      [tenantId]
    );
    const currentCount = countRes.rows[0].count;

    if (currentCount >= limits.maxDrivers) {
      return res.status(403).json({
        error: `Límite de repartidores alcanzado (${currentCount}/${limits.maxDrivers}) para tu plan actual "${limits.planName}". Solicita una actualización de plan a tu administrador MSP.`,
      });
    }

    const driverId = `driver-${uuidv4().substring(0, 8)}`;
    const result = await pool.query(
      `INSERT INTO tenant_delivery_drivers (id, tenant_id, name, phone_whatsapp, vehicle_type, is_active)
       VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING *`,
      [driverId, tenantId, name, phone_whatsapp, vehicle_type || 'Moto']
    );

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/logistics/drivers/:id - Desactivar repartidor
router.delete('/drivers/:id', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;
  const { id } = req.params;

  try {
    await pool.query(
      `UPDATE tenant_delivery_drivers SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId]
    );
    res.json({ success: true, message: 'Repartidor eliminado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/logistics/orders - Listar pedidos del tenant con detalles
router.get('/orders', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;
  try {
    const result = await pool.query(
      `SELECT o.*, 
              d.name as distributor_name, d.phone_whatsapp as distributor_phone,
              dr.name as driver_name, dr.phone_whatsapp as driver_phone
       FROM orders o
       LEFT JOIN tenant_distributors d ON d.id = o.distributor_id
       LEFT JOIN tenant_delivery_drivers dr ON dr.id = o.driver_id
       WHERE o.tenant_id = $1
       ORDER BY o.created_at DESC`,
      [tenantId]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
