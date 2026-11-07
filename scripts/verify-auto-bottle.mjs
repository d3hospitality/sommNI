import {writeFile} from 'node:fs/promises';
import {SOMMNI_PROJECT_URL,SOMMNI_PUBLISHABLE_KEY} from '../src/account-project.ts';
const start=Date.now();
const response=await fetch(`${SOMMNI_PROJECT_URL}/functions/v1/winelens-beta`,{method:'POST',headers:{'Content-Type':'application/json',apikey:SOMMNI_PUBLISHABLE_KEY},body:JSON.stringify({action:'bottle_lookup',wine_name:'Unico',producer:'Vega Sicilia',vintage:2014}),signal:AbortSignal.timeout(160000)});
const result=await response.json();await writeFile('../../outputs/sommNI-auto-bottles/live-lookup.json',JSON.stringify(result,null,2));
if(result.photo)await writeFile('../../outputs/sommNI-auto-bottles/verified-bottle.'+(result.photo.includes('image/png')?'png':'jpg'),Buffer.from(result.photo.split(',')[1],'base64'));
console.log(JSON.stringify({status:response.status,seconds:(Date.now()-start)/1000,cached:result.cached,photoBytes:result.photo?.length,provenance:result.provenance,error:result.error}));
if(!response.ok)process.exitCode=1;
