import { account } from '../account-client';
import type { CollectiveSnapshot } from './atlas-activity-ui';
let snapshot:CollectiveSnapshot|null=null,running:Promise<void>|null=null;
window.addEventListener('sommni-atlas-snapshot',e=>{snapshot=(e as CustomEvent<CollectiveSnapshot>).detail;});
export const collectiveSnapshot=()=>snapshot;
export function refreshCollectiveAtlas(){
 if(running)return running;
 running=(async()=>{const {data,error}=await account.rpc('sommni_atlas_snapshot');if(error)throw error;snapshot=data;window.dispatchEvent(new CustomEvent('sommni-atlas-snapshot',{detail:data}));})().catch(e=>console.warn('[sommNI collective atlas]',e.message)).finally(()=>{running=null});return running;
}
