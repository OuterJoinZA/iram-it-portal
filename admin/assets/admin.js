// ──────────────────────────────────────────────────────────────────────────────
// iRam IT Admin Panel — Dashboard Logic
// ──────────────────────────────────────────────────────────────────────────────

// ── Auth guard ────────────────────────────────────────────────────────────────
if (sessionStorage.getItem('iram_it_auth') !== 'true') {
  window.location.href = '../login.html';
}

const CFG = (typeof IRAM_CONFIG !== 'undefined') ? IRAM_CONFIG : {};

// All admin API calls go through our own Vercel routes (flow URLs stay server-side).
// The admin key (entered at login) is sent as a header to authorize the request.
function adminFetch(url, opts = {}) {
  const headers = Object.assign({}, opts.headers, {
    'x-admin-key': sessionStorage.getItem('iram_it_key') || ''
  });
  return fetch(url, Object.assign({ cache: 'no-store' }, opts, { headers }));
}

// ── "Assigned To" options from config (Name · Role) ───────────────────────────
// Supports both the new object form ({name, role}) and plain-string legacy entries.
function staffLabel(s) {
  if (typeof s === 'string') return s;
  return s.role ? `${s.name} · ${s.role}` : s.name;
}
// Admin-edited staff (from /api/config). Falls back to the hard-coded config.js
// list until the editable config has loaded, so the dropdown is never empty.
let staffOverride = null;

function populateAssignDropdown() {
  const sel = document.getElementById('m-assigned');
  if (!sel) return;
  const staff = staffOverride || (Array.isArray(CFG.itStaff) ? CFG.itStaff : []);
  sel.innerHTML = '<option value="">Unassigned</option>' +
    staff.map(s => { const l = staffLabel(s); return `<option value="${esc(l)}">${esc(l)}</option>`; }).join('');
}

// ── State ─────────────────────────────────────────────────────────────────────
let allTickets      = [];
let activeTab       = 'All';
let searchQuery     = '';
let filterPrio      = 'all';
let filterAssigned  = 'all';
let filterCategory  = 'all';
// Multi-column sort: ordered list of {field, dir}. The first entry is primary;
// ties fall through to the next. A plain header click replaces this with a
// single key (toggling direction on repeat clicks of the same field);
// shift-click appends/toggles an additional key without disturbing the rest.
let sortKeys = [{ field: 'Priority', dir: 'asc' }];
let openTicket   = null;

// ── Sample / demo tickets (replaced by real data once Power Automate is set up) ──
const DEMO_TICKETS = [
  {
    id: 1, TicketID: 'IT-2024-00001', SubmitterName: 'Jane Smith',
    SubmitterEmail: 'jane@iram.co.za', SubmitterPhone: '+27 82 111 1111',
    Department: 'Operations', Location: 'Head Office',
    ManagerName: 'Derek Joubert', ManagerEmail: 'derek@iram.co.za',
    Category: 'Hardware - PC / Laptop / Desktop', SuggestedPriority: 'High',
    Priority: 'High', Status: 'Open', AssignedTo: 'IT Support',
    Description: 'My laptop has smoke coming from the battery area. Cannot use it at all.',
    Notes: '', Created: '2024-06-19T08:30:00Z', Channel: 'Web Portal'
  },
  {
    id: 2, TicketID: 'IT-2024-00002', SubmitterName: 'Tom Nkosi',
    SubmitterEmail: 'tom@iram.co.za', SubmitterPhone: '+27 72 222 2222',
    Department: 'Sales', Location: 'Office',
    ManagerName: '', ManagerEmail: '',
    Category: 'Email / Outlook / Teams', SuggestedPriority: 'Low',
    Priority: 'Low', Status: 'Open', AssignedTo: 'IT Support',
    Description: 'I would like to update my email signature to include my new title.',
    Notes: '', Created: '2024-06-19T09:15:00Z', Channel: 'Web Portal'
  },
  {
    id: 3, TicketID: 'IT-2024-00003', SubmitterName: 'Priya Pillay',
    SubmitterEmail: 'priya@iram.co.za', SubmitterPhone: '+27 83 333 3333',
    Department: 'Finance', Location: 'Remote',
    ManagerName: 'Sarah Lee', ManagerEmail: 'sarah@iram.co.za',
    Category: 'Network / Internet / VPN', SuggestedPriority: 'High',
    Priority: 'High', Status: 'In Progress', AssignedTo: 'IT Support',
    Description: 'VPN keeps disconnecting every 10 minutes. Cannot access company systems.',
    Notes: 'Checked router settings. Escalating to network team.',
    Created: '2024-06-18T14:00:00Z', Channel: 'WhatsApp'
  },
  {
    id: 4, TicketID: 'IT-2024-00004', SubmitterName: 'CEO Account',
    SubmitterEmail: 'ceo@iram.co.za', SubmitterPhone: '+27 71 444 4444',
    Department: 'Executive', Location: 'Head Office',
    ManagerName: '', ManagerEmail: '',
    Category: 'Access / Passwords / Permissions', SuggestedPriority: 'Critical',
    Priority: 'Critical', Status: 'Open', AssignedTo: 'IT Support',
    Description: 'CEO email account is locked out. Cannot send or receive email. Has client meeting in 1 hour.',
    Notes: '', Created: '2024-06-19T07:45:00Z', Channel: 'Web Portal'
  },
  {
    id: 5, TicketID: 'IT-2024-00005', SubmitterName: 'Marcus Du Plessis',
    SubmitterEmail: 'marcus@iram.co.za', SubmitterPhone: '+27 84 555 5555',
    Department: 'CAM', Location: 'Office',
    ManagerName: 'Sato Gilles', ManagerEmail: 'sato@iram.co.za',
    Category: 'Hardware - Printer / Scanner', SuggestedPriority: 'Medium',
    Priority: 'Medium', Status: 'Resolved', AssignedTo: 'IT Support',
    Description: 'The printer on Floor 2 keeps jamming and shows error E05.',
    Notes: 'Cleared paper jam, replaced drum unit. Resolved.',
    Created: '2024-06-17T11:00:00Z', Channel: 'Email'
  }
];

