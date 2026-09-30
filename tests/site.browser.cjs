const {chromium}=require('playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const BASE=process.env.WL_SITE_URL||'http://127.0.0.1:5187';
const ORIGIN='https://sommni-beige.vercel.app';
const output=process.env.WINELENS_SITE_OUTPUT||path.resolve(__dirname,'../../../outputs/wineLENS-site');fs.mkdirSync(output,{recursive:true});
const root=path.resolve(__dirname,'../dist-site');
const user='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const now=Math.floor(Date.now()/1000);const jwt=[{alg:'HS256',typ:'JWT'},{sub:user,role:'authenticated',aud:'authenticated',exp:now+3600,session_id:id},'test'].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
const session={access_token:jwt,refresh_token:'mock-only',expires_at:now+3600,expires_in:3600,token_type:'bearer',user:{id:user,email:'romario@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.ttf':'font/ttf','.webp':'image/webp','.glb':'model/gltf-binary'};
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true});
 try{
 for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:width===390?844:1000},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));let models=0;
  page.on('request',r=>{if(r.url().endsWith('.glb'))models++;});
  // No external network is needed by the landing page or the localhost account preview.
  await page.route('**/*',r=>r.request().url().startsWith(BASE)?r.continue():r.abort());
  await page.goto(BASE);await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'landing horizontal overflow');
  assert.equal(models,0,'model stays lazy until requested');
  if(width===390){await page.getByRole('button',{name:/Menu/}).click();await page.getByRole('navigation',{name:'Main',exact:true}).getByRole('link',{name:'Study',exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:/Menu/}).getAttribute('aria-expanded'),'false');}
  await page.screenshot({path:path.join(output,`landing-${width}.png`),fullPage:true});
  await page.screenshot({path:path.join(output,`landing-hero-${width}.png`)});
  await page.getByText('Is wineLENS free?',{exact:true}).click();assert(await page.getByText(/Yes, wineLENS is free during beta/).isVisible());
  // The 3D showcase loads itself as its section nears the viewport (poster first), then turns with the page.
  await page.locator('[data-g2b]').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>/is-live|is-video/.test(document.querySelector('.g2b').className),null,{timeout:30000});assert.equal(models,1);
  await page.getByRole('button',{name:'Atlas',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-g2b-beat=atlas]').getAttribute('aria-pressed')==='true');
  await page.waitForTimeout(1500);await page.locator('.g2b-stage').screenshot({path:path.join(output,`g2-composite-${width}.png`)});
  await page.goto(BASE+'/link');await page.getByText('This is a preview. Google sign-in and account linking are disabled here.').waitFor();assert(await page.getByRole('button',{name:'Continue with Google ↗'}).isDisabled());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(output,`link-signed-out-${width}.png`),fullPage:true});
  for(const policy of ['privacypolicy','terms']){await page.goto(BASE+'/'+policy);assert.equal(await page.locator('h1').count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  assert.deepEqual(errors,[]);await page.close();
  const signed=await browser.newPage({viewport:{width,height:width===390?844:1000},reducedMotion:'reduce'});const signedErrors=[];signed.on('pageerror',e=>signedErrors.push(e.message));
  let linked=false,devices=[{id,label:'Even G2',linked_at:new Date().toISOString(),last_seen_at:new Date().toISOString()}],deleted=0,issues=0;
  await signed.addInitScript(s=>localStorage.setItem('winelens_site_session_v1',JSON.stringify(s)),session);
  // Production bundle, canonical browser origin, entirely local route fulfillment.
  await signed.route('**/*',async r=>{
   const u=new URL(r.request().url());
   if(u.hostname==='mcmtasetompygfktzhpr.supabase.co')return r.fulfill({json:u.pathname.endsWith('/settings')?{external:{google:false}}:session.user});
   if(u.origin!==ORIGIN)return r.abort();
   if(u.pathname==='/api/device-link'){
    const body=r.request().postDataJSON();assert.equal(r.request().headers().authorization,'Bearer '+jwt);
    if(body.action==='issue'){issues++;return r.fulfill({json:{id,code:'7KMP-4N9Q',expires_at:new Date(Date.now()+600000).toISOString()}});}
    if(body.action==='issued-status')return r.fulfill({json:{status:linked?'linked':'pending'}});
    if(body.action==='list')return r.fulfill({json:{devices}});
    if(body.action==='revoke'){devices=[];return r.fulfill({json:{removed:true}});}
    if(body.action==='delete-account'){assert.equal(body.confirm,'DELETE');deleted++;return r.fulfill({json:{deleted:true}});}
    throw new Error('Unexpected action '+body.action);
   }
   const file=path.join(root,u.pathname==='/'?'index.html':u.pathname==='/link'?'link.html':u.pathname);
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return r.fulfill({status:404,body:''});
   return r.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
  });
  await signed.goto(ORIGIN+'/link');await signed.getByText('7KMP-4N9Q',{exact:true}).waitFor();await signed.evaluate(()=>document.fonts.ready);
  assert.equal(issues,1);assert.equal(await signed.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await signed.screenshot({path:path.join(output,`link-signed-in-mocked-${width}.png`),fullPage:true});
  await signed.getByRole('button',{name:'Copy code',exact:true}).click();await signed.waitForFunction(()=>/copied|Copy is unavailable/.test(document.getElementById('status').textContent));
  linked=true;await signed.getByText('Linked — open wineLENS on your glasses.').waitFor({timeout:10000});assert(await signed.getByRole('button',{name:'Copy code',exact:true}).isDisabled());
  await signed.getByRole('button',{name:'Revoke Even G2',exact:true}).click();await signed.getByText('No devices linked yet.',{exact:true}).waitFor();
  await signed.getByRole('button',{name:'New code ↻',exact:true}).click();await signed.getByText('7KMP-4N9Q',{exact:true}).waitFor();assert.equal(issues,2);
  await signed.getByRole('button',{name:'Delete account',exact:true}).click();assert.equal(deleted,0);await signed.getByRole('button',{name:'Keep my account',exact:true}).click();assert.equal(deleted,0);
  await signed.getByRole('button',{name:'Delete account',exact:true}).click();await signed.getByLabel('Type DELETE to confirm').fill('DELETE');await signed.getByRole('button',{name:'Permanently delete account',exact:true}).click();await signed.getByText('Your account and cloud data have been deleted.').waitFor();assert.equal(deleted,1);
  assert.deepEqual(signedErrors,[]);await signed.close();
 }
 console.log('PASS: 390/1440 layouts, clean URLs, mobile navigation, FAQ, lazy 3D showcase, screen selection, signed-out preview, mocked production sign-in/code/poll/revoke/delete, screenshots');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
