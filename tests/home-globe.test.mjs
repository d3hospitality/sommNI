import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';

const fixture={regions:[{id:'tuscany',center:[12,43]},{id:'unmapped',center:[20,30]}],lit:new Set(['tuscany']),centers:[],arcs:[]};
const stubs={
 './atlas/lens-mask':`export const maskCanvasLens=()=>{F.masked=(F.masked||0)+1};`,
 './atlas-app':`export const loadAtlasRenderer=async()=>({data:{},countryAt:()=>true});`,
 './atlas/coverage':`export const loadBoundaries=async()=>({regions:F.regions});export const collectiveCoverage=()=>({regions:F.lit});`,
 './community/atlas-state':`export const collectiveSnapshot=()=>({});`,
 './atlas/dot-atlas':`export const globePoint=(lon,lat,center)=>{F.centers.push(center[0]);return {x:lon,y:lat,depth:1}};`,
};
const bundle=await build({entryPoints:['src/home-globe.ts'],bundle:true,write:false,format:'cjs',platform:'node',plugins:[{name:'globe-fixture',setup(b){b.onResolve({filter:/^\.\//},a=>a.path in stubs?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path]}));}}]});
const window=new EventTarget(),document=new EventTarget(),button=new EventTarget(),reduced=new EventTarget();
reduced.matches=false;document.hidden=false;
const ctx={clearRect(){},beginPath(){},stroke(){},fill(){},fillRect(){},arc(...a){fixture.arcs.push(a)}};
button.querySelector=()=>({getContext:()=>ctx});button.setAttribute=(_,value)=>{button.label=value};document.querySelector=()=>button;
let intersect,sequence=0;const frames=new Map();
const module={exports:{}};
const context={module,exports:module.exports,F:fixture,window,document,Event,matchMedia:()=>reduced,IntersectionObserver:class{constructor(cb){intersect=cb}observe(){}},requestAnimationFrame:cb=>{frames.set(++sequence,cb);return sequence},cancelAnimationFrame:id=>frames.delete(id)};
runInNewContext(bundle.outputFiles[0].text,context);module.exports.initHomeGlobe();
assert.equal(frames.size,0,'hidden icon does no rendering');
intersect([{isIntersecting:true}]);await new Promise(r=>setImmediate(r));
const tick=time=>{const pending=[...frames.values()];frames.clear();for(const cb of pending)cb(time)};
tick(100);assert.equal(fixture.masked,1,'home globe applies its circular feather');assert.match(button.label,/1 wine regions lit/);
assert.equal(fixture.arcs.filter(a=>a[2]===1.7).length,1,'only contributed regions receive pins');
tick(300);assert.ok(fixture.centers.at(-1)>fixture.centers[0],'globe slowly rotates');
document.hidden=true;document.dispatchEvent(new Event('visibilitychange'));assert.equal(frames.size,0);
document.hidden=false;document.dispatchEvent(new Event('visibilitychange'));tick(500);
reduced.matches=true;reduced.dispatchEvent(new Event('change'));tick(700);assert.equal(frames.size,0,'reduced motion draws once');
fixture.lit.add('unmapped');window.dispatchEvent(new Event('sommni-catalog-updated'));tick(900);assert.match(button.label,/2 wine regions lit/);
let opened=false;window.addEventListener('winelens-open-browser-atlas',()=>opened=true);button.dispatchEvent(new Event('click'));assert.ok(opened);
intersect([{isIntersecting:false}]);assert.equal(frames.size,0);
console.log('PASS: mapped region pins, rotation, catalog refresh, visibility pause, reduced motion and Atlas click.');