// ── Ticket cache (sessionStorage, 2-min TTL) ──────────────────────────────────
const CACHE_KEY = 'iram_tickets_v1';
const CACHE_TTL = 2 * 60 * 1000;

function cacheLoad() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { sessionStorage.removeItem(CACHE_KEY); return null; }
    return data;
  } catch(_) { return null; }
}
function cacheSave(data) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch(_) {}
}

function setTableLoading(on) {
  const tbody = document.getElementById('ticket-tbody');
  if (on) {
    tbody.innerHTML = `<tr><td colspan="7">
      <div class="empty-state"><div class="e-icon">⏳</div><p>Loading tickets from SharePoint…</p></div>
    </td></tr>`;
  }
}

// ── Fetch tickets (real or demo) ──────────────────────────────────────────────
async function fetchTickets(background = false) {
  // Show cached data immediately so the panel is usable right away
  if (!background) {
    const cached = cacheLoad();
    if (cached) {
      allTickets = cached;
      renderAll();
      showToast('Loaded from cache — refreshing in background…', 'success');
      fetchTickets(true); // silent background refresh
      return;
    }
    setTableLoading(true);
  }

  try {
    const res = await adminFetch('/api/admin/tickets');

    if (res.status === 503) {
      if (!background) { allTickets = DEMO_TICKETS; renderAll(); showToast('Showing demo tickets — PA_GET_TICKETS_URL not set.', 'error'); }
      return;
    }
    if (res.status === 401) {
      showToast('Session expired — please log in again.', 'error');
      setTimeout(() => { sessionStorage.clear(); window.location.href = '../login.html'; }, 1500);
      return;
    }
    if (res.status === 504) {
      if (!background) { allTickets = DEMO_TICKETS; renderAll(); showToast('SharePoint took too long to respond — showing demo data. Try refreshing.', 'error'); }
      else showToast('Background refresh timed out — data may be stale.', 'error');
      return;
    }
    if (!res.ok) {
      // Reached the API but the Power Automate flow errored. Show the flow's
      // status so the cause is obvious (401/403 = expired flow URL, 404 = flow
      // off/deleted, 5xx = a step inside the flow failed).
      let detail = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j && j.flowStatus) detail = `flow returned ${j.flowStatus}`;
        else if (j && j.detail) detail = j.detail;
      } catch (_) {}
      if (!background) {
        allTickets = DEMO_TICKETS; renderAll();
        showToast(`Live tickets failed (${detail}) — showing demo data.`, 'error');
      }
      return;
    }

    const data = await res.json();
    allTickets = Array.isArray(data) ? data : (data.value || []);
    cacheSave(allTickets);
    renderAll();
    if (background) showToast('Tickets refreshed ✓', 'success');

  } catch(err) {
    // Never even reached the API (network/connection failure).
    if (!background) { allTickets = DEMO_TICKETS; renderAll(); showToast('Could not reach the server — showing demo data. Check your connection.', 'error'); }
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
// SharePoint returns Choice/Lookup/Person columns as objects ({Value}/{DisplayName}),
// stores the ticket number in "Title", and the row id in "ID". The UI (and the demo
// data) expect plain strings and the field names below, so normalise every ticket
// before rendering. Idempotent — already-clean rows (e.g. demo data) pass through.
function spVal(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v.Value ?? v.DisplayName ?? v.displayName ?? '';
  }
  return v ?? '';
}
function normalizeTicket(t) {
  if (!t || typeof t !== 'object') return t;
  return {
    ...t,
    id:                t.id ?? t.ID ?? t.ItemInternalId,
    TicketID:          t.TicketID ?? t.Title ?? t.ticketID ?? '',
    SubmitterName:     spVal(t.SubmitterName),
    Department:        spVal(t.Department),
    Location:          spVal(t.Location),
    Category:          spVal(t.Category),
    Priority:          spVal(t.Priority),
    SuggestedPriority: spVal(t.SuggestedPriority),
    Status:            spVal(t.Status) || 'Open',
    AssignedTo:        spVal(t.AssignedTo),
    Channel:           spVal(t.Channel)
  };
}

function renderAll() {
  allTickets = (Array.isArray(allTickets) ? allTickets : []).map(normalizeTicket);
  populateFilterOptions();
  renderStats();
  renderTable();
}

function renderStats() {
  const open     = allTickets.filter(t => t.Status === 'Open').length;
  const inprog   = allTickets.filter(t => t.Status === 'In Progress').length;
  const critical = allTickets.filter(t => t.Priority === 'Critical' && t.Status !== 'Closed' && t.Status !== 'Resolved').length;
  const high     = allTickets.filter(t => t.Priority === 'High'     && t.Status !== 'Closed' && t.Status !== 'Resolved').length;

  document.getElementById('stat-open').textContent     = open;
  document.getElementById('stat-inprog').textContent   = inprog;
  document.getElementById('stat-critical').textContent = critical;
  document.getElementById('stat-high').textContent     = high;
}

function filteredTickets() {
  return allTickets.filter(t => {
    const matchTab  = activeTab === 'All' || t.Status === activeTab ||
                      (activeTab === 'Open' && t.Status === 'Open') ||
                      (activeTab === 'In Progress' && t.Status === 'In Progress') ||
                      (activeTab === 'Resolved' && (t.Status === 'Resolved' || t.Status === 'Closed'));
    const matchPrio = filterPrio === 'all' || t.Priority === filterPrio;
    const matchAssigned = filterAssigned === 'all' ||
      (filterAssigned === '__unassigned__' ? !t.AssignedTo : t.AssignedTo === filterAssigned);
    const matchCategory = filterCategory === 'all' || t.Category === filterCategory;
    const q         = searchQuery.toLowerCase();
    const matchQ    = !q ||
      (t.TicketID||'').toLowerCase().includes(q) ||
      (t.SubmitterName||'').toLowerCase().includes(q) ||
      (t.Department||'').toLowerCase().includes(q) ||
      (t.Category||'').toLowerCase().includes(q) ||
      (t.Description||'').toLowerCase().includes(q);
    return matchTab && matchPrio && matchAssigned && matchCategory && matchQ;
  });
}

