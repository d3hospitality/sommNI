import { importMenu } from './menu-import.ts';
import { createBottleDiscovery } from './bottle-discovery.ts';
import { pcmWave, transcribePcm } from './transcription.ts';
import { Fault, text, photo, narration, hash } from '../winelens-research/domain.ts';
import { createWineProvider } from '../winelens-research/provider.ts';
import { bottleStudioPrompt } from '../../../prompts/bottle-studio.ts';
type Deps={env:(key:string)=>string|undefined;fetch:typeof fetch;reserve:(weight:number)=>Promise<boolean>;resolveHost?:(host:string)=>Promise<string[]>;cacheResearch?:(key:string,build:()=>Promise<any>)=>Promise<any>};
export function createBetaService({env,fetch:fetcher,reserve,cacheResearch,resolveHost}:Deps){
 const {gemini,structured}=createWineProvider(env,fetcher);
 const discover=createBottleDiscovery(env,fetcher,resolveHost||(()=>Promise.reject(Error('Resolver unavailable'))));
 const ready=()=>({research:!!(env('GEMINI_API_KEY')||env('OPENAI_API_KEY')),research_provider:env('GEMINI_API_KEY')?'Google Gemini + Search':env('OPENAI_API_KEY')?'OpenAI + web search':null,audio:!!env('ELEVENLABS_API_KEY')&&!!env('ELEVENLABS_VOICE_ID'),transcription:!!env('OPENAI_API_KEY'),studio:!!env('OPENAI_API_KEY'),intelligence:!!env('OPENAI_API_KEY'),community:true,free:true,account_required:false});
 const spend=async(weight=1)=>{if(!await reserve(weight))throw new Fault(429,'Several requests are running from this connection. Wait one minute and retry.');};
 return async(body:any):Promise<any>=>{
  if(body.action==='import_menu'){await spend();return importMenu(body,{env,fetch:fetcher,resolveHost:resolveHost||(()=>Promise.reject(Error('Resolver unavailable')))});}
  if(body.action==='status')return {...ready(),bottle_search:!!env('OPENAI_API_KEY')};
  if(body.action==='bottle_lookup'||body.action==='bottle_candidates'){
   const identity={wine_name:text(body.wine_name,200,true),producer:text(body.producer??'',160),vintage:body.vintage==null?null:text(String(body.vintage),8)};
   const key='bottle-photo:4:'+await hash(JSON.stringify(identity).normalize('NFKC').toLowerCase());
   const build=async()=>{await spend(5);return discover(identity);};
   return cacheResearch?cacheResearch(key,build):build();
  }
  if(body.action==='transcribe'){
   if(!ready().transcription)throw new Fault(503,'G2 transcription awaits server setup. Use Read with me in Chrome meanwhile.');
   const wav=pcmWave(body);if(!wav)return {text:''};
   const language=body.locale??'en';if(!['en','es','fr','it','de','pt','ja','zh','ko'].includes(language))throw new Fault(400,'Unsupported transcription language.');
   await spend();return transcribePcm(wav,env('OPENAI_API_KEY')!,fetcher,language);
  }
  if(body.action==='research'){
   if(!ready().research)throw new Fault(503,'Live wine research awaits provider setup. No account or payment is needed. You can add wines and photos directly in Winebrary.');
   const query=text(body.query??'',400),image=photo(body.photo);if(!query&&!image)throw new Fault(400,'Enter a wine name or add a label photo.');
   const build=async()=>{
    await spend(3);
    const label=image?await structured('identify',query||'Read this wine label.',image.data):null;
    const research=await gemini('research',JSON.stringify({query,label}));if(!research.sources.length)throw new Fault(422,'No web sources returned. Try a more specific name.');
    const result=await structured('structure',JSON.stringify({query,label,report:research.answer}));
    return {result,report:research.answer,evidence:{sources:research.sources,supports:research.supports,citations:('citations' in research?research.citations:[])},search_html:research.search_html};
   };
   // Share only named wine research. Photos and library context never enter this cache.
   const key='research:2:'+Math.floor(Date.now()/(7*86400000))+':'+await hash(query.normalize('NFKC').toLowerCase().replace(/\s+/g,' ').trim());
   const result=!image&&!body.refresh&&cacheResearch?await cacheResearch(key,build):await build();
   return {draft:{id:crypto.randomUUID(),query,...result},cached:!!result.cached};
  }
  if(body.action==='ask'){
   if(!ready().research)throw new Fault(503,'Live recommendations await provider setup. No account or payment is needed. Explore the catalogue and Pairings meanwhile.');
   const question=text(body.question,1200,true);
   if(body.library!=null&&!Array.isArray(body.library))throw new Fault(400,'Invalid library context.');
   const wines=(body.library??[]).slice(0,50).map((w:any)=>({wine_name:text(w.wine_name,300,true),producer:text(w.producer??'',200),vintage:w.vintage==null?null:text(String(w.vintage),10),region:text(w.region??'',200)}));
   await spend();return {...await gemini('ask',JSON.stringify({question,library:wines,library_scope:'User-provided local wines; not verified stock.'})),library_count:wines.length};
  }
  if(body.action==='audio'){
   if(!ready().audio)throw new Fault(503,'ElevenLabs MP3 awaits provider setup. Device read-aloud and text downloads are free now.');
   const w=body.wine;if(!w||typeof w!=='object')throw new Fault(400,'Save notes first.');
   const wine={wine_name:text(w.wine_name,300,true),producer:text(w.producer??'',200),vintage:w.vintage==null?null:text(String(w.vintage),10),region:text(w.region??'',200),notes:text(w.notes??'',2000),metadata:{tasting_notes:text(w.metadata?.tasting_notes??'',2000),vintage_state:text(w.metadata?.vintage_state??'unknown',20)}};
   const script=narration(wine);await spend(2);
   const response=await fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(env('ELEVENLABS_VOICE_ID')!)}?output_format=mp3_44100_128`,{method:'POST',headers:{'xi-api-key':env('ELEVENLABS_API_KEY')!,'Content-Type':'application/json'},body:JSON.stringify({text:script,model_id:env('ELEVENLABS_MODEL')||'eleven_multilingual_v2'}),signal:AbortSignal.timeout(35000)});
   if(!response.ok||!response.headers.get('content-type')?.includes('audio/'))throw new Fault(502,'Audio provider could not finish. Try again later.');
   const bytes=new Uint8Array(await response.arrayBuffer());if(!bytes.length||bytes.length>8388608)throw new Fault(502,'Audio was incomplete or too large.');
   let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   const url=`data:audio/mpeg;base64,${btoa(binary)}`;return {url,download_url:url,script};
  }
  if(body.action==='studio'){
   if(!ready().studio)throw new Fault(503,'Studio rendering awaits provider setup. Your original photo can be saved for free.');
   // Only inline images supplied by this caller; never fetch caller-controlled URLs.
   const source=text(body.photo,3000000,true),match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(source);if(!match)throw new Fault(400,'Choose a JPEG, PNG or WebP photograph.');
   const bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));if(bytes.length>2097152)throw new Fault(413,'Choose a photo under 2 MB.');
   await spend(10);const form=new FormData();form.set('model','gpt-image-1');form.set('prompt',bottleStudioPrompt);form.set('size','1024x1024');form.set('quality','low');form.set('image',new Blob([bytes],{type:match[1]}),'bottle.'+match[1].split('/')[1]);
   const response=await fetcher('https://api.openai.com/v1/images/edits',{method:'POST',headers:{Authorization:`Bearer ${env('OPENAI_API_KEY')}`},body:form,signal:AbortSignal.timeout(120000)});
   if(!response.ok)throw new Fault(502,'The studio could not finish this rendering.');
   const result=await response.json(),data=result.data?.[0]?.b64_json;if(typeof data!=='string'||data.length>12000000||!/^[A-Za-z0-9+/]+=*$/.test(data))throw new Fault(502,'No usable studio image was returned.');
   const url=`data:image/png;base64,${data}`;return {draft:{path:url,url,source:'generated'}};
  }
  throw new Fault(400,'Unknown beta action.');
 };
}
