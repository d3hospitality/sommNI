import {BottleError,cutout,digest,pngDimensions,PIPELINE,MODEL,WASM,type AssetLoader} from './pipeline.ts';
export const decodePhoto=(photo:unknown)=>{
 if(typeof photo!=='string'||photo.length>2800000)throw new BottleError(413,'Choose a photograph under 2 MB.');
 const match=/^data:image\/png;base64,([A-Za-z0-9+/]+=*)$/.exec(photo);if(!match)throw new BottleError(400,'Send a PNG photograph.');
 let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(match[1]),c=>c.charCodeAt(0))}catch{throw new BottleError(400,'Invalid photo data.')}
 if(bytes.length>2097152)throw new BottleError(413,'Choose a photograph under 2 MB.');pngDimensions(bytes);return bytes;
};
const inline=(bytes:Uint8Array)=>{let data='';for(let i=0;i<bytes.length;i+=8192)data+=String.fromCharCode(...bytes.subarray(i,i+8192));return 'data:image/png;base64,'+btoa(data)};
export function createBottleService(db:any,fetcher:typeof fetch=fetch,process:typeof cutout=cutout){
 let processing=false;
 const check=(r:any)=>{if(r.error)throw new BottleError(503,'Bottle storage is temporarily unavailable.');return r.data};
 const load:AssetLoader=async asset=>{
  const bucket=db.storage.from('sommni-bottle-models'),prior=await bucket.download(asset.name);let bytes:Uint8Array;
  if(!prior.error&&prior.data)bytes=new Uint8Array(await prior.data.arrayBuffer());else {
   const response=await fetcher(asset.url,{signal:AbortSignal.timeout(45000)});if(!response.ok)throw new BottleError(503,'Bottle model is temporarily unavailable.');bytes=new Uint8Array(await response.arrayBuffer());
   if(bytes.length>20971520||await digest(bytes)!==asset.sha)throw new BottleError(503,'Bottle model verification failed.');
   const saved=await bucket.upload(asset.name,bytes,{contentType:'application/octet-stream',upsert:false});if(saved.error&&String(saved.error.statusCode)!=='409')check(saved);
  }
  if(await digest(bytes)!==asset.sha)throw new BottleError(503,'Bottle model verification failed.');return bytes;
 };
 const stored=async(row:any)=>{const blob=check(await db.storage.from('sommni-bottle-cutouts').download(row.output_path));const url=inline(new Uint8Array(await blob.arrayBuffer()));return {draft:{url,path:url,source:'photograph',provenance:row.provenance},cached:true};};
 return async(body:any)=>{
  if(body.action==='status')return {available:true,pipeline:PIPELINE,host:'supabase',segmentation:'on-device',daily_new_cutout_limit:20};
  if(body.action==='assets'){
   const assets:Record<string,{url:string;sha:string}>={};
   for(const [key,spec] of Object.entries({model:MODEL,wasm:WASM})){
    await load(spec);const signed=check(await db.storage.from('sommni-bottle-models').createSignedUrl(spec.name,3600));
    assets[key]={url:signed.signedUrl,sha:spec.sha};
   }
   return {assets};
  }
  const bytes=decodePhoto(body.photo),hash=await digest(bytes),key=await digest(new TextEncoder().encode(PIPELINE+':'+hash));
  const prior=check(await db.from('sommni_bottle_cutouts').select('output_path,provenance').eq('cache_key',key).maybeSingle());
  if(prior?.output_path)return stored(prior);
  if(body.action==='lookup')return {cached:false};
  let mask:Uint8Array|undefined;
  if(body.mask!==undefined){if(typeof body.mask!=='string'||body.mask.length>136536)throw new BottleError(400,'Invalid bottle outline.');try{mask=Uint8Array.from(atob(body.mask),c=>c.charCodeAt(0))}catch{throw new BottleError(400,'Invalid bottle outline.')}if(mask.length!==102400)throw new BottleError(400,'Invalid bottle outline.');}
  if(processing)throw new BottleError(409,'Another bottle is being prepared. Try again shortly.');
  processing=true;const lease=crypto.randomUUID();let claimed=false;
  try{
   const state=check(await db.rpc('sommni_claim_bottle',{p_key:key,p_lease:lease}));
   if(state==='cached'){const row=check(await db.from('sommni_bottle_cutouts').select('output_path,provenance').eq('cache_key',key).single());return stored(row)}
   if(state==='limited')throw new BottleError(429,'Today’s bottle-photo capacity has been used. Existing bottle photos still work; try a new photo tomorrow.');
   if(state!=='claimed')throw new BottleError(409,'This bottle is being prepared. Try again shortly.');claimed=true;
   const {png,provenance}=await process(bytes,load,mask),path=key+'.png';
   const uploaded=await db.storage.from('sommni-bottle-cutouts').upload(path,png,{contentType:'image/png',upsert:false});if(uploaded.error&&String(uploaded.error.statusCode)!=='409')check(uploaded);
   const saved=check(await db.from('sommni_bottle_cutouts').update({output_path:path,provenance,lease_id:null,lease_until:null}).eq('cache_key',key).eq('lease_id',lease).select('cache_key'));
   if(!saved?.length)throw new BottleError(409,'Bottle processing expired. Please retry.');
   const url=inline(png);return {draft:{url,path:url,source:'photograph',provenance},cached:false};
  }catch(error){if(claimed)await db.from('sommni_bottle_cutouts').delete().eq('cache_key',key).eq('lease_id',lease);throw error}finally{processing=false}
 };
}
