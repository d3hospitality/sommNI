import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveAccountProject, WINELENS_PROJECT_URL } from '../src/account-project.ts';
import { normalizeCode, validCode, randomCode, privateHash, subscriptionAccess } from '../supabase/functions/_shared/policy.ts';
import { deviceAuthStorage } from '../src/account-storage.ts';
assert.equal(normalizeCode(' abcd-1234 '), 'ABCD1234');
assert.ok(validCode(normalizeCode('abcd-1234')));
for(const code of ['ABCDEFGI','ABCDEFGU','ABCDEFG!', 'ABCDEFG', 'ABCDEFGHI']) assert.equal(validCode(code), false);
assert.ok(Array.from({length:1000}, randomCode).every(validCode));
assert.notEqual(await privateHash('ABCD1234', 'secretA'), await privateHash('ABCD1234','secretB'));
const sample = { id:'sub_one', status:'active', livemode:true, cancel_at_period_end:false, items:{ data:[{price:{id:'price_month'},current_period_end:2000}] } };
const access = (override, prices=['price_month']) => subscriptionAccess([{...sample,...override}],prices,true,1000);
assert.equal(access({}).pro,true);
assert.equal(access({status:'trialing'}).pro,true);
for(const status of ['incomplete','past_due','unpaid','paused','canceled','incomplete_expired']) assert.equal(access({status}).pro,false);
assert.equal(access({livemode:false}).pro,false);
assert.equal(access({},['price_other']).pro,false);
assert.equal(subscriptionAccess([sample],['price_month'],true,2001).pro,false);
assert.equal(access({cancel_at_period_end:true}).pro,true);
assert.equal(subscriptionAccess([],['price_month'],true,1000).pro,false);
const values = new Map(); let fail = false;
const bridge = { async getLocalStorage(k){return values.get(k)||''}, async setLocalStorage(k,v){if(fail)return false; await new Promise(r=>setTimeout(r,2)); values.set(k,v); return true;} };
const storage = deviceAuthStorage(async()=>bridge);
await Promise.all([storage.setItem('session','first'),storage.setItem('session','second')]);
assert.equal(await storage.getItem('session'),'second');
await storage.removeItem('session'); assert.equal(await storage.getItem('session'),null);
fail=true; await assert.rejects(storage.setItem('session','must-not-stick'), /Could not save/); assert.equal(await storage.getItem('session'),null);
fail=false; await storage.setItem('session','restored'); assert.equal(await storage.getItem('session'),'restored');
console.log('PASS: code validation and keyed hashes; Stripe status/expiry/price/mode authorization; durable serialized G2 sessions and storage failure.');

assert.equal(resolveAccountProject().url, WINELENS_PROJECT_URL);
assert.throws(() => resolveAccountProject('https://shared.supabase.co'), /dedicated/);
assert.throws(() => resolveAccountProject(WINELENS_PROJECT_URL, 'sb_secret_do-not-expose'), /public publishable/);
for (const manifest of ['app.json', 'app.beta.json']) {
  const config = JSON.parse(fs.readFileSync(new URL('../' + manifest, import.meta.url), 'utf8'));
  assert.deepEqual(config.permissions.find(p => p.name === 'network').whitelist.filter(url => url.includes('supabase.co')), [WINELENS_PROJECT_URL]);
}
console.log('PASS: both G2 manifests use only wineLENS; shared-project URLs and server keys are rejected.');
