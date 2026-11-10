// ──────────────────────────────────────────────────────────────────────────────
// Keeps the SharePoint ticket row of a starter / leaver request in step with
// the request's own status (server-side, so it works for every tech — IT and
// the Perigee Support Admin — and for automatic completion).
//
// Uses the same Power Automate flows as the IT dashboard:
//   PA_GET_TICKETS_URL   → find the row (id + current fields) by ticket number
//   PA_UPDATE_TICKET_URL → write the status; Resolved / Closed also cancels the
//                          calendar booking (action 'cancel'), exactly like
//                          api/admin/update-ticket.js does.
// The update flow overwrites Priority / AssignedTo / PublicUpdate / Notes, so
// the row's current values are always sent back unchanged.
// Best-effort: returns { ok, reason } and never throws.
// ──────────────────────────────────────────────────────────────────────────────
const spVal = v => (v && typeof v === 'object' && !Array.isArray(v)) ? (v.Value ?? v.DisplayName ?? '') : (v ?? '');

async function withTimeout(ms, fn) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { return await fn(ctl.signal); } finally { clearTimeout(t); }
}

/** SharePoint row for a ticket number, or null. */
async function findRow(ticketID) {
  const url = process.env.PA_GET_TICKETS_URL;
  if (!url) return null;
  const list = await withTimeout(25000, async signal => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal });
    if (!r.ok) throw new Error(`ticket list flow returned ${r.status}`);
    const text = await r.text();
    const d = text ? JSON.parse(text) : [];
    return Array.isArray(d) ? d : (d.value || []);
  });
  const t = list.find(x => (x.TicketID ?? x.Title ?? x.ticketID) === ticketID);
  if (!t) return null;
  return { id: t.id ?? t.ID ?? t.ItemInternalId, Status: spVal(t.Status), Priority: spVal(t.Priority), AssignedTo: spVal(t.AssignedTo),
    PublicUpdate: t.PublicUpdate || '', Notes: t.Notes || '', Category: spVal(t.Category) };
}

/**
 * Sets the SharePoint status. `row` (optional) = the row's current fields, if
 * the caller already has them (IT's queue page does), to skip the lookup.
 */
async function syncStatus({ ticketID, status, oldStatus, row }) {
  try {
    const url = process.env.PA_UPDATE_TICKET_URL;
    if (!url) return { ok: false, reason: 'SharePoint update flow not configured' };
    const sp = row && row.id !== undefined && row.id !== '' ? row : await findRow(ticketID);
    if (!sp) return { ok: false, reason: 'ticket not found in SharePoint yet' };
    if (sp.Status === status) return { ok: true, unchanged: true };
    const closing = ['Resolved', 'Closed'].includes(status) && !['Resolved', 'Closed'].includes(sp.Status || oldStatus);
    await withTimeout(25000, async signal => {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify({
        id: sp.id, Status: status, Priority: sp.Priority || '', AssignedTo: sp.AssignedTo || '', PublicUpdate: sp.PublicUpdate || '', Notes: sp.Notes || '',
        action: closing ? 'cancel' : '', ticketID, category: sp.Category || '', estimatedMinutes: 0, manualStart: ''
      }) });
      if (!r.ok) throw new Error(`update flow returned ${r.status}`);
    });
    return { ok: true, bookingCancelled: closing };
  } catch (err) {
    console.error('sp-sync:', err.message);
    return { ok: false, reason: err.name === 'AbortError' ? 'SharePoint timed out' : err.message };
  }
}

module.exports = { syncStatus, findRow };
