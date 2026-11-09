// ──────────────────────────────────────────────────────────────────────────────
// Microsoft 365 directory sync + starter/leaver cross-checks (lib/ms-directory.js).
//
// GET  (Vercel cron, "Authorization: Bearer $CRON_SECRET") → nightly sync
// GET  ?status=1                       → sync status (anyone on the queue / HR form)
// GET  ?config=1                       → connection details, secret masked (IT / Super Admin)
// POST ?action=config { tenantId, clientId, clientSecret, secretExpires } | { clear:true }
//      → Super Admin saves the Azure app from Portal Settings → Microsoft 365,
//        then a sync runs straight away to prove it works
// POST ?action=sync                    → "Sync now" (IT)
// POST ?action=check { people, excludeTicketID, type }
//      → new starters: is the email free (+ a free alternative), possible
//        existing Microsoft accounts, the same person in other open requests.
//      → type 'leaver': the person's Microsoft account(s), and other open
//        leaver requests for the same person.
// ──────────────────────────────────────────────────────────────────────────────
const { verifyToken, sessionTokenFromRequest } = require('../../lib/auth');
const { hasPermission } = require('../../lib/roles');
const dir  = require('../../lib/ms-directory.js');
const blob = require('../../lib/blob.js');

const INDEX_PATH = 'account-requests/index.json';
const ACTIVE = new Set(['Open', 'In Progress']);

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Nightly cron
  const auth = req.headers.authorization || '';
  if (req.method === 'GET' && auth.startsWith('Bearer ')) {
    const secret = process.env.CRON_SECRET;
    if (!secret || auth !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });
    return res.status(200).json(await dir.sync('schedule'));
  }

  const session = verifyToken(sessionTokenFromRequest(req));
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  const isIT = hasPermission(session.role, 'manageTickets');
  const isOwner = hasPermission(session.role, 'manageUsers'); // Super Admin / Developer
  const canUse = isIT || isOwner || hasPermission(session.role, 'updateAccounts') || hasPermission(session.role, 'requestAccounts');
  if (!canUse) return res.status(403).json({ error: 'forbidden' });
  const q = req.query || {};
  const action = String(q.action || '');

  try {
    if (req.method === 'GET' && q.config) {
      if (!isIT && !isOwner) return res.status(403).json({ error: 'forbidden' });
      return res.status(200).json({ ...(await dir.connectionInfo()), status: await dir.status(), canEdit: isOwner && !session.preview });
    }
    if (req.method === 'GET') return res.status(200).json(await dir.status());

    if (req.method === 'POST' && action === 'config') {
      if (!isOwner || session.preview) return res.status(403).json({ error: 'Only a Super Admin can connect Microsoft 365.' });
      if (!blob.isConfigured()) return res.status(503).json({ error: 'Storage isn\'t configured.' });
      const b = req.body || {};
      const saved = await dir.saveCredentials(b, session.username);
      if (saved.error) return res.status(400).json({ error: saved.error });
      const info = await dir.connectionInfo();
      if (b.clear) return res.status(200).json({ ok: true, ...info, status: await dir.status() });
      const result = await dir.sync(session.username); // test it now, not tomorrow at 03:00
      return res.status(200).json({ ok: true, ...info, result, status: await dir.status() });
    }

    if (req.method === 'POST' && action === 'sync') {
      if (!(isIT || isOwner) || session.preview) return res.status(403).json({ error: 'Only IT can run a sync.' });
      const s = await dir.sync(session.username);
      return res.status(s.ok ? 200 : 502).json({ ...(await dir.status()), result: s });
    }

    if (req.method === 'POST' && action === 'check') {
      const b = req.body || {};
      const people = (Array.isArray(b.people) ? b.people : []).slice(0, 50);
      const exclude = String(b.excludeTicketID || '').toUpperCase();
      const type = b.type === 'leaver' ? 'leaver' : 'starter';
      const [directory, st, openPeople] = await Promise.all([dir.load(), dir.status(), loadOpenPeople(exclude, type)]);
      const results = people.map(p => {
        p = p || {};
        if (type === 'leaver') {
          const c = dir.checkPerson(p, null, openPeople, {});
          return { directory: directory ? { syncedAt: directory.syncedAt, count: directory.count } : null, accounts: dir.findAccounts(p, directory), duplicates: c.duplicates };
        }
        return dir.checkPerson(p, directory, openPeople, { wantedEmail: p.wantedEmail || '' });
      });
      return res.status(200).json({ status: st, results });
    }
  } catch (err) {
    console.error('directory error:', err.message);
    return res.status(500).json({ error: 'Something went wrong with the directory check.' });
  }
  return res.status(405).json({ error: 'Method not allowed' });
};

/** People in other active (non-test) requests of the same type, for duplicate checks. */
async function loadOpenPeople(excludeTicketID, type) {
  if (!blob.isConfigured()) return [];
  const index = (await blob.getJson(INDEX_PATH).catch(() => null)) || [];
  const active = index.filter(r => !r.test && ACTIVE.has(r.status || 'Open') && r.ticketID !== excludeTicketID &&
    ((r.type || 'starter') === type)).slice(0, 150);
  const records = await Promise.all(active.map(r => blob.getJson(`account-requests/${r.ticketID}.json`).catch(() => null)));
  const out = [];
  records.forEach(rec => (rec && !rec.deleted ? rec.people || [] : []).forEach((p, index) =>
    out.push({ ticketID: rec.ticketID, index, firstName: p.firstName, lastName: p.lastName, cellphone: p.cellphone, personalEmail: p.personalEmail || p.workEmail })));
  return out;
}
