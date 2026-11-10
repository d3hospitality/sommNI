import {waitForEvenAppBridge,type AppImageAsset} from '@evenrealities/even_hub_sdk';
import {dataImageBlob} from './photo-input';
export type PhotoSource='camera'|'album';
export const usesEvenPhotoPicker=()=>typeof (window as any).flutter_inappwebview?.callHandler==='function';
/** Native assets carry bytes. Never fetch a private phone filesystem path. */
export function nativePhotoFile(asset:AppImageAsset):File {
 const raw=String(asset.base64||'').replace(/\s/g,'');
 if(!raw)throw Error('Even returned a photo without image data. Try another photo or update the Even app.');
 let mime=String(asset.mimeType||'').toLowerCase().replace('image/jpg','image/jpeg');
 if(!mime||mime==='application/octet-stream')mime=raw.startsWith('/9j/')?'image/jpeg':raw.startsWith('iVBOR')?'image/png':raw.startsWith('UklGR')?'image/webp':'';
 const blob=dataImageBlob(raw.startsWith('data:')?raw:`data:${mime};base64,${raw}`);
 return new File([blob],asset.name||`bottle.${blob.type==='image/png'?'png':blob.type==='image/webp'?'webp':'jpg'}`,{type:blob.type});
}
let pending=false;
export async function pickEvenPhoto(source:PhotoSource):Promise<File|null>{
 if(pending)throw Error('Finish the open camera or photo picker first.');
 pending=true;try{
 const bridge=await waitForEvenAppBridge();
 const method=source==='camera'?bridge.captureImageFromCamera:bridge.pickImageFromAlbum;
 if(typeof method!=='function')throw Error('Update the Even app to use its camera and photo library.');
 const asset=await method.call(bridge);
 return asset?nativePhotoFile(asset):null;
 }finally{pending=false;}
}
