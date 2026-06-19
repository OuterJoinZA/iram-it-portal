// ──────────────────────────────────────────────────────────────────────────────
// iRam IT Admin Panel — Dashboard Logic
// ──────────────────────────────────────────────────────────────────────────────

// ── Auth guard ────────────────────────────────────────────────────────────────
if (sessionStorage.getItem('iram_it_auth') !== 'true') {
  window.location.href = '../login.html';
}

const CFG = (typeof IRAM_CONFIG !== 'undefined') ? IRAM_CONFIG : {};

// ── State ─────────────────────────────────────────────────────────────────────
let allTickets   = [];
let activeTab    = 'Open';
let searchQuery  = '';
let filterPrio   = 'all';
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

// ── Fetch tickets (real or demo) ──────────────────────────────────────────────
async function fetchTickets() {
  const url = CFG.getTicketsUrl;
  if (!url || url.startsWith('PASTE')) {
    // No PA URL yet — show demo data
    allTickets = DEMO_TICKETS;
    renderAll();
    showToast('Showing demo tickets — configure Power Automate URL in config.js to load real tickets.', 'error');
    return;
  }
  try {
    const res  = await fetch(url);
    const data = await res.json();
    allTickets = Array.isArray(data) ? data : (data.value || []);
    renderAll();
  } catch(err) {
    allTickets = DEMO_TICKETS;
    renderAll();
    showToast('Could not load live tickets — showing demo data.', 'error');
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderAll() {
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
    const q         = searchQuery.toLowerCase();
    const matchQ    = !q ||
      (t.TicketID||'').toLowerCase().includes(q) ||
      (t.SubmitterName||'').toLowerCase().includes(q) ||
      (t.Department||'').toLowerCase().includes(q) ||
      (t.Category||'').toLowerCase().includes(q) ||
      (t.Description||'').toLowerCase().includes(q);
    return matchTab && matchPrio && matchQ;
  });
}

const PRIO_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };

function renderTable() {
  const tickets = filteredTickets().sort((a, b) =>
    (PRIO_ORDER[a.Priority] ?? 9) - (PRIO_ORDER[b.Priority] ?? 9)
  );
  const tbody = document.getElementById('ticket-tbody');
  if (!tickets.length) {
    tbody.innerHTML = `<tr><td colspan="7">
      <div class="empty-state"><div class="e-icon">📭</div><p>No tickets match the current filters.</p></div>
    </td></tr>`;
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
}

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
  document.getElementById('m-assigned').value    = t.AssignedTo || '';
  document.getElementById('m-notes').value       = t.Notes || '';
  document.getElementById('m-reply').value       = '';

  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
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
    id:         openTicket.id,
    Status:     document.getElementById('m-status').value,
    Priority:   document.getElementById('m-priority').value,
    AssignedTo: document.getElementById('m-assigned').value,
    Notes:      document.getElementById('m-notes').value,
  };

  // Update local state
  Object.assign(openTicket, updates);
  renderAll();

  const url = CFG.updateTicketUrl;
  if (url && !url.startsWith('PASTE')) {
    try {
      await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(updates) });
      showToast('Ticket updated successfully ✓', 'success');
    } catch(e) {
      showToast('Saved locally — Power Automate update failed.', 'error');
    }
  } else {
    showToast('Saved locally ✓ (configure updateTicketUrl in config.js to sync to SharePoint)', 'success');
  }
  closeModal();
});

// ── Send reply to submitter ───────────────────────────────────────────────────
document.getElementById('btn-reply').addEventListener('click', async () => {
  if (!openTicket) return;
  const msg = document.getElementById('m-reply').value.trim();
  if (!msg) { showToast('Please type a reply message first.', 'error'); return; }

  const url = CFG.sendReplyUrl;
  if (url && !url.startsWith('PASTE')) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          submitterEmail: openTicket.SubmitterEmail,
          submitterName:  openTicket.SubmitterName,
          ticketID:       openTicket.TicketID,
          replyMessage:   msg,
          agentName:      'iRam IT Support'
        })
      });
      showToast('Reply sent to ' + openTicket.SubmitterEmail + ' ✓', 'success');
      document.getElementById('m-reply').value = '';
    } catch(e) {
      showToast('Failed to send reply — check your Power Automate URL.', 'error');
    }
  } else {
    showToast('configure sendReplyUrl in config.js to send emails.', 'error');
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

// ── Init ──────────────────────────────────────────────────────────────────────
fetchTickets();
