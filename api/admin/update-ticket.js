// ──────────────────────────────────────────────────────────────────────────────
// Admin: update a ticket's Status / Priority / AssignedTo / PublicUpdate / Notes.
// Also handles rescheduling/canceling a ticket's calendar booking (the flow
// does the actual calendar read/write; estimatedMinutes is recomputed here so
// a reschedule always matches the same duration rules a fresh submission
// would get, without needing to store duration on the ticket at all).
// Proxies the Power Automate "update ticket" flow (URL stays server-side).
// ──────────────────────────────────────────────────────────────────────────────
const { estimateMinutes }  = require('../../assets/duration.js');
const { load: loadConfig } = require('../../lib/portal-config.js');

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

  // calendarAction is 'reschedule' | 'cancel' | absent (routine field-only save).
  // Canceling a booking always closes the ticket too — that's what makes the
  // status-change email below fire automatically, no separate email path needed.
  const calendarAction = body.calendarAction || '';
  const finalStatus = calendarAction === 'cancel' ? 'Closed' : (body.Status ?? '');

  // A ticket getting marked Resolved/Closed via the normal Status dropdown (not
  // the dedicated Cancel Booking button) should ALSO drop its now-pointless
  // calendar booking — otherwise the appointment just sits there orphaned.
  // Status keeps whatever the admin actually picked either way; only the
  // explicit Cancel button forces it to Closed.
  const statusJustResolvedOrClosed = ['Resolved', 'Closed'].includes(finalStatus) && finalStatus !== body.oldStatus;
  const flowAction = calendarAction || (statusJustResolvedOrClosed ? 'cancel' : '');

  // The flow's trigger schema declares this as an integer — must never send ''
  // even when it's unused (e.g. for cancel), or Power Automate's strict Request
  // trigger validation rejects the whole call before the flow even runs.
  let estimatedMinutes = 0;
  if (flowAction === 'reschedule') {
    const { config } = await loadConfig();
    estimatedMinutes = estimateMinutes(body.category, body.description, config);
  }

  const payload = {
    id:               body.id,
    Status:           finalStatus,
    Priority:         body.Priority ?? '',
    AssignedTo:       body.AssignedTo ?? '',
    PublicUpdate:     body.PublicUpdate ?? '',
    Notes:            body.Notes ?? '',
    action:           flowAction,
    ticketID:         body.ticketID ?? '',
    category:         body.category ?? '',
    estimatedMinutes: estimatedMinutes,
    manualStart:      body.manualStart ?? ''
  };

  try {
    const r = await fetch(flowUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
    if (!r.ok) throw new Error(`Flow returned ${r.status}`);
  } catch (err) {
    console.error('Admin update error:', err.message);
    return res.status(502).json({ error: 'Could not save changes.' });
  }

  // Status-change email — best-effort, never lets an email hiccup fail the save
  // (SharePoint is already updated by this point).
  const statusChanged = body.Status && body.oldStatus && body.Status !== body.oldStatus;
  if (statusChanged && body.submitterEmail && process.env.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({
          from:    'iRam IT Support <noreply@outerjoin.co.za>',
          to:      [body.submitterEmail],
          subject: `IT Ticket ${body.ticketID || ''} — Status changed to ${body.Status}`,
          html:    statusChangeHtml({
            submitterName: body.submitterName,
            ticketID:      body.ticketID,
            oldStatus:     body.oldStatus,
            newStatus:     body.Status,
            publicUpdate:  body.PublicUpdate
          })
        })
      });
    } catch (err) {
      console.error('Status-change email error:', err.message);
    }
  }

  return res.status(200).json({ ok: true });
};

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function statusChangeHtml({ submitterName, ticketID, oldStatus, newStatus, publicUpdate }) {
  const statusColor = newStatus === 'Resolved' || newStatus === 'Closed' ? '#4e9938'
    : newStatus === 'In Progress' ? '#986f0b' : '#555';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Segoe UI,Arial,sans-serif;background:#f4f6f8">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">

  <tr><td style="background:#2D2D2D;padding:28px 32px;text-align:center">
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px">iRam IT Support</p>
    <p style="margin:8px 0 0;color:#6BBF4E;font-size:12px;text-transform:uppercase;letter-spacing:1.5px">Ticket Status Update</p>
  </td></tr>

  <tr><td style="background:#edf7e8;padding:24px 32px;text-align:center;border-bottom:2px solid #6BBF4E">
    <p style="margin:0 0 6px;color:#555;font-size:12px;text-transform:uppercase;letter-spacing:1px">Ticket ${esc(ticketID)} is now</p>
    <p style="margin:0;font-size:28px;font-weight:700;color:${statusColor}">${esc(newStatus)}</p>
    <p style="margin:8px 0 0;color:#888;font-size:12px">Previously: ${esc(oldStatus)}</p>
  </td></tr>

  <tr><td style="padding:28px 32px">
    <p style="margin:0 0 16px;font-size:15px;color:#333">Hi <strong>${esc(submitterName || 'there')}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.7">The status of your IT support ticket has been updated.</p>
    ${publicUpdate ? `<div style="border:1px solid #e8e8e8;border-radius:8px;padding:16px;font-size:14px;color:#444;line-height:1.6;background:#f9f9f9">${esc(publicUpdate).replace(/\n/g,'<br>')}</div>` : ''}
  </td></tr>

  <tr><td style="background:#f4f6f8;padding:18px 32px;text-align:center;border-top:1px solid #e8e8e8">
    <p style="margin:0;color:#aaa;font-size:11px">iRam IT Support Portal &nbsp;|&nbsp; Quote ${esc(ticketID)} for all follow-up queries</p>
  </td></tr>

</table></td></tr></table>
</body></html>`;
}
