// ──────────────────────────────────────────────────────────────────────────────
// Reads the iRam Org Builder (OrgBuilderV2, iram-org-builder-v2) data so the
// Access Summary can see who is REFERENCED there by email — the org tree
// (people placed in the structure) and the call cycle — not just who has an
// account somewhere.
//
// Org Builder keeps its state in Supabase table `iram_org_state` (rows
// 'main' = org tree nodes, 'callcycle' = { rows, meta }, 'perigee' = its
// Perigee export), AES-GCM encrypted in the browser (src/utils/crypto.js:
// PBKDF2-SHA256 50 000 rounds, salt "iram-v1", 12-byte IV first, tag last).
// Connection details come from Vercel env vars (never committed here):
//   ORG_SUPABASE_URL       Org Builder's Supabase project URL
//   ORG_SUPABASE_ANON_KEY  its anon key      (src/utils/supabaseClient.js)
//   ORG_ENC_SECRET         its ENC_SECRET    (src/utils/crypto.js)
// Without them the connector reports "not set up" and the Access Summary
// falls back to an uploaded Org Builder export.
// Read-only — nothing here writes to Org Builder.
// ──────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');

const URL_ = () => String(process.env.ORG_SUPABASE_URL || '').replace(/\/+$/, '');
const KEY_ = () => process.env.ORG_SUPABASE_ANON_KEY || '';
const SECRET_ = () => process.env.ORG_ENC_SECRET || '';
const configured = () => !!(URL_() && KEY_() && SECRET_());

let keyCache = null;
function key() {
  if (!keyCache) keyCache = crypto.pbkdf2Sync(SECRET_(), 'iram-v1', 50000, 32, 'sha256');
  return keyCache;
}
function decrypt(b64) {
  if (typeof b64 !== 'string') return b64; // older rows were stored as plain JSON
  try {
    const raw = Buffer.from(b64, 'base64');
    const iv = raw.subarray(0, 12), tag = raw.subarray(raw.length - 16), ct = raw.subarray(12, raw.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8'));
  } catch (_) { return null; }
}

const ROLE_LABEL = { REGIONAL_MANAGER: 'Regional Manager', CHANNEL_HEAD: 'Channel Head', AREA_MANAGER: 'Area Manager', TEAM_LEADER: 'Team Leader', MEMBER: 'Member' };
const low = v => String(v || '').trim().toLowerCase();

/** { ok, updatedAt, org:{users}, callcycle:{users, meta}, perigee:{users} } in the
 *  same { users:[{name, first, last, email, username, active, role, team}] }
 *  shape as uploaded lists (lib/fg-directory.js). Never throws. */
async function load() {
  if (!configured()) return { ok: false, error: 'not set up — add ORG_SUPABASE_URL, ORG_SUPABASE_ANON_KEY and ORG_ENC_SECRET in Vercel (or upload an Org Builder export on the Sites page)' };
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(`${URL_()}/rest/v1/iram_org_state?select=id,nodes,updated_at&id=in.(main,callcycle,perigee)`, {
      headers: { apikey: KEY_(), Authorization: `Bearer ${KEY_()}` }, signal: ctl.signal
    }).finally(() => clearTimeout(t));
    if (!r.ok) return { ok: false, error: `Org Builder returned ${r.status}` };
    const rows = Object.fromEntries((await r.json()).map(x => [x.id, x]));
    const out = { ok: true };
    const main = rows.main && decrypt(rows.main.nodes);
    if (Array.isArray(main)) {
      out.org = { uploadedAt: rows.main.updated_at, users: main.filter(n => n && n.roleType !== 'TEAM_GROUP' && (n.email || n.firstName || n.lastName)).map(n => ({
        name: [n.firstName, n.lastName].filter(Boolean).join(' '), first: n.firstName || '', last: n.lastName || '',
        email: low(n.email), username: '', mobile: '', active: !n.resigned,
        role: n.jobTitle || ROLE_LABEL[n.roleType] || '', team: [n.teamName, n.assignedProvinces].filter(Boolean).join(' · '),
        note: n.resigned ? `marked resigned${n.resignedDate ? ' ' + n.resignedDate : ''}` : ''
      })) };
      out.org.count = out.org.users.length;
    } else if (rows.main) out.orgError = 'could not read the org tree (encryption key changed?)';
    const cc = rows.callcycle && decrypt(rows.callcycle.nodes);
    if (cc && Array.isArray(cc.rows)) {
      out.callcycle = { uploadedAt: (cc.meta && cc.meta.loadedAt) || rows.callcycle.updated_at, users: cc.rows.filter(x => x && x.email).map(x => ({
        name: [x.firstName, x.lastName].filter(Boolean).join(' '), first: x.firstName || '', last: x.lastName || '',
        email: low(x.email), username: '', mobile: '', active: !/inactive|disabled|deactivated|resigned/i.test(x.status || ''), role: '', team: x.teamName || ''
      })) };
      out.callcycle.count = out.callcycle.users.length;
    }
    const pg = rows.perigee && decrypt(rows.perigee.nodes);
    if (Array.isArray(pg)) {
      out.perigee = { uploadedAt: rows.perigee.updated_at, users: pg.filter(x => x && x.email).map(x => ({
        name: [x.firstName, x.lastName].filter(Boolean).join(' '), first: x.firstName || '', last: x.lastName || '',
        email: low(x.email), username: low(x.email), mobile: '', active: !/inactive|disabled|deactivated|suspend/i.test(x.status || ''), role: x.access || '', team: ''
      })) };
      out.perigee.count = out.perigee.users.length;
    }
    return out;
  } catch (err) {
    return { ok: false, error: err.name === 'AbortError' ? 'Org Builder timed out' : String(err.message || err) };
  }
}

module.exports = { load, decrypt, configured };
