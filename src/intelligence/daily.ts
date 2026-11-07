import { intelligence, saved, getLocale, esc } from './client';
export interface StudySource {publisher:string;title:string;url:string}
export interface DailyLesson {in_the_glass:string;key_detail:{concept_id:string;term:string;meaning:string;source:StudySource};try_this:string;references:{key:string;quote:string;source:StudySource}[]}
export interface DailyQuestion {lesson?:DailyLesson;id:string;wine_id:string;subject:string;question:string;options:string[];correct_index:number;explanation:string;evidence_quote:string;evidence_key:string;source:{publisher:string;title:string;url:string}}
export interface DailyEdition {version?:string;id:string;day:string;locale:string;wines:{id:string;name:string}[];questions:DailyQuestion[];cached?:boolean}
export interface DailyProgress {answers:Record<string,number>;revisit:string[]}
let edition:DailyEdition|null=null,progress:DailyProgress={answers:{},revisit:[]},index=0,queue:number[]=[],busy=false,error='',saveError='',loadRevision=0;
let host:HTMLElement|null=null;
const DAILY_CACHE_VERSION='6';
const listeners=new Set<()=>void>();
const emit=()=>{render();for(const callback of listeners)callback();};
export const onDailyChange=(callback:()=>void)=>{listeners.add(callback);return()=>listeners.delete(callback);};
export const dailyState=()=>({edition,progress,index,total:queue.length,question:edition?.questions[queue[index]],finished:!!edition&&index>=queue.length,busy,error,saveError});
export async function loadDaily(id?:string){
 if(busy)return;const token=++loadRevision;busy=true;error='';saveError='';emit();
 const today=new Date().toISOString().slice(0,10),key=id||`v${DAILY_CACHE_VERSION}:${today}:${getLocale()}`;
 try{const stored=await saved.get<DailyEdition|null>('daily:'+key,null);
  const result=(stored&&(id||stored.version===DAILY_CACHE_VERSION)?stored:null)||await intelligence(id?{action:'daily_saved',id}:{action:'daily'});
  if(token!==loadRevision)return;
  if(!Array.isArray(result.questions)||result.questions.length!==20||new Set(result.questions.map((q:DailyQuestion)=>q.wine_id)).size!==8)throw Error('The daily flight is incomplete. Please retry.');
  const loadedProgress=await saved.get<DailyProgress>('progress:'+result.id,{answers:{},revisit:[]});
  if(token!==loadRevision)return;edition=result;progress=loadedProgress;
  queue=result.questions.map((_:unknown,i:number)=>i);index=queue.findIndex(i=>progress.answers[result.questions[i].id]===undefined);if(index<0)index=queue.length;
  await saved.set('daily:'+key,result).catch(()=>{if(token===loadRevision)saveError='The edition is saved in Supabase, but this device could not cache it.';});
  await saved.set('daily:'+result.id,result).catch(()=>{});
  const archive=await saved.get<{id:string;day:string;locale:string}[]>('daily-archive',[]);if(!archive.some(e=>e.id===result.id))await saved.set('daily-archive',[{id:result.id,day:result.day,locale:result.locale},...archive].slice(0,90)).catch(()=>{});
 }catch(e){if(token===loadRevision)error=(e as Error).message;}finally{if(token===loadRevision){busy=false;emit();}}
}
export async function answerDaily(option:number){const q=dailyState().question;if(!q||progress.answers[q.id]!==undefined||busy||!Number.isInteger(option)||option<0||option>3)return;
 progress.answers[q.id]=option;if(option!==q.correct_index&&!progress.revisit.includes(q.id))progress.revisit.push(q.id);await persist();emit();}
