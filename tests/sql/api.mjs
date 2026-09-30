// Exercise production scan/webhook handlers with actual PostgreSQL RPCs.
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url),{createScanHandler}=require('../../server/wine-scan.cjs'),{createWebhookHandler}=require('../../server/stripe-webhook.cjs');
const {env,invoke,user,sid}=require('../billing-helpers.cjs');const Stripe=require('stripe');
const db=new PGlite({extensions:{pg_trgm}}),dir=path.dirname(new URL(import.meta.url).pathname);
try {
 for(const f of [path.join(dir,'bootstrap.sql'),...fs.readdirSync(path.join(dir,'baseline')).filter(f=>f.endsWith('.sql')).sort().map(f=>path.join(dir,'baseline',f)),...fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort().map(f=>path.join('supabase/migrations',f))])await db.exec(fs.readFileSync(f,'utf8'));
 await db.query('insert into auth.users(id,email) values($1,$2)',[user.id,user.email]);await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[sid,user.id]);
 const adapter={auth:{getUser:async()=>({data:{user}})},async rpc(name,args){assert.match(name,/^(winelens_|wl_)[a-z_]+$/);const pairs=Object.entries(args);const params=pairs.map(([,v])=>typeof v==='object'&&v!==null?JSON.stringify(v):v);try{return {data:(await db.query(`select public.${name}(${pairs.map(([k],i)=>`${k} => $${i+1}`).join(',')}) as result`,params)).rows[0].result}}catch(error){return {error}}},from(){return {update(){return this},eq(){return this},then(resolve){resolve({data:null})}}}};
 const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
 const fields={wine_name:'Verified',producer:'Test',vintage:2020,country:'France',region:'Bordeaux',grape:'Merlot',color:'Red',confidence:.9,draft_tasting_note:'Fruit-led.'};
 let calls=0,fail=false;
 const h=createScanHandler({getDb:()=>adapter,env,getOpenAI:()=>({chat:{completions:{create:async()=>{calls++;if(fail)throw Error('test');return {choices:[{message:{content:JSON.stringify(fields)}}]}}}}})});
 const body={photo,request_id:randomUUID()};assert.equal((await invoke(h,body)).status,200);assert.equal((await invoke(h,body)).body.replayed,true);assert.equal(calls,1);
 let state=(await adapter.rpc('winelens_billing_status',{p_user:user.id})).data;assert.equal(state.allowances.label_scan.remaining,4);
 fail=true;assert.equal((await invoke(h,{photo,request_id:randomUUID()})).status,502);state=(await adapter.rpc('winelens_billing_status',{p_user:user.id})).data;assert.equal(state.allowances.label_scan.remaining,4);
 assert.equal((await db.query('select count(*)::int as n from user_collection')).rows[0].n,0);assert.equal((await db.query('select count(*)::int as n from wines')).rows[0].n,0);
 const stripe=new Stripe(env.STRIPE_SECRET_KEY);const webhook=createWebhookHandler({getDb:()=>adapter,env,getStripe:()=>stripe});
 const event={id:'evt_real_db',type:'checkout.session.completed',livemode:false,created:123,data:{object:{id:'cs_real_db',mode:'payment',payment_status:'paid',currency:'usd',amount_total:1000,client_reference_id:user.id,metadata:{app:'winelens',user_id:user.id,pack:'t10'}}}};
 const raw=JSON.stringify(event),signature=stripe.webhooks.generateTestHeaderString({payload:raw,secret:env.STRIPE_WEBHOOK_SECRET});
 for(let i=0;i<2;i++)assert.equal((await invoke(webhook,Buffer.from(raw),{headers:{'stripe-signature':signature}})).status,200);
 assert.equal((await db.query('select units from winelens_token_wallets where user_id=$1',[user.id])).rows[0].units,220);
 assert.equal((await db.query("select count(*)::int as n from winelens_token_ledger where event='grant'")).rows[0].n,1);
 console.log('PASS: production scan and signed webhook handlers against real embedded PostgreSQL; cache/allowance rollback/idempotent ledger/no catalog writes');
} finally {await db.close()}
