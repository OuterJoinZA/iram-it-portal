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

// Vercel names the token BLOB_READ_WRITE_TOKEN, but prefixes it when a store is
// connected under a custom name (e.g. IRAM_BLOB_READ_WRITE_TOKEN). Accept either.
function token() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const key = Object.keys(process.env).find(k => /BLOB_READ_WRITE_TOKEN$/.test(k));
  return key ? process.env[key] : '';
}
function isConfigured() { return !!token(); }

function authHeaders(extra) {
  return Object.assign({
    authorization:   `Bearer ${token()}`,
    'x-api-version': API_VERSION
  }, extra || {});
}

// A store's access mode is fixed when it's created and an upload must match it —
// a Private store rejects a public upload outright. Ours is Private (the config
// holds staff emails); override with BLOB_ACCESS if a public store is ever used.
const ACCESS = () => process.env.BLOB_ACCESS || 'private';

/** Upload bytes at a fixed pathname (overwrites). Returns { url, pathname }. */
async function put(pathname, body, contentType) {
  if (!isConfigured()) throw new Error('blob_not_configured');
  const r = await fetch(`${BASE}/${pathname}`, {
    method:  'PUT',
    headers: authHeaders({
      'x-access':             ACCESS(),
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
