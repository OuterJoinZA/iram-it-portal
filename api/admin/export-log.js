// ──────────────────────────────────────────────────────────────────────────────
// Admin: monthly "completed tickets" Excel export log.
//
// At the start of each month the admin panel forces whoever logs in first to
// export LAST month's resolved/closed tickets. Once ONE admin has done it, it's
// recorded here (shared across everyone, in Blob) and the export goes back to
// being optional for the rest of the month.
//
// GET  → { storageReady, due: "YYYY-MM", done, record, log }
// POST { period: "YYYY-MM", count } → marks that month as exported, recorded
//      against the logged-in user (taken from the session, not the request body)
//
// Months are worked out in SAST (UTC+2, no DST) so "the 1st" means the 1st in
// South Africa, not UTC midnight.
// ──────────────────────────────────────────────────────────────────────────────
const blob            = require('../../lib/blob.js');
const { requireRole } = require('../../lib/require-role');

const LOG_PATH = 'exports/monthly-log.json';
const SAST_MS  = 2 * 60 * 60 * 1000;

/** The month that must be exported now: the previous calendar month in SAST. */
function duePeriod(now = Date.now()) {
  const d = new Date(now + SAST_MS);
  let y = d.getUTCFullYear(), m = d.getUTCMonth(); // m is 0-based → previous month is 1-based m
  if (m === 0) { y -= 1; m = 12; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

async function loadLog() {
  try { return (await blob.getJson(LOG_PATH)) || {}; }
  catch (err) { console.error('export-log load failed:', err.message); return {}; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const user = requireRole(req, 'manageTickets');
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const storageReady = blob.isConfigured();
  const due          = duePeriod();

  if (req.method === 'GET') {
    // Without storage there's nowhere to record "done", so never force — the
    // panel shows a warning instead of nagging every admin on every login.
    if (!storageReady) return res.status(200).json({ storageReady, due, done: true, record: null, log: {} });
    const log = await loadLog();
    return res.status(200).json({ storageReady, due, done: !!log[due], record: log[due] || null, log });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!storageReady) return res.status(503).json({ error: 'storage_not_configured' });

  const { period, count } = req.body || {};
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(period || ''))) {
    return res.status(400).json({ error: 'period must be YYYY-MM' });
  }

  try {
    const log = await loadLog();
    // Keep the FIRST completion of a month as the record of who satisfied the
    // requirement; later optional re-exports don't overwrite it.
    if (!log[period]) {
      log[period] = {
        exportedAt: new Date().toISOString(),
        count:      Math.max(0, Math.round(Number(count) || 0)),
        by:         String(user.username || '').slice(0, 80)
      };
      await blob.putJson(LOG_PATH, log);
    }
    return res.status(200).json({ ok: true, due, done: !!log[due], record: log[period] });
  } catch (err) {
    console.error('export-log save failed:', err.message);
    return res.status(502).json({ error: 'Could not record the export.', detail: String(err.message || err) });
  }
};
