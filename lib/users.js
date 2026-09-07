// ──────────────────────────────────────────────────────────────────────────────
// Named accounts, stored as one JSON blob via lib/blob.js (same store already
// used for HR content/config). Passwords hashed with Node's built-in scrypt —
// no new dependency.
// ──────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const { getJson, putJson } = require('./blob');
const { isValidRole } = require('./roles');

const PATH = 'admin/users.json';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, passwordHash: hash };
}

function verifyPasswordHash(password, salt, passwordHash) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(hash);
  const b = Buffer.from(passwordHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function loadAll() {
  const data = await getJson(PATH);
  return Array.isArray(data) ? data : [];
}

async function saveAll(users) {
  await putJson(PATH, users);
}

function publicView(u) {
  return { username: u.username, role: u.role, active: u.active !== false, createdAt: u.createdAt };
}

async function listUsers() {
  const users = await loadAll();
  return users.map(publicView);
}

async function getUser(username) {
  const users = await loadAll();
  return users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase()) || null;
}

async function createUser({ username, password, role }) {
  if (!username || !password || password.length < 8) {
    throw new Error('username and a password of at least 8 characters are required');
  }
  if (!isValidRole(role)) throw new Error('invalid role');

  const users = await loadAll();
  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error('a user with that username already exists');
  }

  const { salt, passwordHash } = hashPassword(password);
  const user = { username, salt, passwordHash, role, active: true, createdAt: new Date().toISOString() };
  users.push(user);
  await saveAll(users);
  return publicView(user);
}

async function updateUser(username, { role, active, password }) {
  const users = await loadAll();
  const user = users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase());
  if (!user) throw new Error('user not found');

  if (role !== undefined) {
    if (!isValidRole(role)) throw new Error('invalid role');
    user.role = role;
  }
  if (active !== undefined) user.active = !!active;
  if (password !== undefined) {
    if (!password || password.length < 8) throw new Error('password must be at least 8 characters');
    Object.assign(user, hashPassword(password));
  }

  await saveAll(users);
  return publicView(user);
}

async function deleteUser(username) {
  const users = await loadAll();
  const next = users.filter(u => u.username.toLowerCase() !== String(username || '').toLowerCase());
  if (next.length === users.length) throw new Error('user not found');
  await saveAll(next);
}

async function verifyPassword(username, password) {
  const user = await getUser(username);
  if (!user || user.active === false) return null;
  if (!verifyPasswordHash(password, user.salt, user.passwordHash)) return null;
  return publicView(user);
}

module.exports = { listUsers, getUser, createUser, updateUser, deleteUser, verifyPassword };
