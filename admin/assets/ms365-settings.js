// ──────────────────────────────────────────────────────────────────────────────
// Portal Settings → 🔗 Microsoft 365 tab (IT dashboard, admin/index.html).
//
// Adds itself to the existing settings modal (its own tab button + panel), so
// it doesn't need changes in admin.js. A Super Admin pastes the Azure app's
// tenant ID / client ID / secret here (api/admin/directory.js ?action=config —
// the secret is stored encrypted and never sent back), with a step-by-step
// guide. Everyone else on the dashboard sees the connection status only.
// Open it directly with /admin/index.html#ms365.
// ──────────────────────────────────────────────────────────────────────────────
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = d => { try { return new Date(d).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };
  const ago = iso => { const h = (Date.now() - new Date(iso)) / 3600000; return h < 1 ? 'under an hour ago' : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`; };

  function init() {
    const lastTab = document.querySelector('.s-stab[data-stab="broadcast"]');
    const lastPanel = $('s-spanel-broadcast');
    if (!lastTab || !lastPanel || $('s-spanel-ms365')) return;

    const tab = document.createElement('button');
    tab.className = 's-stab'; tab.dataset.stab = 'ms365'; tab.textContent = '🔗 Microsoft 365';
    lastTab.after(tab);

    const panel = document.createElement('div');
    panel.className = 's-spanel'; panel.id = 's-spanel-ms365';
    panel.style.cssText = 'display:none;padding:28px;overflow-y:auto';
    panel.innerHTML = `
      <style>
        #s-spanel-ms365 .ms-in { width:100%; padding:10px 12px; border:1.5px solid #dde; border-radius:7px; font:13px 'Segoe UI',Arial,sans-serif; background:#fafbfc; }
        #s-spanel-ms365 .ms-in:disabled { color:#999; }
        #s-spanel-ms365 .ms-lbl { display:block; font-size:11px; font-weight:700; color:#555; text-transform:uppercase; letter-spacing:.5px; margin:14px 0 6px; }
        #s-spanel-ms365 .ms-grid { display:grid; grid-template-columns:1fr 1fr; gap:0 16px; }
        #s-spanel-ms365 .ms-btn { padding:10px 18px; border:none; border-radius:8px; font:700 13px 'Segoe UI',Arial,sans-serif; cursor:pointer; }
        #s-spanel-ms365 .ms-green { background:#6BBF4E; color:#fff; } #s-spanel-ms365 .ms-grey { background:#eef0f2; color:#333; } #s-spanel-ms365 .ms-red { background:#fdf0f0; color:#a4262c; }
        #s-spanel-ms365 .ms-status { border-radius:8px; padding:12px 16px; font-size:13px; line-height:1.7; margin-bottom:18px; }
        #s-spanel-ms365 .ok { background:#edf7e8; border:1.5px solid #b3dea8; color:#2f6b1a; }
        #s-spanel-ms365 .bad { background:#fdf0f0; border:1.5px solid #e7a3a3; color:#a4262c; }
        #s-spanel-ms365 .off { background:#f4f6f8; border:1.5px dashed #cfd3d7; color:#555; }
        #s-spanel-ms365 .warn { background:#fff4e5; border:1.5px solid #f0c48a; color:#7a4800; }
        #s-spanel-ms365 details { background:#f8f9fb; border:1px solid #e8eaee; border-radius:8px; padding:10px 16px; margin-bottom:6px; font-size:13px; line-height:1.7; color:#444; }
        #s-spanel-ms365 summary { cursor:pointer; font-weight:800; color:#2D2D2D; }
        #s-spanel-ms365 ol { margin:8px 0 4px 20px; } #s-spanel-ms365 li { margin-bottom:6px; }
        #s-spanel-ms365 code { background:#e8eaee; border-radius:3px; padding:1px 5px; font-size:12px; }
        @media (max-width:700px) { #s-spanel-ms365 .ms-grid { grid-template-columns:1fr; } }
      </style>
      <div class="modal-section-label" style="margin-bottom:6px">🔗 Microsoft 365 user list</div>
      <p style="font-size:13px;color:#666;margin:0 0 16px;line-height:1.6">Lets the portal read the list of iRam Microsoft 365 users (names and emails only — read-only, it can't change anything). New starters are checked for emails that are already taken, existing accounts and duplicate requests, and leavers are matched to their account. It re-syncs every night at 03:00.</p>
      <div id="ms-status" class="ms-status off">Checking…</div>
      <details id="ms-guide">
        <summary>📋 How to set it up in Azure (about 10 minutes, once)</summary>
        <ol>
          <li>Open <a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener">Microsoft Entra → App registrations</a> (sign in as a Global Admin) → <b>+ New registration</b>. Name: <code>iRam IT Portal – user list</code>, account type: <b>this organisational directory only</b>, no redirect URI → <b>Register</b>.</li>
          <li>On the app's <b>Overview</b> page, copy the <b>Application (client) ID</b> and the <b>Directory (tenant) ID</b> into the boxes below.</li>
          <li><b>API permissions</b> → <b>+ Add a permission</b> → <b>Microsoft Graph</b> → <b>Application permissions</b> → tick <code>User.Read.All</code> → <b>Add permissions</b>. Then click <b>✔ Grant admin consent for iRam</b> → Yes. The status must turn green.</li>
          <li><b>Certificates &amp; secrets</b> → <b>+ New client secret</b> → description <code>IT portal</code>, expires <b>24 months</b> → <b>Add</b>. Copy the <b>Value</b> straight away. It's only shown once, and it's <i>not</i> the "Secret ID". Note the <b>Expires</b> date too.</li>
          <li>Paste the Value below, set the expiry date, then click <b>Save &amp; test</b>. You'll see the number of users found within a few seconds.</li>
        </ol>
        <p style="margin:6px 0 0;color:#7a4800">⏰ You don't need to remember the expiry: 30 days before it, the Starter / Leaver Queue shows a red banner and every daily reminder email says so. To renew, repeat step 4 and paste the new Value here.</p>
      </details>
      <div class="ms-grid">
        <div><label class="ms-lbl">Directory (tenant) ID</label><input class="ms-in" id="ms-tenant" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autocomplete="off" spellcheck="false"></div>
        <div><label class="ms-lbl">Application (client) ID</label><input class="ms-in" id="ms-client" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autocomplete="off" spellcheck="false"></div>
        <div><label class="ms-lbl">Client secret — Value</label><input class="ms-in" id="ms-secret" type="password" autocomplete="new-password" spellcheck="false"></div>
        <div><label class="ms-lbl">Secret expires on</label><input class="ms-in" id="ms-expires" type="date"></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:18px">
        <button class="ms-btn ms-green" id="ms-save">💾 Save &amp; test</button>
        <button class="ms-btn ms-grey" id="ms-sync">🔄 Sync now</button>
        <button class="ms-btn ms-red" id="ms-clear">Disconnect</button>
        <span id="ms-note" style="font-size:12px;color:#888"></span>
      </div>
      <div id="ms-msg" style="display:none;border-radius:6px;padding:10px 14px;font-size:13px;margin-top:14px"></div>`;
    lastPanel.after(panel);

    tab.addEventListener('click', () => {
      document.querySelectorAll('.s-stab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.s-spanel').forEach(p => p.style.display = 'none');
      tab.classList.add('active');
      panel.style.display = 'block';
      load();
    });
    $('ms-save').addEventListener('click', save);
    $('ms-sync').addEventListener('click', sync);
    $('ms-clear').addEventListener('click', clearCreds);

    if (location.hash === '#ms365') {
      const open = () => { const b = $('settings-btn'); if (b) { b.click(); setTimeout(() => tab.click(), 150); } };
      setTimeout(open, 600);
    }
  }

  function msg(text, ok) {
    const el = $('ms-msg');
    el.style.display = text ? 'block' : 'none';
    el.style.background = ok ? '#edf7e8' : '#fdf0f0'; el.style.color = ok ? '#2f6b1a' : '#a4262c';
    el.textContent = text || '';
  }

  let info = null;
  async function load() {
    msg('');
    try {
      const r = await fetch('/api/admin/directory?config=1', { cache: 'no-store' });
      if (!r.ok) { $('ms-status').textContent = r.status === 403 ? 'Only IT and Super Admins can see this.' : 'Could not load the connection.'; return; }
      info = await r.json();
      render();
    } catch (e) { $('ms-status').textContent = e.message; }
  }

  function render() {
    const st = info.status || {}, edit = info.canEdit && info.source !== 'env';
    const box = $('ms-status');
    if (!st.configured) {
      box.className = 'ms-status off';
      box.innerHTML = '🔌 <b>Not connected yet.</b> Follow the steps below. They need a Microsoft Global Admin.';
      $('ms-guide').open = true;
    } else if (st.stale) {
      box.className = 'ms-status bad';
      box.innerHTML = `⚠️ <b>Connected, but the sync is failing</b>${st.lastSuccess ? `. Last good sync ${esc(ago(st.lastSuccess))}` : ' and has never worked'}.${st.error ? `<br>Error: ${esc(st.error)}` : ''}<br><span style="font-size:12px">Common causes: admin consent not granted (step 3), the secret's <i>ID</i> pasted instead of its <i>Value</i>, or the secret expired.</span>`;
    } else {
      box.className = 'ms-status ' + (st.expiring ? 'warn' : 'ok');
      box.innerHTML = `✔ <b>Connected</b> — ${st.count} users · last synced ${esc(ago(st.lastSuccess))}` +
        (st.secretExpires ? `<br>${st.expiring ? '⚠️ ' : ''}Secret expires <b>${esc(st.secretExpires)}</b>${st.secretDaysLeft !== null ? ` (${st.secretDaysLeft <= 0 ? 'EXPIRED' : st.secretDaysLeft + ' days'})` : ''}${st.expiring ? ' — create a new one (step 4) and paste it below.' : ''}` : '<br>⚠️ Add the secret\'s expiry date so you get warned before it runs out.');
    }
    $('ms-tenant').value = info.tenantId || '';
    $('ms-client').value = info.clientId || '';
    $('ms-secret').value = '';
    $('ms-secret').placeholder = info.secretHint ? `Saved (${info.secretHint}) — leave blank to keep` : 'Paste the secret Value';
    $('ms-expires').value = info.secretExpires || '';
    ['ms-tenant', 'ms-client', 'ms-secret', 'ms-expires', 'ms-save', 'ms-clear'].forEach(id => $(id).disabled = !edit);
    $('ms-clear').style.display = edit && info.source === 'saved' ? '' : 'none';
    $('ms-sync').style.display = st.configured ? '' : 'none';
    $('ms-note').textContent = info.source === 'env'
      ? 'Using the MS_ environment variables in Vercel (they take priority). Remove them there to manage the connection here.'
      : !info.canEdit ? 'Only a Super Admin can change the connection.'
      : info.savedBy ? `Saved by ${info.savedBy}, ${fmt(info.savedAt)}` : '';
  }

  async function post(action, body) {
    const r = await fetch('/api/admin/directory?action=' + action, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok && !d.status) throw new Error(d.error || d.message || 'Failed');
    return d;
  }

  async function save() {
    const btn = $('ms-save');
    btn.disabled = true; btn.textContent = 'Saving & testing…'; msg('');
    try {
      const d = await post('config', { tenantId: $('ms-tenant').value, clientId: $('ms-client').value, clientSecret: $('ms-secret').value, secretExpires: $('ms-expires').value });
      info = { ...info, ...d, status: d.status };
      render();
      const res = d.result || {};
      if (res.ok) msg(`✔ Connected — found ${res.count} Microsoft 365 users. The nightly sync is now on.`, true);
      else msg(`Saved, but the test sync failed: ${res.error || 'unknown error'}`);
    } catch (e) { msg(e.message); }
    finally { btn.disabled = false; btn.textContent = '💾 Save & test'; }
  }

  async function sync() {
    $('ms-sync').disabled = true; msg('');
    try {
      const d = await post('sync');
      info.status = d; render();
      msg(d.result && d.result.ok ? `✔ Synced ${d.result.count} users.` : `Sync failed: ${(d.result && d.result.error) || d.error || 'unknown error'}`, d.result && d.result.ok);
    } catch (e) { msg(e.message); }
    finally { $('ms-sync').disabled = false; }
  }

  async function clearCreds() {
    if (!confirm('Disconnect Microsoft 365? The cross-checks stop until it is connected again.')) return;
    try { const d = await post('config', { clear: true }); info = { ...info, ...d }; render(); msg('Disconnected.', true); } catch (e) { msg(e.message); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
