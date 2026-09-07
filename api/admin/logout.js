// Clears the session cookie server-side. Client also clears sessionStorage.
const { clearCookieHeader } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Set-Cookie', clearCookieHeader());
  return res.status(200).json({ ok: true });
};
