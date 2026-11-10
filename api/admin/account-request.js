// ──────────────────────────────────────────────────────────────────────────────
// HR → IT: new-starter account requests (Microsoft 365 email, Perigee, Dext).
//
// Why this exists: account-creation requests used to arrive by email or the
// public ticket form, where anyone can type "I'm from HR". Here a request can
// only be submitted by someone SIGNED IN (password + 2FA) with an HR role
// (requestAccounts, see lib/roles.js). The requester's name, email and role
// come from the session + their stored account, never from the form.
//
// One submission = one batch (one or many people) = one IT ticket number:
//   - the full request lives in Blob (account-requests/<ticketID>.json) with
//     its own status — the New Starter Queue page (admin/new-starters.html)
//     is IT's table for these, separate from the normal ticket dashboard
//   - it's ALSO sent through the normal ticket Power Automate flow, purely so
//     the existing calendar booking (and SharePoint row) is reused unchanged.
//     The description starts with MARKER, which the IT ticket dashboard uses to
//     keep these out of its table.
//   - an HMAC verification code (keyed by SESSION_SECRET) proves the record
//     was created by this endpoint, so IT can confirm a request is genuine
//   - a confirmation email goes to the requester's REGISTERED address, bcc the
//     HR inbox, so HR sees every request made in their name
//
// TEST MODE: while a Developer/Super Admin is previewing as someone
// (api/admin/preview.js), POST creates a TEST-YYYY-NNNNN record marked
// test:true and AUTO-COMPLETED (status Resolved). It still reaches IT — the
// IT email goes out with a [TEST] subject and banner, and it's in the New
// Starter Queue (Completed tab) with a TEST badge — but there's no Power
// Automate call (no SharePoint row or calendar booking), the HR confirmation
// goes only to the real person previewing, and real HR users never see it.
// Preview sessions can PATCH test records only; DELETE removes a test record.
//
// HANDOVER (IT, once accounts exist): POST ?action=handover { ticketID, index,
//   ms:{displayName, username, password}, perigee:{username, password} }
//   → emails the account details to the submitter, HR, Perigee admin(s), the
//   new starter's supervisor and the IT manager(s); if Dext is needed, a second
//   email asks the Dext recipients (default: Perigee admin + HR) to create it
//   with the final usernames. Usernames are saved; PASSWORDS ARE NEVER STORED —
//   they only exist in the email.
// PERIGEE SUPPORT ADMIN (updateAccounts): sees every request in the queue, is
//   copied on new requests and every handover, and can record real usernames /
//   tick accounts / send logins — until the request is Resolved or Closed. She
//   can't change status, IT notes or bookings (that stays with IT).
// OWNERS ("who does what", in Email settings): each account type has its own
//   owner(s) — e.g. Microsoft 365 "Sean", Perigee "Sean 70, Laurette 30",
//   Dext "Laurette". Every person in a request gets an owner per account they
//   need (Perigee split by weight over time); those owners are the request's
//   Assigned, get its Dext requests (Dext owner) and get the daily reminders
//   for their own unfinished accounts. IT can reassign any account.
// SETTINGS: GET ?settings=1 (IT) / POST ?action=settings (editIT) — who those
//   handover emails go to (account-requests/settings.json).
// SITES (admin/sites.html): POST ?action=sites { sites:[…] } (editIT) — the
//   register of iRam Hub and other linked sites people are added to / removed
//   from: name, url, admin page, add / remove steps, used for starters /
//   leavers / both, and an optional "who needs it" match (departments, job
//   titles, regions, teams — blank = everyone). When a request is logged each
//   person gets a snapshot of their matching sites (p.sites) with a tick per
//   site (p.siteDone); all ticked = the iRam Hub account is done. New starters
//   with matching sites get needsHub automatically.
// LEAVERS (type:'leaver'): the same flow in reverse — HR asks IT to REMOVE a
//   person's access (Microsoft 365, Perigee / FieldGoose, Dext, iRam Hub and
//   its linked sites) by their last day, or immediately. Same verification
//   code, queue, owners ("who does what", plus an iRam Hub owner), reminders
//   and test mode. Ticking an account means "removed". POST
//   ?action=leaver-confirm { ticketID, index } emails HR, the submitter, the
//   supervisor, Perigee support and the IT manager what was removed (and what
//   happened to the mailbox). The ticket description starts with
//   LEAVER_MARKER so the IT dashboard keeps it out of its table too.
//
// POST  { people: [ {...person} ], notes }            requestAccounts → { ticketID, verificationCode, count }
// GET                     list (HR: own; IT: all)    ?active=1 → only Open / In Progress
// GET   ?id=<ticketID>    full record + verified flag (HR: own only; IT: any)
// PATCH { ticketID, status, itNotes, people:[{ index, done:{microsoft,perigee,dext}, createdEmail }] }
//                         manageTickets — IT working the request
// ──────────────────────────────────────────────────────────────────────────────
const crypto              = require('crypto');
const { parsePhoneNumberFromString } = require('libphonenumber-js/max');
const { verifyToken, sessionTokenFromRequest } = require('../../lib/auth');
const { PREVIEW_MESSAGE } = require('../../lib/require-role');
const { hasPermission, ROLES } = require('../../lib/roles');
const { getUser }         = require('../../lib/users');
const { load: loadConfig } = require('../../lib/portal-config.js');
const { nextInPool }      = require('../../lib/rotation.js');
const { formatDuration }  = require('../../assets/duration.js');
const blob                = require('../../lib/blob.js');
const { syncStatus }      = require('../../lib/sp-sync.js');

const INDEX_PATH = 'account-requests/index.json';
const SETTINGS_PATH = 'account-requests/settings.json';
const OWNER_COUNTS_PATH = 'account-requests/owner-counts.json';
const KINDS = ['microsoft', 'perigee', 'dext', 'hub'];
const NEEDS = { microsoft: 'needsMicrosoft', perigee: 'needsPerigee', dext: 'needsDext', hub: 'needsHub' };
const recordPath = id => `account-requests/${id}.json`;
const ID_RE      = /^(IT|TEST)-\d{4}-\d{5}$/;

const MARKER   = '[NEW STARTER ACCOUNT REQUEST]';
const LEAVER_MARKER = '[LEAVER ACCESS REMOVAL]';
// Existing category (SharePoint may treat Category as a choice column).
const CATEGORY = 'Access / Passwords / Permissions';
const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];
const ACTIVE   = new Set(['Open', 'In Progress']);
const MAX_PEOPLE = 50;
// Booking length per person, per account type — summed for the batch.
const MINUTES = { microsoft: 15, perigee: 15, dext: 10, hub: 10 };
const LEAVER_MINUTES = { microsoft: 15, perigee: 5, dext: 5, hub: 10 };
const REASONS = ['Resigned', 'Dismissed', 'Contract ended', 'Retrenched', 'Retired', 'Absconded', 'Other'];
const MAILBOX = {
  shared:  'Convert to a shared mailbox and give the supervisor access',
  forward: 'Forward new email to the supervisor',
  none:    'Just block sign-in (no mailbox access needed)'
};
const CUTOFF = { end_of_day: 'End of their last day', immediately: 'IMMEDIATELY (as soon as possible)' };

const REGIONS = ['Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape', 'Free State', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Head Office', 'National'];

function secret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || 'iram-dev-secret';
}

/** Short human-readable code, e.g. "7F3A-91C2". Recomputed on every view, so
 *  a record edited outside this endpoint (or a code typed into an email)
 *  won't match. */
function verificationCode({ ticketID, requestedBy, createdAt, people }) {
  const n = Array.isArray(people) ? people.length : 0;
  const h = crypto.createHmac('sha256', secret()).update(`acct-req|${ticketID}|${requestedBy}|${createdAt}|${n}`).digest('hex').toUpperCase();
  return `${h.slice(0, 4)}-${h.slice(4, 8)}`;
}

const clean   = (v, max = 200) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
// Stricter than "has an @": one @, no spaces, no ".." , a real-looking domain
// with a 2+ letter ending (e.g. name@gmail.com, a.b@company.co.za).
const isEmail = v => /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(v) && !/\.\./.test(v) && !/^\.|\.@/.test(v);

/** "sIPHO" → "Sipho", "mary-jane" → "Mary-Jane", "o'brien" → "O'Brien":
 *  first letter of each word/part capital, the rest lower case. */
