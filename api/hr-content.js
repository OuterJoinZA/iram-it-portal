// Public HR-page content overrides (text, links, admin-added blocks). The HR
// page fetches this on load and applies any overrides over its built-in
// content. No secrets — staff-facing.
const { load } = require('../lib/hr-content.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { content, source } = await load();
  return res.status(200).json(Object.assign(content, { source }));
};
