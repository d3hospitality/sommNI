import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';
import { Fault, text } from '../winelens-research/domain.ts';
const hash=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
function png(value:unknown,sprite=false){
 if(typeof value!=='string'||value.length>(sprite?180000:2800000))throw new Fault(400,'Bottle artwork is too large.');
 const match=/^data:image\/png;base64,([A-Za-z0-9+/]+=*)$/.exec(value);if(!match)throw new Fault(400,'Bottle artwork must be a PNG.');
 let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(match[1]),c=>c.charCodeAt(0))}catch{throw new Fault(400,'Invalid bottle PNG.')}
 if(bytes.length<33||![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))throw new Fault(400,'Invalid bottle PNG.');
 const view=new DataView(bytes.buffer),w=view.getUint32(16),h=view.getUint32(20);
 if(sprite?(w!==100||h!==240):(w<20||h<20||w>1024||h>1024))throw new Fault(400,'Bottle artwork dimensions are not supported.');
 return bytes;
}
export async function validateCommunityArtwork(input:any){
 if(input==null)return null;
 if(!['photograph','generated'].includes(input.source))throw new Fault(400,'Choose the artwork source.');
 const photo=png(input.photo),sprite=png(input.sprite,true);
 try{await Image.decode(photo);const image=await Image.decode(sprite);for(let i=0;i<image.bitmap.length;i+=4){const p=image.bitmap;if(p[i]!==p[i+1]||p[i]!==p[i+2]||p[i]%17!==0)throw Error('Invalid gray sprite')}}catch{throw new Fault(400,'The bottle or G2 sprite could not be read.');}
 const provenance:Record<string,string>={};for(const key of ['pipeline','segmentation','source_sha256','scale_basis','vintage_binding','catalog_id','asset_id','source_page','source_image','verified_at','identity_check','source_dimensions','renderer'])if(typeof input.provenance?.[key]==='string')provenance[key]=text(input.provenance[key],key.startsWith('source_')?1500:200);
 return {photo,sprite,source:input.source,provenance,asset_hash:await hash(input.photo+'|'+input.sprite)};
}
export async function saveCommunityArtwork(db:any,wineId:string,art:Awaited<ReturnType<typeof validateCommunityArtwork>>){
 if(!art)return null;
 const photo_path=`${wineId}/${art.asset_hash}/bottle.png`,sprite_path=`${wineId}/${art.asset_hash}/g2.png`;
 for(const [path,bytes] of [[photo_path,art.photo],[sprite_path,art.sprite]] as const){const upload=await db.storage.from('sommni-master-bottles').upload(path,bytes,{contentType:'image/png',upsert:false});if(upload.error&&String(upload.error.statusCode)!=='409')throw new Fault(503,'Bottle artwork is waiting to upload. Retry with the same receipt.');}
 const saved=await db.from('wl_community_artwork').upsert({wine_id:wineId,asset_hash:art.asset_hash,photo_path,sprite_path,source:art.source,provenance:art.provenance},{onConflict:'wine_id,asset_hash',ignoreDuplicates:true});
 if(saved.error)throw new Fault(503,'Bottle artwork could not be linked to the review queue. Please retry.');return art.asset_hash;
}