const nameCase = v => String(v || '').toLowerCase().replace(/(^|[\s'-])([a-zà-ÿ])/g, (m, sep, ch) => sep + ch.toUpperCase());

/** South African mobile → +27XXXXXXXXX, or null if it isn't one.
 *  Accepts 083 123 4567, 0831234567, 27831234567, +27 83 123 4567. */
function normaliseSaMobile(v) {
  let d = String(v || '').replace(/[\s()\-.]/g, '');
  if (/^00/.test(d)) d = '+' + d.slice(2);
  if (/^0\d{9}$/.test(d)) d = '+27' + d.slice(1);
  else if (/^27\d{9}$/.test(d)) d = '+' + d;
  if (!/^\+27(6\d|7\d|8[1-5])\d{7}$/.test(d)) return null; // 080/086/087 aren't mobiles
  const pn = parsePhoneNumberFromString(d, 'ZA');
  if (!pn || !pn.isValid() || pn.country !== 'ZA') return null;
  const t = pn.getType();
  if (t && t !== 'MOBILE' && t !== 'FIXED_LINE_OR_MOBILE') return null;
  return pn.number; // E.164, e.g. +27831234567
}
const isDate  = v => /^\d{4}-\d{2}-\d{2}$/.test(v);
const fullName = p => [p.firstName, p.middleNames, p.lastName].filter(Boolean).join(' ');
const services = p => [p.needsMicrosoft && 'Microsoft 365', p.needsPerigee && 'Perigee', p.needsDext && 'Dext', p.needsHub && 'iRam Hub'].filter(Boolean);
const isLeaver = r => r && r.type === 'leaver';

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const session = verifyToken(sessionTokenFromRequest(req));
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  const canRequest = hasPermission(session.role, 'requestAccounts');
  const isIT       = hasPermission(session.role, 'manageTickets');
  const canUpdate  = isIT || hasPermission(session.role, 'updateAccounts');
  // Test records are visible to IT, preview sessions and Developers/Super Admins
  // — never to real HR users.
  const seesTests  = !!session.preview || canUpdate || hasPermission(session.role, 'previewUsers');
  if (!canRequest && !canUpdate) return res.status(403).json({ error: 'forbidden' });
  if (!blob.isConfigured()) return res.status(503).json({ error: 'storage_not_configured', message: 'Storage isn\'t configured — ask IT.' });

  try {
    const action = String((req.query || {}).action || '');
    if (req.method === 'GET' && (req.query || {}).settings) {
      if (!canUpdate) return res.status(403).json({ error: 'forbidden' });
      return res.status(200).json({ settings: await loadSettings(), canEdit: hasPermission(session.role, 'editIT') && !session.preview });
    }
    if (req.method === 'POST' && action === 'sites') {
      if (!hasPermission(session.role, 'editIT') || session.preview) return res.status(403).json({ error: 'Only Admins can change the sites list.' });
      return await handleSaveSites(req, res, session);
    }
    if (req.method === 'POST' && action === 'settings') {
      if (!hasPermission(session.role, 'editIT') || session.preview) return res.status(403).json({ error: 'Only Admins can change these email settings.' });
      return await handleSaveSettings(req, res, session);
    }
    if (req.method === 'POST' && action === 'dext-request') {
      if (!canUpdate) return res.status(403).json({ error: 'forbidden' });
      return await handleDextRequest(req, res, session, isIT);
    }
    if (req.method === 'POST' && action === 'leaver-confirm') {
      if (!canUpdate) return res.status(403).json({ error: 'forbidden' });
      return await handleLeaverConfirm(req, res, session, isIT);
    }
    if (req.method === 'POST' && action === 'handover') {
      if (!canUpdate) return res.status(403).json({ error: 'forbidden' });
      return await handleHandover(req, res, session, isIT);
    }
    if (req.method === 'GET')   return await handleGet(req, res, session, canUpdate, seesTests);
    if (req.method === 'POST') {
      if (!canRequest) return res.status(403).json({ error: 'forbidden', message: 'Only HR accounts can log account requests.' });
      return await handlePost(req, res, session);
    }
    if (req.method === 'PATCH') {
      if (!canUpdate) return res.status(403).json({ error: 'forbidden' });
      return await handlePatch(req, res, session, isIT);
    }
    if (req.method === 'DELETE') {
      if (!seesTests) return res.status(403).json({ error: 'forbidden' });
      return await handleDeleteTest(req, res);
    }
  } catch (err) {
    console.error('account-request error:', err.message);
    return res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' });
  }
  return res.status(405).json({ error: 'Method not allowed' });
};

// ── GET ─────────────────────────────────────────────────────────────────────
async function handleGet(req, res, session, isIT, seesTests) {
  const q  = req.query || {};
  const id = clean(q.id || q.verify, 40).toUpperCase();
  const mine = session.username.toLowerCase();

  if (id) {
    if (!ID_RE.test(id)) return res.status(200).json({ verified: false, reason: 'not_found' });
    const record = await blob.getJson(recordPath(id)).catch(() => null);
    if (!record || record.deleted) return res.status(200).json({ verified: false, reason: 'not_found' });
    if (record.test && !seesTests) return res.status(200).json({ verified: false, reason: 'not_found' });
    if (!isIT && (record.requestedBy || '').toLowerCase() !== mine) return res.status(200).json({ verified: false, reason: 'not_found' });
    const ok = record.verificationCode === verificationCode(record);
    return res.status(200).json({ verified: ok, reason: ok ? null : 'code_mismatch', record });
  }

  let list = (await blob.getJson(INDEX_PATH).catch(() => null)) || [];
  if (!seesTests) list = list.filter(r => !r.test);
  if (!isIT) list = list.filter(r => (r.requestedBy || '').toLowerCase() === mine);
  // Active only — except test requests (auto-completed) stay listed while
  // testing, so the tester can see their test landed.
  if (q.active === '1') list = list.filter(r => ACTIVE.has(r.status || 'Open') || (session.preview && r.test));
  if (q.type === 'leaver') list = list.filter(isLeaver);
  else if (q.type === 'starter') list = list.filter(r => !isLeaver(r));
  return res.status(200).json({ requests: list.slice(0, 500), seesAll: isIT, regions: REGIONS });
}

// ── POST (HR submits) ───────────────────────────────────────────────────────
function cleanPerson(raw, i) {
  const p = {
    firstName:      nameCase(clean(raw.firstName, 60)),
    middleNames:    nameCase(clean(raw.middleNames, 80)),
    lastName:       nameCase(clean(raw.lastName, 60)),
    personalEmail:  clean(raw.personalEmail, 120).toLowerCase(),
    cellphone:      clean(raw.cellphone, 30),
    region:         clean(raw.region, 60),
    jobTitle:       clean(raw.jobTitle, 100),
    department:     clean(raw.department, 100),
    startDate:      clean(raw.startDate, 10),
    managerName:    clean(raw.managerName, 100),
    managerEmail:   clean(raw.managerEmail, 120).toLowerCase(),
    needsMicrosoft: !!raw.needsMicrosoft,
    needsPerigee:   !!raw.needsPerigee,
    needsDext:      !!raw.needsDext,
    perigeeRole:    clean(raw.perigeeRole, 60),
    teamName:       clean(raw.teamName, 100),
    notes:          clean(raw.notes, 500),
    done:           { microsoft: false, perigee: false, dext: false },
    createdEmail:   ''
  };
  const who = p.firstName || p.lastName ? `${p.firstName} ${p.lastName}`.trim() : `Person ${i + 1}`;
  const missing = [];
  if (!p.firstName)  missing.push('first name');
  if (!p.lastName)   missing.push('surname');
  if (!p.cellphone)  missing.push('cell number');
  if (!p.region)     missing.push('region');
  if (!p.jobTitle)   missing.push('job title');
  if (!p.department) missing.push('department');
  if (missing.length) return { error: `${who}: please fill in ${missing.join(', ')}.` };
  if (!p.needsMicrosoft && !p.needsPerigee && !p.needsDext) return { error: `${who}: tick at least one account (Microsoft 365, Perigee or Dext).` };
  if (/\s/.test(p.firstName)) return { error: `${who}: first name must be one name — put any others in Middle names.` };
  if (p.managerEmail && !isEmail(p.managerEmail)) return { error: `${who}: the supervisor email isn't a valid address — fix it or leave it blank.` };
  if (p.personalEmail && !isEmail(p.personalEmail)) return { error: `${who}: the personal email isn't a valid address — fix it or leave it blank.` };
  const cell = normaliseSaMobile(p.cellphone);
  if (!cell) return { error: `${who}: the cell number must be a valid South African mobile (e.g. 083 123 4567).` };
  p.cellphone = cell;
  if (p.startDate && !isDate(p.startDate)) p.startDate = '';
  return { person: p };
}

function cleanLeaver(raw, i) {
  const p = {
    firstName:      nameCase(clean(raw.firstName, 60)),
    middleNames:    nameCase(clean(raw.middleNames, 80)),
    lastName:       nameCase(clean(raw.lastName, 60)),
    workEmail:      clean(raw.workEmail, 120).toLowerCase(),
    cellphone:      clean(raw.cellphone, 30),
    region:         clean(raw.region, 60),
    jobTitle:       clean(raw.jobTitle, 100),
    department:     clean(raw.department, 100),
    lastDay:        clean(raw.lastDay, 10),
    cutOff:         raw.cutOff === 'immediately' ? 'immediately' : 'end_of_day',
    reason:         REASONS.includes(raw.reason) ? raw.reason : '',
    managerName:    clean(raw.managerName, 100),
    managerEmail:   clean(raw.managerEmail, 120).toLowerCase(),
    mailbox:        MAILBOX[raw.mailbox] ? raw.mailbox : 'shared',
    mailboxTo:      clean(raw.mailboxTo, 120).toLowerCase(),
    needsMicrosoft: !!raw.needsMicrosoft,
    needsPerigee:   !!raw.needsPerigee,
    needsDext:      !!raw.needsDext,
    needsHub:       !!raw.needsHub,
    notes:          clean(raw.notes, 500),
    done:           { microsoft: false, perigee: false, dext: false, hub: false }
  };
  const who = p.firstName || p.lastName ? `${p.firstName} ${p.lastName}`.trim() : `Person ${i + 1}`;
  const missing = [];
  if (!p.firstName) missing.push('first name');
  if (!p.lastName)  missing.push('surname');
  if (!p.region)    missing.push('region');
  if (!p.lastDay)   missing.push('last working day');
  if (missing.length) return { error: `${who}: please fill in ${missing.join(', ')}.` };
  if (!isDate(p.lastDay)) return { error: `${who}: the last working day isn't a valid date.` };
  if (!p.needsMicrosoft && !p.needsPerigee && !p.needsDext && !p.needsHub) return { error: `${who}: tick at least one thing to remove (Microsoft 365, Perigee, Dext or iRam Hub).` };
  if (p.workEmail && !isEmail(p.workEmail)) return { error: `${who}: the work email isn't a valid address — fix it or leave it blank.` };
  if (p.managerEmail && !isEmail(p.managerEmail)) return { error: `${who}: the supervisor email isn't a valid address — fix it or leave it blank.` };
  if (p.mailboxTo && !isEmail(p.mailboxTo)) return { error: `${who}: the "mailbox goes to" email isn't a valid address.` };
  if (p.needsMicrosoft && p.mailbox !== 'none' && !p.mailboxTo && !p.managerEmail) return { error: `${who}: say who should get the mailbox (supervisor email), or choose "Just block sign-in".` };
  if (!p.mailboxTo && p.mailbox !== 'none') p.mailboxTo = p.managerEmail;
  if (p.cellphone) {
    const cell = normaliseSaMobile(p.cellphone);
    if (!cell) return { error: `${who}: the cell number must be a valid South African mobile — or leave it blank.` };
    p.cellphone = cell;
  }
  return { person: p };
}

async function handlePost(req, res, session) {
  const b = req.body || {};
  const rawPeople = Array.isArray(b.people) ? b.people : [];
  if (!rawPeople.length) return res.status(400).json({ error: 'empty', message: 'Add at least one person.' });
  if (rawPeople.length > MAX_PEOPLE) return res.status(400).json({ error: 'too_many', message: `Up to ${MAX_PEOPLE} people per request — split it into two.` });

  const leaver = b.type === 'leaver';
  const people = [];
  for (let i = 0; i < rawPeople.length; i++) {
    const r = (leaver ? cleanLeaver : cleanPerson)(rawPeople[i] || {}, i);
    if (r.error) return res.status(400).json({ error: 'invalid', message: r.error, index: i });
    people.push(r.person);
  }
  const batchNotes = clean(b.notes, 2000);

  // Test mode = submitted from a Developer/Super Admin "preview as" session.
  const test  = !!session.preview;
  const actor = test ? await getUser(session.preview.actor).catch(() => null) : null;

  // Identity comes from the session + stored account, never the request body.
  const record         = await getUser(session.username).catch(() => null);
  const requesterEmail = (record && record.email) || '';
  const requesterName  = (record && record.fullName) || session.username;
  const requesterRole  = (ROLES[session.role] && ROLES[session.role].label) || session.role;
  const mfaOn          = !!(record && record.mfaEnabled);

  const ticketID  = `${test ? 'TEST' : 'IT'}-${new Date().getFullYear()}-${String(crypto.randomInt(10000, 100000))}`;
  const createdAt = new Date().toISOString();
  const code      = verificationCode({ ticketID, requestedBy: session.username, createdAt, people });
  const origin    = `https://${req.headers.host || 'iram-it-portal.vercel.app'}`;
  const queueUrl  = `${origin}/admin/new-starters?id=${encodeURIComponent(ticketID)}`;

  // Earliest start date (leavers: last day) decides urgency. Starters within
  // 3 days → High; leavers within 1 day, or "cut access immediately" → High.
  const starts   = people.map(p => leaver ? p.lastDay : p.startDate).filter(Boolean).sort();
  const earliest = starts[0] || '';
  const daysToStart = earliest ? Math.ceil((Date.parse(earliest + 'T00:00:00+02:00') - Date.now()) / 86400000) : 99;
  const urgentNow = leaver && people.some(p => p.cutOff === 'immediately');
  const priority = urgentNow || daysToStart <= (leaver ? 1 : 3) ? 'High' : 'Medium';
  const mins = leaver ? LEAVER_MINUTES : MINUTES;
  const minutes  = Math.min(480, Math.max(15, people.reduce((m, p) => m + KINDS.reduce((n, k) => n + (p[NEEDS[k]] ? mins[k] : 0), 0), 0)));

  const count = (k) => people.filter(p => p[k]).length;
  const summary = (leaver ? 'remove ' : '') + [count('needsMicrosoft') && `${count('needsMicrosoft')} Microsoft 365`, count('needsPerigee') && `${count('needsPerigee')} Perigee`, count('needsDext') && `${count('needsDext')} Dext`, count('needsHub') && `${count('needsHub')} iRam Hub`].filter(Boolean).join(', ');
  const noun = people.length === 1 ? 'person' : 'people';

  const { config } = await loadConfig();
  const itPool      = (config.itStaff || []).filter(s => s.isIT);
  const perigeePool = (config.itStaff || []).filter(s => s.isPerigee);
  // Owner per account per person, from "Who does what" (Email settings).
  const ownerSettings = await loadSettings();
  // Sites (admin/sites.html) each person is added to / removed from.
  for (const p of people) {
    const list = sitesFor(p, leaver ? 'leaver' : 'starter', ownerSettings.sites);
    if (leaver) { if (p.needsHub) p.sites = list; }
    else if (list.length) { p.needsHub = true; p.sites = list; p.done.hub = false; }
    if (p.sites) p.siteDone = {};
  }
  await assignOwners(people, ownerSettings, { itPool, perigeePool }, test);
  const ownerTally = {};
  people.forEach(p => KINDS.forEach(k => { const o = (p.owners || {})[k]; if (o) ownerTally[o] = (ownerTally[o] || 0) + 1; }));
  // Primary owner (most accounts) books the calendar slot via the ticket flow.
  const assignedTo = Object.keys(ownerTally).sort((a, b) => ownerTally[b] - ownerTally[a])[0] || '';

  const auditRecord = {
    ticketID, createdAt, verificationCode: code,
    requestedBy: session.username, requesterName, requesterEmail, requesterRole, roleKey: session.role,
    hasAccount: !!record, mfaEnabled: mfaOn,
    ip: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
    userAgent: clean(req.headers['user-agent'], 300),
    type: leaver ? 'leaver' : 'starter',
    status: 'Open', statusHistory: [{ status: 'Open', at: createdAt, by: session.username }],
    priority, estimatedMinutes: minutes, assignedTo, earliestStart: earliest,
    notes: batchNotes, itNotes: '', people
  };
  if (test) {
    auditRecord.test = true;
    auditRecord.testBy = session.preview.actor;
    auditRecord.assignedTo = '';
    // Auto-completed: a test proves the request reached IT; there's nothing to set up.
    auditRecord.status = 'Resolved';
    auditRecord.statusHistory.push({ status: 'Resolved', at: createdAt, by: 'system (test request — auto-completed)' });
    auditRecord.itNotes = leaver ? 'TEST request — auto-completed. No access to remove.' : 'TEST request — auto-completed. No accounts to create.';
  }

  // Audit record first: if it can't be stored, IT couldn't verify the request,
  // so refuse rather than log an unverifiable ticket.
  await blob.putJson(recordPath(ticketID), auditRecord);
  const index = (await blob.getJson(INDEX_PATH).catch(() => null)) || [];
  index.unshift(indexEntry(auditRecord));
  await blob.putJson(INDEX_PATH, index.slice(0, 2000));

  // Normal ticket flow → SharePoint row + the existing calendar booking.
  const description = [
    `${leaver ? LEAVER_MARKER : MARKER} ${people.length} ${noun} — ${summary}`,
    `Verification code: ${code}`,
    `Requested by: ${requesterName} (${requesterRole})${requesterEmail ? ' <' + requesterEmail + '>' : ''}, signed in with 2FA`,
    ...people.map((p, i) => leaver
      ? `${i + 1}. ${fullName(p)}${p.workEmail ? ' <' + p.workEmail + '>' : ''} — ${[p.jobTitle, p.department, p.region].filter(Boolean).join(', ')} — last day ${p.lastDay}${p.cutOff === 'immediately' ? ' — CUT ACCESS IMMEDIATELY' : ''} — remove ${services(p).join(' + ')}`
      : `${i + 1}. ${fullName(p)} — ${p.jobTitle}, ${p.department}, ${p.region}${p.startDate ? ', starts ' + p.startDate : ''} — ${services(p).join(' + ')}`),
    batchNotes ? `Notes: ${batchNotes}` : '',
    `Open in New Starter Queue: ${queueUrl}`
  ].filter(Boolean).join('\n');

  // Test requests never reach Power Automate — no SharePoint row, no booking.
  const paUrl = test ? '' : process.env.POWER_AUTOMATE_URL;
  if (paUrl) {
    try {
      await fetch(paUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          submitterName:  requesterName,
          submitterEmail: requesterEmail,
          submitterPhone: (record && record.phone) || '',
          department:     'HR',
          location:       [...new Set(people.map(p => p.region))].join(', '),
          managerName:    '', managerEmail: '',
          category:       CATEGORY,
          suggestedPriority: priority,
          description,
          submittedAt:    createdAt,
          ticketID, estimatedMinutes: minutes, estimatedLabel: formatDuration(minutes),
          attachmentUrl:  '', assignedTo,
          requestType:    leaver ? 'Leaver Access Removal' : 'New Starter Accounts', hrVerified: true, verificationCode: code
        })
      });
    } catch (err) {
      console.error('account-request: PA call error', err.message);
    }
  }

  const hrInbox  = process.env.HR_EMAIL || 'hr@iram.co.za';
  const notifySettings = await loadSettings();
  const itEmails = [...new Set([
    process.env.IT_EMAIL,
    ...itPool.map(s => s.email),
    ...(count('needsPerigee') ? perigeePool.map(s => s.email) : []),
    ...notifySettings.perigeeAdminEmails  // Perigee support admin is kept in the loop on every request
  ].filter(Boolean))];
  const table = leaver ? leaverTable(people) : peopleTable(people);
  const kindLabel = leaver ? 'Leaver — remove access' : 'New Starter Account Request';
  if (test) {
    const who = `<strong>${esc(session.preview.actor)}</strong> while testing as <strong>${esc(session.username)}</strong> (${esc(requesterRole)})`;
    const subj = `[TEST — auto-completed] ${leaver ? 'Leaver access removal' : 'New starter request'} ${ticketID} — ${people.length} ${noun}`;
    const actorEmail = actor && actor.email;
    try {
      // IT gets it like a real request, so the path is proven end to end —
      // but unmistakably marked, and already completed.
      const toIT = [...new Set([...itEmails, actorEmail].filter(Boolean))];
      if (toIT.length) await sendEmail({
        to: toIT, subject: subj,
        html: emailHtml({ heading: `🧪 TEST — ${kindLabel}`, ticketID, code, table, buttonUrl: queueUrl, buttonLabel: 'Open in the queue', test: true,
          intro: `🧪 <strong>THIS IS A TEST.</strong> Submitted by ${who}. It has been <strong>marked completed automatically</strong> — ${leaver ? 'no access needs to be removed' : 'no accounts need to be created'}, and nothing was booked on the calendar.`,
          footer: 'Test requests show a TEST badge in the New Starter Queue (Completed tab) and are never shown to HR.' })
      });
      // The HR confirmation goes only to the person testing, not the real HR inbox.
      if (actorEmail) await sendEmail({
        to: actorEmail, subject: `[TEST] HR confirmation preview — ${ticketID}`,
        html: emailHtml({ heading: leaver ? '🧪 TEST — Leaver Request Logged' : '🧪 TEST — Account Request Logged', ticketID, code, table, test: true,
          intro: `🧪 This is the confirmation HR would receive. It was sent only to you because you were testing as ${esc(session.username)}.` })
      });
    } catch (err) { console.error('account-request: test email error', err.message); }
    return res.status(200).json({ ticketID, verificationCode: code, count: people.length, test: true, status: 'Resolved' });
  }
  try {
    if (itEmails.length && leaver) {
      await sendEmail({
        to: itEmails,
        subject: `[${priority}] ⛔ HR-verified leaver — remove access ${ticketID} — ${people.length} ${noun}${urgentNow ? ' — IMMEDIATELY' : earliest ? ' by ' + earliest : ''}`,
        html: emailHtml({ heading: 'Leaver — Remove Access', ticketID, code, table, buttonUrl: queueUrl, buttonLabel: 'Open in the queue',
          intro: `<strong>${esc(requesterName)}</strong> (${esc(requesterRole)}) logged this while signed in with two-factor login. Please remove the access below ${urgentNow ? '<strong style="color:#a4262c">IMMEDIATELY</strong> for anyone marked so, otherwise ' : ''}at the end of each person's last working day, then tick each one off in the queue and send HR the confirmation.${batchNotes ? `<br><br><strong>Notes:</strong> ${esc(batchNotes)}` : ''}`,
          footer: 'Only act on leaver requests that show as verified in the queue. Requests by plain email or the public form are not HR-verified.' })
      });
    } else if (itEmails.length) {
      await sendEmail({
        to: itEmails,
        subject: `[${priority}] ✅ HR-verified new starter request ${ticketID} — ${people.length} ${people.length === 1 ? 'person' : 'people'} (${summary})`,
        html: emailHtml({ heading: 'New Starter Account Request', ticketID, code, table, buttonUrl: queueUrl, buttonLabel: 'Open in New Starter Queue',
          intro: `<strong>${esc(requesterName)}</strong> (${esc(requesterRole)}) logged this request while signed in to the portal with two-factor login. The queue page has the Microsoft 365 and Perigee details ready to copy, plus CSV exports for bulk import.${batchNotes ? `<br><br><strong>Notes:</strong> ${esc(batchNotes)}` : ''}`,
          footer: 'Only create accounts for requests that show as verified in the New Starter Queue. Requests by plain email or the public form are not HR-verified.' })
      });
    }
    await sendEmail({
      to: requesterEmail || hrInbox,
      bcc: requesterEmail && hrInbox.toLowerCase() !== requesterEmail.toLowerCase() ? hrInbox : undefined,
      subject: `${leaver ? 'Leaver request' : 'Account request'} ${ticketID} logged — ${people.length} ${noun}`,
      html: emailHtml({ heading: leaver ? 'Leaver Request Logged' : 'Account Request Logged', ticketID, code, table,
        buttonUrl: `${origin}/admin/${leaver ? 'leaver-request' : 'account-request'}`, buttonLabel: 'View my requests',
        intro: `Your request has been sent to IT. You'll see it under <strong>My requests</strong> until it's completed.<br><br>⚠️ <strong>Didn't log this?</strong> Tell IT immediately — someone may be using your login.` })
    });
  } catch (err) {
    console.error('account-request: email error', err.message);
  }

  return res.status(200).json({ ticketID, verificationCode: code, count: people.length });
}

