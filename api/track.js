// ──────────────────────────────────────────────────────────────────────────────
// Public ticket-tracking proxy.
// GET /api/track?ticket=IT-2026-12345
// Calls the Power Automate "get one ticket by number" flow (URL hidden server-side)
// and returns ONLY public-safe fields — never personal data or internal notes.
// ──────────────────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ticketID = String(req.query.ticket || '').trim().toUpperCase();
  if (!ticketID || !/^IT-\d{4}-\d{3,6}$/.test(ticketID)) {
    return res.status(400).json({ error: 'Please enter a valid ticket number (e.g. IT-2026-12345).' });
  }

  const flowUrl = process.env.PA_TRACK_TICKET_URL;
  if (!flowUrl) {
    // Flow not configured yet — degrade gracefully so the page can show a friendly message.
    return res.status(503).json({ error: 'Ticket tracking is being set up. Please check back soon.' });
  }

  try {
    const r = await fetch(flowUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ticketID })
    });

    if (!r.ok) throw new Error(`Flow returned ${r.status}`);

    const text = await r.text();
    const data = text ? JSON.parse(text) : {};

    // Power Automate may wrap a single item in an array / a `value` array.
    const item = Array.isArray(data) ? data[0]
               : Array.isArray(data.value) ? data.value[0]
               : (data.found === false ? null : data);

    // SharePoint Choice/Lookup/Person columns come back as objects like
    // { Value: "High" } or { DisplayName: "..." }. This flattens them to a
    // plain string so the flow can just return the raw item unchanged.
    const val = v => (v && typeof v === 'object')
      ? (v.Value ?? v.DisplayName ?? v.displayName ?? '')
      : (v ?? '');

    // The ticket number lives in the SharePoint "Title" column.
    if (!item || item.found === false ||
        !(item.ticketID || item.TicketID || item.Title)) {
      return res.status(404).json({ found: false });
    }

    // Whitelist — only ever expose these fields publicly. Accepts either a
    // pre-shaped payload (ticketID/status/…) or a raw SharePoint item.
    return res.status(200).json({
      found:        true,
      ticketID:     item.ticketID ?? item.TicketID ?? item.Title ?? ticketID,
      status:       val(item.status      ?? item.Status)   || 'Open',
      category:     val(item.category    ?? item.Category),
      priority:     val(item.priority    ?? item.Priority),
      submittedAt:  item.submittedAt ?? item.Created  ?? item.submitted ?? '',
      lastUpdated:  item.lastUpdated ?? item.Modified ?? '',
      assignedTo:   val(item.assignedTo  ?? item.AssignedTo),
      publicUpdate: val(item.publicUpdate ?? item.PublicUpdate)
    });
  } catch (err) {
    console.error('Track error:', err.message);
    return res.status(502).json({ error: 'Could not look up that ticket right now. Please try again shortly.' });
  }
};
