// ──────────────────────────────────────────────────────────────────────────────
// Microsoft 365 user directory — synced from Microsoft Graph so new-starter
// requests can be cross-checked (email already taken? person already has an
// account? same person in another open request?).
//
// Setup (once): an Entra ID (Azure AD) app registration with the APPLICATION
// permission User.Read.All (admin-consented) and a client secret, then these
// Vercel env vars: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET.
//
// Synced nightly by the Vercel cron (api/admin/directory.js) and on demand
// ("Sync now"). Only what the checks need is stored: name, sign-in/email
// addresses, mobile, enabled — in Blob at directory/ms365.json.
// ──────────────────────────────────────────────────────────────────────────────
const blob = require('./blob.js');

const PATH = 'directory/ms365.json';
const STATUS_PATH = 'directory/ms365-status.json';
const STALE_HOURS = 36; // a nightly sync that's missed more than once → warn

const env = () => ({ tenant: process.env.MS_TENANT_ID, id: process.env.MS_CLIENT_ID, secret: process.env.MS_CLIENT_SECRET });
const isConfigured = () => { const e = env(); return !!(e.tenant && e.id && e.secret); };

const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
const nameKey = (f, l) => `${slug(f)}|${slug(l)}`;

function normaliseMobile(v) {
  let d = String(v || '').replace(/[\s()\-.]/g, '');
  if (/^00/.test(d)) d = '+' + d.slice(2);
  if (/^0\d{9}$/.test(d)) d = '+27' + d.slice(1);
  else if (/^27\d{9}$/.test(d)) d = '+' + d;
  return /^\+\d{9,15}$/.test(d) ? d : '';
}

async function token() {
  const e = env();
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(e.tenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: e.id, client_secret: e.secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`Microsoft sign-in failed: ${d.error_description || d.error || r.status}`.slice(0, 300));
  return d.access_token;
}