function isPersonDone(p) {
  const d = p.done || {};
  return KINDS.every(k => !p[NEEDS[k]] || d[k]);
}

function indexEntry(r) {
  return {
    ticketID: r.ticketID, createdAt: r.createdAt, status: r.status || 'Open', type: r.type || 'starter',
    requestedBy: r.requestedBy, requesterName: r.requesterName, requesterRole: r.requesterRole,
    count: r.people.length,
    names: r.people.slice(0, 3).map(p => `${p.firstName} ${p.lastName}`),
    regions: [...new Set(r.people.map(p => p.region))],
    services: {
      microsoft: r.people.filter(p => p.needsMicrosoft).length,
      perigee:   r.people.filter(p => p.needsPerigee).length,
      dext:      r.people.filter(p => p.needsDext).length,
      hub:       r.people.filter(p => p.needsHub).length
    },
    immediate: r.people.some(p => p.cutOff === 'immediately'),
    doneCount: r.people.filter(isPersonDone).length,
    earliestStart: r.earliestStart || '', priority: r.priority, assignedTo: r.assignedTo || '',
    owners: requestOwners(r), ownerTasks: ownerTasks(r),
    test: !!r.test
  };
}

const KIND_LABEL = { microsoft: 'Microsoft 365', perigee: 'Perigee', dext: 'Dext', hub: 'iRam Hub' };
/** Everyone who owns at least one account in the request. */
function requestOwners(r) {
  const set = new Set();
  r.people.forEach(p => KINDS.forEach(k => { if (p[NEEDS[k]] && p.owners && p.owners[k]) set.add(p.owners[k]); }));
  return [...set];
}
/** { owner: ["Microsoft 365 ×2", "Perigee ×1"] } — accounts still NOT done. */
function ownerTasks(r) {
  const tally = {};
  r.people.forEach(p => KINDS.forEach(k => {
    if (!p[NEEDS[k]] || (p.done || {})[k]) return;
    const o = (p.owners || {})[k] || r.assignedTo || '';
    tally[o] = tally[o] || {};
    tally[o][k] = (tally[o][k] || 0) + 1;
  }));
  const out = {};
  const verb = isLeaver(r) ? 'Remove ' : '';
  Object.keys(tally).forEach(o => { out[o] = KINDS.filter(k => tally[o][k]).map(k => `${verb}${KIND_LABEL[k]} ×${tally[o][k]}`); });
  return out;
}

