// ──────────────────────────────────────────────────────────────────────────────
// HR page — PUBLIC, view-only render engine (also the foundation for the admin
// editor). It does three things, in order:
//
//   1. Walk the page and give every editable text element and link a STABLE key,
//      derived from its ORIGINAL (baked) content — so keys survive edits and the
//      editor and this script always agree on them. The key is written to
//      data-hr-key; the kind to data-hr-kind ("text" | "link" | "link-card").
//   2. Detect repeatable sections (HR contacts, document cards, welcome items,
//      policy bullet points) and tag each item with a stable data-hr-item-id, so
//      admins can remove an existing item or add a new one to that section.
//   3. Apply any admin-saved overrides (text, links, added/removed repeat items,
//      custom blocks).
//
// Contains no editing UI. All editing happens in the admin-only editor
// (/admin/site-edit), which loads this page in an iframe, reads the keys this
// script assigns, and calls window.__hrEnableRepeaterControls() to turn on the
// +Add/✕Remove controls.
// ──────────────────────────────────────────────────────────────────────────────
(function () {
  const root = document.querySelector('main') || document.body;

  // Small, stable string hash (djb2-ish) → short base36.
  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  const esc     = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const escAttr = s => esc(s).replace(/"/g,'&quot;');

  // querySelectorAll never includes its own root, which matters here: a repeat
  // item's root element can itself be an editable field (a doc-card's root IS
  // the <a> that needs tagging). Every place that walks "every [data-hr-key] in
  // this subtree" needs to check the root too, so it's centralised once here.
  function selfAndMatches(el, selector) {
    return [...(el.matches && el.matches(selector) ? [el] : []), ...el.querySelectorAll(selector)];
  }

  // ── Pass 1: split mixed-content prose into independently editable runs ─────
  const SKIP = new Set(['SCRIPT', 'STYLE', 'SVG', 'PATH', 'NOSCRIPT', 'IFRAME', 'IMG', 'INPUT', 'TEXTAREA', 'BUTTON']);
  const TEXT_TAGS = new Set(['H1','H2','H3','H4','H5','H6','P','LI','SPAN','TD','TH','DIV','STRONG','EM','B','SMALL','LABEL']);

  // Many blocks mix plain prose with inline formatting, e.g.
  //   <li><strong>Annual Leave Policy</strong> — Employees are entitled to…</li>
  //   <p>Email <a href="mailto:...">hr@iram.co.za</a> for help.</p>
  // A leaf-only walk finds "Annual Leave Policy" and the link, but the plain
  // text around them has no element to attach a key to. Before tagging leaves,
  // wrap each loose run of text inside a "simple" container (only inline
  // children — bold/italic/links/line breaks, never nested divs/lists/cards)
  // in its own <span> so it becomes independently editable too.
  const CONTAINER_TAGS = new Set(['P','LI','DIV','TD','TH','H1','H2','H3','H4','H5','H6']);
  const INLINE_OK      = new Set(['STRONG','EM','B','SMALL','BR','SPAN','A']);

  function wrapLooseText(scope) {
    scope.querySelectorAll([...CONTAINER_TAGS].join(',')).forEach(el => {
      if (el.closest('#hr-custom-blocks')) return;
      if (el.closest('a')) return; // inside a link — edited as that link's label, not separately
      const kids = [...el.children];
      if (!kids.length) return;                                  // no element children -> already a plain leaf
      if (!kids.every(k => INLINE_OK.has(k.tagName))) return;     // has real structure (nested div/list/card) -> leave alone

      [...el.childNodes].forEach(n => {
        if (n.nodeType === Node.TEXT_NODE && n.textContent.trim()) {
          const span = document.createElement('span');
          span.textContent = n.textContent;
          el.replaceChild(span, n);
        }
      });
    });
  }

  // A link is "card-style" if it wraps structured content (an icon + a title/
  // subtitle block, etc.) rather than being a plain text label. Treating its
  // whole subtree as one editable text field would let a saved edit collapse
  // that structure to plain text on the next load — so card links are editable
  // by HREF ONLY, and their inner text pieces (title, subtitle, …) become their
  // own independent text leaves instead, same as anywhere else on the page.
  function isCardLink(a) {
    return a.children.length >= 2;
  }

  // An element is editable text if it's a leaf (no element children), has
  // visible text, isn't part of the editor's own chrome, and — unless it's
  // inside a card-style link — isn't inside a link at all (a simple link's
  // text is edited as that link's own label, not as a separate field).
  function isTextLeaf(el) {
    if (el.children.length) return false;
    if (el.closest('#hr-custom-blocks')) return false;
    const link = el.closest('a');
    if (link && !isCardLink(link)) return false;
    return TEXT_TAGS.has(el.tagName) && el.textContent.trim().length > 0;
  }

  const EDITABLE_SEL = 'a, h1,h2,h3,h4,h5,h6,p,li,span,td,th,div,strong,em,b,small,label';

  // Split into two steps so a freshly-cloned repeat item can be blanked to
  // placeholder text IN BETWEEN them: classify() decides text/link/link-card
  // purely from structure (content-independent), THEN assignKeys() hashes
  // whatever content is present at that moment. Doing both in one pass would
  // key a blanked item off its template's ORIGINAL text ("Toniel Nicolaides")
  // instead of its placeholder ("New Name") — so a later reload, which clones
  // + blanks fresh, would compute a different key and never find the saved
  // override for that field.
  function classify(scope) {
    selfAndMatches(scope, EDITABLE_SEL).forEach(el => {
      if (SKIP.has(el.tagName)) return;
      if (el.closest('#hr-custom-blocks')) return;
      if (el.tagName === 'A') {
        if (el.closest('svg')) return;
        el.dataset.hrKind = isCardLink(el) ? 'link-card' : 'link'; // link-card: href only, see isCardLink()
      } else if (isTextLeaf(el)) {
        el.dataset.hrKind = 'text';
      }
    });
  }

  // Assigns keys in document order so de-duplication is deterministic. Only
  // touches elements classify() already marked, and reads their CURRENT
  // content — call this only once the content is in its final (or intentional
  // placeholder) state.
  function assignKeys(scope) {
    const seen = Object.create(null);
    const makeKey = (kind, text) => {
      const base = kind[0] + '-' + hash(text.trim().slice(0, 120));
      const n = (seen[base] = (seen[base] || 0) + 1);
      return n > 1 ? base + '~' + n : base;
    };
    selfAndMatches(scope, '[data-hr-kind]').forEach(el => {
      const kind = el.dataset.hrKind;
      const sig  = kind === 'link-card' ? (el.getAttribute('href') || 'card-link')
                 : kind === 'link'      ? (el.textContent || el.getAttribute('href') || 'link')
                 : el.textContent;
      el.dataset.hrKey = makeKey(kind, sig);
    });
  }

  // Convenience for the normal (non-repeat-item) case: classify then key in
  // one call, since content is already final at that point.
  function tagEditable(scope) { classify(scope); assignKeys(scope); }

  function applyOverrides(o) {
    o = o || {};
    applyTextLinks(root, o.text || {}, o.links || {});
    renderBlocks(Array.isArray(o.blocks) ? o.blocks : []);
    applyRepeaters(o.repeaters || {});
  }

  // Applies a flat {key: value} map to every [data-hr-key] element inside `scope`.
  // Used both for the whole-page overrides and, scoped to one cloned repeat item,
  // for that item's own saved field values.
  function applyTextLinks(scope, text, links) {
    selfAndMatches(scope, '[data-hr-key]').forEach(el => {
      const k = el.dataset.hrKey;
      if (el.dataset.hrKind === 'text' && text[k] != null) {
        el.textContent = text[k];
      } else if ((el.dataset.hrKind === 'link' || el.dataset.hrKind === 'link-card') && links[k]) {
        if (links[k].text && el.dataset.hrKind === 'link') el.textContent = links[k].text;
        if (links[k].href) el.setAttribute('href', links[k].href);
      }
    });
  }

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

  // ── Repeatable sections: HR contacts, document cards, welcome items, policy
  //    bullet points. Auto-detected by CSS pattern — no manual tagging needed
  //    per item, and any future section matching one of these patterns picks up
  //    add/remove support automatically. ────────────────────────────────────
  const REPEAT_GROUPS = [
    { container: '.contact-grid', item: '.contact-card' },
    { container: '.welcome-grid', item: '.welcome-box'  },
    { container: '.docs-grid',    item: '.doc-card'      },
    { container: '.policy-body ul', item: 'li'           }
  ];

  // Placeholders shown in a freshly-added item before the admin fills them in.
  // Keyed by the field's own class where one exists (readable + collision-free
  // within a single cloned item); falls back to a numbered generic label.
  const FIELD_PLACEHOLDER = {
    'cc-avatar': '👤', 'cc-name': 'New Name', 'cc-role': 'New Role / Title',
    'dc-icon': '📄', 'dc-title': 'New Document Title', 'dc-sub': 'New document subtitle', 'dc-arrow': '↓',
    'wb-title': 'New Item Title', 'wb-sub': 'New item subtitle'
  };
  function placeholderText(el, idx) {
    const cls = (el.className || '').split(' ')[0];
    if (FIELD_PLACEHOLDER[cls]) return FIELD_PLACEHOLDER[cls];
    // Icon-ish leaf with no matching class (e.g. a welcome-box's bare emoji
    // span) — its ORIGINAL content is still in el.textContent at this point
    // (blanking hasn't happened yet), so a short original value is a reliable
    // sign this is an icon, not prose. Icons are usually styled at a large
    // font-size, so falling through to "New text N" here would show large,
    // wrong-looking placeholder text instead of an icon-shaped one.
    if (el.textContent.trim().length <= 2) return '📄';
    return el.dataset.hrKind === 'text' ? `New text ${idx + 1}` : `New link ${idx + 1}`;
  }
  function placeholderHref(el) {
    const cur = (el.getAttribute('href') || '').toLowerCase();
    if (cur.startsWith('mailto:')) return 'mailto:new@iram.co.za';
    if (cur.startsWith('tel:'))    return 'tel:+27000000000';
    if (/\.(pdf|png|jpe?g|gif|webp)(\?|$)/.test(cur)) return '#'; // needs a file uploaded before it's real
    return cur.startsWith('http') ? 'https://example.com' : (cur || '#');
  }

  // groupId is derived from the container's nearby heading text, so it's stable
  // across reloads without hand-annotating every section. (If that heading text
  // is later edited, the group effectively becomes a new one — an accepted
  // trade-off: it only happens on a deliberate section-heading rename, and the
  // fix is just re-adding whatever admin state existed.)
  function groupId(cfg, container, idx) {
    if (cfg.container === '.contact-grid') return 'hr-contacts';
    if (cfg.container === '.welcome-grid') return 'welcome-items';
    let heading = '';
    if (cfg.container === '.docs-grid') {
      const h2 = container.closest('.white-card')?.querySelector('.white-card-header h2');
      heading = h2 ? h2.textContent.trim() : String(idx);
      return 'docs-' + hash(heading);
    }
    if (cfg.container === '.policy-body ul') {
      const ph = container.closest('.policy-item')?.querySelector('.ph-title');
      heading = ph ? ph.textContent.trim() : String(idx);
      return 'policy-' + hash(heading);
    }
    return 'group-' + idx;
  }

  const groups = new Map(); // groupId -> { container, template (blank source), originals: [{id, el}] }

  function detectRepeatGroups() {
    REPEAT_GROUPS.forEach(cfg => {
      root.querySelectorAll(cfg.container).forEach((container, idx) => {
        if (container.closest('#hr-custom-blocks')) return;
        const id = groupId(cfg, container, idx);
        const items = [...container.querySelectorAll(':scope > ' + cfg.item)];
        if (!items.length) return;

        items.forEach(itemEl => {
          itemEl.dataset.hrGroup = id;
          // Item id: hash of its ORIGINAL text + hrefs, so it's stable across
          // reloads regardless of unrelated edits elsewhere on the page.
          const sig = itemEl.textContent.trim().slice(0, 200) + '|' +
            [...itemEl.querySelectorAll('a')].map(a => a.getAttribute('href')).join(',');
          itemEl.dataset.hrItemId = hash(sig);
        });

        groups.set(id, { container, itemSel: cfg.item, template: items[0].cloneNode(true), originals: items });
      });
    });
  }

  /** Builds one fresh, blanked-out item ready to be edited or to receive saved overrides. */
  function createBlankItem(id) {
    const g = groups.get(id);
    if (!g) return null;
    const el = g.template.cloneNode(true);
    delete el.dataset.hrItemId;
    el.dataset.hrGroup = id;
    el.dataset.hrAdded = 'true';

    classify(el); // structural only — safe to run before content is blanked
    let idx = 0;
    selfAndMatches(el, '[data-hr-kind]').forEach(f => {
      if (f.dataset.hrKind === 'text') { f.textContent = placeholderText(f, idx++); }
      else if (f.dataset.hrKind === 'link') { f.textContent = placeholderText(f, idx); f.setAttribute('href', placeholderHref(f)); idx++; }
      else if (f.dataset.hrKind === 'link-card') { f.setAttribute('href', placeholderHref(f)); }
    });
    assignKeys(el); // NOW hash the placeholder content, so reload (clone+blank again) matches
    return el;
  }

  function applyRepeaters(repeaters) {
    groups.forEach((g, id) => {
      const conf = repeaters[id];
      if (!conf) return;

      (conf.removed || []).forEach(itemId => {
        const el = g.originals.find(o => o.dataset.hrItemId === itemId);
        if (el) el.style.display = 'none';
      });

      (conf.added || []).forEach(entry => {
        const el = createBlankItem(id);
        if (!el) return;
        applyTextLinks(el, entry.text || {}, entry.links || {});
        g.container.appendChild(el);
      });
    });
  }

  // ── Editor-only controls (+Add / ✕Remove). Never runs on the public page —
  //    only called by admin/site-edit.html after it confirms an admin session. ─
  function enableRepeaterControls() {
    if (document.getElementById('hr-repeat-style')) return; // idempotent
    const st = document.createElement('style');
    st.id = 'hr-repeat-style';
    st.textContent = `
      .hr-repeat-add{display:inline-flex;align-items:center;gap:6px;margin-top:10px;padding:9px 16px;
        background:#edf7e8;color:#3d7828;border:1.5px dashed #b3dea8;border-radius:8px;
        font-size:12.5px;font-weight:700;cursor:pointer;font-family:'Segoe UI',Arial,sans-serif}
      .hr-repeat-add:hover{background:#e0f2d6}
      [data-hr-group]{position:relative}
      .hr-repeat-rm{display:none;position:absolute;top:4px;right:4px;width:22px;height:22px;
        border-radius:50%;background:#a4262c;color:#fff;border:none;font-size:13px;line-height:1;
        cursor:pointer;z-index:5}
      [data-hr-group]:hover .hr-repeat-rm{display:block}`;
    document.head.appendChild(st);

    groups.forEach((g, id) => {
      g.container.querySelectorAll(':scope > [data-hr-group]').forEach(addRemoveButton);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'hr-repeat-add';
      btn.textContent = '+ Add item';
      btn.addEventListener('click', () => {
        const el = createBlankItem(id);
        if (!el) return;
        addRemoveButton(el);
        g.container.insertBefore(el, btn);
        window.__hrOnRepeaterAdd && window.__hrOnRepeaterAdd(el);
      });
      g.container.appendChild(btn);
    });
  }

  function addRemoveButton(itemEl) {
    if (itemEl.querySelector(':scope > .hr-repeat-rm')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hr-repeat-rm';
    btn.title = 'Remove this item';
    btn.textContent = '✕';
    btn.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (itemEl.dataset.hrAdded === 'true') itemEl.remove();
      else itemEl.style.display = 'none';
      window.__hrOnRepeaterRemove && window.__hrOnRepeaterRemove(itemEl);
    });
    itemEl.appendChild(btn);
  }

  window.__hrEnableRepeaterControls = enableRepeaterControls;

  // Split mixed-content containers into independently editable text runs FIRST,
  // then assign keys and detect repeat groups from the baked page, then apply
  // any saved overrides on top.
  wrapLooseText(root);
  tagEditable(root);
  detectRepeatGroups();
  window.__hrApplyOverrides = applyOverrides; // used by the editor for live preview
  fetch('/api/hr-content', { cache: 'no-store' })
    .then(r => r.json())
    .then(applyOverrides)
    .catch(() => {})
    .finally(() => { window.__hrReady = true; }); // editor waits for this
})();
