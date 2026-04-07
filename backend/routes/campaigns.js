/**
 * campaigns.js — Rutas para gestión de campañas
 * GET    /api/campaigns       — Listar campañas con stats (link_count, total_clicks, clicks_today)
 * POST   /api/campaigns       — Crear campaña
 * PATCH  /api/campaigns/:id   — Actualizar nombre/descripción/color/status/goal
 * DELETE /api/campaigns/:id   — Eliminar campaña (links quedan sin campaña)
 */

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { verifyToken } = require('../middleware/auth');

const VALID_STATUSES = new Set(['active', 'paused', 'archived']);

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
        c.status,
        c.goal_clicks,
        c.created_at,
        COUNT(DISTINCT l.id)                                              AS link_count,
        COUNT(ck.id)                                                      AS total_clicks,
        COUNT(CASE WHEN date(ck.clicked_at) = date('now') THEN 1 END)    AS clicks_today,
        COUNT(CASE WHEN ck.clicked_at >= datetime('now','-7 days') THEN 1 END) AS clicks_week
      FROM campaigns c
      LEFT JOIN links  l  ON l.campaign_id = c.id
      LEFT JOIN clicks ck ON ck.link_id    = l.id
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
 * Body: { name, description?, color?, status?, goal_clicks? }
 */
router.post('/', verifyToken, (req, res) => {
  const { name, description, color, status, goal_clicks } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'El nombre de la campaña es requerido' });
  }
  if (name.trim().length > 60) {
    return res.status(400).json({ error: 'El nombre no puede exceder 60 caracteres' });
  }

  const validColor  = /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#7c6af7';
  const validStatus = VALID_STATUSES.has(status) ? status : 'active';
  const validGoal   = goal_clicks && Number(goal_clicks) > 0 ? Number(goal_clicks) : null;

  try {
    const result = db.prepare(`
      INSERT INTO campaigns (name, description, color, status, goal_clicks)
      VALUES (?, ?, ?, ?, ?)
    `).run(name.trim(), description ? description.trim() : null, validColor, validStatus, validGoal);

    res.status(201).json({
      id: result.lastInsertRowid,
      name: name.trim(),
      description: description ? description.trim() : null,
      color: validColor,
      status: validStatus,
      goal_clicks: validGoal,
      link_count: 0,
      total_clicks: 0,
      clicks_today: 0,
      clicks_week: 0,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error creando campaña:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * PATCH /api/campaigns/:id
 * Body: { name?, description?, color?, status?, goal_clicks? }
 */
router.patch('/:id', verifyToken, (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(Number(id))) return res.status(400).json({ error: 'ID inválido' });

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(Number(id));
  if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });

  const { name, description, color, status, goal_clicks } = req.body;

  const newName   = name ? name.trim() : campaign.name;
  const newDesc   = description !== undefined ? (description ? description.trim() : null) : campaign.description;
  const newColor  = /^#[0-9a-fA-F]{6}$/.test(color) ? color : campaign.color;
  const newStatus = VALID_STATUSES.has(status) ? status : (campaign.status || 'active');
  const newGoal   = goal_clicks !== undefined
    ? (goal_clicks && Number(goal_clicks) > 0 ? Number(goal_clicks) : null)
    : campaign.goal_clicks;

  if (newName.length > 60) return res.status(400).json({ error: 'El nombre no puede exceder 60 caracteres' });

  try {
    db.prepare('UPDATE campaigns SET name=?, description=?, color=?, status=?, goal_clicks=? WHERE id=?')
      .run(newName, newDesc, newColor, newStatus, newGoal, Number(id));
    res.json({ id: Number(id), name: newName, description: newDesc, color: newColor, status: newStatus, goal_clicks: newGoal });
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
