const TEST_ORIGIN = process.env.WINELENS_TEST_ORIGIN || 'http://localhost:5186';
// G2 navigation + content-limit tests against a mock Even bridge (no glasses, no network).
// Limits come from simulator 0.9.5 probes: list rows ≤ 63 UTF-8 bytes, text ≤ 999 bytes, ≤ 20 rows.
// Needs the dev server on the dev server (npm run dev; WINELENS_TEST_ORIGIN can override its origin).
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || (process.platform==='darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined),headless:true});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{ if(m.type()==='error'||process.env.VERBOSE) console.log('[page]',m.type(),m.text()); });
 // Exercise the mock bridge in isolation: Main.ts would otherwise overwrite
 // connection state asynchronously while these direct module tests are running.
 await page.route(TEST_ORIGIN+'/sommNI/', route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>G2 navigation test</title>'}));
 await page.goto(TEST_ORIGIN+'/sommNI/');
 const result=await page.evaluate(async()=>{
  const L=await import('/sommNI/src/glasses-list.ts');
  const P=await import('/sommNI/src/pages.ts');
  const C=await import('/sommNI/src/constants.ts');
  const G=await import('/sommNI/src/winebrary-glasses.ts');
  const E=await import('/sommNI/src/events.ts');
  const A=await import('/sommNI/src/atlas-app.ts');
  const enc=new TextEncoder();const bytes=s=>enc.encode(s).length;
  const out={};

  // ── 1. Limits helper ──
  out.clip63=bytes(L.clipLabel('Domaine de la Romanée-Conti Échezeaux Grand Cru Côte de Nuits Réserve'))<=63;
  out.clip999=bytes(L.clipBytes('é'.repeat(800)))<=999;
  out.keepsNewlines=L.clipBytes('a\nb')==='a\nb';
  const p0=L.pageList(Array.from({length:25},(_,i)=>'w'+i),0), p1=L.pageList(Array.from({length:25},(_,i)=>'w'+i),1);
  out.paging=[p0.labels.length,p0.rows.at(-2).kind,p0.rows.at(-1).kind,p1.labels.length,p1.rows[0].index,p1.pageCount];

  // ── 2. Every catalog page respects the firmware limits ──
  const problems=[];
  const check=(name,pg)=>{
    const lists=pg.listObject||[],texts=pg.textObject||[],imgs=pg.imageObject||[];
    for(const b of [...lists,...texts,...imgs]) if(b.xPosition<0||b.yPosition<0||b.xPosition+b.width>576||b.yPosition+b.height>288) problems.push(name+': bounds '+b.containerName);
    for(const l of lists){const items=l.itemContainer.itemName;if(items.length>20)problems.push(name+': rows '+items.length);for(const s of items)if(bytes(s)>63)problems.push(name+': label '+s);}
    for(const t of texts) if(bytes(t.content||'')>999) problems.push(name+': text bytes '+bytes(t.content));
    if([...lists,...texts].filter(b=>b.isEventCapture===1).length!==1) problems.push(name+': capture count');
  };
  let pages=0;
  check('home',P.rebuildHomePage());
  for(const t of C.WINE_TYPES){ check('countries '+t,P.buildCountryListPage(t)); pages++;
   for(const c of C.COUNTRIES[t]){ check('grapes '+c,P.buildGrapeListPage(t,c)); pages++;
    for(const g of C.getGrapesForCountry(t,c)){ const n=P.wineListPage(t,c,g,0).pageCount;
     for(let i=0;i<n;i++){check(`wines ${g} p${i}`,P.buildWineListPage(t,c,g,i));pages++;}
     for(const w of C.getWinesForGrape(t,c,g)){check('notes '+w.name,P.buildTastingNotesPage(w,'w0'));pages++;}}}}
  out.catalogPages=pages;out.catalogProblems=problems.slice(0,10);

  // ── 3. Mock bridge shared by the flows below ──
  const shown=[];let rejectNext=false;let handler=null;const store={};const images=[];const texts=[];
  const bridge={
   rebuildPageContainer:async pg=>{ if(rejectNext){rejectNext=false;return false;} shown.push(pg);return true; },
   updateImageRawData:async u=>{images.push(u.containerName);return 'success';},
   textContainerUpgrade:async u=>{texts.push(u.containerName+':'+u.content);return true;},
   onEvenHubEvent:cb=>{handler=cb;return()=>{};},
   getLocalStorage:async k=>store[k]||'', setLocalStorage:async(k,v)=>{store[k]=v;return true;},
   shutDownPageContainer:async mode=>mode===1,
  };
  const base=location.origin+'/sommNI/';
  const name=pg=>(pg.listObject?.[0]?.containerName)||(pg.textObject?.map(t=>t.containerName).join('+'));
  const last=()=>name(shown.at(-1));
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  // Real firmware sends no index (and no eventType) for row 0 clicks.
  // Legacy pages also stream sprites after the rebuild; taps during that are (correctly) dropped, so pause long enough.
  let gap=650;
  const click=async i=>{handler({listEvent:{containerID:2,containerName:'x',...(i?{currentSelectItemIndex:i}:{})}});await wait(gap);};
  const dbl=async()=>{handler({sysEvent:{eventType:3}});await wait(gap);};

  // ── 4. Winebrary on glasses ──
  const wine=(id,wine_name,vintage,state='year',extra={})=>({id,wine_name,producer:'P',vintage,region:'R',notes:'n',metadata:{vintage_state:state},...extra});
  const items=[wine('a','Grand Malbec',2017),wine('b','Grand Malbec',2019),wine('c','Grand Malbec',null,'non_vintage')];
  for(let i=0;i<30;i++) items.push(wine('x'+i,'Bottle '+i,2000+i));
  const groups=G.groupLibrary(items);
  out.grouping=[groups.length,groups[0].wines.map(w=>w.vintage??'NV').join(',')];
  G.connectWinebraryGlasses(bridge,base);G.setWinebraryDeviceConnected(true);
  A.connectAtlasGlasses(bridge,base);
  E.registerEventHandlers(bridge,base);
  G.setLibrarySource(()=>({userId:null,loading:false,error:'',items:[]}));
  await click(0);out.signedOut=last();await dbl();out.signedOutBack=last();
  G.setLibrarySource(()=>({userId:'u1',loading:false,error:'',items}));
  const lib=[];
  const head=()=>shown.at(-1).textObject[0].content;
  await click(0);lib.push(last()+':'+head());  // home › My Winebrary › type
  await click(0);lib.push(last());           // Other › countries
  await click(0);lib.push(last());           // Country not set › regions
  await click(0);lib.push(last());           // R › wines
  await click(0);lib.push(last());           // Grand Malbec › vintages
  await click(1);lib.push(last());           // 2017 › detail
  const detail=shown.at(-1).textObject.find(t=>t.containerName==='library-vintage').content;
  await dbl();lib.push(last());              // › vintages
  await dbl();lib.push(last());              // › list
  await click(18);lib.push(last()+':'+head()); // More › page 2
  await dbl();lib.push(last()+':'+head());     // › page 1
  await dbl();await dbl();await dbl();lib.push(last());   // › regions › countries › types
  await dbl();lib.push(last());              // › home
  out.library=lib;out.detailFacts=detail;
  // offline copy: saved for the account, used when loading fails, ignored for another account
  await G.saveLibraryCache('u1',items);
  G.setLibrarySource(()=>({userId:'u1',loading:false,error:'offline',items:[]}));
  await click(0);out.offline=shown.at(-1).textObject[0].content;await dbl();
  G.setLibrarySource(()=>({userId:'u2',loading:false,error:'offline',items:[]}));
  await click(0);out.otherAccount=last();await dbl();
  out.cacheHasNoImageUrls=!store['winelens_library_cache_v1'].includes('image_url');

  // ── 5. Legacy catalog: paging, notes return to origin, rejected pages keep state ──
  const flow=[];gap=1400;
  await click(P.TYPE_START_INDEX);flow.push(last());      // Red
  // live globe: the catalog country list paints the hovered country through the app image queue
  await wait(1500);const globeAtOpen=images.filter(n=>n.startsWith('globe-')).length;
  images.length=0;texts.length=0;
  handler({listEvent:{containerID:2,containerName:'countries',eventType:2,currentSelectItemIndex:1}});
  handler({listEvent:{containerID:2,containerName:'countries',eventType:2,currentSelectItemIndex:2}});await wait(900);
  out.globe={atOpen:globeAtOpen,hover:images.slice(),info:texts.slice()};
  const it=C.COUNTRIES.Red.indexOf('Italy');await click(it);flow.push(last());
  const gi=C.getGrapesForCountry('Red','Italy').indexOf('Sangiovese');await click(gi);flow.push(last()+':'+shown.at(-1).listObject[0].itemContainer.itemName.length);
  await click(18);flow.push(shown.at(-1).textObject[0].content);  // More
  await click(1);flow.push(last());                       // a wine on page 2
  await dbl();flow.push(shown.at(-1).textObject[0].content);      // back lands on page 2
  rejectNext=true;await click(0);flow.push('after-reject:'+last());   // rejected → still on list
  await click(0);flow.push(last());                       // retry works
  await dbl();await dbl();await dbl();await dbl();await dbl();flow.push(last());
  out.flow=flow;
  // Finder › results › notes › back returns to results (it used to open a grapes list)
  await click(P.FINDER_INDEX);for(let i=0;i<5;i++) await click(0);
  const results=last();await click(1);const fromResults=last();await dbl();
  out.finder=[results,fromResults,last()];
  for(let i=0;i<7;i++) await dbl();
  // Pairing › wine › notes › back returns to the pairing (it used to open a grapes list)
  // Outside the Even Hub host, companion data lives in browser storage. One legacy and one canonical ID: both resolve.
  localStorage.setItem('sommni_pairings',JSON.stringify([{id:'p1',name:'Friday tasting',notes:'',wineIds:['w0','wl_cabernet-sauvignon-vasse-felix'],createdAt:'',updatedAt:''}]));
  await click(P.PAIRINGS_INDEX);const pl=last();await click(0);const pd=last();await click(1);const pn=last();await dbl();
  out.pairing=[pl,pd,pn,last()];
  for(let i=0;i<3;i++) await dbl();
  out.home=last();
  // ── 6. Wine Atlas from Home: owns events, scroll/tap/back, your Winebrary wines per region ──
  images.length=0;
  const napa=wine('n1','Estate Cabernet',2019,'year',{region:'Napa Valley, US',metadata:{vintage_state:'year',country:'US'}});
  const twin=wine('t1','Cabernet Sauvignon',2018,'year',{wine_id:'wl_cabernet-sauvignon-vasse-felix',region:null,metadata:{vintage_state:'year'}});
  const stray=wine('s1','Mystery Red',2020,'year',{region:'Nowhere Hills',metadata:{vintage_state:'year'}});
  G.setLibrarySource(()=>({userId:'u1',loading:false,error:'',items:[napa,twin,stray]}));
  const rows=()=>shown.at(-1).textObject.find(t=>t.containerName==='atlas-rows').content;
  const rowsNow=()=>texts.filter(t=>t.startsWith('atlas-rows:')).at(-1)?.slice(11)??rows();
  await click(P.ATLAS_INDEX);await wait(1200);
  const atlas=[last(),rows().split('\n')[0]];
  handler({textEvent:{containerID:2,containerName:'atlas-rows',eventType:2}});await wait(600);
  atlas.push(A.atlasStatus().country);
  handler({textEvent:{containerID:2,containerName:'atlas-rows',eventType:1}});await wait(600);   // back up to the first country
  handler({textEvent:{containerID:2,containerName:'atlas-rows'}});await wait(600);   // tap (firmware omits CLICK=0)
  atlas.push(A.atlasStatus().mode,rowsNow().split('\n')[0]);
  handler({textEvent:{containerID:2,containerName:'atlas-rows'}});await wait(900);   // region view
  atlas.push(A.atlasStatus().mode,rowsNow());
  handler({textEvent:{containerID:2,containerName:'atlas-rows'}});await wait(1500);  // open the wine
  atlas.push(last());
  handler({sysEvent:{eventType:3}});await wait(1800);atlas.push(last(),A.atlasStatus().mode,A.atlasStatus().active); // back to the Atlas
  handler({textEvent:{containerID:2,containerName:'atlas-rows',eventType:2}});await wait(600);  // next row: a catalog wine
  handler({textEvent:{containerID:2,containerName:'atlas-rows'}});await wait(1500);
  const catalogNotes=last();
  handler({sysEvent:{eventType:3}});await wait(1800);out.catalogFromAtlas=[catalogNotes,last(),A.atlasStatus().mode];
  handler({sysEvent:{eventType:3}});await wait(600);handler({sysEvent:{eventType:3}});await wait(600);
  handler({sysEvent:{eventType:3}});await wait(1200);atlas.push(last(),A.atlasStatus().active);
  out.atlas=atlas;out.atlasImages=[...new Set(images)];
  // Catalog scope: only countries with wines; regions only through explicit links
  const I=await import('/sommNI/src/identity.ts');
  const links=(await import('/sommNI/src/data/atlas-region-links.json')).default.links;
  const scope=A.catalogAtlas(await A.loadAtlasRenderer());
  out.scope={countries:scope.countries.map(c=>c.name),regions:scope.data.regions.filter(r=>!scope.unmapped.has(r.id)).length,unmappedRows:scope.unmapped.size,unlinked:scope.unlinked.length};
  const listed=new Set();for(const list of scope.entries.values())for(const e of list)if(e.kind==='catalog')listed.add(e.item.id);
  out.everyCatalogWineListed=listed.size===I.allCatalogWines().length;
  const catalogCountries=[...new Set(I.allCatalogWines().map(w=>w.country))];
  const linkProblems=[];
  for(const w of I.allCatalogWines()) if(!links.some(l=>l.region===w.wine.region)) linkProblems.push('no link entry: '+w.wine.region);
  for(const l of links) for(const c of l.clusters) if(!scope.data.regions.some(r=>r.name===c)) linkProblems.push('cluster not linked in its country: '+l.region+' → '+c);
  out.linkProblems=[...new Set(linkProblems)];out.catalogCountryCount=catalogCountries.length;
  return out;
 });
 console.log(JSON.stringify(result,null,1));
 assert.deepEqual(errors,[]);
 assert.equal(result.clip63,true);assert.equal(result.clip999,true);assert.equal(result.keepsNewlines,true);
 assert.deepEqual(result.paging,[20,'more','back',8,18,2]);
 assert.ok(result.catalogPages>300);assert.deepEqual(result.catalogProblems,[]);
 assert.deepEqual(result.grouping,[31,'2019,2017,NV']);
 assert.equal(result.signedOut,'library-message+library-hint');assert.equal(result.signedOutBack,'home-list');
 assert.deepEqual(result.library,['library-types:WINEBRARY · 33 wines','library-country','library-regions','library-list','library-vintages','library-title+library-vintage+library-notes+library-footer','library-vintages','library-list','library-list:… / COUNTRY NOT SET / R · 31 wines · 2/2','library-list:… / COUNTRY NOT SET / R · 31 wines · 1/2','library-types','home-list']);
 assert.equal(result.detailFacts,'2017 · P · R');
 assert.match(result.offline,/offline copy/);assert.equal(result.otherAccount,'library-message+library-hint');assert.equal(result.cacheHasNoImageUrls,true);
 assert.equal(result.flow[0],'countries');assert.equal(result.flow[1],'grapes');assert.equal(result.flow[2],'wines:20');
 assert.match(result.flow[3],/2\/2$/);assert.equal(result.flow[4],'wine-name+sub+notes+kicker+notes-hint');assert.match(result.flow[5],/2\/2$/);
 assert.equal(result.flow[6],'after-reject:wines');assert.equal(result.flow[7],'wine-name+sub+notes+kicker+notes-hint');assert.equal(result.flow[8],'home-list');
 assert.deepEqual(result.finder,['results','wine-name+sub+notes+kicker+notes-hint','results']);
 assert.deepEqual(result.pairing,['pairings-list','pairing-wines','wine-name+sub+notes+kicker+notes-hint','pairing-wines']);
 assert.equal(result.home,'home-list');
 assert.equal(result.globe.atOpen,2);assert.deepEqual(result.globe.hover,['globe-top','globe-bottom']);
 assert.ok(result.globe.info.at(-1).startsWith('info:France'),result.globe.info.join('|'));
 assert.deepEqual(result.atlas.slice(0,2),['atlas-title+atlas-rows+atlas-hint','> United States (1)']);
 assert.equal(result.atlas[2],'Australia');
 assert.equal(result.atlas[3],'regions');assert.equal(result.atlas[4],'> Napa Valley (1)');
 assert.equal(result.atlas[5],'detail');assert.match(result.atlas[6],/^Napa Valley\nMINE 1 · CATALOG \d+\n> Estate Cabernet 2019\n  \S/);
 assert.deepEqual(result.catalogFromAtlas,['wine-name+sub+notes+kicker+notes-hint','atlas-title+atlas-rows+atlas-hint','detail']);
 assert.equal(result.everyCatalogWineListed,true);
 assert.equal(result.atlas[7],'library-kicker+library-title+library-vintage+library-notes+library-footer+map-caption');  // mapped wine: map-scene layout
 assert.deepEqual(result.atlas.slice(8,11),['atlas-title+atlas-rows+atlas-hint','detail',true]);
 assert.deepEqual(result.atlas.slice(11),['home-list',false]);
 assert.equal(result.scope.countries.length,result.catalogCountryCount);assert.deepEqual(result.linkProblems,[]);
 assert.ok(result.scope.regions>0&&result.scope.regions<60,'only linked clusters: '+result.scope.regions);
 assert.ok(result.atlasImages.includes('atlas-top')&&result.atlasImages.includes('atlas-bottom'));assert.ok(result.atlasImages.includes('scene-top')&&result.atlasImages.includes('scene-bottom'),'wine map scene sent');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
