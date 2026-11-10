// ──────────────────────────────────────────────────────────────────────────────
// FieldGoose (Perigee) user list — uploaded as a CSV / Excel export from the
// FieldGoose admin site (there's no API yet), so requests can be cross-checked:
//   - new starters: is the Perigee username / email already taken? Does the
//     person already have a FieldGoose account (rehire)?
//   - leavers: which FieldGoose account is theirs, and is it still active?
//
// Upload: New Starter / Leaver Queue → ⚙ Settings → FieldGoose user list
// (IT or the Perigee Support Admin), via api/admin/directory.js ?action=fg-upload.
// Column headers are matched loosely (Username / User name / Login, Email,
// First name, Surname, Name, Cell / Mobile, Status / Active …). Stored in Blob
// at directory/fieldgoose.json. Older than STALE_DAYS → everyone is nudged
// (queue banner + reminder emails) to upload a fresh export.
// ──────────────────────────────────────────────────────────────────────────────
const blob = require('./blob.js');

const PATH = 'directory/fieldgoose.json';
const STALE_DAYS = 7;
const MAX_ROWS = 20000;

const slug = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');
const nameKey = (f, l) => `${slug(f)}|${slug(l)}`;
const low = v => String(v || '').trim().toLowerCase();

function normaliseMobile(v) {
  let d = String(v || '').replace(/[\s()\-.]/g, '');
  if (/^00/.test(d)) d = '+' + d.slice(2);
  if (/^0\d{9}$/.test(d)) d = '+27' + d.slice(1);
  else if (/^27\d{9}$/.test(d)) d = '+' + d;
  else if (/^[6-8]\d{8}$/.test(d)) d = '+27' + d; // Excel drops the leading 0
  return /^\+\d{9,15}$/.test(d) ? d : '';
}

/** CSV / TSV / semicolon text → array of string arrays (quotes honoured). */
function parseDelimited(text) {
  text = String(text || '').replace(/^﻿/, '');
  // Delimiter = the most common of tab / comma / semicolon over the first few
  // lines (not just the first — exports often start with a title row).
  const head = text.split(/\r?\n/, 6).join('\n');
  const counts = { '\t': (head.match(/\t/g) || []).length, ',': (head.match(/,/g) || []).length, ';': (head.match(/;/g) || []).length };
  const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(c => c.trim())) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some(c => c.trim())) rows.push(row);
  return rows;
}

// Header text → our field. First match wins, so more specific names go first.
const COLUMNS = [
  ['username', /^(user ?name|login( ?name)?|user ?id|user ?code|employee ?(code|number|no)|staff ?(code|number|no))$/],
  ['email',    /^(e-?mail( ?address)?|email ?addr|work ?e-?mail|user ?e-?mail)$/],
  ['first',    /^(first ?names?|given ?name|name ?first)$/],
  ['last',     /^(surname|last ?name|family ?name)$/],
  ['name',     /^(name|full ?name|display ?name|user|employee( ?name)?|staff( ?name)?)$/],
  ['mobile',   /^(cell( ?(phone|number|no))?|mobile( ?(phone|number|no))?|phone( ?number)?|contact ?number|msisdn)$/],
  ['status',   /^(status|user ?status|account ?status|state|active|is ?active|enabled|is ?enabled)$/],
  ['role',     /^(role|user ?type|app ?role|type|position|job ?title)$/],
  ['team',     /^(team( ?name)?|region|province|area|assigned ?province)$/]
];
function mapHeaders(header) {
  const map = {};
  header.forEach((h, i) => {
    const t = low(h).replace(/[_*:]+/g, ' ').replace(/\s+/g, ' ').trim();
    const hit = COLUMNS.find(([k, re]) => map[k] === undefined && re.test(t));
    if (hit) map[hit[0]] = i;
  });
  return map;
}
/** Status cell → true (active) / false (inactive). Blank = active (unknown). */
function isActive(v) {
  const t = low(v);
  if (!t) return true;
  if (/^(in-?active|disabled|deactivated|de-activated|suspended|blocked|locked|archived|deleted|terminated|left|resigned|no|n|false|0|off)$/.test(t)) return false;
  return true;
}

/** Parses an export. Returns { users, columns, header, skipped } or { error }.
 *  needName:false (site user lists) accepts a list of just emails / usernames. */
