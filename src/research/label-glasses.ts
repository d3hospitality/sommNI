import { type EvenAppBridge, type EvenHubEvent, RebuildPageContainer, TextContainerProperty, ImageContainerProperty, ListContainerProperty, ListItemContainerProperty, TextContainerUpgrade } from '@evenrealities/even_hub_sdk';
import { labelSession, labelProgress, startLabels, subscribeLabels } from './label-session';
import type { LabelQueue, LabelRow } from './label-queue';
import type { LibraryWine } from '../winebrary';
import { claimDisplay, dropDisplay } from '../display';
import { rebuildGlassesPage, pushBottlePhoto, invalidateImages, imageIdle, sendSerial } from '../image-utils';
import { clipLabel, clipBytes } from '../glasses-list';
import { openLibraryOnGlasses, readLibrary } from '../winebrary-glasses';

let observedRow:LabelRow|undefined,observedChoice=-1,observedPreview:string|undefined;
let bridge:EvenAppBridge|null=null,active=false,paused=false,last=0,revision=0,painted='',source='',traffic=Promise.resolve(),scheduled=false,dirty=false;
export function labelActions(s:LabelQueue){const r=s.current;return [
 r.state==='error'?'Retry photo search':r.work==='saved'?'Saved · next wine':s.busy?'Saving · please wait':r.state!=='ready'?'Searching · please wait':'Use this photo',
 ...r.options.map((_,i)=>`View photo ${i+1} of ${r.options.length}`),
 'Search again','Next wine','Back to Winebrary'];}
export function buildLabelPage(s:LabelQueue){
 const r=s.current,w=r.wine;
 return new RebuildPageContainer({containerTotalNum:6,textObject:[
  new TextContainerProperty({containerID:3,containerName:'label-title',xPosition:132,yPosition:4,width:432,height:58,isEventCapture:0,content:clipLabel(w.wine_name,42)+'\n'+clipLabel([w.producer,w.vintage||'Year unknown'].filter(Boolean).join(' · '),42)}),
  new TextContainerProperty({containerID:4,containerName:'label-status',xPosition:132,yPosition:65,width:432,height:30,isEventCapture:0,content:clipLabel(`Wine ${s.index+1}/${s.rows.length} · Photo ${r.options.length?r.choice+1:0}/${r.options.length}`,44)}),
  new TextContainerProperty({containerID:6,containerName:'label-progress',xPosition:8,yPosition:254,width:560,height:30,isEventCapture:0,content:clipLabel(labelProgress(),57)}),
 ],listObject:[new ListContainerProperty({containerID:5,containerName:'label-actions',xPosition:130,yPosition:92,width:444,height:160,isEventCapture:1,itemContainer:new ListItemContainerProperty({itemCount:labelActions(s).length,itemWidth:0,isItemSelectBorderEn:1,itemName:labelActions(s)})})],imageObject:[
  new ImageContainerProperty({containerID:1,containerName:'bottle-top',xPosition:8,yPosition:6,width:112,height:120}),
  new ImageContainerProperty({containerID:2,containerName:'bottle-bot',xPosition:8,yPosition:126,width:112,height:120}),
 ]});
}
async function release(){active=false;revision++;painted='';source='';invalidateImages();await traffic.catch(()=>{});await imageIdle();}
function schedule(){if(!active||paused)return;if(scheduled){dirty=true;return;}scheduled=true;queueMicrotask(()=>{void render().catch(error=>console.warn('[sommNI] Label review',error)).finally(()=>{scheduled=false;if(dirty){dirty=false;schedule();}});});}
async function render(){
 const s=labelSession();if(!bridge||!active||paused||!s?.current)return;
 const token=revision,r=s.current,key=JSON.stringify([s.index,r.state,labelActions(s)]),photo=r.preview||r.options[r.choice]?.photo||'';
 traffic=traffic.catch(()=>{}).then(async()=>{
  if(!active||paused||token!==revision||s!==labelSession())return;
  const valid=()=>active&&!paused&&token===revision&&s===labelSession();
  if(key!==painted){if(!await rebuildGlassesPage(bridge!,buildLabelPage(s)))throw Error('Glasses could not open label review.');if(!valid())return;painted=key;source='';last=Date.now();}
  else await sendSerial(async()=>{if(valid())await bridge!.textContainerUpgrade(new TextContainerUpgrade({containerID:6,containerName:'label-progress',content:clipLabel(labelProgress(),57),contentOffset:0,contentLength:0}));});
  if(!valid())return;
  const status=r.state==='error'||r.work==='error'?clipBytes(r.message,85):r.work==='polishing'?'Polishing selected photograph…':r.work==='saving'?'Saving selected bottle…':`Wine ${s.index+1}/${s.rows.length} · Photo ${r.options.length?r.choice+1:0}/${r.options.length} · Check year`;
  await sendSerial(async()=>{if(valid())await bridge!.textContainerUpgrade(new TextContainerUpgrade({containerID:4,containerName:'label-status',content:clipLabel(status,43),contentOffset:0,contentLength:0}));});
  if(photo&&photo!==source&&valid()){try{await pushBottlePhoto(bridge!,photo,112,120);if(valid())source=photo;}catch{await sendSerial(async()=>{if(valid())await bridge!.textContainerUpgrade(new TextContainerUpgrade({containerID:4,containerName:'label-status',content:'Preview failed · choose another photo',contentOffset:0,contentLength:0}));});}}
 });await traffic;
}
export async function openLabelGlasses(wines?:LibraryWine[]){
 if(!bridge)throw Error('Connect your glasses first.');
 if(wines)startLabels(wines);else if(!labelSession())startLabels(readLibrary().items.slice(0,20));
 await claimDisplay('label-review',release);active=true;paused=false;revision++;painted='';source='';await render();
}
export function connectLabelGlasses(value:EvenAppBridge){bridge=value;subscribeLabels(()=>{const r=labelSession()?.current;if(r!==observedRow||r?.choice!==observedChoice||r?.preview!==observedPreview){observedRow=r;observedChoice=r?.choice??-1;observedPreview=r?.preview;if(active){revision++;invalidateImages();}}schedule();});window.addEventListener('sommni-library-account-changing',()=>{if(active)void release().then(()=>{dropDisplay('label-review');return openLibraryOnGlasses();}).catch(console.warn);});}
export function pauseLabelGlasses(){if(active){paused=true;revision++;invalidateImages();}}
export async function resumeLabelGlasses(){if(!active)return;paused=false;revision++;painted='';source='';await render();}
export function handleLabelGlasses(event:EvenHubEvent){
 if(!active)return false;if(paused)return true;
 const type=event.listEvent?.eventType??event.textEvent?.eventType??event.sysEvent?.eventType??0;
 if(type===3){void release().then(()=>{dropDisplay('label-review');return openLibraryOnGlasses();});return true;}
 if(type!==0||!event.listEvent||Date.now()-last<350)return true;
 const s=labelSession();if(!s)return true;const i=event.listEvent.currentSelectItemIndex??0;
 const count=s.current.options.length;
 if(i===count+3){void release().then(()=>{dropDisplay('label-review');return openLibraryOnGlasses();});return true;}
 if(i===0){if(s.current.state==='error')s.retry();else if(s.current.work==='saved')s.move(1);else void s.use();}
 else if(i>=1&&i<=count)s.photo(i-1-s.current.choice);
 else if(i===count+1)s.retry();else if(i===count+2)s.move(1);
 schedule();return true;
}
