// ──────────────────────────────────────────────────────────────────────────────
// Microsoft 365 user directory — synced from Microsoft Graph so new-starter
// requests can be cross-checked (email already taken? person already has an
// account? same person in another open request?).
//
// Setup (once): an Entra ID (Azure AD) app registration with the APPLICATION
// permission User.Read.All (admin-consented) and a client secret. Then EITHER
// paste them in Portal Settings -> Microsoft 365 (saved in Blob, the secret
// AES-256-GCM encrypted with SESSION_SECRET), OR set the Vercel env vars
// MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET (env vars win if both exist).
// The secret's expiry date is kept so everyone is warned before it runs out.
//
// Synced nightly by the Vercel cron (api/admin/directory.js) and on demand
// ("Sync now"). Only what the checks need is stored: name, sign-in/email
// addresses, mobile, enabled — in Blob at directory/ms365.json.
// ──────────────────────────────────────────────────────────────────────────────
const crypto = require('crypto');
const blob = require('./blob.js');

const PATH = 'directory/ms365.json';
const STATUS_PATH = 'directory/ms365-status.json';
const CREDS_PATH = 'directory/ms365-credentials.json';
const STALE_HOURS = 36; // a nightly sync that's missed more than once → warn
const EXPIRY_WARN_DAYS = 30; // warn this long before the client secret expires

