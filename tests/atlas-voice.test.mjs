import assert from 'node:assert/strict';
import { AtlasVoiceCapture } from '../src/atlas/voice-capture.ts';
import { placeSearchScore } from '../src/atlas/place-search.ts';
const checks=[];
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function setup(overrides={}){const calls=[],results=[],errors=[];const deps={control:async open=>{calls.push(open);return true},state:async()=>{},transcribe:async()=> 'Tuscany',result:async text=>{results.push(text)},error:async error=>{errors.push(error.message)},...overrides};return {capture:new AtlasVoiceCapture(deps),calls,results,errors};}
{
 const t=setup();await t.capture.start();t.capture.feed(new Uint8Array(6400));await t.capture.finish();
 assert.deepEqual(t.calls,[true,false]);assert.deepEqual(t.results,['Tuscany']);assert.equal(t.capture.state,'idle');checks.push('microphone closes before transcription result');
}
{
 let requests=0;const t=setup({transcribe:async()=>{requests++;return ''}});await t.capture.start();await t.capture.finish();assert.equal(requests,0);assert.equal(t.errors.length,1);assert.equal(t.calls.at(-1),false);checks.push('no audio does not call the transcription provider');
}
{
 let resolve;const response=new Promise(r=>resolve=r);let signal;
 const t=setup({transcribe:async(_,s)=>{signal=s;return response}});await t.capture.start();t.capture.feed(new Uint8Array(6400));const finishing=t.capture.finish();await tick();await t.capture.cancel();resolve('Piedmont');await finishing;
 assert.equal(signal.aborted,true);assert.deepEqual(t.results,[]);assert.deepEqual(t.errors,[]);checks.push('cancel aborts recognition and ignores a late transcript');
}
{
 const t=setup({control:async()=>false});await t.capture.start();assert.equal(t.capture.state,'idle');assert.match(t.errors[0],/Microphone unavailable/);checks.push('denied microphone is recoverable');
}
{
 let open;const opening=new Promise(r=>open=r),calls=[];let tail=Promise.resolve();
 const t=setup({control:value=>{const next=tail.then(async()=>{calls.push(value);if(value)return opening;return true});tail=next;return next}});
 const starting=t.capture.start();await tick();const cancelling=t.capture.cancel();open(true);await Promise.all([starting,cancelling]);
 assert.deepEqual(calls,[true,false]);assert.equal(t.capture.state,'idle');assert.deepEqual(t.results,[]);checks.push('cancel during microphone opening still closes hardware');
}
{
 let bytes=0;const t=setup({transcribe:async pcm=>{bytes=pcm.length;return 'Italy'}});await t.capture.start();t.capture.feed(new Uint8Array(250000));await tick();await tick();assert.equal(bytes,224000);assert.deepEqual(t.calls,[true,false]);checks.push('audio capture is bounded and stops once');
}
assert.equal(placeSearchScore(null,'Tuscany'),0);
assert.equal(placeSearchScore('Piedmont','Piemonte'),100);
assert.equal(placeSearchScore('Tuscany','show me wines from Toscana please'),100);
assert.equal(placeSearchScore('Piedmont','Tuscany'),0);
assert.equal(placeSearchScore('Alto Adige','Südtirol'),100);
assert.ok(placeSearchScore('Tuscany','Tuscany Italy','Italy')>0);
assert.equal(placeSearchScore('Tuscany','show me wines'),0);
checks.push('spoken filler and Italian place aliases match only existing places');
console.log(JSON.stringify({passed:true,checks},null,2));
