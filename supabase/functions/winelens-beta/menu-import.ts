import { Fault } from '../winelens-research/domain.ts';
import { sourceFetch, imageDimensions } from './bottle-discovery.ts';
import { menuImportPrompt } from '../../../prompts/menu-import.ts';

export const MENU_MAX_BYTES=12*1024*1024;
const types=['application/pdf','image/jpeg','image/png','image/webp','application/octet-stream',''];
export function menuType(bytes:Uint8Array){
 const head=new TextDecoder().decode(bytes.subarray(0,12));
 if(head.startsWith('%PDF-'))return 'application/pdf';
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if([137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))return 'image/png';
 if(head.startsWith('RIFF')&&head.slice(8,12)==='WEBP')return 'image/webp';
 throw new Fault(400,'This file is not a readable PDF or menu image.');
}
const clean=(v:unknown,max:number)=>typeof v==='string'?v.replace(/https?:\/\/\S+/gi,'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max):'';
const norm=(v:string)=>v.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export function normalizeMenu(result:any){
 if(!result||!Array.isArray(result.entries)||typeof result.truncated!=='boolean')throw new Fault(502,'The menu reader returned an incomplete list. Please retry.');
 const entries:any[]=[];const seen=new Set<string>();let duplicates=0;
 for(const item of result.entries.slice(0,200)){
  const wine_name=clean(item?.wine_name,160),producer=clean(item?.producer,120),source_text=clean(item?.source_text,350);
  if(!wine_name||!source_text)continue;
  const year=clean(item.vintage,20),printedYear=year==='NV'?/\bN[.\s/-]?V\b/i.test(source_text):(source_text.match(/\b(?:1[89]|20)\d{2}\b/g)||[]).includes(year),vintage=/^(?:1[89]\d{2}|20\d{2}|NV)$/.test(year)&&printedYear?year:'';
  const key=[producer,wine_name,vintage].map(norm).join('|');if(seen.has(key)){duplicates++;continue;}seen.add(key);
  entries.push({wine_name,producer,vintage,query:[producer&&!(' '+norm(wine_name)+' ').includes(' '+norm(producer)+' ')?producer:'',wine_name,vintage&&!(' '+norm(wine_name)+' ').includes(' '+norm(vintage)+' ')?vintage:''].filter(Boolean).join(' '),section:clean(item.section,90),page:Number.isInteger(item.page)&&item.page>0?item.page:null,source_text,needs_review:item.needs_review!==false||!!year&&!vintage,reason:year&&!vintage?'Year not printed clearly in full. Confirm the vintage.':clean(item.reason,200)});
 }
 return {entries,duplicates,truncated:result.truncated||result.entries.length>200,warnings:(Array.isArray(result.warnings)?result.warnings:[]).slice(0,8).map((w:unknown)=>clean(w,300)).filter(Boolean)};
}
const string={type:'string'};
const schema={type:'object',additionalProperties:false,required:['entries','warnings','truncated'],properties:{entries:{type:'array',items:{type:'object',additionalProperties:false,required:['wine_name','producer','vintage','section','page','source_text','needs_review','reason'],properties:{wine_name:string,producer:string,vintage:string,section:string,page:{type:'integer'},source_text:string,needs_review:{type:'boolean'},reason:string}}},warnings:{type:'array',items:string},truncated:{type:'boolean'}}};
function encode(bytes:Uint8Array){let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
export async function importMenu(body:any,deps:{env:(k:string)=>string|undefined;fetch:typeof fetch;resolveHost:(host:string)=>Promise<string[]>}){
 const apiKey=deps.env('OPENAI_API_KEY');if(!apiKey)throw new Fault(503,'Menu reading is not configured yet. You can still enter wine names.');
 if(!!body.url===!!body.document)throw new Fault(400,'Choose one menu link or file.');
 let bytes:Uint8Array,type:string,lowResolution=false;
 if(body.url){
  if(typeof body.url!=='string'||body.url.length>4096)throw new Fault(400,'Enter a direct HTTPS link to a PDF or menu image.');
  try{({bytes,type}=await sourceFetch(body.url,deps.fetch,deps.resolveHost,MENU_MAX_BYTES,types));}
  catch{throw new Fault(422,'Could not read this menu link. Use a direct public PDF/image link, or download the menu and upload it here (up to 12 MB).');}
 }else{
  if(typeof body.document!=='string'||body.document.length>Math.ceil(MENU_MAX_BYTES/3)*4+100)throw new Fault(413,'Choose a menu under 12 MB.');
  const match=/^data:(application\/pdf|image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.document);
  if(!match)throw new Fault(400,'Choose a PDF, JPEG, PNG or WebP menu.');
  type=match[1];try{bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));}catch{throw new Fault(400,'The menu file could not be read. Upload it again.');}
 }
 if(!bytes.length||bytes.length>MENU_MAX_BYTES)throw new Fault(413,'Choose a menu under 12 MB.');
 type=menuType(bytes);
 if(type!=='application/pdf'){
  const size=imageDimensions(bytes);if(!size||size.width*size.height>40_000_000)throw new Fault(400,'Choose a readable menu image under 40 megapixels.');lowResolution=Math.min(size.width,size.height)<800;
 }
 const data=`data:${type};base64,${encode(bytes)}`;
 const input=type==='application/pdf'?{type:'input_file',filename:'menu.pdf',file_data:data}:{type:'input_image',image_url:data,detail:'high'};
 const model=deps.env('SOMMNI_MENU_MODEL')||'gpt-5.4';
 let response:Response;
 try{response=await deps.fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model,...(/^gpt-[56]/.test(model)?{reasoning:{effort:'low'}}:{}),store:false,instructions:menuImportPrompt(),input:[{role:'user',content:[{type:'input_text',text:'Read all pages. Extract the wines for a review checklist, excluding other menu items.'},input]}],max_output_tokens:16000,text:{format:{type:'json_schema',name:'wine_menu',strict:true,schema}}}),signal:AbortSignal.timeout(120000)});}
 catch{throw new Fault(504,'The menu reader timed out. Try a smaller PDF or a photo of just the wine pages.');}
 if(!response.ok)throw new Fault(502,'The menu reader could not finish. Retry with the wine pages only.');
 const result=await response.json();if(result.status!=='completed')throw new Fault(422,'The menu was too long to read completely. Upload the wine pages in smaller groups.');
 const output=(result.output||[]).flatMap((o:any)=>o.type==='message'?o.content||[]:[]).filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('');
 let parsed;try{parsed=JSON.parse(output);}catch{throw new Fault(502,'The menu reader returned an incomplete list. Please retry.');}
 const normalized=normalizeMenu(parsed);
 if(lowResolution){normalized.warnings.unshift('This is a small preview image. Check each label and year, or upload the full-size original for clearer reading.');for(const entry of normalized.entries){entry.needs_review=true;entry.reason=entry.reason||'Small preview image: check the label spelling.';}}
 return {...normalized,format:type==='application/pdf'?'PDF':'Image'};
}
