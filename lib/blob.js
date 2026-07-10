// ──────────────────────────────────────────────────────────────────────────────
// Minimal Vercel Blob client, over the REST API with plain fetch.
//
// Deliberately dependency-free: this project ships static files plus CommonJS
// serverless functions and has no package.json. Adding the @vercel/blob SDK
// would introduce a build step to a live site; a failed REST call only breaks
// the feature, while a failed build breaks the whole portal.
//
// Requires BLOB_READ_WRITE_TOKEN (added automatically when you create a Blob
// store and connect it to the project). When it's absent every call reports
// notConfigured() so callers can fall back to built-in defaults.
// ──────────────────────────────────────────────────────────────────────────────
const BASE        = 'https://blob.vercel-storage.com';
const API_VERSION = '7';

function token()      { return process.env.BLOB_READ_WRITE_TOKEN || ''; }
function isConfigured() { return !!token(); }

function authHeaders(extra) {
  return Object.assign({
    authorization:   `Bearer ${token()}`,
    'x-api-version': API_VERSION
  }, extra || {});
}

/** Upload bytes at a fixed pathname (overwrites). Returns { url, pathname }. */
async function put(pathname, body, contentType) {
  if (!isConfigured()) throw new Error('blob_not_configured');
  const r = await fetch(`${BASE}/${pathname}`, {
    method:  'PUT',
    headers: authHeaders({
      'x-content-type':       contentType || 'application/octet-stream',
      'x-add-random-suffix':  '0',           // deterministic pathname, so it overwrites
      'x-cache-control-max-age': '0'         // always serve the latest edit
    }),
    body
  });
  if (!r.ok) throw new Error(`blob_put_${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** Look up a blob's public URL by exact pathname. null when it doesn't exist. */
async function urlFor(pathname) {
  if (!isConfigured()) throw new Error('blob_not_configured');
  const r = await fetch(`${BASE}?prefix=${encodeURIComponent(pathname)}&limit=100`, {
    headers: authHeaders()
  });
  if (!r.ok) throw new Error(`blob_list_${r.status}`);
  const { blobs = [] } = await r.json();
  const hit = blobs.find(b => b.pathname === pathname);
  return hit ? hit.url : null;
}

/**
 * Read a blob's bytes. Sends the token because a Private store refuses
 * unauthenticated reads; a Public store simply ignores the header, so this
 * works against either kind of store.
 */
async function getRaw(pathname) {
  const url = await urlFor(pathname);
  if (!url) return null;
  const r = await fetch(`${url}?t=${Date.now()}`, {
    cache:   'no-store',
    headers: { authorization: `Bearer ${token()}` }
  });
  if (!r.ok) throw new Error(`blob_get_${r.status}`);
  return r;
}

/** Read and parse a JSON blob. null when it hasn't been written yet. */
async function getJson(pathname) {
  const r = await getRaw(pathname);
  return r ? r.json() : null;
}

/** Write a JSON blob. */
async function putJson(pathname, data) {
  return put(pathname, JSON.stringify(data, null, 2), 'application/json');
}

module.exports = { isConfigured, put, putJson, getJson, getRaw, urlFor };
