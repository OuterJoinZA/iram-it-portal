// ──────────────────────────────────────────────────────────────────────────────
// Round-robin assignment across a pool of staff (e.g. everyone checked "IT
// Staff" in Settings). Kept in its OWN Blob file, separate from portal/config.json:
// an admin editing Settings and a ticket being submitted can happen at the same
// moment, and mixing "who's in the pool" (admin-edited) with "whose turn is
// next" (updated on every submission) into one file risks one write clobbering
// the other. Two files, two independent writers, no collision.
//
// Not strictly race-proof under truly concurrent submissions (read-then-write
// is not atomic), but the failure mode is mild — worst case two tickets in a
// row go to the same person — not lost or duplicate assignments. Fine for this
// volume of traffic.
// ──────────────────────────────────────────────────────────────────────────────
const blob = require('./blob.js');

const ROTATION_PATH = 'portal/rotation.json';

async function loadState() {
  if (!blob.isConfigured()) return {};
  try {
    const saved = await blob.getJson(ROTATION_PATH);
    return saved && typeof saved === 'object' ? saved : {};
  } catch (err) {
    console.error('rotation load failed:', err.message);
    return {};
  }
}

async function saveState(state) {
  if (!blob.isConfigured()) return;
  try {
    await blob.putJson(ROTATION_PATH, state);
  } catch (err) {
    console.error('rotation save failed:', err.message);
  }
}

/**
 * Picks the next person in `pool` (array of {name, ...}) for the named
 * rotation, advances the pointer, and persists it. Returns the chosen name,
 * or '' if the pool is empty.
 *
 * If the pool changed since last time (someone added/removed/unchecked) and
 * the last-assigned name is no longer in it, restarts at the beginning rather
 * than erroring — a safe, simple fallback.
 */
async function nextInPool(poolKey, pool) {
  const names = pool.map(p => p.name).filter(Boolean);
  if (!names.length) return '';
  if (names.length === 1) return names[0]; // nothing to rotate

  const state = await loadState();
  // indexOf is -1 when nobody's been assigned yet (or the last person is no
  // longer in the pool) — (-1 + 1) % n = 0, so that case naturally starts the
  // rotation at the beginning without a separate branch.
  const lastIdx = names.indexOf(state[poolKey]);
  const nextIdx = (lastIdx + 1) % names.length;
  const chosen  = names[nextIdx];

  state[poolKey] = chosen;
  await saveState(state);
  return chosen;
}

module.exports = { nextInPool, ROTATION_PATH };