const PRIO_ORDER   = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const STATUS_ORDER = { Open: 0, 'In Progress': 1, Resolved: 2, Closed: 3 };

// Per-field comparators — priority/status use a logical order (not alphabetical),
// dates compare as timestamps, everything else falls back to string comparison.
function compareField(a, b, field) {
  if (field === 'Priority') return (PRIO_ORDER[a.Priority] ?? 9) - (PRIO_ORDER[b.Priority] ?? 9);
  if (field === 'Status')   return (STATUS_ORDER[a.Status]  ?? 9) - (STATUS_ORDER[b.Status]  ?? 9);
  if (field === 'Created')  return new Date(a.Created || 0) - new Date(b.Created || 0);
  return String(a[field] || '').localeCompare(String(b[field] || ''), undefined, { sensitivity: 'base' });
}

function sortTickets(tickets) {
  return [...tickets].sort((a, b) => {
    for (const { field, dir } of sortKeys) {
      const c = compareField(a, b, field);
      if (c !== 0) return dir === 'desc' ? -c : c;
    }
    return 0;
  });
}

function renderTable() {
  const tickets = sortTickets(filteredTickets());
  const tbody = document.getElementById('ticket-tbody');
  if (!tickets.length) {
    tbody.innerHTML = `<tr><td colspan="7">
      <div class="empty-state"><div class="e-icon">📭</div><p>No tickets match the current filters.</p></div>
    </td></tr>`;
    updateSortIndicators();
    return;
  }
  tbody.innerHTML = tickets.map(t => `
    <tr data-id="${t.id}" onclick="openTicketModal(${t.id})">
      <td><div class="ticket-id">${t.TicketID}</div></td>
      <td>
        <div class="submitter-name">${esc(t.SubmitterName)}</div>
        <div class="submitter-dept">${esc(t.Department)} &middot; ${esc(t.Location||'')}</div>
      </td>
      <td><div class="ticket-desc">${esc(t.Description)}</div></td>
      <td>${badgePrio(t.Priority)}</td>
      <td>${badgeStatus(t.Status)}</td>
      <td>${esc(t.AssignedTo||'—')}</td>
      <td style="font-size:12px;color:#888;white-space:nowrap">${fmtDate(t.Created)}</td>
    </tr>
  `).join('');
  updateSortIndicators();
}

// ── Sortable headers (click = single sort, shift-click = add/toggle a
//    secondary key) ─────────────────────────────────────────────────────────
function updateSortIndicators() {
  document.querySelectorAll('th.sortable').forEach(th => {
    const field = th.dataset.field;
    const idx   = sortKeys.findIndex(k => k.field === field);
    const ind   = th.querySelector('.sort-ind');
    th.classList.toggle('sorted', idx !== -1);
    if (idx === -1) { ind.textContent = ''; return; }
    const arrow = sortKeys[idx].dir === 'desc' ? '▼' : '▲';
    ind.innerHTML = arrow + (sortKeys.length > 1 ? `<span class="sort-n">${idx + 1}</span>` : '');
  });
  document.getElementById('sort-clear-btn').style.display = sortKeys.length > 1 ? 'inline-block' : 'none';
}

document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', e => {
    const field = th.dataset.field;
    if (e.shiftKey) {
      const idx = sortKeys.findIndex(k => k.field === field);
      if (idx === -1) sortKeys.push({ field, dir: 'asc' });
      else if (sortKeys[idx].dir === 'asc') sortKeys[idx].dir = 'desc';
      else sortKeys.splice(idx, 1); // third shift-click on the same key removes it
    } else if (sortKeys.length === 1 && sortKeys[0].field === field) {
      sortKeys[0].dir = sortKeys[0].dir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKeys = [{ field, dir: 'asc' }]; // plain click always collapses to a single key
    }
    renderTable();
  });
});

document.getElementById('sort-clear-btn').addEventListener('click', () => {
  sortKeys = [{ field: 'Priority', dir: 'asc' }];
  renderTable();
});

// ── Assigned To / Category filter options — rebuilt from whatever's actually
//    in the current ticket list, so they never drift from real data ──────────
function populateFilterOptions() {
  const assignedSel = document.getElementById('assigned-filter');
  const categorySel = document.getElementById('category-filter');
  const curAssigned = assignedSel.value, curCategory = categorySel.value;

  const assignees = [...new Set(allTickets.map(t => t.AssignedTo).filter(Boolean))].sort();
  assignedSel.innerHTML = '<option value="all">All Assignees</option>' +
    '<option value="__unassigned__">Unassigned</option>' +
    assignees.map(a => `<option value="${escAttrJs(a)}">${esc(a)}</option>`).join('');

  const categories = [...new Set(allTickets.map(t => t.Category).filter(Boolean))].sort();
  categorySel.innerHTML = '<option value="all">All Categories</option>' +
    categories.map(c => `<option value="${escAttrJs(c)}">${esc(c)}</option>`).join('');

  // Keep the current selection if it's still a valid option after the rebuild.
  if ([...assignedSel.options].some(o => o.value === curAssigned)) assignedSel.value = curAssigned;
  if ([...categorySel.options].some(o => o.value === curCategory)) categorySel.value = curCategory;
  filterAssigned = assignedSel.value;
  filterCategory = categorySel.value;
}
function escAttrJs(s) { return esc(s).replace(/"/g, '&quot;'); }

function badgePrio(p)   { return `<span class="badge badge-${p}">${p||'—'}</span>`; }
function badgeStatus(s) { return `<span class="badge badge-${(s||'').replace(' ','-')}">${s||'—'}</span>`; }
function esc(s)         { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtDate(d)     { try { return new Date(d).toLocaleString('en-ZA',{dateStyle:'short',timeStyle:'short'}); } catch(_){return d||'';} }

// ── Tab / filter listeners ────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeTab = btn.dataset.tab;
    renderTable();
  });
});

