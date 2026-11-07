import {PGlite} from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const db=new PGlite();
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
await db.exec(fs.readFileSync('supabase/migrations/20261016202656_free_beta_quota.sql','utf8'));
for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(db.query('select wl_beta_reserve(1)'),/permission denied/);await assert.rejects(db.query('select * from wl_beta_usage'),/permission denied/);await db.exec('reset role');}
await db.exec('set role service_role');
const reserve=async(weight)=>(await db.query('select wl_beta_reserve($1) as ok',[weight])).rows[0].ok;
assert.equal(await reserve(10),true);assert.equal(await reserve(10),true);assert.equal(await reserve(1),false);
await db.exec("delete from wl_beta_usage where period_key like 'minute:%'; update wl_beta_usage set used=99 where period_key like 'day:%'");
assert.equal(await reserve(2),false);assert.equal(await reserve(1),true);assert.equal(await reserve(1),false);
await assert.rejects(reserve(0),/invalid weight/);await db.close();console.log('Free beta SQL: anonymous grants denied, atomic minute/day budget and invalid weights passed.');
