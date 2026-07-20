// Called from the "iRam IT — Ticket Submit" Power Automate flow (Switch branch),
// once per candidate day, until a slot is found. PA already holds the Office 365
// Outlook connection and does the actual calendar reads/writes — this endpoint
// only makes the scheduling DECISION, using the tested logic in lib/scheduler.js,
// rather than that logic being hand-authored as Power Automate expressions.
const { scheduleForDay } = require('../lib/scheduler.js');

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

  const { priority, minutes, events, windowStart, windowEnd } = req.body || {};

  if (!priority || !minutes || !windowStart || !windowEnd) {
    return res.status(400).json({ error: 'priority, minutes, windowStart and windowEnd are required' });
  }
  if (!Array.isArray(events)) {
    return res.status(400).json({ error: 'events must be an array' });
  }

  let result;
  try {
    result = scheduleForDay(priority, Number(minutes), events, windowStart, windowEnd);
  } catch (err) {
    console.error('scheduleForDay failed:', err.message);
    return res.status(500).json({ error: 'Scheduling failed', detail: String(err.message || err) });
  }

  if (!result) return res.status(200).json({ found: false });
  return res.status(200).json({ found: true, slot: result.slot, bumped: result.bumped });
};