/** Parses "Sean 70, Laurette 30" → [{name:'Sean',weight:70},{name:'Laurette',weight:30}]. */
function parseOwners(v) {
  const parts = Array.isArray(v) ? v : String(v || '').split(/[,;\n]+/);
  return parts.map(x => {
    if (x && typeof x === 'object') return { name: String(x.name || '').trim(), weight: Number(x.weight) > 0 ? Number(x.weight) : 1 };
    const m = /^\s*(.*?)\s*(?:[:=x×]?\s*(\d+(?:\.\d+)?)\s*%?)?\s*$/.exec(String(x));
    return { name: (m && m[1] || '').trim(), weight: m && m[2] ? Number(m[2]) : 1 };
  }).filter(o => o.name);
}

/** Picks an owner for each needed account of each person. Weighted pools keep
 *  a running count so e.g. 70/30 holds over time, not just within one batch. */
async function assignOwners(people, settings, pools, test) {
  const counts = test ? {} : ((await blob.getJson(OWNER_COUNTS_PATH).catch(() => null)) || {});
  const owners = settings.owners || {};
  const fallback = {
    microsoft: pools.itPool,
    perigee:   pools.perigeePool.length ? pools.perigeePool : pools.itPool,
    dext:      pools.perigeePool.length ? pools.perigeePool : pools.itPool,
    hub:       pools.itPool
  };
  const pick = kind => {
    let list = parseOwners(owners[kind]);
    if (!list.length) list = (fallback[kind] || []).map(s => ({ name: s.name, weight: 1 }));
    if (!list.length) return '';
    const c = counts[kind] = counts[kind] || {};
    // Lowest (assigned + 1) / weight wins → long-run share matches the weights.
    let best = list[0], bestScore = Infinity;
    for (const o of list) {
      const score = ((c[o.name] || 0) + 1) / o.weight;
      if (score < bestScore) { best = o; bestScore = score; }
    }
    c[best.name] = (c[best.name] || 0) + 1;
    return best.name;
  };
  for (const p of people) {
    p.owners = {};
    for (const k of KINDS) if (p[NEEDS[k]]) p.owners[k] = pick(k);
  }
  if (!test) await blob.putJson(OWNER_COUNTS_PATH, counts).catch(() => {});
}

/** Email for a staff name (Settings → IT Staff). */
async function staffEmail(name) {
  if (!name) return '';
  try {
    const { config } = await loadConfig();
    const s = (config.itStaff || []).find(x => String(x.name || '').trim().toLowerCase() === String(name).trim().toLowerCase());
    return s && isEmail(String(s.email || '').toLowerCase()) ? String(s.email).toLowerCase() : '';
  } catch (_) { return ''; }
}

