const BASE = process.env.WL_BASE_URL || 'http://localhost:5186';
// Study engine acceptance tests (PRD S-01…S-09, I-01, R-01…R-05 and the §12 matrix).
// Runs the real modules in Chrome against a blank page (no app startup), with in-memory storage.
// Needs the dev server on http://localhost:5186/sommNI/ (npm run dev).
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true});
 try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&!/failed|refused the write|Could not/i.test(m.text()))console.log('[page]',m.text());});
  await page.route((BASE + '/sommNI/'),r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Study engine test</title>'}));
  await page.goto((BASE + '/sommNI/'));
  const r=await page.evaluate(async()=>{
   const S=await import('/sommNI/src/study/scheduler.ts');
   const St=await import('/sommNI/src/study/store.ts');
   const C=await import('/sommNI/src/study/content.ts');
   const Se=await import('/sommNI/src/study/session.ts');
   const I=await import('/sommNI/src/identity.ts');
   const K=await import('/sommNI/src/constants.ts');
   const Y=await import('/sommNI/src/sync.ts');
   const out={};
   const rec=(state,rating,at,mode='recall',correct=null)=>S.applyReview(state,{mode,rating,correct,occurred_at:at,tz_offset_min:0});

   // ── 1. Scheduler (S-06, S-09) ──
   let s=S.initialState('c',1);
   s=rec(s,'good','2026-10-01T10:00:00.000Z');                 out.newGood=[s.step,s.due_at];
   const ahead=rec(rec(s,'good','2026-10-01T18:00:00.000Z'),'easy','2026-10-01T19:00:00.000Z');
   out.aheadNoInflation=[ahead.step,ahead.due_at,ahead.success_days.length];
   s=rec(s,'good','2026-10-02T09:00:00.000Z');                 out.dueGood=[s.step,s.due_at];
   const hard=rec(s,'hard','2026-10-05T09:00:00.000Z');        out.hard=[hard.step,hard.due_at];
   const overdue=rec(s,'good','2026-10-20T09:00:00.000Z');     out.overdueFromCompletion=overdue.due_at;
   const easy=rec(s,'easy','2026-10-05T09:00:00.000Z');        out.easy=[easy.step,easy.due_at];
   let st=rec(s,'good','2026-10-05T09:00:00.000Z');            // 2nd success, only 4 days after learning
   out.notStableYet=S.statusOf(st);
   st=rec(st,'good','2026-10-12T09:00:00.000Z');               // 3rd success, 11 days after learning
   out.stable=S.statusOf(st);
   const lapse=rec(st,'again','2026-10-27T09:00:00.000Z');     out.lapse=[lapse.step,lapse.lapses,lapse.success_days.length,S.statusOf(lapse),lapse.due_at];
   const retry=rec(lapse,'again','2026-10-27T09:05:00.000Z');  out.retryNoDoubleLapse=retry.lapses;
   const recog=rec(s,null,'2026-10-02T12:00:00.000Z','recognition',true);
   out.recognitionNoSchedule=[recog.due_at===s.due_at,recog.step===s.step,recog.recognition_correct];
   out.newEasy=rec(S.initialState('c',1),'easy','2026-10-01T10:00:00.000Z').due_at;
   out.tzLocalMidnight=S.applyReview(S.initialState('c',1),{mode:'recall',rating:'good',correct:null,occurred_at:'2026-10-01T23:30:00.000Z',tz_offset_min:60}).due_at;

   // ── 2. Content (R-01…R-05, S-03) ──
   out.cards=C.STUDY_CARDS.map(c=>c.id);
   out.rejected=C.rejectedCards();
   const cain=C.getCard('card_cain-nv14_blend-years');
   out.cainSources=C.cardSources(cain).map(x=>[x.source.publisher,x.scope]);
   const bad={...cain,id:'x',claims:['clm_does_not_exist']};
   const wrongRelease={...C.getCard('card_ixsir-gr-rose-2023_grapes'),id:'y',release_id:'rel_cain-cuvee-nv14_nv14'};
   out.problems=[C.cardProblem(bad),C.cardProblem(wrongRelease),C.cardProblem({...cain,options:['A','a']})];
   const ix=C.getCard('card_ixsir-gr-rose-2023_grapes');
   out.matching=[C.answerMatches(ix,'mourvèdre, Cinsault & syrah'),C.answerMatches(ix,'Mataro cinsaut shiraz'),C.answerMatches(ix,'Grenache and Syrah'),C.answerMatches(cain,'2013 and 2014'),C.answerMatches(cain,'2014')];
   out.hiddenLabel=C.STUDY_CARDS.filter(c=>c.hide_image).map(c=>c.id);
   out.nv14Release=C.wineReferences('wl_cain-cuvee-nv14').claims.find(c=>c.field==='vintage_state').release;
   out.ixsirPercentages=C.wineReferences('wl_grand-reserve-rose-ixsir').claims.find(c=>c.field==='grape_percentages').value;
   out.openItems=C.wineReferences('wl_cabernet-sauvignon-pahlmeyer').open.length;

   // ── 3. Identity (I-01) ──
   let catalog=0,unmapped=0;
   for(const t of K.WINE_TYPES)for(const c of K.COUNTRIES[t])for(const w of K.WINES[t][c]){catalog++;if(!I.getWineId(t,c,w.name))unmapped++;}
   out.identity=[catalog,unmapped,I.resolveWineId('w95'),I.resolveWineId('w999'),I.lookupWineById('wl_not-a-wine'),I.lookupWineById('w95').wine.name,I.assetIdFor('wl_cain-cuvee-nv14'),I.getWineId('Red','Italy','No such wine')];

   // ── 4. Store: idempotency, isolation, failures (S-08, I-04) ──
   const mem=new Map();let failWrites=false;
   const kv={async get(k){return mem.has(k)?mem.get(k):null},async set(k,v){if(failWrites)throw Error('disk full');mem.set(k,v)},async remove(k){mem.delete(k)}};
   await St.useStorage(kv);await St.useAccount('user-a');
   const id='11111111-aaaa-4aaa-8aaa-000000000001';
   const [a1,a2]=await Promise.all([St.recordReview({event_id:id,card_id:cain.id,mode:'recall',rating:'good',correct:null,device:'phone'}),St.recordReview({event_id:id,card_id:cain.id,mode:'recall',rating:'good',correct:null,device:'g2'})]);
   const a3=await St.recordReview({event_id:id,card_id:cain.id,mode:'recall',rating:'again',correct:null,device:'phone'});
   out.idempotent=[a1.duplicate,a2.duplicate,a3.duplicate,St.eventsFor(cain.id).length,St.stateFor(cain.id,1).last_rating];
   out.noRatingRejected=await St.recordReview({event_id:'x2',card_id:cain.id,mode:'recall',rating:null,correct:null,device:'phone'}).then(()=>'saved',e=>e.message);
   out.unknownCardRejected=await St.recordReview({event_id:'x3',card_id:'card_nope',mode:'recall',rating:'good',correct:null,device:'phone'}).then(()=>'saved',e=>e.message);
   failWrites=true;
   const f=await St.recordReview({event_id:'22222222-aaaa-4aaa-8aaa-000000000002',card_id:'card_cain-nv14_origin',mode:'recall',rating:'hard',correct:null,device:'phone'});
   out.failedWrite=[f.saved,St.saveStatus().state,St.eventsFor('card_cain-nv14_origin').length];
   failWrites=false;await St.retrySave();
   out.retried=[St.saveStatus().state,JSON.parse(mem.get('winelens_study_v1:user-a')).events.map(e=>e.event_id).sort()];
   await St.useAccount('user-b');
   out.otherAccount=[St.currentOwner(),St.eventsFor(cain.id).length];
   out.foreignMerge=await St.mergeEvents([{...a1.event,event_id:'foreign-1'}]);  // owned by user-a: refused
   await St.useAccount('user-a');
   out.backToA=St.eventsFor(cain.id).length;
   await St.forgetAccount('user-a');
   out.forgotten=[mem.has('winelens_study_v1:user-a'),St.eventCount()];
   // tampered log stored under B's key but owned by A is ignored
   mem.set('winelens_study_v1:user-c',JSON.stringify({format:1,owner:'user-a',events:[a1.event],acked:[],flagged:[]}));
   await St.useAccount('user-c');out.tampered=St.eventCount();

   // ── 5. Session: attempt → reveal → one rating; Again retry; flags (S-02, S-05, S-07) ──
   await St.useAccount('user-d');
   const q=Se.buildQueue('2026-10-01T10:00:00.000Z');out.queue=q.map(c=>c.id);
   const sess=Se.startSession('recall');
   const firstCard=sess.current.card.id;
   await sess.rate('good','phone');                       // before reveal: ignored
   out.rateBeforeReveal=St.eventCount();
   sess.reveal('napa valley');out.typed=sess.current.typedMatches;
   const labels=sess.ratingPreview();out.preview=labels;
   await Promise.all([sess.rate('again','phone'),sess.rate('good','g2')]);   // fast double tap
   out.oneEventPerPresentation=[St.eventCount(),St.eventsFor(firstCard)[0].rating];
   out.retryQueued=sess.queue.map(c=>c.id).lastIndexOf(firstCard)-sess.index;
   sess.next();sess.reveal('');await sess.rate('good','g2');sess.next();
   sess.setMode('recognition');out.noOptionsStaysRecall=[sess.current.card.id,sess.current.mode]; // IXSIR has no curated options
   sess.reveal('');await sess.rate('hard','phone');sess.next();
   const mcCard=sess.current.card;sess.setMode('recognition');
   out.mcMode=[mcCard.id,sess.current.mode];
   if(sess.current.mode==='recognition'){await sess.choose(mcCard.options.find(o=>o!==mcCard.answer),'phone');out.mcEvent=[St.eventsFor(mcCard.id)[0].mode,St.eventsFor(mcCard.id)[0].correct,St.stateFor(mcCard.id,mcCard.version).step];}
   await St.flagCard(mcCard.id);out.flagged=Se.buildQueue().some(c=>c.id===mcCard.id);
   sess.stop();out.summary=sess.summary().reviewed;

   // ── 6. Companion writes are serialized; migration is lossless (I-01, sync) ──
   Y.initSync(null); // browser storage
   localStorage.clear();
   await Promise.all(Array.from({length:10},()=>Y.adjustStock('wl_cain-cuvee-nv14',1)));
   out.stock=(await Y.getInventory())['wl_cain-cuvee-nv14'];
   localStorage.clear();
   localStorage.setItem('sommni_favorites',JSON.stringify(['w95','w61','w999','w95']));
   localStorage.setItem('sommni_inventory',JSON.stringify({w95:2,w206:0,w999:4}));
   localStorage.setItem('sommni_pairings',JSON.stringify([{id:'p1',name:'Dinner',notes:'',wineIds:['w0','w61'],createdAt:'',updatedAt:''}]));
   localStorage.setItem('sommni_course_state',JSON.stringify([{answers:{},wineId:'w206',wineName:'Rosé'}]));
   const rep=await Y.migrateLegacyWineIds();
   out.migration=[rep.converted,rep.unresolved,JSON.parse(localStorage.getItem('sommni_favorites')),JSON.parse(localStorage.getItem('sommni_inventory')),JSON.parse(localStorage.getItem('sommni_pairings'))[0].wineIds,JSON.parse(localStorage.getItem('sommni_course_state'))[0].wineId,!!localStorage.getItem('sommni_legacy_backup_v1')];
   const again=await Y.migrateLegacyWineIds();out.migrationOnce=again.at===rep.at;
   out.backup=JSON.parse(JSON.parse(localStorage.getItem('sommni_legacy_backup_v1')).values.sommni_favorites);
   return out;
  });
  console.log(JSON.stringify(r,null,1));
  assert.deepEqual(errors,[]);
  // scheduler
  assert.deepEqual(r.newGood,[0,'2026-10-02T00:00:00.000Z']);
  assert.deepEqual(r.aheadNoInflation,[0,'2026-10-02T00:00:00.000Z',0]);
  assert.deepEqual(r.dueGood,[1,'2026-10-05T00:00:00.000Z']);
  assert.deepEqual(r.hard,[1,'2026-10-08T00:00:00.000Z']);
  assert.equal(r.overdueFromCompletion,'2026-10-27T00:00:00.000Z');
  assert.deepEqual(r.easy,[3,'2026-10-19T00:00:00.000Z']);
  assert.equal(r.notStableYet,'learning');assert.equal(r.stable,'stable');
  assert.deepEqual(r.lapse,[0,1,0,'needs-review','2026-10-28T00:00:00.000Z']);
  assert.equal(r.retryNoDoubleLapse,1);
  assert.deepEqual(r.recognitionNoSchedule,[true,true,1]);
  assert.equal(r.newEasy,'2026-10-04T00:00:00.000Z');
  assert.equal(r.tzLocalMidnight,'2026-10-02T23:00:00.000Z'); // 00:30 local on 2 Oct → due start of 3 Oct local
  // content
  assert.equal(r.cards.length,5);assert.deepEqual(r.rejected,[]);
  assert.deepEqual(r.cainSources,[['Cain Vineyard & Winery','NV14']]);
  assert.match(r.problems[0],/missing claim/);assert.match(r.problems[1],/another release/);assert.match(r.problems[2],/duplicate options/);
  assert.deepEqual(r.matching,[true,true,false,true,false]);
  assert.deepEqual(r.hiddenLabel,['card_pater-patriae_grape','card_pater-patriae_appellation']);
  assert.equal(r.nv14Release.vintage_state,'non_vintage');assert.equal(r.nv14Release.year,null);assert.equal(r.nv14Release.release_code,'NV14');
  assert.equal(r.ixsirPercentages,null);assert.equal(r.openItems,1);
  // identity
  assert.deepEqual(r.identity,[215,0,'wl_cain-cuvee-nv14',null,null,'Cain Cuvée "NV14"','w95',null]);
  // store
  assert.deepEqual(r.idempotent,[false,true,true,1,'good']);
  assert.match(r.noRatingRejected,/Rate your recall/);assert.match(r.unknownCardRejected,/not available/);
  assert.deepEqual(r.failedWrite,[false,'error',1]);
  assert.equal(r.retried[0],'saved');assert.equal(r.retried[1].length,2);
  assert.deepEqual(r.otherAccount,['user-b',0]);assert.equal(r.foreignMerge,0);assert.equal(r.backToA,1);
  assert.deepEqual(r.forgotten,[false,0]);assert.equal(r.tampered,0);
  // session
  assert.equal(r.queue.length,5);
  assert.equal(r.rateBeforeReveal,0);
  assert.deepEqual(r.oneEventPerPresentation,[1,'again']);
  assert.equal(r.retryQueued,4);
  assert.deepEqual(Object.keys(r.preview),['again','hard','good','easy']);
  assert.equal(r.mcMode[1],'recognition');assert.deepEqual(r.mcEvent,['recognition',false,-1]);
  assert.deepEqual(r.noOptionsStaysRecall,['card_ixsir-gr-rose-2023_grapes','recall']);
  assert.equal(r.flagged,false);assert.equal(r.summary,4);
  // companion data
  assert.equal(r.stock,10);
  assert.equal(r.migration[0],8);assert.deepEqual(r.migration[1],['w999']);
  assert.deepEqual(r.migration[2],['wl_cain-cuvee-nv14','wl_pater-patriae-pinot-noir-tenuta-cafaggiolo','w999']);
  assert.deepEqual(r.migration[3],{'wl_cain-cuvee-nv14':2,'wl_grand-reserve-rose-ixsir':0,w999:4});
  assert.deepEqual(r.migration[4],['wl_grand-malbec-terrazas-de-los-andes','wl_pater-patriae-pinot-noir-tenuta-cafaggiolo']);
  assert.equal(r.migration[5],'wl_grand-reserve-rose-ixsir');assert.equal(r.migration[6],true);
  assert.equal(r.migrationOnce,true);assert.deepEqual(r.backup,['w95','w61','w999','w95']);
  console.log('study engine: all checks passed');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
