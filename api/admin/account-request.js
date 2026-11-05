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
// POST  { people: [ {...person} ], notes }            requestAccounts → { ticketID, verificationCode, count }
// GET                     list (HR: own; IT: all)    ?active=1 → only Open / In Progress
// GET   ?id=<ticketID>    full record + verified flag (HR: own only; IT: any)
// PATCH { ticketID, status, itNotes, people:[{ index, done:{microsoft,perigee,dext}, createdEmail }] }
//                         manageTickets — IT working the request
// ──────────────────────────────────────────────────────────────────────────────
const crypto              = require('crypto');
const { isValidPhoneNumber } = require('libphonenumber-js');
const { verifyToken, sessionTokenFromRequest } = require('../../lib/auth');
const { hasPermission, ROLES } = require('../../lib/roles');
const { getUser }         = require('../../lib/users');
const { load: loadConfig } = require('../../lib/portal-config.js');
const { nextInPool }      = require('../../lib/rotation.js');
const { formatDuration }  = require('../../assets/duration.js');
const blob                = require('../../lib/blob.js');

const INDEX_PATH = 'account-requests/index.json';
const recordPath = id => `account-requests/${id}.json`;
const ID_RE      = /^IT-\d{4}-\d{5}$/;

const MARKER   = '[NEW STARTER ACCOUNT REQUEST]';
// Existing category (SharePoint may treat Category as a choice column).
const CATEGORY = 'Access / Passwords / Permissions';
const STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'];
const ACTIVE   = new Set(['Open', 'In Progress']);
const MAX_PEOPLE = 50;
// Booking length per person, per account type — summed for the batch.
const MINUTES = { microsoft: 15, perigee: 15, dext: 10 };

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
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isDate  = v => /^\d{4}-\d{2}-\d{2}$/.test(v);
const fullName = p => [p.firstName, p.middleNames, p.lastName].filter(Boolean).join(' ');
const services = p => [p.needsMicrosoft && 'Microsoft 365', p.needsPerigee && 'Perigee', p.needsDext && 'Dext'].filter(Boolean);

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
  if (!canRequest && !isIT) return res.status(403).json({ error: 'forbidden' });
  if (!blob.isConfigured()) return res.status(503).json({ error: 'storage_not_configured', message: 'Storage isn\'t configured — ask IT.' });

  try {
    if (req.method === 'GET')   return await handleGet(req, res, session, isIT);
    if (req.method === 'POST') {
      if (!canRequest) return res.status(403).json({ error: 'forbidden', message: 'Only HR accounts can log account requests.' });
      return await handlePost(req, res, session);
    }
    if (req.method === 'PATCH') {
      if (!isIT) return res.status(403).json({ error: 'forbidden' });
      return await handlePatch(req, res, session);
    }
  } catch (err) {
    console.error('account-request error:', err.message);
    return res.status(500).json({ error: 'server_error', message: 'Something went wrong. Please try again.' });
  }
  return res.status(405).json({ error: 'Method not allowed' });
};

// ── GET ─────────────────────────────────────────────────────────────────────
async function handleGet(req, res, session, isIT) {
  const q  = req.query || {};
  const id = clean(q.id || q.verify, 40).toUpperCase();
  const mine = session.username.toLowerCase();

  if (id) {
    if (!ID_RE.test(id)) return res.status(200).json({ verified: false, reason: 'not_found' });
    const record = await blob.getJson(recordPath(id)).catch(() => null);
    if (!record) return res.status(200).json({ verified: false, reason: 'not_found' });
    if (!isIT && (record.requestedBy || '').toLowerCase() !== mine) return res.status(200).json({ verified: false, reason: 'not_found' });
    const ok = record.verificationCode === verificationCode(record);
    return res.status(200).json({ verified: ok, reason: ok ? null : 'code_mismatch', record });
  }

  let list = (await blob.getJson(INDEX_PATH).catch(() => null)) || [];
  if (!isIT) list = list.filter(r => (r.requestedBy || '').toLowerCase() === mine);
  if (q.active === '1') list = list.filter(r => ACTIVE.has(r.status || 'Open'));
  return res.status(200).json({ requests: list.slice(0, 500), seesAll: isIT, regions: REGIONS });
}

