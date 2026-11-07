import assert from 'node:assert/strict';
import {HeadTilt} from '../src/intelligence/motion.ts';
const sensor=new HeadTilt();
assert.deepEqual(sensor.sample({x:0,y:0,z:1}),{roll:0,pitch:0});
for(let i=0;i<20;i++){const p=sensor.sample({x:0,y:.002*(i%2?1:-1),z:1});assert(p.roll===0&&p.pitch===0);}
assert.equal(sensor.sample({x:NaN,y:0,z:1}),null);assert.equal(sensor.sample({x:0,y:0,z:0}),null);assert.equal(sensor.sample({x:0,y:0,z:10}),null);
let pose;for(let i=0;i<30;i++)pose=sensor.sample({x:0,y:Math.sin(.35),z:Math.cos(.35)});
assert(Math.abs(pose.roll-.35)<.051);assert.equal(pose.pitch,0);
sensor.reset();assert.deepEqual(sensor.sample({x:0,y:Math.sin(.35)*9.81,z:Math.cos(.35)*9.81}),{roll:0,pitch:0});
for(let i=0;i<30;i++)pose=sensor.sample({x:0,y:Math.sin(.1)*9.81,z:Math.cos(.1)*9.81});
assert(Math.abs(pose.roll+.25)<.051);
console.log(JSON.stringify({passed:true,checks:['neutral calibration','sensor jitter suppression','invalid sample rejection','acceleration outlier rejection','roll tracking','gravity-unit independence','recenter calibration']}));
