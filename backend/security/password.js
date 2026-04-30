const crypto = require('crypto');

const SALT_BYTES = 16;
const KEY_LEN = 64;
const ITERATIONS = 210000;
const DIGEST = 'sha512';

function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('La contrasena debe tener al menos 8 caracteres');
  }

  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LEN, DIGEST).toString('hex');
  return `pbkdf2$${ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;

  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = Number(parts[1]);
  const salt = parts[2];
  const hash = parts[3];
  if (!Number.isInteger(iterations) || iterations < 10000 || !salt || !hash) return false;

  const candidate = crypto.pbkdf2Sync(password, salt, iterations, KEY_LEN, DIGEST).toString('hex');
  const expected = Buffer.from(hash, 'hex');
  const got = Buffer.from(candidate, 'hex');
  if (expected.length !== got.length) return false;
  return crypto.timingSafeEqual(expected, got);
}

module.exports = {
  hashPassword,
  verifyPassword
};
