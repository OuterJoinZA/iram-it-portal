// ──────────────────────────────────────────────────────────────────────────────
// Editable portal configuration.
//
// Everything here used to be hard-coded across assets/config.js, assets/script.js
// and assets/duration.js. It now lives in a single JSON blob so admins can edit
// IT staff (and their calendar emails), issue categories (and how long each takes),
// and the Smart Priority keyword lists — without a redeploy.
//
// DEFAULTS below reproduce the previous hard-coded behaviour exactly, so the
// portal works identically before anything has ever been saved, and keeps working
// if Blob storage is unavailable.
// ──────────────────────────────────────────────────────────────────────────────
const blob = require('./blob.js');

const CONFIG_PATH = 'portal/config.json';

const DEFAULTS = {
  // `email` is the mailbox whose calendar an assigned ticket gets booked into.
  // `isIT` / `isPerigee` mark someone as eligible for that pool: they receive
  // new-ticket notification emails, and rotate into the "assigned to" slot
  // round-robin with everyone else checked in the same pool (see lib/rotation.js).
  itStaff: [
    { name: 'Mark', role: 'Lead Dev', email: '', isIT: false, isPerigee: false },
    { name: 'Sean', role: 'Vibe Dev', email: '', isIT: false, isPerigee: false },
    { name: 'Carl', role: 'Vibe Dev', email: '', isIT: false, isPerigee: false }
  ],

  // baseMinutes  → default time-to-fix when no keyword stands out
  // priorityScore → starting score for the Smart Priority engine
  categories: [
    { name: 'Hardware - PC / Laptop / Desktop', baseMinutes: 90, priorityScore: 35 },
    { name: 'Hardware - Phone / Mobile Device', baseMinutes: 45, priorityScore: 20 },
    { name: 'Hardware - Printer / Scanner',     baseMinutes: 45, priorityScore: 15 },
    { name: 'Network / Internet / VPN',         baseMinutes: 60, priorityScore: 45 },
    { name: 'Access / Passwords / Permissions', baseMinutes: 15, priorityScore: 35 },
    { name: 'Software / Application',           baseMinutes: 45, priorityScore: 25 },
    { name: 'Email / Outlook / Teams',          baseMinutes: 30, priorityScore: 30 },
    { name: 'Other',                            baseMinutes: 30, priorityScore: 10 }
  ],

  // Long-job terms win over quick-job terms. Largest long match / smallest quick match.
  durationRules: {
    long: [
      { minutes: 240, terms: ['new laptop','laptop setup','set up laptop','setting up laptop','setup laptop','new pc','new machine','new computer','new desktop','new starter','new employee','onboard','onboarding','rebuild','reimage','re-image','fresh install','format and reinstall'] },
      { minutes: 120, terms: ['replace hard drive','replace ssd','upgrade ram','upgrade memory','data migration','migrate data','transfer data','transfer files','backup and restore','restore backup','install windows','operating system','motherboard','screen replacement','replace screen'] },
      { minutes:  90, terms: ['install printer','printer install','set up printer','network drive','map drive','server','domain','group policy','vpn setup','configure vpn','set up vpn'] }
    ],
    quick: [
      { minutes: 10, terms: ['password reset','reset password','reset my password','forgot password','change password','change my password','new password','unlock account','unlock my account','account locked','locked out'] },
      { minutes: 15, terms: ['email signature','add signature','update signature','add to group','distribution list','access to folder','folder access','rename','permission'] }
    ]
  },

  // Smart Priority: each matched term adds its band's weight to the category score.
  priorityRules: {
    critical: { weight:  60, terms: [
      'smoke','smoking','burning smell','burning','sparking','sparks flying','electrical fire','flames','explosion','gas leak','gas smell',
      'fire','fire department','evacuate','evacuation','building evacuation','injury','injured','medical emergency','ambulance','police',
      'ceo','md ','managing director','chairman','chairperson','director general','executive','owner','business owner','founder','president',
      'cfo','coo','cto','chief executive','chief financial officer','chief operating officer',
      'data loss','data breach','data leak','data exposed','leaked data','ransomware','ransom','hacked','hack','hacker','malware',
      'virus outbreak','encrypted files','files encrypted','cyber attack','cyberattack','phishing attack','compromised account','compromised',
      'security breach','breach','unauthorized access','intruder',
      'server down','database down','database crashed','production down','production server down','critical system down','mission critical',
      'complete outage','total network failure','total system failure','network completely down','all systems down',
      'all users','entire office','entire company','everyone is down','whole company down','whole office down','nobody can work',
      'no power','power outage','power failure','blackout','no electricity',
      'flooding','flood','flooded','water damage','leak in server room','server room flooding','burst pipe',
      'emergency','life safety'
    ] },
    high: { weight: 25, terms: [
      'ops','cam ','client-facing','cannot work',"can't work",'unable to work','stopped working',
      'locked out','cannot access',"can't access",'cannot log in',"can't log in",'unable to log in',
      'urgent','asap','as soon as possible','right away','immediately','time sensitive','time-sensitive','high priority','business critical',
      'director','manager','senior manager','head of department','team lead','supervisor',
      'not working','broken','crash','crashed','system crashed','app crashed','application crashed','keeps crashing',
      'blue screen','bsod','blue screen of death','frozen','freezing','freezes','hangs','hanging','unresponsive','not responding','keeps freezing',
      'error message','critical error','fatal error',
      'wont boot',"won't boot",'wont start',"won't start",'wont turn on',"won't turn on",'computer dead','pc dead','laptop dead',
      'no internet','no wifi','wifi down','internet down','network down','no connection','connection lost','connection dropped',
      'vpn down','vpn not working','cant connect',"can't connect",'unable to connect',
      'down','sales','account manager','operations',
      'client meeting','important meeting','meeting in','meeting starts','presentation','big client','important client','key client','vip client',
      'deadline','deadline today','due today',
      'smoke from','sparks',
      'affecting multiple users','multiple people affected','whole team affected','department down','floor down','branch down','office down',
      'phones down','phone system down','email down','outlook down','cannot send email',"can't send email",'cannot receive email',"can't receive email",
      'printer down for whole office','payroll','invoicing','billing system','point of sale','pos down','till down'
    ] },
    low: { weight: -35, terms: [
      'signature','email signature','wallpaper','screensaver','cosmetic','minor cosmetic','scratch','dent','appearance',
      'color scheme','theme','background image','desktop background','icon','font size',
      'nice to have','when you get a chance','whenever you have time','whenever possible','no hurry','no rush','when free',
      'low priority','minor issue','small issue','small thing','not important','not critical','not a big deal','no big deal',
      'preference','display preference','personal preference',
      'question about','wondering if','just asking','just curious','curious about','would like to know','quick question','general question',
      'how do i','how to','training question','how-to question','tutorial','guidance','advice','recommendation',
      'feature request','suggestion','idea','improvement','enhancement','update when convenient',
      'not urgent','sometime this week','sometime next week','no specific deadline','not time sensitive'
    ] }
  }
};

