module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const url = process.env.PA_UPDATE_TICKET_URL;
  if (!url) return res.status(500).json({ error: 'PA_UPDATE_TICKET_URL not configured' });

  try {
    const r = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(req.body || {})
    });
    const data = await r.json().catch(() => ({ success: true }));
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
