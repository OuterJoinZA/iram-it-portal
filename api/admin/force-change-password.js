// ──────────────────────────────────────────────────────────────────────────────
// Step 2 of login when a forced password change is due (first login, or the
// rotation policy expired). POST { pendingToken, newPassword }.
// Sets the new password (which also clears forceResetOnFirstLogin and resets
// the rotation clock — see lib/users.js updateUser) and issues the real
// session cookie.
// ──────────────────────────────────────────────────────────────────────────────
const { verifyPendingToken, issueToken, sessionCookieHeader } = require('../../lib/auth');
const { updateUser } = require('../../lib/users');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { pendingToken, newPassword } = req.body || {};
  if (!pendingToken || !newPassword) return res.status(400).json({ error: 'newPassword is required' });

  const pending = verifyPendingToken(pendingToken, 'forceChange');
  if (!pending) return res.status(401).json({ error: 'Your login attempt expired — please log in again.' });

  let user;
  try {
    user = await updateUser(pending.username, { password: newPassword });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Could not set the new password.' });
  }

  const token = issueToken({ username: user.username, role: user.role });
  res.setHeader('Set-Cookie', sessionCookieHeader(token));
  return res.status(200).json({ ok: true, username: user.username, role: user.role });
};
