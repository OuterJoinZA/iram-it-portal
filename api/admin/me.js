// ──────────────────────────────────────────────────────────────────────────────
// GET → { username, role } if the session cookie is valid, 401 otherwise.
// Every gated admin page calls this on load as the real access check — the
// role/username cached in sessionStorage is UI convenience only, this is the
// source of truth (a cleared/expired/forged client value can't fake access,
// since every admin/* API call is independently checked server-side anyway).
// ──────────────────────────────────────────────────────────────────────────────
const { verifyToken, sessionTokenFromRequest } = require('../../lib/auth');
const { getUser } = require('../../lib/users');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const session = verifyToken(sessionTokenFromRequest(req));
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  // The break-glass Super Admin login (any username + ADMIN_PASSWORD) has no
  // stored record — MFA/self-service password change don't apply to it, and
  // account.html uses hasAccount to explain that rather than fail confusingly.
  const record = await getUser(session.username);
  return res.status(200).json({
    username: session.username,
    role: session.role,
    hasAccount: !!record,
    mfaEnabled: record ? !!record.mfaEnabled : false,
    mfaType: record ? (record.mfaType || null) : null
  });
};
