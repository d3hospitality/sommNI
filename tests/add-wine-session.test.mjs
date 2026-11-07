import assert from 'node:assert/strict';
import { WineAddSession } from '../src/research/add-session.ts';
const draft={id:'test-draft',result:{wine_name:'Estate Cabernet',producer:'Fixture Winery',vintage:2019,vintage_state:'year',tasting_notes:'Cassis and cedar.'}};
const checks=[];
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function make(extra={}){const calls=[];const flow=new WineAddSession({research:async(q,s)=>{calls.push(['research',q,s]);return {draft}},save:async d=>{calls.push(['save',d]);return {item:{id:'test-wine',wine_name:d.result.wine_name}}},changed:async()=>{calls.push(['phase',flow.phase])},...extra});return {flow,calls};}
{
 const {flow,calls}=make();await flow.save();assert.equal(calls.length,0);await flow.lookup(' Estate Cabernet 2019 ');assert.equal(flow.phase,'review');await flow.save();assert.equal(calls.filter(c=>c[0]==='save').length,0);await flow.setPhase('options');await Promise.all([flow.save(),flow.save()]);assert.equal(calls.filter(c=>c[0]==='save').length,1);assert.equal(flow.phase,'saved');checks.push('research requires explicit review/options before exactly one save');
}
{
 let resolve,signal;const {flow}=make({research:(_,s)=>{signal=s;return new Promise(r=>resolve=r)}});const pending=flow.lookup('Old wine');await tick();flow.cancel();resolve({draft});await pending;assert.equal(signal.aborted,true);assert.equal(flow.draft,null);checks.push('cancel aborts lookup and discards a late result');
}
{
 const tasks=[];const {flow}=make({research:q=>new Promise(resolve=>tasks.push({q,resolve}))});const first=flow.lookup('First');await tick();const second=flow.lookup('Second');await tick();tasks[1].resolve({draft:{...draft,id:'second'}});await second;tasks[0].resolve({draft});await first;assert.equal(flow.draft.id,'second');checks.push('a slow earlier query cannot overwrite the current wine');
}
{
 let requests=0;const {flow}=make({research:async()=>{requests++;return {draft}}});await flow.lookup('  ');assert.equal(requests,0);assert.equal(flow.phase,'error');checks.push('blank speech does not consume research capacity');
}
{
 const {flow}=make({research:async()=>{throw Error('Offline')}});await flow.lookup('Wine');assert.equal(flow.phase,'error');assert.equal(flow.error,'Offline');await flow.reset();assert.equal(flow.phase,'ready');checks.push('network errors return to a retryable state');
}
{
 const {flow}=make({save:async()=>({item:{id:'existing',wine_name:'Existing wine'},duplicate:true})});await flow.lookup('Wine');await flow.setPhase('options');await flow.save();assert.equal(flow.duplicate,true);assert.equal(flow.item.id,'existing');checks.push('duplicate result preserves the existing wine');
}
{
 const {flow}=make({save:async()=>{throw Error('Storage full')}});await flow.lookup('Wine');await flow.setPhase('options');await flow.save();assert.equal(flow.phase,'error');assert.equal(flow.item,null);checks.push('failed save never reports success');
}
console.log(JSON.stringify({passed:true,checks},null,2));
