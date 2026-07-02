// Returns current help bot configuration.
// BOT_MODE env var: 'rules' (default) or 'ai'
// ANTHROPIC_API_KEY being set means AI is available.

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const mode        = process.env.BOT_MODE || 'rules';
  const aiAvailable = !!(process.env.ANTHROPIC_API_KEY);

  return res.status(200).json({
    mode:        aiAvailable && mode === 'ai' ? 'ai' : 'rules',
    aiAvailable,
    rawMode:     mode
  });
};
