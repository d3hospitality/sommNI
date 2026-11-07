import {account} from '../account-client';
import {showAccountPairing} from '../account-pairing';
import {openInitiativeBoard} from './initiative-ui';
import {mountPersonalProfile} from './personal-profile';
import {mountWeeklyHome} from './weekly-home';
export function initInitiative(){
 const profile=document.getElementById('personal-profile');if(profile)mountPersonalProfile(profile,account,()=>void showAccountPairing());
 document.querySelectorAll('[data-contributor-profile]').forEach(button=>button.addEventListener('click',()=>void openInitiativeBoard(account,()=>void showAccountPairing())));
 const hero=document.querySelector('#tab-home .lens-home');if(!hero)return;
 const host=document.createElement('section');host.id='sommni-weekly';hero.after(host);
 mountWeeklyHome(host,account,()=>void openInitiativeBoard(account,()=>void showAccountPairing()));
}
