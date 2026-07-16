const { estimateMinutes, formatDuration } = require('../assets/duration.js');
const { load: loadConfig }                = require('../lib/portal-config.js');
const blob                                = require('../lib/blob.js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Pull the (optional) inline error image off the payload — never forward the
  // multi-MB data URL to Power Automate or the emails.
  const { attachmentDataUrl, ...body } = req.body || {};

  // Generate unique ticket ID
  const year     = new Date().getFullYear();
  const uniqueID = String(Math.floor(Math.random() * 90000) + 10000);
  const ticketID = `IT-${year}-${uniqueID}`;

  // Work out how long this job actually needs. Computed here rather than trusting
  // the browser, so the calendar slot always matches what we booked it for, and
  // driven by the admin-editable category durations / keyword rules.
  const { config } = await loadConfig();
  const estimatedMinutes = estimateMinutes(body.category, body.description, config);
  const estimatedLabel   = formatDuration(estimatedMinutes);

  // Default assignee: whoever in Settings -> IT Staff currently has their role
  // set to "IT Tech". Admin-editable with no redeploy — change who's on triage
  // duty by editing that one person's role in the admin panel. Falls back to
  // blank (unassigned) if nobody currently holds that role, rather than
  // guessing — an empty AssignedTo is a safe, visible state to fix manually.
  const itTech = (config.itStaff || []).find(s => (s.role || '').trim().toLowerCase() === 'it tech');
  const assignedTo = itTech ? itTech.name : '';

  // Store the error screenshot in Blob and forward only a URL. Non-fatal: if the
  // upload fails the ticket is still logged, just without the image.
  let attachmentUrl = '';
  if (attachmentDataUrl && blob.isConfigured()) {
    const m = /^data:(image\/(png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(attachmentDataUrl);
    if (m) {
      try {
        const ext  = m[2].toLowerCase() === 'png' ? 'png' : m[2].toLowerCase() === 'jpeg' ? 'jpg' : m[2].toLowerCase();
        const buf  = Buffer.from(m[3], 'base64');
        const path = `tickets/${ticketID}/error-${Date.now()}.${ext}`;
        await blob.putFile(path, buf, m[1]);
        attachmentUrl = `/api/attachment?path=${encodeURIComponent(path)}`;
      } catch (err) {
        console.error('Attachment upload failed:', err.message);
      }
    }
  }

  // Call Power Automate for SharePoint + Calendar
  const paUrl = process.env.POWER_AUTOMATE_URL;
  if (paUrl) {
    try {
      await fetch(paUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...body, ticketID, estimatedMinutes, estimatedLabel, attachmentUrl, assignedTo })
      });
    } catch (err) {
      console.error('PA call error:', err.message);
    }
  }

  // Send emails via Resend
  try {
    // Submitter confirmation
    await sendEmail({
      to:      body.submitterEmail,
      subject: `IT Ticket ${ticketID} Created — ${body.category}`,
      html:    submitterHtml({ ...body, ticketID })
    });

    // Line manager notification — fallback to hr@iram.co.za if no manager email given
    const hrFallback = process.env.HR_EMAIL || 'hr@iram.co.za';
    const managerTo  = (body.managerEmail && body.managerEmail.trim()) ? body.managerEmail.trim() : null;
    await sendEmail({
      to:      managerTo || hrFallback,
      bcc:     managerTo ? hrFallback : undefined, // HR always gets a copy as bounce safety net
      subject: managerTo
        ? `FYI: IT Ticket ${ticketID} logged for ${body.submitterName}`
        : `IT Ticket ${ticketID} — no line manager provided (${body.submitterName})`,
      html:    managerHtml({ ...body, ticketID, noManager: !managerTo })
    });

    // IT person notification
    const itEmail = process.env.IT_EMAIL;
    if (itEmail) {
      await sendEmail({
        to:      itEmail,
        subject: `[${body.suggestedPriority || 'New'}] Ticket ${ticketID} — ${body.category}`,
        html:    itHtml({ ...body, ticketID })
      });
    }
  } catch (err) {
    console.error('Resend error:', err.message);
  }

  return res.status(200).json({ ticketID });
};

