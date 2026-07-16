// ──────────────────────────────────────────────────────────────────────────────
// Editable HR-page content, stored in Blob as OVERRIDES only.
//
// hr.html keeps its hard-coded content as the built-in fallback. This stores just
// the pieces an admin has changed, keyed by the stable data-hr-key that
// assets/hr-render.js assigns to every editable text element and link:
//
//   text:  { "<key>": "plain text" }
//   links: { "<key>": { text, href } }
//   blocks: [ { heading, body, linkText, linkUrl } ]   (admin-added)
//
// So an un-edited page renders exactly as written, and only overridden slots change.
// ──────────────────────────────────────────────────────────────────────────────
const blob = require('./blob.js');

const CONTENT_PATH = 'hr/content.json';

const str = (v, max) => String(v == null ? '' : v).slice(0, max);
const key = k => str(k, 80).trim();

// Link hrefs: http(s), mailto, tel, our own file proxy, or a relative site path.
// Never javascript:/data: etc. The HR page uses tel: links throughout its
// contact cards, so that scheme must be allowed or every phone-number edit
// would be silently stripped on save.
function safeUrl(v) {
  const s = String(v || '').trim();
  return /^(https?:\/\/|mailto:|tel:|\/[A-Za-z0-9._~%?=&/-]*|hr-assets\/[A-Za-z0-9._/-]+)$/i.test(s) ? s.slice(0, 500) : '';
}

function empty() { return { text: {}, links: {}, blocks: [] }; }

// Text overrides are applied as textContent (never innerHTML), so a saved value
// can't inject markup even though only admins can write it.
function sanitize(input) {
  const c = input && typeof input === 'object' ? input : {};
  const out = empty();

  if (c.text && typeof c.text === 'object') {
    for (const [k, v] of Object.entries(c.text)) {
      const kk = key(k);
      if (kk) out.text[kk] = str(v, 20000);
    }
  }
  if (c.links && typeof c.links === 'object') {
    for (const [k, v] of Object.entries(c.links)) {
      const kk = key(k);
      if (!kk || !v || typeof v !== 'object') continue;
      const link = { text: str(v.text, 400), href: safeUrl(v.href) };
      if (link.text || link.href) out.links[kk] = link;
    }
  }
  // Admin-added content blocks (heading + body + optional link), rendered in a
  // dedicated region on the HR page.
  if (Array.isArray(c.blocks)) {
    out.blocks = c.blocks.slice(0, 50).map(b => ({
      heading:  str(b && b.heading, 200).trim(),
      body:     str(b && b.body, 8000),
      linkText: str(b && b.linkText, 120).trim(),
      linkUrl:  safeUrl(b && b.linkUrl)
    })).filter(b => b.heading || b.body || (b.linkText && b.linkUrl));
  }
  return out;
}

async function load() {
  if (!blob.isConfigured()) return { content: empty(), source: 'defaults' };
  try {
    const saved = await blob.getJson(CONTENT_PATH);
    return saved ? { content: sanitize(saved), source: 'blob' } : { content: empty(), source: 'defaults' };
  } catch (err) {
    console.error('hr-content load failed:', err.message);
    return { content: empty(), source: 'defaults' };
  }
}

async function save(input) {
  const content = sanitize(input);
  await blob.putJson(CONTENT_PATH, content);
  return content;
}

module.exports = { load, save, sanitize, empty, CONTENT_PATH };
