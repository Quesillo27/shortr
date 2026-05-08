/**
 * server.js — Entry point de Shortr
 * URL Shortener con analytics — Node.js + Express + SQLite
 */

const express = require('express');
const crypto = require('crypto');
const path = require('path');
const geoip = require('geoip-lite');
const UAParser = require('ua-parser-js');
const { verifyPassword } = require('./backend/security/password');
const { resolvePermissions } = require('./backend/security/permissions');
const { JWT_EXPIRES_IN, signAuthToken, verifyToken } = require('./backend/middleware/auth');
const { requireAdmin } = require('./backend/middleware/rbac');

const DUMMY_PASSWORD_HASH = `pbkdf2$210000$0123456789abcdef0123456789abcdef${'$'}${'0'.repeat(128)}`;

if (!process.env.JWT_SECRET) {
  console.error('[FATAL] La variable de entorno JWT_SECRET es requerida.');
  console.error('        Ejemplo: JWT_SECRET=mi-secreto-seguro node server.js');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

if (process.env.BASE_URL) {
  try {
    new URL(process.env.BASE_URL);
  } catch {
    console.error('[FATAL] BASE_URL no es una URL valida:', process.env.BASE_URL);
    process.exit(1);
  }
}

const { db, resetAppData, touchUserLogin } = require('./backend/db/database');
const { apiLimiter, loginLimiter, redirectLimiter } = require('./backend/middleware/rateLimit');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; connect-src 'self'; font-src 'self' data: https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  next();
});

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.includes('*') || allowedOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

app.get('/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/login', loginLimiter, (req, res) => {
  const username = req.body && typeof req.body.username === 'string' ? req.body.username.trim() : '';
  const password = req.body && typeof req.body.password === 'string' ? req.body.password : '';

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contrasena son requeridos' });
  }

  try {
    const user = db.prepare(`
      SELECT id, username, password_hash, role, permissions_json, is_active
      FROM users
      WHERE username = ?
    `).get(username);

    const passwordValid = verifyPassword(password, user ? user.password_hash : DUMMY_PASSWORD_HASH);
    const valid = !!user && user.is_active && passwordValid;
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales incorrectas' });
    }

    let customPermissions = [];
    try {
      customPermissions = JSON.parse(user.permissions_json || '[]');
    } catch {
      customPermissions = [];
    }

    const permissions = resolvePermissions(user.role, customPermissions);
    const token = signAuthToken({
      id: user.id,
      username: user.username,
      role: user.role,
      permissions
    });

    touchUserLogin(user.id);

    return res.json({
      token,
      user_id: user.id,
      username: user.username,
      role: user.role,
      permissions,
      expiresIn: JWT_EXPIRES_IN
    });
  } catch (err) {
    console.error('Error en login:', err.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.post('/api/admin/reset-data', verifyToken, requireAdmin, (req, res) => {
  const confirm = req.body && req.body.confirm;
  if (confirm !== 'RESET') {
    return res.status(400).json({ error: 'Confirmacion invalida. Envia {"confirm":"RESET"}' });
  }

  try {
    resetAppData(req.user.id);
    res.json({ message: 'Datos limpiados correctamente. Solo se conservo tu admin para reutilizar la instancia.' });
  } catch (err) {
    console.error('Error limpiando datos:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.use('/api/campaigns', apiLimiter, require('./backend/routes/campaigns'));
app.use('/api/links', apiLimiter, require('./backend/routes/links'));
app.use('/api/analytics', apiLimiter, require('./backend/routes/analytics'));
app.use('/api/users', apiLimiter, require('./backend/routes/users'));

app.get('/:code', redirectLimiter, (req, res) => {
  const { code } = req.params;

  if (code === 'favicon.ico' || code.includes('.')) {
    return res.status(404).end();
  }

  try {
    const link = db.prepare(`
      SELECT id, original_url, expires_at, is_active
      FROM links
      WHERE code = ?
    `).get(code);

    if (!link) {
      return res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
    }

    if (!link.is_active) {
      return res.status(410).json({ error: 'Este enlace ha sido desactivado' });
    }

    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Este enlace ha expirado' });
    }

    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const ipHash = crypto.createHash('sha256').update(ip).digest('hex');
    const pathInfo = (req.path || '').slice(0, 256) || null;
    const queryString = req.originalUrl.includes('?')
      ? req.originalUrl.slice(req.originalUrl.indexOf('?') + 1).slice(0, 512)
      : null;
    const userAgent = (req.headers['user-agent'] || '').slice(0, 512);
    const referrer = (req.headers.referer || req.headers.referrer || '').slice(0, 512) || null;
    const visitorHash = crypto.createHash('sha256').update(`${ipHash}|${userAgent.slice(0, 160)}`).digest('hex');

    let referrerHost = null;
    if (referrer) {
      try {
        referrerHost = new URL(referrer).hostname.slice(0, 160);
      } catch {
        referrerHost = null;
      }
    }

    const geo = geoip.lookup(ip);
    const countryCode = geo ? geo.country : null;
    const countryName = geo ? (geo.country || null) : null;

    const uaResult = new UAParser(userAgent).getResult();
    const deviceType = uaResult.device.type || 'desktop';
    const browser = uaResult.browser.name || null;
    const os = uaResult.os.name || null;

    setImmediate(() => {
      try {
        db.prepare(`
          INSERT INTO clicks (
            link_id,
            ip_hash,
            visitor_hash,
            user_agent,
            referrer,
            referrer_host,
            path,
            query_string,
            utm_source,
            utm_medium,
            utm_campaign,
            utm_term,
            utm_content,
            country_code,
            country,
            device_type,
            browser,
            os
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          link.id,
          ipHash,
          visitorHash,
          userAgent,
          referrer,
          referrerHost,
          pathInfo,
          queryString,
          req.query.utm_source ? String(req.query.utm_source).slice(0, 128) : null,
          req.query.utm_medium ? String(req.query.utm_medium).slice(0, 128) : null,
          req.query.utm_campaign ? String(req.query.utm_campaign).slice(0, 128) : null,
          req.query.utm_term ? String(req.query.utm_term).slice(0, 128) : null,
          req.query.utm_content ? String(req.query.utm_content).slice(0, 128) : null,
          countryCode,
          countryName,
          deviceType,
          browser,
          os
        );
      } catch (err) {
        console.error('Error registrando click:', err.message);
      }
    });

    res.redirect(302, link.original_url);
  } catch (err) {
    console.error('Error en redirect:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.use((err, req, res, _next) => {
  console.error('Error no manejado:', err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`
  ███████╗██╗  ██╗ ██████╗ ██████╗ ████████╗██████╗
  ██╔════╝██║  ██║██╔═══██╗██╔══██╗╚══██╔══╝██╔══██╗
  ███████╗███████║██║   ██║██████╔╝   ██║   ██████╔╝
  ╚════██║██╔══██║██║   ██║██╔══██╗   ██║   ██╔══██╗
  ███████║██║  ██║╚██████╔╝██║  ██║   ██║   ██║  ██║
  ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝

  URL Shortener con Analytics — v1.0.0
  Servidor escuchando en http://localhost:${PORT}
  Base URL: ${BASE_URL}
  `);
});

module.exports = app;
