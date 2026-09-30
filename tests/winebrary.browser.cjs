const BASE = process.env.WL_BASE_URL || 'http://localhost:5186';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const output=process.env.WINELENS_TEST_OUTPUT || require('os').tmpdir()+'/winelens-browser-tests';fs.mkdirSync(output,{recursive:true});
const user='11111111-1111-4111-8111-111111111111';
const wine='22222222-2222-4222-8222-222222222222';
const now=Math.floor(Date.now()/1000);const jwt=[{alg:'HS256',typ:'JWT'},{sub:user,role:'authenticated',aud:'authenticated',exp:now+3600},'test'].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
const session={access_token:jwt,refresh_token:'local-test-only',expires_at:now+3600,expires_in:3600,token_type:'bearer',user:{id:user,email:'test@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || (process.platform==='darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined),headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let items=[],posts=[],patches=[],renderFail=true;

 await page.route('https://mcmtasetompygfktzhpr.supabase.co/auth/**',route=>route.fulfill({json:session.user}));
 await page.route('**/api/device-link',route=>route.fulfill({json:route.request().postDataJSON().action==='redeem'?{session,device_id:wine}:{status:'linked',removed:true}}));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),body=req.postDataJSON();
  if(url.pathname==='/api/device-link')return route.fulfill({json:body.action==='redeem'?{session,device_id:wine}:{status:'linked',removed:true}});
  assert.equal(req.headers().authorization,'Bearer '+jwt);
  if(url.pathname==='/api/billing')return route.fulfill({json:{pro:true,tokens:100,auto_spend:false,rate_card:require('../shared/rate-card.json'),allowances:{studio_render:{remaining:10,limit:10}}}});
  if(url.pathname==='/api/collection'){
   if(req.method()==='GET')return route.fulfill({json:{items,count:items.length}});
   if(req.method()==='POST'){posts.push(body);const item={...body,id:posts.length===1?wine:'33333333-3333-4333-8333-333333333333',user_id:user,vintage:body.vintage_state==='year'?Number(body.vintage):null,metadata:{vintage_state:body.vintage_state,color:body.color,country:body.country,grape:body.grape}};items.unshift(item);return route.fulfill({status:201,json:{item}});}
   if(req.method()==='PATCH'){patches.push(body);const item=items.find(w=>w.id===body.id);if(body.image_path){item.metadata.image_path=body.image_path;item.metadata.image_source=body.image_source;item.image_url=(BASE + '/sommNI/photography/red.png');}else Object.assign(item,body);return route.fulfill({json:{item}});}
  }
  if(url.pathname==='/api/bottle-image')return route.fulfill({status:201,json:{draft:{path:`${user}/${wine}/original.png`,source:'photograph',url:(BASE + '/sommNI/photography/red.png')}}});
  if(url.pathname==='/api/generate-bottle')return renderFail?route.fulfill({status:502,json:{error:'Studio unavailable. Your wine is saved.'}}):route.fulfill({json:{draft:{path:`${user}/${wine}/render.png`,source:'generated',url:(BASE + '/sommNI/photography/red.png')}}});
  return route.fulfill({status:404,json:{error:'Unhandled test path'}});
 });
 await page.goto((BASE + '/sommNI/'));await page.getByRole('button',{name:'Link account ↗',exact:true}).click();await page.getByLabel('Link code').fill('ABCD-2345');await page.getByRole('button',{name:'Link this device',exact:true}).click();await page.getByRole('button',{name:'My account ↗',exact:true}).waitFor();
 await page.getByRole('button',{name:'Winebrary',exact:true}).click();
 await page.getByRole('button',{name:'＋ Add a wine',exact:true}).click();
 await page.getByLabel('Wine name',{exact:true}).fill('Grand Malbec');await page.getByLabel('Producer',{exact:true}).fill('Terrazas de los Andes');
 await page.getByLabel('Vintage',{exact:true}).selectOption('year');await page.getByLabel('Year',{exact:true}).fill('2017');await page.getByLabel('Region',{exact:true}).fill('Mendoza');
 await page.getByLabel('Country',{exact:true}).fill('Argentina');await page.getByLabel('Grape',{exact:true}).fill('Malbec');
 await page.getByLabel('Your tasting notes').fill('Black fruit, fresh acidity and a generous finish.');
 await page.getByRole('button',{name:'Save to Winebrary ↗',exact:true}).click();await page.getByRole('dialog').getByRole('heading',{name:'Grand Malbec',exact:true}).waitFor();
 assert.equal(posts[0].vintage,'2017');assert.equal(posts[0].vintage_state,'year');
 await page.getByRole('button',{name:'Add bottle photo ↗',exact:true}).click();
 await page.locator('#wl-file').setInputFiles(path.resolve(__dirname,'../public/photography/red.png'));
 await page.getByText('Photo ready. Use it now, or create a rendering.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Create studio rendering ↗'}).click();await page.getByText('Studio unavailable. Your wine is saved.',{exact:true}).waitFor();assert.equal(items.length,1);
 renderFail=false;await page.getByRole('button',{name:'Create studio rendering ↗'}).click();await page.getByText('Compare the label and vintage with your photo before using this rendering.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Use this image',exact:true}).click();await page.getByRole('dialog').getByRole('heading',{name:'Grand Malbec',exact:true}).waitFor();assert.equal(patches[0].image_source,'generated');
 await page.waitForTimeout(250);await page.locator('#wl-g2-preview').screenshot({path:path.resolve(output,'wineLENS-G2-Display-Preview.png')});
 await page.getByRole('button',{name:'Show on glasses ↗'}).click();await page.getByText('Open wineLENS in Even Hub and connect your G2 glasses first.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'＋ Add another vintage'}).click();assert.equal(await page.getByLabel('Year',{exact:true}).inputValue(),'');await page.getByLabel('Year',{exact:true}).fill('2020');
 await page.getByRole('button',{name:'Save to Winebrary ↗',exact:true}).click();await page.getByRole('dialog').getByRole('heading',{name:'Grand Malbec',exact:true}).waitFor();assert.equal(items.length,2);assert.equal(items[1].vintage,2017);assert.equal(items[0].vintage,2020);assert.equal(items[0].metadata.image_path,undefined);
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.screenshot({path:path.resolve(output,'wineLENS-Winebrary-Preview.png'),fullPage:true});
 await page.getByRole('button',{name:'My account ↗'}).click();await page.getByRole('button',{name:'Unlink this device',exact:true}).click();await page.getByRole('button',{name:'Link account ↗',exact:true}).waitFor();assert.equal(await page.locator('[data-wine]').count(),0);
 const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});await mobile.goto((BASE + '/sommNI/'));await mobile.evaluate(()=>document.fonts.ready);await mobile.waitForTimeout(500);await mobile.screenshot({path:path.resolve(output,'wineLENS-Revamp-Mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:['code-linked account session','private collection POST','explicit vintage','upload photo','generation failure preserves wine','approve rendering','G2 disconnected state','add another vintage preserves original','signout clears collection'],errors}));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
