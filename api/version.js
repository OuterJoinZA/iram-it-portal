// Returns the current deploy version so clients can detect when a new deploy is live.
// VERCEL_GIT_COMMIT_SHA changes on every deploy — perfect as a version signal.

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  const v = process.env.MAINTENANCE_MODE || '';
  return res.status(200).json({
    version:     process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || 'local',
    maintenance: v === '1' || v.toLowerCase() === 'true'
  });
};
