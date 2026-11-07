import {createBottleService,decodePhoto} from '../supabase/functions/sommni-bottle-cutout/service.ts';
import {silhouette,cutout} from '../supabase/functions/sommni-bottle-cutout/pipeline.ts';
const assert=(ok:unknown,message='assertion')=>{if(!ok)throw new Error(message)};
const rejects=async(fn:()=>unknown,status:number)=>{try{await fn()}catch(e){assert((e as any).status===status);return}throw Error('Expected rejection')};
const photo=await Deno.readFile('.qa-bottle/cutout.png');
const inline=(bytes:Uint8Array)=>'data:image/png;base64,'+btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
Deno.test('bounded photo parsing and silhouettes reject misleading subjects',async()=>{
 await rejects(()=>decodePhoto('data:text/html;base64,AAAA'),400);
 const huge=photo.slice();new DataView(huge.buffer).setUint32(16,100000);await rejects(()=>decodePhoto(inline(huge)),413);
 await rejects(()=>silhouette(new Uint8Array(100*300),100,300),422);
 const mask=new Uint8Array(200*400);for(let y=20;y<380;y++)for(let x=20;x<80;x++)mask[y*200+x]=255;
 const good=silhouette(mask.slice(),200,400);assert(good.left===20&&good.bottom===379);
 for(let y=20;y<380;y++)for(let x=110;x<170;x++)mask[y*200+x]=255;await rejects(()=>silhouette(mask,200,400),422);
});
Deno.test('transparent photographs retain alpha without loading a model',async()=>{
 const result=await cutout(photo,()=>{throw Error('No model needed')});assert(result.provenance.segmentation==='source-alpha');assert(result.png.length>1000);
});
Deno.test('cache reuse, quota refusal and failed claims keep storage private',async()=>{
 let row:any=null,quota=0,processed=0,state='claimed';const objects=new Map();
 const db={from(table:string){assert(table==='sommni_bottle_cutouts');let patch:any,del=false;const query:any={select(){return this},eq(){return this},update(v:any){patch=v;return this},delete(){del=true;return this},async maybeSingle(){return {data:row}},async single(){return {data:row}},then(resolve:any){if(patch)row={...row,...patch};if(del)row=null;resolve({data:[{cache_key:'test'}]})}};return query},async rpc(name:string){assert(name==='sommni_claim_bottle');quota++;return {data:state}},storage:{from(bucket:string){assert(bucket==='sommni-bottle-cutouts');return {async upload(path:string,bytes:Uint8Array,options:any){assert(!options.upsert);objects.set(path,bytes);return {}},async download(path:string){return {data:new Blob([objects.get(path)])}}}}}};
 const action=createBottleService(db,()=>{throw Error('Unexpected fetch')},(async()=>{processed++;return {png:photo,provenance:{pipeline:'test'}}}) as unknown as typeof cutout);
 const first:any=await action({photo:inline(photo)});assert(!first.cached&&quota===1&&processed===1);
 const second:any=await action({photo:inline(photo)});assert(second.cached&&quota===1&&processed===1&&first.draft?.url===second.draft?.url);
 row=null;state='limited';await rejects(()=>action({photo:inline(photo)}),429);assert(processed===1);
 state='busy';await rejects(()=>action({photo:inline(photo)}),409);assert(processed===1);
});
