// ──────────────────────────────────────────────────────────────────────────────
// iRam IT Portal — Central Configuration
// Fill in EVERY value marked ← before going live
// ──────────────────────────────────────────────────────────────────────────────

const IRAM_CONFIG = {

  // ── Submission endpoint ───────────────────────────────────────────────────
  // Routes through Vercel API function (Power Automate URL is stored server-side)
  submitWebhookUrl: '/api/submit-ticket',

  // NOTE: The admin panel no longer calls Power Automate directly. The flow URLs
  // now live in Vercel environment variables (server-side, never shipped to the
  // browser) and are proxied through /api/admin/* and /api/track:
  //   PA_GET_TICKETS_URL    → list all tickets        (→ /api/admin/tickets)
  //   PA_UPDATE_TICKET_URL  → update a ticket          (→ /api/admin/update-ticket)
  //   PA_TRACK_TICKET_URL   → get one ticket by number (→ /api/track)
  // Replies to submitters are sent via Resend (→ /api/admin/reply), not a flow.

  // ── WhatsApp ─────────────────────────────────────────────────────────────
  // Your IT support WhatsApp Business number (country code, no + or spaces)
  whatsappNumber:   '27000000000',                                      // ←

  // ── Admin Panel ──────────────────────────────────────────────────────────
  // Fallback admin password, used ONLY if the ADMIN_PASSWORD env var is not set.
  // For real security set ADMIN_PASSWORD in Vercel (verified server-side) and
  // remove this value — anything here is visible in the browser via View Source.
  adminPassword:    'iRamIT2024!',                                      // ←

  // IT staff who can be assigned to a ticket.
  // `role` groups them (Dev / Ops / Support / etc.) and is shown to the submitter
  // on the public tracking page so they can see who is working on their ticket.
  // The label that appears everywhere is "Name · Role" (e.g. "Sean · Support").
  itStaff: [
    { name: 'Sean',  role: 'Support' },        // ← edit / add real people
    { name: 'Carl',  role: 'Dev' },
    { name: 'Mark',  role: 'Ops' },
    // { name: 'Jane', role: 'Support' },
  ],

  // ── Company Info ─────────────────────────────────────────────────────────
  companyName:      'iRam',
  supportEmail:     'it-support@iram.co.za',                           // ←

};
