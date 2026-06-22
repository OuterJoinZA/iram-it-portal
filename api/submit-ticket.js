module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};

  // Generate unique ticket ID
  const year     = new Date().getFullYear();
  const uniqueID = String(Math.floor(Math.random() * 90000) + 10000);
  const ticketID = `IT-${year}-${uniqueID}`;

  // Call Power Automate for SharePoint + Calendar (fire and forget — URL is hidden server-side)
  const paUrl = process.env.POWER_AUTOMATE_URL;
  if (paUrl) {
    fetch(paUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...body, ticketID })
    }).catch(() => {});
  }

  // Send emails via Resend
  try {
    await sendEmail({
      to:      body.submitterEmail,
      subject: `IT Ticket ${ticketID} Created — ${body.category}`,
      html:    submitterHtml({ ...body, ticketID })
    });

    if (body.managerEmail) {
      await sendEmail({
        to:      body.managerEmail,
        subject: `FYI: IT Ticket ${ticketID} logged for ${body.submitterName}`,
        html:    managerHtml({ ...body, ticketID })
      });
    }
  } catch (err) {
    console.error('Resend error:', err.message);
  }

  return res.status(200).json({ ticketID });
};

async function sendEmail({ to, subject, html }) {
  const r = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({
      from:    'iRam IT Support <onboarding@resend.dev>',
      to:      [to],
      subject,
      html
    })
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function submitterHtml({ submitterName, submitterEmail, category, location, suggestedPriority, description, ticketID, submittedAt }) {
  const submitted = submittedAt
    ? new Date(submittedAt).toLocaleString('en-ZA', { dateStyle:'medium', timeStyle:'short' })
    : new Date().toLocaleString('en-ZA', { dateStyle:'medium', timeStyle:'short' });

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Segoe UI,Arial,sans-serif;background:#f4f6f8">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">

  <tr><td style="background:#2D2D2D;padding:28px 32px;text-align:center">
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:0.5px">iRam IT Support</p>
    <p style="margin:8px 0 0;color:#6BBF4E;font-size:12px;text-transform:uppercase;letter-spacing:1.5px">Ticket Confirmation</p>
  </td></tr>

  <tr><td style="background:#edf7e8;padding:24px 32px;text-align:center;border-bottom:2px solid #6BBF4E">
    <p style="margin:0 0 6px;color:#555;font-size:12px;text-transform:uppercase;letter-spacing:1px">Your Ticket Number</p>
    <p style="margin:0;font-size:34px;font-weight:700;color:#4e9938;letter-spacing:3px">${esc(ticketID)}</p>
    <p style="margin:8px 0 0;color:#888;font-size:12px">Quote this number for all follow-up queries</p>
  </td></tr>

  <tr><td style="padding:28px 32px">
    <p style="margin:0 0 16px;font-size:15px;color:#333">Hi <strong>${esc(submitterName)}</strong>,</p>
    <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.7">Your IT support request has been logged. An IT technician will be in touch, and a calendar invite with your support appointment time will be sent to <strong>${esc(submitterEmail)}</strong>.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;font-size:13px">
      <tr><td style="background:#f9f9f9;padding:11px 16px;font-weight:600;color:#555;width:130px">Category</td>
          <td style="background:#f9f9f9;padding:11px 16px;color:#333">${esc(category)}</td></tr>
      <tr><td style="padding:11px 16px;font-weight:600;color:#555">Priority</td>
          <td style="padding:11px 16px;color:#333">${esc(suggestedPriority || 'Being assessed')}</td></tr>
      <tr><td style="background:#f9f9f9;padding:11px 16px;font-weight:600;color:#555">Location</td>
          <td style="background:#f9f9f9;padding:11px 16px;color:#333">${esc(location)}</td></tr>
      <tr><td style="padding:11px 16px;font-weight:600;color:#555">Description</td>
          <td style="padding:11px 16px;color:#333;line-height:1.6">${esc(description)}</td></tr>
      <tr><td style="background:#f9f9f9;padding:11px 16px;font-weight:600;color:#555">Submitted</td>
          <td style="background:#f9f9f9;padding:11px 16px;color:#333">${submitted}</td></tr>
    </table>
  </td></tr>

  <tr><td style="background:#f4f6f8;padding:18px 32px;text-align:center;border-top:1px solid #e8e8e8">
    <p style="margin:0;color:#aaa;font-size:11px">iRam IT Support Portal &nbsp;|&nbsp; Please do not reply to this email</p>
  </td></tr>

</table></td></tr></table>
</body></html>`;
}

function managerHtml({ submitterName, submitterEmail, managerName, category, location, suggestedPriority, description, ticketID }) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Segoe UI,Arial,sans-serif;background:#f4f6f8">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">

  <tr><td style="background:#2D2D2D;padding:28px 32px;text-align:center">
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700">iRam IT Support</p>
    <p style="margin:8px 0 0;color:#aaa;font-size:12px;text-transform:uppercase;letter-spacing:1.5px">Line Manager Notification</p>
  </td></tr>

  <tr><td style="padding:28px 32px">
    <p style="margin:0 0 16px;font-size:15px;color:#333">Hi <strong>${esc(managerName || 'Manager')}</strong>,</p>
    <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.7">A member of your team has logged an IT support ticket. This notification is for your information — no action is required from you.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;font-size:13px">
      <tr><td style="background:#edf7e8;padding:11px 16px;font-weight:600;color:#555;width:130px">Ticket</td>
          <td style="background:#edf7e8;padding:11px 16px;font-weight:700;color:#4e9938;font-size:15px">${esc(ticketID)}</td></tr>
      <tr><td style="padding:11px 16px;font-weight:600;color:#555">Staff Member</td>
          <td style="padding:11px 16px;color:#333">${esc(submitterName)} &lt;${esc(submitterEmail)}&gt;</td></tr>
      <tr><td style="background:#f9f9f9;padding:11px 16px;font-weight:600;color:#555">Category</td>
          <td style="background:#f9f9f9;padding:11px 16px;color:#333">${esc(category)}</td></tr>
      <tr><td style="padding:11px 16px;font-weight:600;color:#555">Priority</td>
          <td style="padding:11px 16px;color:#333">${esc(suggestedPriority || 'Being assessed')}</td></tr>
      <tr><td style="background:#f9f9f9;padding:11px 16px;font-weight:600;color:#555">Location</td>
          <td style="background:#f9f9f9;padding:11px 16px;color:#333">${esc(location)}</td></tr>
      <tr><td style="padding:11px 16px;font-weight:600;color:#555">Description</td>
          <td style="padding:11px 16px;color:#333;line-height:1.6">${esc(description)}</td></tr>
    </table>
  </td></tr>

  <tr><td style="background:#f4f6f8;padding:18px 32px;text-align:center;border-top:1px solid #e8e8e8">
    <p style="margin:0;color:#aaa;font-size:11px">iRam IT Support Portal &nbsp;|&nbsp; For information only</p>
  </td></tr>

</table></td></tr></table>
</body></html>`;
}
