// ──────────────────────────────────────────────────────────────────────────────
// Manage named accounts. Super Admin only (manageUsers permission).
//   GET             → list accounts (no password hashes)
//   POST            → create { username, password, role }
//   PATCH ?username → update { role?, active?, password? }
//   DELETE ?username→ remove the account
// ──────────────────────────────────────────────────────────────────────────────
const { requireRole } = require('../../lib/require-role');
const { listUsers, createUser, updateUser, deleteUser } = require('../../lib/users');
const { listRoles } = require('../../lib/roles');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const user = requireRole(req, 'manageUsers');
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') {
      const users = await listUsers();
      return res.status(200).json({ users, roles: listRoles() });
    }

    if (req.method === 'POST') {
      const { username, password, role } = req.body || {};
      const created = await createUser({ username, password, role });
      return res.status(201).json({ ok: true, user: created });
    }

    if (req.method === 'PATCH') {
      const username = req.query.username || (req.body || {}).username;
      if (!username) return res.status(400).json({ error: 'username is required' });
      const { role, active, password } = req.body || {};
      const updated = await updateUser(username, { role, active, password });
      return res.status(200).json({ ok: true, user: updated });
    }

    if (req.method === 'DELETE') {
      const username = req.query.username || (req.body || {}).username;
      if (!username) return res.status(400).json({ error: 'username is required' });
      if (username.toLowerCase() === user.username.toLowerCase()) {
        return res.status(400).json({ error: "You can't delete your own account." });
      }
      await deleteUser(username);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Request failed' });
  }
};
