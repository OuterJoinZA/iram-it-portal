// Admin: get or update the bot mode (BOT_MODE env var).
// GET  — returns current mode + AI availability
// POST — updates BOT_MODE via Vercel API (same pattern as change-password.js)

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
    const up = await fetch(`${VERCEL_API}/v9/projects/${projectId}/env/${existing.id}${qs}`, {
      method:  'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ value })
    });
    return up.ok ? { ok: true } : { ok: false, reason: 'patch_failed' };
  } else {
    const cr = await fetch(`${VERCEL_API}/v9/projects/${projectId}/env${qs}`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ key, value, type: 'plain', target: ['production'] })
    });
    return cr.ok ? { ok: true, created: true } : { ok: false, reason: 'create_failed' };
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

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

  // GET — return current settings
  if (req.method === 'GET') {
    return res.status(200).json({
      mode:        process.env.BOT_MODE || 'rules',
      aiAvailable: !!(process.env.ANTHROPIC_API_KEY),
      vercelReady: !!(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID)
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { mode } = req.body || {};
  if (!mode || !['rules', 'ai'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be "rules" or "ai".' });
  }

  if (mode === 'ai' && !process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'Cannot enable AI mode: ANTHROPIC_API_KEY is not set in Vercel.' });
  }

  let vercelResult = { ok: false, reason: 'no_token' };
  let deployed     = false;

  try { vercelResult = await updateVercelEnv('BOT_MODE', mode); } catch (_) {}
  if (vercelResult.ok) {
    try { deployed = await triggerDeploy(); } catch (_) {}
  }

  return res.status(200).json({
    ok: true,
    mode,
    vercelUpdated:        vercelResult.ok,
    deployed,
    requiresManualVercel: !vercelResult.ok,
    requiresManualDeploy: vercelResult.ok && !deployed
  });
};
