// ──────────────────────────────────────────────────────────────────────────────
// iRam IT Portal — Central Configuration
// Fill in EVERY value marked ← before going live
// ──────────────────────────────────────────────────────────────────────────────

const IRAM_CONFIG = {

  // ── Power Automate Webhook URLs ──────────────────────────────────────────
  // Flow A (HTTP trigger) — handles Web Form + WhatsApp submissions
  submitWebhookUrl: 'PASTE_FLOW_A_HTTP_TRIGGER_URL_HERE',              // ←

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
