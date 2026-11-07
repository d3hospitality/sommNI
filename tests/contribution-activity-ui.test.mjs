import assert from 'node:assert/strict';
import {build} from 'esbuild';import {mkdtemp} from 'node:fs/promises';import {tmpdir} from 'node:os';import {parseHTML} from 'linkedom';
const {window}=parseHTML('<html><body><section id="host"></section></body></html>');Object.assign(globalThis,{window,document:window.document});
const dir=await mkdtemp(tmpdir()+'/sommni-activity-');await build({entryPoints:['src/community/contribution-activity.ts'],bundle:true,format:'esm',platform:'node',outfile:dir+'/ui.mjs'});
const {mountContributionActivity}=await import(dir+'/ui.mjs');let owner='owner',reviewed=0,lastArgs;
globalThis.FormData=class extends Map{constructor(f){super([...f.querySelectorAll('textarea')].map(i=>[i.name,i.value]));}};
const client={auth:{getSession:async()=>({data:{session:owner?{user:{id:owner}}:null}})},rpc:async(name,args)=>{
 if(name==='sommni_contributor_activity')return {data:{can_review:owner==='owner',people:[{handle:'<script>Bad</script>',submissions:1,verified:0,tastings:0}],additions:[{wine_name:'Published Wine',producer:'Estate',vintage:'2020',contributor:'Winemaker',added_at:'2026-11-07'}]}};
 if(name==='sommni_owner_review_queue')return {data:{total:1,rows:reviewed?[]:[{id:'vintage',wine_name:'Sassicaia',vintage_key:'2020',producer:'Estate',country:'Italy',status:'pending',submissions:2,photos:1,facts:{region:'Bolgheri'},contributors:[{name:'Owner',email:'owner@example.com',status:'pending',submitted_at:'2026-11-07'}]}]}};
 if(name==='sommni_owner_review'){reviewed++;lastArgs=args;return {data:{status:'accepted'}};}throw Error(name);
}};
const host=document.querySelector('#host');await mountContributionActivity(host,client,'owner',[{wine_name:'My Wine',status:'pending'}]);
assert.equal(host.querySelector('script'),null);assert.match(host.textContent,/My Wine/);assert.match(host.textContent,/Published Wine/);assert.match(host.textContent,/Winemaker/);
host.querySelector('[data-owner-review]').click();await new Promise(r=>setImmediate(r));assert.match(host.textContent,/2 submissions · 1 saved images/);
const form=host.querySelector('form');form.querySelector('textarea').value='Verified estate and vintage';const button=form.querySelector('[value=accepted]');
const submit=()=>{const event=new window.Event('submit',{cancelable:true});event.submitter=button;form.dispatchEvent(event);};submit();assert.equal(reviewed,0,'First click asks for explicit confirmation');submit();await new Promise(r=>setImmediate(r));assert.equal(reviewed,1);assert.deepEqual(lastArgs,{vintage:'vintage',decision:'accepted',note:'Verified estate and vintage'});
owner=undefined;await mountContributionActivity(host,client,undefined);assert.equal(host.querySelector('[data-owner-review]'),null);assert.equal(host.textContent.includes('owner@example.com'),false);
console.log('PASS contributor wines and names, XSS escape, owner-only entry, grouped queue, explicit review confirmation, anonymous view privacy.');
