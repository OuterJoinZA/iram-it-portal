module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const { submitterEmail, submitterName, ticketID, replyMessage, agentName } = body;

  if (!submitterEmail || !replyMessage) {
    return res.status(400).json({ error: 'submitterEmail and replyMessage are required' });
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        from:    'iRam IT Support <noreply@outerjoin.co.za>',
        to:      [submitterEmail],
        subject: `RE: IT Ticket ${ticketID} — Update from IT Support`,
        html:    replyHtml({ submitterName, ticketID, replyMessage, agentName })
      })
    });
    if (!r.ok) throw new Error(await r.text());
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('send-reply error:', err.message);
    return res.status(502).json({ error: err.message });
  }
};

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function replyHtml({ submitterName, ticketID, replyMessage, agentName }) {
  const lines = esc(replyMessage).replace(/\n/g, '<br>');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Segoe UI,Arial,sans-serif;background:#f4f6f8">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">

  <tr><td style="background:#2D2D2D;padding:28px 32px;text-align:center">
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px">iRam IT Support</p>
    <p style="margin:8px 0 0;color:#6BBF4E;font-size:12px;text-transform:uppercase;letter-spacing:1.5px">Ticket Update</p>
  </td></tr>

  <tr><td style="background:#edf7e8;padding:16px 32px;text-align:center;border-bottom:2px solid #6BBF4E">
    <p style="margin:0;color:#555;font-size:12px;text-transform:uppercase;letter-spacing:1px">Ticket Number</p>
    <p style="margin:4px 0 0;font-size:26px;font-weight:700;color:#4e9938;letter-spacing:2px">${esc(ticketID)}</p>
  </td></tr>

  <tr><td style="padding:28px 32px">
    <p style="margin:0 0 16px;font-size:15px;color:#333">Hi <strong>${esc(submitterName || 'there')}</strong>,</p>
    <p style="margin:0 0 20px;font-size:14px;color:#555;line-height:1.7">You have a new update from the IT team regarding your support ticket:</p>
    <div style="background:#f9f9f9;border-left:4px solid #6BBF4E;border-radius:4px;padding:16px 20px;font-size:14px;color:#333;line-height:1.8">${lines}</div>
    <p style="margin:24px 0 0;font-size:13px;color:#888">— ${esc(agentName || 'iRam IT Support')}</p>
  </td></tr>

  <tr><td style="background:#f4f6f8;padding:18px 32px;text-align:center;border-top:1px solid #e8e8e8">
    <p style="margin:0;color:#aaa;font-size:11px">iRam IT Support Portal &nbsp;|&nbsp; Please do not reply to this email</p>
  </td></tr>

</table></td></tr></table>
</body></html>`;
}
