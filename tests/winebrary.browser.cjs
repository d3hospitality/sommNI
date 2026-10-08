const { serveG2Bottles } = require('./g2-backend.cjs');
const BASE = process.env.WL_BASE_URL || 'http://localhost:5186';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const output=process.env.WINELENS_TEST_OUTPUT || require('os').tmpdir()+'/winelens-browser-tests';fs.mkdirSync(output,{recursive:true});
const user='11111111-1111-4111-8111-111111111111';
const wine='22222222-2222-4222-8222-222222222222';
const now=Math.floor(Date.now()/1000);const jwt=[{alg:'HS256',typ:'JWT'},{sub:user,role:'authenticated',aud:'authenticated',exp:now+3600},'test'].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
const session={access_token:jwt,refresh_token:'local-test-only',expires_at:now+3600,expires_in:3600,token_type:'bearer',user:{id:user,email:'test@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};
const card=require('../shared/rate-card.json');
const draftNotes={appearance:'Deep ruby with a purple rim.',nose:'Blackberry, violet, cocoa, graphite.',palate:'Full Body, Ripe Tannins. Dark fruit with fresh lift.',finish:'Long, spiced and generous.',story:'',confidence:.8};
const notesText=['LOOK  '+draftNotes.appearance,'NOSE  '+draftNotes.nose,'PALATE  '+draftNotes.palate,'FINISH  '+draftNotes.finish].join('\n\n');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || (process.platform==='darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined),headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1050}});await serveG2Bottles(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let items=[],adds=[],updates=[],attach=[],notes=[],noteCalls=0,renderFail=true;const sharedKeys=new Set();
 const status={pro:true,plan:'pro',tokens:100,auto_spend:false,scan_available:true,rate_card:card,allowances:{label_scan:{remaining:60,limit:60},tasting_notes:{remaining:60,limit:60},studio_render:{remaining:10,limit:10}}};
 await page.route('https://mcmtasetompygfktzhpr.supabase.co/auth/**',route=>route.fulfill({json:session.user}));
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),body=req.postDataJSON();
  if(url.pathname==='/api/device-link')return route.fulfill({json:body.action==='redeem'?{session,device_id:wine}:{status:'linked',removed:true}});
  assert.equal(req.headers().authorization,'Bearer '+jwt);
  if(url.pathname==='/api/billing')return route.fulfill({json:status});
  if(url.pathname==='/api/study')return route.fulfill({json:body.action==='pull'?{events:[]}:{accepted:[],duplicates:[],rejected:[]}});
  if(url.pathname==='/api/winebrary'){
   const a=body.action;
   if(a==='list')return route.fulfill({json:{items,count:items.length}});
   if(a==='add'){adds.push(body);const item={id:adds.length===1?wine:require('crypto').randomUUID(),user_id:user,wine_name:body.wine_name,producer:body.producer||null,region:body.region||null,notes:body.notes||null,wine_id:body.wine_id||null,vintage:body.vintage_state==='year'?Number(body.vintage):null,metadata:{vintage_state:body.vintage_state,color:body.color,country:body.country,grape:body.grape,notes_source:body.notes_source}};items.unshift(item);return route.fulfill({json:{item}});}
   if(a==='update'){updates.push(body);const item=items.find(w=>w.id===body.id);Object.assign(item,{wine_name:body.wine_name,notes:body.notes});return route.fulfill({json:{item}});}
   if(a==='set-notes'){notes.push(body);const item=items.find(w=>w.id===body.id);item.notes=body.notes;item.metadata.notes_source=body.notes_source;return route.fulfill({json:{item}});}
   if(a==='upload-photo'){assert.match(body.photo,/^data:image\/png;base64,/);return route.fulfill({json:{draft:{path:`${user}/${wine}/original.png`,source:'photograph',url:(BASE + '/sommNI/photography/red.png')}}});}
   if(a==='attach-image'){attach.push(body);const item=items.find(w=>w.id===body.id);item.metadata.image_path=body.image_path;item.metadata.image_source=body.image_source;item.image_url=(BASE + '/sommNI/photography/red.png');return route.fulfill({json:{item}});}
   if(a==='remove'){items=items.filter(w=>w.id!==body.id);return route.fulfill({json:{deleted:1}});}
  }
  if(url.pathname==='/api/wine-notes'){
   const item=items.find(w=>w.id===body.collection_id),key=`${item.producer}|${item.wine_name}|${item.vintage}`;
   if(body.check)return route.fulfill({json:{available:sharedKeys.has(key)}});
   if(sharedKeys.has(key))return route.fulfill({json:{draft:{...draftNotes,text:notesText,model:'test'},shared:true,charged:false,review_required:true}});
   const t=status.allowances.tasting_notes;if(t.remaining===0)assert.equal(body.spend_consent,true,'tokens only with consent');
   noteCalls++;sharedKeys.add(key);assert.match(body.request_id,/^[0-9a-f-]{36}$/);return route.fulfill({json:{draft:{...draftNotes,text:notesText,model:'test'},shared:false,charged:true,review_required:true}});}
  if(url.pathname==='/api/bottle-render'){assert.equal(body.reference_path,`${user}/${wine}/original.png`);return renderFail?route.fulfill({status:502,json:{error:'The rendering did not finish. Your allowance or tokens were returned.'}}):route.fulfill({json:{draft:{path:`${user}/${wine}/render.png`,source:'generated',url:(BASE + '/sommNI/photography/red.png')}}});}
  return route.fulfill({status:404,json:{error:'Unhandled test path '+url.pathname}});
 });
 await page.goto((BASE + '/sommNI/'));await page.getByRole('button',{name:'Link account ↗',exact:true}).click();await page.getByLabel('Link code').fill('ABCD-2345');await page.getByRole('button',{name:'Link this device',exact:true}).click();await page.getByRole('button',{name:'My account ↗',exact:true}).waitFor();
 await page.getByRole('button',{name:'Winebrary',exact:true}).click();
 await page.getByRole('button',{name:'＋ Add a wine',exact:true}).first().click();
 await page.getByLabel('Wine name',{exact:true}).fill('Grand Malbec');await page.getByLabel('Producer',{exact:true}).fill('Terrazas de los Andes');
 await page.getByLabel('Vintage',{exact:true}).selectOption('year');await page.getByLabel('Year',{exact:true}).fill('2017');await page.getByLabel('Region',{exact:true}).fill('Mendoza');
 await page.getByLabel('Country',{exact:true}).fill('Argentina');await page.getByLabel('Grape',{exact:true}).fill('Malbec');
 await page.getByRole('button',{name:'Save to Winebrary ↗',exact:true}).click();await page.getByRole('dialog').getByRole('heading',{name:'Grand Malbec',exact:true}).waitFor();
 assert.equal(adds[0].vintage,'2017');assert.equal(adds[0].vintage_state,'year');assert.equal(adds[0].notes_source,undefined,'no notes, no source');
 await page.getByText('No notes yet. Write your own, or get wineLENS notes for this bottle and vintage.').waitFor();
 // Tasting notes: one cost panel, then a reviewed draft.
 await page.getByRole('button',{name:'✦ Get tasting notes'}).click();
 await page.getByText('Included with Pro · 60 of 60 left this month').waitFor();
 await page.getByRole('button',{name:'Get tasting notes ✦'}).click();
 await page.getByText(draftNotes.nose).waitFor();assert.equal(noteCalls,1);assert.equal(notes.length,0,'not saved before review');
 await page.getByRole('button',{name:'Save to my notes ↗'}).click();await page.getByText('wineLENS notes · the expected profile, not a tasting').first().waitFor();
 assert.equal(notes[0].notes,notesText);assert.equal(notes[0].notes_source,'generated');
 await page.locator('.wl-notes-dl dt',{hasText:'PALATE'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'✦ Get tasting notes'}).count(),0,'nothing new to draft once wineLENS notes are saved');
 // Photo + Studio image.
 await page.getByRole('button',{name:'Add bottle photo ↗',exact:true}).click();
 await page.getByText('Included with Pro · 10 of 10 left this month').waitFor();
 assert.equal(await page.getByRole('button',{name:'Create studio image ✦'}).isDisabled(),true,'needs a photo first');
 await page.locator('#wl-file').setInputFiles(path.resolve(__dirname,'../public/photography/red.png'));
 await page.getByText('Photo ready. Use it as it is, or create a studio image.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Create studio image ✦'}).click();await page.getByText('The rendering did not finish. Your allowance or tokens were returned.',{exact:true}).waitFor();assert.equal(items.length,1);
 renderFail=false;await page.getByRole('button',{name:'Create studio image ✦'}).click();await page.getByText('Compare the label and vintage with your photo before using this image.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Use this image',exact:true}).click();await page.getByRole('dialog').getByRole('heading',{name:'Grand Malbec',exact:true}).waitFor();assert.equal(attach[0].image_source,'generated');
 await page.waitForTimeout(250);await page.locator('#wl-g2-preview').screenshot({path:path.resolve(output,'wineLENS-G2-Display-Preview.png')});
 await page.getByRole('button',{name:'Show on glasses ↗'}).click();await page.getByText('Open wineLENS in Even Hub and connect your G2 glasses first.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'＋ Add another vintage'}).click();assert.equal(await page.getByLabel('Year',{exact:true}).inputValue(),'');await page.getByLabel('Year',{exact:true}).fill('2020');
 await page.getByRole('button',{name:'Save to Winebrary ↗',exact:true}).click();await page.getByRole('dialog').getByRole('heading',{name:'Grand Malbec',exact:true}).waitFor();assert.equal(items.length,2);assert.equal(items[1].vintage,2017);assert.equal(items[0].vintage,2020);assert.equal(items[0].metadata.image_path,undefined);assert.equal(items[0].notes,null,'new vintage starts without notes');
 // A new vintage is a new bottle: after the Pro allowance, tokens need an explicit tick.
 status.allowances.tasting_notes.remaining=0;
 await page.getByRole('button',{name:'✦ Get tasting notes'}).click();
 await page.getByText('Pro allowance used · uses 1 token (100 left)').waitFor();
 assert.equal(await page.getByRole('button',{name:'Get tasting notes ✦'}).isDisabled(),true,'tokens need consent');
 await page.getByLabel('Use 1 token for this').check();assert.equal(await page.getByRole('button',{name:'Get tasting notes ✦'}).isDisabled(),false);
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 // The same bottle + vintage added again (as anyone would): the notes already exist, so they are free and nothing runs.
 await page.getByRole('button',{name:'＋ Add a wine',exact:true}).first().click();
 await page.getByLabel('Wine name',{exact:true}).fill('Grand Malbec');await page.getByLabel('Producer',{exact:true}).fill('Terrazas de los Andes');
 await page.getByLabel('Vintage',{exact:true}).selectOption('year');await page.getByLabel('Year',{exact:true}).fill('2017');
 await page.getByRole('button',{name:'Save to Winebrary ↗',exact:true}).click();await page.getByRole('dialog').getByRole('heading',{name:'Grand Malbec',exact:true}).waitFor();
 await page.getByRole('button',{name:'✦ Get tasting notes'}).click();
 await page.getByText('Already in wineLENS for this bottle and vintage · free').waitFor();
 assert.equal(await page.getByLabel('Use 1 token for this').isVisible(),false,'no consent needed for existing notes');
 await page.getByRole('button',{name:'Get tasting notes ✦'}).click();
 await page.getByText('These notes were already in wineLENS for this bottle and vintage. Nothing was charged.').waitFor();
 assert.equal(noteCalls,1,'the job ran once for 2017');
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.screenshot({path:path.resolve(output,'wineLENS-Winebrary-Preview.png'),fullPage:true});
 await page.getByRole('button',{name:'My account ↗'}).click();await page.getByText('wineLENS Pro · 100 tokens').waitFor();await page.getByRole('button',{name:'Unlink this device',exact:true}).click();await page.getByRole('button',{name:'Link account ↗',exact:true}).waitFor();assert.equal(await page.locator('[data-wine]').count(),0);
 const mobile=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});await serveG2Bottles(mobile);await mobile.goto((BASE + '/sommNI/'));await mobile.evaluate(()=>document.fonts.ready);await mobile.waitForTimeout(500);await mobile.screenshot({path:path.resolve(output,'wineLENS-Revamp-Mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:['code-linked account session','private Winebrary add','explicit vintage','tasting notes: cost line, reviewed draft, explicit save','token consent gate','same bottle + vintage reused free (job ran once)','photo upload','studio failure preserves wine','approve studio image','G2 disconnected state','add another vintage preserves original','unlink clears collection'],errors}));
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
