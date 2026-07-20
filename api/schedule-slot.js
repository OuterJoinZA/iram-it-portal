// Called once from the "iRam IT — Ticket Submit" Power Automate flow, right
// after it fetches a wide window of calendar events (e.g. today through +14
// calendar days). PA already holds the Office 365 Outlook connection and does
// all the actual calendar reads/writes — this endpoint just makes the
// scheduling DECISION (which day, which slot, whether something needs
// bumping, and where the bumped ticket goes instead), using the tested
// day-rolling + bump-cascade logic in lib/scheduler.js, rather than that
// logic being hand-authored as Power Automate expressions/loops.
const { scheduleTicket } = require('../lib/scheduler.js');

function isAuthed(req) {
  const required = process.env.SCHEDULER_API_KEY;
  if (!required) return true; // setup mode — set SCHEDULER_API_KEY once the flow is wired up
  return (req.headers['x-scheduler-key'] || '') === required;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { priority, minutes, events, fromDate, maxDays } = req.body || {};

  if (!priority || !minutes || !fromDate) {
    return res.status(400).json({ error: 'priority, minutes and fromDate are required' });
  }
  if (!Array.isArray(events)) {
    return res.status(400).json({ error: 'events must be an array' });
  }

  let result;
  try {
    result = scheduleTicket(priority, Number(minutes), events, fromDate, maxDays ? Number(maxDays) : undefined);
  } catch (err) {
    console.error('scheduleTicket failed:', err.message);
    return res.status(500).json({ error: 'Scheduling failed', detail: String(err.message || err) });
  }

  if (!result) return res.status(200).json({ found: false });
  return res.status(200).json({ found: true, slot: result.slot, bumped: result.bumped });
};
