const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs'),path = require('node:path'),assert = require('node:assert/strict');
const { createHandler, codeHash } = require('../server/device-link.cjs');
const card=require('../shared/rate-card.json');
const BASE=process.env.WL_BASE_URL||'http://127.0.0.1:5190',ORIGIN='https://sommni-beige.vercel.app';
const user={id:'11111111-1111-4111-8111-111111111111',email:'pairing@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()};
const jwt=sid=>['e30',Buffer.from(JSON.stringify({sub:user.id,session_id:sid,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'fake'].join('.');
const session=sid=>({access_token:jwt(sid),refresh_token:'fake-'+sid,expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user});
const webId=randomUUID(),webSession=session(webId),sessions=new Set([webId]),codes=new Map(),devices=new Map(),calls=[];
let minted;
const admin={auth:{getUser:async()=>({data:{user}}),admin:{getUserById:async()=>({data:{user}}),generateLink:async()=>({data:{properties:{hashed_token:'fake-otp'}}}),signOut:async()=>({}),deleteUser:async()=>({})}},
 from(){let uid;return {select(){return this},eq(_k,v){uid=v;return this},is(){return this},not(){return this},async order(){return {data:[...devices.values()].filter(d=>d.user_id===uid&&!d.revoked_at&&d.linked_at)}}}},
 async rpc(name,p){calls.push(name);let data;
  switch(name){
   case 'wl_check_session':data={status:sessions.has(p.p_session_id)?'active':'revoked'};break;
   case 'wl_issue_code':{const c={id:randomUUID(),user_id:p.p_user_id,hash:p.p_code_hash,expires_at:new Date(Date.now()+600000).toISOString()};codes.set(c.id,c);data={...c,status:'pending'};break;}
   case 'wl_claim_code':{const c=[...codes.values()].find(c=>c.hash===p.p_code_hash&&!c.used);if(!c){data={status:'invalid'};break;}c.used=true;const d={id:randomUUID(),user_id:c.user_id,code_id:c.id,label:'Even G2'};devices.set(d.id,d);data={...d,status:'claimed'};break;}
   case 'wl_finish_link':{const d=devices.get(p.p_id);Object.assign(d,{session_id:p.p_session_id,linked_at:new Date().toISOString(),last_seen_at:new Date().toISOString()});data={status:'linked'};break;}
   case 'wl_code_status':data={status:[...devices.values()].some(d=>d.code_id===p.p_id&&d.linked_at)?'linked':'pending'};break;
   case 'wl_device_status':data={status:sessions.has(p.p_session_id)?'linked':'revoked'};break;
   case 'wl_revoke_device':{const d=p.p_id?devices.get(p.p_id):[...devices.values()].find(d=>d.session_id===p.p_session_id);if(d){d.revoked_at=new Date().toISOString();sessions.delete(d.session_id)}data={status:'revoked_ok'};break;}
   default:throw Error('Unexpected RPC '+name);
  }return {data};
 }};
const auth={auth:{verifyOtp:async()=>{const id=randomUUID();sessions.add(id);minted=session(id);return {data:{session:minted}}}}};
const handler=createHandler({getClients:()=>({admin,auth}),secret:()=> 'fake-local-network-hash-secret'});
const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;req.body=JSON.parse(raw||'{}');res.status=n=>{res.statusCode=n;return res};res.json=x=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(x));return res};await handler(req,res)});
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.ttf':'font/ttf','.webp':'image/webp'};
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const local=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true});
 try{
  const site=await browser.newPage(),phone=await browser.newPage(),errors=[];site.on('pageerror',e=>errors.push(e.message));phone.on('pageerror',e=>errors.push(e.message));
  let pro=false,remaining=5,tokens=220,saves=0,scans=0,auto=false;
  const status=()=>({plan:pro?'pro':'free',pro,tokens,auto_spend:auto,scan_available:true,billing_available:false,rate_card:card,packs:card.packs,ledger:[],end:new Date(Date.now()+86400000).toISOString(),allowances:Object.fromEntries(Object.entries(card.features).map(([k,v])=>[k,{limit:v[pro?'pro':'free'],remaining:k==='label_scan'?remaining:v[pro?'pro':'free']}]))});
  await site.addInitScript(s=>localStorage.setItem('winelens_site_session_v1',JSON.stringify(s)),webSession);
  async function routes(r,isSite){const req=r.request(),url=new URL(req.url());
   if(url.hostname==='mcmtasetompygfktzhpr.supabase.co')return r.fulfill({json:url.pathname.endsWith('/settings')?{external:{google:true}}:user});
   if(url.pathname==='/api/device-link'){
    const reply=await fetch(local,{method:'POST',headers:{'Content-Type':'application/json',authorization:req.headers().authorization||'',origin:isSite?ORIGIN:BASE},body:req.postData()});return r.fulfill({status:reply.status,json:await reply.json()});
   }
   if(url.pathname==='/api/billing'){const b=req.postDataJSON();if(b.action==='auto-spend')auto=b.enabled;return r.fulfill({json:status()});}
   if(url.pathname==='/api/wine-scan'){scans++;const b=req.postDataJSON();assert(b.request_id);if(remaining===0)assert(b.spend_consent||auto);return r.fulfill({json:{wine_name:'Scanned Wine',producer:'Label Producer',vintage:'non-vintage',country:'France',region:'Bordeaux',grape:'Merlot',color:'Red',confidence:.85,draft_tasting_note:'Draft — fruit and spice.',review_required:true}});}
   if(url.pathname==='/api/collection'){if(req.method()==='POST'){saves++;const b=req.postDataJSON();return r.fulfill({json:{item:{...b,id:randomUUID(),metadata:{vintage_state:b.vintage_state}}}})}return r.fulfill({json:{items:[]}});}
   if(url.pathname.startsWith('/api/study/'))return r.fulfill({json:{events:[],accepted:[]}});
   if(isSite && url.origin===ORIGIN){const root=path.resolve('dist-site'),file=path.join(root,url.pathname==='/link'?'link.html':url.pathname);if(file.startsWith(root+path.sep)&&fs.existsSync(file))return r.fulfill({body:fs.readFileSync(file),contentType:mime[path.extname(file)]||'application/octet-stream'});return r.fulfill({status:404,body:''});}
   if(!isSite&&url.origin===BASE)return r.continue();return r.abort();
  }
  await site.route('**/*',r=>routes(r,true));await phone.route('**/*',r=>routes(r,false));
  await site.goto(ORIGIN+'/link');await site.waitForFunction(()=>/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(document.getElementById('code').textContent));
  const code=await site.locator('#code').textContent();assert([...codes.values()].some(c=>c.hash===codeHash(code.replace('-',''))));
  await phone.goto(BASE+'/sommNI/');await phone.getByRole('button',{name:'Link account ↗',exact:true}).click();await phone.getByLabel('Link code').fill(code);await phone.getByRole('button',{name:'Link this device',exact:true}).click();await phone.getByRole('button',{name:'My account ↗'}).waitFor();
  await phone.getByRole('button',{name:'Winebrary',exact:true}).click();
  await phone.getByText('Your first bottle starts here.',{exact:true}).waitFor();assert.equal(await phone.evaluate(()=>JSON.parse(localStorage.getItem('winelens_account_session_v1')).refresh_token),minted.refresh_token);
  await site.getByText('Linked — open wineLENS on your glasses.',{exact:true}).waitFor({timeout:10000});
  // Label scan: no collection write until the user reviews and explicitly saves.
  await phone.getByRole('button',{name:'＋ Add a wine',exact:true}).click();await phone.getByRole('button',{name:'Scan the label',exact:true}).click();await phone.getByText('Free · 5 of 5 left this month',{exact:true}).waitFor();
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  await phone.locator('#wl-label-file').setInputFiles({name:'label.png',mimeType:'image/png',buffer:png});await phone.getByRole('button',{name:'Scan and review ↗'}).click();await phone.getByLabel('Wine name',{exact:true}).waitFor();assert.equal(await phone.getByLabel('Wine name',{exact:true}).inputValue(),'Scanned Wine');assert.equal(saves,0);assert.equal(scans,1);
  await phone.getByRole('button',{name:'Save to Winebrary ↗',exact:true}).click();await phone.getByRole('button',{name:'Edit wine',exact:true}).waitFor();assert.equal(saves,1);await phone.getByRole('button',{name:'Close dialog'}).click();
  pro=true;remaining=0;
  await phone.getByRole('button',{name:'＋ Add a wine',exact:true}).click();await phone.getByRole('button',{name:'Scan the label',exact:true}).click();await phone.getByText('Uses 1 token · 220 left',{exact:true}).waitFor();await phone.locator('#wl-label-file').setInputFiles({name:'label.png',mimeType:'image/png',buffer:png});await phone.getByRole('button',{name:'Scan and review ↗'}).click();await phone.getByText('Confirm token use before scanning.',{exact:true}).waitFor();assert.equal(scans,1);await phone.getByLabel('Always allow',{exact:true}).check();await phone.getByRole('button',{name:'Scan and review ↗'}).click();await phone.getByLabel('Wine name',{exact:true}).waitFor();assert(auto);assert.equal(scans,2);assert.equal(saves,1);await phone.getByRole('button',{name:'Close dialog'}).click();
  // One real status check after revocation removes the stored companion session.
  await site.getByRole('button',{name:'Revoke Even G2',exact:true}).click();
  const before=calls.filter(x=>x==='wl_check_session').length;
  await phone.evaluate(()=>window.dispatchEvent(new Event('online')));await phone.getByRole('button',{name:'Link account ↗',exact:true}).waitFor();assert.equal(await phone.evaluate(()=>localStorage.getItem('winelens_account_session_v1')),null);assert(calls.filter(x=>x==='wl_check_session').length>before);
  await site.getByRole('button',{name:'New code ↻',exact:true}).click();await site.waitForFunction(()=>/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(document.getElementById('code').textContent));
  await phone.getByRole('button',{name:'Link account ↗',exact:true}).click();await phone.getByLabel('Link code').fill(await site.locator('#code').textContent());await phone.getByRole('button',{name:'Link this device',exact:true}).click();await phone.getByRole('button',{name:'My account ↗'}).click();await phone.getByRole('button',{name:'Unlink this device',exact:true}).click();await phone.getByRole('button',{name:'Link account ↗',exact:true}).waitFor();assert.equal(await phone.evaluate(()=>localStorage.getItem('winelens_account_session_v1')),null);
  assert.deepEqual(errors,[]);console.log('PASS: real HTTP pairing handler → site code → companion session/Winebrary → revoke within one check → re-pair/unlink; scan cost, consent, draft review and explicit save');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
