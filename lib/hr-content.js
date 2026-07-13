// ──────────────────────────────────────────────────────────────────────────────
// Editable HR-page content, stored in Blob as OVERRIDES only.
//
// hr.html keeps its hard-coded content as the built-in fallback. This stores just
// the pieces an admin has changed, keyed by data-hr-text / data-hr-doc attributes:
//
//   text: { "<key>": "plain text" }
//   docs: { "<key>": { title, sub, fileUrl } }
//
// So an un-edited page renders exactly as written, and only overridden slots change.
// ──────────────────────────────────────────────────────────────────────────────
const blob = require('./blob.js');

const CONTENT_PATH = 'hr/content.json';

const str = (v, max) => String(v == null ? '' : v).slice(0, max);

// Links may only ever be http(s) or mailto — never javascript:/data: etc.
function safeUrl(v) {
  const s = String(v || '').trim();
  return /^(https?:\/\/|mailto:)/i.test(s) ? s.slice(0, 500) : '';
}

function empty() { return { text: {}, docs: {}, blocks: [] }; }

// Text overrides are applied as textContent (never innerHTML), so a saved value
// can't inject markup even though only admins can write it.
function sanitize(input) {
  const c = input && typeof input === 'object' ? input : {};
  const out = empty();

  if (c.text && typeof c.text === 'object') {
    for (const [k, v] of Object.entries(c.text)) {
      const key = str(k, 60).trim();
      if (key) out.text[key] = str(v, 20000);
    }
  }
  if (c.docs && typeof c.docs === 'object') {
    for (const [k, v] of Object.entries(c.docs)) {
      const key = str(k, 60).trim();
      if (!key || !v || typeof v !== 'object') continue;
      const doc = {
        title:   str(v.title, 200).trim(),
        sub:     str(v.sub, 300).trim(),
        // Only ever our own proxy path — never an arbitrary external URL.
        fileUrl: /^\/api\/hr-file\?path=hr%2F[A-Za-z0-9._%-]+$/.test(String(v.fileUrl || '')) ? v.fileUrl : ''
      };
      if (doc.title || doc.sub || doc.fileUrl) out.docs[key] = doc;
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
