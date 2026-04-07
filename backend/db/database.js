/**
 * database.js — Inicialización de SQLite con better-sqlite3
 * Crea las tablas si no existen (idempotente) e índices necesarios.
 */

const Database = require('better-sqlite3');
const path = require('path');

// En producción Docker, la DB vive en /data. En local, en ./data/
const DB_DIR = process.env.NODE_ENV === 'production' ? '/data' : path.join(__dirname, '../../data');
const DB_PATH = path.join(DB_DIR, 'shortr.db');

// Crear directorio si no existe
const fs = require('fs');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Activar WAL mode para mejor concurrencia
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema principal
db.exec(`
  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    original_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id INTEGER NOT NULL,
    clicked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_hash TEXT,
    user_agent TEXT,
    referrer TEXT,
    FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_clicks_link_id ON clicks(link_id);
  CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON clicks(clicked_at);
  CREATE INDEX IF NOT EXISTS idx_clicks_link_date ON clicks(link_id, clicked_at);
  CREATE INDEX IF NOT EXISTS idx_links_code ON links(code);
  CREATE INDEX IF NOT EXISTS idx_links_created ON links(created_at DESC);
`);

// Migración: agregar columnas de enriquecimiento de clicks si no existen
const existingCols = db.prepare('PRAGMA table_info(clicks)').all().map(c => c.name);
const newCols = [
  ['country_code', 'TEXT'],
  ['country',      'TEXT'],
  ['device_type',  'TEXT'],
  ['browser',      'TEXT'],
  ['os',           'TEXT'],
];
for (const [col, type] of newCols) {
  if (!existingCols.includes(col)) {
    db.exec(`ALTER TABLE clicks ADD COLUMN ${col} ${type}`);
  }
}

module.exports = db;
