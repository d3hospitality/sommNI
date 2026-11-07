import assert from 'node:assert/strict';
import {guidePlacement} from '../src/guide-placement.ts';
const rect=(left,top,width,height)=>({left,top,right:left+width,bottom:top+height});
const phone={left:0,top:0,width:390,height:770};
const p=guidePlacement(phone,rect(280,20,90,44),280);
assert.equal(p.left,40,'Centered on phone regardless of target alignment');assert.equal(p.top,86);
const above=guidePlacement(phone,rect(20,690,100,44),280);assert.equal(above.top,388);assert.equal(above.left,40);
const center=guidePlacement(phone,null,280);assert.equal(center.left,40);assert.equal(center.top,245);
assert.deepEqual(guidePlacement(phone,rect(0,-300,100,100),280),center,'Missing/offscreen target uses centered fallback');
const desktop=guidePlacement({left:0,top:0,width:1440,height:800},rect(400,30,500,730),280);assert.equal(desktop.left,922,'Tall atlas uses side space');
const short=guidePlacement({left:0,top:0,width:390,height:320},rect(20,35,100,44),420);assert.equal(short.top,101);assert.equal(short.maxHeight,207,'Long content scrolls outside the target');
for(const width of [320,390,430,844,1440])for(const height of [240,390,740,896])for(const top of [-80,20,height/2,height-70,height+80])for(const natural of [160,280,550]){
 const view={left:17,top:31,width,height};const result=guidePlacement(view,rect(57,top+31,100,50),natural);const shown=Math.min(natural,result.maxHeight);
 assert(result.left>=view.left+12);assert(result.left+result.width<=view.left+width-12+.01);assert(result.top>=view.top+12);assert(result.top+shown<=view.top+height-12+.01);
}
console.log('PASS: centered mobile cards, above/below/side positioning, offscreen fallback, keyboard offsets, long-content scrolling, 300 viewport/content combinations.');
