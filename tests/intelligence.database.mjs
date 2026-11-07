import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const db=new PGlite();await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
await db.exec(fs.readFileSync('supabase/changes/beta_intelligence.sql','utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20261019095145_shared_wine_research_cache.sql','utf8'));
for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);for(const table of ['wl_community_wines','wl_community_receipts','wl_beta_content'])await assert.rejects(db.query(`select * from ${table}`),/permission denied/);await assert.rejects(db.query("select wl_beta_claim_content('a','daily','en',gen_random_uuid())"),/permission denied/);await db.exec('reset role');}
await db.exec('set role service_role');
const claim=()=>db.query("select wl_beta_claim_content('daily:test','daily','en','11111111-1111-4111-8111-111111111111') as claimed");
assert.equal((await claim()).rows[0].claimed,true);assert.equal((await claim()).rows[0].claimed,false);
await db.exec("update wl_beta_content set lease_until=now()-interval '1 second'");assert.equal((await claim()).rows[0].claimed,true);
await db.exec("update wl_beta_content set payload='{\"questions\":[]}'::jsonb,lease_until=null");assert.equal((await claim()).rows[0].claimed,false);
await db.exec("insert into wl_community_wines(identity_key,wine_name,producer,vintage) values('wine-key','Example wine','Example producer','2021')");
await assert.rejects(db.exec("insert into wl_community_wines(identity_key,wine_name,producer,vintage) values('wine-key','Example wine','Example producer','2021')"),/duplicate key/);
await assert.rejects(db.exec("update wl_community_wines set status='published_unchecked'"),/check constraint/);
assert.equal((await db.query("select status from wl_community_wines")).rows[0].status,'pending');
assert.equal((await db.query("select wl_beta_claim_content('research:test','research','en',gen_random_uuid()) as claimed")).rows[0].claimed,true);
await db.close();console.log('PASS: RLS/grants isolate all 3 tables; generation lease rejects duplicates, recovers expired jobs, preserves completed caches; community identity dedup and moderation status enforced.');
