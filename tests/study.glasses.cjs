// G2 "Study today" against a mock Even bridge: page limits, tap/double-tap flow,
// one review per presentation, and phone ↔ G2 parity on the shared session.
// Needs the dev server on http://localhost:5186/sommNI/ (npm run dev).
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true});
 try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')console.log('[page]',m.text());});
  await page.route('http://localhost:5186/sommNI/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>G2 study test</title>'}));
  await page.goto('http://localhost:5186/sommNI/');
  const r=await page.evaluate(async()=>{
   const G=await import('/sommNI/src/study/glasses.ts');
   const E=await import('/sommNI/src/events.ts');
   const St=await import('/sommNI/src/study/store.ts');
   const Se=await import('/sommNI/src/study/session.ts');
   const C=await import('/sommNI/src/study/content.ts');
   const P=await import('/sommNI/src/pages.ts');
   const enc=new TextEncoder(),bytes=s=>enc.encode(s).length;
   const out={};
   // ── Display invariants for every card, prompt + reveal ──
   const problems=[];
   const check=(name,pg)=>{
    const lists=pg.listObject||[],texts=pg.textObject||[],imgs=pg.imageObject||[],all=[...lists,...texts,...imgs];
    if(pg.containerTotalNum!==all.length)problems.push(name+': total');
    for(const b of all)if(b.xPosition<0||b.yPosition<0||b.xPosition+b.width>576||b.yPosition+b.height>288)problems.push(name+': bounds '+b.containerName);
    for(const l of lists){if(l.itemContainer.itemName.length>20)problems.push(name+': rows');for(const s of l.itemContainer.itemName)if(bytes(s)>63)problems.push(name+': label');}
    for(const t of texts)if(bytes(t.content)>999)problems.push(name+': text');
    if([...lists,...texts].filter(b=>b.isEventCapture===1).length!==1)problems.push(name+': capture');
    for(const i of imgs)if(i.height>144||i.width>288)problems.push(name+': image size');
   };
   const preview={again:'tomorrow',hard:'tomorrow',good:'tomorrow',easy:'in 3 days'};
   for(const c of C.STUDY_CARDS){check(c.id+' prompt',G.buildStudyPromptPage(c,1,5,true,!c.hide_image));check(c.id+' reveal',G.buildStudyRevealPage(c,preview));}
   check('message',G.buildStudyMessagePage('Nothing due right now.','x'.repeat(2000),'Tap: Home'));
   out.problems=problems;
   out.homeLabel=P.HOME_LIST_ITEMS[P.STUDY_INDEX];

   // ── Mock bridge ──
   const mem=new Map();
   await St.useStorage({async get(k){return mem.get(k)??null},async set(k,v){mem.set(k,v)},async remove(k){mem.delete(k)}});
   await St.useAccount(null);
   const shown=[];let handler=null;
   const bridge={rebuildPageContainer:async pg=>{shown.push(pg);return true;},updateImageRawData:async()=>'success',onEvenHubEvent:cb=>{handler=cb;return()=>{};},getLocalStorage:async()=>'',setLocalStorage:async()=>true};
   const base=location.origin+'/sommNI/';
   E.registerEventHandlers(bridge,base);G.connectStudyGlasses(bridge,base);
   const wait=ms=>new Promise(r=>setTimeout(r,ms));
   const names=pg=>[...(pg.textObject||[]),...(pg.listObject||[])].map(b=>b.containerName).join('+');
   const last=()=>names(shown.at(-1));
   const tap=async()=>{handler({textEvent:{containerID:4,containerName:'x'}});await wait(700);};
   const pick=async i=>{handler({listEvent:{containerID:2,containerName:'x',...(i?{currentSelectItemIndex:i}:{})}});await wait(700);};
   const dbl=async()=>{handler({sysEvent:{eventType:3}});await wait(700);};

   await pick(P.STUDY_INDEX);
   out.prompt=[last(),shown.at(-1).textObject.find(t=>t.containerName==='study-prompt').content,(shown.at(-1).imageObject||[]).length];
   await tap();
   const reveal=shown.at(-1);
   out.reveal=[names(reveal),reveal.textObject[0].content,reveal.listObject[0].itemContainer.itemName];
   const first=Se.activeSession().current.card;
   // Good, tapped twice in quick succession (fast double tap on the ring): one review only.
   handler({listEvent:{containerID:2,containerName:'x',currentSelectItemIndex:2}});handler({listEvent:{containerID:2,containerName:'x',currentSelectItemIndex:2}});await wait(700);
   const ev=St.eventsFor(first.id);
   out.g2Review=[ev.length,ev[0].rating,ev[0].device,ev[0].mode,St.stateFor(first.id,first.version).due_at!==null];
   out.afterRating=last();
   // Phone and G2 share the session: a reveal and rating on the phone move the glasses along.
   const s=Se.activeSession();
   s.reveal('');await wait(700);out.phoneReveal=last();
   await s.rate('again','phone');await wait(700);out.phoneRated=last();
   await tap();out.nextAfterPhone=last();
   out.eventsTotal=St.eventCount();
   // Double tap stops; reviews already rated stay saved; tap returns home.
   await dbl();out.summary=[last(),shown.at(-1).textObject[0].content];
   await tap();out.home=last();
   // Pater Patriae prompts never show the bottle (label would give the answer away).
   const pater=C.getCard('card_pater-patriae_grape');
   out.paterImages=(G.buildStudyPromptPage(pater,1,1,false,false).imageObject||[]).length;
   out.eventsAfter=St.eventCount();
   return out;
  });
  console.log(JSON.stringify(r,null,1));
  assert.deepEqual(errors,[]);
  assert.deepEqual(r.problems,[]);
  assert.equal(r.homeLabel,'Study today');
  assert.equal(r.prompt[0],'study-header+study-prompt+study-hint');
  assert.match(r.prompt[1],/Cain Cuvée NV14/);assert.doesNotMatch(r.prompt[1],/2013|48%/);  // no answer cue before reveal
  assert.equal(r.prompt[2],2);
  assert.equal(r.reveal[0],'study-answer+study-rating');
  assert.match(r.reveal[1],/48% 2013 and 52% 2014/);assert.match(r.reveal[1],/Source: Cain Vineyard & Winery · NV14/);
  assert.deepEqual(r.reveal[2],['Again · tomorrow','Hard · tomorrow','Good · tomorrow','Easy · in 3 days']);
  assert.deepEqual(r.g2Review,[1,'good','g2','recall',true]);
  assert.equal(r.afterRating,'study-header+study-prompt+study-hint');
  assert.equal(r.phoneReveal,'study-answer+study-rating');
  assert.equal(r.phoneRated,'study-message+study-hint');
  assert.equal(r.nextAfterPhone,'study-header+study-prompt+study-hint');
  assert.equal(r.eventsTotal,2);
  assert.equal(r.summary[0],'study-message+study-hint');assert.match(r.summary[1],/Session paused.*2 reviews saved/s);
  assert.equal(r.home,'tag1+tag2+home-list');
  assert.equal(r.paterImages,0);assert.equal(r.eventsAfter,2);
  console.log('G2 study: all checks passed');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
