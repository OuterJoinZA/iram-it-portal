// Streams a ticket's error-image attachment out of the PRIVATE Blob store.
// Admin-gated: error screenshots can contain sensitive info, so this never
// serves without the admin key, and the private Blob token stays server-side.
// The admin panel fetches this with the key and shows it via an object URL.
const blob = require('../lib/blob.js');

function isAuthed(req) {
  const required = process.env.ADMIN_PASSWORD;
  if (!required) return true; // setup mode
  return (req.headers['x-admin-key'] || '') === required;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!isAuthed(req))       return res.status(401).json({ error: 'Unauthorized' });

  // Only ever serve ticket attachment paths — no traversal, no arbitrary blobs.
  const path = String(req.query.path || '');
  if (!/^tickets\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(path)) {
    return res.status(400).json({ error: 'Invalid attachment path' });
  }

  try {
    const r = await blob.getRaw(path);
    if (!r) return res.status(404).json({ error: 'Attachment not found' });

    const buf = Buffer.from(await new Response(r.stream).arrayBuffer());
    res.setHeader('Content-Type', r.contentType || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(200).send(buf);
  } catch (err) {
    console.error('Attachment fetch failed:', err.message);
    return res.status(502).json({ error: 'Could not load attachment.' });
  }
};
