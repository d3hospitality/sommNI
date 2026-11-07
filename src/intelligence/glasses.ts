import { readableText, READING_MAX_BYTES } from '../reading/document';
import { type EvenAppBridge, type EvenHubEvent, RebuildPageContainer,TextContainerProperty,ListContainerProperty,ListItemContainerProperty,OsEventTypeList } from '@evenrealities/even_hub_sdk';
import { claimDisplay,dropDisplay } from '../display';
import { rebuildGlassesPage,invalidateImages,pushLogoToGlasses,pushTastingNotesImages } from '../image-utils';
import { rebuildHomePage,buildTastingNotesPage } from '../pages';
import { clipBytes,clipLabel,labelBytes } from '../glasses-list';
import { lookupWineById,type CatalogWine } from '../identity';
import { type DailyQuestion, dailyState,ensureDaily,answerDaily,nextDaily,onDailyChange,reviewDaily } from './daily';
import { askSommelier,sommelierReplyMemory,type SommelierMessage } from './sommelier';
import { translateTexts,getLocale } from './client';
import { placeInsights } from '../atlas/insights';
import { STORY_SOURCES } from '../history/content';
let bridge:EvenAppBridge|null=null,base='',active=false,busy=false,revision=0,last=0;
let job=0;
let mode:'daily'|'sommelier'|'place'='daily',screen='text',pageIndex=0;
let passages:string[]=[],choices:{label:string;select:()=>Promise<void>|void}[]=[],back:()=>Promise<void>=goHome;
let messages:SommelierMessage[]=[],lastReply:any=null;
/** Unicode-safe passage splitting, below the G2's 999-byte text limit even in CJK. */
export function g2Passages(text:string){const parts:string[]=[];let current='';for(const char of Array.from(text)){if(new TextEncoder().encode(current+char).length>740){parts.push(current);current='';}current+=char;}if(current)parts.push(current);return parts.length?parts:[''];}
/** Study pages stay short, retain word boundaries, and give each teaching idea its own screen. */
export function studyPassages(sections:string[]){
 const result:string[]=[];
 for(const section of sections){let page='';
  for(const token of section.split(/(\s+)/u).filter(Boolean)){
   if(page&&(Array.from(page+token).length>470||new TextEncoder().encode(page+token).length>740)){result.push(page.trim());page='';}
   for(const char of Array.from(token)){
    if(Array.from(page+char).length>470||new TextEncoder().encode(page+char).length>740){result.push(page.trim());page='';}
    page+=char;
   }
  }
  if(page.trim())result.push(page.trim());
 }
 return result;
}
export function dailyTeachingSections(q:DailyQuestion,correct:boolean){
 const sections=[`${correct?'Correct':'Revisit this'}: ${q.options[q.correct_index]}\n\n${q.explanation}`];
 if(q.lesson){const lesson=q.lesson;sections.push(`IN THE GLASS\n\n${lesson.in_the_glass}`,`KEY DETAIL · ${lesson.key_detail.term}\n\n${lesson.key_detail.meaning}`,`NOTICE NEXT TIME\n\n${lesson.try_this}\n\nCatalog expectations; vintage unconfirmed.\nTeaching reference: ${lesson.key_detail.source.publisher}.\nFull references on your phone.`);}
 else sections.push(`Reference: ${q.evidence_quote}\n${q.source.publisher}`);
 return sections;
}
function studyHint(){return `Tap: ${pageIndex+1<passages.length?`${pageIndex+1}/${passages.length} · next`:'options'} · Scroll: read · 2x: back`;}
async function studyNarrative(heading:string,sections:string[]){title=heading;passages=studyPassages(sections);pageIndex=0;screen='text';await show(textPage(title,passages[0],studyHint()));}
function textPage(title:string,body:string,hint:string){return new RebuildPageContainer({containerTotalNum:3,textObject:[new TextContainerProperty({containerID:1,containerName:'intel-title',xPosition:16,yPosition:4,width:544,height:32,content:clipLabel(title,60),isEventCapture:0}),new TextContainerProperty({containerID:2,containerName:'intel-body',xPosition:16,yPosition:40,width:544,height:206,content:clipBytes(body),isEventCapture:1}),new TextContainerProperty({containerID:3,containerName:'intel-hint',xPosition:16,yPosition:254,width:544,height:30,content:clipLabel(hint,60),isEventCapture:0})]});}
function listPage(title:string,labels:string[]){return new RebuildPageContainer({containerTotalNum:2,textObject:[new TextContainerProperty({containerID:1,containerName:'intel-title',xPosition:16,yPosition:4,width:544,height:32,content:clipLabel(title,60),isEventCapture:0})],listObject:[new ListContainerProperty({containerID:2,containerName:'intel-options',xPosition:2,yPosition:42,width:572,height:240,isEventCapture:1,itemContainer:new ListItemContainerProperty({itemCount:labels.length,itemWidth:0,isItemSelectBorderEn:1,itemName:labels.map(label=>clipLabel(label))})})]});}
async function show(page:RebuildPageContainer){if(!bridge)return;invalidateImages();if(!await rebuildGlassesPage(bridge,page))throw Error('The glasses refused this screen.');last=Date.now();}
async function enter(next:typeof mode,onBack=goHome){if(!bridge)throw Error('Connect Even G2 first.');mode=next;back=onBack;revision++;await claimDisplay('intelligence',()=>{active=false;revision++;job++;busy=false;});active=true;}
async function goHome(){if(!bridge)return;active=false;revision++;dropDisplay('intelligence');await show(rebuildHomePage());window.dispatchEvent(new Event('winelens-glasses-home'));await pushLogoToGlasses(bridge,base);}
async function text(title:string,value:string,hint='Tap: continue · Scroll: read · 2x: back'){passages=g2Passages(value);pageIndex=0;screen='text';await show(textPage(title,passages[0],hint));}
let title='';
async function narrative(heading:string,value:string){title=heading;await text(heading,value,`Tap: ${g2Passages(value).length>1?'next passage':'options'} · Scroll: read · 2x: back`);}
async function menu(){screen='choices';await show(listPage(title,choices.map(c=>c.label)));}
async function failure(error:unknown){screen='error';await show(textPage('Connection needed',(error as Error).message,'Tap: retry · Double tap: back'));}
async function safe(task:()=>Promise<void>){if(busy)return;const ticket=++job;busy=true;try{await task();}catch(error){if(active&&ticket===job)await failure(error).catch(console.warn);}finally{if(ticket===job)busy=false;}}
async function renderDaily(){
 const s=dailyState();if(!s.edition)return;
 if(s.finished){choices=[{label:'Revisit marked questions',select:async()=>{reviewDaily(true);await renderDaily();}},{label:'Review all 20 questions',select:async()=>{reviewDaily();await renderDaily();}},{label:'Home',select:goHome}];await narrative('DAILY FLIGHT COMPLETE',`${Object.keys(s.progress.answers).length} answered.\n${s.progress.revisit.length} marked to revisit.\n\n${s.saveError||'Answers saved on this device. Questions saved in Supabase.'}`);return;}
 const q=s.question!;title=`STUDY · ${s.index+1}/${s.total}`;
 const answered=s.progress.answers[q.id];
 if(answered===undefined){choices=q.options.map((label,i)=>({label,select:async()=>{await answerDaily(i);await renderDaily();}}));await narrative(title,`${q.subject}\n\n${q.question}\n\nTap to choose an answer.`);}
 else {choices=[{label:'Next question',select:async()=>{nextDaily();await renderDaily();}},{label:'Return to Home',select:goHome}];if(q.lesson)await studyNarrative(title,[...dailyTeachingSections(q,answered===q.correct_index),...(s.saveError?[s.saveError]:[])]);else await narrative(title,dailyTeachingSections(q,answered===q.correct_index).join('\n\n')+'\n'+s.saveError);}
}
export async function openDailyGlasses(){return safe(async()=>{await enter('daily');screen='loading';await show(textPage('STUDY TODAY','Preparing 20 questions across eight wines…','Double tap: cancel'));const token=revision;await ensureDaily();if(!active||token!==revision)return;await renderDaily();});}
async function converse(answer?:string){
 if(answer)messages.push({role:'user',content:answer});
 if(messages.length>=16){await narrative('FIND MY WINE','Start a fresh conversation on your phone to explore further.');choices=[{label:'Start over',select:async()=>{messages=[];await startSommelier();}},{label:'Home',select:goHome}];return;}
 const token=revision;screen='loading';await show(textPage('FIND MY WINE','Considering your preferences…','Double tap: cancel'));
 try{const reply=await askSommelier(messages);if(token!==revision||!active)return;messages.push({role:'assistant',content:sommelierReplyMemory(reply)});lastReply=reply;await showReply();}
 catch(error){if(answer&&token===revision)messages.pop();throw error;}
}
async function showReply(){
 const reply=lastReply;choices=[...reply.matches.map((match:any)=>({label:lookupWineById(match.wine_id)?.wine.name||'',select:async()=>{const entry=lookupWineById(match.wine_id);if(!entry||!bridge)return;screen='wine';await show(buildTastingNotesPage(entry.wine,entry.id));await pushTastingNotesImages(bridge,base,entry.id);}})),...reply.suggestions.map((label:string)=>({label,select:()=>converse(label)})),{label:'More detail / type on phone',select:()=>narrative('CONTINUE ON YOUR PHONE','Open Find My Wine on Home to type your food, budget or other preferences. The glasses support the suggested replies here.')},{label:'Home',select:goHome}].slice(0,12);
 await narrative('FIND MY WINE',[reply.message,...reply.matches.map((m:any)=>`${lookupWineById(m.wine_id)?.wine.name}\n${m.reason}\n${m.tradeoff}`),reply.question].filter(Boolean).join('\n\n'));
}
async function startSommelier(){
 choices=[{label:'Fresh with seafood',select:()=>converse('Something fresh with seafood.')},{label:'Smooth red, gentle tannins',select:()=>converse('A smooth red without drying tannins.')},{label:'With a rich meal',select:()=>converse('A wine with a rich meal; help me narrow it down.')},{label:'Try something different',select:()=>converse('I want to discover something different. Ask me about what I already like.')},{label:'Just exploring',select:()=>converse('I am exploring. Help me understand what I might enjoy.')}];
 await narrative('FIND MY WINE','What would feel right?\n\nWe’ll talk about your food, likes and dislikes, then narrow down the catalog.\n\nTap to begin. You can type more detail on your phone.');
}
export async function openSommelierGlasses(){return safe(async()=>{await enter('sommelier');messages=[];lastReply=null;await startSommelier();});}
let placeBody='';
async function showPlaceReading(){screen='place-story';await show(readableText(textPage(title,' ','Scroll: read · 2x: chapters'),2,placeBody));}
export async function openPlaceGlasses(country:string,region:string|null,wines:CatalogWine[],onBack:()=>Promise<void>){return safe(async()=>{
 await enter('place',onBack);title=region||country;
 const cards=placeInsights(country,wines,region);
 choices=[...cards.map(c=>({label:c.title,select:async()=>{
  const original=`${c.scope}\n\n${c.title}\n\n${c.cue}\n\n${c.detail}\n\nSource: ${STORY_SOURCES[c.source].publisher}`;
  let body=original;
  if(getLocale()!=='en'){screen='loading';await show(textPage(title,'Translating place insights…','Double tap: cancel'));const token=revision;
   try{const translated=(await translateTexts([original]))[0];if(labelBytes(translated)<=READING_MAX_BYTES)body=translated;}catch{/* Full original stays available. */}
   if(!active||token!==revision)return;
  }
  placeBody=body;await showPlaceReading();
 }})),{label:'Back',select:onBack}];
 await menu();
});}
export function connectIntelligenceGlasses(value:EvenAppBridge,url:string){bridge=value;base=url;window.addEventListener('winelens-daily-glasses',event=>{event.preventDefault();void openDailyGlasses();});onDailyChange(()=>{if(active&&mode==='daily'&&!busy)void safe(renderDaily);});}
export function handleIntelligenceGlasses(event:EvenHubEvent){
 if(!active)return false;const type=event.listEvent?.eventType??event.textEvent?.eventType??event.sysEvent?.eventType;
 if(type===OsEventTypeList.DOUBLE_CLICK_EVENT){const action=screen==='wine'?showReply:screen==='place-story'?menu:back;revision++;job++;busy=false;void action().catch(console.warn);return true;}
 if(busy||Date.now()-last<350)return true;
 if(type===OsEventTypeList.SCROLL_TOP_EVENT||type===OsEventTypeList.SCROLL_BOTTOM_EVENT)return true;
 if(type!==undefined&&type!==OsEventTypeList.CLICK_EVENT)return true;
 void safe(async()=>{if(screen==='error'){if(mode==='daily'){await ensureDaily();await renderDaily();}else if(mode==='sommelier'){if(messages.length)await converse();else await startSommelier();}else await back();return;}
  if(screen==='text'){if(pageIndex+1<passages.length){pageIndex++;await show(textPage(title,passages[pageIndex],mode==='daily'?studyHint():`Tap: ${pageIndex+1<passages.length?'next passage':'options'} · Scroll: read · 2x: back`));}else await menu();}
  else if(screen==='choices'){const choice=choices[event.listEvent?.currentSelectItemIndex??0];if(choice)await choice.select();}
 });return true;
}

/** Background work must never paint over a later screen or hold the controller busy. */
export function pauseIntelligenceGlasses(){if(active){revision++;job++;busy=false;}}
export async function resumeIntelligenceGlasses(){if(!active)return;return safe(async()=>{if(mode==='daily'){if(dailyState().edition)await renderDaily();else await failure(Error('Study paused. Tap to retry.'));}else if(mode==='sommelier'){if(lastReply)await showReply();else await startSommelier();}else if(mode==='place'){if(screen==='place-story')await showPlaceReading();else await menu();}else await narrative(title,passages.join(''));});}
