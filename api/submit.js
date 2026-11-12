import nodemailer from 'nodemailer';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }

  const API_KEY = process.env.SYSTEME_IO_API_KEY;
  if (!API_KEY) { return res.status(500).json({ error: 'Server configuration error' }); }

  const sysioHeaders = {
    'Content-Type': 'application/json',
    'X-API-Key': API_KEY,
  };

  const { tagIds = [], campaignIds = [], firstName, fields = [], ...rest } = req.body;
  const contactPayload = {
    ...rest,
    ...(firstName ? { first_name: firstName } : {}),
    ...(fields.length > 0 ? { fields } : {}),
  };

  let contactId = null;

  try {
    // 1. Créer ou mettre à jour le contact
    const createRes = await fetch('https://api.systeme.io/api/contacts', {
      method: 'POST',
      headers: sysioHeaders,
      body: JSON.stringify(contactPayload),
    });
    const createData = await createRes.json();

    if (!createRes.ok) {
      console.error('Systeme.io create error:', JSON.stringify(createData));
      return res.status(createRes.status).json({ error: 'Systeme.io create failed', detail: createData });
    }
    contactId = createData.id;

    // 2. Ajouter les tags
    for (const tagId of tagIds) {
      await fetch('https://api.systeme.io/api/contacts/' + contactId + '/tags', {
        method: 'POST',
        headers: sysioHeaders,
        body: JSON.stringify({ tagId }),
      });
    }

    // 3. Ajouter aux campagnes email
    for (const campaignId of campaignIds) {
      await fetch('https://api.systeme.io/api/contacts/' + contactId + '/email_marketing_campaigns', {
        method: 'POST',
        headers: sysioHeaders,
        body: JSON.stringify({ campaignId }),
      });
    }

    // 4. Notification email via SMTP OVH
    const EMAIL_USER = process.env.EMAIL_USER;
    const EMAIL_PASS = process.env.EMAIL_PASS;
    if (EMAIL_USER && EMAIL_PASS && contactPayload.email) {
      const transporter = nodemailer.createTransport({
        host: 'ssl0.ovh.net',
        port: 465,
        secure: true,
        auth: { user: EMAIL_USER, pass: EMAIL_PASS },
      });

      const fieldMap = {};
      (fields || []).forEach(function(f) { fieldMap[f.slug] = f.value; });

      const rows = [
        ['Pr\u00e9nom', firstName || '\u2014'],
        ['Email', contactPayload.email],
        ['Profil', fieldMap['profil'] || '\u2014'],
        ['Expertise', fieldMap['expertise'] || '\u2014'],
        ['Projet de livre', fieldMap['projet-livre'] || '\u2014'],
        ["Stade d'avancement", fieldMap['avancement'] || '\u2014'],
        ['Motivation', fieldMap['motivation'] || '\u2014'],
        ['LinkedIn', fieldMap['linkedin'] || '\u2014'],
      ];

      const s1 = 'padding:8px 12px;font-weight:600;color:#2a1a08;border-bottom:1px solid #f0e8d4;';
      const s2 = 'padding:8px 12px;color:#4a3a28;border-bottom:1px solid #f0e8d4;';
      const tableRows = rows.map(function(r) {
        return '<tr><td style="' + s1 + '">' + r[0] + '</td><td style="' + s2 + '">' + r[1] + '</td></tr>';
      }).join('');

      const html = '<!DOCTYPE html><html><body style="font-family:sans-serif;background:#faf7f0;padding:24px;">'
        + '<div style="max-width:580px;margin:0 auto;background:#fff;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">'
        + '<div style="background:#2a1a08;padding:24px 32px;"><p style="margin:0;color:#c9a24a;font-size:11px;letter-spacing:.2em;text-transform:uppercase;">Sama\u00e2di \u00b7 Nouvelle inscription</p></div>'
        + '<div style="padding:24px 32px;"><table style="width:100%;border-collapse:collapse;">' + tableRows + '</table>'
        + '<p style="margin-top:16px;font-size:11px;color:#9e8a6e;">Systeme.io ID\u00a0: ' + (contactId || 'inconnu') + '</p></div>'
        + '</div></body></html>';

      await transporter.sendMail({
        from: '"Sama\u00e2di" <' + EMAIL_USER + '>',
        to: 'cocon@samaadi.be',
        subject: '\u2726 Nouvelle inscription Sama\u00e2di \u2014 ' + (firstName || '') + ' (' + contactPayload.email + ')',
        html: html,
      }).catch(function(err) { console.warn('Email OVH error:', err.message); });
    }

    return res.status(200).json({ success: true, id: contactId });

  } catch (error) {
    return res.status(500).json({ error: 'API call failed', detail: error.message });
  }
}
