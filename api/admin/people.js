// ──────────────────────────────────────────────────────────────────────────────
// Access Summary (admin/people.html): one row per PERSON, pulled together from
//   - the Microsoft 365 user list (lib/ms-directory.js, synced nightly)
//   - the FieldGoose / Perigee user export (lib/fg-directory.js, uploaded)
//   - every site on the Sites page — either an ACCOUNT site (people log in)
//     or a REFERENCE site (their email is just used / listed there, e.g. the
//     Org Builder org tree). Data per site: an uploaded user list, or pulled
//     live from Org Builder (lib/org-tree.js: org tree / call cycle)
//   - the starter / leaver requests logged in this portal (+ their site ticks)
// People are matched across sources by email / username, then cell, then name
// (only when the name points to exactly one person).
//
// For every source the row answers two things:
//   1. HAS — account / reference found (active or not), or not found
//   2. NEEDS — does this person even need it? From the site's "who needs it"
//      rule, or a manual decision saved per person (POST ?action=needs).
// Mismatches become issues (leaver still active somewhere, has access they
// don't need, needs access they don't have, duplicates, MS blocked but still
// active elsewhere…).
//
// GET                                  → { generatedAt, sources, columns, people, counts }
// POST ?action=needs { key, col, value: 'yes'|'no'|'', note }  → saves a manual decision
// IT + the Perigee Support Admin.
// ──────────────────────────────────────────────────────────────────────────────
const { verifyToken, sessionTokenFromRequest } = require('../../lib/auth');
const { hasPermission } = require('../../lib/roles');
const msDir = require('../../lib/ms-directory.js');
const fgDir = require('../../lib/fg-directory.js');
const orgTree = require('../../lib/org-tree.js');
const blob  = require('../../lib/blob.js');

const INDEX_PATH = 'account-requests/index.json';
const SETTINGS_PATH = 'account-requests/settings.json';
const NEEDS_PATH = 'access/needs.json';
const MAX_RECORDS = 250;
const low = v => String(v || '').trim().toLowerCase();
const { slug, nameKey, normaliseMobile } = fgDir;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const session = verifyToken(sessionTokenFromRequest(req));
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  if (!hasPermission(session.role, 'manageTickets') && !hasPermission(session.role, 'updateAccounts')) return res.status(403).json({ error: 'forbidden' });
  if (!blob.isConfigured()) return res.status(503).json({ error: 'Storage isn\'t configured.' });
  try {
    if (req.method === 'GET') return res.status(200).json(await build());
    if (req.method === 'POST' && (req.query || {}).action === 'needs') {
      if (session.preview) return res.status(403).json({ error: 'Not in preview test mode.' });
      const b = req.body || {};
      const key = String(b.key || '').slice(0, 160), col = String(b.col || '').slice(0, 60);
      if (!key || !col) return res.status(400).json({ error: 'Missing person or column.' });
      const all = (await blob.getJson(NEEDS_PATH).catch(() => null)) || {};
      all[key] = all[key] || {};
      if (b.value === 'yes' || b.value === 'no') all[key][col] = { value: b.value, note: String(b.note || '').slice(0, 300), by: session.username, at: new Date().toISOString() };
      else delete all[key][col];
      if (!Object.keys(all[key]).length) delete all[key];
      await blob.putJson(NEEDS_PATH, all);
      return res.status(200).json({ ok: true, saved: all[key] ? all[key][col] || null : null });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('people error:', err.message);
    return res.status(500).json({ error: 'Could not build the access summary.' });
  }
};

function siteList(settings) {
  return (Array.isArray(settings.sites) ? settings.sites
    : (settings.hubSites || []).map((x, i) => ({ id: (slug(x.name).slice(0, 30) || 'site') + '-' + i, name: x.name, url: x.url, use: 'both', match: '' })))
    .filter(s => s && s.id && s.name && s.active !== false);
}
/** Does person `p` (department / job / region / team) need site `s`?
 *  Blank rule: account sites = everyone; reference sites = no opinion. */