// ── PATCH (IT works the request) ─────────────────────────────────────────────
async function handlePatch(req, res, session, isIT) {
  const b  = req.body || {};
  const id = clean(b.ticketID, 40).toUpperCase();
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad_id' });
  const record = await blob.getJson(recordPath(id)).catch(() => null);
  if (!record || record.deleted) return res.status(404).json({ error: 'not_found' });
  if (session.preview && !record.test) return res.status(403).json({ error: PREVIEW_MESSAGE, message: 'In preview test mode you can only work on TEST requests.' });

  // Techs without full IT rights (the Perigee Support Admin) can change the
  // STATUS — including reopening a completed request — but not IT notes or
  // assignment, and can't edit account details once it's completed.
  if (!isIT) {
    if (b.itNotes !== undefined || b.assignedTo !== undefined) return res.status(403).json({ error: 'Only IT can change the notes or assignment.' });
    const onlyStatus = b.status !== undefined && !Array.isArray(b.people);
    if (['Resolved', 'Closed'].includes(record.status) && !onlyStatus) return res.status(403).json({ error: 'This request is completed — set the status back to In Progress first if something needs changing.' });
  }
  const now = new Date().toISOString();
  const actor = session.preview ? session.preview.actor : session.username;
  const oldStatus = record.status || 'Open';
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return res.status(400).json({ error: 'bad_status' });
    if (b.status !== record.status) {
      record.status = b.status;
      (record.statusHistory = record.statusHistory || []).push({ status: b.status, at: now, by: actor });
    }
  }
  if (b.itNotes !== undefined) record.itNotes = clean(b.itNotes, 4000);
  if (b.assignedTo !== undefined) record.assignedTo = clean(b.assignedTo, 100);
  if (Array.isArray(b.people)) {
    for (const u of b.people) {
      const p = record.people[Number(u && u.index)];
      if (!p) continue;
      if (u.done && typeof u.done === 'object') {
        p.done = p.done || {};
        KINDS.forEach(k => { if (u.done[k] !== undefined) p.done[k] = !!u.done[k]; });
      }
      if (u.siteDone && typeof u.siteDone === 'object' && Array.isArray(p.sites)) {
        p.siteDone = p.siteDone || {};
        p.sites.forEach(s => { if (u.siteDone[s.id] !== undefined) p.siteDone[s.id] = !!u.siteDone[s.id]; });
        p.done = p.done || {};
        if (p.sites.length) p.done.hub = p.sites.every(s => p.siteDone[s.id]);
      }
      if (u.createdEmail !== undefined) p.createdEmail = clean(u.createdEmail, 120).toLowerCase();
      if (u.workEmail !== undefined && isLeaver(record)) p.workEmail = clean(u.workEmail, 120).toLowerCase();
      if (u.msDisplayName !== undefined) p.msDisplayName = clean(u.msDisplayName, 120);
      if (u.perigeeUsername !== undefined) p.perigeeUsername = clean(u.perigeeUsername, 120);
      if (u.dextUsername !== undefined) p.dextUsername = clean(u.dextUsername, 120);
      if (u.owners && typeof u.owners === 'object' && isIT) {
        p.owners = p.owners || {};
        KINDS.forEach(k => { if (u.owners[k] !== undefined && p[NEEDS[k]]) p.owners[k] = clean(u.owners[k], 100); });
      }
      p.accountInfoUpdatedBy = session.preview ? session.preview.actor : session.username;
      p.accountInfoUpdatedAt = new Date().toISOString();
    }
  }
  record.updatedAt = now;
  record.updatedBy = session.username;
  // Ticking the last account / site after HR already got every email also completes it.
  let completed = null;
  if (b.status === undefined && Array.isArray(b.people)) completed = await autoComplete(record, actor);

  await blob.putJson(recordPath(id), record);
  const index = (await blob.getJson(INDEX_PATH).catch(() => null)) || [];
  const i = index.findIndex(r => r.ticketID === id);
  if (i !== -1) index[i] = indexEntry(record); else index.unshift(indexEntry(record));
  await blob.putJson(INDEX_PATH, index);

  // Status changed → SharePoint row (+ calendar booking cancelled on
  // Resolved / Closed) and a status email to the HR person who logged it.
  let sharepoint = null;
  if (completed) sharepoint = completed.sharepoint;
  else if (record.status !== oldStatus) {
    sharepoint = record.test ? { ok: true, skipped: 'test' } : await syncStatus({ ticketID: id, status: record.status, oldStatus, row: isIT ? b.sp : null });
    if (!record.test && !b.quiet) await statusEmail(record, oldStatus, actor).catch(err => console.error('status email:', err.message));
  }
  return res.status(200).json({ ok: true, record, sharepoint, completed });
}

/** Auto-completes a request once every account is done and HR has been emailed. */
async function autoComplete(record, by) {
  if (['Resolved', 'Closed'].includes(record.status)) return null;
  const done = record.people.every(isPersonDone) && record.people.every(x => x.handover && !(x.handover.pending || []).length);
  if (!done) return null;
  const old = record.status || 'Open';
  record.status = 'Resolved';
  (record.statusHistory = record.statusHistory || []).push({ status: 'Resolved', at: new Date().toISOString(), by: `${by} (auto — all accounts done, HR emailed)` });
  const sharepoint = record.test ? { ok: true, skipped: 'test' } : await syncStatus({ ticketID: record.ticketID, status: 'Resolved', oldStatus: old });
  return { status: 'Resolved', sharepoint };
}

async function statusEmail(record, oldStatus, by) {
  if (!record.requesterEmail) return;
  const kind = isLeaver(record) ? 'Leaver request' : 'Account request';
  await sendEmail({
    to: record.requesterEmail,
    subject: `${kind} ${record.ticketID} — status changed to ${record.status}`,
    html: emailHtml({ heading: 'Request Status Update', ticketID: record.ticketID, code: record.verificationCode,
      intro: `Your ${kind.toLowerCase()} is now <strong>${esc(record.status)}</strong> (was ${esc(oldStatus)}), updated by ${esc(by)}.`,
      table: '', buttonUrl: `https://iram-it-portal.vercel.app/admin/${isLeaver(record) ? 'leaver-request' : 'account-request'}`, buttonLabel: 'View my requests' })
  });
}

// ── Handover settings (who gets the account-details emails) ─────────────────
const listOf = v => (Array.isArray(v) ? v : String(v || '').split(/[,;\s]+/))
  .map(e => String(e).trim().toLowerCase()).filter(Boolean);

function defaultSettings() {
  return {
    hrEmails:          listOf(process.env.HR_EMAIL || 'hr@iram.co.za'),
    perigeeAdminEmails: [],   // Perigee support admin(s)
    itManagerEmails:   [],    // the IT tech's line manager(s)
    dextEmails:        [],    // who creates Dext accounts — blank = Perigee admin(s) + HR
    includeSubmitter:  true,  // the HR person who logged the request
    includeSupervisor: true,  // the new starter's supervisor (from the request)
    owners: { microsoft: [], perigee: [], dext: [], hub: [] }, // "Who does what" — see parseOwners
    // Leavers: the iRam Hub and the sites linked to it, removed by the hub owner.
    hubSites: [{ name: 'iRam Hub', url: 'https://iram-hub.vercel.app/dashboard' }], // older list — see `sites`
    sites: null, // the Sites register (admin/sites.html); null = built from hubSites
    remindersEnabled:  true,  // weekday-morning reminders to each tech (api/admin/reminders.js)
    reminderFallbackEmails: [] // who gets UNASSIGNED open items — blank = IT manager(s), then IT_EMAIL
  };
}

async function loadSettings() {
  const saved = await blob.getJson(SETTINGS_PATH).catch(() => null);
  const s = Object.assign(defaultSettings(), saved || {});
  if (!Array.isArray(s.sites)) s.sites = (s.hubSites || []).map((x, i) => ({ id: siteId(x.name, i), name: x.name, url: x.url, adminUrl: '', use: 'both', match: '', addSteps: '', removeSteps: '' }));
  // Not saved here: everyone ticked "Perigee" in Settings -> IT Staff is also
  // treated as Perigee support, so they get the same emails as the admin(s).
  try {
    const { config } = await loadConfig();
    s.perigeeStaffEmails = (config.itStaff || []).filter(x => x.isPerigee).map(x => String(x.email || '').toLowerCase()).filter(isEmail);
    s.staffNames = (config.itStaff || []).map(x => String(x.name || '').trim()).filter(Boolean);
  } catch (_) { s.perigeeStaffEmails = []; s.staffNames = []; }
  return s;
}

/** Perigee support people: the admin(s) in Email settings + IT Staff ticked Perigee. */
function perigeePeople(settings) {
  return [...new Set([...(settings.perigeeAdminEmails || []), ...(settings.perigeeStaffEmails || [])].filter(isEmail))];
}

