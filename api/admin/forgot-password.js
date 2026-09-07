// ──────────────────────────────────────────────────────────────────────────────
// Self-service "forgot username or password". POST { identifier } — a
// username or email. Always responds with the same generic message whether
// or not an account matches, so this can't be used to enumerate accounts.
//
// If it matches an active account, emails a reset link (containing a
// short-lived pending token, see lib/auth.js) to that account's address —
// which also reminds them of their username, covering "forgot username" too,
// since the only way to look yourself up here is by an email you already
// have access to.
// ──────────────────────────────────────────────────────────────────────────────
const { issuePendingToken } = require('../../lib/auth');
const { getUser } = require('../../lib/users');
const { checkLocked, recordFailure } = require('../../lib/rate-limit');
const { sendEmail } = require('../../lib/mail');

const GENERIC_MESSAGE = "If that account exists, we've emailed instructions to reset the password.";

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function resetEmailHtml({ username, resetUrl }) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Segoe UI,Arial,sans-serif;background:#f4f6f8">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <tr><td style="background:#2D2D2D;padding:28px 32px;text-align:center">
    <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700">iRam IT Portal</p>
    <p style="margin:8px 0 0;color:#6BBF4E;font-size:12px;text-transform:uppercase;letter-spacing:1.5px">Password Reset Requested</p>
  </td></tr>
  <tr><td style="padding:28px 32px">
    <p style="margin:0 0 8px;font-size:15px;color:#333">Your username is <strong>${username}</strong>.</p>
    <p style="margin:0 0 20px;font-size:14px;color:#555">Click below to choose a new password. This link expires in 30 minutes and can only be used once.</p>
    <p style="text-align:center;margin:0 0 20px">
      <a href="${resetUrl}" style="display:inline-block;background:#4e9938;color:#fff;text-decoration:none;font-weight:700;padding:12px 24px;border-radius:8px;font-size:14px">Reset your password</a>
    </p>
    <p style="margin:0;font-size:12px;color:#888">If you didn't request this, you can safely ignore this email — your password won't change.</p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { identifier } = req.body || {};
  if (!identifier) return res.status(400).json({ error: 'identifier is required' });

  const key = `forgot:${String(identifier).toLowerCase()}:${clientIp(req)}`;
  const lock = await checkLocked(key);
  if (lock.locked) return res.status(429).json({ error: 'Too many requests. Please try again in a few minutes.' });
  await recordFailure(key); // caps frequency regardless of outcome — not just failures

  try {
    const user = await getUser(identifier);
    if (user && user.active !== false) {
      const pendingToken = issuePendingToken({ username: user.username, purpose: 'passwordReset' });
      const origin = `https://${req.headers.host || 'iram-it-portal.vercel.app'}`;
      const resetUrl = `${origin}/login.html?reset=${encodeURIComponent(pendingToken)}`;
      await sendEmail(user.email, 'iRam IT Portal — Reset your password', resetEmailHtml({ username: user.username, resetUrl }));
    }
  } catch (err) {
    console.error('forgot-password error:', err.message); // never surfaced — response stays generic either way
  }

  return res.status(200).json({ ok: true, message: GENERIC_MESSAGE });
};
