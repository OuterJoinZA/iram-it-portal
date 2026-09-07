// ──────────────────────────────────────────────────────────────────────────────
// Named accounts, stored as one JSON blob via lib/blob.js (same store already
// used for HR content/config). Passwords hashed with Node's built-in scrypt —
// no new dependency. Also owns: MFA (TOTP/email OTP) setup + login challenge
// state, and the per-user force-reset / rotation password policy.
// ──────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const { getJson, putJson } = require('./blob');
const { isValidRole } = require('./roles');
const { generateSecret, otpauthUrl, verifyTotp } = require('./totp');

const PATH = 'admin/users.json';

const MFA_SETUP_TTL_MS = 10 * 60 * 1000; // window to confirm a pending MFA enrollment
const MFA_LOGIN_TTL_MS = 10 * 60 * 1000; // window to enter an emailed login OTP

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

// Random, easy-to-type password for the "auto-generate" option — 16 chars,
// unambiguous alphabet (no 0/O/1/l/I).
function generatePassword() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

function generateOtpCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function loadAll() {
  const data = await getJson(PATH);
  return Array.isArray(data) ? data : [];
}

async function saveAll(users) {
  await putJson(PATH, users);
}

function publicView(u) {
  return {
    username: u.username,
    email: u.email || '',
    role: u.role,
    active: u.active !== false,
    createdAt: u.createdAt,
    mfaEnabled: !!u.mfaEnabled,
    mfaType: u.mfaType || null,
    forceResetOnFirstLogin: !!u.forceResetOnFirstLogin,
    passwordRotationDays: u.passwordRotationDays || null,
    passwordChangedAt: u.passwordChangedAt || null
  };
}

async function listUsers() {
  const users = await loadAll();
  return users.map(publicView);
}

/** Matches by username OR email (case-insensitive) — login accepts either. */
async function getUser(identifier) {
  const q = String(identifier || '').toLowerCase();
  const users = await loadAll();
  return users.find(u => u.username.toLowerCase() === q || (u.email || '').toLowerCase() === q) || null;
}

async function createUser({ username, password, role, email, forceResetOnFirstLogin, passwordRotationDays }) {
  if (!username) throw new Error('username is required');
  if (!isValidRole(role)) throw new Error('invalid role');
  if (!email) throw new Error('an email address is required so the account can receive its password');

  const generated = !password;
  const plainPassword = password || generatePassword();
  if (plainPassword.length < 8) throw new Error('password must be at least 8 characters');

  const users = await loadAll();
  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error('a user with that username already exists');
  }

  const { salt, passwordHash } = hashPassword(plainPassword);
  const user = {
    username, email, salt, passwordHash, role, active: true, createdAt: new Date().toISOString(),
    passwordChangedAt: Date.now(),
    forceResetOnFirstLogin: !!forceResetOnFirstLogin,
    passwordRotationDays: passwordRotationDays || null,
    mfaEnabled: false, mfaType: null, mfaSecret: null
  };
  users.push(user);
  await saveAll(users);
  return { ...publicView(user), generatedPassword: generated ? plainPassword : undefined };
}

