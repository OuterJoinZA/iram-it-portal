// ──────────────────────────────────────────────────────────────────────────────
// Admin: list all tickets. Proxies the Power Automate "get all tickets" flow so
// the flow URL stays server-side. Gated by the admin key (see isAuthed).
// ──────────────────────────────────────────────────────────────────────────────
function isAuthed(req) {
  const required = process.env.ADMIN_PASSWORD;
  if (!required) return true; // not configured yet → setup mode, don't block
  return (req.headers['x-admin-key'] || '') === required;
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

  const flowUrl = process.env.PA_GET_TICKETS_URL;
  if (!flowUrl) return res.status(503).json({ error: 'not_configured' });

  const controller = new AbortController();
  // Give the flow room up to just under the function's maxDuration (see config
  // at the bottom) so a genuinely slow flow returns a clean 504 instead of the
  // platform dropping the connection mid-call.
  const timeout    = setTimeout(() => controller.abort(), 55000); // 55s, under the 60s maxDuration

  try {
    const r = await fetch(flowUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({}),
      signal:  controller.signal
    });
    clearTimeout(timeout);
    if (!r.ok) {
      // Flow was reached but returned an error. Surface its status so the
      // admin panel can show it (401/403 = expired flow URL, 5xx = flow step
      // error, 404 = flow turned off/deleted).
      const body = await r.text().catch(() => '');
      console.error('Admin tickets: flow returned', r.status, body.slice(0, 500));
      return res.status(502).json({ error: 'flow_error', flowStatus: r.status });
    }
    const text = await r.text();
    const data = text ? JSON.parse(text) : [];
    const list = Array.isArray(data) ? data : (Array.isArray(data.value) ? data.value : []);
    return res.status(200).json(list);
  } catch (err) {
    clearTimeout(timeout);
    const timedOut = err.name === 'AbortError';
    console.error('Admin tickets error:', timedOut ? 'timed out after 55s' : err.message);
    return res.status(timedOut ? 504 : 502)
      .json({ error: timedOut ? 'flow_timeout' : 'flow_unreachable', detail: String(err.message || err) });
  }
}

module.exports = handler;
// Vercel Pro allows raising this above the 15s default. The SharePoint flow can
// be slow on first call; 60s stops the platform cutting it off mid-request.
// Still optimise the flow (Filter Query / Top Count / select columns) to keep
// the real load time low — this is a ceiling, not a target.
module.exports.config = { maxDuration: 60 };
