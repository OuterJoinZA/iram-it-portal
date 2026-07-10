// Admin: read/write the editable portal config (IT staff + calendar emails,
// issue categories + durations, Smart Priority keywords).
// GET  — full config, including staff emails
// POST — validate and save to Blob storage (takes effect immediately, no redeploy)
const { load, save } = require('../../lib/portal-config.js');
const blob           = require('../../lib/blob.js');

function isAuthed(req) {
  const required = process.env.ADMIN_PASSWORD;
  if (!required) return true; // not configured yet → setup mode, don't block
  return (req.headers['x-admin-key'] || '') === required;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const { config, source } = await load();
    return res.status(200).json({ config, source, storageReady: blob.isConfigured() });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!blob.isConfigured()) {
    return res.status(503).json({
      error: 'Storage not set up yet. In Vercel: Storage → Create → Blob, connect it to this project (this adds BLOB_READ_WRITE_TOKEN), then redeploy.'
    });
  }

  try {
    const config = await save(req.body);
    return res.status(200).json({ ok: true, config });
  } catch (err) {
    console.error('Portal config save failed:', err.message);
    return res.status(502).json({ error: 'Could not save settings.', detail: String(err.message || err) });
  }
};
