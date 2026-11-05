// ──────────────────────────────────────────────────────────────────────────────
// Shared by every signed-in page: the role → permission map (mirrors
// lib/roles.js — static site, no build step) and the top-bar page links, so
// each role sees exactly the pages it can use.
//
// This is UI only. Every /api/admin/* call checks the session cookie and the
// permission server-side, so editing this file in a browser grants nothing.
// ──────────────────────────────────────────────────────────────────────────────
(function () {
  const ROLE_PERMS = {
    developer:       ['manageUsers', 'editHR', 'editIT', 'manageTickets', 'viewTicketStats', 'requestAccounts', 'previewUsers'],
    super_admin:     ['manageUsers', 'editHR', 'editIT', 'manageTickets', 'viewTicketStats', 'requestAccounts', 'previewUsers'],
    admin:           ['editHR', 'editIT', 'manageTickets', 'viewTicketStats', 'requestAccounts'],
    hr_admin:        ['editHR', 'viewTicketStats', 'requestAccounts'],
    it:              ['manageTickets', 'viewTicketStats'],
    hr_manager:      ['editHR', 'viewTicketStats', 'requestAccounts'],
    hr:              ['editHR', 'viewTicketStats', 'requestAccounts'],
    assistant_hr:    ['editHR', 'viewTicketStats', 'requestAccounts'],
    perigee_admin:   ['updateAccounts'],
    field_goosehelp: [],
    staff:           []
  };

  // Order = order in the top bar. `perm` null → everyone signed in.
  const PAGES = [
    { key: 'dashboard',   href: '/admin/index.html',             label: '🎫 IT Dashboard',      perm: 'manageTickets' },
    { key: 'newstarters', href: '/admin/new-starters.html',      label: '🧑‍💻 New Starter Queue', perm: ['manageTickets', 'updateAccounts'] },
    { key: 'summary',     href: '/admin/hr-dashboard.html',      label: '📊 Ticket Summary',    perm: 'viewTicketStats', hideIf: 'manageTickets' },
    { key: 'request',     href: '/admin/account-request.html',   label: '👤 Request Accounts',  perm: 'requestAccounts' },
    { key: 'hredit',      href: '/admin/site-edit.html',         label: '✏️ Edit HR Page',      perm: 'editHR' },
    { key: 'users',       href: '/admin/users.html',             label: '👥 Users',             perm: 'manageUsers' },
    { key: 'account',     href: '/admin/account.html',           label: '🔑 My Account',        perm: null }
  ];

  function perms(role) { return ROLE_PERMS[role] || []; }
  function can(role, perm) { return perms(role).includes(perm); }

  /** Where a role lands after login. */
  function landingPage(role) {
    if (can(role, 'manageTickets') || can(role, 'editIT')) return '/admin/index.html';
    if (can(role, 'requestAccounts')) return '/admin/account-request.html';
    if (can(role, 'updateAccounts')) return '/admin/new-starters.html';
    if (can(role, 'viewTicketStats')) return '/admin/hr-dashboard.html';
    if (can(role, 'editHR')) return '/admin/site-edit.html';
    return null;
  }

  /** Visible pages for a role (the summary page is hidden from IT, who have the full dashboard). */
  function pagesFor(role) {
    const ok = perm => !perm || (Array.isArray(perm) ? perm.some(x => can(role, x)) : can(role, perm));
    return PAGES.filter(p => ok(p.perm) && !(p.hideIf && can(role, p.hideIf)));
  }

  /** Renders links into `el` (an element or id), marking `currentKey` active,
   *  plus a Log out button. */
  function renderLinks(el, role, currentKey) {
    const host = typeof el === 'string' ? document.getElementById(el) : el;
    if (!host) return;
    host.innerHTML = pagesFor(role).map(p =>
      `<a href="${p.href}" class="pn-link${p.key === currentKey ? ' pn-active' : ''}">${p.label}</a>`
    ).join('') + '<button type="button" class="pn-link pn-logout">Log out</button>';
    host.querySelector('.pn-logout').addEventListener('click', logout);
  }

  async function logout() {
    try { await fetch('/api/admin/logout', { method: 'POST' }); } catch (_) {}
    sessionStorage.clear();
    location.replace('/login.html');
  }

  /** Confirms the session cookie, caches role for the old sessionStorage-based
   *  guards, and returns /api/admin/me — or redirects to login. If `needPerm`
   *  is given and missing, redirects to the role's own landing page. */
  async function requireSession(needPerm) {
    let me;
    try {
      const r = await fetch('/api/admin/me', { cache: 'no-store' });
      if (!r.ok) throw new Error();
      me = await r.json();
    } catch (_) {
      sessionStorage.clear();
      location.replace('/login.html');
      return new Promise(() => {}); // never resolves — page is navigating away
    }
    sessionStorage.setItem('iram_it_auth', 'true');
    sessionStorage.setItem('iram_username', me.username);
    sessionStorage.setItem('iram_role', me.role);
    if (me.preview) showPreviewBanner(me);
    const needs = Array.isArray(needPerm) ? needPerm : (needPerm ? [needPerm] : []);
    if (needs.length && !needs.some(p => can(me.role, p))) {
      location.replace(landingPage(me.role) || '/login.html');
      return new Promise(() => {});
    }
    return me;
  }

  // ── Super Admin "preview as" ───────────────────────────────────────────────
  // A sticky banner on every page while previewing, plus a fetch guard so a
  // click on Save/Submit explains itself instead of failing oddly. The real
  // enforcement is server-side (lib/require-role.js refuses writes).
  let previewShown = false;
  function showPreviewBanner(me) {
    if (previewShown || !me || !me.preview) return;
    previewShown = true;
    const label = me.role.replace(/_/g, ' ');
    const bar = document.createElement('div');
    bar.id = 'pn-preview';
    bar.innerHTML = `<span>🧪 <b>Test mode</b> — previewing as <b></b> (${label}). Account requests you submit go to IT marked <b>TEST</b> and are auto-completed (no booking; HR's copy comes only to you). Other changes are blocked. Signed in as <b></b>.</span>
      <button type="button">Exit preview</button>`;
    const bs = bar.querySelectorAll('b');
    bs[1].textContent = me.username;
    bs[3].textContent = me.preview.actor;
    bar.querySelector('button').addEventListener('click', exitPreview);
    document.body.prepend(bar);

    const realFetch = window.fetch.bind(window);
    window.fetch = (url, opts = {}) => {
      const method = String((opts && opts.method) || 'GET').toUpperCase();
      const u = String(url && url.url ? url.url : url);
      // account-request is the one feature that runs for real in test mode.
      if (method !== 'GET' && /\/api\/admin\//.test(u) && !/\/api\/admin\/(preview|logout|account-request)\b/.test(u)) {
        toast("Not available in test mode — only account requests can be tested.");
        const text = "That change isn't available in preview test mode — only new-starter account requests can be tested. Exit preview to make real changes.";
        const msg = { error: text, message: text };
        return Promise.resolve(new Response(JSON.stringify(msg), { status: 403, headers: { 'Content-Type': 'application/json' } }));
      }
      return realFetch(url, opts);
    };
  }

  async function exitPreview() {
    try {
      const r = await fetch('/api/admin/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exit: true }) });
      const d = await r.json();
      sessionStorage.setItem('iram_username', d.username);
      sessionStorage.setItem('iram_role', d.role);
      location.href = '/admin/users.html';
    } catch (_) { location.replace('/login.html'); }
  }

  function toast(text) {
    let t = document.getElementById('pn-toast');
    if (!t) { t = document.createElement('div'); t.id = 'pn-toast'; document.body.appendChild(t); }
    t.textContent = text; t.style.display = 'block';
    clearTimeout(t._h); t._h = setTimeout(() => { t.style.display = 'none'; }, 3500);
  }

  // Shared styling for the links, injected once so each page just needs a container.
  const css = `.pn-links{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.pn-link{font:700 12.5px 'Segoe UI',Arial,sans-serif;text-decoration:none;border:none;cursor:pointer;padding:8px 12px;border-radius:8px;background:#4a4a4a;color:#fff;margin:0;white-space:nowrap}
.pn-link:hover{background:#5a5a5a}.pn-link.pn-active{background:#4e9938}.pn-logout{background:#6b2a2a}.pn-logout:hover{background:#7d3232}
#pn-preview{position:sticky;top:0;z-index:1000;display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#fff4d6;color:#6b4a00;border-bottom:2px solid #e0a030;padding:8px 20px;font:13px 'Segoe UI',Arial,sans-serif}
#pn-preview span{margin-right:auto}#pn-preview button{border:none;background:#8a5a00;color:#fff;font:700 12.5px 'Segoe UI',Arial,sans-serif;padding:7px 12px;border-radius:7px;cursor:pointer}
#pn-toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#8a5a00;color:#fff;padding:10px 18px;border-radius:8px;font:600 13px 'Segoe UI',Arial,sans-serif;display:none;z-index:1001}`;
  if (typeof document !== 'undefined') {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }

  window.IRAM_NAV = { ROLE_PERMS, perms, can, landingPage, pagesFor, renderLinks, requireSession, logout, showPreviewBanner, exitPreview };
})();
