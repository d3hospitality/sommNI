import {createBetaService} from '../supabase/functions/winelens-beta/service.ts';
import {Fault} from '../supabase/functions/winelens-research/domain.ts';
function assert(value:unknown,message='assertion failed'):asserts value{if(!value)throw new Error(message)}
Deno.test('guest actions require no account; missing providers are honest',async()=>{
 let charged=0;const action=createBetaService({env:()=>undefined,fetch:()=>{throw Error('Unexpected provider call')},reserve:async()=>{charged++;return true}});
 const status=await action({action:'status'});assert(status.free&&!status.account_required&&!status.research);
 for(const actionName of ['research','ask','audio','studio']){try{await action({action:actionName});throw Error('Should reject')}catch(e){assert(e instanceof Fault&&e.status===503);assert(!e.message.includes('Sign in'));}}
 assert(charged===0);
});
Deno.test('guest research and answer are stateless and bounded; audio inline',async()=>{
 const charges:number[]=[];let calls=0;
 const wine={wine_name:'Test wine',producer:'Estate',vintage:null,vintage_state:'unknown',region:'Region',country:'France',grape:'Cabernet',color:'Red',tasting_notes:'Cassis.',uncertainty:'Check label.'};
 const action=createBetaService({env:()=> 'test',reserve:async(n)=>{charges.push(n);return true},fetch:async(url,init)=>{
  calls++;if(String(url).includes('elevenlabs'))return new Response(new Uint8Array([73,68,51]),{headers:{'Content-Type':'audio/mpeg'}});
  const body=JSON.parse(String(init?.body));const structured=body.generationConfig.responseMimeType==='application/json';
  return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:structured?JSON.stringify(wine):'Producer reference: cassis.'}]},groundingMetadata:{groundingChunks:[{web:{uri:'https://producer.example/wine',title:'Producer'}}]}}]});
 }});
 const research=await action({action:'research',query:'Test wine'});assert(research.draft.result.wine_name==='Test wine');assert(!('user_id' in research.draft));
 const answer=await action({action:'ask',question:'Pairing?',library:[{wine_name:'My wine',vintage:2020}]});assert(answer.library_count===1);
 const audio=await action({action:'audio',wine:{...wine,metadata:{tasting_notes:'Cassis.'}}});assert(audio.url==='data:audio/mpeg;base64,SUQz');assert(charges.join(',')==='3,1,2');assert(calls===4);
});
Deno.test('denied quota prevents provider traffic; unsupported actions cannot access private collections',async()=>{
 const action=createBetaService({env:()=> 'test',reserve:async()=>false,fetch:()=>{throw Error('Unexpected network')}});
 try{await action({action:'research',query:'Wine'});throw Error('Should reject')}catch(e){assert(e instanceof Fault&&e.status===429)}
 for(const name of ['confirm','drafts','collection','billing']){try{await action({action:name});throw Error('Should reject')}catch(e){assert(e instanceof Fault&&e.status===400)}}
});
