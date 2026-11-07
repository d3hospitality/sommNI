import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
create schema auth; create table auth.users(id uuid primary key);
insert into auth.users values ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');`);
await db.exec(fs.readFileSync(new URL('../supabase/migrations/20260930063621_account_linking_billing.sql', import.meta.url), 'utf8'));
const user = '11111111-1111-4111-8111-111111111111';
const rpc = async (name, params = []) => (await db.query(`select public.${name}(${params.map((_, i) => '$' + (i+1)).join(',')}) as result`, params)).rows[0].result;
for (const role of ['anon', 'authenticated']) {
  await db.exec(`set role ${role}`);
  for (const table of ['winelens_link_codes', 'winelens_rate_buckets', 'winelens_billing_customers', 'winelens_checkout_attempts']) {
    await assert.rejects(db.query(`select * from public.${table}`), /permission denied/);
  }
  await assert.rejects(rpc('winelens_mint_link', [user, 'stolen']), /permission denied/);
  await assert.rejects(rpc('winelens_claim_link', ['stolen']), /permission denied/);
  await assert.rejects(rpc('winelens_reserve_checkout', [user, 'annual']), /permission denied/);
  await db.exec('reset role');
}
await db.exec('set role service_role');
const expiry = await rpc('winelens_mint_link', [user, 'first']);
assert.ok(Date.parse(expiry) > Date.now() + 590000);
await rpc('winelens_mint_link', [user, 'replacement']);
assert.equal(await rpc('winelens_claim_link', ['first']), null);
const competing = await Promise.all([rpc('winelens_claim_link', ['replacement']), rpc('winelens_claim_link', ['replacement'])]);
assert.equal(competing.filter(x => x === user).length, 1);
assert.equal(await rpc('winelens_claim_link', ['replacement']), null);
await rpc('winelens_mint_link', [user, 'expired']);
await db.exec("update public.winelens_link_codes set expires_at=now()-interval '1 second'");
assert.equal(await rpc('winelens_claim_link', ['expired']), null);
const limits = await Promise.all(Array.from({length:12}, () => rpc('winelens_take_rate', ['ip', 10, 600])));
assert.equal(limits.filter(Boolean).length, 10);
await db.exec("update public.winelens_rate_buckets set started_at=now()-interval '11 minutes'");
assert.equal(await rpc('winelens_take_rate', ['ip', 10, 600]), true);
// One active reservation is returned even if the client changes plans/retries.
const reservation = async plan => (await db.query('select (public.winelens_reserve_checkout($1, $2)).*', [user, plan])).rows[0];
const first = await reservation('monthly'); const second = await reservation('annual');
assert.equal(first.attempt_id, second.attempt_id); assert.equal(second.plan, 'monthly');
await db.exec("update public.winelens_checkout_attempts set expires_at=now()-interval '1 second'");
const next = await reservation('annual'); assert.notEqual(next.attempt_id, first.attempt_id); assert.equal(next.plan, 'annual');
await db.exec('reset role');
const security = await db.query("select relname, relrowsecurity from pg_class where relname in ('winelens_link_codes','winelens_rate_buckets','winelens_billing_customers','winelens_checkout_attempts')");
assert.equal(security.rows.length, 4); assert.ok(security.rows.every(row => row.relrowsecurity));
await db.close();
console.log('PASS: actual PostgreSQL migration; client grants denied; replacement/expiry/replay; atomic consumption; global rate counters; checkout reservation; RLS.');