document.getElementById('search-input').addEventListener('input', e => {
  searchQuery = e.target.value;
  renderTable();
});

document.getElementById('prio-filter').addEventListener('change', e => {
  filterPrio = e.target.value;
  renderTable();
});

document.getElementById('assigned-filter').addEventListener('change', e => {
  filterAssigned = e.target.value;
  renderTable();
});

document.getElementById('category-filter').addEventListener('change', e => {
  filterCategory = e.target.value;
  renderTable();
});

document.getElementById('refresh-btn').addEventListener('click', fetchTickets);

// ── Modal ─────────────────────────────────────────────────────────────────────
function openTicketModal(id) {
  openTicket = allTickets.find(t => t.id === id);
  if (!openTicket) return;
  const t = openTicket;

  document.getElementById('m-ticket-id').textContent    = t.TicketID;
  document.getElementById('m-name').textContent         = t.SubmitterName;
  document.getElementById('m-email').textContent        = t.SubmitterEmail;
  document.getElementById('m-phone').textContent        = t.SubmitterPhone || '—';
  document.getElementById('m-dept').textContent         = t.Department;
  document.getElementById('m-location').textContent     = t.Location || '—';
  document.getElementById('m-manager').textContent      = t.ManagerName ? `${t.ManagerName} (${t.ManagerEmail})` : '—';
  document.getElementById('m-category').textContent     = t.Category;
  document.getElementById('m-channel').textContent      = t.Channel || '—';
  document.getElementById('m-submitted').textContent    = fmtDate(t.Created);
  document.getElementById('m-description').textContent  = t.Description;
  document.getElementById('m-suggested-prio').textContent = t.SuggestedPriority || t.Priority || '—';

  document.getElementById('m-status').value      = t.Status || 'Open';
  document.getElementById('m-priority').value    = t.Priority || 'Medium';

  // Assigned-to dropdown — make sure the ticket's current value is selectable
  const assignSel = document.getElementById('m-assigned');
  const current   = t.AssignedTo || '';
  if (current && ![...assignSel.options].some(o => o.value === current)) {
    assignSel.insertAdjacentHTML('beforeend', `<option value="${esc(current)}">${esc(current)}</option>`);
  }
  assignSel.value = current;

  document.getElementById('m-public-update').value = t.PublicUpdate || '';
  document.getElementById('m-notes').value         = t.Notes || '';
  document.getElementById('m-reply').value         = '';

  loadAttachment(t.AttachmentUrl);

  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

// The attachment proxy is admin-gated, so an <img src> can't send the key.
// Fetch it with the key and show it via an object URL instead.
let attachmentObjectUrl = null;
async function loadAttachment(url) {
  const field = document.getElementById('m-attachment-field');
  const imgEl = document.getElementById('m-attachment-img');
  const linkEl = document.getElementById('m-attachment-link');
  const msgEl = document.getElementById('m-attachment-msg');
  if (!field) return;

  if (attachmentObjectUrl) { URL.revokeObjectURL(attachmentObjectUrl); attachmentObjectUrl = null; }
  if (!url) { field.style.display = 'none'; return; }

  field.style.display = 'block';
  imgEl.style.display = 'none';
  msgEl.textContent = 'Loading image…';

  try {
    const res = await adminFetch(url);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const blob = await res.blob();
    attachmentObjectUrl = URL.createObjectURL(blob);
    imgEl.src = attachmentObjectUrl;
    linkEl.href = attachmentObjectUrl;
    imgEl.style.display = 'block';
    msgEl.textContent = '';
  } catch (_) {
    msgEl.textContent = 'Could not load the attached image.';
  }
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
  openTicket = null;
}

// ── Save ticket changes ───────────────────────────────────────────────────────
document.getElementById('btn-save').addEventListener('click', async () => {
  if (!openTicket) return;
  const updates = {
    id:           openTicket.id,
    Status:       document.getElementById('m-status').value,
    Priority:     document.getElementById('m-priority').value,
    AssignedTo:   document.getElementById('m-assigned').value,
    PublicUpdate: document.getElementById('m-public-update').value,
    Notes:        document.getElementById('m-notes').value,
  };

  // Update local state immediately for a snappy UI; invalidate cache so next load is fresh
  Object.assign(openTicket, updates);
  sessionStorage.removeItem(CACHE_KEY);
  renderAll();

  try {
    const res = await adminFetch('/api/admin/update-ticket', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(updates)
    });
    if (res.ok) {
      showToast('Ticket updated successfully ✓', 'success');
    } else if (res.status === 503) {
      showToast('Saved locally ✓ (SharePoint sync not set up yet — set PA_UPDATE_TICKET_URL).', 'success');
    } else if (res.status === 401) {
      showToast('Session expired — please log in again.', 'error');
    } else {
      showToast('Saved locally — server update failed.', 'error');
    }
  } catch(e) {
    showToast('Saved locally — could not reach the server.', 'error');
  }
  closeModal();
});

// ── Send reply to submitter ───────────────────────────────────────────────────
document.getElementById('btn-reply').addEventListener('click', async () => {
  if (!openTicket) return;
  const msg = document.getElementById('m-reply').value.trim();
  if (!msg) { showToast('Please type a reply message first.', 'error'); return; }

  try {
    const res = await adminFetch('/api/admin/reply', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        submitterEmail: openTicket.SubmitterEmail,
        submitterName:  openTicket.SubmitterName,
        ticketID:       openTicket.TicketID,
        replyMessage:   msg,
        agentName:      'iRam IT Support'
      })
    });
    if (res.ok) {
      showToast('Reply sent to ' + openTicket.SubmitterEmail + ' ✓', 'success');
      document.getElementById('m-reply').value = '';
    } else if (res.status === 401) {
      showToast('Session expired — please log in again.', 'error');
    } else {
      const d = await res.json().catch(() => ({}));
      showToast(d.error || 'Failed to send reply.', 'error');
    }
  } catch(e) {
    showToast('Failed to send reply — could not reach the server.', 'error');
  }
});

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, 3500);
}

