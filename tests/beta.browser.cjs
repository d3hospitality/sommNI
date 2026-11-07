const {chromium}=require('playwright');const assert=require('node:assert/strict');
const origin=process.env.WINELENS_TEST_ORIGIN||'http://127.0.0.1:5196',base=process.env.WINELENS_TEST_PATH||'/sommNI/',backend='https://mcmtasetompygfktzhpr.supabase.co';
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();let actions=[],errors=[],authCalls=[];
 page.on('pageerror',e=>errors.push(e.message));
 await context.route(backend+'/**',async route=>{
  const request=route.request();if(request.url().includes('/auth/')){authCalls.push(request.url());return route.abort();}
  assert.match(request.url(),/winelens-beta$/);assert.equal(request.headers().authorization,undefined);
  const body=request.postDataJSON();actions.push(body);
  if(body.action==='status')return route.fulfill({json:{free:true,account_required:false,research:true,audio:true,studio:false}});
  if(body.action==='research')return route.fulfill({json:{draft:{id:'33333333-3333-4333-8333-333333333333',result:{wine_name:'Estate red',producer:'Estate',vintage:2020,vintage_state:'year',region:'Region',country:'France',grape:'Cabernet',color:'Red',tasting_notes:'Cassis and cedar.'},report:'Sourced report',evidence:{sources:[{title:'Producer',url:'https://producer.example/wine'}],supports:[]}}}});
  if(body.action==='ask'){assert(body.library.some(w=>w.wine_name==='Estate red'));return route.fulfill({json:{answer:'A pairing answer.',sources:[],library_count:body.library.length}});}
  if(body.action==='audio')return route.fulfill({json:{url:'data:audio/mpeg;base64,SUQz',download_url:'data:audio/mpeg;base64,SUQz',script:'Cassis and cedar.'}});
  throw Error('Unexpected action '+body.action);
 });
 await page.goto(origin+base);await page.locator('#research-capabilities').filter({hasText:'Wine research connected'}).waitFor();
 assert.match(await page.locator('#wl-account').innerText(),/Free beta/);assert(!/sign in|billing|subscription/i.test(await page.locator('#app').innerText()));
 await page.getByRole('button',{name:'Winebrary',exact:true}).click();await page.locator('#wl-add').click();
 await page.locator('#wl-wine-form [name=wine_name]').fill('Guest bottle');await page.locator('#wl-wine-form [name=notes]').fill('My berries and spice.');await page.locator('#wl-wine-form button[type=submit]').click();
 await page.locator('#wl-edit').waitFor();await page.locator('#wl-photo').click();await page.locator('#wl-file').setInputFiles('public/photography/red.png');await page.locator('#wl-approve').click();await page.locator('#wl-edit').waitFor();
 assert.match(await page.locator('.wl-detail-photo img').getAttribute('src'),/^data:image\/png/);
 const notes=page.waitForEvent('download');await page.locator('[data-notes]').click();assert.match((await notes).suggestedFilename(),/notes.txt/);
 await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.reload();await page.getByRole('button',{name:'Winebrary',exact:true}).click();await page.locator('[data-wine]').filter({hasText:'Guest bottle'}).click();await page.locator('#wl-edit').click();await page.locator('#wl-wine-form [name=notes]').fill('Edited notes');await page.locator('#wl-wine-form button[type=submit]').click();await page.locator('.wl-notes').filter({hasText:'Edited notes'}).waitFor();await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.getByRole('button',{name:'Overview',exact:true}).click();await page.locator('#research-form [name=query]').fill('Estate red 2020');await page.locator('#research-submit').click();await page.locator('#research-confirm').waitFor();
 await page.locator('#research-confirm button').click();assert.equal(await page.locator('#research-saved-audio').count(),0);
 await page.locator('#research-confirm [name=confirmed]').check();await page.locator('#research-confirm button').click();await page.locator('#research-saved-audio').waitFor();
 await page.locator('#research-saved-audio [data-audio]').click();await page.locator('#research-saved-audio audio').waitFor();
 const mp3=page.waitForEvent('download');await page.locator('#research-saved-audio a[download]').click();await mp3;
 await page.locator('[data-mode=ask]').click();await page.locator('#research-question textarea').fill('What pairs with dinner?');await page.locator('#research-question button').click();await page.locator('#research-answer').filter({hasText:'A pairing answer.'}).waitFor();
 await page.getByRole('button',{name:'Winebrary',exact:true}).click();assert.equal(await page.locator('[data-wine]').count(),2);
 await page.locator('[data-wine]').filter({hasText:'Estate red'}).click();await page.locator('#wl-wine-audio audio').waitFor();assert.equal(actions.filter(x=>x.action==='audio').length,1,'cached audio reused');await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.locator('#wl-account').click();const backup=page.waitForEvent('download');await page.locator('#wl-export').click();assert.equal((await backup).suggestedFilename(),'winelens-beta-library.json');await page.getByRole('button',{name:'Close dialog',exact:true}).click();
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'../beta-free-mobile.png'});
 await page.locator('[data-wine]').filter({hasText:'Guest bottle'}).click();await page.locator('#wl-remove').click();await page.locator('#wl-confirm-remove').click();await page.getByRole('dialog').waitFor({state:'hidden'});await page.reload();await page.getByRole('button',{name:'Winebrary',exact:true}).click();assert.equal(await page.locator('[data-wine]').count(),1);
 const isolated=await browser.newContext(),other=await isolated.newPage();await other.route(backend+'/**',r=>r.fulfill({json:{research:false,audio:false}}));await other.goto(origin+base);await other.getByRole('button',{name:'Winebrary',exact:true}).click();await other.locator('#wl-first').waitFor();assert.equal(await other.locator('[data-wine]').count(),0);await isolated.close();
 assert.deepEqual(errors,[]);assert.deepEqual(authCalls,[]);console.log('Free beta browser: no auth, CRUD, photo, reload persistence, review/confirm, guest Q&A, notes/MP3 downloads and caching, export, deletion, device isolation, mobile passed.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
