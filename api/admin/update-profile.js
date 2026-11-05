// ──────────────────────────────────────────────────────────────────────────────
// My Account → "My details". POST { fullName, phone, email, currentPassword }.
// Anyone signed in with a named account can edit their own name and phone.
// Changing the email needs the current password, because login codes (2FA)
// are sent there — otherwise a borrowed, unlocked session could redirect them.
// ──────────────────────────────────────────────────────────────────────────────
const { verifyToken, sessionTokenFromRequest } = require('../../lib/auth');
const { isPreviewWrite } = require('../../lib/require-role');
const { getUser, updateProfile, verifyPasswordHash } = require('../../lib/users');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const session = verifyToken(sessionTokenFromRequest(req));
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  if (isPreviewWrite(req, session)) return res.status(403).json({ error: 'preview_read_only', message: 'Preview mode is read-only — exit preview to make changes.' });

  const record = await getUser(session.username);
  if (!record) return res.status(400).json({ error: 'The shared break-glass login has no profile to edit.' });

  const { fullName, phone, email, currentPassword } = req.body || {};
  const changes = {};
  if (fullName !== undefined) changes.fullName = fullName;
  if (phone !== undefined) changes.phone = phone;

  const newEmail = String(email || '').trim().toLowerCase();
  if (newEmail && newEmail !== (record.email || '').toLowerCase()) {
    if (!currentPassword || !verifyPasswordHash(currentPassword, record.salt, record.passwordHash)) {
      return res.status(400).json({ error: 'Enter your current password to change your email address.' });
    }
    changes.email = newEmail;
  }

  try {
    const user = await updateProfile(record.username, changes);
    return res.status(200).json({ ok: true, user });
  } catch (err) {
    return res.status(400).json({ error: err.message || 'Could not save your details.' });
  }
};
