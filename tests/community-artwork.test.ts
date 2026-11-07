import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';
import { validateCommunityArtwork,saveCommunityArtwork } from '../supabase/functions/winelens-beta/community-artwork.ts';
import { Fault } from '../supabase/functions/winelens-research/domain.ts';
const assert=(v:unknown)=>{if(!v)throw Error('assertion')};
const inline=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return 'data:image/png;base64,'+btoa(s)};
const rejects=async(fn:()=>unknown)=>{try{await fn()}catch(e){assert(e instanceof Fault&&e.status===400);return}throw Error('Expected invalid artwork')};
const photo=inline(await Deno.readFile('.qa-bottle/cutout.png'));
const sprite=new Image(100,240);sprite.fill(0x111111ff);const png=inline(await sprite.encode());
Deno.test('master artwork validates PNGs and G2 gray levels before uploads',async()=>{
 const art=await validateCommunityArtwork({photo,sprite:png,source:'photograph',provenance:{pipeline:'photographic-v2',personal_note:'never include'}});assert(art?.photo.length);assert(!('personal_note' in art!.provenance));
 await rejects(()=>validateCommunityArtwork({photo:'https://evil.example/photo.png',sprite:png,source:'photograph'}));
 await rejects(()=>validateCommunityArtwork({photo,sprite:photo,source:'photograph'}));
 sprite.fill(0xff0000ff);await rejects(async()=>validateCommunityArtwork({photo,sprite:inline(await sprite.encode()),source:'photograph'}));
 const bad=new Uint8Array(await Deno.readFile('.qa-bottle/cutout.png'));new DataView(bad.buffer).setUint32(16,999999);await rejects(()=>validateCommunityArtwork({photo:inline(bad),sprite:png,source:'photograph'}));
});
Deno.test('private immutable assets deduplicate and never write published wines',async()=>{
 const art=await validateCommunityArtwork({photo,sprite:png,source:'photograph'}),objects=new Map(),rows=new Map();
 const db={storage:{from(bucket:string){assert(bucket==='sommni-master-bottles');return {async upload(path:string,bytes:Uint8Array,options:any){assert(options.upsert===false);if(objects.has(path))return {error:{statusCode:'409'}};objects.set(path,bytes);return {}}}}},from(table:string){assert(table==='wl_community_artwork');return {async upsert(row:any,options:any){assert(options.ignoreDuplicates===true);if(!rows.has(row.asset_hash))rows.set(row.asset_hash,row);return {}}}}};
 await saveCommunityArtwork(db,'wine-id',art);await saveCommunityArtwork(db,'wine-id',art);assert(objects.size===2&&rows.size===1);
});
