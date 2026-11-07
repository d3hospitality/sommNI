import assert from 'node:assert/strict';
import {attachBottleSwipe} from '../src/atlas/bottle-swipe.ts';
class Bottle extends EventTarget{
 captures=new Set();props=new Map();style={setProperty:(k,v)=>this.props.set(k,v),removeProperty:k=>this.props.delete(k)};
 setPointerCapture(id){this.captures.add(id)}hasPointerCapture(id){return this.captures.has(id)}releasePointerCapture(id){this.captures.delete(id)}
}
const b=new Bottle(),steps=[];attachBottleSwipe(b,delta=>steps.push(delta));let notes=0;b.addEventListener('click',()=>notes++);
function fire(type,fields={}){const e=new Event(type,{cancelable:true});Object.assign(e,{pointerId:1,button:0,isPrimary:true,clientX:100,clientY:100,detail:1,...fields});b.dispatchEvent(e);return e;}
function swipe(dx,dy=0,end='pointerup'){fire('pointerdown');fire('pointermove',{clientX:100+dx,clientY:100+dy});fire(end,{clientX:100+dx,clientY:100+dy});}
swipe(-80);assert.deepEqual(steps,[1]);assert.equal(fire('click').defaultPrevented,true);assert.equal(notes,0);assert.equal(b.captures.size,0);assert.equal(b.props.size,0);
swipe(80);fire('click');assert.deepEqual(steps,[1,-1]);
swipe(-20);fire('click');assert.equal(steps.length,2);assert.equal(notes,0,'a short drag is not a notes tap');
swipe(20,100);fire('click');assert.equal(steps.length,2,'vertical scroll does not change wine');assert.equal(notes,0);
swipe(-100,0,'pointercancel');fire('click');assert.equal(steps.length,2,'cancel cannot advance');
fire('pointerdown');fire('pointerup');fire('click');assert.equal(notes,1,'a new tap opens notes after cancel');
fire('pointerdown');fire('pointerdown',{pointerId:2,isPrimary:false});fire('pointerup',{clientX:0});fire('click');assert.equal(steps.length,2,'multitouch cancels swipe');
assert.equal(fire('keydown',{key:'ArrowRight'}).defaultPrevented,true);assert.equal(steps.at(-1),1);
fire('keydown',{key:'ArrowLeft'});assert.equal(steps.at(-1),-1);
fire('click',{detail:0});assert.equal(notes,2,'keyboard activation remains available');
console.log('PASS: bottle swipe left/right, threshold, scroll, cancel, multitouch, tap and keyboard.');
