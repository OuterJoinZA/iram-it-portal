// Self-service: change your own account password. POST { currentPassword, newPassword }.
// Distinct from change-password.js, which rotates the shared break-glass
// ADMIN_PASSWORD env var and is manageUsers-gated — this is any logged-in
// user changing their own named-account password.
const { requireRole } = require('../../lib/require-role');
const { verifyPassword, updateUser } = require('../../lib/users');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = requireRole(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required.' });
  }

  const verified = await verifyPassword(user.username, currentPassword);
  if (!verified) return res.status(401).json({ error: 'Current password is incorrect.' });

  try {
    await updateUser(user.username, { password: newPassword });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Could not change the password.' });
  }
};
