import { EvenAppBridge, EvenHubEvent, CreateStartUpPageContainer, RebuildPageContainer, TextContainerProperty, TextContainerUpgrade, ImageContainerProperty, ImageRawDataUpdate, ImageRawDataUpdateResult, OsEventTypeList } from '@evenrealities/even_hub_sdk';
import { encodeGrayscalePng } from '../pngEncoder';
import { GlobeRenderer } from './renderer';
import { AtlasNavigator } from './navigator';
import { AtlasTransport } from './transport';
import { validateGlassesPage } from '../glasses-page';
import { stageCanvas, toGreenLevels, bottleSourceKey, type BottleSource } from '../bottle-raster';
export const ATLAS_SIZE=244;
/** n characters at most; long lines end at a word with "..." (ASCII: the G2 font may lack "…"). */
const clip=(s:string,n=32)=>{
  const chars=[...s]; if(chars.length<=n) return s;
  let cut=chars.slice(0,n-3).join(''); const space=cut.lastIndexOf(' ');
  if(space>n*0.6) cut=cut.slice(0,space);
  return cut.replace(/[\s–—,·-]+$/,'')+'...';
};
export function atlasTexts(nav:AtlasNavigator) {
  return {title:clip(nav.title,32), rows:nav.rows.split('\n').map(s=>clip(s,31)).join('\n'), hint:clip(nav.hint,38)};
}
export function buildAtlasPage(nav:AtlasNavigator) {
  const text=atlasTexts(nav);
  return new RebuildPageContainer({containerTotalNum:5,textObject:[
    new TextContainerProperty({xPosition:12,yPosition:10,width:304,height:34,containerID:1,containerName:'atlas-title',content:text.title,isEventCapture:0}),
    new TextContainerProperty({xPosition:12,yPosition:56,width:304,height:186,containerID:2,containerName:'atlas-rows',content:text.rows,isEventCapture:1}),
    new TextContainerProperty({xPosition:12,yPosition:250,width:304,height:30,containerID:5,containerName:'atlas-hint',content:text.hint,isEventCapture:0}),
  ], imageObject:[
    new ImageContainerProperty({xPosition:324,yPosition:20,width:244,height:122,containerID:3,containerName:'atlas-top'}),
    new ImageContainerProperty({xPosition:324,yPosition:142,width:244,height:122,containerID:4,containerName:'atlas-bottom'}),
  ]});
}
export class AtlasGlasses {
  private active=false;
  private transport:AtlasTransport;
  private photos=new Map<string,Uint8Array>();
  // undefined = map view; null = wine with no photograph (clear the previous wine).
  constructor(private bridge:EvenAppBridge,public navigator:AtlasNavigator,private renderer:GlobeRenderer,private onChange:()=>void,private onError:(error:Error)=>void, private onExit?:()=>Promise<void>, private bottleSource?:()=>BottleSource|null|undefined) {
    this.transport=new AtlasTransport(onError);
  }
  async open(startup=false) {
    this.active=false;this.transport.invalidate();await this.transport.idle();
    const page=buildAtlasPage(this.navigator);
    validateGlassesPage(page);
    if(startup) {
      const result=await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page));
      if(result!==0&&!await this.bridge.rebuildPageContainer(page))throw new Error('Atlas page refused');
    }else if(!await this.bridge.rebuildPageContainer(page))throw new Error('Atlas page refused');
    this.active=true;this.refresh();
  }
  async close(){this.active=false;this.transport.invalidate();await this.transport.idle();}
  refresh(){
    if(!this.active)return;
    const texts=atlasTexts(this.navigator),view=this.navigator.view,source=this.bottleSource?.();
    const steps:(()=>Promise<unknown>)[]=[];
    for(const [id,name,content] of [[1,'atlas-title',texts.title],[2,'atlas-rows',texts.rows],[5,'atlas-hint',texts.hint]] as const) {
      steps.push(async()=>{const ok=await this.bridge.textContainerUpgrade(new TextContainerUpgrade({containerID:id,containerName:name,content,contentOffset:0,contentLength:0}));if(!ok)throw new Error('Atlas text update refused');});
    }
    let gray:Uint8Array;
    // Text leads; the image follows a settled cursor. Superseded frames never send.
    steps.push(async()=>{await new Promise(r=>setTimeout(r,180));});
    steps.push(async()=>{
      if(source===undefined){gray=this.renderer.render(view,ATLAS_SIZE).gray;return;}
      gray=new Uint8Array(ATLAS_SIZE*ATLAS_SIZE);
      if(!source)return;
      const key=bottleSourceKey(source);
      const cached=this.photos.get(key);
      if(cached){gray=cached;return;}
      try {
        const canvas=await stageCanvas(source,ATLAS_SIZE,ATLAS_SIZE);
        gray=toGreenLevels(canvas.getContext('2d')!.getImageData(0,0,ATLAS_SIZE,ATLAS_SIZE).data,ATLAS_SIZE);
        if(this.photos.size>=6)this.photos.delete(this.photos.keys().next().value!);
        this.photos.set(key,gray);
      } catch(error){console.warn('[Atlas] Bottle photo unavailable; wine remains selectable.',error);}
    });
    for(let half=0;half<2;half++)steps.push(async()=>{
      const pixels=gray.subarray(half*244*122,(half+1)*244*122);
      const result=await this.bridge.updateImageRawData(new ImageRawDataUpdate({containerID:3+half,containerName:half?'atlas-bottom':'atlas-top',imageData:Array.from(encodeGrayscalePng(244,122,pixels))}));
      if(!ImageRawDataUpdateResult.isSuccess(result))throw new Error('Atlas image transfer failed');
    });
    this.transport.enqueue(steps);
  }
  handle(event:EvenHubEvent):boolean {
    if(!this.active)return false;
    const type=event.textEvent?.eventType??event.listEvent?.eventType??event.sysEvent?.eventType;
    if(type===OsEventTypeList.SCROLL_TOP_EVENT)this.navigator.scroll(-1);
    else if(type===OsEventTypeList.SCROLL_BOTTOM_EVENT)this.navigator.scroll(1);
    else if(type===OsEventTypeList.CLICK_EVENT||type===undefined&&!!(event.textEvent||event.listEvent||event.sysEvent))this.navigator.select();
    else if(type===OsEventTypeList.DOUBLE_CLICK_EVENT){
      if(this.navigator.mode==='countries'&&this.onExit){void this.close().then(this.onExit).catch(this.onError);return true;}
      this.navigator.back();
    }
    else return true;
    this.onChange();this.refresh();
    console.info('[Atlas]',this.navigator.mode,this.navigator.country.name,this.navigator.mode==='countries'?'':this.navigator.region?.name);
    return true;
  }
}
