import { Fault, text } from '../winelens-research/domain.ts';
import { bottleSearchPrompt, bottleVerificationPrompt } from '../../../prompts/bottle-discovery.ts';
type Resolver=(host:string)=>Promise<string[]>;
export function publicAddress(ip:string){
 if(ip.includes(':'))return /^[23][0-9a-f]{0,3}:/i.test(ip)&&!/^2001:(?:db8|0):/i.test(ip);
 const p=ip.split('.').map(Number);return p.length===4&&p.every(n=>Number.isInteger(n)&&n>=0&&n<=255)&&!(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&(p[1]===168||p[1]===0||p[1]===2)||p[0]===100&&p[1]>=64&&p[1]<=127||p[0]===198&&(p[1]===18||p[1]===19||p[1]===51)||p[0]===203&&p[1]===0&&p[2]===113);
}
export async function publicUrl(raw:string,resolve:Resolver){
 const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||u.hostname.length>253||!u.hostname.includes('.')||/^\[|^[\d.]+$/.test(u.hostname)||/\.(local|localhost|internal|test|invalid)$/i.test(u.hostname))throw Error('Unsupported source');
 const ips=await resolve(u.hostname);if(!ips.length||ips.some(ip=>!publicAddress(ip)))throw Error('Unsupported source');return u;
}
/** Limit decoded bytes, check every redirect, and never forward API keys to source sites. */
export async function sourceFetch(raw:string,fetcher:typeof fetch,resolve:Resolver,limit:number,types:string[]){
 let url=raw;
 for(let i=0;i<4;i++){
  const u=await publicUrl(url,resolve),response=await fetcher(u,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{Accept:types.join(', '),'User-Agent':'sommNI bottle reference lookup/1.0'}});
  if([301,302,303,307,308].includes(response.status)){await response.body?.cancel();url=new URL(response.headers.get('location')||'',u).href;continue;}
  const type=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
  if(!response.ok||!types.includes(type)||Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw Error('Source unavailable');}
  const reader=response.body?.getReader();if(!reader)throw Error('Empty source');const chunks:Uint8Array[]=[];let length=0;
  for(;;){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>limit){await reader.cancel();throw Error('Source too large');}chunks.push(r.value);}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return {bytes,type,url:u.href};
 }throw Error('Too many redirects');
}
const entities=(s:string)=>s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));
export function productImages(html:string,base:string){
 const candidates:string[]=[];
 for(const tag of html.match(/<meta\b[^>]*>/gi)||[]){const attrs:Record<string,string>={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g))attrs[m[1].toLowerCase()]=entities(m[3]);if(/^(og:image(?::url|:secure_url)?|twitter:image(?::src)?)$/.test(attrs.property||attrs.name||'')&&attrs.content)candidates.push(attrs.content);}
 const visit=(node:any)=>{if(!node||typeof node!=='object')return;if(node['@type']==='Product'||Array.isArray(node['@type'])&&node['@type'].includes('Product'))for(const img of [node.image].flat()){const url=typeof img==='string'?img:img?.url||img?.contentUrl;if(url)candidates.unshift(url);}for(const value of Object.values(node))if(typeof value==='object')for(const child of [value].flat())visit(child);};
 for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{visit(JSON.parse(m[1]));}catch{}
 // Product galleries often carry the full-resolution bottle only in img/srcset.
 for(const tag of html.match(/<img\b[^>]*>/gi)||[]){
  const attrs:Record<string,string>={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g))attrs[m[1].toLowerCase()]=entities(m[3]);
  if(/logo|icon|avatar|payment|badge/i.test((attrs.alt||'')+' '+(attrs.class||'')))continue;
  for(const key of ['data-src','src'])if(attrs[key])candidates.push(attrs[key]);
  for(const item of (attrs.srcset||attrs['data-srcset']||'').split(',').reverse()){const url=item.trim().split(/\s+/)[0];if(url)candidates.push(url);}
 }
 return [...new Set(candidates.map(s=>{try{return new URL(s,base).href}catch{return ''}}).filter(Boolean))].slice(0,8);
}
/** Dimensions without decoding a potentially huge image or trusting its extension. */
export function imageDimensions(b:Uint8Array):{width:number;height:number}|null{
 const v=new DataView(b.buffer,b.byteOffset,b.byteLength),str=(a:number,z:number)=>new TextDecoder().decode(b.subarray(a,z));
 if(b.length>=24&&b[0]===137&&str(1,4)==='PNG')return {width:v.getUint32(16),height:v.getUint32(20)};
 if(b.length>=30&&str(0,4)==='RIFF'&&str(8,12)==='WEBP'){
  const kind=str(12,16);
  if(kind==='VP8 ')return {width:v.getUint16(26,true)&16383,height:v.getUint16(28,true)&16383};
  if(kind==='VP8L'){const bits=v.getUint32(21,true);return {width:(bits&16383)+1,height:((bits>>>14)&16383)+1};}
  if(kind==='VP8X')return {width:1+b[24]+(b[25]<<8)+(b[26]<<16),height:1+b[27]+(b[28]<<8)+(b[29]<<16)};
 }
 if(b[0]===255&&b[1]===216){let p=2;while(p+8<b.length){if(b[p++]!==255)break;while(b[p]===255)p++;const marker=b[p++],length=v.getUint16(p);if(length<2||p+length>b.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return {height:v.getUint16(p+3),width:v.getUint16(p+5)};p+=length;}}
 return null;
}
const base64=(bytes:Uint8Array)=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
export function createBottleDiscovery(env:(key:string)=>string|undefined,fetcher:typeof fetch,resolve:Resolver){
 async function ai(instructions:string,image?:string){
  const key=env('OPENAI_API_KEY');if(!key)throw new Fault(503,'Automatic bottle search is not configured. Add a full-bottle photo instead.');
  const model=env('SOMMNI_BOTTLE_MODEL')||env('SOMMNI_RESEARCH_MODEL')||env('SOMMNI_TEXT_MODEL')||'gpt-4.1-mini';
  const response=await fetcher('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(60000),body:JSON.stringify({model,...(model.startsWith('gpt-6')?{reasoning:{effort:'low'}}:{}),store:false,instructions,input:[{role:'user',content:[{type:'input_text',text:image?'Check this photograph and return JSON.':instructions},...(image?[{type:'input_image',image_url:image,detail:'high'}]:[])]}],max_output_tokens:1200,...(image?{text:{format:{type:'json_object'}}}:{tools:[{type:'web_search'}],tool_choice:'required',include:['web_search_call.action.sources']})})});
  if(!response.ok){const e=await response.json().catch(()=>({}));console.error('Bottle provider error',JSON.stringify({model,status:response.status,code:e.error?.code,message:String(e.error?.message||'').replace(/sk-[\w-]+/g,'[redacted]').slice(0,400)}));throw new Fault(502,'Bottle search could not finish. Your wine is saved; retry its artwork later.');}const result=await response.json();if(result.status!=='completed')throw new Fault(502,'Bottle search was incomplete.');const parts=(result.output||[]).filter((o:any)=>o.type==='message').flatMap((o:any)=>o.content||[]).filter((p:any)=>p.type==='output_text');
  if(!image){const sources=(result.output||[]).filter((o:any)=>o.type==='web_search_call').flatMap((o:any)=>o.action?.sources||[]).filter((s:any)=>typeof s.url==='string');parts.push({type:'output_text',text:'',annotations:sources.map((s:any)=>({type:'url_citation',url:s.url}))});}
  return parts;
 }
 return async(body:any)=>{
  const identity={wine_name:text(body.wine_name,200,true),producer:text(body.producer??'',160),vintage:body.vintage==null?null:text(String(body.vintage),8)};
  const found=await ai(bottleSearchPrompt(identity));
  const pages=[...new Set<string>(found.flatMap((p:any)=>(p.annotations||[]).filter((a:any)=>a.type==='url_citation').map((a:any)=>a.url)))].slice(0,6);
  // Resolve product pages in parallel; a blocked merchant must not stop the search.
  const sources=await Promise.allSettled(pages.map(async page=>{
   const source=await sourceFetch(page,fetcher,resolve,1500000,['text/html','application/xhtml+xml']);
   return productImages(new TextDecoder().decode(source.bytes),source.url).map(url=>({url,page:source.url}));
  }));
  const groups=sources.flatMap(r=>r.status==='fulfilled'?[r.value]:[]),seen=new Set<string>();
  const images:{url:string;page:string}[]=[];
  // Round-robin across merchants before trying their alternate galleries.
  for(let i=0;i<8;i++)for(const group of groups){const row=group[i];if(row&&!seen.has(row.url)){seen.add(row.url);images.push(row);}}
  const accepted:{photo:string;provenance:Record<string,string>;height:number;digest:string;exact:boolean}[]=[],digests=new Set<string>();
  let checked=0;
  for(let offset=0;offset<Math.min(images.length,12)&&accepted.length<3;offset+=3){
   const batch=await Promise.allSettled(images.slice(offset,offset+3).map(async source=>{
    const image=await sourceFetch(source.url,fetcher,resolve,2097152,['image/png','image/jpeg','image/webp']);
    const dimensions=imageDimensions(image.bytes);if(!dimensions||dimensions.height<240||dimensions.width<50||dimensions.width*dimensions.height>16000000)return null;
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(image.bytes)))].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(digests.has(digest))return null;digests.add(digest);checked++;
    const photo=`data:${image.type};base64,${base64(image.bytes)}`;
    const parts=await ai(bottleVerificationPrompt(identity,source.page),photo);const verdict=JSON.parse(parts.map((p:any)=>p.text).join(''));
    if(verdict.match!==true||verdict.full_bottle!==true||verdict.producer_match!==true||verdict.cuvee_match!==true||verdict.bottle_only!==true)return null;
    const year=typeof verdict.visible_vintage==='string'&&/^\d{4}$/.test(verdict.visible_vintage)?verdict.visible_vintage:null;
    return {photo,height:dimensions.height,digest,exact:!!year&&year===identity.vintage,provenance:{pipeline:'web-product-photo-vision-v2',source_dimensions:`${dimensions.width}x${dimensions.height}`,source_page:source.page,source_image:image.url,verified_at:new Date().toISOString(),identity_check:String(verdict.reason||'Producer and cuvée visually matched').slice(0,200),vintage_binding:year&&year===identity.vintage?`label vintage ${year} visually matched`:`representative photograph; ${year?'label shows '+year:'exact vintage unverified'}`}};
   }));
   for(const item of batch)if(item.status==='fulfilled'&&item.value)accepted.push(item.value);
  }
  if(!accepted.length){console.info('Bottle discovery exhausted',JSON.stringify({pages:pages.length,checked}));throw new Fault(422,'No confidently matching full-bottle photograph found. Try a more specific producer and cuvée, or upload a full-bottle photo.');}
  const candidates=accepted.sort((a,b)=>Number(b.exact)-Number(a.exact)||b.height-a.height).slice(0,3).map(({photo,provenance,digest})=>({id:digest,photo,provenance}));
  return {...candidates[0],candidates,search_provider:'OpenAI web search',checked};
 };
}
