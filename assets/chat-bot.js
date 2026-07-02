// iRam Help Bot v1 — self-contained floating chat widget
// Supports rule-based (default) and AI mode (Claude API via /api/chat)
(function () {
  'use strict';
  if (window.__iramBotLoaded) return;
  window.__iramBotLoaded = true;

  const G  = '#4e9938';   // iRam green
  const GD = '#2D2D2D';   // iRam dark

  // ── Rule database ─────────────────────────────────────────────────────────
  const RULES = [
    {
      t: ['hello','hi','hey','howzit','good morning','good afternoon','good day','hiya','sup'],
      r: "Hi there! I'm the iRam Help Bot. What can I help you with today?",
      f: ['Log an IT ticket','Track my ticket','HR contacts','Leave & time off']
    },
    {
      t: ['log','submit','raise','new ticket','it ticket','support ticket','create ticket','report issue','broken','not working','issue','problem','cant access','cannot access'],
      r: "To log an IT support ticket, go to the <a href='/it-support'>IT Support page →</a> and fill in the form.\n\nYou'll get a ticket number instantly and a calendar invite with your support appointment time.",
      f: ['Track my ticket','What happens after I submit?']
    },
    {
      t: ['track','status','check ticket','my ticket','ticket number','where is my','it-2','follow up','update on','progress'],
      r: "Go to <a href='/track'>Track a Ticket →</a> and enter your ticket number (e.g. <code>IT-2026-12345</code>).\n\nYou'll see the current status, who it's assigned to, and any updates from the IT team.",
      f: ['Log a new ticket','Contact IT support']
    },
    {
      t: ['what happens after','what happen','after submit','after i log','after ticket'],
      r: "After you submit a ticket:\n\n1. You get an email with your ticket number\n2. Your IT technician is notified\n3. A calendar invite is sent with your support time\n4. Track progress at <a href='/track'>Track a Ticket →</a>\n\nFor urgent issues, call or WhatsApp the IT team directly.",
      f: ['Track my ticket','Log an IT ticket']
    },
    {
      t: ['hr','human resources','people team','hr contact','hr team','hr department','who do i contact'],
      r: "You can reach HR at <a href='mailto:hr@iram.co.za'>hr@iram.co.za</a>, or view all individual HR contacts on the <a href='/hr'>HR page →</a>.\n\nHR office hours: Monday–Friday, 08:00–17:00.",
      f: ['Leave & time off','HR forms','SimplePay help']
    },
    {
      t: ['leave','annual leave','sick leave','family responsibility','leave policy','apply for leave','leave balance','time off','vacation','holiday','unpaid leave'],
      r: "Leave is applied for through <strong>SimplePay</strong> → Requests → Leave.\n\niRam leave entitlements:\n• Annual leave: 15 working days/year\n• Sick leave: 30 days per 3-year cycle (medical certificate required after 2 consecutive days)\n• Family responsibility: 3 days/year\n\nSee all leave policies on the <a href='/hr'>HR page →</a> under Company Policies.",
      f: ['SimplePay help','HR contacts']
    },
    {
      t: ['simplepay','payslip','salary','payroll','pay slip','payroll portal','my pay','payslips','view payslip'],
      r: "SimplePay is iRam's payroll self-service — view payslips, apply for leave, and check leave balances.\n\n• <a href='https://apps.apple.com/app/id1501139428' target='_blank'>App Store (iPhone) →</a>\n• <a href='https://play.google.com/store/search?q=simple+pay&c=apps' target='_blank'>Google Play (Android) →</a>\n• <a href='https://payroll.simplepay.cloud/login?country_code=za' target='_blank'>Web portal →</a>\n\nFirst time? Check your email for an activation link from SimplePay.",
      f: ['Apply for leave','HR contacts']
    },
    {
      t: ['flexicare','medical','doctor','gp','dentist','health','clinic','healthcare','medical aid','benefit','pharmacy'],
      r: "iRam staff have access to the <strong>Flexicare</strong> medical benefit scheme.\n\nDownload GP and dental network lists on the <a href='/hr'>HR page →</a> under Flexicare.\n\nFor queries, email <a href='mailto:hr@iram.co.za'>hr@iram.co.za</a>.",
      f: ['HR contacts','HR forms']
    },
    {
      t: ['form','hr form','uniform','bank details','sim swap','banking details','cgcsa','card top','card order','request form'],
      r: "HR forms are on the <a href='/hr'>HR page →</a> under &ldquo;HR Forms & Requests&rdquo;.\n\nAll staff forms include:\n• Uniform order\n• CGCSA card top-up\n• SIM swap\n• Bank detail change\n• Training attendance register",
      f: ['Senior staff forms','HR contacts']
    },
    {
      t: ['password','reset password','forgot password','locked out','account locked','cant log in','cannot log in','change password'],
      r: "For password issues:\n\n• <strong>Work email / Microsoft</strong> — Log an <a href='/it-support'>IT ticket →</a> for a reset\n• <strong>SimplePay</strong> — Use &ldquo;Forgot password&rdquo; on the <a href='https://payroll.simplepay.cloud/login?country_code=za' target='_blank'>SimplePay login page</a>\n• <strong>Other systems</strong> — Log an IT ticket and specify the system",
      f: ['Log an IT ticket','MFA / 2FA help']
    },
    {
      t: ['2fa','mfa','multi-factor','authenticator','verification code','auth app','microsoft authenticator','two factor','two-factor'],
      r: "To set up MFA (Multi-Factor Authentication):\n\n1. Download <strong>Microsoft Authenticator</strong> on your phone\n2. On your PC, visit <a href='https://aka.ms/mfasetup' target='_blank'>aka.ms/mfasetup</a>\n3. Click &ldquo;Add sign-in method&rdquo; → Authenticator app\n4. Scan the QR code with your phone\n\nNeed help? Log an <a href='/it-support'>IT ticket →</a>",
      f: ['Log an IT ticket','Password help']
    },
    {
      t: ['wifi','wi-fi','internet','network','not connecting','slow internet','vpn','connection','offline','no internet','no wifi'],
      r: "For network or internet issues, please <a href='/it-support'>log an IT ticket →</a>.\n\nIn your description, include:\n• What you can't access\n• When the problem started\n• Whether others in your area are affected",
      f: ['Log an IT ticket','Track my ticket']
    },
    {
      t: ['email','outlook','cant send email','email not working','set up email','email on phone','email setup','outlook not working'],
      r: "For email and Outlook issues:\n\n• <strong>Can't access email</strong> — Log an <a href='/it-support'>IT ticket →</a>\n• <strong>Set up Outlook on phone</strong> — Download the Outlook app, tap &ldquo;Add Account&rdquo;, enter your iRam email\n• <strong>Email signature</strong> — Log an IT ticket and we'll set it up",
      f: ['Log an IT ticket','Password help']
    },
    {
      t: ['teams','microsoft teams','meeting','teams call','join meeting','teams not working','video call'],
      r: "For Microsoft Teams issues:\n\n• Teams not loading — Log an <a href='/it-support'>IT ticket →</a>\n• Join a meeting without the app — click the meeting link and select &ldquo;Continue on this browser&rdquo;",
      f: ['Log an IT ticket']
    },
    {
      t: ['printer','print','scanner','printing','cant print','paper jam','print error'],
      r: "For printer or scanner issues, <a href='/it-support'>log an IT ticket →</a>.\n\nInclude in your description:\n• The printer name or floor/room\n• The error shown (if any)\n• Whether others can print to it",
      f: ['Log an IT ticket']
    },
    {
      t: ['fuel','allowance','fleet card','fuel card','petrol','reimbursement','fuel claim'],
      r: "Fuel allowance and fleet card info is on the <a href='/hr'>HR page →</a> under &ldquo;Fuel Allowance&rdquo;.\n\nFor queries, email <a href='mailto:hr@iram.co.za'>hr@iram.co.za</a>.",
      f: ['HR contacts','HR forms']
    },
    {
      t: ['uniform','clothing','workwear','shirt','jacket','dress code','uniform order'],
      r: "To order uniform, use the <strong>Uniform Order Form</strong> on the <a href='/hr'>HR page →</a> under HR Forms. For urgent needs, email <a href='mailto:hr@iram.co.za'>hr@iram.co.za</a>.",
      f: ['HR forms','HR contacts']
    },
    {
      t: ['discipline','disciplinary','warning','misconduct','grievance','unfair'],
      r: "For disciplinary matters or grievances, contact HR directly at <a href='mailto:hr@iram.co.za'>hr@iram.co.za</a> or speak to your HR contact personally. These are handled confidentially.",
      f: ['HR contacts']
    },
    {
      t: ['training','course','workshop','learning','development','training cost'],
      r: "For training requests, contact your line manager and HR at <a href='mailto:hr@iram.co.za'>hr@iram.co.za</a>.\n\nNote: if iRam sponsors training, a repayment clause applies if you leave within 12 months (Training Costs Agreement).\n\nFull policy on the <a href='/hr'>HR page →</a> under Training & Attendance.",
      f: ['HR contacts','Leave & time off']
    },
    {
      t: ['portal','this website','it portal','hr portal','help portal','what is this','how does this work','what can you do'],
      r: "The <strong>iRam Staff Help Portal</strong> has three sections:\n\n• 🖥️ <a href='/it-support'>IT Support</a> — Log and track IT tickets\n• 👥 <a href='/hr'>HR & People</a> — Contacts, policies, SimplePay, Flexicare, forms\n• 🏠 <a href='/'>Home</a> — Portal landing page",
      f: ['Log an IT ticket','HR contacts']
    },
    {
      t: ['senior staff','manager form','manager access','restricted form','recruitment','requisition','discipline request','instruction to hire','resignation','exit','staff movement'],
      r: "Senior staff forms (Managers & above) are on the <a href='/hr'>HR page →</a> under HR Forms → Senior Staff.\n\nYou'll need your manager access code to unlock them. Contact HR if you don't have your code.",
      f: ['HR contacts','HR forms']
    },
    {
      t: ['laptop','computer','pc','desktop','slow computer','frozen','crashed','blue screen','monitor','keyboard','mouse','hardware'],
      r: "For hardware issues (laptop, PC, monitor, keyboard, etc.), please <a href='/it-support'>log an IT ticket →</a>.\n\nIn your description, include:\n• The device type and model if known\n• The exact problem or error\n• Whether it's sudden or ongoing",
      f: ['Log an IT ticket','Track my ticket']
    },
    {
      t: ['thank','thanks','thank you','thx','cheers','appreciated','helpful'],
      r: "Happy to help! Is there anything else I can assist you with?",
      f: ['Log an IT ticket','HR contacts','Leave & time off']
    }
  ];

  const FALLBACK = {
    r: "I'm not sure I can help with that specifically. Here are things I can help with, or you can <a href='/it-support'>log an IT ticket →</a> or email <a href='mailto:hr@iram.co.za'>hr@iram.co.za</a> for HR queries.",
    f: ['Log an IT ticket','Track my ticket','HR contacts','Leave & time off','SimplePay help']
  };

  const CHIP_MAP = {
    'Log an IT ticket':         'log ticket',
    'Log a new ticket':         'log ticket',
    'Track my ticket':          'track ticket',
    'HR contacts':              'hr contact',
    'HR & policies':            'hr',
    'HR forms':                 'hr form',
    'Leave & time off':         'leave',
    'Apply for leave':          'leave',
    'Leave policy':             'leave policy',
    'SimplePay help':           'simplepay',
    'SimplePay / payslips':     'simplepay',
    'MFA / 2FA help':           '2fa',
    'Password help':            'password',
    'Contact IT support':       'it contact',
    'Senior staff forms':       'senior staff',
    'What happens after I submit?': 'what happens after'
  };

  function findRule(text) {
    const mapped = CHIP_MAP[text];
    const q = (mapped || text).toLowerCase();
    let best = null, score = 0;
    for (const rule of RULES) {
      for (const trigger of rule.t) {
        if (q.includes(trigger) && trigger.length > score) {
          score = trigger.length; best = rule;
        }
      }
    }
    return best;
  }

  // ── CSS ───────────────────────────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById('irb-css')) return;
    const s = document.createElement('style');
    s.id = 'irb-css';
    s.textContent = `
    #irb-fab{position:fixed;bottom:22px;right:22px;z-index:9990;display:flex;align-items:center;gap:8px;cursor:pointer}
    #irb-fab-label{background:#2D2D2D;color:#fff;font-size:12.5px;font-weight:600;padding:6px 13px;border-radius:20px;white-space:nowrap;font-family:'Segoe UI',Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.25);transition:opacity .2s}
    #irb-fab-btn{width:48px;height:48px;border-radius:50%;background:${G};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(78,153,56,.45);transition:transform .15s,box-shadow .15s}
    #irb-fab-btn:hover{transform:scale(1.08);box-shadow:0 6px 22px rgba(78,153,56,.55)}
    #irb-fab-btn svg{width:24px;height:24px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    #irb-panel{position:fixed;bottom:82px;right:22px;width:340px;max-height:520px;border-radius:16px;box-shadow:0 12px 48px rgba(0,0,0,.22);display:flex;flex-direction:column;overflow:hidden;z-index:9991;opacity:0;transform:scale(.9) translateY(12px);pointer-events:none;transition:opacity .2s,transform .2s;font-family:'Segoe UI',Arial,sans-serif}
    #irb-panel.irb-open{opacity:1;transform:scale(1) translateY(0);pointer-events:all}
    #irb-header{background:${GD};padding:12px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0}
    .irb-avatar{width:34px;height:34px;border-radius:50%;background:${G};display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .irb-avatar svg{width:18px;height:18px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    #irb-header-text{flex:1}
    #irb-header-name{font-size:13.5px;font-weight:700;color:#fff}
    #irb-header-status{font-size:11px;color:rgba(255,255,255,.55);display:flex;align-items:center;gap:4px}
    #irb-header-status::before{content:'';width:6px;height:6px;border-radius:50%;background:${G};display:inline-block}
    #irb-close{background:none;border:none;color:rgba(255,255,255,.6);font-size:20px;cursor:pointer;line-height:1;padding:0 0 0 8px;flex-shrink:0}
    #irb-close:hover{color:#fff}
    #irb-mode-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;text-transform:uppercase;letter-spacing:.4px;flex-shrink:0}
    #irb-mode-badge.rules{background:rgba(107,191,78,.2);color:#6BBF4E}
    #irb-mode-badge.ai{background:rgba(0,120,212,.25);color:#5ab3ff}
    #irb-msgs{flex:1;overflow-y:auto;padding:14px;background:#f5f6f8;display:flex;flex-direction:column;gap:10px;min-height:0}
    .irb-msg{display:flex;gap:8px;align-items:flex-start;max-width:85%}
    .irb-msg.bot{align-self:flex-start}
    .irb-msg.user{align-self:flex-end;flex-direction:row-reverse}
    .irb-msg-avatar{width:26px;height:26px;border-radius:50%;background:${G};display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px}
    .irb-msg-avatar svg{width:13px;height:13px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .irb-bubble{padding:9px 13px;border-radius:14px;font-size:13px;line-height:1.55;word-break:break-word}
    .irb-msg.bot .irb-bubble{background:#fff;border:1px solid #e8e8e8;border-radius:4px 14px 14px 14px;color:#2D2D2D}
    .irb-msg.user .irb-bubble{background:${G};color:#fff;border-radius:14px 4px 14px 14px}
    .irb-bubble a{color:${G};font-weight:600}
    .irb-msg.user .irb-bubble a{color:#c8f5b4}
    .irb-bubble code{background:rgba(0,0,0,.08);padding:1px 5px;border-radius:4px;font-size:12px;font-family:monospace}
    .irb-typing{display:flex;gap:4px;align-items:center;padding:10px 13px}
    .irb-typing span{width:6px;height:6px;border-radius:50%;background:#aaa;animation:irb-bounce .9s ease-in-out infinite}
    .irb-typing span:nth-child(2){animation-delay:.15s}
    .irb-typing span:nth-child(3){animation-delay:.3s}
    @keyframes irb-bounce{0%,80%,100%{transform:scale(.7)}40%{transform:scale(1)}}
    #irb-chips{background:#fff;border-top:1px solid #eee;padding:10px 12px;display:flex;flex-wrap:wrap;gap:6px;flex-shrink:0}
    .irb-chip{font-size:11.5px;padding:5px 11px;border:1.5px solid #d8d8d8;border-radius:20px;cursor:pointer;color:#444;background:#fff;transition:border-color .15s,background .15s;white-space:nowrap;font-family:'Segoe UI',Arial,sans-serif}
    .irb-chip:hover{border-color:${G};background:#edf7e8;color:#2D2D2D}
    #irb-input-row{background:#fff;border-top:1px solid #eee;padding:10px 12px;display:flex;gap:8px;align-items:center;flex-shrink:0}
    #irb-input{flex:1;border:1.5px solid #dde;border-radius:10px;padding:8px 12px;font-size:13px;font-family:'Segoe UI',Arial,sans-serif;outline:none;resize:none;max-height:80px;overflow-y:auto}
    #irb-input:focus{border-color:${G}}
    #irb-send{width:34px;height:34px;border-radius:8px;background:${G};border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .15s}
    #irb-send:hover{background:#3d8030}
    #irb-send svg{width:15px;height:15px;fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    @media(max-width:400px){#irb-panel{width:calc(100vw - 20px);right:10px}}
    `;
    document.head.appendChild(s);
  }

  // ── SVG icons ─────────────────────────────────────────────────────────────
  const ICON_CHAT = `<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
  const ICON_BOT  = `<svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="9" cy="16" r="1" fill="#fff"/><circle cx="15" cy="16" r="1" fill="#fff"/><path d="M12 3a2 2 0 0 1 2 2v4H10V5a2 2 0 0 1 2-2z"/><line x1="12" y1="5" x2="12" y2="3"/></svg>`;
  const ICON_SEND = `<svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

  // ── HTML injection ────────────────────────────────────────────────────────
  function injectHTML() {
    if (document.getElementById('irb-fab')) return;

    const fab = document.createElement('div');
    fab.id = 'irb-fab';
    fab.innerHTML = `
      <div id="irb-fab-label">Need help?</div>
      <button id="irb-fab-btn" aria-label="Open help chat">${ICON_CHAT}</button>`;

    const panel = document.createElement('div');
    panel.id = 'irb-panel';
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-label','iRam Help Bot');
    panel.innerHTML = `
      <div id="irb-header">
        <div class="irb-avatar">${ICON_BOT}</div>
        <div id="irb-header-text">
          <div id="irb-header-name">iRam Help Bot</div>
          <div id="irb-header-status">Online</div>
        </div>
        <span id="irb-mode-badge" class="rules">Rules</span>
        <button id="irb-close" aria-label="Close chat">✕</button>
      </div>
      <div id="irb-msgs" role="log" aria-live="polite"></div>
      <div id="irb-chips"></div>
      <div id="irb-input-row">
        <textarea id="irb-input" placeholder="Ask me anything…" rows="1" aria-label="Type your message"></textarea>
        <button id="irb-send" aria-label="Send">${ICON_SEND}</button>
      </div>`;

    document.body.appendChild(fab);
    document.body.appendChild(panel);
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let panelOpen = false;
  let botMode   = 'rules';
  let aiOk      = false;
  let history   = [];   // [{role,content}] for AI mode
  let thinking  = false;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function msgsEl()  { return document.getElementById('irb-msgs'); }
  function chipsEl() { return document.getElementById('irb-chips'); }

  function scrollDown() {
    const el = msgsEl();
    if (el) el.scrollTop = el.scrollHeight;
  }

  function addMessage(html, role) {
    const msgs = msgsEl();
    const wrap = document.createElement('div');
    wrap.className = `irb-msg ${role}`;
    if (role === 'bot') {
      wrap.innerHTML = `<div class="irb-msg-avatar">${ICON_BOT}</div><div class="irb-bubble">${formatText(html)}</div>`;
    } else {
      wrap.innerHTML = `<div class="irb-bubble">${escHtml(html)}</div>`;
    }
    msgs.appendChild(wrap);
    scrollDown();
    return wrap;
  }

  function showTyping() {
    const msgs = msgsEl();
    const el = document.createElement('div');
    el.className = 'irb-msg bot';
    el.id = 'irb-typing';
    el.innerHTML = `<div class="irb-msg-avatar">${ICON_BOT}</div><div class="irb-bubble irb-typing"><span></span><span></span><span></span></div>`;
    msgs.appendChild(el);
    scrollDown();
  }

  function removeTyping() {
    const el = document.getElementById('irb-typing');
    if (el) el.remove();
  }

  function showChips(chips) {
    const el = chipsEl();
    el.innerHTML = chips.map(c =>
      `<button class="irb-chip" data-q="${escAttr(c)}">${escHtml(c)}</button>`
    ).join('');
  }

  function formatText(text) {
    return text
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function escAttr(s) {
    return String(s).replace(/"/g,'&quot;');
  }

  // ── Bot config (fetch mode from server) ──────────────────────────────────
  async function loadBotConfig() {
    try {
      const r = await fetch('/api/bot-config', { cache: 'no-store' });
      if (r.ok) {
        const d = await r.json();
        botMode = d.mode || 'rules';
        aiOk    = !!d.aiAvailable;
        const badge = document.getElementById('irb-mode-badge');
        if (badge) {
          badge.textContent = botMode === 'ai' ? 'AI' : 'Rules';
          badge.className   = `irb-mode-badge ${botMode === 'ai' ? 'ai' : 'rules'}`;
        }
      }
    } catch (_) {}
  }

  // ── Rule engine ───────────────────────────────────────────────────────────
  function ruleResponse(text) {
    const rule = findRule(text);
    if (rule) return { text: rule.r, chips: rule.f || [] };
    return { text: FALLBACK.r, chips: FALLBACK.f };
  }

  // ── AI mode ───────────────────────────────────────────────────────────────
  async function aiResponse(text) {
    history.push({ role: 'user', content: text });
    if (history.length > 10) history = history.slice(-10);

    const r = await fetch('/api/chat', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messages: history })
    });

    if (!r.ok) throw new Error('AI unavailable');
    const d = await r.json();
    const reply = d.reply || '';
    history.push({ role: 'assistant', content: reply });
    return { text: reply, chips: d.suggestions || [] };
  }

  // ── Handle a user message ─────────────────────────────────────────────────
  async function handleMessage(text) {
    if (!text.trim() || thinking) return;
    thinking = true;

    const input = document.getElementById('irb-input');
    if (input) { input.value = ''; input.style.height = 'auto'; }
    showChips([]);
    addMessage(text, 'user');
    showTyping();

    let resp;
    try {
      if (botMode === 'ai' && aiOk) {
        resp = await aiResponse(text);
      } else {
        await new Promise(r => setTimeout(r, 420));
        resp = ruleResponse(text);
      }
    } catch (_) {
      resp = ruleResponse(text);
    }

    removeTyping();
    addMessage(resp.text, 'bot');
    if (resp.chips && resp.chips.length) showChips(resp.chips);
    thinking = false;
  }

  // ── Welcome message ───────────────────────────────────────────────────────
  function showWelcome() {
    setTimeout(() => {
      addMessage("Hi! I'm the iRam Help Bot. I can help you log IT tickets, find HR contacts, answer policy questions, and more. What do you need?", 'bot');
      showChips(['Log an IT ticket','Track my ticket','HR contacts','Leave & time off','SimplePay help']);
    }, 250);
  }

  // ── Event bindings ────────────────────────────────────────────────────────
  function bindEvents() {
    const fab   = document.getElementById('irb-fab');
    const panel = document.getElementById('irb-panel');
    const close = document.getElementById('irb-close');
    const input = document.getElementById('irb-input');
    const send  = document.getElementById('irb-send');

    function openBot() {
      panelOpen = true;
      panel.classList.add('irb-open');
      fab.style.display = 'none';
      setTimeout(() => { if (input) input.focus(); }, 200);
    }
    function closeBot() {
      panelOpen = false;
      panel.classList.remove('irb-open');
      fab.style.display = 'flex';
    }

    fab.addEventListener('click', openBot);
    close.addEventListener('click', closeBot);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && panelOpen) closeBot();
    });

    send.addEventListener('click', () => handleMessage(input.value.trim()));

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleMessage(input.value.trim());
      }
    });

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 80) + 'px';
    });

    document.addEventListener('click', e => {
      if (e.target.classList.contains('irb-chip')) {
        handleMessage(e.target.dataset.q);
      }
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  async function init() {
    injectCSS();
    injectHTML();
    bindEvents();
    await loadBotConfig();
    showWelcome();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
