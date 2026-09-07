// Self-service: turn off MFA on your own account. POST { currentPassword }.
const { requireRole } = require('../../lib/require-role');
const { disableMfa } = require('../../lib/users');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = requireRole(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { currentPassword } = req.body || {};
  if (!currentPassword) return res.status(400).json({ error: 'currentPassword is required' });

  try {
    const updated = await disableMfa(user.username, currentPassword);
    return res.status(200).json({ ok: true, user: updated });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Could not disable MFA.' });
  }
};
