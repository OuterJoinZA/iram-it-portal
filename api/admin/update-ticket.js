// ──────────────────────────────────────────────────────────────────────────────
// Admin: update a ticket's Status / Priority / AssignedTo / PublicUpdate / Notes.
// Proxies the Power Automate "update ticket" flow (URL stays server-side).
// ──────────────────────────────────────────────────────────────────────────────
function isAuthed(req) {
  const required = process.env.ADMIN_PASSWORD;
  if (!required) return true;
  return (req.headers['x-admin-key'] || '') === required;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

  const body = req.body || {};
  if (body.id === undefined || body.id === null || body.id === '') {
    return res.status(400).json({ error: 'Missing ticket id' });
  }

  const flowUrl = process.env.PA_UPDATE_TICKET_URL;
  if (!flowUrl) return res.status(503).json({ error: 'not_configured' });

  const payload = {
    id:           body.id,
    Status:       body.Status ?? '',
    Priority:     body.Priority ?? '',
    AssignedTo:   body.AssignedTo ?? '',
    PublicUpdate: body.PublicUpdate ?? '',
    Notes:        body.Notes ?? ''
  };

  try {
    const r = await fetch(flowUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
    if (!r.ok) throw new Error(`Flow returned ${r.status}`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Admin update error:', err.message);
    return res.status(502).json({ error: 'Could not save changes.' });
  }
};