// ── POST (HR submits) ───────────────────────────────────────────────────────
function cleanPerson(raw, i) {
  const p = {
    firstName:      clean(raw.firstName, 60),
    middleNames:    clean(raw.middleNames, 80),
    lastName:       clean(raw.lastName, 60),
    personalEmail:  clean(raw.personalEmail, 120).toLowerCase(),
    cellphone:      clean(raw.cellphone, 30),
    region:         clean(raw.region, 60),
    jobTitle:       clean(raw.jobTitle, 100),
    department:     clean(raw.department, 100),
    startDate:      clean(raw.startDate, 10),
    managerName:    clean(raw.managerName, 100),
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
  if (p.personalEmail && !isEmail(p.personalEmail)) return { error: `${who}: the personal email looks wrong.` };
  if (!isValidPhoneNumber(p.cellphone, 'ZA')) return { error: `${who}: the cell number looks wrong.` };
  if (p.startDate && !isDate(p.startDate)) p.startDate = '';
  return { person: p };
}

async function handlePost(req, res, session) {
  const b = req.body || {};
  const rawPeople = Array.isArray(b.people) ? b.people : [];
  if (!rawPeople.length) return res.status(400).json({ error: 'empty', message: 'Add at least one person.' });
  if (rawPeople.length > MAX_PEOPLE) return res.status(400).json({ error: 'too_many', message: `Up to ${MAX_PEOPLE} people per request — split it into two.` });

  const people = [];
  for (let i = 0; i < rawPeople.length; i++) {
    const r = cleanPerson(rawPeople[i] || {}, i);
    if (r.error) return res.status(400).json({ error: 'invalid', message: r.error, index: i });
    people.push(r.person);
  }
  const batchNotes = clean(b.notes, 2000);

  // Identity comes from the session + stored account, never the request body.
  const record         = await getUser(session.username).catch(() => null);
  const requesterEmail = (record && record.email) || '';
  const requesterName  = (record && record.fullName) || session.username;
  const requesterRole  = (ROLES[session.role] && ROLES[session.role].label) || session.role;
  const mfaOn          = !!(record && record.mfaEnabled);

  const ticketID  = `IT-${new Date().getFullYear()}-${String(crypto.randomInt(10000, 100000))}`;
  const createdAt = new Date().toISOString();
  const code      = verificationCode({ ticketID, requestedBy: session.username, createdAt, people });
  const origin    = `https://${req.headers.host || 'iram-it-portal.vercel.app'}`;
  const queueUrl  = `${origin}/admin/new-starters?id=${encodeURIComponent(ticketID)}`;

  // Earliest start date decides urgency: within 3 days → High.
  const starts   = people.map(p => p.startDate).filter(Boolean).sort();
  const earliest = starts[0] || '';
  const daysToStart = earliest ? Math.ceil((Date.parse(earliest + 'T00:00:00+02:00') - Date.now()) / 86400000) : 99;
  const priority = daysToStart <= 3 ? 'High' : 'Medium';
  const minutes  = Math.min(480, Math.max(15, people.reduce((m, p) =>
    m + (p.needsMicrosoft ? MINUTES.microsoft : 0) + (p.needsPerigee ? MINUTES.perigee : 0) + (p.needsDext ? MINUTES.dext : 0), 0)));

  const count = (k) => people.filter(p => p[k]).length;
  const summary = [count('needsMicrosoft') && `${count('needsMicrosoft')} Microsoft 365`, count('needsPerigee') && `${count('needsPerigee')} Perigee`, count('needsDext') && `${count('needsDext')} Dext`].filter(Boolean).join(', ');

  const { config } = await loadConfig();
  const itPool      = (config.itStaff || []).filter(s => s.isIT);
  const perigeePool = (config.itStaff || []).filter(s => s.isPerigee);
  const perigeeOnly = people.every(p => p.needsPerigee && !p.needsMicrosoft && !p.needsDext);
  const usePerigee  = perigeeOnly && perigeePool.length > 0;
  const assignedTo  = await nextInPool(usePerigee ? 'perigee' : 'it', usePerigee ? perigeePool : itPool).catch(() => '');

  const auditRecord = {
    ticketID, createdAt, verificationCode: code,
    requestedBy: session.username, requesterName, requesterEmail, requesterRole, roleKey: session.role,
    hasAccount: !!record, mfaEnabled: mfaOn,
    ip: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(),
    userAgent: clean(req.headers['user-agent'], 300),
    status: 'Open', statusHistory: [{ status: 'Open', at: createdAt, by: session.username }],
    priority, estimatedMinutes: minutes, assignedTo, earliestStart: earliest,
    notes: batchNotes, itNotes: '', people
  };

  // Audit record first: if it can't be stored, IT couldn't verify the request,
  // so refuse rather than log an unverifiable ticket.
  await blob.putJson(recordPath(ticketID), auditRecord);
  const index = (await blob.getJson(INDEX_PATH).catch(() => null)) || [];
  index.unshift(indexEntry(auditRecord));
  await blob.putJson(INDEX_PATH, index.slice(0, 2000));

  // Normal ticket flow → SharePoint row + the existing calendar booking.
  const description = [
    `${MARKER} ${people.length} ${people.length === 1 ? 'person' : 'people'} — ${summary}`,
    `Verification code: ${code}`,
    `Requested by: ${requesterName} (${requesterRole})${requesterEmail ? ' <' + requesterEmail + '>' : ''}, signed in with 2FA`,
    ...people.map((p, i) => `${i + 1}. ${fullName(p)} — ${p.jobTitle}, ${p.department}, ${p.region}${p.startDate ? ', starts ' + p.startDate : ''} — ${services(p).join(' + ')}`),
    batchNotes ? `Notes: ${batchNotes}` : '',
    `Open in New Starter Queue: ${queueUrl}`
  ].filter(Boolean).join('\n');

  const paUrl = process.env.POWER_AUTOMATE_URL;
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
          requestType:    'New Starter Accounts', hrVerified: true, verificationCode: code
        })
      });
    } catch (err) {
      console.error('account-request: PA call error', err.message);
    }
  }

  const hrInbox  = process.env.HR_EMAIL || 'hr@iram.co.za';
  const itEmails = [...new Set([
    process.env.IT_EMAIL,
    ...itPool.map(s => s.email),
    ...(count('needsPerigee') ? perigeePool.map(s => s.email) : [])
  ].filter(Boolean))];
  const table = peopleTable(people);
  try {
    if (itEmails.length) {
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
      subject: `Account request ${ticketID} logged — ${people.length} ${people.length === 1 ? 'person' : 'people'}`,
      html: emailHtml({ heading: 'Account Request Logged', ticketID, code, table,
        buttonUrl: `${origin}/admin/account-request`, buttonLabel: 'View my requests',
        intro: `Your request has been sent to IT. You'll see it under <strong>My requests</strong> until it's completed.<br><br>⚠️ <strong>Didn't log this?</strong> Tell IT immediately — someone may be using your login.` })
    });
  } catch (err) {
    console.error('account-request: email error', err.message);
  }

  return res.status(200).json({ ticketID, verificationCode: code, count: people.length });
}

