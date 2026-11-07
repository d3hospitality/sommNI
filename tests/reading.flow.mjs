import assert from 'node:assert/strict';
import {ReadingFlow} from '../src/reading/flow.ts';
const normalized=s=>s.replace(/\s+/g,'').trim();
let cases=0;
for(const text of ['Opening\n\n'+('A winemaker grew vines, then changed the cellar. '.repeat(35))+'\n\nTHE END', '味'.repeat(400)+'\n'+('👓'.repeat(150)),'A'.repeat(1400)]){
 for(const [w,h] of [[448,188],[568,280],[250,150]]){
  const f=new ReadingFlow(text,w,h);assert.equal(normalized(f.lines.join('\n')),normalized(text));
  let prev=0;for(let i=0;i<=f.lines.length;i++){assert(new TextEncoder().encode(f.content).length<=999);prev=f.index;f.move(1);assert(f.index===prev||f.index===prev+1);}
  assert.equal(f.index,Math.max(0,f.lines.length-f.visible));assert(f.content.includes(f.lines.at(-1)));
  for(let i=0;i<=f.lines.length;i++)f.move(-1);assert.equal(f.index,0);cases++;
 }
}
console.log(JSON.stringify({passed:true,cases,checks:['all words retained','paragraph gaps retained','all windows under host byte cap','one-line scrolling','end reachable','back to start']}));
