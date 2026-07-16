// TEMPORARY diagnostic — lists blobs under a prefix. Admin-gated. Delete after use.
const blob = require('../../lib/blob.js');
function isAuthed(req) {
  const required = process.env.ADMIN_PASSWORD;
  if (!required) return true;
  return (req.headers['x-admin-key'] || '') === required;
}
module.exports = async function handler(req, res) {
  if (!isAuthed(req)) return res.status(401).json({ error: 'Unauthorized' });
  const prefix = String(req.query.prefix || 'tickets/');
  try {
    const url = await blob.urlFor(prefix); // not quite a list, so fall back to raw list below
  } catch (_) {}
  // Direct list via the SDK
  const { list } = require('@vercel/blob');
  const token = process.env.BLOB_READ_WRITE_TOKEN || Object.entries(process.env).find(([k]) => /BLOB_READ_WRITE_TOKEN$/.test(k))?.[1];
  const result = await list({ prefix, token, access: 'private' }).catch(e => ({ error: e.message }));
  return res.status(200).json(result);
};