async function persist(){if(!edition)return;try{await saved.set('progress:'+edition.id,progress);saveError='';}catch{saveError='Your answers are in this session. Device storage failed; retry saving before leaving.';}}
export async function retryDailySave(){await persist();emit();}
export function nextDaily(){const q=dailyState().question;if(q&&progress.answers[q.id]!==undefined){index++;emit();}}
export function reviewDaily(missed=false){if(!edition)return;queue=edition.questions.map((_,i)=>i).filter(i=>!missed||progress.revisit.includes(edition!.questions[i].id));index=0;emit();}
export function retryQuestion(){const q=dailyState().question;if(!q)return;delete progress.answers[q.id];void persist().then(emit);}
export async function ensureDaily(){if(!edition||edition.day!==new Date().toISOString().slice(0,10)||edition.locale!==getLocale())await loadDaily();if(!edition||error)throw Error(error||'Daily study is unavailable.');}
export function initDaily(){
 const root=document.getElementById('tab-study');if(!root)return;host=document.createElement('section');host.className='intel-daily';host.id='daily-flight';root.prepend(host);render();
 host.addEventListener('click',event=>{const b=(event.target as HTMLElement).closest<HTMLElement>('[data-daily]');if(!b)return;const action=b.dataset.daily;
  if(action==='load')void loadDaily();if(action==='answer')void answerDaily(Number(b.dataset.option));if(action==='next')nextDaily();if(action==='review')reviewDaily();if(action==='missed')reviewDaily(true);if(action==='retry-question')retryQuestion();if(action==='save')void retryDailySave();if(action==='archive')void archive();if(action==='open')void loadDaily(b.dataset.id);if(action==='glasses'&&window.dispatchEvent(new Event('winelens-daily-glasses',{cancelable:true}))){error='Open sommNI in Even Hub with your G2 connected to continue on glasses.';render();}
 });
 window.addEventListener('winelens-language',()=>{loadRevision++;busy=false;edition=null;error='';progress={answers:{},revisit:[]};render();});
}
async function archive(){
 if(!host)return;const slot=host.querySelector('#daily-archive')!;slot.textContent='Loading saved flights…';
 const local=await saved.get<{id:string;day:string;locale:string}[]>('daily-archive',[]);let remote:any[]=[];
 try{remote=(await intelligence({action:'daily_archive'})).editions??[];}catch(e){if(!local.length){slot.textContent=(e as Error).message;return;}}
 const items=[...new Map([...local,...remote].filter(r=>r.locale===getLocale()).map(r=>[r.id,r])).values()].sort((a,b)=>b.day.localeCompare(a.day));
 slot.innerHTML=items.length?items.map(row=>`<button class="wl-outline" data-daily="open" data-id="${esc(row.id)}">${esc(row.day)}${row.id.startsWith('daily:'+DAILY_CACHE_VERSION+':')?'':' · Earlier edition'} · 8 wines / 20 questions</button>`).join(''):'<p>Your saved flights will appear here.</p>';
}
function render(){if(!host)return;const s=dailyState(),q=s.question,chosen=q?progress.answers[q.id]:undefined;
 host.innerHTML=`<header class="intel-heading"><div><p class="wl-kicker">STUDY TODAY · ${esc(edition?.day??new Date().toISOString().slice(0,10))} · UTC</p><h2>Eight wines. Twenty discoveries.</h2><p>Learn the wine behind the answer: what to expect, what the language means, and what to notice next time. Each daily flight is saved to revisit.</p></div><span class="intel-count">08 <small>WINES</small><br>20 <small>QUESTIONS</small></span></header><p class="intel-status" role="status">${esc(busy?'Preparing your shared daily flight…':error||saveError)}</p>${saveError?'<button class="wl-text-button" data-daily="save">Retry saving answers</button>':''}
 ${!edition?`<button class="wl-primary" data-daily="load" ${busy?'disabled':''}>Open today’s flight ↗</button><p class="wl-muted small">Needs a connection the first time. Saved flights work offline. Answers stay on this device.</p>`:s.finished?`<div class="intel-question"><p class="wl-kicker">FLIGHT COMPLETE</p><h3>${Object.values(progress.answers).length} answers saved${saveError?' in this session':''}.</h3><p>${progress.revisit.length} questions marked to revisit. Try explaining each answer without looking at the choices.</p><button class="wl-primary" data-daily="missed" ${progress.revisit.length?'':'disabled'}>Revisit marked questions</button> <button class="wl-outline" data-daily="review">Review the whole flight</button></div>`:q?`<article class="intel-question"><div class="intel-question-top"><p class="wl-kicker">${index+1} / ${queue.length} · ${esc(q.evidence_key)}</p><button class="wl-text-button" data-daily="glasses">Open on G2 ↗</button></div><p class="wl-muted">${esc(q.subject)}</p><h3>${esc(q.question)}</h3><div class="intel-options">${q.options.map((option,i)=>`<button data-daily="answer" data-option="${i}" class="${chosen!==undefined?(i===q.correct_index?'correct':i===chosen?'incorrect':''):''}" ${chosen!==undefined?'disabled':''}>${esc(option)}${chosen!==undefined&&i===q.correct_index?' ✓':''}</button>`).join('')}</div>${chosen!==undefined?`<div class="intel-explanation" role="status"><p class="wl-kicker">${chosen===q.correct_index?'THAT’S RIGHT':'LET’S REVISIT THIS'}</p><p>${esc(q.explanation)}</p>${lessonHtml(q)}<button class="wl-primary" data-daily="next">${index+1<queue.length?'Next question →':'Finish flight'}</button> <button class="wl-text-button" data-daily="retry-question">Try again without the answer</button></div>`:''}</article>`:''}
 <div class="intel-daily-footer">${edition?`<button class="wl-text-button" data-daily="load" ${busy?'disabled':''}>Today’s flight ↗</button>`:''}<button class="wl-text-button" data-daily="archive">Saved flights ↗</button><p class="wl-muted small">AI practice is based on the cited material. Catalog descriptions are not producer verification, and your own tasting perceptions aren’t right or wrong.</p></div><div id="daily-archive" class="intel-archive"></div>`;
}

function sourceLink(_source:StudySource){return '';}
function lessonHtml(q:DailyQuestion){
 const lesson=q.lesson;
 if(!lesson)return `<blockquote>${esc(q.evidence_quote)}</blockquote><p class="wl-muted small">${sourceLink(q.source)}</p>`;
 return `<div class="intel-lesson"><section><h4>In the glass</h4><p>${esc(lesson.in_the_glass)}</p></section><section><h4>Key detail · ${esc(lesson.key_detail.term)}</h4><p>${esc(lesson.key_detail.meaning)}</p></section><section class="intel-practice"><h4>Notice next time</h4><p>${esc(lesson.try_this)}</p></section></div><details class="intel-lesson-sources"><summary>Explore the references</summary><p class="wl-muted small">Bottle expectations come from our catalog; exact vintage is unconfirmed. The teaching reference explains the term.</p><blockquote>${esc(q.evidence_quote)}</blockquote><p class="wl-muted small">${sourceLink(q.source)}</p>${lesson.references.map(r=>`<blockquote>${esc(r.quote)}</blockquote><p class="wl-muted small">${sourceLink(r.source)}</p>`).join('')}<p class="wl-muted small">Teaching reference: ${sourceLink(lesson.key_detail.source)}</p></details>`;
}
