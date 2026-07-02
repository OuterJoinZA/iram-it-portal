// Triggers a Vercel redeploy so all polling clients detect the version change
// and auto-refresh within ~80 seconds.

function isAuthed(req) {
  const required = process.env.ADMIN_PASSWORD;
  if (!required) return true;
  return (req.headers['x-admin-key'] || '') === required;
}

async function triggerDeploy() {
  const hookUrl = process.env.VERCEL_DEPLOY_HOOK_URL;
  if (!hookUrl) return { ok: false, reason: 'no_hook' };
  try {
    const r = await fetch(hookUrl, { method: 'GET' });
    return r.ok ? { ok: true } : { ok: false, reason: 'hook_failed' };
  } catch (_) { return { ok: false, reason: 'network_error' }; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

  const result = await triggerDeploy();
  return res.status(200).json({
    ok: true,
    deployed: result.ok,
    requiresManualDeploy: !result.ok,
    reason: result.reason
  });
};
