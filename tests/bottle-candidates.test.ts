import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createBottleDiscovery,productImages,sourceFetch,publicUrl} from '../supabase/functions/winelens-beta/bottle-discovery.ts';
const png=await readFile('.qa-bottle/cutout.png'),resolve=async()=>['93.184.216.34'];
let verifies=0,searches=0;
const provider=async(url:any,options:any)=>{
 const u=String(url);
 if(u==='https://api.openai.com/v1/responses'){
  const body=JSON.parse(options.body),image=body.input[0].content.find((p:any)=>p.type==='input_image');
  if(!image){searches++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'sources',annotations:['blocked','wine1','wine2','wine5','wine3','wine4'].map(p=>({type:'url_citation',url:'https://example.com/'+p}))}]}]})}
  verifies++;const marker=Buffer.from(image.image_url.split(',')[1],'base64').at(-1);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({match:marker!==1,full_bottle:true,bottle_only:marker!==5,producer_match:true,cuvee_match:marker!==1,visible_vintage:marker===3?'2021':'2020',reason:'Producer and cuvée checked'})}]}]});
 }
 assert.equal(options.headers.Authorization,undefined);
 if(u.endsWith('blocked'))return new Response('blocked',{status:403});
 if(u.includes('/wine')){const n=u.at(-1);return new Response(`<script type="application/ld+json">{"@type":"Product","image":"/photo${n}.png"}</script><img src="/photo${n}.png">`,{headers:{'content-type':'text/html'}})}
 return new Response(Buffer.concat([png,Buffer.from([Number(/photo(\d)/.exec(u)![1])])]),{headers:{'content-type':'image/png'}});
};
const result=await createBottleDiscovery(k=>k==='OPENAI_API_KEY'?'fixture':undefined,provider as any,resolve)({wine_name:'Estate Cabernet',producer:'Estate',vintage:2021});
assert.equal(searches,1);assert.equal(verifies,5);assert.equal(result.candidates.length,3);assert.match(result.provenance.source_image,/photo3/);assert.match(result.provenance.vintage_binding,/visually matched/);assert.ok(result.candidates.every(c=>!c.provenance.source_image.includes('photo1')));assert.equal(new Set(result.candidates.map(c=>c.id)).size,3);
assert.deepEqual(productImages('<img src="/logo.png" alt="logo"><img src="/bottle.jpg" srcset="/bottle-big.jpg 1200w">','https://example.com'),['https://example.com/bottle.jpg','https://example.com/bottle-big.jpg']);
await assert.rejects(()=>publicUrl('https://example.com',async()=>['127.0.0.1']));
let redirects=0;await assert.rejects(()=>sourceFetch('https://example.com',async()=>{redirects++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1'}})},resolve,100,['text/html']));assert.equal(redirects,1);
console.log('PASS: three verified choices, exact vintage ranked first, wrong cuvée rejected, blocked source skipped, provenance, deduplication, galleries, private-host/redirect guards.');
