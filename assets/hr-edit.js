// ──────────────────────────────────────────────────────────────────────────────
// HR page: apply admin overrides, and give logged-in admins an inline editor.
//
// - Everyone: overrides from /api/hr-content are applied over the built-in page
//   content (elements tagged data-hr-text="key" / data-hr-doc="key").
// - Admins (same-origin session from /login): an "Edit HR page" button appears.
//   Edit mode makes tagged text editable and lets each document card's title,
//   subtitle and PDF be changed, saving to Blob with no redeploy.
// ──────────────────────────────────────────────────────────────────────────────
(function () {
  const isAdmin  = () => sessionStorage.getItem('iram_it_auth') === 'true';
  const adminKey = () => sessionStorage.getItem('iram_it_key') || '';
  const adminFetch = (url, opts = {}) =>
    fetch(url, Object.assign({ cache: 'no-store' }, opts,
      { headers: Object.assign({}, opts.headers, { 'x-admin-key': adminKey() }) }));

  const cssEsc = s => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
  const textEls = key => document.querySelectorAll(`[data-hr-text="${cssEsc(key)}"]`);
  const docEls  = key => document.querySelectorAll(`[data-hr-doc="${cssEsc(key)}"]`);

  let editing    = false;
  let uploaded   = {};   // docKey -> new fileUrl chosen this session (before save)

  // ── Apply overrides over the baked-in content ──────────────────────────────
  function applyOverrides(o) {
    Object.entries(o.text || {}).forEach(([k, v]) => textEls(k).forEach(el => { el.textContent = v; }));
    Object.entries(o.docs || {}).forEach(([k, d]) => docEls(k).forEach(card => {
      if (d.title)   { const t = card.querySelector('.dc-title'); if (t) t.textContent = d.title; }
      if (d.sub)     { const s = card.querySelector('.dc-sub');   if (s) s.textContent = d.sub; }
      if (d.fileUrl) card.setAttribute('href', d.fileUrl);
    }));
  }

  // ── Collect current on-page values into an overrides object ────────────────
  function collect() {
    const text = {};
    document.querySelectorAll('[data-hr-text]').forEach(el => {
      text[el.dataset.hrText] = el.textContent.trim();
    });
    const docs = {};
    document.querySelectorAll('[data-hr-doc]').forEach(card => {
      const key = card.dataset.hrDoc;
      docs[key] = {
        title:   (card.querySelector('.dc-title')?.textContent || '').trim(),
        sub:     (card.querySelector('.dc-sub')?.textContent   || '').trim(),
        fileUrl: uploaded[key] || card.getAttribute('href') || ''
      };
      // Only send a fileUrl the server will accept (our proxy path); a static
      // hr-assets/... default is left blank so the page keeps its baked link.
      if (!/^\/api\/hr-file\?/.test(docs[key].fileUrl)) docs[key].fileUrl = '';
    });
    return { text, docs };
  }

  // ── Edit-mode toggling ─────────────────────────────────────────────────────
  function setEditing(on) {
    editing = on;
    document.body.classList.toggle('hr-editing', on);
    document.querySelectorAll('[data-hr-text]').forEach(el => {
      el.contentEditable = on ? 'true' : 'false';
    });
    document.querySelectorAll('[data-hr-doc]').forEach(card => {
      card.querySelectorAll('.dc-title, .dc-sub').forEach(el => { el.contentEditable = on ? 'true' : 'false'; });
      let ctrl = card.parentNode.querySelector('.hr-doc-ctrl[data-for="' + card.dataset.hrDoc + '"]');
      if (on && !ctrl) {
        ctrl = document.createElement('div');
        ctrl.className = 'hr-doc-ctrl';
        ctrl.dataset.for = card.dataset.hrDoc;
        ctrl.innerHTML = '<label class="hr-replace">📎 Replace PDF<input type="file" accept="application/pdf,image/*" hidden></label><span class="hr-doc-note"></span>';
        card.insertAdjacentElement('afterend', ctrl);
        ctrl.querySelector('input').addEventListener('change', e => replacePdf(card, ctrl, e.target.files[0]));
      }
      if (ctrl) ctrl.style.display = on ? 'flex' : 'none';
    });
    renderBar();
  }

  // Uploading a replacement blocks navigation on the card while editing.
  async function replacePdf(card, ctrl, file) {
    if (!file) return;
    if (file.size > 4.3 * 1024 * 1024) { note(ctrl, 'File is over ~4 MB — compress it first.', true); return; }
    note(ctrl, 'Uploading…');
    try {
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
      });
      const resp = await adminFetch('/api/admin/hr-upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: card.dataset.hrDoc, dataUrl })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) { note(ctrl, data.error || 'Upload failed.', true); return; }
      uploaded[card.dataset.hrDoc] = data.url;
      card.setAttribute('href', data.url);
      note(ctrl, '✓ New file attached — remember to Save.');
    } catch (_) { note(ctrl, 'Upload failed — network error.', true); }
  }
  function note(ctrl, msg, err) {
    const n = ctrl.querySelector('.hr-doc-note');
    n.textContent = msg; n.style.color = err ? '#a4262c' : '#4e9938';
  }

  async function save() {
    const bar = document.getElementById('hr-edit-bar');
    const btn = document.getElementById('hr-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = '💾 Saving…'; }
    try {
      const resp = await adminFetch('/api/admin/hr-content', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collect())
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) { flash(bar, data.error || 'Save failed.', true); return; }
      uploaded = {};
      applyOverrides(data.content);
      setEditing(false);
      flash(bar, '✓ Saved — live for everyone now.');
    } catch (_) {
      flash(bar, 'Save failed — network error.', true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Save changes'; }
    }
  }
  function flash(bar, msg, err) {
    const m = document.getElementById('hr-edit-msg');
    if (!m) return;
    m.textContent = msg; m.style.color = err ? '#ffd0d0' : '#d6f5c6';
    setTimeout(() => { if (m.textContent === msg) m.textContent = ''; }, 4000);
  }

  // ── Floating control bar ───────────────────────────────────────────────────
  function renderBar() {
    let bar = document.getElementById('hr-edit-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'hr-edit-bar';
      document.body.appendChild(bar);
    }
    bar.innerHTML = editing
      ? '<span id="hr-edit-msg"></span><button id="hr-cancel-btn">✕ Cancel</button><button id="hr-save-btn">💾 Save changes</button>'
      : '<button id="hr-editmode-btn">✏️ Edit HR page</button>';
    if (editing) {
      bar.querySelector('#hr-save-btn').onclick   = save;
      bar.querySelector('#hr-cancel-btn').onclick = () => { location.reload(); };
    } else {
      bar.querySelector('#hr-editmode-btn').onclick = () => setEditing(true);
    }
  }

  // Block link navigation on document cards while editing.
  document.addEventListener('click', e => {
    if (editing && e.target.closest('[data-hr-doc]')) e.preventDefault();
  }, true);

  // ── Init ───────────────────────────────────────────────────────────────────
  fetch('/api/hr-content', { cache: 'no-store' })
    .then(r => r.json())
    .then(applyOverrides)
    .catch(() => {})
    .finally(() => { if (isAdmin()) renderBar(); });
})();
