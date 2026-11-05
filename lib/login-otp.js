// ──────────────────────────────────────────────────────────────────────────────
// Emails a one-time login code. Shared by login.js and force-change-password.js
// (a first-login password change must still pass 2FA before getting a session).
// ──────────────────────────────────────────────────────────────────────────────
const { issueLoginOtp } = require('./users');
const { sendEmail } = require('./mail');

async function sendLoginOtpEmail(user) {
  const code = await issueLoginOtp(user.username);
  return sendEmail(user.email, 'iRam IT Portal — Your login code', `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:480px;margin:0 auto">
      <p>Your iRam IT Portal login code is:</p>
      <p style="font-size:28px;font-weight:700;font-family:monospace;letter-spacing:3px">${code}</p>
      <p style="color:#888;font-size:12px">Expires in 10 minutes. If you didn't just try to log in, someone may know your password — change it from My Account.</p>
    </div>`);
}

/** Hide most of an address for the "we emailed a code to …" hint. */
function maskEmail(email) {
  const [u, d] = String(email || '').split('@');
  if (!u || !d) return '';
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(1, u.length - 2))}@${d}`;
}

module.exports = { sendLoginOtpEmail, maskEmail };
