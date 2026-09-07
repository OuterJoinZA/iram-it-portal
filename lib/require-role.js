// ──────────────────────────────────────────────────────────────────────────────
// Shared gate for /api/admin/* endpoints. Reads the session from the httpOnly
// iram_session cookie (browser sends it automatically, same-origin) — nothing
// in this repo authenticates admin calls with a custom header any more.
//
// Usage in a handler:
//   const user = requireRole(req, 'editHR');
//   if (!user) return res.status(401).json({ error: 'Unauthorized' });
// ──────────────────────────────────────────────────────────────────────────────
const { verifyToken, sessionTokenFromRequest } = require('./auth');
const { hasPermission } = require('./roles');

function requireRole(req, permission) {
  const user = verifyToken(sessionTokenFromRequest(req));
  if (!user) return null;
  if (permission && !hasPermission(user.role, permission)) return null;
  return user;
}

module.exports = { requireRole };
