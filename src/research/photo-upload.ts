import './photo-upload.css';
import {usesEvenPhotoPicker,pickEvenPhoto} from './native-photo';
const silhouette='<svg viewBox="0 0 40 76" aria-hidden="true"><path d="M16 3h8v17c0 6 9 9 9 18v32a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V38c0-9 9-12 9-18Z" fill="currentColor" opacity=".2"/><path d="M16 3h8v17c0 6 9 9 9 18v32a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V38c0-9 9-12 9-18ZM16 10h8M11 43h18v16H11Z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
/** Browser file inputs; Even uses its native camera/album bridge below. */
export function bottlePhotoUpload(id:string,disabled=false){
 return `<div class="sommni-photo-upload"><label class="sommni-photo-tile">${silhouette}<span><strong>Upload Bottle Photo</strong><small>Choose from your photos or files</small></span><input id="${id}" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload Bottle Photo" ${disabled?'disabled':''}></label><label class="sommni-photo-camera"><span aria-hidden="true">◎</span> Take Photo<input id="${id}-camera" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" aria-label="Take Bottle Photo" ${disabled?'disabled':''}></label><span class="sommni-photo-filename" data-photo-filename role="status"></span></div>`;
}
export function bindBottlePhotoUpload(root:ParentNode,id:string){
 const input=root.querySelector<HTMLInputElement>(`#${id}`),camera=root.querySelector<HTMLInputElement>(`#${id}-camera`);if(!input||!camera)return;
 const name=input.closest('.sommni-photo-upload')?.querySelector<HTMLElement>('[data-photo-filename]');
 const selected=(event:Event)=>{const file=(event.target as HTMLInputElement).files?.[0];if(file&&name)name.textContent=file.name;};
 if(usesEvenPhotoPicker())for(const [picker,source] of [[input,'album'],[camera,'camera']] as const){
  let pending=false;
  picker.addEventListener('click',event=>{event.preventDefault();if(pending||picker.disabled)return;pending=true;
   if(name)name.textContent=source==='camera'?'Opening phone camera…':'Opening your photos…';
   void pickEvenPhoto(source).then(file=>{
    if(!input.isConnected)return;
    if(!file){if(name)name.textContent='No photo selected. Try again, or check camera/photo access in the Even app settings.';return;}
    if(name)name.textContent=file.name;
    // Reuse the same consumer as a browser file selection, without assigning a
    // synthetic FileList (unsupported in some embedded WebViews).
    const change=new Event('change');Object.defineProperty(change,'target',{value:{files:[file]}});
    input.onchange?.call(input,change);
   }).catch(error=>{if(name&&input.isConnected)name.textContent=(error as Error).message;}).finally(()=>{pending=false;});
  });
 }
 input.addEventListener('change',selected);
 camera.addEventListener('change',event=>{selected(event);if(camera.files?.length)input.onchange?.call(input,event);});
}
