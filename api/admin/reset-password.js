// ──────────────────────────────────────────────────────────────────────────────
// Completes a self-service password reset. POST { resetToken, newPassword }.
// resetToken is the pending token emailed by forgot-password.js — proves the
// user clicked the link in their own inbox. Sets the password (which also
// clears any pending forced-reset and restarts the rotation clock — see
// lib/users.js updateUser) and logs them straight in.
//
// Known limitation: the token is stateless (HMAC-signed, not stored), so it
// isn't invalidated after first use — it just expires after 30 minutes (see
// lib/auth.js). Acceptable given it only ever reaches the account's own
// inbox; revisit with a used-token denylist if that ever matters.
// ──────────────────────────────────────────────────────────────────────────────
const { verifyPendingToken, issueToken, sessionCookieHeader } = require('../../lib/auth');
const { updateUser } = require('../../lib/users');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { resetToken, newPassword } = req.body || {};
  if (!resetToken || !newPassword) return res.status(400).json({ error: 'newPassword is required' });

  const pending = verifyPendingToken(resetToken, 'passwordReset');
  if (!pending) return res.status(401).json({ error: 'This reset link is invalid or has expired — please request a new one.' });

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
