const BASE = process.env.WL_BASE_URL || 'http://localhost:5186';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
(async()=>{
  const base=process.env.ATLAS_URL||(BASE + '/sommNI/');
  const browser=await chromium.launch({headless:true,channel:process.env.CI?undefined:'chrome'});
  try {
    const page=await browser.newPage({viewport:{width:1400,height:1200}});
    const errors=[];page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(new URL('atlas.html',base).href);await page.waitForFunction(()=>!!window.atlasPreview);
    assert.equal(await page.locator('#error').isVisible(),false,'plain browser must not try to take over a glasses page');
    await page.locator('#country').selectOption('NZL');assert.equal(await page.locator('#place-name').textContent(),'New Zealand');
    await page.locator('#country').selectOption('FRA');
    await page.locator('#explore').click();assert.equal(await page.locator('#level-label').textContent(),'REGION EXPLORER');
    await page.locator('#region').selectOption({label:'Bordeaux · 47'});
    assert.equal(await page.locator('#place-name').textContent(),'Bordeaux');
    await page.locator('#back').click();await page.locator('#back').click();assert.equal(await page.locator('#place-name').textContent(),'France');
    const results=await page.evaluate(async()=>{
      const {renderer,navigator:nav}=window.atlasPreview;
      const {buildAtlasPage,AtlasGlasses}=await import('./src/atlas/glasses.ts');
      const {AtlasTransport}=await import('./src/atlas/transport.ts');
      const {OsEventTypeList:E}=await import('@evenrealities/even_hub_sdk').catch(()=>import('./node_modules/.vite/deps/@evenrealities_even_hub_sdk.js'));
      const checks=[];function check(b,m){if(!b)throw new Error(m);checks.push(m);}
      const data=renderer.data;
      check(data.regions.length===2077,'2077 assigned source groups preserved');
      check(data.regions.reduce((s,r)=>s+r.count,0)+data.provenance.excluded.reduce((s,r)=>s+r.points,0)===34178,'source point accounting is lossless');
      check(data.regions.every(r=>data.countries.some(c=>c.code===r.country)),'every region has explicit country identity');
      check(renderer.countryAt(2.35,48.85)===data.countries.find(c=>c.code==='FRA').id,'Paris maps to France');
      check(renderer.countryAt(-122.42,37.77)===data.countries.find(c=>c.code==='USA').id,'California maps to USA');
      check(renderer.countryAt(174.78,-41.29)===data.countries.find(c=>c.code==='NZL').id,'New Zealand longitude is preserved');
      const time=performance.now();
      for(const country of nav.countries){const frame=renderer.render({country},244);check(frame.gray.length===244*244&&frame.gray.every(v=>v%17===0&&v<=204),`${country.code}: 16-level raster, bounded brightness`);check(frame.gray.some(v=>v>=136),`${country.code}: highlight or microstate locator visible`);}
      const renderMs=performance.now()-time;
      const frames=[];
      for(const mode of ['countries','regions','detail']){nav.mode=mode;const p=buildAtlasPage(nav);const all=[...p.textObject,...p.imageObject];check(all.every(c=>c.xPosition>=0&&c.yPosition>=0&&c.xPosition+c.width<=576&&c.yPosition+c.height<=288),`${mode}: bounded containers`);check(all.filter(c=>c.isEventCapture===1).length===1,`${mode}: one capture`);check(p.imageObject.every(c=>c.width<=288&&c.height<=144),`${mode}: image tile limits`);for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){const a=all[i],b=all[j];check(!(a.xPosition<b.xPosition+b.width&&a.xPosition+a.width>b.xPosition&&a.yPosition<b.yPosition+b.height&&a.yPosition+a.height>b.yPosition),`${mode}: ${i}/${j} no overlap`);}}
      nav.mode='countries';
      let inFlight=0,peak=0;const calls=[];
      const call=async(kind,arg)=>{peak=Math.max(peak,++inFlight);await new Promise(r=>setTimeout(r,8));calls.push({kind,arg});inFlight--;return kind==='startup'?0:kind==='image'?'success':true;};
      const mock={createStartUpPageContainer:p=>call('startup',p),rebuildPageContainer:p=>call('page',p),textContainerUpgrade:p=>call('text',p),updateImageRawData:p=>call('image',p)};
      const g=new AtlasGlasses(mock,nav,renderer,()=>{},e=>{throw e;});await g.open(true);
      for(let i=0;i<5;i++)g.handle({textEvent:{eventType:E.SCROLL_BOTTOM_EVENT}});
      await new Promise(r=>setTimeout(r,500));await g.close();
      check(peak===1,'all bridge sends serialized');
      check(nav.country.code==='ARG','rapid scroll ends at Argentina');
      check(calls.filter(c=>c.kind==='image').length===2,'superseded selections send no obsolete image pairs');
      check(calls.filter(c=>c.kind==='text'&&c.arg.containerName==='atlas-rows').at(-1).arg.content.includes('> Argentina'),'text and globe share final selection');
      check(!g.handle({textEvent:{eventType:E.SCROLL_BOTTOM_EVENT}}),'closed Atlas relinquishes input');
      await g.open();g.handle({sysEvent:{eventSource:1}});check(nav.mode==='regions','omitted protobuf zero-valued click enters regions');g.handle({sysEvent:{eventSource:1}});check(nav.mode==='detail','second zero-valued click focuses region');g.handle({sysEvent:{eventType:3}});check(nav.mode==='regions','double tap returns one level');await g.close();
      let fault='';const q=new AtlasTransport(e=>{fault=e.message;},20);let late=false;
      q.enqueue([()=>new Promise(()=>{})]);await new Promise(r=>setTimeout(r,35));q.enqueue([async()=>{late=true;}]);await new Promise(r=>setTimeout(r,20));check(!!fault&&!late,'hung bridge pauses subsequent sends');
      return {checks:checks.length,renderMs,countries:nav.countries.length,bridgeCalls:calls.length};
    });
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile has no horizontal overflow');
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('ATLAS PASS',JSON.stringify(results));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
