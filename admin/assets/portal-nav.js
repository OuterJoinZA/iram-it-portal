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
    super_admin:     ['manageUsers', 'editHR', 'editIT', 'manageTickets', 'viewTicketStats', 'requestAccounts'],
    admin:           ['editHR', 'editIT', 'manageTickets', 'viewTicketStats', 'requestAccounts'],
    hr_admin:        ['editHR', 'viewTicketStats', 'requestAccounts'],
    it:              ['manageTickets', 'viewTicketStats'],
    hr_manager:      ['editHR', 'viewTicketStats', 'requestAccounts'],
    hr:              ['editHR', 'viewTicketStats', 'requestAccounts'],
    assistant_hr:    ['editHR', 'viewTicketStats', 'requestAccounts'],
    field_goosehelp: [],
    staff:           []
  };

  // Order = order in the top bar. `perm` null → everyone signed in.
  const PAGES = [
    { key: 'dashboard',   href: '/admin/index.html',             label: '🎫 IT Dashboard',      perm: 'manageTickets' },
    { key: 'newstarters', href: '/admin/new-starters.html',      label: '🧑‍💻 New Starter Queue', perm: 'manageTickets' },
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
    if (can(role, 'viewTicketStats')) return '/admin/hr-dashboard.html';
    if (can(role, 'editHR')) return '/admin/site-edit.html';
    return null;
  }

  /** Visible pages for a role (the summary page is hidden from IT, who have the full dashboard). */
  function pagesFor(role) {
    return PAGES.filter(p => (!p.perm || can(role, p.perm)) && !(p.hideIf && can(role, p.hideIf)));
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
    const needs = Array.isArray(needPerm) ? needPerm : (needPerm ? [needPerm] : []);
    if (needs.length && !needs.some(p => can(me.role, p))) {
      location.replace(landingPage(me.role) || '/login.html');
      return new Promise(() => {});
    }
    return me;
  }

  // Shared styling for the links, injected once so each page just needs a container.
  const css = `.pn-links{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.pn-link{font:700 12.5px 'Segoe UI',Arial,sans-serif;text-decoration:none;border:none;cursor:pointer;padding:8px 12px;border-radius:8px;background:#4a4a4a;color:#fff;margin:0;white-space:nowrap}
.pn-link:hover{background:#5a5a5a}.pn-link.pn-active{background:#4e9938}.pn-logout{background:#6b2a2a}.pn-logout:hover{background:#7d3232}`;
  if (typeof document !== 'undefined') {
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  }

  window.IRAM_NAV = { ROLE_PERMS, perms, can, landingPage, pagesFor, renderLinks, requireSession, logout };
})();
