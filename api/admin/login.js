// ──────────────────────────────────────────────────────────────────────────────
// Login. POST { username, password }.
//   - If password matches ADMIN_PASSWORD, log in as Super Admin regardless of
//     username or the users store — this is the permanent break-glass path and
//     how you log in the very first time, before any named accounts exist.
//   - Otherwise, look the username up in lib/users.js and verify their hash.
// Returns { ok:true, token, username, role } on success, 401 otherwise.
// ──────────────────────────────────────────────────────────────────────────────
const { issueToken } = require('../../lib/auth');
const { verifyPassword } = require('../../lib/users');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

  const breakGlass = process.env.ADMIN_PASSWORD;
  if (breakGlass && password === breakGlass) {
    const token = issueToken({ username, role: 'super_admin' });
    return res.status(200).json({ ok: true, token, username, role: 'super_admin' });
  }

  let user;
  try {
    user = await verifyPassword(username, password);
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ error: 'Login is temporarily unavailable.' });
  }

  if (!user) return res.status(401).json({ ok: false, error: 'Incorrect username or password.' });

  const token = issueToken({ username: user.username, role: user.role });
  return res.status(200).json({ ok: true, token, username: user.username, role: user.role });
};
