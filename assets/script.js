// ──────────────────────────────────────────────────────────────────────────────
// iRam IT Support Portal — Form Logic + Smart Priority Engine
// ──────────────────────────────────────────────────────────────────────────────

// ── Smart Priority Engine ─────────────────────────────────────────────────────
const PRIORITY_RULES = {
  critical: {
    weight: 60,
    terms: ['smoke','fire','ceo','md ','managing director','data loss','ransomware',
            'hacked','security breach','server down','complete outage','all users',
            'entire office','entire company','no power','flooding','emergency'],
    label: 'Critical',
    color: '#a4262c',
    bg: '#fdf0f0',
    border: '#a4262c',
    emoji: '🔴',
    sla: 'Response target: within 1 hour'
  },
  high: {
    weight: 25,
    terms: ['ops','cam ','client-facing','cannot work','can\'t work','locked out',
            'cannot access','can\'t access','urgent','director','not working',
            'broken','crash','blue screen','bsod','no internet','no wifi','down',
            'sales','account manager','operations','client meeting','deadline',
            'smoke from','sparks','won\'t turn on'],
    label: 'High',
    color: '#d83b01',
    bg: '#fff3ef',
    border: '#d83b01',
    emoji: '🟠',
    sla: 'Response target: within 4 hours'
  },
  low: {
    weight: -35,
    terms: ['signature','email signature','wallpaper','screensaver','cosmetic','scratch',
            'dent','nice to have','when you get a chance','preference','question about',
            'wondering if','just asking','not urgent','no rush','when free'],
    label: 'Low',
    color: '#498205',
    bg: '#edf7e8',
    border: '#6BBF4E',
    emoji: '🟢',
    sla: 'Response target: within 5 business days'
  }
};

const CATEGORY_BASE_SCORES = {
  'Hardware - PC / Laptop / Desktop': 35,
  'Hardware - Phone / Mobile Device': 20,
  'Hardware - Printer / Scanner':     15,
  'Network / Internet / VPN':         45,
  'Access / Passwords / Permissions': 35,
  'Software / Application':           25,
  'Email / Outlook / Teams':          30,
  'Other':                            10
};

function calculateSmartPriority(category, description, location, department) {
  const text     = (description + ' ' + department + ' ' + category).toLowerCase();
  let   score    = CATEGORY_BASE_SCORES[category] || 10;
  const triggers = [];

  if (location === 'Head Office') { score += 10; triggers.push('Head Office location'); }

  PRIORITY_RULES.critical.terms.forEach(t => {
    if (text.includes(t)) { score += PRIORITY_RULES.critical.weight; triggers.push(`"${t}"`); }
  });
  PRIORITY_RULES.high.terms.forEach(t => {
    if (text.includes(t)) { score += PRIORITY_RULES.high.weight; triggers.push(`"${t}"`); }
  });
  PRIORITY_RULES.low.terms.forEach(t => {
    if (text.includes(t)) { score += PRIORITY_RULES.low.weight; }
  });

  let rule;
  if      (score >= 90) rule = PRIORITY_RULES.critical;
  else if (score >= 50) rule = PRIORITY_RULES.high;
  else if (score >= 20) rule = { ...PRIORITY_RULES.high, label:'Medium', color:'#986f0b', bg:'#fffbef', border:'#986f0b', emoji:'🟡', sla:'Response target: within 1 business day' };
  else                  rule = PRIORITY_RULES.low;

  return { ...rule, score, triggers: [...new Set(triggers)].slice(0, 4) };
}

// ── Priority indicator UI ─────────────────────────────────────────────────────
function updatePriorityIndicator() {
  const category    = document.getElementById('category').value;
  const description = document.getElementById('description').value;
  const location    = document.getElementById('location').value;
  const department  = document.getElementById('department').value;

  const indicator = document.getElementById('priority-indicator');
  if (!category && !description) { indicator.style.display = 'none'; return; }

  const result = calculateSmartPriority(category, description, location, department);
  document.getElementById('priority').value = result.label;

  indicator.style.display       = 'block';
  indicator.style.borderColor   = result.border;
  indicator.style.background    = result.bg;
  indicator.querySelector('.pi-emoji').textContent  = result.emoji;
  indicator.querySelector('.pi-label').textContent  = result.label + ' Priority';
  indicator.querySelector('.pi-label').style.color  = result.color;
  indicator.querySelector('.pi-sla').textContent    = result.sla;

  const trigEl = indicator.querySelector('.pi-triggers');
  trigEl.innerHTML = result.triggers.length
    ? 'Signals detected: ' + result.triggers.map(t => `<em>${t}</em>`).join(', ')
    : 'Based on category and location.';
}

