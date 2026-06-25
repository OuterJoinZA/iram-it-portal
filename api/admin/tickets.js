// ──────────────────────────────────────────────────────────────────────────────
// Admin: list all tickets. Proxies the Power Automate "get all tickets" flow so
// the flow URL stays server-side. Gated by the admin key (see isAuthed).
// ──────────────────────────────────────────────────────────────────────────────
function isAuthed(req) {
  const required = process.env.ADMIN_PASSWORD;
  if (!required) return true; // not configured yet → setup mode, don't block
  return (req.headers['x-admin-key'] || '') === required;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

  const flowUrl = process.env.PA_GET_TICKETS_URL;
  if (!flowUrl) return res.status(503).json({ error: 'not_configured' });

  try {
    const r = await fetch(flowUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({})
    });
    if (!r.ok) throw new Error(`Flow returned ${r.status}`);
    const text = await r.text();
    const data = text ? JSON.parse(text) : [];
    const list = Array.isArray(data) ? data : (Array.isArray(data.value) ? data.value : []);
    return res.status(200).json(list);
  } catch (err) {
    console.error('Admin tickets error:', err.message);
    return res.status(502).json({ error: 'Could not load tickets.' });
  }
};
