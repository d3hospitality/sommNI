import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';
export const PIPELINE='photographic-edge-u2netp-v1';
export class BottleError extends Error {constructor(public status:number,message:string){super(message)}}
export const digest=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))].map(n=>n.toString(16).padStart(2,'0')).join('');
export function pngDimensions(bytes:Uint8Array){
 if(bytes.length<33||![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))throw new BottleError(400,'Choose a PNG photograph.');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=v.getUint32(16),height=v.getUint32(20);
 if(width<20||height<180||Math.max(width,height)>1024||width*height>1048576)throw new BottleError(413,'Use a full-bottle photograph up to 1024 pixels.');
 return {width,height};
}
export const MODEL={name:'u2netp-309c8469.onnx',url:'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx',sha:'309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8'};
export const WASM={name:'ort-1.17.3-6783fcd6.wasm',url:'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.17.3/dist/ort-wasm-simd.wasm',sha:'6783fcd6647ce1b426a527c31412a9c40894552faa609e9c931b3239a3438071'};
export type AssetLoader=(asset:typeof MODEL)=>Promise<Uint8Array>;
/** Retain one solid bottle silhouette; reject multiple subjects and cut-off bottles. */
export function silhouette(mask:Uint8Array,width:number,height:number){
 const visited=new Uint8Array(mask.length),queue=new Int32Array(mask.length),labels=new Int32Array(mask.length),sizes:number[]=[0];
 let label=0,largest=0;
 for(let i=0;i<mask.length;i++){
  if(!mask[i]||visited[i])continue;label++;let start=0,end=1;queue[0]=i;visited[i]=1;
  while(start<end){const j=queue[start++];labels[j]=label;const x=j%width;for(const n of [x?j-1:-1,x<width-1?j+1:-1,j-width,j+width])if(n>=0&&n<mask.length&&mask[n]&&!visited[n]){visited[n]=1;queue[end++]=n;}}
  sizes[label]=end;if(end>sizes[largest])largest=label;
 }
 if(!largest)throw new BottleError(422,'No bottle found. Use a clear full-bottle photograph.');
 if(sizes.slice(1).filter(n=>n>sizes[largest]*.15).length>1)throw new BottleError(422,'More than one subject found. Choose one complete bottle.');
 // Flood the exterior; everything enclosed becomes opaque, preserving dark glass and labels.
 const exterior=new Uint8Array(mask.length);let start=0,end=0;
 const add=(i:number)=>{if(!exterior[i]&&labels[i]!==largest){exterior[i]=1;queue[end++]=i}};
 for(let x=0;x<width;x++){add(x);add((height-1)*width+x)}for(let y=0;y<height;y++){add(y*width);add(y*width+width-1)}
 while(start<end){const i=queue[start++],x=i%width;for(const n of [x?i-1:-1,x<width-1?i+1:-1,i-width,i+width])if(n>=0&&n<mask.length)add(n)}
 let left=width,top=height,right=-1,bottom=-1;
 for(let i=0;i<mask.length;i++){mask[i]=exterior[i]?0:255;if(mask[i]){const x=i%width,y=Math.floor(i/width);left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y)}}
 if(left<2||top<2||right>=width-2||bottom>=height-2)throw new BottleError(422,'Include the entire neck and base, with some space around the bottle.');
 const ratio=(bottom-top+1)/(right-left+1);
 if(ratio<2.1||ratio>6.8||bottom-top<160)throw new BottleError(422,'Use a full-bottle photograph, rather than a label close-up.');
 return {mask,left,top,right,bottom,ratio};
}
/** Bilinear sampling; alpha is premultiplied to avoid pale fringes around dark bottles. */
function resize(source:Image,width:number,height:number){
 const result=new Image(width,height),a=source.bitmap,b=result.bitmap;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const fx=Math.max(0,(x+.5)*source.width/width-.5),fy=Math.max(0,(y+.5)*source.height/height-.5),x0=Math.floor(fx),y0=Math.floor(fy),dx=fx-x0,dy=fy-y0;
  const indices=[(y0*source.width+x0)*4,(y0*source.width+Math.min(x0+1,source.width-1))*4,(Math.min(y0+1,source.height-1)*source.width+x0)*4,(Math.min(y0+1,source.height-1)*source.width+Math.min(x0+1,source.width-1))*4];
  const weights=[(1-dx)*(1-dy),dx*(1-dy),(1-dx)*dy,dx*dy],out=(y*width+x)*4;
  let alpha=0;for(let k=0;k<4;k++)alpha+=a[indices[k]+3]*weights[k];b[out+3]=Math.round(alpha);
  if(alpha)for(let c=0;c<3;c++){let value=0;for(let k=0;k<4;k++)value+=a[indices[k]+c]*a[indices[k]+3]*weights[k];b[out+c]=Math.round(value/alpha);}
 }
 return result;
}
export async function cutout(bytes:Uint8Array,_load:AssetLoader,providedMask?:Uint8Array){
 const dimensions=pngDimensions(bytes),source=await Image.decode(bytes);
 if(source.width!==dimensions.width||source.height!==dimensions.height)throw new BottleError(400,'Invalid image dimensions.');
 const {width,height}=source,mask=new Uint8Array(width*height);let transparent=0;
 for(let i=0;i<mask.length;i++)if(source.bitmap[i*4+3]<16)transparent++;
 let method='source-alpha';
 if(transparent>mask.length*.05){for(let i=0;i<mask.length;i++)mask[i]=source.bitmap[i*4+3]>110?255:0}
 else {
  method='u2netp-browser-filled-silhouette';
  if(!providedMask||providedMask.length!==320*320)throw new BottleError(400,'The bottle outline is required. Please retry from the app.');
  const sample=(x:number,y:number)=>providedMask[Math.min(319,Math.max(0,y))*320+Math.min(319,Math.max(0,x))];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const fx=(x+.5)*320/width-.5,fy=(y+.5)*320/height-.5,x0=Math.floor(fx),y0=Math.floor(fy),dx=fx-x0,dy=fy-y0;
   const value=sample(x0,y0)*(1-dx)*(1-dy)+sample(x0+1,y0)*dx*(1-dy)+sample(x0,y0+1)*(1-dx)*dy+sample(x0+1,y0+1)*dx*dy;
   mask[y*width+x]=value>110?255:0;
  }
 }
 const bounds=silhouette(mask,width,height);
 for(let i=0;i<mask.length;i++)source.bitmap[i*4+3]=mask[i];
 const crop=source.crop(bounds.left,bounds.top,bounds.right-bounds.left+1,bounds.bottom-bounds.top+1),scale=Math.min(340/crop.width,720/crop.height),scaled=resize(crop,Math.round(crop.width*scale),Math.round(crop.height*scale));
 // Alpha edge cleanup after downsampling; RGB stays from the original photo.
 const alpha=new Uint8Array(scaled.width*scaled.height);for(let i=0;i<alpha.length;i++)alpha[i]=scaled.bitmap[i*4+3];
 for(let y=1;y<scaled.height-1;y++)for(let x=1;x<scaled.width-1;x++){let a=255;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)a=Math.min(a,alpha[(y+dy)*scaled.width+x+dx]);scaled.bitmap[(y*scaled.width+x)*4+3]=a;}
 const canvas=new Image(384,768);canvas.composite(scaled,Math.round((384-scaled.width)/2),744-scaled.height);
 const png=await canvas.encode(1);
 if(png.length>2097152)throw new BottleError(413,'The processed bottle is too large.');
 return {png,provenance:{pipeline:PIPELINE,kind:'photograph',segmentation:method,mask_origin:method==='source-alpha'?'source-photo':'client-model; silhouette validated by server',source_sha256:await digest(bytes),source_size:[width,height],subject_bounds:[bounds.left,bounds.top,bounds.right+1,bounds.bottom+1],subject_ratio_h_over_w:bounds.ratio,output_size:[384,768],height_cm:null,scale_basis:'source-photo-aspect-ratio; physical height unverified'}};
}
