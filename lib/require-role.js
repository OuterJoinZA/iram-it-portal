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

// "Preview as" sessions are read-only: anything but GET is refused, so a
// Super Admin previewing as HR can look but never act (e.g. log an
// "HR-verified" request) in someone else's name.
function isPreviewWrite(req, session) {
  return !!(session && session.preview) && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
}

function requireRole(req, permission) {
  const user = verifyToken(sessionTokenFromRequest(req));
  if (!user) return null;
  if (isPreviewWrite(req, user)) return null;
  if (permission && !hasPermission(user.role, permission)) return null;
  return user;
}

const PREVIEW_MESSAGE = "You're in preview mode, which is read-only. Click \"Exit preview\" at the top of the page (or log out and back in) to make changes.";

/** For handlers that got null from requireRole: was it because of preview?
 *  If so, sends a 403 with an explanation and returns true. */
function rejectIfPreview(req, res) {
  const session = verifyToken(sessionTokenFromRequest(req));
  if (!isPreviewWrite(req, session)) return false;
  res.status(403).json({ error: PREVIEW_MESSAGE, message: PREVIEW_MESSAGE });
  return true;
}

module.exports = { requireRole, isPreviewWrite, rejectIfPreview, PREVIEW_MESSAGE };
