// ──────────────────────────────────────────────────────────────────────────────
// Signed session tokens. No new dependency — HMAC-SHA256 via Node's built-in
// crypto. A token is base64url(JSON payload) + "." + base64url(signature).
//
// Keyed by SESSION_SECRET, falling back to ADMIN_PASSWORD if unset, so this
// works with zero extra env config on top of what the repo already requires.
//
// Known limitation: deactivating a user does not invalidate a token already
// issued to them — it just expires (see TTL_MS). Acceptable for a small
// internal team; revisit with a token-version/deny-list if that ever matters.
// ──────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');

const TTL_MS = 12 * 60 * 60 * 1000; // 12h

function secret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || 'iram-dev-secret';
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(payloadB64) {
  return b64url(crypto.createHmac('sha256', secret()).update(payloadB64).digest());
}

function issueToken({ username, role }) {
  const payload = { username, role, iat: Date.now() };
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;

  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch (_) {
    return null;
  }
  if (!payload || !payload.username || !payload.role || !payload.iat) return null;
  if (Date.now() - payload.iat > TTL_MS) return null;

  return { username: payload.username, role: payload.role };
}

module.exports = { issueToken, verifyToken };
