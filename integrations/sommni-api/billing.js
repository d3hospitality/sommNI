// Install as api/_lib/billing.js in sommni-api before enabling checkout.
// This server check runs before reserving image quota or calling OpenAI.
export async function requireBottleStudioPro(req, res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (url !== 'https://mcmtasetompygfktzhpr.supabase.co' || !key) {
    res.status(503).json({ error: 'Bottle Studio account billing is not configured yet. You have not been charged.' });
    return false;
  }
  try {
    const response = await fetch(`${url}/functions/v1/winelens-billing`, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: req.headers.authorization || req.headers.Authorization || '' },
      body: JSON.stringify({ action: 'require_pro' }),
    });
    const data = await response.json();
    if (!response.ok || data.pro !== true) {
      const status = [401, 402, 429].includes(response.status) ? response.status : 503;
      res.status(status).json({ error: status === 402 ? 'wineLENS Pro is required for Bottle Studio. Manage your membership on the account website.' : 'Could not verify your membership. No rendering was started.' });
      return false;
    }
    return true;
  } catch {
    res.status(503).json({ error: 'Could not verify your membership. No rendering was started.' });
    return false;
  }
}