['category','description','location','department'].forEach(id => {
  document.getElementById(id)?.addEventListener('input',  updatePriorityIndicator);
  document.getElementById(id)?.addEventListener('change', updatePriorityIndicator);
});

// ── WhatsApp link ─────────────────────────────────────────────────────────────
const waNum = (typeof IRAM_CONFIG !== 'undefined') ? IRAM_CONFIG.whatsappNumber : '27000000000';
document.getElementById('wa-link').href =
  `https://wa.me/${waNum}?text=${encodeURIComponent('Hi iRam IT Support, I need help with:\n\nName: \nDepartment: \nIssue: ')}`;

// ── Validation helpers ────────────────────────────────────────────────────────
function validateField(id, value) {
  const group = document.getElementById(id)?.closest('.form-group');
  if (!group) return true;
  const err = !value || !value.trim();
  group.classList.toggle('has-error', err);
  return !err;
}
function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); }
function isPhone(v) { return /^\+?[\d\s\-()]{7,20}$/.test(v) && (v.match(/\d/g) || []).length >= 7; }

// Filter non-phone characters as the user types
document.getElementById('phone')?.addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/[^\d+\-\s()]/g, '');
});

function generateOptimisticID() {
  return `IT-${new Date().getFullYear()}-${String(Math.floor(Math.random()*90000)+10000)}`;
}

// ── States ────────────────────────────────────────────────────────────────────
function showState(s) {
  ['form-state','loading-state','success-state'].forEach(id => {
    document.getElementById(id).style.display = (id === s + '-state') ? 'block' : 'none';
  });
  // Header "Log New Ticket" button only shows once a ticket has been submitted
  const headerBtn = document.getElementById('btn-new-header');
  if (headerBtn) headerBtn.style.display = (s === 'success') ? 'inline-flex' : 'none';
}

// ── Reset to a fresh, empty form ──────────────────────────────────────────────
function resetForm() {
  document.getElementById('ticket-form').reset();
  document.getElementById('priority').value = '';
  document.getElementById('priority-indicator').style.display = 'none';
  document.querySelectorAll('.form-group').forEach(g => g.classList.remove('has-error'));
  showState('form');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Optional error-image attachment ───────────────────────────────────────────
// Resized in the browser to keep the upload well under Vercel's request limit —
// most screenshots end up a few hundred KB, so a plain JSON POST is enough and we
// avoid a direct-to-Blob upload flow. attachmentDataUrl holds the result (or null).
let attachmentDataUrl = null;
const MAX_ATTACH_BYTES = 10 * 1024 * 1024; // 10 MB before shrinking
const MAX_ATTACH_DIM   = 1600;             // longest edge after shrinking

(function initAttachment() {
  const input   = document.getElementById('attachment');
  const btn     = document.getElementById('attach-btn');
  const preview = document.getElementById('attach-preview');
  const imgEl   = document.getElementById('attach-img');
  const nameEl  = document.getElementById('attach-name');
  const removeBtn = document.getElementById('attach-remove');
  if (!input || !btn) return; // form variant without the picker

  const reset = () => {
    attachmentDataUrl = null;
    input.value = '';
    preview.style.display = 'none';
    btn.style.display = 'block';
    imgEl.removeAttribute('src');
  };

  btn.addEventListener('click', () => input.click());
  removeBtn.addEventListener('click', reset);

  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Please choose an image file.'); reset(); return; }
    if (file.size > MAX_ATTACH_BYTES)    { alert('That image is over 10 MB. Please choose a smaller one.'); reset(); return; }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Scale the longest edge down to MAX_ATTACH_DIM, keep aspect ratio.
        let { width, height } = img;
        const scale = Math.min(1, MAX_ATTACH_DIM / Math.max(width, height));
        width  = Math.round(width  * scale);
        height = Math.round(height * scale);

        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);

        // PNGs (typical screenshots) keep transparency; everything else → JPEG.
        const isPng = file.type === 'image/png';
        attachmentDataUrl = canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.82);

        imgEl.src = attachmentDataUrl;
        nameEl.textContent = file.name;
        preview.style.display = 'block';
        btn.style.display = 'none';
      };
      img.onerror = () => { alert('Could not read that image. Please try another file.'); reset(); };
      img.src = reader.result;
    };
    reader.onerror = () => { alert('Could not read that file.'); reset(); };
    reader.readAsDataURL(file);
  });
})();

