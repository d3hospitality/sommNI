import assert from 'node:assert/strict';
import {Liquid,VESSELS,heightAt,radiusAt} from '../src/home-directions/fluid.ts';
let samples=0,maxVolumeError=0,peakSurface=0;
for(const vessel of VESSELS){
  const model=new Liquid(vessel);assert(model.volume>0);assert.equal(model.active(),false);
  const rest=model.surface();assert(rest.level>0&&rest.level<1);assert(rest.volumeError<1e-5);
  // Smooth vessels must not kink at each design control point.
  if(vessel.finish!=='cut')for(const [y] of vessel.profile.slice(1,-1)){
    const d=1e-5,left=(radiusAt(vessel,y)-radiusAt(vessel,y-d))/d,right=(radiusAt(vessel,y+d)-radiusAt(vessel,y))/d;
    assert(Math.abs(left-right)<.02,`${vessel.id} smooth tangent`);
  }
  model.setPose({roll:.36,pitch:.24},0);model.advance(80);
  assert(Math.abs(model.sx)<Math.tan(.36),'surface lags rotation');assert(model.modes.some(v=>Math.abs(v)>.0001));
  for(let t=100;t<=15000;t+=100){
    if(t===1500)model.setPose({roll:-.36,pitch:-.24},t);
    if(t===3000)model.setPose({roll:.13,pitch:.08},t);
    model.advance(t);const state=model.surface();samples++;
    assert(Object.values(state).flat().every(Number.isFinite),`${vessel.id} finite state`);
    maxVolumeError=Math.max(maxVolumeError,state.volumeError);assert(state.volumeError<1e-5,'conserved sampled volume');
    for(let i=0;i<12;i++)peakSurface=Math.max(peakSurface,heightAt(state,state.radius*.6*Math.cos(i),state.radius*.6*Math.sin(i)));
  }
  assert.equal(model.active(),false,`${vessel.id} eventually stops`);assert.equal(model.sx,-Math.tan(.13));assert.equal(model.sz,Math.tan(.08));
  const before=model.surface();model.setPose({roll:NaN,pitch:0},15000);model.advance(NaN);model.advance(0);assert.deepEqual(model.surface(),before,'bad sensor input or stale time cannot change state');
  model.setPose({roll:.3,pitch:-.1},15000);model.advance(80000);assert.equal(model.active(),false,'long pause settles without replay');
  // The engine has a fixed integration time step, independent of drawing cadence.
  const fast=new Liquid(vessel),slow=new Liquid(vessel);fast.setPose({roll:.25,pitch:.15},0);slow.setPose({roll:.25,pitch:.15},0);
  for(let t=10;t<=2200;t+=10)fast.advance(t);for(let t=550;t<=2200;t+=550)slow.advance(t);
  assert(Math.abs(fast.sx-slow.sx)<.002&&Math.abs(fast.sz-slow.sz)<.002,'render cadence does not drive physics');
  assert(Math.abs(fast.surface().level-slow.surface().level)<.002);
}
console.log(JSON.stringify({passed:true,vessels:VESSELS.length,samples,maxVolumeError,peakSurface,checks:['smooth bowl profiles','fixed volume in every vessel','roll and pitch excitation','inertial lag','finite state at extreme tilts and reversals','natural settling','invalid/stale sensor input ignored','long-pause stability','drawing-cadence independence']},null,2));
