// ─────────────────────────────────────────────────────────────────────────────
// Admin: change the portal admin password.
// - Verifies the current password against ADMIN_PASSWORD env var.
// - If VERCEL_TOKEN + VERCEL_PROJECT_ID are set, updates the env var in Vercel.
// - If VERCEL_DEPLOY_HOOK_URL is set, triggers a redeployment automatically.
// - Sends the new password via Resend email to the supplied notifyEmail.
// ─────────────────────────────────────────────────────────────────────────────

const VERCEL_API = 'https://api.vercel.com';

function isAuthed(req) {
  const required = process.env.ADMIN_PASSWORD;
  if (!required) return true;
  return (req.headers['x-admin-key'] || '') === required;
}

async function updateVercelEnv(key, value) {
  const token     = process.env.VERCEL_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  const teamId    = process.env.VERCEL_TEAM_ID;
  if (!token || !projectId) return { ok: false, reason: 'no_token' };

  const qs = teamId ? `?teamId=${teamId}` : '';

  const listRes = await fetch(`${VERCEL_API}/v9/projects/${projectId}/env${qs}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!listRes.ok) return { ok: false, reason: 'list_failed' };
  const { envs = [] } = await listRes.json();
  const existing = envs.find(e => e.key === key);

  if (existing) {
    const upRes = await fetch(`${VERCEL_API}/v9/projects/${projectId}/env/${existing.id}${qs}`, {
      method:  'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ value })
    });
    return upRes.ok ? { ok: true } : { ok: false, reason: 'patch_failed' };
  } else {
    const crRes = await fetch(`${VERCEL_API}/v9/projects/${projectId}/env${qs}`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ key, value, type: 'encrypted', target: ['production'] })
    });
    return crRes.ok ? { ok: true, created: true } : { ok: false, reason: 'create_failed' };
  }
}

async function triggerDeploy() {
  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hookUrl) return false;
  try {
    const r = await fetch(hookUrl, { method: 'GET' });
    return r.ok;
  } catch (_) { return false; }
}

async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        from: 'iRam IT Support <noreply@outerjoin.co.za>',
        to:   [to],
        subject,
        html
      })
    });
    return r.ok;
  } catch (_) { return false; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAuthed(req))        return res.status(401).json({ error: 'Unauthorized' });

  const { currentPassword, newPassword, confirmPassword, notifyEmail } = req.body || {};
  const required = process.env.ADMIN_PASSWORD;

  if (required && currentPassword !== required) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }
  if (!notifyEmail) {
    return res.status(400).json({ error: 'A notification email address is required.' });
  }

  let vercelResult = { ok: false, reason: 'no_token' };
  let deployed     = false;
  let emailSent    = false;

  try { vercelResult = await updateVercelEnv('ADMIN_PASSWORD', newPassword); } catch (_) {}
  if (vercelResult.ok) {
    try { deployed = await triggerDeploy(); } catch (_) {}
  }

  const emailHtml = `
  <div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;color:#2D2D2D">
    <div style="background:#2D2D2D;padding:20px 28px;border-radius:10px 10px 0 0">
      <h2 style="color:#6BBF4E;margin:0;font-size:18px">🔐 iRam IT Portal — Admin Password Changed</h2>
    </div>
    <div style="background:#f9f9f9;padding:28px;border-radius:0 0 10px 10px;border:1px solid #eee">
      <p style="margin:0 0 18px">The iRam IT Admin Portal password has been updated. Store it securely.</p>
      <table style="background:#fff;border:1.5px solid #6BBF4E;border-radius:8px;padding:16px 22px;width:100%;margin:0 0 20px;box-sizing:border-box">
        <tr><td style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:.7px">New Admin Password</td></tr>
        <tr><td style="font-size:22px;font-weight:bold;font-family:monospace;color:#2D2D2D;padding-top:6px;letter-spacing:1px">${newPassword}</td></tr>
      </table>
      ${vercelResult.ok
        ? `<p style="color:#107c10;background:#edf7e8;padding:12px 16px;border-radius:6px;margin:0 0 14px">
             ✅ Vercel environment variable updated automatically.${deployed ? ' Redeployment triggered — new password will be active in approximately 60 seconds.' : ' <strong>Action required:</strong> Go to <a href="https://vercel.com" style="color:#107c10">vercel.com</a>, open your project, and trigger a manual redeploy to activate the new password.'}
           </p>`
        : `<p style="color:#a4262c;background:#fdf0f0;padding:12px 16px;border-radius:6px;margin:0 0 14px">
             ⚠️ Vercel environment was NOT updated automatically (VERCEL_TOKEN not configured). Please log in to <a href="https://vercel.com" style="color:#a4262c">vercel.com</a>, go to your project's Environment Variables, update <strong>ADMIN_PASSWORD</strong> to the value above, then redeploy.
           </p>`
      }
      <p style="color:#888;font-size:12px;margin:0">This is an automated security notification from iRam IT Portal. If you did not make this change, update your password immediately.</p>
    </div>
  </div>`;

  try {
    emailSent = await sendEmail(notifyEmail, 'iRam IT Portal — Admin Password Changed', emailHtml);
  } catch (_) {}

  return res.status(200).json({
    ok: true,
    vercelUpdated:        vercelResult.ok,
    deployed,
    emailSent,
    requiresManualVercel: !vercelResult.ok,
    requiresManualDeploy: vercelResult.ok && !deployed
  });
};