async function sendEmail({ to, bcc, subject, html }) {
  const payload = {
    from:    'iRam IT Support <noreply@outerjoin.co.za>',
    to:      [to],
    subject,
    html
  };
  if (bcc) payload.bcc = [bcc];
  const r = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify(payload)
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

function itHtml({ submitterName, submitterEmail, submitterPhone, department, location, managerName, managerEmail, category, suggestedPriority, description, ticketID, submittedAt }) {
  const submitted = submittedAt
    ? new Date(submittedAt).toLocaleString('en-ZA', { dateStyle:'medium', timeStyle:'short' })
    : new Date().toLocaleString('en-ZA', { dateStyle:'medium', timeStyle:'short' });
  const prioColor = suggestedPriority === 'Critical' ? '#a4262c' : suggestedPriority === 'High' ? '#d83b01' : suggestedPriority === 'Low' ? '#498205' : '#986f0b';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Segoe UI,Arial,sans-serif;background:#f4f6f8">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">

  <tr><td style="background:#2D2D2D;padding:28px 32px;text-align:center">
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700">iRam IT Support</p>
    <p style="margin:8px 0 0;color:#6BBF4E;font-size:12px;text-transform:uppercase;letter-spacing:1.5px">New Ticket — Action Required</p>
  </td></tr>

  <tr><td style="background:#fff8e1;padding:16px 32px;border-bottom:3px solid ${prioColor};text-align:center">
    <p style="margin:0;font-size:13px;color:#555">Priority</p>
    <p style="margin:4px 0 0;font-size:22px;font-weight:700;color:${prioColor}">${esc(suggestedPriority || 'Medium')}</p>
  </td></tr>

  <tr><td style="padding:28px 32px">
    <p style="margin:0 0 20px;font-size:15px;color:#333">A new IT support ticket has been submitted and requires your attention.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;font-size:13px">
      <tr><td style="background:#edf7e8;padding:11px 16px;font-weight:600;color:#555;width:130px">Ticket ID</td>
          <td style="background:#edf7e8;padding:11px 16px;font-weight:700;color:#4e9938;font-size:15px">${esc(ticketID)}</td></tr>
      <tr><td style="padding:11px 16px;font-weight:600;color:#555">Submitted</td>
          <td style="padding:11px 16px;color:#333">${submitted}</td></tr>
      <tr><td style="background:#f9f9f9;padding:11px 16px;font-weight:600;color:#555">Name</td>
          <td style="background:#f9f9f9;padding:11px 16px;color:#333">${esc(submitterName)}</td></tr>
      <tr><td style="padding:11px 16px;font-weight:600;color:#555">Email</td>
          <td style="padding:11px 16px;color:#333"><a href="mailto:${esc(submitterEmail)}" style="color:#4e9938">${esc(submitterEmail)}</a></td></tr>
      <tr><td style="background:#f9f9f9;padding:11px 16px;font-weight:600;color:#555">Phone</td>
          <td style="background:#f9f9f9;padding:11px 16px;color:#333">${esc(submitterPhone || '—')}</td></tr>
      <tr><td style="padding:11px 16px;font-weight:600;color:#555">Department</td>
          <td style="padding:11px 16px;color:#333">${esc(department)}</td></tr>
      <tr><td style="background:#f9f9f9;padding:11px 16px;font-weight:600;color:#555">Location</td>
          <td style="background:#f9f9f9;padding:11px 16px;color:#333">${esc(location)}</td></tr>
      <tr><td style="padding:11px 16px;font-weight:600;color:#555">Line Manager</td>
          <td style="padding:11px 16px;color:#333">${managerName ? `${esc(managerName)} &lt;${esc(managerEmail)}&gt;` : '—'}</td></tr>
      <tr><td style="background:#f9f9f9;padding:11px 16px;font-weight:600;color:#555">Category</td>
          <td style="background:#f9f9f9;padding:11px 16px;color:#333">${esc(category)}</td></tr>
      <tr><td style="padding:11px 16px;font-weight:600;color:#555">Description</td>
          <td style="padding:11px 16px;color:#333;line-height:1.6">${esc(description)}</td></tr>
    </table>
  </td></tr>

  <tr><td style="background:#f4f6f8;padding:18px 32px;text-align:center;border-top:1px solid #e8e8e8">
    <p style="margin:0;color:#aaa;font-size:11px">iRam IT Support Portal &nbsp;|&nbsp; Assigned to IT team</p>
  </td></tr>

</table></td></tr></table>
</body></html>`;
}

function managerHtml({ submitterName, submitterEmail, managerName, category, location, suggestedPriority, description, ticketID, noManager }) {
  const greeting = noManager
    ? 'Hi <strong>HR Team</strong>,'
    : `Hi <strong>${esc(managerName || 'Manager')}</strong>,`;
  const intro = noManager
    ? `A staff member logged an IT ticket but did not provide a line manager. This notification has been sent to HR as the fallback contact.`
    : `A member of your team has logged an IT support ticket. This notification is for your information — no action is required from you.`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:Segoe UI,Arial,sans-serif;background:#f4f6f8">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08)">

  <tr><td style="background:#2D2D2D;padding:28px 32px;text-align:center">
    <p style="margin:0;color:#ffffff;font-size:22px;font-weight:700">iRam IT Support</p>
    <p style="margin:8px 0 0;color:#aaa;font-size:12px;text-transform:uppercase;letter-spacing:1.5px">${noManager ? 'HR Notification — No Manager Listed' : 'Line Manager Notification'}</p>
  </td></tr>

  <tr><td style="padding:28px 32px">
    <p style="margin:0 0 16px;font-size:15px;color:#333">${greeting}</p>
    <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.7">${intro}</p>

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
