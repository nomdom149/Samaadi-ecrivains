export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }

  const API_KEY = process.env.SYSTEME_IO_API_KEY;
  if (!API_KEY) { return res.status(500).json({ error: 'Server configuration error' }); }

  const sysioHeaders = { 'Content-Type': 'application/json', 'X-API-Key': API_KEY };

  // Extract meta-champs séparés du payload contact
  const { tagIds = [], campaignIds = [], firstName, ...rest } = req.body;

  // Systeme.io utilise first_name (snake_case)
  const contactPayload = {
    ...rest,
    ...(firstName ? { first_name: firstName } : {}),
  };

  try {
    // ── Étape 1 : créer ou mettre à jour le contact ──
    const createResp = await fetch('https://api.systeme.io/api/contacts', {
      method: 'POST',
      headers: sysioHeaders,
      body: JSON.stringify(contactPayload),
    });
    const createData = await createResp.json().catch(() => ({}));

    let contactId = createData.id || null;

    // Doublon d'email : on récupère l'ID existant pour tagger
    if (createResp.status === 422) {
      const violations = createData.violations || [];
      const onlyEmailDup = violations.length > 0 && violations.every(
        v => v.propertyPath === 'email' && (v.message || '').includes('utilis')
      );
      if (onlyEmailDup) {
        try {
          const searchResp = await fetch(
            `https://api.systeme.io/api/contacts?email=${encodeURIComponent(contactPayload.email)}`,
            { headers: sysioHeaders }
          );
          const searchData = await searchResp.json().catch(() => ({}));
          contactId = searchData?.items?.[0]?.id || null;
        } catch (_) {}
      } else {
        return res.status(422).json(createData);
      }
    } else if (createResp.status !== 201) {
      return res.status(createResp.status).json(createData);
    }

    // ── Étape 2 : attacher les tags ──
    if (contactId && tagIds.length > 0) {
      for (const tagId of tagIds) {
        await fetch(`https://api.systeme.io/api/contacts/${contactId}/tags`, {
          method: 'POST',
          headers: sysioHeaders,
          body: JSON.stringify({ tagId }),
        }).catch(() => {});
      }
    }

    // ── Étape 3 : inscrire aux campagnes ──
    if (contactId && campaignIds.length > 0) {
      for (const campaignId of campaignIds) {
        await fetch(`https://api.systeme.io/api/campaigns/${campaignId}/contacts`, {
          method: 'POST',
          headers: sysioHeaders,
          body: JSON.stringify({ contactId }),
        }).catch(() => {});
      }
    }

    return res.status(200).json({ success: true, id: contactId });
  } catch (error) {
    return res.status(500).json({ error: 'API call failed', detail: error.message });
  }
}