// ── Credentials: env vars, else the ones saved in Portal Settings ──────────
const keyBytes = () => crypto.createHash('sha256').update(`ms365-creds|${process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || 'iram-dev-secret'}`).digest();
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}
function decrypt(text) {
  try {
    const [iv, tag, enc] = String(text || '').split('.').map(x => Buffer.from(x, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', keyBytes(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch (_) { return ''; }
}
const envCreds = () => ({ tenant: process.env.MS_TENANT_ID, id: process.env.MS_CLIENT_ID, secret: process.env.MS_CLIENT_SECRET });
const envComplete = () => { const e = envCreds(); return !!(e.tenant && e.id && e.secret); };
// Cached briefly (one request touches it several times); short so a save on
// another serverless instance is picked up quickly.
let savedCache = null, savedAt = 0;
async function savedCreds() {
  if (savedCache && Date.now() - savedAt < 20000) return savedCache;
  const c = blob.isConfigured() ? await blob.getJson(CREDS_PATH).catch(() => null) : null;
  savedCache = c && c.tenantId && c.clientId && c.secretEnc ? c : {};
  savedAt = Date.now();
  return savedCache;
}
async function env() {
  if (envComplete()) return { ...envCreds(), source: 'env', secretExpires: process.env.MS_CLIENT_SECRET_EXPIRES || '' };
  const c = await savedCreds();
  if (!c.tenantId) return { source: null };
  return { tenant: c.tenantId, id: c.clientId, secret: decrypt(c.secretEnc), source: 'saved', secretExpires: c.secretExpires || '' };
}
async function isConfigured() { const e = await env(); return !!(e.tenant && e.id && e.secret); }

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** What Portal Settings shows — never the secret itself. */
async function connectionInfo() {
  const e = await env(), c = await savedCreds();
  return {
    source: e.source, envSet: envComplete(),
    tenantId: e.tenant || '', clientId: e.id || '',
    secretHint: e.secret ? `••••${String(e.secret).slice(-4)}` : '',
    secretExpires: e.secretExpires || '',
    savedBy: e.source === 'saved' ? c.savedBy || '' : '', savedAt: e.source === 'saved' ? c.savedAt || '' : ''
  };
}
/** Saves (or, with clear:true, removes) the Portal Settings credentials. A
 *  blank secret keeps the saved one (so the expiry date can be changed alone). */
async function saveCredentials({ tenantId, clientId, clientSecret, secretExpires, clear }, by) {
  if (clear) { await blob.putJson(CREDS_PATH, { cleared: true, savedBy: by, savedAt: new Date().toISOString() }); savedCache = null; return { ok: true }; }
  tenantId = String(tenantId || '').trim(); clientId = String(clientId || '').trim();
  clientSecret = String(clientSecret || '').trim(); secretExpires = String(secretExpires || '').trim();
  if (!GUID_RE.test(tenantId)) return { error: "The Directory (tenant) ID should look like 1234abcd-5678-…-123456789abc (on the app's Overview page)." };
  if (!GUID_RE.test(clientId)) return { error: "The Application (client) ID should look like 1234abcd-5678-…-123456789abc (on the app's Overview page)." };
  if (GUID_RE.test(clientSecret)) return { error: "That looks like the Secret ID — copy the secret's VALUE column instead (it's only shown once, right after you create it)." };
  if (secretExpires && !/^\d{4}-\d{2}-\d{2}$/.test(secretExpires)) return { error: 'Expiry date must be a date.' };
  const prev = await savedCreds();
  const sameApp = prev.tenantId === tenantId && prev.clientId === clientId;
  const secretEnc = clientSecret ? encrypt(clientSecret) : (sameApp ? prev.secretEnc : '');
  if (!secretEnc) return { error: 'Paste the client secret value.' };
  await blob.putJson(CREDS_PATH, { tenantId, clientId, secretEnc, secretExpires, savedBy: by, savedAt: new Date().toISOString() });
  savedCache = null;
  return { ok: true };
}

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
  const e = await env();
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
    if (!(await isConfigured())) throw new Error('Not connected — add the Azure app in Portal Settings → Microsoft 365.');
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

/** { configured, ok, lastSuccess, count, error, stale, ageHours, secretExpires, secretDaysLeft, expiring } */
async function status() {
  const s = (await blob.getJson(STATUS_PATH).catch(() => null)) || {};
  const ageHours = s.lastSuccess ? (Date.now() - new Date(s.lastSuccess).getTime()) / 3600000 : null;
  const e = await env();
  const configured = !!(e.tenant && e.id && e.secret);
  const secretDaysLeft = e.secretExpires ? Math.ceil((Date.parse(e.secretExpires + 'T00:00:00+02:00') - Date.now()) / 86400000) : null;
  return {
    configured, source: e.source || null, ok: !!s.ok, lastSuccess: s.lastSuccess || null, lastAttempt: s.lastAttempt || null,
    count: s.count || 0, error: s.error || '', ageHours,
    stale: configured && (ageHours === null || ageHours > STALE_HOURS || s.ok === false),
    secretExpires: e.secretExpires || '', secretDaysLeft,
    expiring: configured && secretDaysLeft !== null && secretDaysLeft <= EXPIRY_WARN_DAYS
  };
}
/** One-line warning for banners / reminder emails, or ''. */
function warningText(st) {
  if (!st || !st.configured) return '';
  const parts = [];
  if (st.stale) parts.push(st.lastSuccess
    ? `The Microsoft 365 user list hasn't synced for ${Math.round(st.ageHours / 24) || 1} day(s)${st.error ? ` (${st.error})` : ''} — email checks can't be trusted until it's fixed.`
    : `The Microsoft 365 user list has never synced${st.error ? ` (${st.error})` : ''} — email checks are off.`);
  if (st.expiring) parts.push(st.secretDaysLeft <= 0
    ? `The Microsoft 365 app secret EXPIRED on ${st.secretExpires} — create a new one in Azure and paste it in Portal Settings → Microsoft 365.`
    : `The Microsoft 365 app secret expires in ${st.secretDaysLeft} day(s) (${st.secretExpires}) — create a new one in Azure and paste it in Portal Settings → Microsoft 365.`);
  return parts.join(' ');
}

/** Leavers: Microsoft accounts that match this person (work email / name / cell). */
function findAccounts(p, dir) {
  const users = (dir && dir.users) || [];
  const key = nameKey(p.firstName, p.lastName), mob = normaliseMobile(p.cellphone);
  const work = String(p.workEmail || '').toLowerCase();
  const out = [];
  for (const u of users) {
    const why = [];
    if (work && u.addrs.includes(work)) why.push('work email');
    if (key !== '|' && (nameKey(u.first, u.last) === key || slug(u.name) === slug(`${p.firstName}${p.lastName}`))) why.push('name');
    if (mob && u.mobile === mob) why.push('cell');
    if (why.length) out.push({ name: u.name, upn: u.upn, enabled: u.enabled, why, exact: why.includes('work email') });
  }
  return out.sort((a, b) => b.exact - a.exact || b.why.length - a.why.length).slice(0, 5);
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

module.exports = { isConfigured, sync, load, status, warningText, connectionInfo, saveCredentials, checkPerson, findAccounts, upnCandidates, normaliseMobile, STALE_HOURS };