// ── Logout ────────────────────────────────────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', () => {
  sessionStorage.removeItem('iram_it_auth');
  window.location.href = '../login.html';
});

// ── Settings modal ────────────────────────────────────────────────────────────
document.getElementById('settings-btn').addEventListener('click', () => {
  document.getElementById('settings-overlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  // Reset all message divs
  ['s-pw-msg','s-code-msg','s-bot-msg','s-maint-msg','s-broadcast-msg'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.style.display = 'none'; el.textContent = ''; }
  });
  // Reset to Security tab on open
  document.querySelectorAll('.s-stab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.s-spanel').forEach(p => p.style.display = 'none');
  const secTab = document.querySelector('.s-stab[data-stab="security"]');
  if (secTab) secTab.classList.add('active');
  const secPanel = document.getElementById('s-spanel-security');
  if (secPanel) secPanel.style.display = 'block';
});

document.getElementById('settings-close').addEventListener('click', closeSettings);
document.getElementById('settings-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('settings-overlay')) closeSettings();
});

function closeSettings() {
  document.getElementById('settings-overlay').style.display = 'none';
  document.body.style.overflow = '';
}

function showSettingsMsg(elId, text, ok) {
  const el = document.getElementById(elId);
  el.textContent  = text;
  el.style.display = 'block';
  el.style.background = ok ? '#edf7e8' : '#fff3ef';
  el.style.color      = ok ? '#107c10' : '#d83b01';
  el.style.border     = ok ? '1px solid #b3dea8' : '1px solid #f4b8a8';
}

function setBtnLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  btn.disabled    = loading;
  btn.textContent = loading ? '⏳ Please wait…' : (btnId === 's-pw-btn' ? '💾 Update Password' : '💾 Update Access Code');
}

// Change admin password
document.getElementById('s-pw-btn').addEventListener('click', async () => {
  const curPw    = document.getElementById('s-cur-pw').value;
  const newPw    = document.getElementById('s-new-pw').value;
  const confPw   = document.getElementById('s-conf-pw').value;
  const email    = document.getElementById('s-pw-email').value.trim();

  if (!curPw || !newPw || !confPw || !email) {
    showSettingsMsg('s-pw-msg', 'Please fill in all fields.', false); return;
  }
  if (newPw.length < 8) {
    showSettingsMsg('s-pw-msg', 'New password must be at least 8 characters.', false); return;
  }
  if (newPw !== confPw) {
    showSettingsMsg('s-pw-msg', 'New passwords do not match.', false); return;
  }

  setBtnLoading('s-pw-btn', true);
  try {
    const res  = await adminFetch('/api/admin/change-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ currentPassword: curPw, newPassword: newPw, confirmPassword: confPw, notifyEmail: email })
    });
    const data = await res.json();

    if (res.status === 401) { showSettingsMsg('s-pw-msg', data.error || 'Current password is incorrect.', false); return; }
    if (!res.ok)             { showSettingsMsg('s-pw-msg', data.error || 'Failed to update password.', false); return; }

    let msg = data.emailSent ? `✅ New password emailed to ${email}.` : '⚠️ Email could not be sent — note the new password manually.';
    if (data.requiresManualVercel) msg += ' Update ADMIN_PASSWORD in Vercel then redeploy to activate.';
    else if (data.requiresManualDeploy) msg += ' Trigger a Vercel redeploy to activate (~60s).';
    else if (data.deployed) msg += ' New password active in ~60 seconds.';

    showSettingsMsg('s-pw-msg', msg, true);

    // Clear the form and force re-login since the password changed
    ['s-cur-pw','s-new-pw','s-conf-pw'].forEach(id => document.getElementById(id).value = '');
    if (data.vercelUpdated) {
      setTimeout(() => {
        showToast('Password updated — logging you out. Log in with your new password.', 'success');
        setTimeout(() => { sessionStorage.clear(); window.location.href = '../login.html'; }, 2500);
      }, 1500);
    }
  } catch (_) {
    showSettingsMsg('s-pw-msg', 'Network error — could not reach the server.', false);
  } finally {
    setBtnLoading('s-pw-btn', false);
  }
});

// Change manager access code
document.getElementById('s-code-btn').addEventListener('click', async () => {
  const newCode  = document.getElementById('s-new-code').value.trim();
  const confCode = document.getElementById('s-conf-code').value.trim();
  const hrEmail  = document.getElementById('s-hr-email').value.trim();

  if (!newCode || !confCode || !hrEmail) {
    showSettingsMsg('s-code-msg', 'Please fill in all fields.', false); return;
  }
  if (newCode.length < 4) {
    showSettingsMsg('s-code-msg', 'Access code must be at least 4 characters.', false); return;
  }
  if (newCode !== confCode) {
    showSettingsMsg('s-code-msg', 'Access codes do not match.', false); return;
  }

  setBtnLoading('s-code-btn', true);
  try {
    const res  = await adminFetch('/api/admin/change-manager-code', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ newCode, confirmCode: confCode, hrEmail })
    });
    const data = await res.json();

    if (!res.ok) { showSettingsMsg('s-code-msg', data.error || 'Failed to update access code.', false); return; }

    let msg = data.emailSent ? `✅ New access code emailed to ${hrEmail}.` : '⚠️ Email could not be sent — share the new code with HR manually.';
    if (data.requiresManualVercel) msg += ' Update MANAGER_PASSWORD in Vercel then redeploy to activate.';
    else if (data.requiresManualDeploy) msg += ' Trigger a Vercel redeploy to activate (~60s).';
    else if (data.deployed) msg += ' New code active in ~60 seconds.';

    showSettingsMsg('s-code-msg', msg, true);
    document.getElementById('s-new-code').value  = '';
    document.getElementById('s-conf-code').value = '';
  } catch (_) {
    showSettingsMsg('s-code-msg', 'Network error — could not reach the server.', false);
  } finally {
    setBtnLoading('s-code-btn', false);
  }
});

