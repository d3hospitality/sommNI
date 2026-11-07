import assert from 'node:assert/strict';
import {wheelLanding,WheelVelocity,attachWheelMotion,WHEEL_ROW as ROW} from '../src/atlas/wheel-motion.ts';
for(const velocity of [.62,.7,.8,1.4,4]){
 const down=wheelLanding(20*ROW,velocity,100),up=wheelLanding(20*ROW,-velocity,100);
 assert.ok((down.target-20*ROW)/ROW>=7&&(down.target-20*ROW)/ROW<=9);
 assert.equal(down.target-20*ROW,20*ROW-up.target);
}
assert.equal(wheelLanding(10*ROW+8,.08,100).target,10*ROW,'slow releases magnetize to the nearest choice');
assert.equal(wheelLanding(2*ROW,-3,100).target,0);
assert.equal(wheelLanding(98*ROW,3,100).target,99*ROW);
assert.equal(wheelLanding(0,3,0).target,0);
const samples=new WheelVelocity();samples.add(0,0);samples.add(80,80);assert.equal(samples.value(80,250),0,'pause before release cancels momentum');
let clock=0,next=1,reduced=false;const frames=new Map();
Object.defineProperty(globalThis,'performance',{value:{now:()=>clock},configurable:true});
globalThis.requestAnimationFrame=f=>{const id=next++;frames.set(id,f);return id};
globalThis.cancelAnimationFrame=id=>frames.delete(id);
globalThis.matchMedia=()=>({matches:reduced});
class Track extends EventTarget{
 scrollTop=20*ROW;clientHeight=220;captures=new Set();classes=new Set();
 classList={add:(...names)=>names.forEach(n=>this.classes.add(n)),remove:(...names)=>names.forEach(n=>this.classes.delete(n))};
 hasPointerCapture(id){return this.captures.has(id)}setPointerCapture(id){this.captures.add(id)}releasePointerCapture(id){this.captures.delete(id)}
}
const track=new Track();let selected=20,clicks=0;
const motion=attachWheelMotion(track,()=>100,i=>selected=i);track.addEventListener('click',()=>clicks++);
function fire(type,fields={}){const event=new Event(type,{cancelable:true});for(const [key,value] of Object.entries({pointerId:1,button:0,isPrimary:true,clientY:300,timeStamp:clock,detail:1,...fields}))Object.defineProperty(event,key,{value});track.dispatchEvent(event);return event;}
function tick(ms){clock+=ms;const pending=[...frames.values()];frames.clear();pending.forEach(f=>f(clock));}
function flick(){fire('pointerdown');clock+=60;fire('pointermove',{clientY:240});clock+=10;fire('pointerup',{clientY:240});}
flick();const release=track.scrollTop;assert.ok(frames.size);fire('click');assert.equal(clicks,0,'drag does not also pick the touched row');
const positions=[release];for(let i=0;i<12;i++){tick(100);positions.push(track.scrollTop)}
assert.equal(track.scrollTop%ROW,0,'coasting ends exactly on a row');assert.equal(selected,Math.round((release+9*ROW)/ROW));
assert.ok(positions.every((value,i)=>!i||value>=positions[i-1]));
assert.ok(positions[1]-positions[0]>positions[5]-positions[4],'coasting slows down');
assert.equal(frames.size,0);
flick();tick(100);fire('pointerdown');const stopped=track.scrollTop;tick(500);assert.equal(track.scrollTop,stopped,'a new touch arrests momentum immediately');fire('pointerup');fire('click');assert.equal(clicks,0,'tap to stop does not pick another row');
motion.stop();tick(1500);assert.equal(frames.size,0);
fire('pointerdown');clock+=60;fire('pointermove',{clientY:220});fire('pointercancel');tick(1200);assert.equal(track.scrollTop,Math.round((stopped+80)/ROW)*ROW,'cancel snaps without flinging');
reduced=true;flick();assert.equal(frames.size,0,'reduced motion selects without coast animation');
motion.destroy();const destroyed=track.scrollTop;flick();tick(1200);assert.equal(track.scrollTop,destroyed,'destroy removes gesture handlers');
console.log('PASS: 7–9-row flicks, reverse direction, slow/pause releases, boundaries, deceleration, magnetic alignment, tap-to-stop, cancel, reduced motion and cleanup.');
