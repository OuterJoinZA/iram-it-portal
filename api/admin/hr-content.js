// Admin: read/write the HR-page content overrides (text + document cards).
// GET  — current overrides
// POST — validate and save to Blob (live immediately, no redeploy)
const { load, save } = require('../../lib/hr-content.js');
const blob           = require('../../lib/blob.js');

function isAuthed(req) {
  const required = process.env.ADMIN_PASSWORD;
  if (!required) return true; // setup mode
  return (req.headers['x-admin-key'] || '') === required;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const { content, source } = await load();
    return res.status(200).json({ content, source, storageReady: blob.isConfigured() });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!blob.isConfigured()) {
    return res.status(503).json({
      error: 'Storage not connected. Connect a Vercel Blob store to this project and redeploy.'
    });
  }

  try {
    const content = await save(req.body);
    return res.status(200).json({ ok: true, content });
  } catch (err) {
    console.error('HR content save failed:', err.message);
    return res.status(502).json({ error: 'Could not save HR content.', detail: String(err.message || err) });
  }
};
