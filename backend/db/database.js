/**
 * database.js — Inicializacion SQLite + migraciones idempotentes
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { hashPassword } = require('../security/password');
const { DEFAULT_ROLE } = require('../security/permissions');

const DB_DIR = process.env.NODE_ENV === 'production'
  ? '/data'
  : path.join(__dirname, '../../data');
const DB_PATH = path.join(DB_DIR, 'shortr.db');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '${DEFAULT_ROLE}',
    permissions_json TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT DEFAULT '#0f766e',
    status TEXT DEFAULT 'active',
    goal_clicks INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    original_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    is_active INTEGER DEFAULT 1,
    campaign_id INTEGER,
    created_by_user_id INTEGER,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id INTEGER NOT NULL,
    clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_hash TEXT,
    visitor_hash TEXT,
    user_agent TEXT,
    referrer TEXT,
    referrer_host TEXT,
    path TEXT,
    query_string TEXT,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_term TEXT,
    utm_content TEXT,
    country_code TEXT,
    country TEXT,
    device_type TEXT,
    browser TEXT,
    os TEXT,
    FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

  CREATE INDEX IF NOT EXISTS idx_links_code ON links(code);
  CREATE INDEX IF NOT EXISTS idx_links_created ON links(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_links_campaign ON links(campaign_id);
  CREATE INDEX IF NOT EXISTS idx_links_creator ON links(created_by_user_id);

  CREATE INDEX IF NOT EXISTS idx_clicks_link_id ON clicks(link_id);
  CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON clicks(clicked_at);
  CREATE INDEX IF NOT EXISTS idx_clicks_link_date ON clicks(link_id, clicked_at);
  CREATE INDEX IF NOT EXISTS idx_clicks_country ON clicks(country_code);
  CREATE INDEX IF NOT EXISTS idx_clicks_ref_host ON clicks(referrer_host);
  CREATE INDEX IF NOT EXISTS idx_clicks_utm_source ON clicks(utm_source);
  CREATE INDEX IF NOT EXISTS idx_clicks_visitor ON clicks(visitor_hash);
`);

function columnNames(tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map(c => c.name);
}

function addColumnIfMissing(tableName, columnName, columnDef) {
  const cols = columnNames(tableName);
  if (!cols.includes(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef}`);
  }
}

addColumnIfMissing('campaigns', 'status', "TEXT DEFAULT 'active'");
addColumnIfMissing('campaigns', 'goal_clicks', 'INTEGER');

addColumnIfMissing('links', 'campaign_id', 'INTEGER');
addColumnIfMissing('links', 'created_by_user_id', 'INTEGER');

addColumnIfMissing('users', 'role', `TEXT NOT NULL DEFAULT '${DEFAULT_ROLE}'`);
addColumnIfMissing('users', 'permissions_json', "TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing('users', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('users', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
addColumnIfMissing('users', 'last_login_at', 'DATETIME');

const clickColumns = [
  ['visitor_hash', 'TEXT'],
  ['referrer_host', 'TEXT'],
  ['path', 'TEXT'],
  ['query_string', 'TEXT'],
  ['utm_source', 'TEXT'],
  ['utm_medium', 'TEXT'],
  ['utm_campaign', 'TEXT'],
  ['utm_term', 'TEXT'],
  ['utm_content', 'TEXT'],
  ['country_code', 'TEXT'],
  ['country', 'TEXT'],
  ['device_type', 'TEXT'],
  ['browser', 'TEXT'],
  ['os', 'TEXT']
];

for (const [name, type] of clickColumns) {
  addColumnIfMissing('clicks', name, type);
}

const updateLoginStmt = db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?');

function ensureBootstrapAdmin() {
  const totalUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (totalUsers > 0) return;

  const username = (process.env.ADMIN_USER || 'admin').trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('Se requiere ADMIN_PASSWORD (minimo 8 caracteres) para crear el admin inicial');
  }

  const passwordHash = hashPassword(password);
  db.prepare(`
    INSERT INTO users (username, password_hash, role, permissions_json, is_active)
    VALUES (?, ?, 'admin', '[]', 1)
  `).run(username, passwordHash);
}

function touchUserLogin(userId) {
  updateLoginStmt.run(userId);
}

function resetAppData() {
  const deleteUsers = db.prepare("DELETE FROM users WHERE role <> 'admin'");

  db.transaction(() => {
    db.exec('DELETE FROM clicks');
    db.exec('DELETE FROM links');
    db.exec('DELETE FROM campaigns');
    deleteUsers.run();
    db.exec('DELETE FROM sqlite_sequence WHERE name IN (\'clicks\',\'links\',\'campaigns\')');
  })();
}

ensureBootstrapAdmin();

module.exports = {
  db,
  resetAppData,
  touchUserLogin
};
