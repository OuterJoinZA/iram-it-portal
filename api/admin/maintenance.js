// Admin: get or toggle site maintenance mode (MAINTENANCE_MODE env var).
const VERCEL_API = 'https://api.vercel.com';

function isAuthed(req) {
  const required = process.env.ADMIN_PASSWORD;
  if (!required) return true;
  return (req.headers['x-admin-key'] || '') === required;
}

async function updateVercelEnv(key, value) {
  const token = process.env.VERCEL_TOKEN, projectId = process.env.VERCEL_PROJECT_ID, teamId = process.env.VERCEL_TEAM_ID;
  if (!token || !projectId) return { ok: false, reason: 'no_token' };
  const qs = teamId ? `?teamId=${teamId}` : '';
  const list = await fetch(`${VERCEL_API}/v9/projects/${projectId}/env${qs}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!list.ok) return { ok: false, reason: 'list_failed' };
  const { envs = [] } = await list.json();
  const existing = envs.find(e => e.key === key);
  if (existing) {
    const r = await fetch(`${VERCEL_API}/v9/projects/${projectId}/env/${existing.id}${qs}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value })
    });
    return r.ok ? { ok: true } : { ok: false, reason: 'patch_failed' };
  } else {
    const r = await fetch(`${VERCEL_API}/v9/projects/${projectId}/env${qs}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, type: 'plain', target: ['production'] })
    });
    return r.ok ? { ok: true, created: true } : { ok: false, reason: 'create_failed' };
  }
}

async function triggerDeploy() {
  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hookUrl) return false;
  try { const r = await fetch(hookUrl, { method: 'GET' }); return r.ok; } catch (_) { return false; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const v = process.env.MAINTENANCE_MODE || '';
    return res.status(200).json({
      maintenance: v === '1' || v.toLowerCase() === 'true',
      vercelReady: !!(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID)
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { maintenance } = req.body || {};
  if (typeof maintenance !== 'boolean') return res.status(400).json({ error: 'maintenance must be true or false.' });

  let vercelResult = { ok: false, reason: 'no_token' }, deployed = false;
  try { vercelResult = await updateVercelEnv('MAINTENANCE_MODE', maintenance ? '1' : '0'); } catch (_) {}
  if (vercelResult.ok) { try { deployed = await triggerDeploy(); } catch (_) {} }

  return res.status(200).json({
    ok: true, maintenance, vercelUpdated: vercelResult.ok, deployed,
    requiresManualVercel: !vercelResult.ok, requiresManualDeploy: vercelResult.ok && !deployed
  });
};
