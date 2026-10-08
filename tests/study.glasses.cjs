const { serveG2Bottles } = require('./g2-backend.cjs');
const BASE = process.env.WL_BASE_URL || 'http://localhost:5186';
// G2 "Study today" against a mock Even bridge: page limits, tap/double-tap flow,
// one review per presentation, and phone ↔ G2 parity on the shared session.
// Needs the dev server on http://localhost:5186/sommNI/ (npm run dev).
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true});
 try {
  const page=await browser.newPage();await serveG2Bottles(page);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')console.log('[page]',m.text());});
  await page.route((BASE + '/sommNI/'),r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>G2 study test</title>'}));
  await page.goto((BASE + '/sommNI/'));
  const r=await page.evaluate(async()=>{
   const G=await import('/sommNI/src/study/glasses.ts');
   const E=await import('/sommNI/src/events.ts');
   const St=await import('/sommNI/src/study/store.ts');
   const Se=await import('/sommNI/src/study/session.ts');
   const C=await import('/sommNI/src/study/content.ts');
   const SS=await import('/sommNI/src/study/seasons.ts');
   const PR=await import('/sommNI/src/study/practice.ts');
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
   // Every practice card, in every phase, fits the lens with exactly one capturing container.
   let practicePages=0;
   for(const season of SS.seasons())for(const stage of [...season.stages,season.boss]){
    const run=new PR.PracticeRun(season,stage,'g2','layout');
    for(const card of run.cards){
     const mode=stage.boss&&card.kind==='flash'?'pick':card.kind;
     const base={card,mode,options:mode==='pick'||mode==='spot'?card.options:[],eventId:'x',shownAt:0,chosen:null,correct:null,gained:0,saveError:''};
     const phases=mode==='meet'?['front']:mode==='flash'?['front','back','answered']:['front','answered'];
     for(const phase of phases){const l=G.buildRunCardPage(run,{...base,phase,correct:false,gained:2});check(card.id+' '+phase,l.page);practicePages++;
      if(l.glyph&&(l.glyphH<60||l.glyphH>128))problems.push(card.id+': glyph height');}
    }
    check(stage.id+' summary',G.buildRunSummaryPage(run,season.stages[0]));
   }
   out.practicePages=practicePages;
   out.problems=problems;
   out.homeLabel=P.HOME_LIST_ITEMS[P.STUDY_INDEX];

   // ── Mock bridge ──
   const mem=new Map();
   await St.useStorage({async get(k){return mem.get(k)??null},async set(k,v){mem.set(k,v)},async remove(k){mem.delete(k)}});
   await St.useAccount(null);
   const shown=[];let handler=null;
   const imgs=[];
   const bridge={rebuildPageContainer:async pg=>{shown.push(pg);return true;},updateImageRawData:async u=>{imgs.push(u.containerName);return 'success';},onEvenHubEvent:cb=>{handler=cb;return()=>{};},getLocalStorage:async()=>'',setLocalStorage:async()=>true};
   const base=location.origin+'/sommNI/';
   E.registerEventHandlers(bridge,base);G.connectStudyGlasses(bridge,base);
   const wait=ms=>new Promise(r=>setTimeout(r,ms));
   const names=pg=>[...(pg.textObject||[]),...(pg.listObject||[])].map(b=>b.containerName).join('+');
   const last=()=>names(shown.at(-1));
   const tap=async()=>{handler({textEvent:{containerID:4,containerName:'x'}});await wait(700);};
   const pick=async i=>{handler({listEvent:{containerID:2,containerName:'x',...(i?{currentSelectItemIndex:i}:{})}});await wait(700);};
   const dbl=async()=>{handler({sysEvent:{eventType:3}});await wait(700);};

   await pick(P.STUDY_INDEX);
   out.map=[last(),shown.at(-1).textObject[0].content,shown.at(-1).listObject[0].itemContainer.itemName];
   await pick(0);   // Daily review
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
   await tap();out.backToMap=last();
   // ── Seasons: a locked stage explains itself; stage 1 plays through to its summary ──
   await pick(1);out.season=[last(),shown.at(-1).listObject[0].itemContainer.itemName];
   await pick(1);out.locked=shown.at(-1).textObject[0].content;
   const before=St.eventCount();const imagesBefore=imgs.length;
   await pick(0);
   const R=()=>G.currentRun();const seen=new Set();let rightAnswers=0;
   for(let guard=0;guard<60&&R()&&!R().finished;guard++){
    const t=R().current;seen.add(t.mode+':'+t.phase);
    if(t.mode==='meet'||t.phase==='answered'){await tap();continue;}
    if(t.mode==='flash'&&t.phase==='front'){await tap();continue;}
    if(t.mode==='flash'){await pick(0);rightAnswers++;continue;}
    // Answer the first two wrong (to see the miss path), the rest right.
    const wrongFirst=R().answered<2&&t.options.some(o=>o!==t.card.answer);
    const choice=wrongFirst?t.options.findIndex(o=>o!==t.card.answer):t.options.indexOf(t.card.answer);
    if(!wrongFirst)rightAnswers++;
    await pick(choice);
   }
   const run=R(),sum=run.summary();
   out.run={modes:[...seen].sort(),events:St.eventCount()-before,scored:run.scoredTotal,right:sum.right,expectedRight:rightAnswers,stars:sum.stars,xp:sum.xp,page:last(),summary:shown.at(-1).textObject[0].content,rows:shown.at(-1).listObject[0].itemContainer.itemName,glyphs:imgs.slice(imagesBefore).filter(n=>n==='study-glyph').length};
   out.unlocked=PR.stageUnlocked(SS.season('grapes'),1);
   // Summary › next stage starts it; double tap stops and shows the paused summary; double tap again → season.
   await pick(0);out.nextStage=[G.currentRun()?.stage.index,last()];
   await dbl();out.paused=[last(),shown.at(-1).textObject[0].content];
   await dbl();out.backToSeason=last();
   await pick(SS.season('grapes').stages.length);out.bossLocked=shown.at(-1).textObject[0].content;
   await dbl();out.mapAgain=[last(),shown.at(-1).textObject[0].content];
   await dbl();out.home=last();
   // Boss engine: three wrong answers end the run; answers are filed under the boss, then one marker.
   {
    const season=SS.season('regions'),boss=new PR.PracticeRun(season,season.boss,'phone','fixed');
    const before=St.eventCount();
    for(let i=0;i<3;i++){const t=boss.current;if(t.mode==='flash')throw new Error('boss asked a flash card');await boss.choose(t.options.find(o=>o!==t.card.answer));await boss.next();}
    const events=St.allEvents().slice(-4);
    out.boss={finished:boss.finished,failed:boss.failed,hearts:boss.hearts,cards:boss.cards.length,added:St.eventCount()-before,
     ids:events.map(e=>e.card_id.split('.').slice(0,3).join('.')),marker:events.filter(e=>e.card_id==='p.regions.boss').map(e=>[e.card_id,e.correct])[0],cleared:PR.progress().bossCleared.has('p.regions.boss')};
   }
   // Pater Patriae prompts never show the bottle (label would give the answer away).
   const pater=C.getCard('card_pater-patriae_grape');
   out.paterImages=(G.buildStudyPromptPage(pater,1,1,false,false).imageObject||[]).length;
   out.reviewEvents=St.eventsFor(first.id).length;
   return out;
  });
  console.log(JSON.stringify(r,null,1));
  assert.deepEqual(errors,[]);
  assert.deepEqual(r.problems,[]);
  assert.equal(r.homeLabel,'Study');
  assert(r.practicePages>500,'every practice card was laid out');
  assert.equal(r.map[0],'study-head+study-map');assert.match(r.map[1],/^STUDY · 0 XP · ★ 0\/\d+$/);
  assert.match(r.map[2][0],/^Daily review · 5 ready$/);assert.deepEqual(r.map[2].slice(1,5).map(x=>x.split(' ·')[0]),['Grapes & styles','Regions & countries','Tasting notes','Producers & stories']);assert.equal(r.map[2].at(-1),'Back');
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
  assert.equal(r.backToMap,'study-head+study-map');
  assert.equal(r.season[0],'study-head+study-stages');assert.match(r.season[1][0],/^☆☆☆ 1 · Meet the styles$/);assert.match(r.season[1][1],/^□ 2 · /);assert.match(r.season[1].at(-2),/Boss · clear every stage/);
  assert.match(r.locked,/Get ★ on stage 1 to unlock stage 2/);
  assert.deepEqual(r.run.modes.filter(m=>m.startsWith('meet')),['meet:front']);assert(r.run.modes.includes('pick:front')&&r.run.modes.includes('spot:front'));
  assert.equal(r.run.events,r.run.scored,'one practice event per answered card');assert.equal(r.run.right,r.run.expectedRight);
  assert(r.run.stars>=1,'stage cleared');assert(r.run.xp>r.run.right*10,'combo bonus counted');
  assert.equal(r.run.page,'study-head+study-after');assert.match(r.run.summary,/STAGE CLEAR/);assert.match(r.run.rows[0],/^Next: Burgundy & bubbles$/);
  assert(r.run.glyphs>=r.run.scored,'every card pushed its glyph');
  assert.equal(r.unlocked,true);
  assert.equal(r.nextStage[0],1);assert.equal(r.nextStage[1],'study-hud+study-cue+study-hint');
  assert.equal(r.paused[0],'study-head+study-after');assert.match(r.paused[1],/PAUSED/);
  assert.equal(r.backToSeason,'study-head+study-stages');
  assert.match(r.bossLocked,/Earn ★ on every stage to face the boss/);
  assert.equal(r.mapAgain[0],'study-head+study-map');assert.match(r.mapAgain[1],/XP/);
  assert.equal(r.home,'tag1+tag2+home-list');
  assert.deepEqual(r.boss,{finished:true,failed:true,hearts:0,cards:8,added:4,ids:['p.regions.boss','p.regions.boss','p.regions.boss','p.regions.boss'],marker:['p.regions.boss',false],cleared:false});
  assert.equal(r.paterImages,0);assert.equal(r.reviewEvents,1);
  console.log('G2 study: all checks passed');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
