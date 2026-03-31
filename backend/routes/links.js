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
  const { url, alias, expiresAt } = req.body;

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

  try {
    const stmt = db.prepare(`
      INSERT INTO links (code, original_url, expires_at)
      VALUES (?, ?, ?)
    `);

    const result = stmt.run(code, url, expiresAtDate ? expiresAtDate.toISOString() : null);
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

    res.status(201).json({
      id: result.lastInsertRowid,
      code,
      original_url: url,
      short_url: `${baseUrl}/${code}`,
      expires_at: expiresAtDate ? expiresAtDate.toISOString() : null,
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
 * Lista todos los links con su conteo de clicks.
 */
router.get('/', verifyToken, (req, res) => {
  try {
    const links = db.prepare(`
      SELECT
        l.id,
        l.code,
        l.original_url,
        l.created_at,
        l.expires_at,
        l.is_active,
        COUNT(c.id) AS click_count
      FROM links l
      LEFT JOIN clicks c ON c.link_id = l.id
      GROUP BY l.id
      ORDER BY l.created_at DESC
    `).all();

    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

    const enriched = links.map(link => ({
      ...link,
      short_url: `${baseUrl}/${link.code}`,
      is_expired: link.expires_at ? new Date(link.expires_at) < new Date() : false
    }));

    res.json({ links: enriched });
  } catch (err) {
    console.error('Error listando links:', err.message);
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
