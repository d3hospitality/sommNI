const {chromium}=require('playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const base=(process.env.WINELENS_TEST_ORIGIN || 'http://localhost:5186')+'/sommNI/';
const output=process.env.WINELENS_TEST_OUTPUT || '/tmp/winelens-account-tests';fs.mkdirSync(output,{recursive:true});
const backend='https://mcmtasetompygfktzhpr.supabase.co';
const id='11111111-1111-4111-8111-111111111111',now=Math.floor(Date.now()/1000);
const jwt=[{alg:'HS256',typ:'JWT'},{sub:id,role:'authenticated',aud:'authenticated',exp:now+3600},'test'].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
const session={access_token:jwt,refresh_token:'test-only',expires_at:now+3600,expires_in:3600,token_type:'bearer',user:{id,email:'preview@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};
(async()=>{
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || (process.platform==='darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined),headless:true});
try {
const context=await browser.newContext({viewport:{width:1440,height:1100}});const errors=[];
let signedIn=false,billingDisabled=true,claimed=false,claimFail=true,googleEnabled=false;
await context.route(backend+'/**',async route=>{
 const req=route.request(),url=new URL(req.url());
 if(url.pathname==='/auth/v1/settings') return route.fulfill({json:{external:{google:googleEnabled,email:true}}});
 if(url.pathname==='/auth/v1/verify') {assert.equal(req.postDataJSON().token_hash,'test-exchange');assert.equal(req.postDataJSON().type,'magiclink');signedIn=true;return route.fulfill({json:session});}
 if(url.pathname==='/auth/v1/logout') {signedIn=false;return route.fulfill({status:204});}
 if(url.pathname==='/auth/v1/user')return route.fulfill({json:session.user});
 if(url.pathname==='/auth/v1/otp')return route.fulfill({json:{}});
 if(url.pathname.endsWith('winelens-link')){
  const body=req.postDataJSON();
  if(body.action==='mint'){
   assert.equal(req.headers().authorization,'Bearer '+jwt);
   return route.fulfill({json:{code:'ABCD-1234',expires_at:new Date(Date.now()+600000).toISOString()}});
  }
  assert.equal(body.code,'ABCD-1234');assert.equal(req.headers().authorization,undefined);
  if(claimFail||claimed)return route.fulfill({status:400,json:{error:'That code is invalid or expired. Get a new code on the wineLENS website.'}});
  claimed=true;return route.fulfill({json:{token_hash:'test-exchange',type:'magiclink'}});
 }
 if(url.pathname.endsWith('winelens-billing')){
  assert.equal(req.headers().authorization,'Bearer '+jwt);
  const body=req.postDataJSON();assert.equal(body.action,'status');
  return billingDisabled?route.fulfill({status:503,json:{error:'Subscriptions are not available yet. You have not been charged.'}}):route.fulfill({json:{checkout_available:true,pro:false,status:'free',can_manage:false,access_until:null,test_mode:true,trial_days:7,plans:[{plan:'monthly',amount:499,currency:'usd',interval:'month'},{plan:'annual',amount:3999,currency:'usd',interval:'year'}]}});
 }
 throw new Error('Unexpected account test path '+url.pathname);
});
await context.route(new URL('/api/**',base).href,route=>route.fulfill({json:{items:[],count:0}}));
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
await page.goto(base+'account.html?checkout=returned');
await page.getByText('Google sign-in is not available yet. Use a verified email link.').waitFor();
assert.equal(await page.getByRole('button',{name:'Continue with Google ↗'}).isDisabled(),true);
assert.equal(await page.locator('#dashboard').isVisible(),false);assert.equal(signedIn,false);
assert.equal(new URL(page.url()).search,'');
await page.getByLabel('Email address').fill('preview@example.test');await page.getByRole('button',{name:'Email me a sign-in link'}).click();
await page.getByText('Check your email. Open the sign-in link in this browser to finish.').waitFor();assert.equal(await page.locator('#dashboard').isVisible(),false);
await page.screenshot({path:path.join(output,'account-signin.png'),fullPage:true});
await page.evaluate(s=>localStorage.setItem('sb-mcmtasetompygfktzhpr-auth-token',JSON.stringify(s)),session);
await page.reload();await page.getByText('Subscriptions are not available yet. You have not been charged.').waitFor();
assert.equal(await page.locator('[data-plan]').count(),0);
await page.getByRole('button',{name:'Pair my glasses ↗'}).click();await page.getByLabel('Pairing code').filter({hasText:'ABCD-1234'}).waitFor();
await page.evaluate(()=>{const real=Date.now;Date.now=()=>real()+601000;});await page.getByText('Code expired. Get a new code to continue.').waitFor();assert.equal(await page.locator('#code').textContent(),'— — — —');
await page.reload();billingDisabled=false;await page.getByRole('button',{name:'Refresh membership'}).click();await page.getByText('TEST MODE',{exact:true}).waitFor();
assert.equal(await page.locator('[data-plan]').count(),2);
await page.getByRole('button',{name:'Pair my glasses ↗'}).click();await page.getByLabel('Pairing code').filter({hasText:'ABCD-1234'}).waitFor();
await page.screenshot({path:path.join(output,'account-paired-preview.png'),fullPage:true});
await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'account-mobile.png'),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.locator('#signin').waitFor({state:'visible'});assert.equal(await page.locator('#code').textContent(),'— — — —');assert.equal(await page.locator('#identity').textContent(),'');
// The companion accepts a website code and exchanges it using Supabase's auth client.
await page.goto(base);await page.getByRole('button',{name:'Sign in ↗',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Continue with Google ↗'}).count(),0);
await page.getByLabel('Pairing code').fill('ABCD-1234');await page.getByRole('button',{name:'Link this device'}).click();await page.getByText('That code is invalid or expired. Get a new code on the wineLENS website.').waitFor();assert.equal(signedIn,false);
claimFail=false;await page.getByRole('button',{name:'Link this device'}).click();await page.getByRole('button',{name:'My account ↗',exact:true}).waitFor();assert.equal(signedIn,true);
await page.getByRole('button',{name:'My account ↗',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('button',{name:'Sign in ↗',exact:true}).waitFor();
assert.equal(await page.evaluate(()=>localStorage.getItem('sb-mcmtasetompygfktzhpr-auth-token')),null);
assert.deepEqual(errors,[]);console.log('PASS: disabled Google; email requires verification; redirect does not grant access; billing outage; expiring pairing code; real SDK token exchange with mocked network; private-state cleanup; mobile layout.');
}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exit(1)});
