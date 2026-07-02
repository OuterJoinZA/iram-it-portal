module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const required = process.env.MANAGER_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!required) return res.status(200).json({ ok: true, mode: 'open' });

  const { password } = req.body || {};
  if (password && password === required) return res.status(200).json({ ok: true });
  return res.status(401).json({ ok: false });
};
