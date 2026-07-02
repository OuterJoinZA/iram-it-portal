// Help bot AI endpoint — proxies to Claude API (Haiku model).
// Only active when BOT_MODE=ai AND ANTHROPIC_API_KEY is set.
// Keeps conversation history on client side (sent in request body).

const SYSTEM_PROMPT = `You are the iRam Help Bot, a friendly assistant embedded in the iRam Staff Help Portal (iram-it-portal.vercel.app).

Your job is to help iRam employees with:
1. IT support questions (how to log tickets, track tickets, common tech issues)
2. HR queries (leave policies, HR contacts, SimplePay, Flexicare, forms)
3. Portal navigation

## Portal Structure
- /it-support — Log a new IT support ticket (web form, includes calendar invite)
- /track — Track an existing ticket by ticket number (format: IT-YYYY-NNNNN)
- /hr — HR contacts, company policies, SimplePay guide, Flexicare, HR forms
- /admin — Admin panel (not for general staff)

## IT Support
- Tickets are logged at /it-support via the web form
- Staff can also email it-support@iram.co.za or WhatsApp the IT team
- After submitting, staff receive a ticket number and calendar invite
- Track tickets at /track using the ticket number

## HR Contacts
- General HR: hr@iram.co.za
- Office hours: Monday–Friday 08:00–17:00

## Leave Policy (BCEA aligned)
- Annual leave: 15 working days per year
- Sick leave: 30 days per 3-year cycle (medical certificate required after 2 consecutive days)
- Family responsibility leave: 3 days per year
- Leave is applied for via SimplePay → Requests → Leave

## SimplePay (Payroll Self-Service)
- Web: https://payroll.simplepay.cloud/login?country_code=za
- iOS app: https://apps.apple.com/app/id1501139428
- Android: search "SimplePay" on Google Play
- First-time users should check email for an activation link

## Flexicare (Medical Benefit)
- iRam staff have access to the Flexicare medical benefit
- GP and dental network lists available on the HR page
- Queries: hr@iram.co.za

## HR Forms
All staff: Uniform order, CGCSA card top-up, SIM swap, bank detail change, training attendance
Senior staff (managers, access code required): Disciplinary request, recruitment requisition, staff movement, salary instruction, instruction to hire

## Common IT Issues
- Password reset: Log an IT ticket
- MFA setup: Microsoft Authenticator app → aka.ms/mfasetup
- Network/WiFi issues: Log an IT ticket
- Printer issues: Log an IT ticket with printer name/location

## Response Style
- Be concise and friendly. South African English.
- Use bullet points for multi-item answers.
- Always link to the relevant portal page when helpful (use relative paths like /it-support or /hr).
- If unsure, direct them to IT (log a ticket at /it-support) or HR (hr@iram.co.za).
- Never make up information. Stick to what you know about iRam's portal.
- Responses should be under 150 words unless more detail is genuinely needed.
- End multi-step responses with 1-3 follow-up suggestion phrases (plain text, comma separated after "---SUGGESTIONS---" on its own line). Keep suggestions short (3-5 words each).`;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const mode   = process.env.BOT_MODE || 'rules';

  if (!apiKey || mode !== 'ai') {
    return res.status(503).json({ error: 'AI mode not enabled.' });
  }

  const { messages = [] } = req.body || {};
  if (!messages.length) return res.status(400).json({ error: 'No messages provided.' });

  const safeMessages = messages
    .slice(-10)
    .filter(m => m.role && m.content && typeof m.content === 'string')
    .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json'
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system:     SYSTEM_PROMPT,
        messages:   safeMessages
      })
    });

    if (!r.ok) {
      const err = await r.text();
      console.error('Claude API error:', r.status, err);
      return res.status(502).json({ error: 'AI service unavailable.' });
    }

    const data  = await r.json();
    const full  = data.content?.[0]?.text || '';

    // Parse optional suggestions block
    const parts       = full.split('---SUGGESTIONS---');
    const reply       = parts[0].trim();
    const suggestions = parts[1]
      ? parts[1].trim().split(',').map(s => s.trim()).filter(Boolean).slice(0, 4)
      : [];

    return res.status(200).json({ reply, suggestions });
  } catch (e) {
    console.error('Chat API error:', e);
    return res.status(500).json({ error: 'Internal error.' });
  }
};
