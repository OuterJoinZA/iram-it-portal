// ──────────────────────────────────────────────────────────────────────────────
// HR page — PUBLIC, view-only. Applies admin-saved overrides over the built-in
// content and renders any admin-added blocks. Contains no editing code: all
// editing happens in the admin-only editor (/admin/site-edit.html).
// ──────────────────────────────────────────────────────────────────────────────
(function () {
  const cssEsc  = s => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
  const esc     = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = s => esc(s).replace(/"/g, '&quot;');

  function apply(o) {
    o = o || {};
    Object.entries(o.text || {}).forEach(([k, v]) =>
      document.querySelectorAll(`[data-hr-text="${cssEsc(k)}"]`).forEach(el => { el.textContent = v; }));

    Object.entries(o.docs || {}).forEach(([k, d]) =>
      document.querySelectorAll(`[data-hr-doc="${cssEsc(k)}"]`).forEach(card => {
        if (d.title) { const t = card.querySelector('.dc-title'); if (t) t.textContent = d.title; }
        if (d.sub)   { const s = card.querySelector('.dc-sub');   if (s) s.textContent = d.sub; }
        if (d.fileUrl) card.setAttribute('href', d.fileUrl);
      }));

    renderBlocks(Array.isArray(o.blocks) ? o.blocks : []);
  }

  function renderBlocks(blocks) {
    const host = document.getElementById('hr-custom-blocks');
    if (!host) return;
    host.innerHTML = blocks.map(b => `
      <div class="hr-block">
        ${b.heading ? `<h3 class="hr-block-h">${esc(b.heading)}</h3>` : ''}
        ${b.body ? `<div class="hr-block-b">${esc(b.body).replace(/\n/g, '<br>')}</div>` : ''}
        ${(b.linkText && b.linkUrl) ? `<a class="hr-block-link" href="${escAttr(b.linkUrl)}" target="_blank" rel="noopener">${esc(b.linkText)} →</a>` : ''}
      </div>`).join('');
  }

  fetch('/api/hr-content', { cache: 'no-store' })
    .then(r => r.json())
    .then(apply)
    .catch(() => {}); // page keeps its built-in content if overrides can't load
})();
