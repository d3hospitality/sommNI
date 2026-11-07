import assert from 'node:assert/strict';
import {lensOpacity,lensPixel,maskGrayLens} from '../src/atlas/lens-mask.ts';
assert.equal(lensOpacity(0,100),1);
assert.equal(lensOpacity(90,100),1);
assert.ok(Math.abs(lensOpacity(95,100)-.5)<1e-12);
assert.equal(lensOpacity(100,100),0);
assert.equal(lensOpacity(120,100),0);
for(const [width,height,radius] of [[190,190,85],[244,244,112],[200,252,98],[720,720,348]]){
 const pixels=new Uint8Array(width*height).fill(170),before=pixels.slice();maskGrayLens(pixels,width,height,radius);
 const bins=Array.from({length:5},()=>[0,0]);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const distance=Math.hypot(x+.5-width/2,y+.5-height/2)/radius,value=pixels[y*width+x];
  if(distance<=.9)assert.equal(value,170,'inner 90% keeps original detail');
  if(distance>=1)assert.equal(value,0,'outside the circle is fully off');
  assert.ok(value===0||value===170,'no new grayscale levels introduced');
  if(distance>.9&&distance<1){const b=bins[Math.min(4,Math.floor((distance-.9)*50))];b[0]+=value>0?1:0;b[1]++;}
 }
 const densities=bins.map(([on,total])=>on/total);
 assert.ok(densities[0]>.85&&densities[4]<.15,'outer 10% dissolves gradually');
 for(let i=1;i<5;i++)assert.ok(densities[i]<densities[i-1]);
 maskGrayLens(before,width,height,radius);assert.deepEqual(pixels,before,'static grain is deterministic');
 assert.equal(lensPixel(0,0,width,height,radius),false);
}
console.log('PASS: 90% clear core, circular clipping, gradual dither density, preserved G2 palette, stable grain, square and rectangular panels.');