function parseExport(text, { needName = true } = {}) {
  const rows = parseDelimited(text);
  if (rows.length < 2) return { error: 'The file needs a header row and at least one user.' };
  // The header is the first row that maps to at least two known columns (exports sometimes have a title row).
  let h = 0, map = {};
  for (; h < Math.min(rows.length, 6); h++) { map = mapHeaders(rows[h]); if (Object.keys(map).length >= 2 || (!needName && (map.email !== undefined || map.username !== undefined))) break; }
  if (Object.keys(map).length < (needName ? 2 : 1)) return { error: 'Couldn\'t recognise the columns. The first row needs headers like Username, Email, First name, Surname, Status.' };
  if (map.username === undefined && map.email === undefined) return { error: 'The file needs a Username or an Email column.' };
  if (needName && map.first === undefined && map.last === undefined && map.name === undefined) return { error: 'The file needs a Name column (or First name + Surname).' };
  const cell = (r, k) => (map[k] === undefined ? '' : String(r[map[k]] || '').trim());
  const users = []; let skipped = 0;
  for (const r of rows.slice(h + 1, h + 1 + MAX_ROWS)) {
    let first = cell(r, 'first'), last = cell(r, 'last'), name = cell(r, 'name');
    if (!first && !last && name) {
      if (name.includes(',')) { // "Dlamini, Lerato" = Surname, First name
        const [a, b] = name.split(',').map(x => x.trim());
        last = a; first = (b || '').split(/\s+/)[0] || ''; name = [first, last].filter(Boolean).join(' ');
      } else { const parts = name.split(/\s+/); first = parts[0]; last = parts.length > 1 ? parts[parts.length - 1] : ''; }
    }
    if (!name) name = [first, last].filter(Boolean).join(' ');
    const username = low(cell(r, 'username')), email = low(cell(r, 'email'));
    if (!username && !email) { skipped++; continue; }
    users.push({ name, first, last, username, email, mobile: normaliseMobile(cell(r, 'mobile')), active: isActive(cell(r, 'status')), role: cell(r, 'role'), team: cell(r, 'team') });
  }
  if (!users.length) return { error: 'No users found under the header row.' };
  const columns = Object.fromEntries(Object.entries(map).map(([k, i]) => [k, rows[h][i]]));
  return { users, columns, skipped, truncated: rows.length - h - 1 > MAX_ROWS };
}

async function save(parsed, by, fileName, path = PATH) {
  const data = { uploadedAt: new Date().toISOString(), by, fileName: String(fileName || '').slice(0, 120), count: parsed.users.length,
    active: parsed.users.filter(u => u.active).length, columns: parsed.columns, users: parsed.users };
  await blob.putJson(path, data);
  return data;
}
async function load(path = PATH) { return (await blob.getJson(path).catch(() => null)) || null; }
// Per-site user lists (Sites page → Upload user list), same format as FieldGoose.
const sitePath = id => `directory/site-${String(id).replace(/[^a-z0-9-]/gi, '')}.json`;

/** { uploaded, count, active, uploadedAt, by, fileName, ageDays, stale } */
function statusOf(d) {
  if (!d || !d.uploadedAt) return { uploaded: false, stale: false, staleDays: STALE_DAYS };
  const ageDays = (Date.now() - new Date(d.uploadedAt).getTime()) / 86400000;
  return { uploaded: true, count: d.count, active: d.active, uploadedAt: d.uploadedAt, by: d.by, fileName: d.fileName, columns: d.columns, ageDays, stale: ageDays > STALE_DAYS, staleDays: STALE_DAYS };
}
async function status() { return statusOf(await load()); }
function warningText(st) {
  if (!st || !st.uploaded || !st.stale) return '';
  return `The FieldGoose user list was last uploaded ${Math.floor(st.ageDays)} days ago — upload a fresh export (Starter / Leaver Queue → ⚙ Settings) so Perigee checks stay accurate.`;
}

const brief = u => ({ name: u.name, username: u.username, email: u.email, active: u.active, role: u.role, team: u.team });
function matches(p, fg, { ids = [] } = {}) {
  const users = (fg && fg.users) || [];
  const key = nameKey(p.firstName, p.lastName), mob = normaliseMobile(p.cellphone);
  const idSet = new Set(ids.map(low).filter(Boolean));
  const out = [];
  for (const u of users) {
    const why = [];
    if (idSet.size && (idSet.has(u.username) || idSet.has(u.email))) why.push(idSet.has(u.username) ? 'username' : 'email');
    if (key !== '|' && (nameKey(u.first, u.last) === key || slug(u.name) === slug(`${p.firstName}${p.lastName}`))) why.push('name');
    if (mob && u.mobile === mob) why.push('cell');
    if (why.length) out.push({ ...brief(u), why, exact: why.includes('username') || why.includes('email') });
  }
  return out.sort((a, b) => b.exact - a.exact || b.why.length - a.why.length).slice(0, 5);
}

/** New starter: is the Perigee login they'd get free, and are they already in FieldGoose? */
function checkStarter(p, fg, wanted) {
  if (!fg) return null;
  const users = fg.users || [];
  const want = low(p.perigeeUsername || wanted);
  const hit = want ? users.find(u => u.username === want || u.email === want) : null;
  const existing = matches(p, fg, { ids: [p.personalEmail] }).filter(u => !hit || u.username !== hit.username || u.email !== hit.email);
  return { wanted: want, taken: hit ? brief(hit) : null, existing };
}
/** Leaver: their FieldGoose account(s) and whether each is still active. */
function checkLeaver(p, fg) {
  if (!fg) return null;
  return { accounts: matches(p, fg, { ids: [p.perigeeUsername, p.workEmail] }) };
}

module.exports = { parseExport, save, load, sitePath, normaliseMobile, nameKey, slug, status, statusOf, warningText, checkStarter, checkLeaver, STALE_DAYS };
