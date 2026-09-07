// ──────────────────────────────────────────────────────────────────────────────
// Thin Resend wrapper. Same call already duplicated in change-password.js and
// change-manager-code.js — pulled out here for the credential emails in
// api/admin/users.js so that's not a third copy.
// ──────────────────────────────────────────────────────────────────────────────
async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ from: 'iRam IT Support <noreply@outerjoin.co.za>', to: [to], subject, html })
    });
    return r.ok;
  } catch (_) { return false; }
}

module.exports = { sendEmail };
