import { Fault, text, uuid, review, photo, grounding, hash, narration } from './domain.ts';
import { createWineProvider } from './provider.ts';
type Deps={db:any; env:(key:string)=>string|undefined; fetch:typeof fetch};
export function createResearchService({db,env,fetch:fetcher}:Deps) {
 const {gemini,structured}=createWineProvider(env,fetcher);
 const ready=()=>({research:!!(env('GEMINI_API_KEY')||env('OPENAI_API_KEY')),research_provider:env('GEMINI_API_KEY')?'Google Gemini + Search':env('OPENAI_API_KEY')?'OpenAI + web search':null,audio:!!env('ELEVENLABS_API_KEY')&&!!env('ELEVENLABS_VOICE_ID')});
 const check=(result:any)=>{if(result.error)throw new Fault(503,'Could not save or load this wine. Please try again.');return result.data};
 async function signed(bucket:string,path:string,user:string,download=false) {
  if(!path.startsWith(user+'/'))throw new Fault(403,'This file is not in your library.');
  return check(await db.storage.from(bucket).createSignedUrl(path,600,download?{download:true}:{})).signedUrl;
 }
 async function decorate(wine:any,user:string) {return {...wine,image_url:wine.metadata?.image_path?await signed('winelens-bottles',wine.metadata.image_path,user):undefined};}
 async function job(user:string,id:string,action:string,input:unknown,work:()=>Promise<any>) {
  const fingerprint=await hash(JSON.stringify(input));
  const start=check(await db.rpc('wl_research_begin',{p_user:user,p_id:id,p_action:action,p_fingerprint:fingerprint}));
  if(start.status==='done')return start.result;
  if(start.status==='limited')throw new Fault(429,'The research pilot has reached its daily limit. Try again tomorrow.');
  if(start.status==='running')throw new Fault(409,'This request is still running. Wait before retrying.');
  if(start.status==='failed')throw new Fault(409,'This attempt did not finish. Start a new attempt.');
  try {const result=await work();check(await db.from('wl_research_jobs').update({status:'done',result}).eq('user_id',user).eq('id',id));return result;}
  catch(error){await db.from('wl_research_jobs').update({status:'failed'}).eq('user_id',user).eq('id',id);throw error;}
 }
 async function ownWine(id:string,user:string) {const wine=check(await db.from('user_collection').select('*').eq('id',id).eq('user_id',user).maybeSingle());if(!wine)throw new Fault(404,'Wine not found in your library.');return wine;}
 return async function action(user:string,body:any):Promise<any> {
  if(body.action==='status')return ready();
  const closing=check(await db.from('wl_account_deletions').select('user_id').eq('user_id',user).maybeSingle());
  if(closing)throw new Fault(403,'This account is closing.');
  if(body.action==='attach_bottle') {
   const wine=await ownWine(uuid(body.collection_id),user),expected=body.expected;
   if(!expected||['wine_name','producer','vintage'].some(key=>String(wine[key]??'')!==String(expected[key]??'')))throw new Fault(409,'This wine changed. Review its bottle again.');
   if(body.only_if_missing&&wine.metadata?.image_path)return {item:await decorate(wine,user)};
   const match=/^data:image\/png;base64,([A-Za-z0-9+/]+=*)$/.exec(text(body.photo,3000000,true));
   if(!match)throw new Fault(400,'Choose a transparent PNG under 2 MB.');
   const bytes=Uint8Array.from(atob(match[1]),c=>c.charCodeAt(0));
   if(bytes.length>2097152||bytes.length<24||![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))throw new Fault(400,'Invalid PNG photograph.');
   const view=new DataView(bytes.buffer),width=view.getUint32(16),height=view.getUint32(20);
   if(width<20||height<20||width*height>4000000)throw new Fault(400,'Photo dimensions are not supported.');
   const digest=await hash(body.photo),path=`${user}/${wine.id}/cutout-${digest}.png`;
   const uploaded=await db.storage.from('winelens-bottles').upload(path,bytes,{contentType:'image/png',upsert:false});
   if(uploaded.error&&String(uploaded.error.statusCode)!=='409')check(uploaded);
   // Only public provenance fields; no arbitrary client metadata or paths.
   const provenance=body.provenance??{},safe:Record<string,string>={};
   for(const key of ['pipeline','source_sha256','segmentation','scale_basis','vintage_binding','catalog_id','asset_id','source_page','source_image','verified_at','identity_check','source_dimensions'])if(typeof provenance[key]==='string')safe[key]=text(provenance[key],key.startsWith('source_')?1500:200);
   const metadata={...wine.metadata,image_path:path,image_source:'photograph',bottle_provenance:safe};
   const saved=check(await db.from('user_collection').update({metadata}).eq('user_id',user).eq('id',wine.id).filter('metadata',wine.metadata==null?'is':'eq',wine.metadata==null?'null':JSON.stringify(wine.metadata)).select().maybeSingle());
   if(!saved)throw new Fault(409,'This wine changed while preparing its image. Refresh and review again.');
   return {item:await decorate(saved,user)};
  }
  if(body.action==='drafts')return {drafts:check(await db.from('wl_wine_research').select('*').eq('user_id',user).is('confirmed_at',null).order('created_at',{ascending:false}).limit(5))};
  if(body.action==='confirm') {
   if(body.confirmed!==true)throw new Fault(400,'Confirm the wine details before saving.');
   const draftId=uuid(body.draft_id),reviewed=review(body.review);
   const draft=check(await db.from('wl_wine_research').select('*').eq('id',draftId).eq('user_id',user).maybeSingle());
   if(!draft)throw new Fault(404,'Research draft not found.');
   if(!draft.confirmed_at && ['wine_name','producer','vintage','vintage_state'].some(key=>String((reviewed as any)[key]??'').trim().toLowerCase()!==String(draft.result[key]??'').trim().toLowerCase()))throw new Fault(422,'The wine identity changed. Research the corrected wine before saving its notes.');
   let row=check(await db.rpc('wl_research_confirm',{p_user:user,p_id:draftId,p_review:reviewed}));
   if(reviewed.color==='Sake'){const metadata={...row.metadata,sake_classification:reviewed.sake_classification,sake_style:reviewed.sake_style,rice_variety:reviewed.rice_variety};row=check(await db.from('user_collection').update({metadata}).eq('id',row.id).eq('user_id',user).select().single());}
   // The label used for identification is evidence, not a transparent bottle sprite.
   if(draft.image_path&&row.metadata?.image_path===draft.image_path&&!row.metadata?.bottle_provenance){
    const metadata={...row.metadata,label_reference_path:draft.image_path,image_path:null,image_source:null};
    const updated=check(await db.from('user_collection').update({metadata}).eq('user_id',user).eq('id',row.id).filter('metadata',row.metadata==null?'is':'eq',row.metadata==null?'null':JSON.stringify(row.metadata)).select().maybeSingle());
    row=updated||await ownWine(row.id,user);
   }
   return {item:await decorate(row,user)};
  }
  if(body.action==='research') {
   if(!ready().research)throw new Fault(503,'Wine research is not connected yet.');
   const query=text(body.query??'',400), image=photo(body.photo),id=uuid(body.request_id);
   if(!query&&!image)throw new Fault(400,'Enter a wine name or add a label photo.');
   return job(user,id,'research',{query,photo:body.photo??null},async()=>{
    const label=image?await structured('identify',query||'Read this wine label.',image.data):null;
    const research=await gemini('research',JSON.stringify({query,label}));
    if(!research.sources.length)throw new Fault(422,'No web sources were returned. Refine the wine name before saving.');
    const candidate=await structured('structure',JSON.stringify({query,label,report:research.answer}));
    const imagePath=image?`${user}/${id}/reference.jpg`:null;
    if(image)check(await db.storage.from('winelens-bottles').upload(imagePath,image.bytes,{contentType:'image/jpeg',upsert:false}));
    const draft={id,user_id:user,query,result:candidate,report:research.answer,evidence:{sources:research.sources,supports:research.supports,citations:('citations' in research?research.citations:[])},search_html:research.search_html,image_path:imagePath};
    try{check(await db.from('wl_wine_research').insert(draft));}catch(error){if(imagePath)await db.storage.from('winelens-bottles').remove([imagePath]);throw error;}
    return {draft};
   });
  }
  if(body.action==='ask') {
   if(!ready().research)throw new Fault(503,'Wine research is not connected yet.');
   const question=text(body.question,1200,true),id=uuid(body.request_id);
   return job(user,id,'ask',{question,library:body.use_library===true},async()=>{
    const wines=body.use_library===true?check(await db.from('user_collection').select('id,wine_name,producer,vintage,region').eq('user_id',user).order('created_at',{ascending:false}).limit(50)):[];
    const answer=await gemini('ask',JSON.stringify({question,library:wines,library_scope:'Up to 50 most recently saved wines; not a stock guarantee.'}));
    return {...answer,library_count:wines.length};
   });
  }
  if(body.action==='audio'||body.action==='audio_status') {
   const wine=await ownWine(uuid(body.collection_id),user),script=narration(wine),voice=env('ELEVENLABS_VOICE_ID')||'',audioModel=env('ELEVENLABS_MODEL')||'eleven_multilingual_v2';
   const fingerprint=await hash(JSON.stringify({script,voice,audioModel}));
   const existing=check(await db.from('wl_wine_audio').select('*').eq('collection_id',wine.id).eq('user_id',user).eq('fingerprint',fingerprint).maybeSingle());
   const links=async(row:any)=>({script:row.script,url:await signed('winelens-audio',row.path,user),download_url:await signed('winelens-audio',row.path,user,true)});
   if(existing)return links(existing);
   if(body.action==='audio_status')return {available:false,configured:ready().audio};
   if(!ready().audio)throw new Fault(503,'ElevenLabs audio is not connected yet.');
   const result=await job(user,uuid(body.request_id),'audio',{collection_id:wine.id,fingerprint},async()=>{
    const response=await fetcher(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`,{method:'POST',headers:{'xi-api-key':env('ELEVENLABS_API_KEY')!,'Content-Type':'application/json'},body:JSON.stringify({text:script,model_id:audioModel}),signal:AbortSignal.timeout(35000)});
    if(!response.ok||!response.headers.get('content-type')?.includes('audio/'))throw new Fault(502,'ElevenLabs could not create the audio. Try again.');
    const buffer=await response.arrayBuffer();if(!buffer.byteLength||buffer.byteLength>8388608)throw new Fault(502,'The audio file was incomplete or too large.');
    const path=`${user}/${wine.id}/${fingerprint}.mp3`;
    // Same reviewed text and voice reuse a single immutable object.
    const upload=await db.storage.from('winelens-audio').upload(path,buffer,{contentType:'audio/mpeg',upsert:false});
    if(upload.error && String(upload.error.statusCode)!=='409')check(upload);
    check(await db.from('wl_wine_audio').upsert({collection_id:wine.id,user_id:user,fingerprint,path,script},{onConflict:'collection_id,fingerprint'}));
    return {path,script};
   });
   return links(result);
  }
  throw new Fault(400,'Unknown action.');
 };
}
