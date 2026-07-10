// ──────────────────────────────────────────────────────────────────────────────
// iRam IT Portal — Estimated time-to-fix
//
// Every ticket used to be booked as a generic 1-hour slot, so a 10-minute
// password reset and a 4-hour laptop build took the same space on a calendar.
// This estimates a realistic duration: a base per category, then adjusted by
// what the person actually wrote ("set up new laptop" → long, "reset my
// password" → short). A long-job match always wins over a quick-job match.
//
// Loaded in the browser (window.IRAM_DURATION) and required by the serverless
// functions, so the estimate the submitter sees matches what gets booked.
// ──────────────────────────────────────────────────────────────────────────────
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IRAM_DURATION = api;
})(typeof self !== 'undefined' ? self : this, function () {

  // Sensible default per category, used when nothing in the description stands out.
  const CATEGORY_BASE_MINUTES = {
    'Access / Passwords / Permissions': 15,
    'Email / Outlook / Teams':          30,
    'Software / Application':           45,
    'Hardware - Printer / Scanner':     45,
    'Hardware - Phone / Mobile Device': 45,
    'Network / Internet / VPN':         60,
    'Hardware - PC / Laptop / Desktop': 90,
    'Other':                            30
  };

  // Big jobs. If any of these appear, the largest match wins — better to
  // over-book the calendar than to have a 4-hour build overrun a 1-hour slot.
  const LONG_JOB_RULES = [
    { minutes: 240, terms: [
      'new laptop', 'laptop setup', 'set up laptop', 'setting up laptop', 'setup laptop',
      'new pc', 'new machine', 'new computer', 'new desktop',
      'new starter', 'new employee', 'onboard', 'onboarding',
      'rebuild', 'reimage', 're-image', 'fresh install', 'format and reinstall'
    ] },
    { minutes: 120, terms: [
      'replace hard drive', 'replace ssd', 'upgrade ram', 'upgrade memory',
      'data migration', 'migrate data', 'transfer data', 'transfer files',
      'backup and restore', 'restore backup', 'install windows', 'operating system',
      'motherboard', 'screen replacement', 'replace screen'
    ] },
    { minutes: 90, terms: [
      'install printer', 'printer install', 'set up printer',
      'network drive', 'map drive', 'server', 'domain', 'group policy',
      'vpn setup', 'configure vpn', 'set up vpn'
    ] }
  ];

  // Quick jobs. Only applied when no long-job term matched. Smallest match wins.
  const QUICK_JOB_RULES = [
    { minutes: 10, terms: [
      'password reset', 'reset password', 'reset my password', 'forgot password',
      'change password', 'change my password', 'new password',
      'unlock account', 'unlock my account', 'account locked', 'locked out'
    ] },
    { minutes: 15, terms: [
      'email signature', 'add signature', 'update signature',
      'add to group', 'distribution list', 'access to folder', 'folder access',
      'rename', 'permission'
    ] }
  ];

  // Must match the bounds portal-config.js validates admin input against, or an
  // admin-set 5-minute rule would silently be rounded up to the floor.
  const MIN_MINUTES = 5;
  const MAX_MINUTES = 480; // one working day — anything bigger is a project, not a ticket

  function matched(rules, text) {
    return rules
      .filter(r => r.terms.some(t => text.includes(t)))
      .map(r => r.minutes);
  }

  // Round up to the nearest 5 minutes so calendar slots stay tidy.
  function roundSlot(m) {
    const r = Math.ceil(m / 5) * 5;
    return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, r));
  }

  /**
   * Estimate how long a ticket will take, in minutes.
   * @param {string} category    an issue category name
   * @param {string} description free text the submitter wrote
   * @param {object} [cfg]       admin-editable overrides from /api/config:
   *                             { categories:[{name,baseMinutes}], durationRules:{long,quick} }
   *                             Falls back to the built-in defaults when absent.
   * @returns {number} minutes
   */
  function estimateMinutes(category, description, cfg) {
    const text = String(description || '').toLowerCase();

    const baseMap = (cfg && Array.isArray(cfg.categories) && cfg.categories.length)
      ? cfg.categories.reduce((m, c) => (m[c.name] = c.baseMinutes, m), {})
      : CATEGORY_BASE_MINUTES;

    const rules      = (cfg && cfg.durationRules) || {};
    const longRules  = Array.isArray(rules.long)  && rules.long.length  ? rules.long  : LONG_JOB_RULES;
    const quickRules = Array.isArray(rules.quick) && rules.quick.length ? rules.quick : QUICK_JOB_RULES;

    const long = matched(longRules, text);
    if (long.length) return roundSlot(Math.max(...long));

    const quick = matched(quickRules, text);
    if (quick.length) return roundSlot(Math.min(...quick));

    return roundSlot(baseMap[category] ?? 30);
  }

  /** "10 min" · "1 hr" · "1 hr 30 min" · "4 hrs" */
  function formatDuration(minutes) {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    if (m < 60) return `${m} min`;
    const hrs  = Math.floor(m / 60);
    const rest = m % 60;
    const h    = `${hrs} ${hrs === 1 ? 'hr' : 'hrs'}`;
    return rest ? `${h} ${rest} min` : h;
  }

  return { estimateMinutes, formatDuration, CATEGORY_BASE_MINUTES, MIN_MINUTES, MAX_MINUTES };
});
