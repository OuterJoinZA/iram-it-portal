// ──────────────────────────────────────────────────────────────────────────────
// Shared gate for /api/admin/* endpoints. Replaces the old copy-pasted
// isAuthed(req) that compared x-admin-key to a single shared ADMIN_PASSWORD.
//
// Usage in a handler:
//   const user = requireRole(req, 'editHR');
//   if (!user) return res.status(401).json({ error: 'Unauthorized' });
// ──────────────────────────────────────────────────────────────────────────────
const { verifyToken } = require('./auth');
const { hasPermission } = require('./roles');

function requireRole(req, permission) {
  const token = req.headers['x-admin-key'] || '';
  const user = verifyToken(token);
  if (!user) return null;
  if (permission && !hasPermission(user.role, permission)) return null;
  return user;
}

module.exports = { requireRole };
