/**
 * links.js — Rutas para gestión de links cortos
 * POST /api/links      — Crear link
 * GET  /api/links      — Listar links con stats
 * DELETE /api/links/:id — Eliminar link
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../db/database');
const { verifyToken } = require('../middleware/auth');

// Alias reservados que no pueden usarse como código corto
const RESERVED_CODES = new Set([
  'api', 'admin', 'auth', 'analytics', 'health', 'login', 'logout',
  'register', 'static', 'public', 'assets', 'favicon.ico', 'robots.txt'
]);

// Generador de código corto usando crypto (sin dependencias ES modules)
function generateCode(length = 6) {
  return crypto.randomBytes(length).toString('base64url').slice(0, length);
}

// Validar que una URL es válida
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

// Validar alias: solo letras, números, guiones y guiones bajos
function isValidAlias(alias) {
  return /^[a-zA-Z0-9_-]{2,30}$/.test(alias);
}

/**
 * POST /api/links
 * Crea un nuevo link corto.
 * Body: { url, alias?, expiresAt? }
 */
router.post('/', verifyToken, (req, res) => {
  const { url, alias, expiresAt, campaignId } = req.body;

  // Validaciones
  if (!url) {
    return res.status(400).json({ error: 'La URL es requerida' });
  }

  if (!isValidUrl(url)) {
    return res.status(400).json({ error: 'URL inválida. Debe comenzar con http:// o https://' });
  }

  if (alias && !isValidAlias(alias)) {
    return res.status(400).json({
      error: 'El alias solo puede contener letras, números, guiones y guiones bajos (2-30 caracteres)'
    });
  }

  if (alias && RESERVED_CODES.has(alias.toLowerCase())) {
    return res.status(400).json({ error: `El alias "${alias}" es una ruta reservada del sistema` });
  }

  // Validar fecha de expiración
  let expiresAtDate = null;
  if (expiresAt) {
    expiresAtDate = new Date(expiresAt);
    if (isNaN(expiresAtDate.getTime())) {
      return res.status(400).json({ error: 'Fecha de expiración inválida' });
    }
    if (expiresAtDate <= new Date()) {
      return res.status(400).json({ error: 'La fecha de expiración debe ser en el futuro' });
    }
  }

  // Generar código único si no se proporcionó alias
  let code = alias;
  if (!code) {
    // Intentar hasta 5 veces generar un código único
    for (let i = 0; i < 5; i++) {
      const candidate = generateCode(6);
      const existing = db.prepare('SELECT id FROM links WHERE code = ?').get(candidate);
      if (!existing) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      return res.status(500).json({ error: 'No se pudo generar un código único. Intenta de nuevo.' });
    }
  } else {
    // Verificar que el alias no está en uso
    const existing = db.prepare('SELECT id FROM links WHERE code = ?').get(alias);
    if (existing) {
      return res.status(409).json({ error: `El alias "${alias}" ya está en uso` });
    }
  }

  // Validar campaignId si fue enviado
  let validCampaignId = null;
  if (campaignId) {
    const camp = db.prepare('SELECT id FROM campaigns WHERE id = ?').get(Number(campaignId));
    if (!camp) return res.status(400).json({ error: 'La campaña especificada no existe' });
    validCampaignId = Number(campaignId);
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO links (code, original_url, expires_at, campaign_id)
      VALUES (?, ?, ?, ?)
    `);

    const result = stmt.run(code, url, expiresAtDate ? expiresAtDate.toISOString() : null, validCampaignId);
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

    res.status(201).json({
      id: result.lastInsertRowid,
      code,
      original_url: url,
      short_url: `${baseUrl}/${code}`,
      expires_at: expiresAtDate ? expiresAtDate.toISOString() : null,
      campaign_id: validCampaignId,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: `El alias "${code}" ya está en uso` });
    }
    console.error('Error creando link:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/links
 * Lista links con paginación, búsqueda y filtro por campaña.
 * Query params: page, limit, search, campaign_id (número o "none" para sin campaña)
 */
router.get('/', verifyToken, (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const search = req.query.search ? req.query.search.trim() : null;
  const campaignFilter = req.query.campaign_id; // número, "none" o undefined

  try {
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

    // Construir cláusulas WHERE dinámicamente
    const conditions = [];
    const params = [];

    if (search) {
      conditions.push('(l.code LIKE ? OR l.original_url LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    if (campaignFilter === 'none') {
      conditions.push('l.campaign_id IS NULL');
    } else if (campaignFilter) {
      conditions.push('l.campaign_id = ?');
      params.push(Number(campaignFilter));
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const total = db.prepare(`SELECT COUNT(*) AS count FROM links l ${where}`).get(...params);

    const links = db.prepare(`
      SELECT
        l.id, l.code, l.original_url, l.created_at, l.expires_at,
        l.is_active, l.campaign_id,
        c2.name  AS campaign_name,
        c2.color AS campaign_color,
        COUNT(ck.id) AS click_count
      FROM links l
      LEFT JOIN clicks    ck ON ck.link_id = l.id
      LEFT JOIN campaigns c2 ON c2.id = l.campaign_id
      ${where}
      GROUP BY l.id
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const enriched = links.map(link => ({
      ...link,
      short_url: `${baseUrl}/${link.code}`,
      is_expired: link.expires_at ? new Date(link.expires_at) < new Date() : false
    }));

    res.json({
      links: enriched,
      pagination: { total: total.count, page, limit, pages: Math.ceil(total.count / limit) }
    });
  } catch (err) {
    console.error('Error listando links:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * PATCH /api/links/:id/toggle
 * Activa o desactiva un link.
 */
router.patch('/:id/toggle', verifyToken, (req, res) => {
  const { id } = req.params;

  if (!id || isNaN(Number(id))) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const link = db.prepare('SELECT id, is_active FROM links WHERE id = ?').get(Number(id));
    if (!link) {
      return res.status(404).json({ error: 'Link no encontrado' });
    }

    const newState = link.is_active ? 0 : 1;
    db.prepare('UPDATE links SET is_active = ? WHERE id = ?').run(newState, Number(id));
    res.json({ id: Number(id), is_active: newState });
  } catch (err) {
    console.error('Error toggling link:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * DELETE /api/links/:id
 * Elimina un link por ID.
 */
router.delete('/:id', verifyToken, (req, res) => {
  const { id } = req.params;

  if (!id || isNaN(Number(id))) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const link = db.prepare('SELECT id FROM links WHERE id = ?').get(Number(id));
    if (!link) {
      return res.status(404).json({ error: 'Link no encontrado' });
    }

    db.prepare('DELETE FROM links WHERE id = ?').run(Number(id));
    res.json({ message: 'Link eliminado correctamente' });
  } catch (err) {
    console.error('Error eliminando link:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
