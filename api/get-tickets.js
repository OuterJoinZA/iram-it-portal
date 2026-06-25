module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = process.env.PA_GET_TICKETS_URL;
  if (!url) return res.status(500).json({ error: 'PA_GET_TICKETS_URL not configured' });

  try {
    const r    = await fetch(url);
    const data = await r.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
};
