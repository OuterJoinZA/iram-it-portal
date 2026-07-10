// ──────────────────────────────────────────────────────────────────────────────
// Vercel Blob access, via the official @vercel/blob SDK.
//
// This was hand-rolled against the REST API to avoid adding a dependency, but
// that API is internal and versioned (it moved from blob.vercel-storage.com to
// vercel.com/api/blob, and from api-version 7 to 12) and silently defaulted
// uploads to public — which a Private store rejects. The SDK tracks all of that,
// so it's the safer dependency.
//
// The store is Private: only the server, holding BLOB_READ_WRITE_TOKEN, can read
// or write. Callers should treat a missing token as "not configured" and fall
// back to defaults rather than failing.
// ──────────────────────────────────────────────────────────────────────────────
const { put, get } = require('@vercel/blob');

// Vercel names the token BLOB_READ_WRITE_TOKEN, but prefixes it when a store is
// connected under a custom name (e.g. IRAM_BLOB_READ_WRITE_TOKEN). Accept either.
function token() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const key = Object.keys(process.env).find(k => /BLOB_READ_WRITE_TOKEN$/.test(k));
  return key ? process.env[key] : '';
}

function isConfigured() { return !!token(); }

// A store's access mode is fixed at creation and every upload must match it.
const access = () => process.env.BLOB_ACCESS || 'private';

/** Upload bytes at a fixed pathname, overwriting whatever was there. */
async function putFile(pathname, body, contentType) {
  if (!isConfigured()) throw new Error('blob_not_configured');
  return put(pathname, body, {
    access:             access(),
    contentType:        contentType || 'application/octet-stream',
    addRandomSuffix:    false,   // deterministic pathname so edits overwrite
    allowOverwrite:     true,    // ...which requires opting in
    cacheControlMaxAge: 0,       // always serve the latest edit
    token:              token()
  });
}

/**
 * Read a blob. Returns { stream, contentType, size } or null when absent.
 * Used to stream HR documents to the browser without exposing the token.
 */
async function getRaw(pathname) {
  if (!isConfigured()) throw new Error('blob_not_configured');
  let r;
  try {
    r = await get(pathname, { access: access(), useCache: false, token: token() });
  } catch (_) {
    return null; // not found
  }
  if (!r || r.statusCode !== 200 || !r.stream) return null;
  return { stream: r.stream, contentType: r.blob.contentType, size: r.blob.size };
}

/** Read and parse a JSON blob. null when it hasn't been written yet. */
async function getJson(pathname) {
  const r = await getRaw(pathname);
  if (!r) return null;
  const text = await new Response(r.stream).text();
  return text ? JSON.parse(text) : null;
}

/** Write a JSON blob. */
async function putJson(pathname, data) {
  return putFile(pathname, JSON.stringify(data, null, 2), 'application/json');
}

module.exports = { isConfigured, putFile, putJson, getJson, getRaw };
