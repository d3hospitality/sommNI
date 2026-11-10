/** Decode an in-memory photo without going through WebView network interception. */
export function dataImageBlob(photo:string):Blob {
 const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(photo);
 if(!match||photo.length>21_000_000)throw Error('Choose a PNG, JPEG or WebP photo up to 15 MB.');
 let raw:string;try{raw=atob(match[2]);}catch{throw Error('Could not read this photo. Choose another JPEG or PNG.');}
 if(!raw.length||raw.length>15*1024*1024)throw Error('Choose a photo up to 15 MB.');
 return new Blob([Uint8Array.from(raw,c=>c.charCodeAt(0))],{type:match[1]});
}
/** Camera originals are resized locally before any upload. Keep alpha for cutouts. */
export async function decodePhoto(blob:Blob):Promise<{image:CanvasImageSource;width:number;height:number;close:()=>void}>{
 if(typeof createImageBitmap==='function'){
  try{const bitmap=await createImageBitmap(blob);return {image:bitmap,width:bitmap.width,height:bitmap.height,close:()=>bitmap.close()};}catch{/* Older phone WebViews can still decode through an image element. */}
 }
 const url=URL.createObjectURL(blob),image=new Image();
 try{await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(new Error('Could not read this photo. Export it as JPEG or PNG and try again.'));image.src=url;});return {image,width:image.naturalWidth,height:image.naturalHeight,close:()=>URL.revokeObjectURL(url)};}
 catch(error){URL.revokeObjectURL(url);throw error;}
}
export async function boundedPng(photo:string,frame=false):Promise<string>{
 if(!/^data:image\/(png|jpeg|webp);base64,/.test(photo)||photo.length>21_000_000)throw new Error('Choose a PNG, JPEG or WebP photo up to 15 MB.');
 const decoded=await decodePhoto(dataImageBlob(photo));
 try{
  if(decoded.width<20||decoded.height<20)throw new Error('Choose a larger, clear full-bottle photo.');
  const pad=frame?16:0,canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx)throw new Error('Could not read the bottle photo.');
  let scale=Math.min(1,(1024-pad*2)/Math.max(decoded.width,decoded.height));
  for(let attempt=0;attempt<4;attempt++){
   canvas.width=Math.max(20,Math.round(decoded.width*scale))+pad*2;canvas.height=Math.max(20,Math.round(decoded.height*scale))+pad*2;
   if(frame){ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);}
   ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(decoded.image,pad,pad,canvas.width-pad*2,canvas.height-pad*2);
   const png=canvas.toDataURL('image/png');if(png.startsWith('data:image/png;base64,')&&png.length<=2796200)return png;scale*=.8;
  }
  throw new Error('This photo is too detailed to process. Try a closer full-bottle photo.');
 }finally{decoded.close();}
}
export async function photoData(file:File):Promise<string>{
 const type=file.type||(/\.jpe?g$/i.test(file.name)?'image/jpeg':/\.png$/i.test(file.name)?'image/png':/\.webp$/i.test(file.name)?'image/webp':'');
 if(!['image/png','image/jpeg','image/webp'].includes(type))throw new Error('Choose a JPEG, PNG or WebP photo. For HEIC, export a JPEG first.');
 if(!file.size||file.size>15*1024*1024)throw new Error('Choose a photo up to 15 MB.');
 const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Could not read the photo.'));reader.readAsDataURL(file.type?file:new Blob([file],{type}));});
 return boundedPng(data);
}

/** The label-research endpoint accepts JPEG; artwork processing keeps its PNG alpha. */
export async function labelResearchPhoto(photo:string):Promise<string>{
 const bounded=await boundedPng(photo),decoded=await decodePhoto(dataImageBlob(bounded));
 try{
  const canvas=document.createElement('canvas');canvas.width=decoded.width;canvas.height=decoded.height;
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Could not prepare the label photo.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(decoded.image,0,0);
  const jpeg=canvas.toDataURL('image/jpeg',.9);
  if(!jpeg.startsWith('data:image/jpeg;base64,')||jpeg.length>2796200)throw Error('Choose a clearer, smaller label photo.');
  return jpeg;
 }finally{decoded.close();}
}

/** A second view concentrates image tokens on central label lettering; the full photo remains authoritative. */
export async function labelResearchDetail(photo:string):Promise<string|undefined>{
 const decoded=await decodePhoto(dataImageBlob(photo));
 try{
  const sx=decoded.width*.12,sy=decoded.height*.24,sw=decoded.width*.76,sh=decoded.height*.62;
  const scale=Math.min(3,900/Math.max(sw,sh)),canvas=document.createElement('canvas');canvas.width=Math.max(20,Math.round(sw*scale));canvas.height=Math.max(20,Math.round(sh*scale));
  const ctx=canvas.getContext('2d');if(!ctx)return undefined;
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(decoded.image,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
  const jpeg=canvas.toDataURL('image/jpeg',.92);return jpeg.startsWith('data:image/jpeg;base64,')&&jpeg.length<=1200000?jpeg:undefined;
 }finally{decoded.close();}
}
