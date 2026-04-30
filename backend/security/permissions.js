const DEFAULT_ROLE = 'viewer';

const ROLE_PERMISSIONS = {
  admin: [
    'dashboard:view',
    'campaigns:read',
    'campaigns:write',
    'campaigns:delete',
    'links:read',
    'links:write',
    'links:toggle',
    'links:delete',
    'analytics:read',
    'users:read',
    'users:write',
    'users:delete',
    'users:permissions'
  ],
  editor: [
    'dashboard:view',
    'campaigns:read',
    'campaigns:write',
    'links:read',
    'links:write',
    'links:toggle',
    'analytics:read'
  ],
  viewer: [
    'dashboard:view',
    'campaigns:read',
    'links:read',
    'analytics:read'
  ]
};

const ALL_PERMISSIONS = Array.from(new Set(Object.values(ROLE_PERMISSIONS).flat())).sort();

function normalizeRole(value) {
  if (!value || typeof value !== 'string') return DEFAULT_ROLE;
  const role = value.trim().toLowerCase();
  return ROLE_PERMISSIONS[role] ? role : DEFAULT_ROLE;
}

function normalizePermissions(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value
    .filter(p => typeof p === 'string')
    .map(p => p.trim())
    .filter(p => ALL_PERMISSIONS.includes(p))));
}

function resolvePermissions(role, extraPermissions = []) {
  const normalizedRole = normalizeRole(role);
  const rolePermissions = ROLE_PERMISSIONS[normalizedRole] || [];
  const customPermissions = normalizePermissions(extraPermissions);
  return Array.from(new Set([...rolePermissions, ...customPermissions])).sort();
}

module.exports = {
  DEFAULT_ROLE,
  ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
  normalizeRole,
  normalizePermissions,
  resolvePermissions
};
