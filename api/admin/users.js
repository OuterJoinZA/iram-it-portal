// ──────────────────────────────────────────────────────────────────────────────
// Manage named accounts. Super Admin only (manageUsers permission).
//   GET             → list accounts (no password hashes)
//   POST            → create { username, email, role, password?, forceResetOnFirstLogin?,
//                      passwordRotationDays? } — password is optional: omit it
//                      to auto-generate one. Either way it's emailed to
//                      `email` via Resend, never shown in the API response.
//   PATCH ?username → update { role?, active?, password?, email?,
//                      forceResetOnFirstLogin?, passwordRotationDays? } — a
//                      password change also emails the new one to the user
//   DELETE ?username→ remove the account
// ──────────────────────────────────────────────────────────────────────────────
const { requireRole } = require('../../lib/require-role');
const { listUsers, createUser, updateUser, deleteUser } = require('../../lib/users');
const { listRoles, ROLES } = require('../../lib/roles');
const { sendEmail } = require('../../lib/mail');

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function credentialEmailHtml({ username, password, role, isReset }) {
  const roleLabel = (ROLES[role] && ROLES[role].label) || role;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Segoe UI,Arial,sans-serif;background:#f4f6f8">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <tr><td style="background:#2D2D2D;padding:28px 32px;text-align:center">
    <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700">iRam IT Portal</p>
    <p style="margin:8px 0 0;color:#6BBF4E;font-size:12px;text-transform:uppercase;letter-spacing:1.5px">${isReset ? 'Your Password Was Reset' : 'Your Account Was Created'}</p>
  </td></tr>
  <tr><td style="padding:28px 32px">
    <p style="margin:0 0 16px;font-size:15px;color:#333">
      ${isReset ? 'Your iRam IT Portal password has been reset.' : `An account has been created for you on the iRam IT Portal as <strong>${esc(roleLabel)}</strong>.`}
      Use the details below to log in.
    </p>
    <table style="background:#f9f9f9;border:1.5px solid #6BBF4E;border-radius:8px;padding:14px 20px;width:100%;margin:0 0 20px;box-sizing:border-box">
      <tr><td style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:.6px">Username</td></tr>
      <tr><td style="font-size:17px;font-weight:700;color:#2D2D2D;padding:2px 0 10px">${esc(username)}</td></tr>
      <tr><td style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:.6px">Password</td></tr>
      <tr><td style="font-size:17px;font-weight:700;font-family:monospace;color:#2D2D2D;padding-top:2px">${esc(password)}</td></tr>
    </table>
    <p style="margin:0;font-size:13px;color:#777">Log in at <a href="https://iram-it-portal.vercel.app/login.html" style="color:#4e9938">iram-it-portal.vercel.app/login</a>. Please keep this password private.</p>
  </td></tr>
  <tr><td style="background:#f4f6f8;padding:16px 32px;text-align:center;border-top:1px solid #e8e8e8">
    <p style="margin:0;color:#aaa;font-size:11px">Automated message from the iRam IT Portal.</p>
  </td></tr>
</table></td></tr></table>
</body></html>`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = requireRole(req, 'manageUsers');
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') {
      const users = await listUsers();
      return res.status(200).json({ users, roles: listRoles() });
    }

    if (req.method === 'POST') {
      const { username, password, role, email, forceResetOnFirstLogin, passwordRotationDays } = req.body || {};
      const created = await createUser({ username, password, role, email, forceResetOnFirstLogin, passwordRotationDays });
      const actualPassword = created.generatedPassword || password;
      const emailSent = await sendEmail(email, 'iRam IT Portal — Your account was created', credentialEmailHtml({ username, password: actualPassword, role, isReset: false }));
      delete created.generatedPassword; // never persisted — this response is the only place it's visible besides the email
      return res.status(201).json({ ok: true, user: created, emailSent });
    }

    if (req.method === 'PATCH') {
      const username = req.query.username || (req.body || {}).username;
      if (!username) return res.status(400).json({ error: 'username is required' });
      const { role, active, password, email, forceResetOnFirstLogin, passwordRotationDays } = req.body || {};
      const updated = await updateUser(username, { role, active, password, email, forceResetOnFirstLogin, passwordRotationDays });

      let emailSent = false;
      if (password !== undefined && updated.email) {
        emailSent = await sendEmail(updated.email, 'iRam IT Portal — Your password was reset', credentialEmailHtml({ username: updated.username, password, role: updated.role, isReset: true }));
      }
      return res.status(200).json({ ok: true, user: updated, emailSent });
    }

    if (req.method === 'DELETE') {
      const username = req.query.username || (req.body || {}).username;
      if (!username) return res.status(400).json({ error: 'username is required' });
      if (username.toLowerCase() === user.username.toLowerCase()) {
        return res.status(400).json({ error: "You can't delete your own account." });
      }
      await deleteUser(username);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Request failed' });
  }
};