async function handleSaveSettings(req, res, session) {
  const b = req.body || {};
  const next = defaultSettings();
  for (const k of ['hrEmails', 'perigeeAdminEmails', 'itManagerEmails', 'dextEmails', 'reminderFallbackEmails']) {
    const list = listOf(b[k]);
    const bad = list.find(e => !isEmail(e));
    if (bad) return res.status(400).json({ error: `"${bad}" isn't a valid email address.` });
    next[k] = list;
  }
  // Who does what: names must exist in Settings → IT Staff.
  let staffNames = [];
  try { const { config } = await loadConfig(); staffNames = (config.itStaff || []).map(x => String(x.name || '').trim().toLowerCase()); } catch (_) {}
  next.owners = {};
  for (const k of KINDS) {
    const list = parseOwners((b.owners || {})[k]);
    const unknown = staffNames.length && list.find(o => !staffNames.includes(o.name.toLowerCase()));
    if (unknown) return res.status(400).json({ error: `"${unknown.name}" isn't in Settings → IT Staff — add them there first (or check the spelling).` });
    next.owners[k] = list;
  }
  if (b.hubSites !== undefined) {
    const lines = Array.isArray(b.hubSites) ? b.hubSites : String(b.hubSites || '').split(/\r?\n/);
    next.hubSites = [];
    for (const raw of lines) {
      const line = typeof raw === 'object' && raw ? `${raw.name || ''} | ${raw.url || ''}` : String(raw);
      if (!line.replace(/\|/g, '').trim()) continue;
      const [a, c] = line.includes('|') ? line.split('|') : [line, ''];
      let name = a.trim(), url = String(c || '').trim();
      if (!url && /^https?:\/\//i.test(name)) { url = name; name = name.replace(/^https?:\/\//i, '').split('/')[0]; }
      if (url && !/^https?:\/\/[^\s]+$/i.test(url)) return res.status(400).json({ error: `"${url}" isn't a valid web address (start it with https://).` });
      next.hubSites.push({ name: clean(name, 80), url: clean(url, 300) });
    }
  } else {
    const prevSites = await blob.getJson(SETTINGS_PATH).catch(() => null);
    if (prevSites && prevSites.hubSites) next.hubSites = prevSites.hubSites;
  }
  next.includeSubmitter  = b.includeSubmitter !== false;
  next.includeSupervisor = b.includeSupervisor !== false;
  next.remindersEnabled  = b.remindersEnabled !== false;
  const prev = await blob.getJson(SETTINGS_PATH).catch(() => null);
  if (prev && prev.lastReminderRun) next.lastReminderRun = prev.lastReminderRun;
  if (prev && Array.isArray(prev.sites)) next.sites = prev.sites; // managed on the Sites page
  next.updatedAt = new Date().toISOString();
  next.updatedBy = session.username;
  await blob.putJson(SETTINGS_PATH, next);
  return res.status(200).json({ ok: true, settings: next });
}

// ── Sites register ──────────────────────────────────────────────────────────
const SITE_USE = ['both', 'starters', 'leavers'];
function siteId(name, i) { return (String(name || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'site') + '-' + (i == null ? crypto.randomInt(1000, 10000) : i); }
/** Sites that apply to person `p` for a 'starter' or 'leaver' request. */
function sitesFor(p, type, sites) {
  const hay = [p.department, p.jobTitle, p.region, p.teamName, p.perigeeRole].join(' | ').toLowerCase();
  return (sites || []).filter(s => s && s.active !== false && (s.use === 'both' || s.use === (type === 'leaver' ? 'leavers' : 'starters')))
    .filter(s => { const keys = String(s.match || '').split(/[,;\n]+/).map(k => k.trim().toLowerCase()).filter(Boolean); return !keys.length || keys.some(k => hay.includes(k)); })
    .map(s => ({ id: s.id, name: s.name, url: s.adminUrl || s.url || '', steps: (type === 'leaver' ? s.removeSteps : s.addSteps) || '' }));
}
async function handleSaveSites(req, res, session) {
  const raw = Array.isArray((req.body || {}).sites) ? req.body.sites.slice(0, 100) : null;
  if (!raw) return res.status(400).json({ error: 'No sites sent.' });
  const ids = new Set(), sites = [];
  for (let i = 0; i < raw.length; i++) {
    const x = raw[i] || {};
    const name = clean(x.name, 80);
    if (!name) return res.status(400).json({ error: `Site ${i + 1}: give it a name.` });
    const url = clean(x.url, 300), adminUrl = clean(x.adminUrl, 300);
    for (const u of [url, adminUrl]) if (u && !/^https?:\/\/\S+$/i.test(u)) return res.status(400).json({ error: `${name}: "${u}" isn't a web address (start it with https://).` });
    let id = clean(x.id, 40).replace(/[^a-z0-9-]/gi, '');
    if (!id || ids.has(id)) id = siteId(name);
    ids.add(id);
    sites.push({ id, name, url, adminUrl, use: SITE_USE.includes(x.use) ? x.use : 'both', match: clean(x.match, 300),
      addSteps: String(x.addSteps || '').trim().slice(0, 1500), removeSteps: String(x.removeSteps || '').trim().slice(0, 1500),
      owner: clean(x.owner, 80), notes: String(x.notes || '').trim().slice(0, 1000), active: x.active !== false });
  }
  const saved = (await blob.getJson(SETTINGS_PATH).catch(() => null)) || {};
  saved.sites = sites;
  saved.hubSites = sites.map(s => ({ name: s.name, url: s.url })); // keeps older readers working
  saved.sitesUpdatedAt = new Date().toISOString(); saved.sitesUpdatedBy = session.username;
  await blob.putJson(SETTINGS_PATH, saved);
  return res.status(200).json({ ok: true, sites, sitesUpdatedAt: saved.sitesUpdatedAt, sitesUpdatedBy: saved.sitesUpdatedBy });
}

/** Everyone who should get the account details for person `p` of `record`. */
function handoverRecipients(settings, record, p) {
  return [...new Set([
    ...(settings.includeSubmitter ? [record.requesterEmail] : []),
    ...settings.hrEmails,
    ...perigeePeople(settings),       // always kept in the loop
    ...(settings.includeSupervisor ? [p.managerEmail] : []),
    ...settings.itManagerEmails
  ].map(e => String(e || '').toLowerCase()).filter(e => e && isEmail(e)))];
}
function dextRecipients(settings) {
  const list = settings.dextEmails && settings.dextEmails.length ? settings.dextEmails : [...perigeePeople(settings), ...settings.hrEmails];
  return [...new Set(list.filter(isEmail))];
}
/** TEST requests: the tester plus the Perigee support people (marked TEST) —
 *  never HR, the submitter or the supervisor. */
function testRecipients(settings, actorEmail) {
  return [...new Set([actorEmail, ...perigeePeople(settings)].filter(isEmail))];
}

/** Emails the "Dext account needed" request for person `p`; returns who it went to. */
async function sendDextRequest(record, p, settings, actorEmail, msUser, pgUser) {
  const ownerEmail = await staffEmail((p.owners || {}).dext);
  const to = [...new Set([...(record.test ? testRecipients(settings, actorEmail) : dextRecipients(settings)), ...(ownerEmail ? [ownerEmail] : [])])];
  if (!to.length) return [];
  const name = fullName(p);
  const rows = [
    ['Name', name], ['Job / department', `${p.jobTitle} · ${p.department}`], ['Region', p.region],
    ['Cell', p.cellphone], ['Personal email', p.personalEmail], ['Start date', p.startDate],
    ['Supervisor', [p.managerName, p.managerEmail].filter(Boolean).join(' · ')],
    ['Microsoft 365 email', msUser || p.createdEmail || ''],
    ['Perigee username', pgUser || p.perigeeUsername || '']
  ].filter(([, v]) => v);
  if (isLeaver(record)) {
    const lrows = [
      ['Name', name], ['Work email', p.workEmail], ['Job / department', [p.jobTitle, p.department].filter(Boolean).join(' · ')],
      ['Region', p.region], ['Last working day', p.lastDay], ['Remove access', CUTOFF[p.cutOff] || CUTOFF.end_of_day],
      ['Dext username', p.dextUsername || ''], ['Supervisor', [p.managerName, p.managerEmail].filter(Boolean).join(' · ')]
    ].filter(([, v]) => v);
    await sendEmail({
      to, subject: `${record.test ? '[TEST] ' : ''}${p.cutOff === 'immediately' ? 'URGENT — ' : ''}Remove Dext access: ${name} (${record.ticketID})`,
      html: emailHtml({ heading: 'Leaver — Remove Dext Access', ticketID: record.ticketID, code: record.verificationCode, test: record.test,
        intro: `Please <strong>remove / deactivate the Dext account</strong> for <strong>${esc(name)}</strong> ${p.cutOff === 'immediately' ? '<strong style="color:#a4262c">immediately</strong>' : `at the end of their last day (${esc(p.lastDay)})`}, then tick Dext as removed in the queue.`,
        table: kvTable(lrows), buttonUrl: `https://iram-it-portal.vercel.app/admin/new-starters?id=${encodeURIComponent(record.ticketID)}`, buttonLabel: 'Open in the queue' })
    });
    return to;
  }
  await sendEmail({
    to, subject: `${record.test ? '[TEST] ' : ''}Dext account needed: ${name} (${record.ticketID})`,
    html: emailHtml({ heading: 'Dext Account Needed', ticketID: record.ticketID, code: record.verificationCode, test: record.test,
      intro: `Please create a <strong>Dext</strong> account for <strong>${esc(name)}</strong> and record the Dext username in the New Starter Queue when it's done. Final details below.`,
      table: kvTable(rows), buttonUrl: `https://iram-it-portal.vercel.app/admin/new-starters?id=${encodeURIComponent(record.ticketID)}`, buttonLabel: 'Open in New Starter Queue' })
  });
  return to;
}

// ── Manual "Send Dext request" (first time or resend) ───────────────────────
async function handleDextRequest(req, res, session, isIT) {
  const b  = req.body || {};
  const id = clean(b.ticketID, 40).toUpperCase();
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad_id' });
  const record = await blob.getJson(recordPath(id)).catch(() => null);
  if (!record || record.deleted) return res.status(404).json({ error: 'not_found' });
  if (session.preview && !record.test) return res.status(403).json({ error: PREVIEW_MESSAGE, message: 'In preview test mode you can only work on TEST requests.' });
  if (!isIT && ['Resolved', 'Closed'].includes(record.status)) return res.status(403).json({ error: 'This request is completed — ask IT to reopen it if something needs changing.' });
  const p = record.people[Number(b.index)];
  if (!p) return res.status(400).json({ error: 'Unknown person.' });
  if (!p.needsDext) return res.status(400).json({ error: 'This person doesn\'t need Dext.' });

  const settings = await loadSettings();
  const actorUser = await getUser(session.preview ? session.preview.actor : session.username).catch(() => null);
  let to;
  try { to = await sendDextRequest(record, p, settings, actorUser && actorUser.email); }
  catch (err) { console.error('dext email failed:', err.message); return res.status(502).json({ error: 'The Dext email could not be sent. Try again.' }); }
  if (!to.length) return res.status(400).json({ error: 'Nobody to send the Dext request to — add the Perigee support admin in ⚙ Email settings.' });

  const now = new Date().toISOString();
  p.dextRequestedAt = now; p.dextRequestedTo = to;
  (p.dextRequestLog = p.dextRequestLog || []).push({ at: now, by: session.preview ? session.preview.actor : session.username, to });
  record.updatedAt = now;
  await blob.putJson(recordPath(id), record);
  return res.status(200).json({ ok: true, record, dextTo: to });
}

// ── Leavers: confirm to HR what was removed ─────────────────────────────────
async function handleLeaverConfirm(req, res, session, isIT) {
  const b  = req.body || {};
  const id = clean(b.ticketID, 40).toUpperCase();
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad_id' });
  const record = await blob.getJson(recordPath(id)).catch(() => null);
  if (!record || record.deleted) return res.status(404).json({ error: 'not_found' });
  if (!isLeaver(record)) return res.status(400).json({ error: 'Not a leaver request.' });
  if (session.preview && !record.test) return res.status(403).json({ error: PREVIEW_MESSAGE, message: 'In preview test mode you can only work on TEST requests.' });
  if (!isIT && ['Resolved', 'Closed'].includes(record.status)) return res.status(403).json({ error: 'This request is completed — ask IT to reopen it if something needs changing.' });
  const p = record.people[Number(b.index)];
  if (!p) return res.status(400).json({ error: 'Unknown person.' });
  const d = p.done || {};
  const removed = KINDS.filter(k => p[NEEDS[k]] && d[k]);
  const pending = KINDS.filter(k => p[NEEDS[k]] && !d[k]);
  if (!removed.length) return res.status(400).json({ error: 'Tick at least one account as removed first.' });

  const settings = await loadSettings();
  const actor = session.preview ? session.preview.actor : session.username;
  const actorUser = await getUser(actor).catch(() => null);
  const to = record.test ? testRecipients(settings, actorUser && actorUser.email) : handoverRecipients(settings, record, p);
  if (!to.length) return res.status(400).json({ error: 'Nobody to email — add recipients in ⚙ Settings.' });
  const name = fullName(p);
  const sites = (Array.isArray(p.sites) ? p.sites : (settings.hubSites || [])).map(x => x.name).filter(Boolean).join(', ');
  const label = k => k === 'hub' && sites ? `iRam Hub & linked sites (${sites})` : k === 'perigee' ? 'Perigee / FieldGoose' : KIND_LABEL[k];
  const rows = [
    ['Name', name], ['Work email', p.workEmail], ['Job / department', [p.jobTitle, p.department].filter(Boolean).join(' · ')],
    ['Region', p.region], ['Last working day', p.lastDay],
    ...removed.map(k => [`✔ ${label(k)}`, 'Access removed']),
    ...pending.map(k => [`⏳ ${label(k)}`, 'Still to be removed']),
    ...(p.needsMicrosoft && d.microsoft ? [['Mailbox', MAILBOX[p.mailbox] + (p.mailbox !== 'none' && p.mailboxTo ? ` (${p.mailboxTo})` : '')]] : [])
  ].filter(([, v]) => v);
  try {
    await sendEmail({
      to, subject: `${record.test ? '[TEST] ' : ''}Access removed: ${name}${pending.length ? ' (partly — ' + pending.length + ' still to do)' : ''} (${id})`,
      html: emailHtml({ heading: 'Leaver — Access Removed', ticketID: id, code: record.verificationCode, test: record.test,
        intro: pending.length
          ? `Access for <strong>${esc(name)}</strong> has been <strong>partly</strong> removed. The rest will follow — you'll get another confirmation.`
          : `All the access HR asked for has been <strong>removed</strong> for <strong>${esc(name)}</strong>.${p.needsMicrosoft && p.mailbox === 'shared' && p.mailboxTo ? ` Their mailbox is now a shared mailbox that <strong>${esc(p.mailboxTo)}</strong> can open in Outlook.` : ''}`,
        table: kvTable(rows),
        footer: 'Laptops, phones, SIM cards and access cards still need to be collected by the supervisor / HR.' })
    });
  } catch (err) {
    console.error('leaver confirm email failed:', err.message);
    return res.status(502).json({ error: 'The email could not be sent. Try again.' });
  }
  const now = new Date().toISOString();
  p.handover = { sentAt: now, by: actor, to, accounts: removed.map(k => KIND_LABEL[k]), pending: pending.map(k => KIND_LABEL[k]) };
  (p.handoverLog = p.handoverLog || []).push(p.handover);
  if (record.status === 'Open') {
    record.status = 'In Progress';
    (record.statusHistory = record.statusHistory || []).push({ status: 'In Progress', at: now, by: actor });
  }
  record.updatedAt = now; record.updatedBy = actor;
  const completed = await autoComplete(record, actor);
  await blob.putJson(recordPath(id), record);
  const index = (await blob.getJson(INDEX_PATH).catch(() => null)) || [];
  const k = index.findIndex(r => r.ticketID === id);
  if (k !== -1) { index[k] = indexEntry(record); await blob.putJson(INDEX_PATH, index); }
  return res.status(200).json({ ok: true, record, sentTo: to, allDone: !!completed, completed });
}

// ── Handover: email the finished account details ────────────────────────────
async function handleHandover(req, res, session, isIT) {
  const b  = req.body || {};
  const id = clean(b.ticketID, 40).toUpperCase();
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad_id' });
  const record = await blob.getJson(recordPath(id)).catch(() => null);
  if (!record || record.deleted) return res.status(404).json({ error: 'not_found' });
  if (session.preview && !record.test) return res.status(403).json({ error: PREVIEW_MESSAGE, message: 'In preview test mode you can only work on TEST requests.' });
  if (!isIT && ['Resolved', 'Closed'].includes(record.status)) return res.status(403).json({ error: 'This request is completed — ask IT to reopen it if something needs changing.' });
  const i = Number(b.index);
  const p = record.people[i];
  if (!p) return res.status(400).json({ error: 'Unknown person.' });

  // Passwords: used for this email only, never written anywhere.
  const raw = v => String(v == null ? '' : v).trim().slice(0, 200);
  // Each account is optional — send whichever ones are filled in (e.g. the
  // Perigee admin may only have done Perigee and Dext). A password with no
  // username (or vice versa) is an error rather than a half-sent login.
  const ms = b.ms || {}, pg = b.perigee || {}, dx = b.dext || {};
  const filled = o => !!(String(o.password || '').trim());
  const msInfo = p.needsMicrosoft && filled(ms) ? { displayName: clean(ms.displayName, 120), username: clean(ms.username, 120), password: raw(ms.password) } : null;
  const pgInfo = p.needsPerigee   && filled(pg) ? { username: clean(pg.username, 120), password: raw(pg.password) } : null;
  const dxInfo = p.needsDext      && clean(dx.username, 120) ? { username: clean(dx.username, 120), password: raw(dx.password) } : null;
  if (msInfo && (!msInfo.username || !isEmail(msInfo.username))) return res.status(400).json({ error: 'Enter the Microsoft 365 username (the email address created).' });
  if (pgInfo && !pgInfo.username) return res.status(400).json({ error: 'Enter the Perigee username / email.' });
  if (!msInfo && !pgInfo && !dxInfo) return res.status(400).json({ error: 'Fill in at least one account (username + password) to send.' });

  const settings = await loadSettings();
  const actorUser = await getUser(session.preview ? session.preview.actor : session.username).catch(() => null);
  const actorEmail = actorUser && actorUser.email;
  // TEST requests: the tester + Perigee support people, marked TEST.
  let to = record.test ? testRecipients(settings, actorEmail) : handoverRecipients(settings, record, p);
  if (!to.length) return res.status(400).json({ error: 'Nobody to email — add recipients in ⚙ Email settings.' });
  const tag = record.test ? '[TEST] ' : '';
  const name = fullName(p);
  const now = new Date().toISOString();

  const rows = [];
  if (msInfo) rows.push(['Microsoft 365', [
    ['Display name', msInfo.displayName || `${p.firstName} ${p.lastName}`],
    ['Username / email', msInfo.username],
    ['Temporary password', msInfo.password, true],
    ['Sign in at', 'https://portal.office.com (Outlook, Teams) — they\'ll be asked to set a new password']
  ]]);
  if (dxInfo) rows.push(['Dext', [
    ['Username / email', dxInfo.username],
    ['Password', dxInfo.password, true]
  ]]);
  if (pgInfo) rows.push(['Perigee', [
    ['Username / email', pgInfo.username],
    ['Password', pgInfo.password, true],
    ['Role / team', [p.perigeeRole, p.teamName].filter(Boolean).join(' · ')],
    ['Province', p.region]
  ]]);
  const personRows = [
    ['Name', name], ['Job / department', `${p.jobTitle} · ${p.department}`], ['Region', p.region],
    ['Cell', p.cellphone], ['Personal email', p.personalEmail], ['Start date', p.startDate],
    ['Supervisor', [p.managerName, p.managerEmail].filter(Boolean).join(' · ')],
    ['Sites', (p.sites || []).map(s => `${s.name}${(p.siteDone || {})[s.id] ? ' ✔' : ' (being set up)'}`).join(', ')]
  ].filter(([, v]) => v);

  const accountTables = rows.map(([title, list]) => `
    <p style="margin:22px 0 8px;font-size:15px;font-weight:800;color:#2D2D2D">${esc(title)}</p>
    ${kvTable(list.filter(([, v]) => v))}`).join('');

  try {
    await sendEmail({
      to, subject: `${tag}Accounts ready: ${name} — ${[msInfo && 'Microsoft 365', pgInfo && 'Perigee', dxInfo && 'Dext'].filter(Boolean).join(' & ')} (${id})`,
      html: emailHtml({ heading: 'New Starter Accounts Ready', ticketID: id, code: record.verificationCode, test: record.test,
        intro: `The accounts for <strong>${esc(name)}</strong> are set up. Please pass these details on securely and delete this email once handed over.${p.needsDext && !dxInfo && !(p.done || {}).dext ? ' A separate request has gone out for their <strong>Dext</strong> account.' : ''}`,
        table: kvTable(personRows) + accountTables,
        footer: '🔒 Contains passwords — do not forward. The portal does not store these passwords.' })
    });
  } catch (err) {
    console.error('handover email failed:', err.message);
    return res.status(502).json({ error: 'The email could not be sent — nothing was saved. Try again.' });
  }

  // Dext: ask whoever creates Dext accounts, with the final usernames.
  let dextTo = [];
  // Only ask for Dext if it isn't being handed over now and wasn't already done/requested.
  if (p.needsDext && !dxInfo && !(p.done || {}).dext && !p.dextRequestedAt) {
    try { dextTo = await sendDextRequest(record, p, settings, actorEmail, msInfo && msInfo.username, pgInfo && pgInfo.username); }
    catch (err) { console.error('dext email failed:', err.message); dextTo = []; }
  }

  // Save what's safe to keep (usernames, who was told) — never passwords.
  p.done = p.done || {};
  if (msInfo) { p.createdEmail = msInfo.username.toLowerCase(); p.msDisplayName = msInfo.displayName; p.done.microsoft = true; }
  if (pgInfo) { p.perigeeUsername = pgInfo.username; p.done.perigee = true; }
  if (dxInfo) { p.dextUsername = dxInfo.username; p.done.dext = true; }
  // Requesting Dext isn't the same as Dext existing — it stays open until
  // whoever creates it records the username / ticks it (or sends its login).
  if (dextTo.length) {
    p.dextRequestedAt = now; p.dextRequestedTo = dextTo;
    (p.dextRequestLog = p.dextRequestLog || []).push({ at: now, by: session.preview ? session.preview.actor : session.username, to: dextTo });
  }
  p.handover = { sentAt: now, by: session.preview ? session.preview.actor : session.username, to,
    accounts: [msInfo && 'Microsoft 365', pgInfo && 'Perigee', dxInfo && 'Dext'].filter(Boolean) };
  (p.handoverLog = p.handoverLog || []).push(p.handover);
  if (record.status === 'Open') {
    record.status = 'In Progress';
    (record.statusHistory = record.statusHistory || []).push({ status: 'In Progress', at: now, by: p.handover.by });
  }
  record.updatedAt = now; record.updatedBy = p.handover.by;
  const completed = await autoComplete(record, p.handover.by);
  await blob.putJson(recordPath(id), record);
  const index = (await blob.getJson(INDEX_PATH).catch(() => null)) || [];
  const k = index.findIndex(r => r.ticketID === id);
  if (k !== -1) { index[k] = indexEntry(record); await blob.putJson(INDEX_PATH, index); }

  return res.status(200).json({ ok: true, record, sentTo: to, dextTo, allDone: !!completed, completed });
}

function kvTable(list) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;font-size:13px;border-collapse:collapse">${
    list.map(([k, v, mono], i) => `<tr style="background:${i % 2 ? '#fff' : '#fafafa'}"><td style="padding:9px 14px;font-weight:600;color:#555;width:170px">${esc(k)}</td><td style="padding:9px 14px;color:#222${mono ? ';font-family:Consolas,monospace;font-size:14px;font-weight:700' : ''}">${esc(v)}</td></tr>`).join('')
  }</table>`;
}

// ── DELETE ?id=TEST-… (clear out test records) ───────────────────────────────
async function handleDeleteTest(req, res) {
  const id = clean((req.query || {}).id, 40).toUpperCase();
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad_id' });
  const record = await blob.getJson(recordPath(id)).catch(() => null);
  if (!record) return res.status(404).json({ error: 'not_found' });
  if (!record.test) return res.status(400).json({ error: 'Only TEST requests can be deleted.' });
  // Blob has no delete in lib/blob.js — blank the record and drop it from the index.
  await blob.putJson(recordPath(id), { deleted: true, ticketID: id, test: true });
  const index = (await blob.getJson(INDEX_PATH).catch(() => null)) || [];
  await blob.putJson(INDEX_PATH, index.filter(r => r.ticketID !== id));
  return res.status(200).json({ ok: true });
}

// ── Email helpers ───────────────────────────────────────────────────────────
function peopleTable(people) {
  const head = ['Name', 'Job / Dept', 'Region', 'Cell', 'Accounts'].map(h =>
    `<th style="text-align:left;padding:8px 10px;background:#f4f6f8;font-size:11px;color:#666;text-transform:uppercase">${h}</th>`).join('');
  const rows = people.map((p, i) => {
    const bg = i % 2 ? '#ffffff' : '#fafafa';
    return `<tr style="background:${bg}">
      <td style="padding:8px 10px"><strong>${esc(fullName(p))}</strong>${p.startDate ? `<br><span style="color:#888;font-size:11px">Starts ${esc(p.startDate)}</span>` : ''}</td>
      <td style="padding:8px 10px">${esc(p.jobTitle)}<br><span style="color:#888;font-size:11px">${esc(p.department)}</span></td>
      <td style="padding:8px 10px">${esc(p.region)}</td>
      <td style="padding:8px 10px;white-space:nowrap">${esc(p.cellphone)}</td>
      <td style="padding:8px 10px">${esc(services(p).join(', '))}</td></tr>`;
  }).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;font-size:12.5px;border-collapse:collapse"><tr>${head}</tr>${rows}</table>`;
}

