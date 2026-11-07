import {type EvenAppBridge,type EvenHubEvent,RebuildPageContainer,TextContainerProperty} from '@evenrealities/even_hub_sdk';
import {beginPairing} from './account-pairing';
import {account} from './account-client';
import {claimDisplay,dropDisplay} from './display';
import {rebuildGlassesPage,pushHomeToGlasses} from './image-utils';
import {rebuildHomePage} from './pages';
let bridge:EvenAppBridge|null=null,active=false,revision=0;
export function connectPairingGlasses(b:EvenAppBridge){bridge=b;window.addEventListener('sommni-account-linked',()=>{if(active)void paint('Account linked.\n\nYour Winebrary is now connected.\nProfile & photo: phone Settings.\n\nDouble-tap to return.');});}
async function paint(text:string){if(!bridge||!active)return;await rebuildGlassesPage(bridge,new RebuildPageContainer({containerTotalNum:1,textObject:[new TextContainerProperty({containerID:1,containerName:'account-link',xPosition:24,yPosition:16,width:528,height:256,isEventCapture:1,content:text})]}));}
export async function openPairingGlasses(){if(!bridge)throw Error('Open sommNI inside Even Hub with G2 connected.');await claimDisplay('account-pairing',()=>{active=false;revision++;});active=true;const epoch=++revision;await paint('sommNI / Link account\n\nPreparing your code…\n\nDouble-tap to return.');try{if((await account.auth.getSession()).data.session){await paint('sommNI / Account linked\n\nYour Winebrary is connected.\nProfile & photo: phone Settings.\n\nDouble-tap to return.');return;}const p=await beginPairing();if(!active||epoch!==revision)return;await paint(`sommNI / Link account\n\n${p.code}\n\nd3hospitality.com/sommNI/link\nGoogle or email. Confirm this code.\n\nDouble-tap to return.`);}catch(e){if(active&&epoch===revision)await paint((e as Error).message+'\n\nDouble-tap to return.');}}
export function handlePairingGlasses(event:EvenHubEvent){if(!active)return false;const type=event.listEvent?.eventType??event.textEvent?.eventType??event.sysEvent?.eventType;if(type===3){active=false;revision++;dropDisplay('account-pairing');if(bridge)void rebuildGlassesPage(bridge,rebuildHomePage()).then(()=>pushHomeToGlasses(bridge!));}return true;}
