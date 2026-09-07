// ──────────────────────────────────────────────────────────────────────────────
// Self-service: begin enabling MFA on your own account. POST { type: 'totp'|'email' }.
// Any logged-in user can do this for themselves — no special permission
// beyond having a session (requireRole with no permission argument = just
// "logged in"). Doesn't flip mfaEnabled yet — mfa-confirm.js does that once
// the code is proven.
// ──────────────────────────────────────────────────────────────────────────────
const { requireRole } = require('../../lib/require-role');
const { beginMfaSetup } = require('../../lib/users');
const { sendEmail } = require('../../lib/mail');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = requireRole(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { type } = req.body || {};
  try {
    const result = await beginMfaSetup(user.username, type);
    if (type === 'email') {
      await sendEmail(result.email, 'iRam IT Portal — Confirm two-factor setup', `
        <div style="font-family:Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto">
          <p>Your code to confirm email two-factor authentication is:</p>
          <p style="font-size:28px;font-weight:700;font-family:monospace;letter-spacing:3px">${result.code}</p>
          <p style="color:#888;font-size:12px">Expires in 10 minutes.</p>
        </div>`);
      return res.status(200).json({ ok: true, type: 'email' }); // never echo the code back over the API
    }
    return res.status(200).json({ ok: true, type: 'totp', secret: result.secret, otpauthUrl: result.otpauthUrl });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Could not start MFA setup.' });
  }
};
