// ──────────────────────────────────────────────────────────────────────────────
// Signed session tokens + the httpOnly cookie that carries them. No new
// dependency — HMAC-SHA256 and cookie parsing via Node's built-ins.
//
// Two token kinds share the same signing scheme but are namespaced by `typ` so
// one can never be mistaken for the other:
//   - session tokens (issueToken/verifyToken)         — a real, logged-in session
//   - pending tokens (issuePendingToken/verifyPendingToken) — short-lived proof
//     that step 1 (password) succeeded, used to carry state into step 2
//     (MFA code / forced password change) without granting any access yet.
//
// Keyed by SESSION_SECRET, falling back to ADMIN_PASSWORD if unset, so this
// works with zero extra env config on top of what the repo already requires.
//
// Known limitation: deactivating a user does not invalidate a session token
// already issued to them — it just expires (see TTL_MS). Acceptable for a
// small internal team; revisit with a token-version/deny-list if that ever
// matters.
// ──────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');

const TTL_MS = 12 * 60 * 60 * 1000; // 12h — real sessions

// Pending-token lifetime by purpose — mfa/forceChange are same-session
// continuations (short); passwordReset has to survive a trip to the user's
// email client, so it gets longer.
const PENDING_TTL_MS = { mfa: 5 * 60 * 1000, forceChange: 5 * 60 * 1000, passwordReset: 30 * 60 * 1000 };
const DEFAULT_PENDING_TTL_MS = 5 * 60 * 1000;

const COOKIE_NAME = 'iram_session';

function secret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || 'iram-dev-secret';
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(payloadB64) {
  return b64url(crypto.createHmac('sha256', secret()).update(payloadB64).digest());
}

function encode(payload) {
  const payloadB64 = b64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

function decode(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;

  const expected = sign(payloadB64);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(fromB64url(payloadB64).toString('utf8'));
  } catch (_) {
    return null;
  }
}

function issueToken({ username, role }) {
  return encode({ typ: 'session', username, role, iat: Date.now() });
}

function verifyToken(token) {
  const payload = decode(token);
  if (!payload || payload.typ !== 'session' || !payload.username || !payload.role || !payload.iat) return null;
  if (Date.now() - payload.iat > TTL_MS) return null;
  return { username: payload.username, role: payload.role };
}

/** Proves password (and, if applicable, MFA) succeeded for `username`, without
 *  granting access — or, for 'passwordReset', proves the user clicked a link
 *  emailed to their own address. `purpose` is 'mfa' | 'forceChange' |
 *  'passwordReset'; `data` carries any small extra state the next step needs
 *  (e.g. which MFA type to prompt for). */
function issuePendingToken({ username, purpose, data }) {
  return encode({ typ: 'pending', username, purpose, data: data || null, iat: Date.now() });
}

function verifyPendingToken(token, expectedPurpose) {
  const payload = decode(token);
  if (!payload || payload.typ !== 'pending' || !payload.username || !payload.purpose) return null;
  const ttl = PENDING_TTL_MS[payload.purpose] || DEFAULT_PENDING_TTL_MS;
  if (Date.now() - payload.iat > ttl) return null;
  if (expectedPurpose && payload.purpose !== expectedPurpose) return null;
  return { username: payload.username, purpose: payload.purpose, data: payload.data };
}

function sessionCookieHeader(token) {
  const secure = process.env.VERCEL ? '; Secure' : ''; // allow http on localhost during dev
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(TTL_MS / 1000)}${secure}`;
}

function clearCookieHeader() {
  const secure = process.env.VERCEL ? '; Secure' : '';
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`;
}

function parseCookies(req) {
  const header = (req.headers && req.headers.cookie) || '';
  const out = {};
  header.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i === -1) return;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}

function sessionTokenFromRequest(req) {
  return parseCookies(req)[COOKIE_NAME] || '';
}

module.exports = {
  issueToken, verifyToken,
  issuePendingToken, verifyPendingToken,
  sessionCookieHeader, clearCookieHeader,
  parseCookies, sessionTokenFromRequest,
  COOKIE_NAME
};