// ── Submit ────────────────────────────────────────────────────────────────────
document.getElementById('ticket-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const get    = id => document.getElementById(id)?.value?.trim() ?? '';
  const name   = get('name'),   email    = get('email'),  phone  = get('phone');
  const dept   = get('department'),  location = get('location');
  const mgr    = get('manager-name'), mgrEmail = get('manager-email');
  const cat    = get('category'), desc     = get('description');
  const prio   = get('priority');

  let valid = true;
  valid = validateField('name',        name)     && valid;
  valid = validateField('department',  dept)     && valid;
  valid = validateField('category',    cat)      && valid;
  valid = validateField('location',    location) && valid;
  valid = validateField('description', desc)     && valid;

  const emailGroup = document.getElementById('email').closest('.form-group');
  if (!email || !isEmail(email)) { emailGroup.classList.add('has-error'); valid = false; }
  else emailGroup.classList.remove('has-error');

  const phoneGroup = document.getElementById('phone').closest('.form-group');
  if (phone && !isPhone(phone)) { phoneGroup.classList.add('has-error'); valid = false; }
  else phoneGroup.classList.remove('has-error');

  if (!valid) {
    document.querySelector('.has-error input, .has-error select, .has-error textarea')?.focus();
    return;
  }

  showState('loading');

  const webhookUrl = (typeof IRAM_CONFIG !== 'undefined')
    ? IRAM_CONFIG.submitWebhookUrl
    : 'PASTE_YOUR_POWER_AUTOMATE_HTTP_TRIGGER_URL_HERE';

  const payload = {
    channel:          'Web Portal',
    submitterName:    name,
    submitterEmail:   email,
    submitterPhone:   phone,
    department:       dept,
    location:         location,
    managerName:      mgr,
    managerEmail:     mgrEmail,
    category:         cat,
    suggestedPriority: prio,
    description:      desc,
    submittedAt:      new Date().toISOString(),
    // Optional error screenshot (already shrunk client-side). The server uploads
    // it to Blob and swaps in a URL before forwarding to Power Automate.
    attachmentDataUrl: attachmentDataUrl || undefined
  };

  let ticketID = generateOptimisticID();
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      try { const d = await res.json(); if (d?.ticketID) ticketID = d.ticketID; } catch(_){}
    }
  } catch(err) { console.warn('Webhook error:', err.message); }

  // Populate success screen
  document.getElementById('s-ticket-id').textContent = ticketID;
  const trackLink = document.getElementById('track-this-link');
  if (trackLink) trackLink.href = `track.html?ticket=${encodeURIComponent(ticketID)}`;
  document.getElementById('s-name').textContent      = name;
  document.getElementById('s-email').textContent     = email;
  document.getElementById('s-category').textContent  = cat;
  document.getElementById('s-location').textContent  = location;
  document.getElementById('s-priority').textContent  = prio || 'Auto-assessed';
  document.getElementById('s-submitted').textContent = new Date().toLocaleString('en-ZA', { dateStyle:'medium', timeStyle:'short' });

  showState('success');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ── Reset ─────────────────────────────────────────────────────────────────────
document.getElementById('btn-new').addEventListener('click', resetForm);
document.getElementById('btn-new-header')?.addEventListener('click', resetForm);

// Clear errors on input
['name','email','phone','department','category','location','description'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () =>
    document.getElementById(id).closest('.form-group').classList.remove('has-error')
  );
});
