// Called from the "iRam IT — Update Ticket" Power Automate flow when an admin
// reschedules or cancels a ticket's calendar booking. Same pattern as
// /api/schedule-slot: PA fetches a wide window of calendar events and does the
// actual calendar reads/writes, this endpoint just makes the decision — where
// (if rescheduling, reusing the same bump-aware logic tickets get on
// submission) or whether (if canceling) to touch the calendar, and which
// existing event (if any) needs to change.
const { scheduleTicket, buildEventSubject, parseEventSubject } = require('../../lib/scheduler.js');

function isAuthed(req) {
  const required = process.env.ADMIN_PASSWORD;
  if (!required) return true;
  return (req.headers['x-admin-key'] || '') === required;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, ticketID, category, priority, minutes, events, fromDate, maxDays } = req.body || {};

  if (!action || !ticketID || !fromDate) {
    return res.status(400).json({ error: 'action, ticketID and fromDate are required' });
  }
  if (!Array.isArray(events)) {
    return res.status(400).json({ error: 'events must be an array' });
  }

  const existing = events.find(e => parseEventSubject(e.subject)?.ticketID === ticketID);

  if (action === 'cancel') {
    if (!existing) return res.status(200).json({ action: 'cancel', found: false });
    return res.status(200).json({ action: 'cancel', found: true, eventId: existing.id });
  }

  if (action === 'reschedule') {
    if (!category || !priority || !minutes) {
      return res.status(400).json({ error: 'category, priority and minutes are required to reschedule' });
    }

    // Exclude the ticket's own current booking from the busy list — it's the
    // one being moved, so it shouldn't block or need to bump itself.
    const otherEvents = events.filter(e => e !== existing);

    let result;
    try {
      result = scheduleTicket(priority, Number(minutes), otherEvents, fromDate, maxDays ? Number(maxDays) : undefined);
    } catch (err) {
      console.error('scheduleTicket failed:', err.message);
      return res.status(500).json({ error: 'Scheduling failed', detail: String(err.message || err) });
    }

    if (!result) return res.status(200).json({ action: 'reschedule', found: false });

    return res.status(200).json({
      action: 'reschedule',
      found: true,
      existingEventId: existing ? existing.id : null,
      slot: result.slot,
      bumped: result.bumped,
      subject: buildEventSubject(ticketID, category, priority),
      body: existing ? existing.body : null
    });
  }

  return res.status(400).json({ error: `Unknown action '${action}'` });
};
