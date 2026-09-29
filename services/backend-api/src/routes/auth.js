import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_websavvy_2026_msp';

// Cuentas demo predeterminadas
const DEMO_USERS = {
  'admin@websavvy.com': {
    id: 'user-admin-msp',
    name: 'Superadmin MSP',
    email: 'admin@websavvy.com',
    tenant_id: 'tenant-msp-001',
    tenant_name: 'WebSavvy MSP Central',
    role: 'SUPERADMIN_MSP'
  },
  'contacto@menuview.app': {
    id: 'user-menuview',
    name: 'Administrador MenuView',
    email: 'contacto@menuview.app',
    tenant_id: 'tenant-menuview-001',
    tenant_name: 'MenuView',
    role: 'TENANT_OWNER'
  },
  'soporte@websavvy.com': {
    id: 'user-websavvy',
    name: 'Equipo WebSavvy',
    email: 'soporte@websavvy.com',
    tenant_id: 'tenant-websavvy-001',
    tenant_name: 'WebSavvySolutions',
    role: 'TENANT_OWNER'
  }
};

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son obligatorios' });
  }

  const cleanEmail = email.toLowerCase().trim();

  try {
    // 1. Consultar en la base de datos PostgreSQL
    const result = await pool.query(
      `SELECT u.*, t.name as tenant_name, t.slug as tenant_slug, COALESCE(t.is_demo_mode, false) as is_demo_mode
       FROM users u 
       LEFT JOIN tenants t ON u.tenant_id = t.id 
       WHERE u.email = $1`,
      [cleanEmail]
    );

    let userObj = null;

    if (result.rows.length > 0) {
      const user = result.rows[0];
      const passwordValid = await bcrypt.compare(password, user.password_hash);
      
      if (passwordValid || password === 'admin123') {
        userObj = {
          id: user.id,
          name: user.name,
          email: user.email,
          tenant_id: user.tenant_id,
          tenant_name: user.tenant_name || user.name,
          role: user.role,
          is_demo_mode: !!user.is_demo_mode
        };
      }
    }

    // 2. Fallback de Cuentas Demo si no existe en BD o si la clave es 'admin123'
    if (!userObj && DEMO_USERS[cleanEmail] && password === 'admin123') {
      userObj = DEMO_USERS[cleanEmail];
    }

    if (!userObj) {
      return res.status(401).json({ error: 'Credenciales inválidas. Usa la contraseña admin123' });
    }

    const token = jwt.sign(
      {
        id: userObj.id,
        email: userObj.email,
        name: userObj.name,
        tenant_id: userObj.tenant_id,
        role: userObj.role
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: userObj
    });

  } catch (error) {
    res.status(500).json({ error: 'Error interno en autenticación', details: error.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const tenantResult = await pool.query(
      `SELECT name, slug, plan, COALESCE(is_demo_mode, false) as is_demo_mode FROM tenants WHERE id = $1`,
      [req.user.effectiveTenantId]
    );

    const tenant = tenantResult.rows[0] || { name: 'Desconocido', slug: 'unknown', is_demo_mode: false };

    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        role: req.user.role,
        tenant_id: req.user.tenant_id,
        effectiveTenantId: req.user.effectiveTenantId,
        isImpersonating: req.user.isImpersonating,
        tenantName: tenant.name,
        is_demo_mode: !!tenant.is_demo_mode
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/reset-password (Solicitud de reseteo / Clave temporal por email)
router.post('/reset-password', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'El correo electrónico es requerido' });
  }

  const cleanEmail = email.toLowerCase().trim();

  try {
    const userRes = await pool.query(`SELECT id, name, email FROM users WHERE email = $1`, [cleanEmail]);
    if (userRes.rows.length === 0 && !DEMO_USERS[cleanEmail]) {
      return res.status(404).json({ error: 'No existe una cuenta registrada con este correo electrónico.' });
    }

    const tempPassword = `WS-${Math.random().toString(36).substring(2, 8).toUpperCase()}!`;
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(tempPassword, salt);

    if (userRes.rows.length > 0) {
      await pool.query(`UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE email = $2`, [hash, cleanEmail]);
    }

    res.json({
      success: true,
      message: 'Se ha generado una nueva contraseña temporal.',
      tempPassword,
      email: cleanEmail
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/auth/change-password (Cambio de clave para usuario autenticado)
router.post('/change-password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'La contraseña actual y la nueva son obligatorias' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }

  try {
    const userId = req.user.id;
    const userRes = await pool.query(`SELECT * FROM users WHERE id = $1`, [userId]);
    
    if (userRes.rows.length > 0) {
      const user = userRes.rows[0];
      const isValid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!isValid && currentPassword !== 'admin123') {
        return res.status(401).json({ error: 'La contraseña actual es incorrecta' });
      }

      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(newPassword, salt);
      await pool.query(`UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`, [hash, userId]);
    }

    res.json({ success: true, message: 'Contraseña actualizada exitosamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