function ruleNeeds(s, hay) {
  const keys = String(s.match || '').split(/[,;\n]+/).map(k => k.trim().toLowerCase()).filter(Boolean);
  if (!keys.length) return s.kind === 'reference' ? { value: '', why: '' } : { value: 'yes', why: 'everyone' };
  const hit = keys.filter(k => hay.includes(k));
  return hit.length ? { value: 'yes', why: `matches ${hit.join(', ')}` } : { value: 'no', why: `doesn't match ${keys.join(', ')}` };
}

async function build() {
  const settings = (await blob.getJson(SETTINGS_PATH).catch(() => null)) || {};
  const sites = siteList(settings);
  const wantsOrg = sites.some(s => s.source === 'orgbuilder' || s.source === 'orgbuilder-callcycle');
  const [ms, msStatus, fgUpload, siteUploads, records, overrides, org] = await Promise.all([
    msDir.load(), msDir.status(), fgDir.load(),
    Promise.all(sites.map(s => fgDir.load(fgDir.sitePath(s.id)))),
    loadRecords(), blob.getJson(NEEDS_PATH).catch(() => null), wantsOrg ? orgTree.load() : Promise.resolve(null)
  ]);
  // Live Org Builder data wins over an uploaded list for sites set to it.
  const siteData = sites.map((s, i) => {
    if (s.source === 'orgbuilder' && org && org.org) return { ...org.org, live: true };
    if (s.source === 'orgbuilder-callcycle' && org && org.callcycle) return { ...org.callcycle, live: true };
    return siteUploads[i];
  });
  const fg = fgUpload || (org && org.perigee ? { ...org.perigee, fromOrgBuilder: true } : null);

  // ── Merge into people ────────────────────────────────────────────────────
  const people = [], byId = new Map(), byMobile = new Map(), byName = new Map();
  const index = (p, ids, mobile, first, last) => {
    ids.forEach(id => id && byId.set(id, p));
    if (mobile) byMobile.set(mobile, p);
    const k = nameKey(first, last);
    if (k !== '|') { const l = byName.get(k) || []; if (!l.includes(p)) l.push(p); byName.set(k, l); }
  };
  const findOrCreate = (src, ids, mobile, first, last) => {
    ids = ids.map(low).filter(Boolean);
    const nk = nameKey(first, last);
    let p = ids.map(id => byId.get(id)).find(Boolean);
    if (!p && mobile) { // a shared / recycled cell number only counts when the name agrees too
      const m = byMobile.get(mobile);
      if (m && (nk === '|' || nameKey(m.first, m.last) === nk || !m.first)) p = m;
    }
    if (!p) {
      const l = byName.get(nk) || [];
      // Two Microsoft accounts with the same name are usually two people;
      // a second Perigee / site entry under the same name is usually a duplicate.
      if (l.length === 1 && (!l[0].has[src] || src !== 'ms')) p = l[0];
    }
    if (!p) { p = { has: {}, extra: {}, requests: [] }; people.push(p); }
    index(p, ids, mobile, first, last);
    return p;
  };
  const put = (p, src, entry) => { if (p.has[src]) (p.extra[src] = p.extra[src] || []).push(entry); else p.has[src] = entry; };
  const split = n => { const parts = String(n || '').trim().split(/\s+/); return [parts[0] || '', parts.length > 1 ? parts[parts.length - 1] : '']; };
  const fill = (p, o) => Object.entries(o).forEach(([k, v]) => { if (v && !p[k]) p[k] = v; });

  for (const u of (ms && ms.users) || []) {
    const [f, l] = u.first || u.last ? [u.first, u.last] : split(u.name);
    const p = findOrCreate('ms', u.addrs || [u.upn], u.mobile, f, l);
    put(p, 'ms', { name: u.name, id: u.upn, active: u.enabled });
    fill(p, { name: u.name, first: f, last: l, mobile: u.mobile });
  }
  const addList = (src, list) => {
    for (const u of (list && list.users) || []) {
      const [f, l] = u.first || u.last ? [u.first, u.last] : split(u.name);
      const p = findOrCreate(src, [u.email, u.username], u.mobile, f, l);
      put(p, src, { name: u.name, id: u.email || u.username, active: u.active, role: u.role, team: u.team, note: u.note || '' });
      fill(p, { name: u.name || u.email || u.username, first: f, last: l, mobile: u.mobile, jobTitle: u.role, team: u.team });
    }
  };
  addList('pg', fg);
  sites.forEach((s, i) => addList('site:' + s.id, siteData[i]));

  for (const r of records) {
    r.people.forEach((rp, i) => {
      const ids = [rp.createdEmail, rp.workEmail, rp.perigeeUsername, rp.dextUsername, rp.personalEmail];
      const p = findOrCreate('req:' + r.ticketID, ids, normaliseMobile(rp.cellphone), rp.firstName, rp.lastName);
      p.requests.push({ ticketID: r.ticketID, type: r.type || 'starter', status: r.status || 'Open', createdAt: r.createdAt,
        date: r.type === 'leaver' ? rp.lastDay : rp.startDate,
        accounts: ['Microsoft', 'Perigee', 'Dext', 'Hub'].filter(k => rp['needs' + k]),
        sites: (rp.sites || []).map(s => ({ id: s.id, name: s.name, done: !!(rp.siteDone || {})[s.id] })) });
      fill(p, { name: [rp.firstName, rp.lastName].join(' '), first: rp.firstName, last: rp.lastName, department: rp.department,
        jobTitle: rp.jobTitle, region: rp.region, team: rp.teamName, mobile: normaliseMobile(rp.cellphone) });
    });
  }

  // ── Columns ──────────────────────────────────────────────────────────────
  const columns = [
    { col: 'ms', name: 'Microsoft 365', kind: 'account', hasList: !!ms },
    { col: 'pg', name: 'Perigee', kind: 'account', hasList: !!fg },
    ...sites.map((s, i) => ({ col: 'site:' + s.id, id: s.id, name: s.name, kind: s.kind === 'reference' ? 'reference' : 'account',
      hasList: !!siteData[i], url: s.adminUrl || s.url || '', rule: s.match || '', site: s }))
  ];

  // ── Per person ───────────────────────────────────────────────────────────
  const saved = overrides || {};
  const out = people.map(p => {
    const key = (p.has.ms && p.has.ms.id) || (p.has.pg && p.has.pg.id) || Object.values(p.has).map(x => x.id).find(Boolean) || `name:${nameKey(p.first, p.last)}`;
    const lastLeaver = p.requests.find(r => r.type === 'leaver');
    const lastStarter = p.requests.find(r => r.type !== 'leaver');
    const left = !!(lastLeaver && (!lastStarter || new Date(lastLeaver.createdAt) > new Date(lastStarter.createdAt)));
    const hay = [p.department, p.jobTitle, p.region, p.team].join(' | ').toLowerCase();
    const man = saved[key] || {};
    const cells = {};
    for (const c of columns) {
      const e = p.has[c.col];
      let has;
      if (e) has = e.active ? 'yes' : 'inactive';
      else if (c.hasList) has = 'no';
      else if (c.id) { // no list for this site: fall back to the request ticks
        const r = p.requests.find(x => x.sites.some(y => y.id === c.id));
        const t = r && r.sites.find(y => y.id === c.id);
        has = !t ? 'unknown' : r.type === 'leaver' ? (t.done ? 'removed' : 'to-remove') : (t.done ? 'added' : 'to-add');
      } else has = 'unknown';
      let need = { value: '', why: '' };
      if (man[c.col]) need = { value: man[c.col].value, why: `set by ${man[c.col].by}${man[c.col].note ? ': ' + man[c.col].note : ''}`, manual: true };
      else if (left) need = { value: 'no', why: 'leaver' };
      else if (c.site) need = ruleNeeds(c.site, hay);
      cells[c.col] = { has, need: need.value, why: need.why, manual: !!need.manual, account: e || null };
    }

    const issues = [];
    const activeIn = columns.filter(c => ['yes', 'added'].includes(cells[c.col].has));
    const names = list => list.map(c => c.name).join(', ');
    const where = list => [list.filter(c => c.kind !== 'reference'), list.filter(c => c.kind === 'reference')]
      .map((l, i) => l.length ? `${i ? 'still referenced in' : 'active in'} ${names(l)}` : '').filter(Boolean).join('; ');
    if (left && activeIn.length) issues.push({ level: 'bad', text: `Leaver (${lastLeaver.ticketID}${lastLeaver.date ? ', last day ' + lastLeaver.date : ''}): ${where(activeIn)}` });
    const resignedIn = columns.filter(c => c.kind === 'reference' && cells[c.col].has === 'inactive');
    const accountsOn = activeIn.filter(c => c.kind !== 'reference');
    if (!left && resignedIn.length && accountsOn.length) issues.push({ level: 'bad', text: `Marked resigned / inactive in ${names(resignedIn)} but ${where(accountsOn)}` });
    if (!left) {
      const notNeeded = activeIn.filter(c => cells[c.col].need === 'no');
      if (notNeeded.length) issues.push({ level: 'warn', text: `Has ${names(notNeeded)} but doesn't need it` });
      const missing = columns.filter(c => cells[c.col].need === 'yes' && cells[c.col].has === 'no' && (p.has.ms ? p.has.ms.active : true));
      if (missing.length) issues.push({ level: 'warn', text: `Needs ${names(missing)} but isn't there` });
      if (p.has.ms && !p.has.ms.active) {
        const still = activeIn.filter(c => c.col !== 'ms');
        if (still.length) issues.push({ level: 'warn', text: `Microsoft 365 is blocked but ${where(still)}` });
      }
    }
    Object.keys(p.extra).forEach(src => issues.push({ level: 'warn', text: `${p.extra[src].length + 1} ${(columns.find(c => c.col === src) || {}).name || src} entries matched — possible duplicate` }));
    const open = p.requests.filter(r => r.status === 'Open' || r.status === 'In Progress');
    if (open.length) issues.push({ level: 'info', text: `Open ${open[0].type === 'leaver' ? 'leaver' : 'starter'} request ${open[0].ticketID}` });
    if (lastStarter && !left && lastStarter.accounts.includes('Microsoft') && !p.has.ms && ms && ['Resolved', 'Closed'].includes(lastStarter.status))
      issues.push({ level: 'warn', text: `Starter ${lastStarter.ticketID} is completed but no Microsoft 365 account was found` });
    return {
      key, name: p.name || '(no name)', email: (p.has.ms && p.has.ms.id) || (Object.values(p.has).map(x => x.id).find(x => /@/.test(x || ''))) || '',
      mobile: p.mobile || '', department: p.department || '', jobTitle: p.jobTitle || '', region: p.region || '', team: p.team || '',
      cells, extra: p.extra, requests: p.requests.slice(0, 5), left, issues,
      level: issues.some(i => i.level === 'bad') ? 'bad' : issues.some(i => i.level === 'warn') ? 'warn' : issues.length ? 'info' : 'ok'
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  return {
    generatedAt: new Date().toISOString(),
    sources: {
      ms: ms ? { at: ms.syncedAt, count: ms.count, stale: msStatus.stale } : null,
      pg: fg ? { at: fg.uploadedAt, count: fg.count, fromOrgBuilder: !!fg.fromOrgBuilder } : null,
      sites: Object.fromEntries(sites.map((s, i) => [s.id, siteData[i] ? { at: siteData[i].uploadedAt, count: siteData[i].count, live: !!siteData[i].live } : null])),
      orgBuilder: org ? (org.ok ? { ok: true, orgError: org.orgError || '' } : { ok: false, error: org.error }) : null,
      requests: records.length
    },
    columns: columns.map(({ site, ...c }) => ({ ...c, source: site ? site.source || 'upload' : '' })),
    people: out,
    counts: {
      people: out.length,
      ms: out.filter(x => x.cells.ms.has === 'yes').length, pg: out.filter(x => x.cells.pg.has === 'yes').length,
      bad: out.filter(x => x.level === 'bad').length, warn: out.filter(x => x.level === 'warn').length
    }
  };
}

/** Most recent non-test request records (newest first). */
async function loadRecords() {
  const index = ((await blob.getJson(INDEX_PATH).catch(() => null)) || []).filter(r => !r.test).slice(0, MAX_RECORDS);
  const recs = await Promise.all(index.map(r => blob.getJson(`account-requests/${r.ticketID}.json`).catch(() => null)));
  return recs.filter(r => r && !r.deleted && Array.isArray(r.people)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}