const str      = v => String(v == null ? '' : v).trim();
const clampInt = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const terms = v => (Array.isArray(v) ? v : [])
  .map(t => str(t).toLowerCase())
  .filter(Boolean)
  .filter((t, i, a) => a.indexOf(t) === i); // de-dupe

/** Coerce anything an admin submits into a safe, well-shaped config. */
function sanitizeForSave(input) {
  const c = input && typeof input === 'object' ? input : {};

  const itStaff = (Array.isArray(c.itStaff) ? c.itStaff : [])
    .map(s => ({
      name:  str(s.name),
      role:  str(s.role),
      email: str(s.email).toLowerCase(),
      isIT:      !!s.isIT,
      isPerigee: !!s.isPerigee
    }))
    .filter(s => s.name);

  const categories = (Array.isArray(c.categories) ? c.categories : [])
    .map(x => ({
      name:          str(x.name),
      baseMinutes:   clampInt(x.baseMinutes, 5, 480, 30),
      priorityScore: clampInt(x.priorityScore, 0, 100, 10)
    }))
    .filter(x => x.name);

  const band = (b, dfltWeight) => ({
    weight: clampInt(b && b.weight, -100, 100, dfltWeight),
    terms:  terms(b && b.terms)
  });

  const rules = (arr, dflt) => (Array.isArray(arr) ? arr : dflt)
    .map(r => ({ minutes: clampInt(r.minutes, 5, 480, 30), terms: terms(r.terms) }))
    .filter(r => r.terms.length);

  return {
    itStaff:    itStaff.length    ? itStaff    : DEFAULTS.itStaff,
    categories: categories.length ? categories : DEFAULTS.categories,
    durationRules: {
      long:  rules(c.durationRules && c.durationRules.long,  DEFAULTS.durationRules.long),
      quick: rules(c.durationRules && c.durationRules.quick, DEFAULTS.durationRules.quick)
    },
    priorityRules: {
      critical: band(c.priorityRules && c.priorityRules.critical,  60),
      high:     band(c.priorityRules && c.priorityRules.high,      25),
      low:      band(c.priorityRules && c.priorityRules.low,      -35)
    }
  };
}

/** Full config for admins. Falls back to DEFAULTS if Blob is unset or unreadable. */
async function load() {
  if (!blob.isConfigured()) return { config: DEFAULTS, source: 'defaults' };
  try {
    const saved = await blob.getJson(CONFIG_PATH);
    if (!saved) return { config: DEFAULTS, source: 'defaults' };
    return { config: sanitizeForSave(saved), source: 'blob' };
  } catch (err) {
    console.error('portal-config load failed:', err.message);
    return { config: DEFAULTS, source: 'defaults' };
  }
}

async function save(input) {
  const config = sanitizeForSave(input);
  await blob.putJson(CONFIG_PATH, config);
  return config;
}

/** Public view — never expose staff email addresses to the browser. */
function publicView(config) {
  return {
    itStaff:       config.itStaff.map(({ name, role }) => ({ name, role })),
    categories:    config.categories,
    durationRules: config.durationRules,
    priorityRules: config.priorityRules
  };
}

module.exports = { DEFAULTS, CONFIG_PATH, load, save, publicView, sanitizeForSave };
