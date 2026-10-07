const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const BASE=process.env.WL_BASE_URL||'http://localhost:5186';
const user='11111111-1111-4111-8111-111111111111';
const sessionId='22222222-2222-4222-8222-222222222222';
const now=Math.floor(Date.now()/1000);
const jwt=[{alg:'HS256',typ:'JWT'},{sub:user,role:'authenticated',aud:'authenticated',exp:now+3600,session_id:sessionId},'test'].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
const session={access_token:jwt,refresh_token:'local-test-only',expires_at:now+3600,expires_in:3600,token_type:'bearer',user:{id:user,email:'test@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};
const opts={executablePath:process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true};
(async()=>{
 const browser=await chromium.launch(opts);
 try {
 for(const host of [false,true]){
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));let reply=200,redeemed=[],unlinked=0;
  if(host)await page.addInitScript(()=>{
   window.__hostStorage={};window.__bridgeCalls=[];
   window.flutter_inappwebview={callHandler:async(name,arg)=>{
    window.__bridgeCalls.push({name,arg});
    // SDK request envelopes are exercised by the dedicated storage adapter below.
    return {};
   }};
  });
  await page.route('https://mcmtasetompygfktzhpr.supabase.co/**',r=>r.fulfill({json:session.user}));
  await page.route('**/api/device-link',async r=>{
   const body=r.request().postDataJSON();
   if(body.action==='redeem'){redeemed.push(body.code);return r.fulfill({status:reply,json:reply===200?{session,device_id:sessionId}:{error:reply===410?'Code expired. Get a new code.':reply===429?'Too many attempts. Try again later.':'Code invalid or already used. Get a new code.'}});}
   if(body.action==='unlink')unlinked++;
   return r.fulfill({json:{status:'linked',removed:true}});
  });
  // Winebrary and study live on the same wineLENS account API as linking.
  await page.route('**/api/winebrary',r=>r.fulfill({json:{items:[],count:0}}));
  await page.route('**/api/study',r=>r.fulfill({json:{events:[],accepted:[],duplicates:[]}}));
  await page.route('**/api/billing',r=>r.fulfill({json:{pro:false,tokens:0,auto_spend:false,scan_available:true,allowances:{},rate_card:require('../shared/rate-card.json')}}));
  await page.goto(BASE+'/sommNI/');
  if(host){
   // Exercise initSync's real bridgeStore with a mock bridge; do not wait for physical hardware.
   await page.evaluate(async()=>{
    const sync=await import('/sommNI/src/sync.ts');
    sync.initSync({getLocalStorage:async k=>window.__hostStorage[k]||'',setLocalStorage:async(k,v)=>{window.__hostStorage[k]=v;return true;}});
    const link=await import('/sommNI/src/device-link.ts');
    window.__testLink=link;
   });
   const normalized=await page.evaluate(()=>window.__testLink.normalizeLinkCode(' abcd - 2345 '));assert.equal(normalized,'ABCD2345');
   await page.evaluate(()=>window.__testLink.redeemLinkCode('abcd-2345'));
   const stored=await page.evaluate(()=>({host:window.__hostStorage.winelens_account_session_v1,local:localStorage.getItem('winelens_account_session_v1')}));
   assert.equal(JSON.parse(stored.host).refresh_token,session.refresh_token);assert.equal(stored.local,null);
   await page.evaluate(()=>window.__testLink.unlinkDevice());assert.equal(await page.evaluate(()=>window.__hostStorage.winelens_account_session_v1),'');assert.equal(unlinked,1);
  }else{
   await page.getByRole('button',{name:'Link account ↗',exact:true}).click();
   assert.equal(await page.locator('input[type=password]').count(),0);
   await page.getByLabel('Link code').fill('OOOO-1111');await page.getByRole('button',{name:'Link this device',exact:true}).click();await page.getByText(/Codes do not use/).waitFor();assert.equal(redeemed.length,0);
   for(const [status,message] of [[410,'Code expired. Get a new code.'],[404,'Code invalid or already used. Get a new code.'],[429,'Too many attempts. Try again later.']]){
    reply=status;await page.getByLabel('Link code').fill('abcd 2345');await page.getByRole('button',{name:'Link this device',exact:true}).click();await page.getByText(message,{exact:true}).waitFor();
   }
   reply=200;await page.getByLabel('Link code').fill(' abcd-2345 ');await page.getByRole('button',{name:'Link this device',exact:true}).click();await page.getByRole('button',{name:'My account ↗'}).waitFor();
   assert(redeemed.every(c=>c==='ABCD2345'));assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('winelens_account_session_v1')).refresh_token),session.refresh_token);
   await page.reload();await page.getByRole('button',{name:'My account ↗'}).waitFor();await page.getByRole('button',{name:'My account ↗'}).click();await page.getByText('test@example.test',{exact:false}).waitFor();await page.getByRole('button',{name:'Unlink this device',exact:true}).click();await page.getByRole('button',{name:'Link account ↗',exact:true}).waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('winelens_account_session_v1')),null);assert.equal(unlinked,1);
  }
  assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: normalize, invalid alphabet, expired/invalid/rate-limited, redeem, browser persistence/reload, mock Even Hub storage, unlink cleanup');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
