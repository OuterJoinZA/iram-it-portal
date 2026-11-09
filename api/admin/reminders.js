// ──────────────────────────────────────────────────────────────────────────────
// Reminders: emails each IT tech a list of the open items assigned to them —
// IT tickets (SharePoint, via the PA "get all tickets" flow) and new-starter
// account requests (Blob). Unassigned items (or techs with no email set in
// Settings → IT Staff) go to the fallback list instead, so nothing slips.
//
// GET   — the Vercel cron (vercel.json "crons", weekday mornings). Needs the
//         CRON_SECRET env var: Vercel sends it as "Authorization: Bearer …".
//         Skips quietly if reminders are switched off in Email settings.
// POST  { dryRun } — "Send reminders now" / "Preview" from the New Starter
//         Queue (manageTickets). dryRun returns what would be sent, no email.
//
// Only Open / In Progress items; TEST requests are never included.
// ──────────────────────────────────────────────────────────────────────────────
const { requireRole, rejectIfPreview } = require('../../lib/require-role');
const { load: loadConfig } = require('../../lib/portal-config.js');
const blob = require('../../lib/blob.js');
const msDir = require('../../lib/ms-directory.js');

const INDEX_PATH    = 'account-requests/index.json';
const SETTINGS_PATH = 'account-requests/settings.json';
const MARKER        = '[NEW STARTER ACCOUNT REQUEST]';
const LEAVER_MARKER = '[LEAVER ACCESS REMOVAL]';
const ACTIVE        = new Set(['Open', 'In Progress']);
const PRIO          = { Critical: 0, High: 1, Medium: 2, Low: 3 };

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const spVal = v => (v && typeof v === 'object' && !Array.isArray(v)) ? (v.Value ?? v.DisplayName ?? '') : (v ?? '');
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || ''));
const ageLabel = iso => {
  const h = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (!Number.isFinite(h) || h < 0) return '';
  return h < 24 ? `${Math.max(1, Math.round(h))}h` : `${Math.round(h / 24)}d`;
};

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let trigger, dryRun = false, by = 'schedule';
  if (req.method === 'GET') {
    const secret = process.env.CRON_SECRET;
    if (!secret) return res.status(503).json({ error: 'Set the CRON_SECRET environment variable in Vercel to enable scheduled reminders.' });
    if ((req.headers.authorization || '') !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
    trigger = 'schedule';
  } else if (req.method === 'POST') {
    dryRun = !!(req.body && req.body.dryRun);
    if (!dryRun && rejectIfPreview(req, res)) return;
    const user = requireRole(req, 'manageTickets') || (dryRun && requireRole({ ...req, method: 'GET' }, 'manageTickets'));
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    trigger = 'manual'; by = user.username;
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const settings = Object.assign({ remindersEnabled: true, reminderFallbackEmails: [], itManagerEmails: [] },
    (blob.isConfigured() && await blob.getJson(SETTINGS_PATH).catch(() => null)) || {});
  if (trigger === 'schedule' && settings.remindersEnabled === false) return res.status(200).json({ skipped: 'Reminders are switched off in Email settings.' });

  const { config } = await loadConfig();
  const staff = (config.itStaff || []).map(s => ({ name: String(s.name || '').trim(), email: String(s.email || '').trim().toLowerCase() })).filter(s => s.name);
  const emailFor = name => { const s = staff.find(x => x.name.toLowerCase() === String(name || '').trim().toLowerCase()); return s && isEmail(s.email) ? s.email : ''; };

  // ── Gather open items ──────────────────────────────────────────────────────
  const warnings = [];
  let tickets = [];
  const flowUrl = process.env.PA_GET_TICKETS_URL;
  if (flowUrl) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 50000);
      const r = await fetch(flowUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: ctl.signal });
      clearTimeout(t);
      const data = r.ok ? JSON.parse((await r.text()) || '[]') : [];
      if (!r.ok) warnings.push(`Ticket list unavailable (flow returned ${r.status}) — only new-starter requests included.`);
      tickets = (Array.isArray(data) ? data : (data.value || [])).map(t => ({
        id: t.TicketID ?? t.Title ?? t.ticketID ?? '',
        status: spVal(t.Status) || 'Open', priority: spVal(t.Priority) || spVal(t.SuggestedPriority) || 'Medium',
        assignedTo: spVal(t.AssignedTo), submitter: spVal(t.SubmitterName), category: spVal(t.Category),
        description: String(t.Description || ''), created: t.Created || t.created || ''
      })).filter(t => ACTIVE.has(t.status) && !t.description.startsWith(MARKER) && !t.description.startsWith(LEAVER_MARKER)); // account requests are listed separately below
    } catch (err) {
      warnings.push('Ticket list timed out — only new-starter requests included.');
    }
  } else warnings.push('PA_GET_TICKETS_URL not set — only new-starter requests included.');

  const index = (blob.isConfigured() && await blob.getJson(INDEX_PATH).catch(() => null)) || [];
  const requests = index.filter(r => !r.test && ACTIVE.has(r.status || 'Open'));

  // ── Group by tech ─────────────────────────────────────────────────────────
  const groups = new Map(); // key: email or '__fallback__'
  const add = (assignee, kind, item) => {
    const email = assignee ? emailFor(assignee) : '';
    const key = email || '__fallback__';
    if (!groups.has(key)) groups.set(key, { email, name: email ? assignee : '', tickets: [], requests: [] });
    const g = groups.get(key);
    (kind === 't' ? g.tickets : g.requests).push({ ...item, assignee: assignee || '' });
  };
  tickets.forEach(t => add(t.assignedTo, 't', t));
  // New-starter requests: each account owner is reminded only of their own
  // unfinished accounts ("Who does what"); older requests fall back to Assigned.
  requests.forEach(r => {
    const tasks = r.ownerTasks && Object.keys(r.ownerTasks).length ? r.ownerTasks : null;
    if (!tasks) return add(r.assignedTo, 'r', r);
    Object.keys(tasks).forEach(owner => { if (tasks[owner].length) add(owner, 'r', { ...r, tasks: tasks[owner] }); });
  });

  const fallbackTo = [...new Set((settings.reminderFallbackEmails && settings.reminderFallbackEmails.length
    ? settings.reminderFallbackEmails : settings.itManagerEmails.length ? settings.itManagerEmails : [process.env.IT_EMAIL]).filter(isEmail))];

  const origin = `https://${req.headers.host || 'iram-it-portal.vercel.app'}`;
  const plan = [...groups.values()].map(g => ({
    to: g.email ? [g.email] : fallbackTo,
    name: g.email ? g.name : 'Unassigned / no email on file',
    fallback: !g.email,
    tickets: g.tickets.sort((a, b) => (PRIO[a.priority] ?? 9) - (PRIO[b.priority] ?? 9) || new Date(a.created) - new Date(b.created)),
    requests: g.requests.sort((a, b) => String(a.earliestStart || '9999').localeCompare(String(b.earliestStart || '9999')))
  }));

  // Out of sight, out of mind: if the Microsoft 365 directory sync is failing
  // or stale, every reminder says so until it's fixed.
  // Also warns ~30 days before the Azure app secret expires.
  let dirWarning = '';
  try { dirWarning = msDir.warningText(await msDir.status()); } catch (_) {}
  if (dirWarning) warnings.push(dirWarning);
  plan.forEach(p => { p.dirWarning = dirWarning; });

  const summary = plan.map(p => ({ name: p.name, to: p.to, tickets: p.tickets.length, requests: p.requests.length }));
  if (dryRun) return res.status(200).json({ dryRun: true, summary, warnings, fallbackTo });

  // ── Send ──────────────────────────────────────────────────────────────────
  let sent = 0;
  const failures = [];
  for (const p of plan) {
    if (!p.to.length) { failures.push(`${p.name}: no email address to send to`); continue; }
    const n = p.tickets.length + p.requests.length;
    try {
      await sendEmail(p.to, `⏰ ${n} open IT ${n === 1 ? 'item' : 'items'}${p.fallback ? (n === 1 ? ' needs an owner' : ' need an owner') : ' assigned to you'}`, reminderHtml(p, origin));
      sent++;
    } catch (err) { failures.push(`${p.name}: ${err.message.slice(0, 120)}`); }
  }
  if (blob.isConfigured()) {
    const saved = (await blob.getJson(SETTINGS_PATH).catch(() => null)) || {};
    saved.lastReminderRun = { at: new Date().toISOString(), by, trigger, sent, summary };
    await blob.putJson(SETTINGS_PATH, saved).catch(() => {});
  }
  return res.status(200).json({ ok: true, sent, summary, warnings, failures });
};

