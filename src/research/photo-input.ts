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
 const decoded=await decodePhoto(await (await fetch(photo)).blob());
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
