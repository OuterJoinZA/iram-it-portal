// ──────────────────────────────────────────────────────────────────────────────
// Login. POST { username, password } — `username` may be a username or email.
//
// Multi-step flow:
//   1. Rate-limit check (per identifier+IP) before touching credentials at all.
//   2. Password check:
//        - matches ADMIN_PASSWORD (any identifier) → permanent break-glass
//          Super Admin login, regardless of the users store. How you log in
//          the very first time, before any named accounts exist.
//        - otherwise looked up + verified in lib/users.js.
//      Wrong on either path → generic 401, and record a failure for lockout.
//   3. If the account requires a forced password change (first login /
//      rotation), return { mustChangePassword:true, pendingToken } instead of
//      a session — client posts the new password to force-change-password.js.
//   4. 2FA is required for every named account with an email: an authenticator
//      code if they set one up, otherwise a code emailed to them. Returns
//      { mfaRequired:'totp'|'email', pendingToken } instead of a session —
//      client posts the code to mfa-verify.js.
//   5. Only an account with no email at all gets a session straight away.
//
// `remember` (the "Remember me" tick box) rides along in the pending token and
// makes the final session last 30 days instead of 12 hours.
// ──────────────────────────────────────────────────────────────────────────────
const { issueToken, issuePendingToken, sessionCookieHeader } = require('../../lib/auth');
const { verifyPassword, needsPasswordChange, loginMfaType } = require('../../lib/users');
const { checkLocked, recordFailure, recordSuccess } = require('../../lib/rate-limit');
const { sendLoginOtpEmail, maskEmail } = require('../../lib/login-otp');

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body || {};
  const remember = !!(req.body && req.body.remember);
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

  const ip  = clientIp(req);
  const key = `${String(username).toLowerCase()}:${ip}`;

  const lock = await checkLocked(key);
  if (lock.locked) {
    return res.status(429).json({ error: 'Too many attempts. Please try again in a few minutes.' });
  }

  // Break-glass: any identifier + the shared ADMIN_PASSWORD always logs in as
  // Super Admin, skipping the users store entirely (no MFA/policy to apply —
  // it isn't a named account).
  const breakGlass = process.env.ADMIN_PASSWORD;
  if (breakGlass && password === breakGlass) {
    await recordSuccess(key);
    const token = issueToken({ username, role: 'super_admin', remember });
    res.setHeader('Set-Cookie', sessionCookieHeader(token, remember));
    return res.status(200).json({ ok: true, username, role: 'super_admin' });
  }

  let user;
  try {
    user = await verifyPassword(username, password);
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ error: 'Login is temporarily unavailable.' });
  }

  if (!user) {
    await recordFailure(key);
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }

  await recordSuccess(key);

  if (needsPasswordChange(user)) {
    const pendingToken = issuePendingToken({ username: user.username, purpose: 'forceChange', data: { remember } });
    return res.status(200).json({ ok: true, mustChangePassword: true, pendingToken });
  }

  const mfaType = loginMfaType(user);
  if (mfaType) {
    if (mfaType === 'email') {
      try { await sendLoginOtpEmail(user); } catch (err) { console.error('Login OTP email failed:', err.message); }
    }
    const pendingToken = issuePendingToken({ username: user.username, purpose: 'mfa', data: { mfaType, remember } });
    return res.status(200).json({ ok: true, mfaRequired: mfaType, sentTo: mfaType === 'email' ? maskEmail(user.email) : undefined, pendingToken });
  }

  const token = issueToken({ username: user.username, role: user.role, remember });
  res.setHeader('Set-Cookie', sessionCookieHeader(token, remember));
  return res.status(200).json({ ok: true, username: user.username, role: user.role });
};
