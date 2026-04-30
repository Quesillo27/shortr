const express = require('express');
const router = express.Router();

const { db } = require('../db/database');
const { verifyToken } = require('../middleware/auth');
const { requirePermission } = require('../middleware/rbac');
const { usersLimiter } = require('../middleware/rateLimit');
const { hashPassword } = require('../security/password');
const {
  ALL_PERMISSIONS,
  DEFAULT_ROLE,
  ROLE_PERMISSIONS,
  normalizeRole,
  normalizePermissions,
  resolvePermissions
} = require('../security/permissions');

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,32}$/;

function parseJsonArray(value) {
  if (!value || typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeUser(row) {
  const customPermissions = parseJsonArray(row.permissions_json);
  const resolved = resolvePermissions(row.role, customPermissions);
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    is_active: !!row.is_active,
    permissions: resolved,
    custom_permissions: customPermissions,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_login_at: row.last_login_at
  };
}

function countActiveAdmins() {
  return db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1").get().count;
}

function hasPermission(req, permission) {
  return Array.isArray(req.user.permissions) && req.user.permissions.includes(permission);
}

router.use(verifyToken, usersLimiter);

router.get('/meta', requirePermission('users:read'), (req, res) => {
  res.json({
    default_role: DEFAULT_ROLE,
    roles: ROLE_PERMISSIONS,
    all_permissions: ALL_PERMISSIONS
  });
});

router.get('/', requirePermission('users:read'), (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT id, username, role, permissions_json, is_active, created_at, updated_at, last_login_at
      FROM users
      ORDER BY created_at ASC
    `).all();

    res.json({ users: rows.map(serializeUser) });
  } catch (err) {
    console.error('Error listando usuarios:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.post('/', requirePermission('users:write'), (req, res) => {
  const { username, password, role, is_active, permissions } = req.body;

  if (!username || typeof username !== 'string' || !USERNAME_PATTERN.test(username.trim())) {
    return res.status(400).json({ error: 'Username invalido. Usa 3-32 caracteres [a-zA-Z0-9._-]' });
  }

  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'La contrasena debe tener al menos 8 caracteres' });
  }

  const cleanRole = normalizeRole(role);
  const cleanUsername = username.trim();
  const cleanActive = is_active === false ? 0 : 1;
  const canAssignPermissions = hasPermission(req, 'users:permissions');
  const customPermissions = canAssignPermissions ? normalizePermissions(permissions) : [];

  try {
    const passwordHash = hashPassword(password);
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, role, permissions_json, is_active)
      VALUES (?, ?, ?, ?, ?)
    `).run(cleanUsername, passwordHash, cleanRole, JSON.stringify(customPermissions), cleanActive);

    const row = db.prepare(`
      SELECT id, username, role, permissions_json, is_active, created_at, updated_at, last_login_at
      FROM users
      WHERE id = ?
    `).get(result.lastInsertRowid);

    res.status(201).json(serializeUser(row));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ese username ya existe' });
    }
    console.error('Error creando usuario:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.patch('/:id', requirePermission('users:write'), (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'ID invalido' });
  }

  try {
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!current) return res.status(404).json({ error: 'Usuario no encontrado' });

    const nextUsername = req.body.username !== undefined ? String(req.body.username).trim() : current.username;
    if (!USERNAME_PATTERN.test(nextUsername)) {
      return res.status(400).json({ error: 'Username invalido. Usa 3-32 caracteres [a-zA-Z0-9._-]' });
    }

    const nextRole = req.body.role !== undefined ? normalizeRole(req.body.role) : current.role;
    const nextActive = req.body.is_active !== undefined ? (req.body.is_active ? 1 : 0) : current.is_active;

    const canAssignPermissions = hasPermission(req, 'users:permissions');
    const nextCustomPermissions = req.body.permissions !== undefined
      ? (canAssignPermissions ? normalizePermissions(req.body.permissions) : parseJsonArray(current.permissions_json))
      : parseJsonArray(current.permissions_json);

    if (req.user.id === userId && nextActive === 0) {
      return res.status(400).json({ error: 'No puedes desactivar tu propio usuario' });
    }

    const adminWillStayAdmin = nextRole === 'admin' && nextActive === 1;
    if (current.role === 'admin' && current.is_active === 1 && !adminWillStayAdmin && countActiveAdmins() <= 1) {
      return res.status(400).json({ error: 'Debe existir al menos un admin activo' });
    }

    db.prepare(`
      UPDATE users
      SET username = ?, role = ?, permissions_json = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nextUsername, nextRole, JSON.stringify(nextCustomPermissions), nextActive, userId);

    const updated = db.prepare(`
      SELECT id, username, role, permissions_json, is_active, created_at, updated_at, last_login_at
      FROM users
      WHERE id = ?
    `).get(userId);

    res.json(serializeUser(updated));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Ese username ya existe' });
    }
    console.error('Error actualizando usuario:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.patch('/:id/password', requirePermission('users:write'), (req, res) => {
  const userId = Number(req.params.id);
  const { password } = req.body;
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'ID invalido' });
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'La contrasena debe tener al menos 8 caracteres' });
  }

  try {
    const current = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!current) return res.status(404).json({ error: 'Usuario no encontrado' });

    const passwordHash = hashPassword(password);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(passwordHash, userId);

    res.json({ message: 'Contrasena actualizada correctamente' });
  } catch (err) {
    console.error('Error actualizando contrasena:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.delete('/:id', requirePermission('users:delete'), (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'ID invalido' });
  }

  if (req.user.id === userId) {
    return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
  }

  try {
    const user = db.prepare('SELECT id, role, is_active FROM users WHERE id = ?').get(userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (user.role === 'admin' && user.is_active === 1 && countActiveAdmins() <= 1) {
      return res.status(400).json({ error: 'Debe existir al menos un admin activo' });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    res.json({ message: 'Usuario eliminado correctamente' });
  } catch (err) {
    console.error('Error eliminando usuario:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