// ── Bot settings ──────────────────────────────────────────────────────────────
async function loadBotSettings() {
  const loading  = document.getElementById('s-bot-loading');
  const controls = document.getElementById('s-bot-controls');
  if (!loading || !controls) return;

  loading.style.display  = 'block';
  controls.style.display = 'none';

  try {
    const res  = await adminFetch('/api/admin/bot-settings');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load bot settings');

    renderBotStatus(data.mode, data.aiAvailable, data.vercelReady);
    loading.style.display  = 'none';
    controls.style.display = 'block';
  } catch (e) {
    loading.textContent = 'Could not load bot settings: ' + e.message;
  }
}

function renderBotStatus(mode, aiAvailable, vercelReady) {
  const label   = document.getElementById('s-bot-mode-label');
  const aiStatus = document.getElementById('s-bot-ai-status');
  const warning  = document.getElementById('s-bot-ai-warning');
  const rulesBtn = document.getElementById('s-bot-rules-btn');
  const aiBtn    = document.getElementById('s-bot-ai-btn');

  if (label) {
    label.textContent = mode === 'ai' ? 'AI (Claude)' : 'Rule-based';
    label.style.color = mode === 'ai' ? '#0078d4' : '#4e9938';
  }
  if (aiStatus) {
    aiStatus.textContent = aiAvailable
      ? 'AI mode: Available (ANTHROPIC_API_KEY is set)'
      : 'AI mode: Not available (ANTHROPIC_API_KEY not set in Vercel)';
    aiStatus.style.color = aiAvailable ? '#107c10' : '#a4262c';
  }
  if (warning) warning.style.display = aiAvailable ? 'none' : 'block';

  const activeStyle   = 'padding:7px 16px;border-radius:6px;border:1.5px solid #4e9938;background:#4e9938;color:#fff;font-weight:700;font-size:13px;cursor:pointer';
  const inactiveStyle = 'padding:7px 16px;border-radius:6px;border:1.5px solid #dde;background:#fff;color:#444;font-weight:600;font-size:13px;cursor:pointer';
  const aiActiveStyle = 'padding:7px 16px;border-radius:6px;border:1.5px solid #0078d4;background:#0078d4;color:#fff;font-weight:700;font-size:13px;cursor:pointer';

  if (rulesBtn) rulesBtn.style.cssText = mode === 'rules' ? activeStyle : inactiveStyle;
  if (aiBtn)    aiBtn.style.cssText    = mode === 'ai'    ? aiActiveStyle : inactiveStyle;
}

window.setBotMode = async function(mode) {
  const msgEl = document.getElementById('s-bot-msg');

  if (mode === 'ai') {
    const warning = document.getElementById('s-bot-ai-warning');
    if (warning && warning.style.display !== 'none') {
      if (msgEl) { showSettingsMsg('s-bot-msg', 'Cannot enable AI mode — ANTHROPIC_API_KEY is not set in Vercel. Add it first, then try again.', false); }
      return;
    }
  }

  if (msgEl) { msgEl.style.display = 'none'; }

  const rulesBtn = document.getElementById('s-bot-rules-btn');
  const aiBtn    = document.getElementById('s-bot-ai-btn');
  if (rulesBtn) rulesBtn.disabled = true;
  if (aiBtn)    aiBtn.disabled    = true;

  try {
    const res  = await adminFetch('/api/admin/bot-settings', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ mode })
    });
    const data = await res.json();

    if (!res.ok) { showSettingsMsg('s-bot-msg', data.error || 'Failed to change bot mode.', false); return; }

    renderBotStatus(mode, !!(document.getElementById('s-bot-ai-warning')?.style.display === 'none'), !!(data.vercelUpdated));

    let msg = `✅ Bot mode set to ${mode === 'ai' ? 'AI (Claude)' : 'Rule-based'}.`;
    if (data.requiresManualVercel) msg += ' Update BOT_MODE in Vercel env vars then redeploy to activate.';
    else if (data.requiresManualDeploy) msg += ' Trigger a Vercel redeploy to activate (~60 seconds).';
    else if (data.deployed) msg += ' Redeployment triggered — active in ~60 seconds.';
    showSettingsMsg('s-bot-msg', msg, true);
  } catch (_) {
    showSettingsMsg('s-bot-msg', 'Network error — could not reach the server.', false);
  } finally {
    if (rulesBtn) rulesBtn.disabled = false;
    if (aiBtn)    aiBtn.disabled    = false;
  }
};

// ── Maintenance mode ──────────────────────────────────────────────────────────
async function loadMaintenanceSettings() {
  const loading  = document.getElementById('s-maint-loading');
  const controls = document.getElementById('s-maint-controls');
  if (!loading || !controls) return;
  loading.style.display  = 'block';
  controls.style.display = 'none';

  try {
    const res  = await adminFetch('/api/admin/maintenance');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    renderMaintenanceStatus(data.maintenance);
    loading.style.display  = 'none';
    controls.style.display = 'block';
  } catch (e) {
    loading.textContent = 'Could not load maintenance status: ' + e.message;
  }
}

function renderMaintenanceStatus(on) {
  const toggle  = document.getElementById('s-maint-toggle');
  const slider  = document.getElementById('s-maint-slider');
  const knob    = document.getElementById('s-maint-knob');
  const bar     = document.getElementById('s-maint-bar');
  const label   = document.getElementById('s-maint-label');
  const sub     = document.getElementById('s-maint-sub');
  if (!toggle) return;

  toggle.checked = on;

  if (on) {
    slider.style.background   = '#e07828';
    knob.style.marginLeft     = '29px';
    bar.style.background      = '#fff3ef';
    bar.style.borderColor     = '#f4b8a8';
    label.style.color         = '#a4262c';
    label.textContent         = '🚧 MAINTENANCE ON — visitors see the maintenance page';
    sub.textContent           = 'Toggle off to restore the portal for all staff';
  } else {
    slider.style.background   = '#4e9938';
    knob.style.marginLeft     = '3px';
    bar.style.background      = '#edf7e8';
    bar.style.borderColor     = '#b3dea8';
    label.style.color         = '#107c10';
    label.textContent         = '✅ Live — portal is accessible to all staff';
    sub.textContent           = 'Toggle to put the site in maintenance mode';
  }
}