function leaverTable(people) {
  const head = ['Name', 'Job / Dept', 'Last day', 'Remove', 'Mailbox'].map(h =>
    `<th style="text-align:left;padding:8px 10px;background:#f4f6f8;font-size:11px;color:#666;text-transform:uppercase">${h}</th>`).join('');
  const rows = people.map((p, i) => `<tr style="background:${i % 2 ? '#ffffff' : '#fafafa'}">
      <td style="padding:8px 10px"><strong>${esc(fullName(p))}</strong>${p.workEmail ? `<br><span style="color:#888;font-size:11px">${esc(p.workEmail)}</span>` : ''}${p.reason ? `<br><span style="color:#888;font-size:11px">${esc(p.reason)}</span>` : ''}</td>
      <td style="padding:8px 10px">${esc(p.jobTitle || '—')}<br><span style="color:#888;font-size:11px">${esc([p.department, p.region].filter(Boolean).join(' · '))}</span></td>
      <td style="padding:8px 10px;white-space:nowrap">${esc(p.lastDay)}${p.cutOff === 'immediately' ? '<br><strong style="color:#a4262c;font-size:11px">CUT OFF NOW</strong>' : ''}</td>
      <td style="padding:8px 10px">${esc(services(p).join(', '))}</td>
      <td style="padding:8px 10px;font-size:11.5px">${p.needsMicrosoft ? esc(p.mailbox === 'none' ? 'Block only' : `${p.mailbox === 'forward' ? 'Forward' : 'Shared'} → ${p.mailboxTo || '—'}`) : '—'}</td></tr>`).join('');
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;font-size:12.5px;border-collapse:collapse"><tr>${head}</tr>${rows}</table>`;
}

