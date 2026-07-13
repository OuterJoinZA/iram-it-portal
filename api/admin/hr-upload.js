// Admin: upload a replacement HR document (PDF or image) to Blob.
// Expects { key, dataUrl } — a base64 data URL. Returns the proxy URL to store
// on the document card. Capped at ~4 MB (Vercel's request-body ceiling); a
// bigger PDF should be compressed first.
const blob = require('../../lib/blob.js');

function isAuthed(req) {
  const required = process.env.ADMIN_PASSWORD;
  if (!required) return true;
  return (req.headers['x-admin-key'] || '') === required;
}

const MAX_BYTES = 4.3 * 1024 * 1024;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAuthed(req))       return res.status(401).json({ error: 'Unauthorized' });

  if (!blob.isConfigured()) {
    return res.status(503).json({ error: 'Storage not connected. Connect a Vercel Blob store and redeploy.' });
  }

  const { key, dataUrl } = req.body || {};
  const m = /^data:(application\/pdf|image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(String(dataUrl || ''));
  if (!m) return res.status(400).json({ error: 'Expected a PDF or image file.' });

  const safeKey = String(key || 'doc').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'doc';
  const ext     = m[1] === 'application/pdf' ? 'pdf' : m[1].split('/')[1].replace('jpeg', 'jpg');

  try {
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_BYTES) {
      return res.status(413).json({ error: 'File is over ~4 MB. Please compress it and try again.' });
    }
    const path = `hr/${safeKey}-${Date.now()}.${ext}`;
    await blob.putFile(path, buf, m[1]);
    return res.status(200).json({ ok: true, url: `/api/hr-file?path=${encodeURIComponent(path)}` });
  } catch (err) {
    console.error('HR upload failed:', err.message);
    return res.status(502).json({ error: 'Upload failed.', detail: String(err.message || err) });
  }
};