async function updateUser(username, { role, active, password, email, forceResetOnFirstLogin, passwordRotationDays }) {
  const users = await loadAll();
  const user = users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase());
  if (!user) throw new Error('user not found');

  if (role !== undefined) {
    if (!isValidRole(role)) throw new Error('invalid role');
    user.role = role;
  }
  if (active !== undefined) user.active = !!active;
  if (email !== undefined) user.email = email;
  if (forceResetOnFirstLogin !== undefined) user.forceResetOnFirstLogin = !!forceResetOnFirstLogin;
  if (passwordRotationDays !== undefined) user.passwordRotationDays = passwordRotationDays || null;
  if (password !== undefined) {
    if (!password || password.length < 8) throw new Error('password must be at least 8 characters');
    Object.assign(user, hashPassword(password));
    // Any password change (admin reset or self-service) satisfies a pending
    // force-reset and restarts the rotation clock.
    user.passwordChangedAt = Date.now();
    user.forceResetOnFirstLogin = false;
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

async function verifyPassword(identifier, password) {
  const user = await getUser(identifier);
  if (!user || user.active === false) return null;
  if (!verifyPasswordHash(password, user.salt, user.passwordHash)) return null;
  return user; // full record — caller (login) needs mfa/policy fields, not just publicView
}

/** True if this login must be redirected into a forced password change first. */
function needsPasswordChange(user) {
  if (user.forceResetOnFirstLogin) return true;
  if (user.passwordRotationDays && user.passwordChangedAt) {
    const ageMs = Date.now() - user.passwordChangedAt;
    if (ageMs > user.passwordRotationDays * 24 * 60 * 60 * 1000) return true;
  }
  return false;
}

// ── MFA setup (self-service, confirm-before-enable) ────────────────────────

async function beginMfaSetup(username, type) {
  if (type !== 'totp' && type !== 'email') throw new Error('type must be "totp" or "email"');
  const users = await loadAll();
  const user = users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase());
  if (!user) throw new Error('user not found');

  const secretOrCode = type === 'totp' ? generateSecret() : generateOtpCode();
  user.mfaPendingType    = type;
  user.mfaPendingSecret  = secretOrCode;
  user.mfaPendingExpires = Date.now() + MFA_SETUP_TTL_MS;
  await saveAll(users);

  return type === 'totp'
    ? { type, secret: secretOrCode, otpauthUrl: otpauthUrl(secretOrCode, user.username) }
    : { type, code: secretOrCode, email: user.email };
}

async function confirmMfaSetup(username, code) {
  const users = await loadAll();
  const user = users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase());
  if (!user) throw new Error('user not found');
  if (!user.mfaPendingType || !user.mfaPendingExpires || Date.now() > user.mfaPendingExpires) {
    throw new Error('No pending setup, or it expired — start again.');
  }

  const ok = user.mfaPendingType === 'totp'
    ? verifyTotp(user.mfaPendingSecret, code)
    : String(code) === user.mfaPendingSecret;
  if (!ok) throw new Error('Incorrect code.');

  user.mfaEnabled = true;
  user.mfaType    = user.mfaPendingType;
  user.mfaSecret  = user.mfaPendingType === 'totp' ? user.mfaPendingSecret : null;
  delete user.mfaPendingType;
  delete user.mfaPendingSecret;
  delete user.mfaPendingExpires;

  await saveAll(users);
  return publicView(user);
}

async function disableMfa(username, password) {
  const user = await getUser(username);
  if (!user) throw new Error('user not found');
  if (!verifyPasswordHash(password, user.salt, user.passwordHash)) throw new Error('Incorrect password.');

  const users = await loadAll();
  const target = users.find(u => u.username.toLowerCase() === user.username.toLowerCase());
  target.mfaEnabled = false;
  target.mfaType = null;
  target.mfaSecret = null;
  delete target.mfaPendingType;
  delete target.mfaPendingSecret;
  delete target.mfaPendingExpires;
  await saveAll(users);
  return publicView(target);
}

// ── MFA login challenge (separate state from setup) ─────────────────────────

/** For email-type MFA: generates and stores this login attempt's OTP. Caller emails it. */
async function issueLoginOtp(username) {
  const users = await loadAll();
  const user = users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase());
  if (!user) throw new Error('user not found');
  const code = generateOtpCode();
  user.mfaLoginCode    = code;
  user.mfaLoginExpires = Date.now() + MFA_LOGIN_TTL_MS;
  await saveAll(users);
  return code;
}

async function verifyLoginOtp(username, code) {
  const users = await loadAll();
  const user = users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase());
  if (!user || !user.mfaLoginCode || !user.mfaLoginExpires) return false;
  if (Date.now() > user.mfaLoginExpires) return false;
  const ok = String(code) === user.mfaLoginCode;
  if (ok) {
    delete user.mfaLoginCode;
    delete user.mfaLoginExpires;
    await saveAll(users);
  }
  return ok;
}

function verifyLoginTotp(user, code) {
  return user.mfaType === 'totp' && verifyTotp(user.mfaSecret, code);
}

module.exports = {
  listUsers, getUser, createUser, updateUser, deleteUser, verifyPassword, needsPasswordChange,
  beginMfaSetup, confirmMfaSetup, disableMfa,
  issueLoginOtp, verifyLoginOtp, verifyLoginTotp,
  publicView
};
