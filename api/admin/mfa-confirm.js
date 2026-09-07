// Self-service: confirm a pending MFA setup. POST { code }. Any logged-in user.
const { requireRole } = require('../../lib/require-role');
const { confirmMfaSetup } = require('../../lib/users');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = requireRole(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { code } = req.body || {};
  if (!code) return res.status(400).json({ error: 'code is required' });

  try {
    const updated = await confirmMfaSetup(user.username, code);
    return res.status(200).json({ ok: true, user: updated });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Could not confirm MFA.' });
  }
};