function emailHtml({ heading, intro, ticketID, code, table, buttonUrl, buttonLabel, footer, test }) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Segoe UI,Arial,sans-serif;background:#f4f6f8">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <tr><td style="background:#2D2D2D;padding:26px 32px;text-align:center">
    <p style="margin:0;color:#fff;font-size:22px;font-weight:700">iRam IT Support</p>
    <p style="margin:8px 0 0;color:#6BBF4E;font-size:12px;text-transform:uppercase;letter-spacing:1.5px">${esc(heading)}</p>
  </td></tr>
  ${test ? `<tr><td style="background:#5b2ea6;color:#fff;padding:12px 32px;text-align:center;font-size:15px;font-weight:800;letter-spacing:1px">🧪 TEST REQUEST — AUTO-COMPLETED — NO ACTION NEEDED</td></tr>` : ''}
  <tr><td style="background:#edf7e8;padding:20px 32px;text-align:center;border-bottom:2px solid #6BBF4E">
    <p style="margin:0;font-size:28px;font-weight:700;color:#4e9938;letter-spacing:2px">${esc(ticketID)}</p>
    <p style="margin:8px 0 0;color:#2f6b1a;font-size:13px">✅ Verified HR request &nbsp;·&nbsp; Code <strong style="font-family:monospace;font-size:15px">${esc(code)}</strong></p>
  </td></tr>
  <tr><td style="padding:24px 32px">
    <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.7">${intro}</p>
    ${table}
    ${buttonUrl ? `<p style="margin:22px 0 0;text-align:center"><a href="${esc(buttonUrl)}" style="display:inline-block;background:#4e9938;color:#fff;text-decoration:none;font-weight:700;padding:11px 22px;border-radius:8px;font-size:14px">${esc(buttonLabel)}</a></p>` : ''}
    ${footer ? `<p style="margin:12px 0 0;text-align:center;color:#999;font-size:11.5px">${esc(footer)}</p>` : ''}
  </td></tr>
  <tr><td style="background:#f4f6f8;padding:16px 32px;text-align:center;border-top:1px solid #e8e8e8">
    <p style="margin:0;color:#aaa;font-size:11px">iRam IT Support Portal &nbsp;|&nbsp; Please do not reply to this email</p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

async function sendEmail({ to, bcc, subject, html }) {
  const toList = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!toList.length || !process.env.RESEND_API_KEY) return;
  const payload = { from: 'iRam IT Support <noreply@outerjoin.co.za>', to: toList, subject, html };
  if (bcc) payload.bcc = [bcc];
  const r = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload)
  });
  if (!r.ok) throw new Error(await r.text());
}
