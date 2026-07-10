// Public portal configuration: issue categories, their durations, and the Smart
// Priority keyword lists. Used by the ticket form so admins can add categories
// or tune keywords without a redeploy. Staff email addresses are never included.
const { load, publicView } = require('../lib/portal-config.js');
const blob                 = require('../lib/blob.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { config, source } = await load();
  // `source` stays "defaults" until the first save, so surface whether the Blob
  // token is present — otherwise there's no way to tell a missing store apart
  // from a store that simply hasn't been written to yet.
  return res.status(200).json(Object.assign(publicView(config), {
    source,
    storageReady: blob.isConfigured()
  }));
};
