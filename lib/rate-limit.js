// ──────────────────────────────────────────────────────────────────────────────
// Login attempt tracking / lockout, backed by the same Vercel Blob store used
// everywhere else in this repo (lib/blob.js) — one JSON file, pruned lazily.
//
// Known limitation: two near-simultaneous requests can both read the same
// pre-increment state and each write back independently, undercounting by one
// attempt. Not perfectly race-free, but this is a small internal team's login
// endpoint, not a high-traffic target — acceptable trade-off for zero added
// infrastructure (no Redis/KV needed).
// ──────────────────────────────────────────────────────────────────────────────
const { getJson, putJson } = require('./blob');

const PATH          = 'admin/login-attempts.json';
const MAX_ATTEMPTS  = 5;
const WINDOW_MS      = 15 * 60 * 1000; // count failures within this window
const LOCKOUT_MS     = 15 * 60 * 1000; // then lock out for this long
const PRUNE_AGE_MS   = 60 * 60 * 1000; // drop entries idle longer than this

async function load() {
  const data = await getJson(PATH);
  return data && typeof data === 'object' ? data : {};
}

function prune(table) {
  const now = Date.now();
  for (const key of Object.keys(table)) {
    const e = table[key];
    if (now - e.lastAttempt > PRUNE_AGE_MS && (!e.lockedUntil || e.lockedUntil < now)) delete table[key];
  }
  return table;
}

/** Call before verifying credentials. Returns { locked, retryAfterMs }. */
async function checkLocked(key) {
  const table = await load();
  const e = table[key];
  if (e && e.lockedUntil && e.lockedUntil > Date.now()) {
    return { locked: true, retryAfterMs: e.lockedUntil - Date.now() };
  }
  return { locked: false, retryAfterMs: 0 };
}

/** Call after a failed credential check. */
async function recordFailure(key) {
  const table = prune(await load());
  const now = Date.now();
  const e = table[key] || { count: 0, firstAttempt: now, lastAttempt: now, lockedUntil: 0 };

  if (now - e.firstAttempt > WINDOW_MS) {
    e.count = 0;
    e.firstAttempt = now;
  }
  e.count += 1;
  e.lastAttempt = now;
  if (e.count >= MAX_ATTEMPTS) {
    e.lockedUntil = now + LOCKOUT_MS;
    e.count = 0;
    e.firstAttempt = now;
  }

  table[key] = e;
  await putJson(PATH, table);
}

/** Call after a successful login to clear any accumulated failures. */
async function recordSuccess(key) {
  const table = await load();
  if (table[key]) {
    delete table[key];
    await putJson(PATH, table);
  }
}

module.exports = { checkLocked, recordFailure, recordSuccess };