function isPersonDone(p) {
  const d = p.done || {};
  return (!p.needsMicrosoft || d.microsoft) && (!p.needsPerigee || d.perigee) && (!p.needsDext || d.dext);
}

function indexEntry(r) {
  return {
    ticketID: r.ticketID, createdAt: r.createdAt, status: r.status || 'Open',
    requestedBy: r.requestedBy, requesterName: r.requesterName, requesterRole: r.requesterRole,
    count: r.people.length,
    names: r.people.slice(0, 3).map(p => `${p.firstName} ${p.lastName}`),
    regions: [...new Set(r.people.map(p => p.region))],
    services: {
      microsoft: r.people.filter(p => p.needsMicrosoft).length,
      perigee:   r.people.filter(p => p.needsPerigee).length,
      dext:      r.people.filter(p => p.needsDext).length
    },
    doneCount: r.people.filter(isPersonDone).length,
    earliestStart: r.earliestStart || '', priority: r.priority, assignedTo: r.assignedTo || ''
  };
}

// ── PATCH (IT works the request) ─────────────────────────────────────────────
async function handlePatch(req, res, session) {
  const b  = req.body || {};
  const id = clean(b.ticketID, 40).toUpperCase();
  if (!ID_RE.test(id)) return res.status(400).json({ error: 'bad_id' });
  const record = await blob.getJson(recordPath(id)).catch(() => null);
  if (!record) return res.status(404).json({ error: 'not_found' });

  const now = new Date().toISOString();
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) return res.status(400).json({ error: 'bad_status' });
    if (b.status !== record.status) {
      record.status = b.status;
      (record.statusHistory = record.statusHistory || []).push({ status: b.status, at: now, by: session.username });
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
        ['microsoft', 'perigee', 'dext'].forEach(k => { if (u.done[k] !== undefined) p.done[k] = !!u.done[k]; });
      }
      if (u.createdEmail !== undefined) p.createdEmail = clean(u.createdEmail, 120).toLowerCase();
    }
  }
  record.updatedAt = now;
  record.updatedBy = session.username;

  await blob.putJson(recordPath(id), record);
  const index = (await blob.getJson(INDEX_PATH).catch(() => null)) || [];
  const i = index.findIndex(r => r.ticketID === id);
  if (i !== -1) index[i] = indexEntry(record); else index.unshift(indexEntry(record));
  await blob.putJson(INDEX_PATH, index);

  return res.status(200).json({ ok: true, record });
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

function emailHtml({ heading, intro, ticketID, code, table, buttonUrl, buttonLabel, footer }) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Segoe UI,Arial,sans-serif;background:#f4f6f8">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <tr><td style="background:#2D2D2D;padding:26px 32px;text-align:center">
    <p style="margin:0;color:#fff;font-size:22px;font-weight:700">iRam IT Support</p>
    <p style="margin:8px 0 0;color:#6BBF4E;font-size:12px;text-transform:uppercase;letter-spacing:1.5px">${esc(heading)}</p>
  </td></tr>
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
