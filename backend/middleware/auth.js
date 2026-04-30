/**
 * auth.js — Helpers de JWT y middleware de sesion.
 */

const jwt = require('jsonwebtoken');

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';
const JWT_ISSUER = process.env.JWT_ISSUER || 'shortr';
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'shortr-admin';

function signAuthToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      username: user.username,
      role: user.role,
      permissions: Array.isArray(user.permissions) ? user.permissions : []
    },
    process.env.JWT_SECRET,
    {
      expiresIn: JWT_EXPIRES_IN,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    }
  );
}

function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de acceso requerido' });
  }

  const token = authHeader.slice('Bearer '.length);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE
    });

    req.user = {
      id: Number(decoded.sub),
      username: decoded.username,
      role: decoded.role,
      permissions: Array.isArray(decoded.permissions) ? decoded.permissions : []
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expirado, inicia sesion nuevamente' });
    }
    return res.status(403).json({ error: 'Token invalido' });
  }
}

module.exports = {
  signAuthToken,
  verifyToken
};
