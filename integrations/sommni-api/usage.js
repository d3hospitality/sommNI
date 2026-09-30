/** Server-only, dependency-free. Caller JWT + publishable key; never a service key. */
export function studioUsage({ supabaseUrl, publishableKey, jwt, fetchImpl = fetch }) {
  if (supabaseUrl !== 'https://mcmtasetompygfktzhpr.supabase.co') throw new Error('wineLENS project required');
  async function rpc(name, args) {
    const r = await fetchImpl(`${supabaseUrl}/rest/v1/rpc/${name}`, { method: 'POST',
      headers: { apikey: publishableKey, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('Usage unavailable. Do not start the provider call.');
    return r.json();
  }
  return {
    reserve: (requestId, consent = false) => rpc('winelens_reserve_studio', { p_key: requestId, p_spend_consent: consent === true }),
    settle: (hold, success) => rpc('winelens_settle_studio', { p_reservation_id: hold.reservation_id, p_success: success, p_receipt: hold.receipt }),
    async run(requestId, consent, provider) {
      const hold = await this.reserve(requestId, consent);
      if (!hold.allowed || hold.replayed) { const e = new Error(hold.replayed ? 'This rendering request already ran.' : 'Rendering allowance reached. Check your account on the phone.'); e.status = 402; throw e; }
      let result;
      try { result = await provider(); } catch (e) { await this.settle(hold, false); throw e; }
      const settled = await this.settle(hold, true);
      if (settled.status !== 'committed') throw new Error('Rendering reservation expired. Please try again.');
      return result;
    },
  };
}
