// ─────────────────────────────────────────────────────────────────────────────
// Admin: change the HR manager access code (MANAGER_PASSWORD env var).
// - Gated by admin key (x-admin-key header).
// - If VERCEL_TOKEN + VERCEL_PROJECT_ID are set, updates the env var in Vercel.
// - If VERCEL_DEPLOY_HOOK_URL is set, triggers a redeployment.
// - Sends the new code via Resend to the supplied hrEmail.
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

  const { newCode, confirmCode, hrEmail } = req.body || {};

  if (!newCode || newCode.length < 4) {
    return res.status(400).json({ error: 'Access code must be at least 4 characters.' });
  }
  if (newCode !== confirmCode) {
    return res.status(400).json({ error: 'Access codes do not match.' });
  }
  if (!hrEmail) {
    return res.status(400).json({ error: 'An HR email address is required.' });
  }

  let vercelResult = { ok: false, reason: 'no_token' };
  let deployed     = false;
  let emailSent    = false;

  try { vercelResult = await updateVercelEnv('MANAGER_PASSWORD', newCode); } catch (_) {}
  if (vercelResult.ok) {
    try { deployed = await triggerDeploy(); } catch (_) {}
  }

  const emailHtml = `
  <div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;color:#2D2D2D">
    <div style="background:#2D2D2D;padding:20px 28px;border-radius:10px 10px 0 0">
      <h2 style="color:#6BBF4E;margin:0;font-size:18px">🔒 iRam HR Portal — Manager Access Code Changed</h2>
    </div>
    <div style="background:#f9f9f9;padding:28px;border-radius:0 0 10px 10px;border:1px solid #eee">
      <p style="margin:0 0 18px">The Manager Access Code for the iRam HR Portal has been updated. Share this code only with Managers and above.</p>
      <table style="background:#fff;border:1.5px solid #6BBF4E;border-radius:8px;padding:16px 22px;width:100%;margin:0 0 20px;box-sizing:border-box">
        <tr><td style="color:#888;font-size:11px;text-transform:uppercase;letter-spacing:.7px">New Manager Access Code</td></tr>
        <tr><td style="font-size:26px;font-weight:bold;font-family:monospace;color:#2D2D2D;padding-top:6px;letter-spacing:2px">${newCode}</td></tr>
      </table>
      <p style="color:#555;margin:0 0 14px">Managers access the senior staff forms at <strong>iram-it-portal.vercel.app/hr</strong> by clicking "Enter Access Code" in the Senior Staff section.</p>
      ${vercelResult.ok
        ? `<p style="color:#107c10;background:#edf7e8;padding:12px 16px;border-radius:6px;margin:0 0 14px">
             ✅ Vercel environment variable updated automatically.${deployed ? ' Redeployment triggered — new code will be active in approximately 60 seconds.' : ' <strong>Action required:</strong> Go to <a href="https://vercel.com" style="color:#107c10">vercel.com</a> and trigger a manual redeploy to activate the new code.'}
           </p>`
        : `<p style="color:#a4262c;background:#fdf0f0;padding:12px 16px;border-radius:6px;margin:0 0 14px">
             ⚠️ Vercel environment was NOT updated automatically (VERCEL_TOKEN not configured). Please log in to <a href="https://vercel.com" style="color:#a4262c">vercel.com</a>, go to Environment Variables, update <strong>MANAGER_PASSWORD</strong> to the value above, then redeploy.
           </p>`
      }
      <p style="color:#888;font-size:12px;margin:0">Sent by iRam IT Portal. If you did not request this change, contact IT Support immediately.</p>
    </div>
  </div>`;

  try {
    emailSent = await sendEmail(hrEmail, 'iRam HR Portal — Manager Access Code Changed', emailHtml);
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
