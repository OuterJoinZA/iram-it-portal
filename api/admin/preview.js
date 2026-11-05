// ──────────────────────────────────────────────────────────────────────────────
// Developer / Super Admin "preview as" — for testing features and chasing bugs.
// See the portal exactly as another user (or any role) sees it — same pages,
// same data, same landing — in TEST mode (see below). Admin and IT can't.
//
// POST { username }  → preview as that user (their role + their own data)
// POST { role }      → preview as a role, with no particular user behind it
// POST { exit: true }→ back to the real Super Admin session
//
// Preview sessions are TEST MODE and expire after 1 hour:
//   - new-starter account requests really submit, but as TEST records
//     (TEST-… number, TEST badge, emails only to the real person previewing,
//     no SharePoint ticket or calendar booking) — api/admin/account-request.js
//   - every other change is refused (lib/require-role.js), so real users,
//     tickets and the HR page can't be touched from a preview
// Only a real, non-preview session with previewUsers can start one, so a
// preview can't be chained.
// ──────────────────────────────────────────────────────────────────────────────
const { verifyToken, sessionTokenFromRequest, issueToken, sessionCookieHeader } = require('../../lib/auth');
const { hasPermission, isValidRole } = require('../../lib/roles');
const { getUser } = require('../../lib/users');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = verifyToken(sessionTokenFromRequest(req));
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  const body = req.body || {};

  if (body.exit) {
    if (!session.preview) return res.status(200).json({ ok: true, username: session.username, role: session.role });
    const { actor, actorRole, remember } = session.preview;
    const token = issueToken({ username: actor, role: actorRole, remember });
    res.setHeader('Set-Cookie', sessionCookieHeader(token, remember));
    return res.status(200).json({ ok: true, username: actor, role: actorRole });
  }

  if (session.preview) return res.status(400).json({ error: 'Exit the current preview first.' });
  if (!hasPermission(session.role, 'previewUsers')) return res.status(403).json({ error: 'Only Developers and Super Admins can preview as other users.' });

  let username, role;
  if (body.username) {
    const target = await getUser(body.username);
    if (!target) return res.status(404).json({ error: 'User not found.' });
    if (target.active === false) return res.status(400).json({ error: 'That account is deactivated.' });
    if (hasPermission(target.role, 'previewUsers')) return res.status(400).json({ error: 'Developers and Super Admins already see everything — pick another user or role to preview.' });
    username = target.username;
    role = target.role;
  } else if (body.role && isValidRole(body.role) && !hasPermission(body.role, 'previewUsers')) {
    role = body.role;
    username = `preview-${role}`;
  } else {
    return res.status(400).json({ error: 'Choose a user or a role to preview.' });
  }

  console.log(`preview: ${session.username} started previewing as ${username} (${role})`);
  const token = issueToken({ username, role, preview: { actor: session.username, actorRole: session.role, remember: false } });
  res.setHeader('Set-Cookie', sessionCookieHeader(token, false));
  return res.status(200).json({ ok: true, username, role, preview: true });
};
