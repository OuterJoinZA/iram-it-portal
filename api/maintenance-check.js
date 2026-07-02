module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const v = process.env.MAINTENANCE_MODE || '';
  return res.status(200).json({ maintenance: v === '1' || v.toLowerCase() === 'true' });
};
