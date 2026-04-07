/**
 * rateLimit.js — Configuración de rate limiting con express-rate-limit
 * Protege endpoints críticos contra abuso y ataques de fuerza bruta.
 */

const rateLimit = require('express-rate-limit');

// Límite general para la API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta de nuevo en 15 minutos.' }
});

// Límite estricto para el login (prevenir fuerza bruta)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login. Intenta de nuevo en 15 minutos.' }
});

// Límite para los redirects (más permisivo, son clics reales)
const redirectLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minuto
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados redirects. Intenta de nuevo en un momento.' }
});

module.exports = { apiLimiter, loginLimiter, redirectLimiter };
