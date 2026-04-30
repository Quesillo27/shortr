/**
 * rateLimit.js — Rate limits por tipo de endpoint.
 */

const rateLimit = require('express-rate-limit');

const baseOptions = {
  standardHeaders: true,
  legacyHeaders: false
};

const apiLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_API_MAX || 180),
  message: { error: 'Demasiadas solicitudes a la API. Intenta nuevamente en unos minutos.' }
});

const loginLimiter = rateLimit({
  ...baseOptions,
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_LOGIN_MAX || 12),
  skipSuccessfulRequests: true,
  message: { error: 'Demasiados intentos de inicio de sesion. Espera 15 minutos.' }
});

const redirectLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_REDIRECT_MAX || 200),
  message: { error: 'Demasiados redirects desde este origen. Intenta de nuevo en un momento.' }
});

const usersLimiter = rateLimit({
  ...baseOptions,
  windowMs: 10 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_USERS_MAX || 60),
  message: { error: 'Demasiadas operaciones de usuarios. Intenta nuevamente en 10 minutos.' }
});

const analyticsLimiter = rateLimit({
  ...baseOptions,
  windowMs: 5 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_ANALYTICS_MAX || 120),
  message: { error: 'Demasiadas consultas de analytics. Intenta de nuevo pronto.' }
});

module.exports = {
  apiLimiter,
  loginLimiter,
  redirectLimiter,
  usersLimiter,
  analyticsLimiter
};
