const {chromium}=require('playwright');const assert=require('node:assert/strict');
const origin='http://127.0.0.1:5196',backend='https://mcmtasetompygfktzhpr.supabase.co',user='11111111-1111-4111-8111-111111111111',draftId='33333333-3333-4333-8333-333333333333',now=Math.floor(Date.now()/1000);
const jwt=[{alg:'HS256',typ:'JWT'},{sub:user,role:'authenticated',aud:'authenticated',exp:now+3600},'test'].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');
const session={access_token:jwt,refresh_token:'test-only',expires_at:now+3600,expires_in:3600,token_type:'bearer',user:{id:user,email:'test@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}};
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],actions=[];let items=[],fail=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(s=>{if(window===window.top)localStorage.setItem('sb-mcmtasetompygfktzhpr-auth-token',JSON.stringify(s))},session);
 const draft={id:draftId,query:'Estate',result:{wine_name:'Estate red',producer:'Estate',vintage:2020,vintage_state:'year',region:'Region',country:'France',grape:'Cabernet',color:'Red',tasting_notes:'Producer describes cassis and cedar.',uncertainty:'Check the cuvée and harvest year.'},report:'Producer report. <script>window.bad=true</script>',evidence:{sources:[{index:0,title:'Producer',url:'https://producer.example/wine'}],supports:[{text:'Cassis',sources:[0]}]},search_html:'<div>Google Search suggestions</div><script>window.parent.bad=true</script>',image_path:user+'/'+draftId+'/reference.jpg'};
 await page.route(backend+'/**',async route=>{
  const url=new URL(route.request().url());
  if(url.pathname.startsWith('/auth/'))return route.fulfill({json:session.user});
  if(url.pathname.startsWith('/storage/'))return route.fulfill({contentType:'audio/mpeg',body:Buffer.from([73,68,51])});
  if(!url.pathname.endsWith('winelens-research'))return route.fulfill({json:[]});
  const body=route.request().postDataJSON();actions.push(body);assert.equal(route.request().headers().authorization,'Bearer '+jwt);
  if(body.action==='status')return route.fulfill({json:{research:true,audio:true}});
  if(body.action==='research') {if(fail)return route.fulfill({status:502,json:{error:'Research unavailable. Nothing saved.'}});return route.fulfill({json:{draft:body.query.includes('2021')?{...draft,result:{...draft.result,vintage:2021}}:draft}});}
  if(body.action==='drafts')return route.fulfill({json:{drafts:[draft]}});
  if(body.action==='confirm'){assert.equal(body.confirmed,true);const item={id:draftId,wine_name:body.review.wine_name,producer:'Estate',region:'Region',vintage:body.review.vintage,notes:'',image_url:origin+'/sommNI/photography/red.png',metadata:{tasting_notes:body.review.tasting_notes,research_sources:draft.evidence,image_path:draft.image_path,vintage_state:'year'}};items=[item];return route.fulfill({json:{item}});}
  if(body.action==='audio_status')return route.fulfill({json:{available:false,configured:true}});
  if(body.action==='audio')return route.fulfill({json:{url:backend+'/storage/v1/object/sign/winelens-audio/test.mp3',download_url:backend+'/storage/v1/object/sign/winelens-audio/test.mp3?download=',script:'Reviewed reference tasting notes. Cassis and cedar.'}});
  if(body.action==='ask')return route.fulfill({json:{answer:'Try the Estate red with mushrooms; compare acidity and texture.',sources:draft.evidence.sources,supports:[],search_html:draft.search_html,library_count:1}});
 });
 await page.route(origin+'/api/**',route=>route.fulfill({json:{items,count:items.length}}));
 await page.goto(origin+'/sommNI/');await page.locator('#research-capabilities').filter({hasText:'Wine research connected'}).waitFor();
 await page.locator('#research-form [name=query]').fill('Estate 2020');
 await page.locator('#research-photo').setInputFiles('public/photography/red.png');await page.locator('#research-feedback').filter({hasText:'Photo ready'}).waitFor();
 await page.locator('#research-submit').click();await page.locator('#research-confirm').waitFor();assert.equal(items.length,0);
 assert.match(actions.find(x=>x.action==='research').photo,/^data:image\/jpeg;base64,/);
 assert.equal(await page.evaluate(()=>window.bad),undefined);
 await page.locator('#research-confirm [name=vintage]').fill('2021');
 await page.locator('#research-confirm button').click();assert.equal(actions.filter(x=>x.action==='confirm').length,0,'Checkbox required');
 await page.locator('#research-confirm [name=confirmed]').check();
 await page.locator('#wine-research').screenshot({path:'../research-review-desktop.png'});
 await page.locator('#research-confirm button').click();await page.locator('#research-feedback').filter({hasText:'Corrected identity researched'}).waitFor();assert.equal(items.length,0);await page.locator('#research-confirm [name=confirmed]').check();await page.locator('#research-confirm button').click();await page.locator('#research-feedback').filter({hasText:'Wine saved'}).waitFor();assert.equal(items[0].vintage,2021);
 const download=page.waitForEvent('download');await page.locator('#research-saved-audio [data-notes]').click();assert.match((await download).suggestedFilename(),/notes\.txt$/);
 await page.locator('#research-saved-audio [data-audio]').click();await page.locator('#research-saved-audio audio').waitFor();assert.match(await page.locator('#research-saved-audio a[download]').getAttribute('href'),/winelens-audio/);
 await page.locator('[data-mode=ask]').click();await page.locator('#research-question textarea').fill('What should I pair with mushrooms?');await page.locator('#research-question button').click();await page.locator('#research-answer').filter({hasText:'Try the Estate'}).waitFor();assert.equal(actions.find(x=>x.action==='ask').use_library,true);
 await page.locator('[data-mode=research]').click();await page.locator('#research-resume').click();await page.locator('#research-confirm').waitFor();
 for(const width of [320,390,760,1024]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'overflow '+width);}
 await page.setViewportSize({width:390,height:844});await page.locator('#wine-research').screenshot({path:'../research-review-mobile.png'});
 fail=true;await page.locator('#research-submit').click();await page.locator('#research-feedback').filter({hasText:'Nothing saved'}).waitFor();assert.equal(items.length,1);assert.equal(await page.locator('#research-confirm').count(),0);
 await page.getByRole('button',{name:'Winebrary',exact:true}).click();await page.locator('[data-wine]').first().click();await page.getByRole('dialog').getByText('Producer describes cassis and cedar.',{exact:true}).waitFor();
 const native=await page.evaluate(async wine=>{const G=await import('/sommNI/src/winebrary-glasses.ts');return G.buildLibraryWinePage(wine).textObject.map(x=>x.content).join('\n')},items[0]);assert.match(native,/Reference notes: Producer describes cassis/);
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.getByRole('button',{name:'My account ↗',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.locator('#research-account').filter({hasText:'Sign in'}).waitFor({state:'attached'});assert.equal(await page.locator('#research-review').textContent(),'');assert.equal(await page.locator('#research-answer').textContent(),'');
 assert.deepEqual(errors,[]);console.log('Research browser: photo → sourced review → explicit confirm → library/G2 notes → downloads/audio, ask, failure, responsive and signout passed.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
