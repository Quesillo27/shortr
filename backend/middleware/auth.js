/**
 * auth.js — Middleware de verificación JWT
 * Valida el token Bearer en el header Authorization.
 */

const jwt = require('jsonwebtoken');

function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de acceso requerido' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado, por favor inicia sesión nuevamente' });
    }
    return res.status(403).json({ error: 'Token inválido' });
  }
}

module.exports = { verifyToken };
