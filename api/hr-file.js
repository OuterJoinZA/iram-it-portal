// Streams an HR document out of the PRIVATE Blob store. PUBLIC — HR policy PDFs
// are staff-facing, so no auth (unlike /api/attachment). The private Blob token
// stays server-side; only paths under hr/ are ever served.
const blob = require('../lib/blob.js');

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const path = String(req.query.path || '');
  if (!/^hr\/[A-Za-z0-9._-]+$/.test(path)) {
    return res.status(400).json({ error: 'Invalid file path' });
  }

  try {
    const r = await blob.getRaw(path);
    if (!r) return res.status(404).json({ error: 'File not found' });

    const buf = Buffer.from(await new Response(r.stream).arrayBuffer());
    res.setHeader('Content-Type', r.contentType || 'application/octet-stream');
    // Inline so PDFs open in the browser tab like the existing static links do.
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).send(buf);
  } catch (err) {
    console.error('HR file fetch failed:', err.message);
    return res.status(502).json({ error: 'Could not load file.' });
  }
};
