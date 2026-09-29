import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key_websavvy_2026_msp';

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Acceso no autorizado: Token JWT requerido' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido o expirado' });
    }

    req.user = user;

    // Lógica de Impersonación para Superadmin MSP
    const impersonatedTenantId = req.headers['x-impersonate-tenant-id'];
    
    if (user.role === 'SUPERADMIN_MSP' && impersonatedTenantId) {
      req.user.effectiveTenantId = impersonatedTenantId;
      req.user.isImpersonating = true;
    } else {
      req.user.effectiveTenantId = user.tenant_id;
      req.user.isImpersonating = false;
    }

    next();
  });
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Permisos insuficientes para esta acción' });
    }
    next();
  };
}
