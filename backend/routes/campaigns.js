/**
 * campaigns.js — Rutas para gestión de campañas
 * GET    /api/campaigns       — Listar campañas con conteo de links y clicks
 * POST   /api/campaigns       — Crear campaña
 * PATCH  /api/campaigns/:id   — Actualizar nombre/descripción/color
 * DELETE /api/campaigns/:id   — Eliminar campaña (links quedan sin campaña)
 */

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { verifyToken } = require('../middleware/auth');

/**
 * GET /api/campaigns
 */
router.get('/', verifyToken, (req, res) => {
  try {
    const campaigns = db.prepare(`
      SELECT
        c.id,
        c.name,
        c.description,
        c.color,
        c.created_at,
        COUNT(DISTINCT l.id)  AS link_count,
        COUNT(ck.id)          AS total_clicks
      FROM campaigns c
      LEFT JOIN links  l  ON l.campaign_id = c.id
      LEFT JOIN clicks ck ON ck.link_id = l.id
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `).all();

    res.json({ campaigns });
  } catch (err) {
    console.error('Error listando campañas:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * POST /api/campaigns
 * Body: { name, description?, color? }
 */
router.post('/', verifyToken, (req, res) => {
  const { name, description, color } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'El nombre de la campaña es requerido' });
  }
  if (name.trim().length > 60) {
    return res.status(400).json({ error: 'El nombre no puede exceder 60 caracteres' });
  }

  const validColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#7c6af7';

  try {
    const result = db.prepare(`
      INSERT INTO campaigns (name, description, color)
      VALUES (?, ?, ?)
    `).run(name.trim(), description ? description.trim() : null, validColor);

    res.status(201).json({
      id: result.lastInsertRowid,
      name: name.trim(),
      description: description ? description.trim() : null,
      color: validColor,
      link_count: 0,
      total_clicks: 0,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error creando campaña:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * PATCH /api/campaigns/:id
 * Body: { name?, description?, color? }
 */
router.patch('/:id', verifyToken, (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(Number(id))) return res.status(400).json({ error: 'ID inválido' });

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(Number(id));
  if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });

  const { name, description, color } = req.body;
  const newName  = name ? name.trim() : campaign.name;
  const newDesc  = description !== undefined ? (description ? description.trim() : null) : campaign.description;
  const newColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : campaign.color;

  if (newName.length > 60) return res.status(400).json({ error: 'El nombre no puede exceder 60 caracteres' });

  try {
    db.prepare('UPDATE campaigns SET name = ?, description = ?, color = ? WHERE id = ?')
      .run(newName, newDesc, newColor, Number(id));
    res.json({ id: Number(id), name: newName, description: newDesc, color: newColor });
  } catch (err) {
    console.error('Error actualizando campaña:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * DELETE /api/campaigns/:id
 * Los links de esa campaña quedan con campaign_id = NULL
 */
router.delete('/:id', verifyToken, (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(Number(id))) return res.status(400).json({ error: 'ID inválido' });

  const campaign = db.prepare('SELECT id, name FROM campaigns WHERE id = ?').get(Number(id));
  if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });

  try {
    db.prepare('UPDATE links SET campaign_id = NULL WHERE campaign_id = ?').run(Number(id));
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(Number(id));
    res.json({ message: `Campaña "${campaign.name}" eliminada` });
  } catch (err) {
    console.error('Error eliminando campaña:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
