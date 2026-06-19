// ──────────────────────────────────────────────────────────────────────────────
// iRam IT Portal — Central Configuration
// Fill in EVERY value marked ← before going live
// ──────────────────────────────────────────────────────────────────────────────

const IRAM_CONFIG = {

  // ── Power Automate Webhook URLs ──────────────────────────────────────────
  // Flow A (HTTP trigger) — handles Web Form + WhatsApp submissions
  submitWebhookUrl: 'https://default43b73814430045128c6dd739063315.61.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/1f1596a5ee60487490f9ed1dcd289e63/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=ScVKY9YGtZsErH8ufXPrtLfyi9NN1I8keOOCctzTisI',

  // Flow C (HTTP trigger) — GET tickets for admin panel
  // Returns: { value: [ { id, TicketID, Status, Priority, ... }, ... ] }
  getTicketsUrl:    'PASTE_FLOW_C_GET_TICKETS_URL_HERE',               // ←

  // Flow D (HTTP trigger) — UPDATE a single ticket
  // Body: { id, Status, Priority, AssignedTo, Notes }
  updateTicketUrl:  'PASTE_FLOW_D_UPDATE_TICKET_URL_HERE',             // ←

  // Flow E (HTTP trigger) — SEND REPLY email to submitter
  // Body: { submitterEmail, submitterName, ticketID, replyMessage, agentName }
  sendReplyUrl:     'PASTE_FLOW_E_SEND_REPLY_URL_HERE',                // ←

  // ── WhatsApp ─────────────────────────────────────────────────────────────
  // Your IT support WhatsApp Business number (country code, no + or spaces)
  whatsappNumber:   '27000000000',                                      // ←

  // ── Admin Panel ──────────────────────────────────────────────────────────
  // Simple password for the IT admin panel (change this!)
  adminPassword:    'iRamIT2024!',                                      // ←

  // Names of IT staff members (shown in "Assign To" dropdown)
  itStaff: [
    'IT Support',
    // 'Sato Gilles',      // ← add real names
    // 'John Smith',
  ],

  // ── Company Info ─────────────────────────────────────────────────────────
  companyName:      'iRam',
  supportEmail:     'it-support@iram.co.za',                           // ←

};
