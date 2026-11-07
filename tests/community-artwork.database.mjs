import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();await db.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);');
await db.exec(await readFile('supabase/changes/beta_intelligence.sql','utf8'));
await db.exec(await readFile('supabase/migrations/20261019193034_master_winebrary_artwork.sql','utf8'));
for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(db.query('select * from wl_community_artwork'),/permission denied/);await db.exec('reset role');}
const {rows:[wine]}=await db.query("insert into wl_community_wines(identity_key,wine_name,producer,vintage) values('test','Example','Maker','2021') returning id,status");assert.equal(wine.status,'pending');
await db.exec('set role service_role');const args=[wine.id,'a'.repeat(64),'bottle.png','g2.png'];await db.query("insert into wl_community_artwork(wine_id,asset_hash,photo_path,sprite_path,source) values($1,$2,$3,$4,'photograph')",args);
await assert.rejects(db.query("insert into wl_community_artwork(wine_id,asset_hash,photo_path,sprite_path,source) values($1,$2,$3,$4,'photograph')",args),/duplicate key/);
assert.equal((await db.query('select status from wl_community_wines')).rows[0].status,'pending');await db.exec('reset role');assert.equal((await db.query("select public from storage.buckets where id='sommni-master-bottles'")).rows[0].public,false);await db.close();console.log('PASS: master artwork RLS, private bucket, pending review and duplicate identity constraints.');
