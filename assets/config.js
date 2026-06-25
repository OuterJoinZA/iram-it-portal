// ──────────────────────────────────────────────────────────────────────────────
// iRam IT Portal — Central Configuration
// Fill in EVERY value marked ← before going live
// ──────────────────────────────────────────────────────────────────────────────

const IRAM_CONFIG = {

  // ── Submission endpoint ───────────────────────────────────────────────────
  // Routes through Vercel API function (Power Automate URL is stored server-side)
  submitWebhookUrl: '/api/submit-ticket',

  // Vercel API proxies — PA URLs are stored as Vercel env vars (not exposed to browser)
  getTicketsUrl:    '/api/get-tickets',
  updateTicketUrl:  '/api/update-ticket',
  sendReplyUrl:     '/api/send-reply',

  // ── WhatsApp ─────────────────────────────────────────────────────────────
  // Your IT support WhatsApp Business number (country code, no + or spaces)
  whatsappNumber:   '27000000000',                                      // ←

  // ── Admin Panel ──────────────────────────────────────────────────────────
  // Simple password for the IT admin panel (change this!)
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
