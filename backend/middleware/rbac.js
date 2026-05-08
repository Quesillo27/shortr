function hasPermission(req, permission) {
  const userPermissions = req.user && Array.isArray(req.user.permissions) ? req.user.permissions : [];
  return userPermissions.includes(permission);
}

function isAdmin(req) {
  return !!(req.user && req.user.role === 'admin');
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Sesion no valida' });
    }

    if (!hasPermission(req, permission)) {
      return res.status(403).json({ error: 'No tienes permisos para esta accion' });
    }

    next();
  };
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Sesion no valida' });
  }

  if (!isAdmin(req)) {
    return res.status(403).json({ error: 'Solo un admin puede realizar esta accion' });
  }

  next();
}

module.exports = {
  hasPermission,
  isAdmin,
  requirePermission,
  requireAdmin
};
