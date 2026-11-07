import { readableText } from '../reading/document';
import { EvenAppBridge, EvenHubEvent, OsEventTypeList, RebuildPageContainer, TextContainerProperty, ListContainerProperty, ListItemContainerProperty } from '@evenrealities/even_hub_sdk';
import { pageList, clipLabel } from '../glasses-list';
import { claimDisplay, dropDisplay, displayOwner } from '../display';
import { rebuildGlassesPage, invalidateImages, imageIdle, pushLogoToGlasses } from '../image-utils';
import { rebuildHomePage } from '../pages';
import { storyWines, storyCards, STORY_SOURCES, wineHistoryCards, storyParagraphs, type StoryTopic, type StoryCard } from './content';

type Screen = {kind:'home'} | {kind:'wines';page:number} | {kind:'topics';wineId:string} | {kind:'card';wineId:string;topic:StoryTopic;index:number;part?:number};
let bridge: EvenAppBridge | null = null, connected = false, active = false, busy = false, revision = 0, lastNavigation = 0;
let screen: Screen = {kind:'wines',page:0};
let winePage=0;
let message = 'Open in Even Hub and connect G2 to read history on glasses.';
const notify = () => window.dispatchEvent(new Event('winelens-history-status'));
export function historyStatus() { return {ready:!!bridge && connected, busy, message}; }
export function connectHistoryGlasses(value:EvenAppBridge) { bridge=value; notify(); }
export function setHistoryConnected(value:boolean) {
  connected=value;
  if(!value) { revision++; active=false; if(displayOwner()==='history') invalidateImages(); dropDisplay('history'); }
  message=value ? 'Choose an insight to read on glasses.' : 'Open in Even Hub and connect G2 to read history on glasses.';
  notify();
}
const box = (id:number,y:number,h:number,content:string,capture=0) => new TextContainerProperty({containerID:id,containerName:`story-${id}`,xPosition:24,yPosition:y,width:528,height:h,content,isEventCapture:capture});
/** A whole chapter in one native scrolling text container. */
export function storyPassages(card:StoryCard):string[] {
  return [[card.date==='The wine in context'?card.title:card.date+' · '+card.title,...storyParagraphs(card)].join('\n\n')];
}
export function buildStoryPage(card:StoryCard, topic:StoryTopic, index:number,total:number,part=0):RebuildPageContainer {
  const source=STORY_SOURCES[card.source];
  return readableText(new RebuildPageContainer({containerTotalNum:3,textObject:[
    box(1,4,30,clipLabel(card.scope.toUpperCase(),55)),
    box(2,42,200,' ',1),
    box(4,254,30,'Scroll: read · 2x: chapters'),
  ]}),2,storyPassages(card)[0]+'\n\nSource: '+source.publisher);
}
export function storyWineMenu(page=0) { return pageList(storyWines().map(w=>w.wine.name),page); }
export function buildStoryWineMenu(page=0) {
  const menu=storyWineMenu(page);
  return menuPage(`WINE HISTORY · ${menu.page+1}/${menu.pageCount} · ${storyWines().length} wines`,menu.labels);
}
function menuPage(title:string,labels:string[]) {
  return new RebuildPageContainer({containerTotalNum:3,textObject:[box(1,4,30,title),box(3,254,30,'Tap: choose · Double tap: back')],listObject:[new ListContainerProperty({xPosition:24,yPosition:48,width:528,height:160,containerID:2,containerName:'story-menu',isEventCapture:1,itemContainer:new ListItemContainerProperty({itemCount:labels.length,itemWidth:0,isItemSelectBorderEn:1,itemName:labels})})]});
}
async function relinquish() { revision++; active=false; await imageIdle(); }
function pageFor(next:Screen) {
  if(next.kind==='home') return menuPage('WINE HISTORY',['Wine stories','Countries & regions']);
  if(next.kind==='wines') return buildStoryWineMenu(next.page);
  if(next.kind==='topics') return menuPage('BEHIND THE WINE',wineHistoryCards(next.wineId).map(c=>clipLabel((/^\d/.test(c.date)?c.date+' · ':'')+c.title)));
  const cards=storyCards(next.wineId,next.topic);
  if(!cards[next.index]) throw new Error('This insight is unavailable.');
  return buildStoryPage(cards[next.index],next.topic,next.index,cards.length,next.part??0);
}
async function render(next:Screen) {
  if(!bridge || !connected) throw new Error('Connect G2 in Even Hub first.');
  const page=pageFor(next), token=revision;
  await claimDisplay('history',relinquish);
  if(token!==revision || !connected) {dropDisplay('history');return;}
  invalidateImages();
  let accepted=false;
  try { accepted=await rebuildGlassesPage(bridge,page); }
  catch(error) { if(!active && token===revision) dropDisplay('history'); throw error; }
  if(token!==revision || !connected || displayOwner()!=='history') return;
  if(!accepted) { if(!active) dropDisplay('history'); throw new Error('Glasses did not accept the insight. Try again.'); }
  if(next.kind==='wines')winePage=next.page;
  screen=next; active=true; lastNavigation=Date.now(); message='Story displayed on glasses. Double tap goes back.';
}
async function home() {
  const token=revision;
  invalidateImages();
  if(!bridge || !await rebuildGlassesPage(bridge,rebuildHomePage())) throw new Error('Glasses did not accept Home. Try again.');
  if(token!==revision) return;
  active=false; dropDisplay('history'); message='Returned to the glasses home menu.';
  window.dispatchEvent(new Event('winelens-glasses-home'));
  try { await pushLogoToGlasses(bridge,new URL('./',location.href).href); } catch { /* Home remains usable without its logo. */ }
}
async function run(task:()=>Promise<void>) {
  if(busy) return;
  busy=true; notify();
  try { await task(); } catch(error) { message=error instanceof Error ? error.message : String(error); }
  finally { busy=false; notify(); }
}
export async function openHistoryOnGlasses(wineId?:string,topic:StoryTopic='region',index=0) {
  if(wineId)winePage=Math.max(0,Math.floor(storyWines().findIndex(w=>w.id===wineId||w.legacyId===wineId)/18));
  await run(()=>render(wineId ? {kind:'card',wineId,topic,index,part:0} : {kind:'home'}));
}
export function handleHistoryGlassesEvent(event:EvenHubEvent):boolean {
  if(!active) return busy && displayOwner()==='history';
  const type=event.listEvent?.eventType ?? event.textEvent?.eventType ?? event.sysEvent?.eventType;
  if(busy) return true;
  if(type===OsEventTypeList.DOUBLE_CLICK_EVENT) {
    void run(()=> screen.kind==='home' ? home() : screen.kind==='wines' ? (screen.page>0?render({kind:'wines',page:screen.page-1}):render({kind:'home'})) : render(screen.kind==='topics' ? {kind:'wines',page:winePage} : {kind:'topics',wineId:screen.wineId})); return true;
  }
  if(Date.now()-lastNavigation<350) return true;
  const click=type===OsEventTypeList.CLICK_EVENT || (type===undefined && !!(event.listEvent || event.textEvent || event.sysEvent));
  if(screen.kind==='card') {
    // The firmware scrolls the entire chapter. Never replace it on every swipe.
  } else if(click && event.listEvent) {
    const index=event.listEvent.currentSelectItemIndex ?? 0;
    const current=screen;
    if(current.kind==='home'){
      if(index===0)void run(()=>render({kind:'wines',page:0}));
      else if(index===1)void run(async()=>{const {openAtlasOnGlasses}=await import('../atlas-app');await openAtlasOnGlasses();});
    }
    else if(current.kind==='wines') {
      const row=storyWineMenu(current.page).rows[index];
      if(row?.kind==='more')void run(()=>render({kind:'wines',page:current.page+1}));
      else if(row?.kind==='back')void run(()=>current.page>0?render({kind:'wines',page:current.page-1}):render({kind:'home'}));
      else if(row?.kind==='item'){const wine=storyWines()[row.index];if(wine)void run(()=>render({kind:'topics',wineId:wine.id}));}
    }
    else if(wineHistoryCards(current.wineId)[index]) void run(()=>render({kind:'card',wineId:current.wineId,topic:'time',index}));
  }
  return true;
}
