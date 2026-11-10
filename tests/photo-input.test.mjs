import assert from 'node:assert/strict';
import {build} from 'esbuild';
const png='data:image/png;base64,iVBORw0KGgo=';
const platformFetch=globalThis.fetch;globalThis.fetch=async url=>{if(String(url).startsWith('data:'))throw TypeError('WebView blocked data URL fetch');return platformFetch(url);};
let closes=0,draws=0,fills=0,revoked=0,lastCanvas;
globalThis.FileReader=class{async readAsDataURL(blob){this.result=`data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;this.onload();}};
globalThis.createImageBitmap=async()=>({width:4032,height:3024,close(){closes++}});
globalThis.document={createElement(tag){assert.equal(tag,'canvas');lastCanvas={width:0,height:0,getContext(){return {drawImage(){draws++},fillRect(){fills++}}},toDataURL(type){return type==='image/jpeg'?'data:image/jpeg;base64,/9j/AA==':png}};return lastCanvas;}};
const bundle=await build({entryPoints:['src/research/photo-input.ts'],bundle:true,format:'esm',platform:'node',write:false});
const {photoData,boundedPng,decodePhoto,labelResearchPhoto,labelResearchDetail,labelCrop}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
assert.equal(await photoData(new File([new Uint8Array(5*1024*1024)],'camera.jpg',{type:'image/jpeg'})),png);
assert.equal(lastCanvas.width,1024);assert.equal(lastCanvas.height,768);assert.equal(closes,1);assert.equal(fills,0,'alpha remains clear unless framing requested');
assert.equal(await photoData(new File(['image'],'camera.JPG')),png,'empty picker MIME inferred from extension');
await boundedPng(png,true);assert.equal(fills,1);assert.equal(lastCanvas.width,1024);
await assert.rejects(photoData(new File([new Uint8Array(16*1024*1024)],'large.jpg',{type:'image/jpeg'})),/15 MB/);
await assert.rejects(photoData(new File(['heic'],'image.heic',{type:'image/heic'})),/export a JPEG/);
await assert.rejects(photoData(new File([],'empty.png',{type:'image/png'})),/15 MB/);
const nativeRevoke=URL.revokeObjectURL;URL.revokeObjectURL=url=>{revoked++;nativeRevoke(url)};
globalThis.createImageBitmap=async()=>{throw Error('Unsupported WebView')};
globalThis.Image=class{naturalWidth=1200;naturalHeight=800;set src(v){queueMicrotask(()=>this.onload())}};
assert.equal(await boundedPng(png),png);assert.equal(revoked,1);assert.equal(lastCanvas.width,1024);
globalThis.Image=class{set src(v){queueMicrotask(()=>this.onerror())}};
await assert.rejects(decodePhoto(new Blob(['bad'])),/Export it as JPEG/);assert.equal(revoked,2);
assert(draws>=4);
console.log('PASS: 5 MB camera photo, bounded PNG, alpha preservation, MIME inference, size/type errors, WebView fallback and decode cleanup.');
// Exercise the exact URL-to-PNG boundary used by Winebrary's approval action.
const bottleBundle=await build({entryPoints:['src/research/bottles.ts'],bundle:true,format:'esm',platform:'node',write:false,define:{'import.meta.env':'{}'},plugins:[{name:'catalog-fixture',setup(b){b.onResolve({filter:/^\.\.\/(identity|account-project|bottle-assets)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path.endsWith('identity')?'export const allCatalogWines=()=>[]':a.path.endsWith('account-project')?"export const SOMMNI_PROJECT_URL='https://example.com',SOMMNI_PUBLISHABLE_KEY='public'":"export const bottleImageUrl=()=>''"}));}}]});
const {inlineBottle}=await import('data:text/javascript;base64,'+Buffer.from(bottleBundle.outputFiles[0].text).toString('base64'));
const nativeFetch=globalThis.fetch;globalThis.fetch=async url=>String(url).startsWith('https://example.com/')?new Response(Buffer.from('iVBORw0KGgo=','base64'),{headers:{'Content-Type':'image/png'}}):nativeFetch(url);
const beforeDraws=draws;
assert.equal(await inlineBottle({url:'https://example.com/private-bottle.png'}),png);
assert.equal(await inlineBottle({url:png}),png);assert.equal(draws,beforeDraws,'already processed cutouts retain their pixels');
console.log('PASS: hosted photo URLs become inline PNGs without resampling existing transparent cutouts.');

globalThis.createImageBitmap=async()=>({width:1024,height:768,close(){closes++}});
const researchPhoto=await labelResearchPhoto(png);assert.match(researchPhoto,/^data:image\/jpeg;base64,/);assert.equal(await boundedPng(png),png);
console.log('PASS: recognition uses bounded JPEG with white background; original PNG artwork keeps alpha.');

assert.match(await labelResearchDetail(png),/^data:image\/jpeg;base64,/);assert(lastCanvas.width<=900&&lastCanvas.height<=900);console.log('PASS: separate bounded JPEG label close-up, original photo untouched.');

assert.deepEqual(labelCrop({x:0,y:1,size:.5}),{left:0,top:.625,width:.5,height:.375});
assert.deepEqual(labelCrop({x:NaN,y:.5,size:.5}),labelCrop());
assert.equal(labelCrop({x:2,y:-3,size:5}).width,.95);
await labelResearchDetail(png,{x:.95,y:.1,size:.3});assert(lastCanvas.width<=900&&lastCanvas.height<=900);
console.log('PASS: user-selected label crop clamps at photo edges and rejects invalid coordinates.');

// Native WebViews intercept network fetches, including data URLs: the cutout path must decode locally.
const maskBundle=await build({entryPoints:['src/research/bottle-segmentation.ts'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'inference-fixture',setup(b){b.onResolve({filter:/^onnxruntime-web\/wasm$/},()=>({path:'ort',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export const env={wasm:{}};export class Tensor{dispose(){}};export const InferenceSession={create:async()=>({inputNames:['input'],outputNames:['output'],run:async()=>({output:{data:Float32Array.from({length:102400},(_,i)=>i%320),dispose(){}}})})};`}));}}]});
const {bottleMask}=await import('data:text/javascript;base64,'+Buffer.from(maskBundle.outputFiles[0].text).toString('base64'));
globalThis.location={href:'https://fixture.example/'};
globalThis.document={createElement(){return {width:0,height:0,getContext(){return {fillRect(){},drawImage(){},getImageData(){return {data:new Uint8ClampedArray(320*320*4).fill(200)}}}}}}};
const bytes=new Uint8Array([1,2,3]);const sha=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');const assets={model:{url:'https://fixture.example/model',sha},wasm:{url:'https://fixture.example/wasm',sha}};const fetched=[];
globalThis.fetch=async url=>{fetched.push(url);assert(!String(url).startsWith('data:'),'local photographs must not use network fetch');return new Response(bytes)};
assert.equal(Buffer.from(await bottleMask(png,assets),'base64').length,102400);assert.deepEqual(fetched,[assets.wasm.url,assets.model.url]);
console.log('PASS: native cutout decodes the in-memory photo locally; only verified model assets use fetch.');