/** Pulls every user from Graph and stores the compact directory. */
async function sync(by = 'schedule') {
  const started = new Date().toISOString();
  try {
    if (!isConfigured()) throw new Error('Not connected — set MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET in Vercel.');
    const t = await token();
    let url = 'https://graph.microsoft.com/v1.0/users?$select=displayName,givenName,surname,userPrincipalName,mail,proxyAddresses,mobilePhone,accountEnabled&$top=999';
    const users = [];
    for (let page = 0; url && page < 50; page++) {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Microsoft Graph error ${r.status}: ${(d.error && d.error.message) || ''}`.slice(0, 300));
      for (const u of d.value || []) {
        const addrs = new Set([u.userPrincipalName, u.mail, ...(u.proxyAddresses || []).map(a => String(a).replace(/^smtp:/i, ''))]
          .filter(Boolean).map(a => String(a).toLowerCase()));
        users.push({
          name: u.displayName || '', first: u.givenName || '', last: u.surname || '',
          upn: String(u.userPrincipalName || '').toLowerCase(), addrs: [...addrs],
          mobile: normaliseMobile(u.mobilePhone), enabled: u.accountEnabled !== false
        });
      }
      url = d['@odata.nextLink'] || '';
    }
    const data = { syncedAt: new Date().toISOString(), count: users.length, users };
    await blob.putJson(PATH, data);
    const status = { ok: true, lastSuccess: data.syncedAt, lastAttempt: started, count: users.length, by, error: '' };
    await blob.putJson(STATUS_PATH, status);
    return status;
  } catch (err) {
    const prev = (await blob.getJson(STATUS_PATH).catch(() => null)) || {};
    const status = { ...prev, ok: false, lastAttempt: started, by, error: String(err.message || err).slice(0, 300) };
    await blob.putJson(STATUS_PATH, status).catch(() => {});
    return status;
  }
}

async function load() { return (await blob.getJson(PATH).catch(() => null)) || null; }

/** { configured, ok, lastSuccess, count, error, stale, ageHours } */
async function status() {
  const s = (await blob.getJson(STATUS_PATH).catch(() => null)) || {};
  const ageHours = s.lastSuccess ? (Date.now() - new Date(s.lastSuccess).getTime()) / 3600000 : null;
  return {
    configured: isConfigured(), ok: !!s.ok, lastSuccess: s.lastSuccess || null, lastAttempt: s.lastAttempt || null,
    count: s.count || 0, error: s.error || '', ageHours,
    stale: isConfigured() && (ageHours === null || ageHours > STALE_HOURS || s.ok === false)
  };
}

/** Candidate sign-in addresses for a person, best first. */
function upnCandidates(p, domain) {
  const f = slug(p.firstName), l = slug(p.lastName);
  if (!f || !l) return [];
  const mids = String(p.middleNames || '').split(/\s+/).map(slug).filter(Boolean);
  const list = [`${f}.${l}`];
  mids.forEach(m => list.push(`${f}.${m[0]}.${l}`));
  if (mids.length > 1) list.push(`${f}.${mids.map(m => m[0]).join('')}.${l}`);
  list.push(`${f[0]}.${l}`, `${f}${l}`);
  for (let n = 2; n <= 9; n++) list.push(`${f}.${l}${n}`);
  return [...new Set(list)].map(x => `${x}@${domain}`);
}

/**
 * Cross-checks one person. `dir` = load() result (or null), `openPeople` =
 * [{ ticketID, index, firstName, lastName, cellphone, personalEmail }] from
 * other active requests.
 */
function checkPerson(p, dir, openPeople, { domain = 'iram.co.za', wantedEmail = '' } = {}) {
  const out = { directory: dir ? { syncedAt: dir.syncedAt, count: dir.count } : null, email: null, existing: [], duplicates: [] };
  const users = (dir && dir.users) || [];
  const taken = addr => users.find(u => u.addrs.includes(String(addr).toLowerCase()));

  // 1. Is the email they'd get free?
  const cands = upnCandidates(p, domain);
  const wanted = (wantedEmail || cands[0] || '').toLowerCase();
  if (wanted && dir) {
    const hit = taken(wanted);
    const free = hit ? cands.find(c => !taken(c)) || '' : wanted;
    out.email = { wanted, taken: !!hit, takenBy: hit ? { name: hit.name, upn: hit.upn, enabled: hit.enabled } : null, suggestion: free };
  } else if (wanted) {
    out.email = { wanted, taken: null, suggestion: wanted }; // can't confirm without a directory
  }

  // 2. Do they (probably) already have a Microsoft account?
  const key = nameKey(p.firstName, p.lastName);
  const mob = normaliseMobile(p.cellphone);
  const personal = String(p.personalEmail || '').toLowerCase();
  for (const u of users) {
    const why = [];
    if (key !== '|' && nameKey(u.first, u.last) === key) why.push('same name');
    else if (key !== '|' && slug(u.name) === slug(`${p.firstName}${p.lastName}`)) why.push('same name');
    if (mob && u.mobile && u.mobile === mob) why.push('same cell');
    if (personal && u.addrs.includes(personal)) why.push('same email');
    if (why.length) out.existing.push({ name: u.name, upn: u.upn, enabled: u.enabled, why });
    if (out.existing.length >= 5) break;
  }

  // 3. Same person in another open request?
  for (const o of openPeople || []) {
    const why = [];
    if (key !== '|' && nameKey(o.firstName, o.lastName) === key) why.push('same name');
    const om = normaliseMobile(o.cellphone);
    if (mob && om && om === mob) why.push('same cell');
    if (personal && String(o.personalEmail || '').toLowerCase() === personal) why.push('same personal email');
    if (why.length) out.duplicates.push({ ticketID: o.ticketID, name: `${o.firstName} ${o.lastName}`, why });
    if (out.duplicates.length >= 5) break;
  }
  return out;
}

module.exports = { isConfigured, sync, load, status, checkPerson, upnCandidates, normaliseMobile, STALE_HOURS };