window.setMaintenance = async function (on) {
  const msgEl = document.getElementById('s-maint-msg');
  if (msgEl) msgEl.style.display = 'none';

  const toggle = document.getElementById('s-maint-toggle');
  if (toggle) toggle.disabled = true;

  try {
    const res  = await adminFetch('/api/admin/maintenance', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ maintenance: on })
    });
    const data = await res.json();
    if (!res.ok) { showSettingsMsg('s-maint-msg', data.error || 'Failed to update.', false); renderMaintenanceStatus(!on); return; }

    renderMaintenanceStatus(on);

    let msg = on ? '🚧 Maintenance mode enabled.' : '✅ Maintenance mode disabled.';
    if (data.requiresManualVercel) msg += ' Update MAINTENANCE_MODE in Vercel then redeploy to activate.';
    else if (data.requiresManualDeploy) msg += ' Trigger a Vercel redeploy (~60s) to activate.';
    else if (data.deployed) msg += ' Redeployment triggered — active in ~60 seconds.';
    showSettingsMsg('s-maint-msg', msg, !data.requiresManualVercel);
  } catch (_) {
    showSettingsMsg('s-maint-msg', 'Network error — could not reach the server.', false);
    renderMaintenanceStatus(!on);
  } finally {
    if (toggle) toggle.disabled = false;
  }
};