function reminderHtml(p, origin) {
  const th = h => `<th style="text-align:left;padding:7px 10px;background:#f4f6f8;font-size:11px;color:#666;text-transform:uppercase">${h}</th>`;
  const td = (v, extra = '') => `<td style="padding:8px 10px;border-top:1px solid #eee;${extra}">${v}</td>`;
  const prioColor = pr => pr === 'Critical' ? '#a4262c' : pr === 'High' ? '#d83b01' : pr === 'Low' ? '#498205' : '#986f0b';
  const ticketTable = p.tickets.length ? `
    <p style="margin:20px 0 8px;font-size:15px;font-weight:800">🎫 Tickets (${p.tickets.length})</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e8e8;border-radius:8px;border-collapse:collapse;font-size:12.5px">
      <tr>${th('Ticket')}${th('Priority')}${th('Status')}${th('From')}${th('Category')}${th('Age')}${p.fallback ? th('Assigned') : ''}</tr>
      ${p.tickets.map(t => `<tr>${td(`<strong>${esc(t.id)}</strong>`)}${td(`<strong style="color:${prioColor(t.priority)}">${esc(t.priority)}</strong>`)}${td(esc(t.status))}${td(esc(t.submitter))}${td(esc(t.category))}${td(esc(ageLabel(t.created)))}${p.fallback ? td(esc(t.assignee || '—')) : ''}</tr>`).join('')}
    </table>
    <p style="margin:8px 0 0"><a href="${origin}/admin/index.html" style="color:#4e9938;font-weight:700">Open the IT dashboard →</a></p>` : '';
  const reqTable = p.requests.length ? `
    <p style="margin:22px 0 8px;font-size:15px;font-weight:800">🧑‍💻 Starter &amp; leaver requests (${p.requests.length})</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e8e8;border-radius:8px;border-collapse:collapse;font-size:12.5px">
      <tr>${th('Request')}${th('People')}${th(p.fallback ? 'Still to do' : 'Your part')}${th('Date')}${th('Status')}${th('From')}${p.fallback ? th('Assigned') : ''}</tr>
      ${p.requests.map(r => `<tr>${td(`<a href="${origin}/admin/new-starters?id=${encodeURIComponent(r.ticketID)}" style="color:#4e9938;font-weight:800">${esc(r.ticketID)}</a>`)}${td((r.type === 'leaver' ? '<strong style="color:#a4262c">LEAVER</strong> ' : '') + esc((r.names || []).join(', ') + (r.count > (r.names || []).length ? ` +${r.count - r.names.length}` : '')))}${td(esc((r.tasks || []).join(', ') || `${r.count - (r.doneCount || 0)} of ${r.count} people`))}${td(esc(r.earliestStart ? (r.type === 'leaver' ? 'Last day ' : 'Starts ') + r.earliestStart : '—'))}${td(esc(r.status || 'Open'))}${td(esc(r.requesterName || r.requestedBy))}${p.fallback ? td(esc(r.assignee || '—')) : ''}</tr>`).join('')}
    </table>` : '';
  const intro = p.fallback
    ? 'These open items have <strong>nobody assigned</strong>, or are assigned to someone with no email in Settings → IT Staff. Please assign them.'
    : `Hi <strong>${esc(p.name)}</strong>, here's what's still open and assigned to you.`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Segoe UI,Arial,sans-serif;background:#f4f6f8">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:36px 16px">
<table width="680" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">
  <tr><td style="background:#2D2D2D;padding:24px 32px;text-align:center">
    <p style="margin:0;color:#fff;font-size:21px;font-weight:700">iRam IT Support</p>
    <p style="margin:8px 0 0;color:#6BBF4E;font-size:12px;text-transform:uppercase;letter-spacing:1.5px">⏰ Open items reminder</p>
  </td></tr>
  <tr><td style="padding:24px 32px">
    ${p.dirWarning ? `<p style="margin:0 0 16px;padding:12px 14px;background:#fdf0f0;border:1px solid #f0c0c0;border-radius:8px;color:#a4262c;font-size:13px;line-height:1.6">⚠️ <strong>Action needed:</strong> ${esc(p.dirWarning)} <a href="${origin}/admin/new-starters" style="color:#a4262c;font-weight:700">Open the New Starter Queue →</a></p>` : ''}
    <p style="margin:0;font-size:14px;color:#555;line-height:1.7">${intro}</p>
    ${ticketTable}${reqTable}
  </td></tr>
  <tr><td style="background:#f4f6f8;padding:14px 32px;text-align:center;border-top:1px solid #e8e8e8">
    <p style="margin:0;color:#aaa;font-size:11px">Sent weekday mornings while items are open · turn off in New Starter Queue → ⚙ Email settings</p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');
  const r = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({ from: 'iRam IT Support <noreply@outerjoin.co.za>', to, subject, html })
  });
  if (!r.ok) throw new Error(await r.text());
}
