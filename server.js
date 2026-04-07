/**
 * server.js — Entry point de Shortr
 * URL Shortener con analytics — Node.js + Express + SQLite
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const path = require('path');
const geoip = require('geoip-lite');
const UAParser = require('ua-parser-js');

// ─── Validación de variables de entorno requeridas ──────────────────────────
if (!process.env.JWT_SECRET) {
  console.error('[FATAL] La variable de entorno JWT_SECRET es requerida.');
  console.error('        Ejemplo: JWT_SECRET=mi-secreto-seguro node server.js');
  process.exit(1);
}

if (!process.env.ADMIN_PASSWORD) {
  console.error('[FATAL] La variable de entorno ADMIN_PASSWORD es requerida.');
  console.error('        Ejemplo: ADMIN_PASSWORD=mi-password node server.js');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Validar BASE_URL si fue provisto explícitamente
if (process.env.BASE_URL) {
  try {
    new URL(process.env.BASE_URL);
  } catch {
    console.error('[FATAL] BASE_URL no es una URL válida:', process.env.BASE_URL);
    process.exit(1);
  }
}

// ─── Inicialización de la DB (antes de montar rutas) ─────────────────────────
const db = require('./backend/db/database');

// ─── Middlewares ──────────────────────────────────────────────────────────────
const { apiLimiter, loginLimiter, redirectLimiter } = require('./backend/middleware/rateLimit');

const app = express();

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// CORS
app.use((req, res, next) => {
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['*'];

  const origin = req.headers.origin;
  if (allowedOrigins.includes('*') || (origin && allowedOrigins.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', uptime: Math.floor(process.uptime()), timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'error', error: err.message });
  }
});

// ─── Archivos estáticos ───────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── Ruta de autenticación ────────────────────────────────────────────────────
app.post('/api/auth/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }

  // Comparación segura para evitar timing attacks
  const userMatch = crypto.timingSafeEqual(
    Buffer.from(username),
    Buffer.from(ADMIN_USER)
  );
  const passMatch = crypto.timingSafeEqual(
    Buffer.from(password),
    Buffer.from(ADMIN_PASSWORD)
  );

  if (!userMatch || !passMatch) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  const token = jwt.sign(
    { username: ADMIN_USER, role: 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({
    token,
    expiresIn: 86400, // 24h en segundos
    username: ADMIN_USER
  });
});

// ─── Rutas de la API ──────────────────────────────────────────────────────────
app.use('/api/links', apiLimiter, require('./backend/routes/links'));
app.use('/api/analytics', apiLimiter, require('./backend/routes/analytics'));

// ─── Redirect por código (DEBE ir después de las rutas API) ──────────────────
app.get('/:code', redirectLimiter, (req, res) => {
  const { code } = req.params;

  // Ignorar rutas del SPA y archivos estáticos
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

    // Registrar el click de forma asíncrona (no bloquear el redirect)
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const ipHash = crypto.createHash('sha256').update(ip).digest('hex');
    const userAgent = (req.headers['user-agent'] || '').slice(0, 512);
    const referrer = (req.headers['referer'] || req.headers['referrer'] || '').slice(0, 512) || null;

    // Enriquecer con geo + UA antes de anonimizar la IP
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
          INSERT INTO clicks (link_id, ip_hash, user_agent, referrer, country_code, country, device_type, browser, os)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(link.id, ipHash, userAgent, referrer, countryCode, countryName, deviceType, browser, os);
      } catch (err) {
        console.error('Error registrando click:', err.message);
      }
    });

    // Redirect 302 (temporal, para que los bots no cacheen)
    res.redirect(302, link.original_url);
  } catch (err) {
    console.error('Error en redirect:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── Manejo de errores global ─────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Error no manejado:', err.stack);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// ─── Iniciar servidor ─────────────────────────────────────────────────────────
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
