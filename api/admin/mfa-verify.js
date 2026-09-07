// ──────────────────────────────────────────────────────────────────────────────
// Step 2 of login when MFA is enabled. POST { pendingToken, code }.
// Validates the code (TOTP against the account's secret, or the emailed OTP)
// and, on success, issues the real session cookie — same rate-limit key as
// login.js so repeated bad codes lock out too.
// ──────────────────────────────────────────────────────────────────────────────
const { verifyPendingToken, issueToken, sessionCookieHeader } = require('../../lib/auth');
const { getUser, verifyLoginOtp, verifyLoginTotp } = require('../../lib/users');
const { checkLocked, recordFailure, recordSuccess } = require('../../lib/rate-limit');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { pendingToken, code } = req.body || {};
  if (!pendingToken || !code) return res.status(400).json({ error: 'code is required' });

  const pending = verifyPendingToken(pendingToken, 'mfa');
  if (!pending) return res.status(401).json({ error: 'Your login attempt expired — please log in again.' });

  const key = `mfa:${pending.username.toLowerCase()}`;
  const lock = await checkLocked(key);
  if (lock.locked) return res.status(429).json({ error: 'Too many attempts. Please try again in a few minutes.' });

  const user = await getUser(pending.username);
  if (!user || !user.mfaEnabled) return res.status(401).json({ error: 'MFA is no longer enabled on this account — please log in again.' });

  const ok = user.mfaType === 'totp' ? verifyLoginTotp(user, code) : await verifyLoginOtp(user.username, code);
  if (!ok) {
    await recordFailure(key);
    return res.status(401).json({ error: 'Incorrect code.' });
  }
  await recordSuccess(key);

  const token = issueToken({ username: user.username, role: user.role });
  res.setHeader('Set-Cookie', sessionCookieHeader(token));
  return res.status(200).json({ ok: true, username: user.username, role: user.role });
};
