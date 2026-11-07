import {decodePhoto} from './photo-input';
import * as ort from 'onnxruntime-web/wasm';
type Assets={model:{url:string;sha:string};wasm:{url:string;sha:string}};
let ready:Promise<ort.InferenceSession>|undefined;
async function verified(asset:{url:string;sha:string}){
 // Cache the public, immutable model by digest, independently of expiring signed URLs.
 const cache=(typeof caches==='undefined'?null:await caches.open('sommni-bottle-model-v1').catch(()=>null)),key=new URL(`./__bottle-model/${asset.sha}`,location.href).href;
 const cached=await cache?.match(key);let bytes:Uint8Array;
 if(cached)bytes=new Uint8Array(await cached.arrayBuffer());else{
  const response=await fetch(asset.url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw new Error('Bottle model could not be loaded. Please retry.');
  bytes=new Uint8Array(await response.arrayBuffer());
 }
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(n=>n.toString(16).padStart(2,'0')).join('');
 if(hash!==asset.sha){await cache?.delete(key);throw new Error('Bottle model verification failed. Please retry.');}
 if(!cached)await cache?.put(key,new Response(new Uint8Array(bytes),{headers:{'Content-Type':'application/octet-stream'}})).catch(()=>{});
 return bytes;
}
function model(assets:Assets){
 if(!ready)ready=(async()=>{
  ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;
  const wasm=await verified(assets.wasm),url=URL.createObjectURL(new Blob([new Uint8Array(wasm)],{type:'application/wasm'}));
  ort.env.wasm.wasmPaths={'ort-wasm-simd.wasm':url};
  try{return await ort.InferenceSession.create(await verified(assets.model),{executionProviders:['wasm'],enableCpuMemArena:false,enableMemPattern:false})}finally{URL.revokeObjectURL(url)}
 })().catch(error=>{ready=undefined;throw error});
 return ready;
}
/** Predict only an outline. Supabase applies it to the photograph and validates the silhouette. */
export async function bottleMask(photo:string,assets:Assets):Promise<string>{
 const bitmap=await decodePhoto(await (await fetch(photo)).blob()),canvas=document.createElement('canvas');canvas.width=320;canvas.height=320;
 const ctx=canvas.getContext('2d')!;ctx.fillStyle='#fff';ctx.fillRect(0,0,320,320);ctx.drawImage(bitmap.image,0,0,320,320);bitmap.close();
 const rgba=ctx.getImageData(0,0,320,320).data,input=new Float32Array(3*320*320),mean=[.485,.456,.406],std=[.229,.224,.225];let peak=1;
 for(let i=0;i<320*320;i++)for(let c=0;c<3;c++)peak=Math.max(peak,rgba[i*4+c]);
 for(let i=0;i<320*320;i++)for(let c=0;c<3;c++)input[c*320*320+i]=(rgba[i*4+c]/peak-mean[c])/std[c];
 const runner=await model(assets),tensor=new ort.Tensor('float32',input,[1,3,320,320]);let output:Record<string,ort.Tensor>|undefined;
 try{
  output=await runner.run({[runner.inputNames[0]]:tensor},[runner.outputNames[0]]);const values=output[runner.outputNames[0]].data as Float32Array;let low=Infinity,high=-Infinity;
  for(const n of values){low=Math.min(low,n);high=Math.max(high,n)}if(!Number.isFinite(low)||high-low<1e-6)throw new Error('The bottle outline is unclear. Try a cleaner background.');
  const mask=Uint8Array.from(values,n=>Math.round((n-low)/(high-low)*255));let data='';for(let i=0;i<mask.length;i+=8192)data+=String.fromCharCode(...mask.subarray(i,i+8192));return btoa(data);
 }finally{tensor.dispose();if(output)for(const value of Object.values(output))value.dispose()}
}
