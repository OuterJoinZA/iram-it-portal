// ──────────────────────────────────────────────────────────────────────────────
// HR page — PUBLIC, view-only render engine (also the foundation for the admin
// editor). It does two things, in order:
//
//   1. Walk the page and give every editable text element and link a STABLE key,
//      derived from its ORIGINAL (baked) content — so keys survive edits and the
//      editor and this script always agree on them. The key is written to
//      data-hr-key; the kind (text | link) to data-hr-kind.
//   2. Apply any admin-saved overrides (text, link text/href) and render
//      admin-added custom blocks.
//
// Contains no editing UI. All editing happens in the admin-only editor
// (/admin/site-edit), which loads this page in an iframe and reads the keys
// this script assigns.
// ──────────────────────────────────────────────────────────────────────────────
(function () {
  const root = document.querySelector('main') || document.body;

  // Small, stable string hash (djb2-ish) → short base36.
  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  const SKIP = new Set(['SCRIPT', 'STYLE', 'SVG', 'PATH', 'NOSCRIPT', 'IFRAME', 'IMG', 'INPUT', 'TEXTAREA', 'BUTTON']);
  const TEXT_TAGS = new Set(['H1','H2','H3','H4','H5','H6','P','LI','SPAN','TD','TH','DIV','STRONG','EM','B','SMALL','LABEL']);

  // An element is editable text if it's a leaf (no element children), has visible
  // text, isn't inside a link, and isn't part of the editor's own chrome.
  function isTextLeaf(el) {
    if (el.children.length) return false;
    if (el.closest('a')) return false;
    if (el.closest('#hr-custom-blocks')) return false;
    return TEXT_TAGS.has(el.tagName) && el.textContent.trim().length > 0;
  }

  // Assign keys in document order so de-duplication is deterministic.
  function tagEditable() {
    const seen = Object.create(null);
    const makeKey = (kind, text) => {
      const base = kind[0] + '-' + hash(text.trim().slice(0, 120));
      const n = (seen[base] = (seen[base] || 0) + 1);
      return n > 1 ? base + '~' + n : base;
    };

    const all = root.querySelectorAll('a, h1,h2,h3,h4,h5,h6,p,li,span,td,th,div,strong,em,b,small,label');
    all.forEach(el => {
      if (SKIP.has(el.tagName)) return;
      if (el.closest('#hr-custom-blocks')) return;
      if (el.tagName === 'A') {
        if (el.closest('svg')) return;
        el.dataset.hrKey  = makeKey('link', el.textContent || el.getAttribute('href') || 'link');
        el.dataset.hrKind = 'link';
      } else if (isTextLeaf(el)) {
        el.dataset.hrKey  = makeKey('text', el.textContent);
        el.dataset.hrKind = 'text';
      }
    });
  }

  function applyOverrides(o) {
    o = o || {};
    const text  = o.text  || {};
    const links = o.links || {};

    root.querySelectorAll('[data-hr-key]').forEach(el => {
      const k = el.dataset.hrKey;
      if (el.dataset.hrKind === 'text' && text[k] != null) {
        el.textContent = text[k];
      } else if (el.dataset.hrKind === 'link' && links[k]) {
        if (links[k].text) el.textContent = links[k].text;
        if (links[k].href) el.setAttribute('href', links[k].href);
      }
    });

    renderBlocks(Array.isArray(o.blocks) ? o.blocks : []);
  }

  const esc     = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const escAttr = s => esc(s).replace(/"/g,'&quot;');

  function renderBlocks(blocks) {
    const host = document.getElementById('hr-custom-blocks');
    if (!host) return;
    host.innerHTML = blocks.map(b => `
      <div class="hr-block">
        ${b.heading ? `<h3 class="hr-block-h">${esc(b.heading)}</h3>` : ''}
        ${b.body ? `<div class="hr-block-b">${esc(b.body).replace(/\n/g,'<br>')}</div>` : ''}
        ${(b.linkText && b.linkUrl) ? `<a class="hr-block-link" href="${escAttr(b.linkUrl)}" target="_blank" rel="noopener">${esc(b.linkText)} →</a>` : ''}
      </div>`).join('');
  }

  // Assign keys from the baked page FIRST, then apply overrides on top.
  tagEditable();
  window.__hrApplyOverrides = applyOverrides; // used by the editor for live preview
  fetch('/api/hr-content', { cache: 'no-store' })
    .then(r => r.json())
    .then(applyOverrides)
    .catch(() => {})
    .finally(() => { window.__hrReady = true; }); // editor waits for this
})();
