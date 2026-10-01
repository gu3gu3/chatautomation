import express from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

// GET /api/tenants - Lista todos los tenants (Solo Superadmin MSP)
router.get('/', authenticateToken, requireRole('SUPERADMIN_MSP'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT t.*, 
             COUNT(u.id) as user_count,
             COALESCE(
               MAX(u.email) FILTER (WHERE u.role = 'TENANT_OWNER'),
               MAX(u.email)
             ) as admin_email,
             ws.status as whatsapp_status,
             ws.phone_number as whatsapp_phone
      FROM tenants t
      LEFT JOIN users u ON u.tenant_id = t.id
      LEFT JOIN whatsapp_sessions ws ON ws.tenant_id = t.id
      GROUP BY t.id, ws.status, ws.phone_number
      ORDER BY t.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper para garantizar slugs únicos sin duplicados
async function generateUniqueSlug(baseText) {
  let slug = (baseText || 'empresa').toLowerCase().trim()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) slug = 'empresa';

  let uniqueSlug = slug;
  let counter = 1;
  while (true) {
    const existing = await pool.query('SELECT id FROM tenants WHERE slug = $1', [uniqueSlug]);
    if (existing.rows.length === 0) break;
    uniqueSlug = `${slug}-${counter}`;
    counter++;
  }
  return uniqueSlug;
}

// POST /api/tenants - Crear nuevo tenant con usuario admin y clave temporal
router.post('/', authenticateToken, requireRole('SUPERADMIN_MSP'), async (req, res) => {
  const { name, slug, plan, adminName, adminEmail, isDemoMode } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'El nombre de la empresa es requerido' });
  }

  const finalSlug = await generateUniqueSlug(slug || name);
  const tenantId = `tenant-${uuidv4().substring(0, 8)}`;
  const cleanEmail = adminEmail ? adminEmail.toLowerCase().trim() : `admin@${finalSlug}.com`;
  const cleanAdminName = adminName || `Administrador ${name}`;
  const tempPassword = `WS-${Math.random().toString(36).substring(2, 8).toUpperCase()}!`;

  try {
    const tenantResult = await pool.query(
      `INSERT INTO tenants (id, name, slug, plan, status, is_demo_mode) 
       VALUES ($1, $2, $3, $4, 'active', $5) RETURNING *`,
      [tenantId, name, finalSlug, plan || 'emprendedor', !!isDemoMode]
    );

    // Crear prompt por defecto
    await pool.query(
      `INSERT INTO prompts (id, tenant_id, title, system_prompt)
       VALUES ($1, $2, 'Prompt Principal', 'Eres el asistente virtual corporativo de ' || $3)`,
      [`prompt-${uuidv4().substring(0, 8)}`, tenantId, name]
    );

    // Crear usuario administrador para la empresa
    const userId = `user-${uuidv4().substring(0, 8)}`;
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(tempPassword, salt);

    await pool.query(
      `INSERT INTO users (id, tenant_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, 'TENANT_OWNER')
       ON CONFLICT (email) DO UPDATE SET tenant_id = $2, password_hash = $5`,
      [userId, tenantId, cleanAdminName, cleanEmail, passwordHash]
    );

    res.json({
      ...tenantResult.rows[0],
      adminUser: {
        id: userId,
        name: cleanAdminName,
        email: cleanEmail,
        tempPassword
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// PUT /api/tenants/:id/plan - Actualizar el plan de un tenant (Solo Superadmin MSP)
router.put('/:id/plan', authenticateToken, requireRole('SUPERADMIN_MSP'), async (req, res) => {
  const { id } = req.params;
  const { plan } = req.body;

  if (!plan) {
    return res.status(400).json({ error: 'El plan es requerido' });
  }

  try {
    const result = await pool.query(
      `UPDATE tenants SET plan = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [plan.toLowerCase().trim(), id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/tenants/:id/demo-mode - Alternar Modo Demo de un tenant (Solo Superadmin MSP)
router.put('/:id/demo-mode', authenticateToken, requireRole('SUPERADMIN_MSP'), async (req, res) => {
  const { id } = req.params;
  const { isDemoMode } = req.body;

  if (typeof isDemoMode !== 'boolean') {
    return res.status(400).json({ error: 'El parámetro isDemoMode es requerido y debe ser booleano' });
  }

  try {
    const result = await pool.query(
      `UPDATE tenants SET is_demo_mode = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [isDemoMode, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tenants/:id/reset-password - Resetear clave del administrador de un tenant (Solo Superadmin MSP)
router.post('/:id/reset-password', authenticateToken, requireRole('SUPERADMIN_MSP'), async (req, res) => {
  const { id } = req.params;

  try {
    const userRes = await pool.query(
      `SELECT u.* FROM users u WHERE u.tenant_id = $1 ORDER BY (u.role = 'TENANT_OWNER') DESC, u.created_at ASC LIMIT 1`,
      [id]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'No se encontró usuario administrador para este tenant' });
    }

    const adminUser = userRes.rows[0];
    const tempPassword = `WS-${Math.random().toString(36).substring(2, 8).toUpperCase()}!`;
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(tempPassword, salt);

    await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [passwordHash, adminUser.id]
    );

    res.json({
      success: true,
      email: adminUser.email,
      name: adminUser.name,
      tempPassword
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tenants/impersonate-log - Auditoría de Impersonación
router.post('/impersonate-log', authenticateToken, requireRole('SUPERADMIN_MSP'), async (req, res) => {
  const { targetTenantId, action } = req.body;
  const auditId = `audit-${uuidv4().substring(0, 8)}`;
  
  try {
    await pool.query(
      `INSERT INTO impersonation_audit_logs (id, superadmin_id, impersonated_tenant_id, action, ip_address)
       VALUES ($1, $2, $3, $4, $5)`,
      [auditId, req.user.id, targetTenantId, action || 'IMPERSONATE_SESSION_START', req.ip]
    );
    res.json({ status: 'logged', auditId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/tenants/:id/connection-mode - Actualizar el modo de conexión del tenant
router.put('/:id/connection-mode', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { mode } = req.body;
  
  // Validar permisos: Solo el admin del tenant o Superadmin MSP
  const isSuperAdmin = req.user.role === 'SUPERADMIN_MSP';
  const isTenantOwner = req.user.tenant_id === id && req.user.role === 'TENANT_OWNER';
  
  if (!isSuperAdmin && !isTenantOwner) {
    return res.status(403).json({ error: 'Acceso denegado' });
  }

  if (!['CENTRALIZED', 'RELAY'].includes(mode)) {
    return res.status(400).json({ error: 'Modo de conexión inválido' });
  }

  try {
    const result = await pool.query(
      `UPDATE tenants SET connection_mode = $1 WHERE id = $2 RETURNING id, connection_mode`,
      [mode, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Tenant no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
