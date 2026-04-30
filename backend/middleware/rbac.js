function hasPermission(req, permission) {
  const userPermissions = req.user && Array.isArray(req.user.permissions) ? req.user.permissions : [];
  return userPermissions.includes(permission);
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

module.exports = {
  hasPermission,
  requirePermission
};
