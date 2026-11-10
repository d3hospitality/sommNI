import type {BottleOutline} from './scan-tracker';
/** A cylindrical wireframe projected into a photographed silhouette, not a depth reconstruction. */
export function drawBottleMesh(ctx:CanvasRenderingContext2D,o:BottleOutline,frame:{x:number;y:number;width:number;height:number},sweep:number|null,reveal=1){
 const w=o.width*frame.width,h=o.height*frame.height,x=frame.x+o.left*frame.width,y=frame.y+o.top*frame.height;
 const sample=(t:number)=>{const f=Math.max(0,Math.min(11,t*11)),i=Math.min(10,Math.floor(f)),a=f-i;return {cx:x+((o.centers?.[i]??.5)*(1-a)+(o.centers?.[i+1]??.5)*a)*w,r:(o.rows[i]*(1-a)+o.rows[i+1]*a)*w/2,cy:y+t*h};};
 ctx.save();ctx.lineWidth=.8;ctx.strokeStyle='#f0c561';
 // Rear halves are dim; front halves bend down around the bottle's apparent volume.
 for(let band=0;band<15;band++){
  const t=band/14,{cx,cy,r}=sample(t),depth=Math.min(r*.22,h*.026);
  ctx.globalAlpha=t>reveal?.025:.08;ctx.beginPath();ctx.ellipse(cx,cy,r,depth,0,Math.PI,2*Math.PI);ctx.stroke();
  ctx.globalAlpha=t>reveal?.04:t>.38&&t<.72?.16:.32;ctx.beginPath();ctx.ellipse(cx,cy,r,depth,0,0,Math.PI);ctx.stroke();
 }
 // Counter-wound strands create a continuous net around neck, shoulders and body.
 for(const direction of [-1,1])for(let strand=0;strand<10;strand++){
  ctx.beginPath();let drawing=false;
  for(let j=0;j<=88;j++){const t=j/88;if(t>reveal)break;const {cx,cy,r}=sample(t),theta=strand/10*Math.PI*2+direction*t*Math.PI*1.5;
   const front=Math.sin(theta);if(front<0){drawing=false;continue;}const xx=cx+Math.cos(theta)*r,yy=cy+front*Math.min(r*.22,h*.026);
   drawing?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);drawing=true;
  }ctx.globalAlpha=.28;ctx.stroke();
 }
 if(sweep!==null){
  const {cx,cy,r}=sample(sweep),depth=Math.min(r*.22,h*.026);ctx.globalAlpha=.9;ctx.lineWidth=1.5;ctx.shadowColor='#e8bd57';ctx.shadowBlur=8;ctx.beginPath();ctx.ellipse(cx,cy,r,depth,0,0,Math.PI*2);ctx.stroke();
 }
 ctx.restore();
}