// ── Broadcast refresh ─────────────────────────────────────────────────────────
window.broadcastRefresh = async function () {
  const btn    = document.getElementById('s-broadcast-btn');
  const msgEl  = document.getElementById('s-broadcast-msg');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Triggering deploy…'; }
  if (msgEl) msgEl.style.display = 'none';

  try {
    const res  = await adminFetch('/api/admin/broadcast', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { showSettingsMsg('s-broadcast-msg', data.error || 'Failed.', false); return; }

    if (data.deployed) {
      showSettingsMsg('s-broadcast-msg', '✅ Redeployment triggered. All open portal tabs will auto-refresh within ~80 seconds.', true);
    } else {
      showSettingsMsg('s-broadcast-msg', '⚠️ Could not trigger redeploy automatically — VERCEL_DEPLOY_HOOK_URL may not be set. Trigger a manual redeploy from the Vercel dashboard to broadcast the refresh.', false);
    }
  } catch (_) {
    showSettingsMsg('s-broadcast-msg', 'Network error — could not reach the server.', false);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📡 Broadcast Refresh to All Users'; }
  }
};

// ── Editable portal config: IT staff, categories, Smart Priority ──────────────
// One config object drives all three tabs. Every tab's Save posts the WHOLE
// config (the server sanitises it), so the forms must be rendered before saving.
let portalConfig       = null;
let portalConfigLoaded = false;

const escAttr     = s => esc(s).replace(/"/g, '&quot;');
const splitTerms  = s => String(s || '').split(/[,\n]/).map(t => t.trim().toLowerCase()).filter(Boolean);

function staffRowHtml(s = { name: '', role: '', email: '', isIT: false, isPerigee: false }) {
  return `<div class="cfg-row cfg-row-staff">
    <input class="cfg-input" data-f="name"  value="${escAttr(s.name)}"  placeholder="Sean">
    <input class="cfg-input" data-f="role"  value="${escAttr(s.role)}"  placeholder="Support">
    <input class="cfg-input" data-f="email" value="${escAttr(s.email)}" placeholder="sean@iram.co.za" type="email">
    <label class="cfg-check" title="Gets IT notification emails and rotates into ticket assignment"><input type="checkbox" data-f="isIT" ${s.isIT ? 'checked' : ''}></label>
    <label class="cfg-check" title="Gets Perigee notification emails and rotates into Perigee ticket assignment"><input type="checkbox" data-f="isPerigee" ${s.isPerigee ? 'checked' : ''}></label>
    <button type="button" class="cfg-x" title="Remove" onclick="this.parentNode.remove()">✕</button>
  </div>`;
}
function categoryRowHtml(c = { name: '', baseMinutes: 30, priorityScore: 10 }) {
  return `<div class="cfg-row cfg-row-cat">
    <input class="cfg-input" data-f="name"  value="${escAttr(c.name)}" placeholder="Hardware - Printer / Scanner">
    <input class="cfg-input" data-f="min"   value="${c.baseMinutes}"   type="number" min="5" max="480" step="5">
    <input class="cfg-input" data-f="score" value="${c.priorityScore}" type="number" min="0" max="100">
    <button type="button" class="cfg-x" title="Remove" onclick="this.parentNode.remove()">✕</button>
  </div>`;
}
function ruleRowHtml(r = { minutes: 60, terms: [] }) {
  return `<div class="cfg-row cfg-row-rule">
    <input class="cfg-input" data-f="min"   value="${r.minutes}" type="number" min="5" max="480" step="5">
    <input class="cfg-input" data-f="terms" value="${escAttr((r.terms || []).join(', '))}" placeholder="new laptop, onboarding, reimage">
    <button type="button" class="cfg-x" title="Remove" onclick="this.parentNode.remove()">✕</button>
  </div>`;
}

const PRIO_BANDS = [
  { id: 'critical', label: '🔴 Critical', hint: '' },
  { id: 'high',     label: '🟠 High',     hint: '' },
  { id: 'low',      label: '🟢 Low',      hint: 'Negative weight — these words push a ticket down to Low.' }
];
function bandHtml(id, label, hint, band) {
  return `<div class="cfg-band">
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:10px">
      <div style="font-size:13.5px;font-weight:700;color:#2D2D2D;flex:1">${label}</div>
      <span class="s-lbl" style="margin:0">Weight per match</span>
      <input class="cfg-input" style="width:88px" id="cfg-w-${id}" type="number" value="${band.weight}" min="-100" max="100">
    </div>
    <textarea id="cfg-t-${id}" placeholder="one word or phrase per line">${esc((band.terms || []).join('\n'))}</textarea>
    ${hint ? `<div style="font-size:11.5px;color:#888;margin-top:6px">${hint}</div>` : ''}
  </div>`;
}

function renderPortalConfig() {
  if (!portalConfig) return;
  const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
  const dr  = portalConfig.durationRules || { long: [], quick: [] };

  set('cfg-staff-rows', (portalConfig.itStaff    || []).map(staffRowHtml).join(''));
  set('cfg-cat-rows',   (portalConfig.categories || []).map(categoryRowHtml).join(''));
  set('cfg-long-rows',  (dr.long  || []).map(ruleRowHtml).join(''));
  set('cfg-quick-rows', (dr.quick || []).map(ruleRowHtml).join(''));
  set('cfg-priority-bands', PRIO_BANDS
    .map(b => bandHtml(b.id, b.label, b.hint, (portalConfig.priorityRules || {})[b.id] || { weight: 0, terms: [] }))
    .join(''));
}

window.addStaffRow    = () => document.getElementById('cfg-staff-rows').insertAdjacentHTML('beforeend', staffRowHtml());
window.addCategoryRow = () => document.getElementById('cfg-cat-rows').insertAdjacentHTML('beforeend', categoryRowHtml());
window.addRuleRow     = id => document.getElementById(id).insertAdjacentHTML('beforeend', ruleRowHtml());

window.loadPortalConfig = async function (force) {
  if (portalConfigLoaded && !force) return;
  try {
    const res = await adminFetch('/api/admin/config');
    if (res.status === 401) {
      showToast('Session expired — please log in again.', 'error');
      setTimeout(() => { sessionStorage.clear(); window.location.href = '../login.html'; }, 1500);
      return;
    }
    if (!res.ok) throw new Error(`Status ${res.status}`);

    const data = await res.json();
    portalConfig       = data.config;
    portalConfigLoaded = true;
    staffOverride      = portalConfig.itStaff;
    renderPortalConfig();
    populateAssignDropdown();

    const warn = document.getElementById('cfg-storage-warn');
    if (warn) {
      warn.style.display = data.storageReady ? 'none' : 'block';
      if (!data.storageReady) {
        warn.innerHTML = '⚠️ <strong>Storage not connected.</strong> You can browse these settings, but saving will fail until a Vercel Blob store is connected and the project is redeployed.';
      }
    }
  } catch (err) {
    showToast('Could not load settings: ' + err.message, 'error');
  }
};

function collectPortalConfig() {
  const rows  = sel => Array.from(document.querySelectorAll(sel + ' .cfg-row'));
  const val   = (r, f) => r.querySelector(`[data-f="${f}"]`).value;
  const num   = (r, f) => Number(val(r, f));
  const check = (r, f) => r.querySelector(`[data-f="${f}"]`).checked;

  const ruleRows = sel => rows(sel)
    .map(r => ({ minutes: num(r, 'min'), terms: splitTerms(val(r, 'terms')) }))
    .filter(x => x.terms.length);

  const band = id => ({
    weight: Number(document.getElementById('cfg-w-' + id).value),
    terms:  splitTerms(document.getElementById('cfg-t-' + id).value)
  });

  return {
    itStaff: rows('#cfg-staff-rows')
      .map(r => ({
        name:  val(r, 'name').trim(),
        role:  val(r, 'role').trim(),
        email: val(r, 'email').trim(),
        isIT:      check(r, 'isIT'),
        isPerigee: check(r, 'isPerigee')
      }))
      .filter(s => s.name),
    categories: rows('#cfg-cat-rows')
      .map(r => ({ name: val(r, 'name').trim(), baseMinutes: num(r, 'min'), priorityScore: num(r, 'score') }))
      .filter(c => c.name),
    durationRules: { long: ruleRows('#cfg-long-rows'), quick: ruleRows('#cfg-quick-rows') },
    priorityRules: { critical: band('critical'), high: band('high'), low: band('low') }
  };
}

window.savePortalConfig = async function (msgId, btnId) {
  // Every tab posts the whole config, so refuse to save from forms that were never
  // populated — empty inputs would be sanitised back to defaults and wipe real settings.
  if (!portalConfigLoaded) {
    showSettingsMsg(msgId, 'Settings have not loaded yet — reopen this tab and try again.', false);
    return;
  }

  const payload = collectPortalConfig();
  if (!payload.categories.length) {
    showSettingsMsg(msgId, 'Keep at least one category — the ticket form needs something to offer.', false);
    return;
  }

  setBtnLoading(btnId, true);
  try {
    const res  = await adminFetch('/api/admin/config', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showSettingsMsg(msgId, data.error || `Save failed (${res.status}).`, false); return; }

    portalConfig  = data.config;   // re-render from the server's sanitised version
    staffOverride = portalConfig.itStaff;
    renderPortalConfig();
    populateAssignDropdown();
    showSettingsMsg(msgId, '✅ Saved — live immediately, no redeploy needed.', true);
    showToast('Settings saved ✓', 'success');
  } catch (_) {
    showSettingsMsg(msgId, 'Network error — could not reach the server.', false);
  } finally {
    setBtnLoading(btnId, false);
  }
};

// ── Init ──────────────────────────────────────────────────────────────────────
populateAssignDropdown();
fetchTickets();

// Pull admin-edited staff so "Assigned to" is right without opening Settings.
(async () => {
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (!res.ok) return;
    const cfg = await res.json();
    if (Array.isArray(cfg.itStaff) && cfg.itStaff.length) {
      staffOverride = cfg.itStaff;
      populateAssignDropdown();
    }
  } catch (_) { /* dropdown falls back to config.js */ }
})();
