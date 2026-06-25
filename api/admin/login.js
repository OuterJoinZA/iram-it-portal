// ──────────────────────────────────────────────────────────────────────────────
// Admin login. Verifies the password against the ADMIN_PASSWORD env var so the
// real password is NOT shipped to the browser in config.js.
//   - ok:true  → correct password; client stores it to authorize API calls
//   - 401      → wrong password
//   - mode:legacy → ADMIN_PASSWORD not set yet; client falls back to config.js
// ──────────────────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const required = process.env.ADMIN_PASSWORD;
  if (!required) return res.status(200).json({ ok: false, mode: 'legacy' });

  const { password } = req.body || {};
  if (password && password === required) return res.status(200).json({ ok: true });
  return res.status(401).json({ ok: false });
};
