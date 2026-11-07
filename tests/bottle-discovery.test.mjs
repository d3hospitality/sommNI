import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const png=await readFile('.qa-bottle/cutout.png');
import { publicAddress, publicUrl, sourceFetch, productImages, createBottleDiscovery } from '../supabase/functions/winelens-beta/bottle-discovery.ts';
const resolve=async()=>['93.184.216.34'];
for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1'])assert.equal(publicAddress(ip),false,ip);
assert.equal(publicAddress('8.8.8.8'),true);
for(const url of ['http://example.com/x','https://127.0.0.1/x','https://user:pass@example.com/x','https://example.com:8443/x'])await assert.rejects(()=>publicUrl(url,resolve));
await assert.rejects(()=>publicUrl('https://example.com',async()=>['127.0.0.1']));
let calls=0;await assert.rejects(()=>sourceFetch('https://example.com',async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}})},resolve,100,['text/html']));assert.equal(calls,1);
await assert.rejects(()=>sourceFetch('https://example.com',async()=>new Response('x'.repeat(101),{headers:{'content-type':'text/html'}}),resolve,100,['text/html']));
assert.deepEqual(productImages('<meta content="/bottle.png?a=1&amp;b=2" property="og:image"><script type="application/ld+json">{"@type":"Product","image":"/product.png"}</script>','https://example.com/wine'),['https://example.com/product.png','https://example.com/bottle.png?a=1&b=2']);
let vision=0;
const provider=async(url,options)=>{
 const u=String(url);
 if(u==='https://api.openai.com/v1/responses'){
  const body=JSON.parse(options.body);assert.equal(body.store,false);const hasImage=body.input[0].content.some(p=>p.type==='input_image');
  const text=hasImage?JSON.stringify({match:++vision===2,full_bottle:true,bottle_only:true,producer_match:true,cuvee_match:vision===2,visible_vintage:'2020',reason:'Same producer and cuvée; representative year.'}):'Product pages';
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text,annotations:hasImage?[]:[{type:'url_citation',url:'https://example.com/wine'}]}]}]});
 }
 assert.equal(options.headers.Authorization,undefined);
 if(u.endsWith('/wine'))return new Response('<meta property="og:image" content="/wrong.png"><meta property="twitter:image" content="/right.png">',{headers:{'content-type':'text/html'}});
 return new Response(Buffer.concat([png,Buffer.from([u.includes('right')?2:1])]),{headers:{'content-type':'image/png'}});
};
const discover=createBottleDiscovery(k=>k==='OPENAI_API_KEY'?'fixture':undefined,provider,resolve);
const result=await discover({wine_name:'Estate Cabernet',producer:'Fixture Estate',vintage:2021});assert.equal(vision,2);assert.match(result.provenance.source_image,/right.png/);assert.match(result.provenance.vintage_binding,/representative.*2020/);assert.match(result.photo,/^data:image\/png/);
console.log('PASS: private hosts, redirect checks, byte caps, observed image URLs, mismatched label rejection, representative-vintage disclosure, server-only API key.');
