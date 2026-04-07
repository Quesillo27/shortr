/**
 * analytics.js — Rutas de analytics
 * GET /api/analytics/summary   — Stats globales
 * GET /api/analytics/:code     — Stats detalladas por link
 */

const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { verifyToken } = require('../middleware/auth');

/**
 * GET /api/analytics/summary
 * Devuelve estadísticas globales: total links, total clicks, clicks hoy.
 */
router.get('/summary', verifyToken, (req, res) => {
  try {
    const totalLinks = db.prepare('SELECT COUNT(*) AS count FROM links WHERE is_active = 1').get();
    const totalClicks = db.prepare('SELECT COUNT(*) AS count FROM clicks').get();
    const clicksToday = db.prepare(`
      SELECT COUNT(*) AS count FROM clicks
      WHERE date(clicked_at) = date('now')
    `).get();
    const activeLinks = db.prepare(`
      SELECT COUNT(*) AS count FROM links
      WHERE is_active = 1
        AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).get();

    // Top 5 links más clickeados
    const topLinks = db.prepare(`
      SELECT
        l.code,
        l.original_url,
        COUNT(c.id) AS clicks
      FROM links l
      LEFT JOIN clicks c ON c.link_id = l.id
      WHERE l.is_active = 1
      GROUP BY l.id
      ORDER BY clicks DESC
      LIMIT 5
    `).all();

    // Clicks por día — últimos 14 días (todos los links)
    const rawDays = db.prepare(`
      SELECT date(clicked_at) AS day, COUNT(*) AS clicks
      FROM clicks
      WHERE clicked_at >= datetime('now', '-13 days')
      GROUP BY date(clicked_at)
      ORDER BY day ASC
    `).all();

    const clickMap = {};
    rawDays.forEach(r => { clickMap[r.day] = r.clicks; });

    const today = new Date();
    const clicks_by_day = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().split('T')[0];
      clicks_by_day.push({ day: dayStr, clicks: clickMap[dayStr] || 0 });
    }

    res.json({
      total_links: totalLinks.count,
      total_clicks: totalClicks.count,
      clicks_today: clicksToday.count,
      active_links: activeLinks.count,
      top_links: topLinks,
      clicks_by_day
    });
  } catch (err) {
    console.error('Error en summary:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/analytics/:code
 * Devuelve analytics detallados de un link:
 * - Clicks por día en los últimos 30 días
 * - Total de clicks
 * - Referrers principales
 * - User agents (mobile vs desktop)
 */
router.get('/:code', verifyToken, (req, res) => {
  const { code } = req.params;

  try {
    const link = db.prepare(`
      SELECT id, code, original_url, created_at, expires_at, is_active
      FROM links WHERE code = ?
    `).get(code);

    if (!link) {
      return res.status(404).json({ error: 'Link no encontrado' });
    }

    // Clicks por día — últimos 30 días
    const clicksByDay = db.prepare(`
      SELECT
        date(clicked_at) AS day,
        COUNT(*) AS clicks
      FROM clicks
      WHERE link_id = ?
        AND clicked_at >= datetime('now', '-30 days')
      GROUP BY date(clicked_at)
      ORDER BY day ASC
    `).all(link.id);

    // Total de clicks
    const totalClicks = db.prepare('SELECT COUNT(*) AS count FROM clicks WHERE link_id = ?').get(link.id);

    // Top referrers
    const topReferrers = db.prepare(`
      SELECT
        COALESCE(referrer, 'Directo') AS referrer,
        COUNT(*) AS count
      FROM clicks
      WHERE link_id = ?
      GROUP BY referrer
      ORDER BY count DESC
      LIMIT 5
    `).all(link.id);

    // Clicks de hoy
    const clicksToday = db.prepare(`
      SELECT COUNT(*) AS count FROM clicks
      WHERE link_id = ? AND date(clicked_at) = date('now')
    `).get(link.id);

    // Rellenar días sin clicks para que la gráfica sea continua
    const days = [];
    const today = new Date();
    const clickMap = {};
    clicksByDay.forEach(r => { clickMap[r.day] = r.clicks; });

    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().split('T')[0];
      days.push({ day: dayStr, clicks: clickMap[dayStr] || 0 });
    }

    // Desglose por dispositivo
    const deviceBreakdown = db.prepare(`
      SELECT COALESCE(device_type, 'desktop') AS device, COUNT(*) AS count
      FROM clicks WHERE link_id = ?
      GROUP BY device_type ORDER BY count DESC
    `).all(link.id);

    // Desglose por navegador (top 5)
    const browserBreakdown = db.prepare(`
      SELECT COALESCE(browser, 'Desconocido') AS browser, COUNT(*) AS count
      FROM clicks WHERE link_id = ?
      GROUP BY browser ORDER BY count DESC LIMIT 5
    `).all(link.id);

    // Desglose por OS (top 5)
    const osBreakdown = db.prepare(`
      SELECT COALESCE(os, 'Desconocido') AS os, COUNT(*) AS count
      FROM clicks WHERE link_id = ?
      GROUP BY os ORDER BY count DESC LIMIT 5
    `).all(link.id);

    // Desglose por país (top 8)
    const countryBreakdown = db.prepare(`
      SELECT
        COALESCE(country_code, '??') AS country_code,
        COALESCE(country, 'Desconocido') AS country,
        COUNT(*) AS count
      FROM clicks WHERE link_id = ?
      GROUP BY country_code ORDER BY count DESC LIMIT 8
    `).all(link.id);

    // Clicks por hora del día (0-23) — patrón de uso
    const hourlyBreakdown = db.prepare(`
      SELECT CAST(strftime('%H', clicked_at) AS INTEGER) AS hour, COUNT(*) AS count
      FROM clicks WHERE link_id = ?
      GROUP BY hour ORDER BY hour ASC
    `).all(link.id);

    const hourMap = {};
    hourlyBreakdown.forEach(r => { hourMap[r.hour] = r.count; });
    const clicks_by_hour = Array.from({ length: 24 }, (_, h) => ({
      hour: h, count: hourMap[h] || 0
    }));

    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

    res.json({
      link: {
        ...link,
        short_url: `${baseUrl}/${link.code}`,
        is_expired: link.expires_at ? new Date(link.expires_at) < new Date() : false
      },
      total_clicks: totalClicks.count,
      clicks_today: clicksToday.count,
      clicks_by_day: days,
      top_referrers: topReferrers,
      device_breakdown: deviceBreakdown,
      browser_breakdown: browserBreakdown,
      os_breakdown: osBreakdown,
      country_breakdown: countryBreakdown,
      clicks_by_hour
    });
  } catch (err) {
    console.error('Error en analytics:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

/**
 * GET /api/analytics/campaign/:id
 * Dashboard completo de una campaña:
 * stats agregadas, top links, clicks por día, desglose dispositivo/país/navegador/OS
 */
router.get('/campaign/:id', verifyToken, (req, res) => {
  const { id } = req.params;
  if (!id || isNaN(Number(id))) return res.status(400).json({ error: 'ID inválido' });

  try {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(Number(id));
    if (!campaign) return res.status(404).json({ error: 'Campaña no encontrada' });

    // Stats generales
    const stats = db.prepare(`
      SELECT
        COUNT(DISTINCT l.id)                                          AS total_links,
        COUNT(DISTINCT CASE WHEN l.is_active = 1 AND (l.expires_at IS NULL OR l.expires_at > datetime('now')) THEN l.id END) AS active_links,
        COUNT(ck.id)                                                  AS total_clicks,
        COUNT(CASE WHEN date(ck.clicked_at) = date('now') THEN 1 END) AS clicks_today
      FROM links l
      LEFT JOIN clicks ck ON ck.link_id = l.id
      WHERE l.campaign_id = ?
    `).get(Number(id));

    // Clicks por día — últimos 30 días
    const rawDays = db.prepare(`
      SELECT date(ck.clicked_at) AS day, COUNT(*) AS clicks
      FROM clicks ck
      JOIN links l ON ck.link_id = l.id
      WHERE l.campaign_id = ?
        AND ck.clicked_at >= datetime('now', '-30 days')
      GROUP BY date(ck.clicked_at)
      ORDER BY day ASC
    `).all(Number(id));

    const clickMap = {};
    rawDays.forEach(r => { clickMap[r.day] = r.clicks; });
    const today = new Date();
    const clicks_by_day = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().split('T')[0];
      clicks_by_day.push({ day: dayStr, clicks: clickMap[dayStr] || 0 });
    }

    // Top 5 links de la campaña
    const topLinks = db.prepare(`
      SELECT l.code, l.original_url, l.is_active, COUNT(ck.id) AS clicks
      FROM links l
      LEFT JOIN clicks ck ON ck.link_id = l.id
      WHERE l.campaign_id = ?
      GROUP BY l.id
      ORDER BY clicks DESC
      LIMIT 5
    `).all(Number(id));

    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    topLinks.forEach(l => { l.short_url = `${baseUrl}/${l.code}`; });

    // Desgloses
    const deviceBreakdown = db.prepare(`
      SELECT COALESCE(ck.device_type, 'desktop') AS device, COUNT(*) AS count
      FROM clicks ck JOIN links l ON ck.link_id = l.id
      WHERE l.campaign_id = ? GROUP BY ck.device_type ORDER BY count DESC
    `).all(Number(id));

    const browserBreakdown = db.prepare(`
      SELECT COALESCE(ck.browser, 'Desconocido') AS browser, COUNT(*) AS count
      FROM clicks ck JOIN links l ON ck.link_id = l.id
      WHERE l.campaign_id = ? GROUP BY ck.browser ORDER BY count DESC LIMIT 5
    `).all(Number(id));

    const osBreakdown = db.prepare(`
      SELECT COALESCE(ck.os, 'Desconocido') AS os, COUNT(*) AS count
      FROM clicks ck JOIN links l ON ck.link_id = l.id
      WHERE l.campaign_id = ? GROUP BY ck.os ORDER BY count DESC LIMIT 5
    `).all(Number(id));

    const countryBreakdown = db.prepare(`
      SELECT COALESCE(ck.country_code,'??') AS country_code,
             COALESCE(ck.country,'Desconocido') AS country, COUNT(*) AS count
      FROM clicks ck JOIN links l ON ck.link_id = l.id
      WHERE l.campaign_id = ? GROUP BY ck.country_code ORDER BY count DESC LIMIT 8
    `).all(Number(id));

    res.json({
      campaign,
      ...stats,
      clicks_by_day,
      top_links: topLinks,
      device_breakdown: deviceBreakdown,
      browser_breakdown: browserBreakdown,
      os_breakdown: osBreakdown,
      country_breakdown: countryBreakdown
    });
  } catch (err) {
    console.error('Error en analytics de campaña:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
