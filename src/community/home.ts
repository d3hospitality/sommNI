import {account} from '../account-client';
import {showAccountPairing} from '../account-pairing';
import {mountInitiativeBanner,openInitiativeBoard} from './initiative-ui';
export function initInitiative(){
 document.querySelectorAll('[data-contributor-profile]').forEach(button=>button.addEventListener('click',()=>void openInitiativeBoard(account,()=>void showAccountPairing())));
 const hero=document.querySelector('#tab-home .sommni-home')||document.querySelector('#tab-home > section')||document.querySelector('#tab-home > div');if(!hero)return;
 const host=document.createElement('div');host.id='sommni-initiative';const fold=document.createElement('details');fold.className='home-secondary';fold.innerHTML='<summary>Build the world wine map together ↗</summary>';fold.append(host);(document.querySelector('#tab-home .wl-overview-grid')||hero).after(fold);
 mountInitiativeBanner(host,account,()=>void showAccountPairing(),()=>window.dispatchEvent(new CustomEvent('sommni-add-wine',{detail:{query:''}})));
}
