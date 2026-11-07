import {heightAt,radiusAt,type Pose,type Surface,type Vessel} from './fluid';
export interface PaintOptions {mono?:boolean; compact?:boolean; scale?:number}
/** Procedural projected crystal, not a pre-rendered image. The free surface is
 * sampled in 3D and shares the exact same volume solve as the G2 rendering. */
export function paintVessel(canvas:HTMLCanvasElement,v:Vessel,pose:Pose,surface:Surface,options:PaintOptions={}){
  const ctx=canvas.getContext('2d')!,w=canvas.width,h=canvas.height,mono=!!options.mono;
  ctx.clearRect(0,0,w,h);
  const span=1+v.stem+.12,scale=Math.min(h*.79/span,w*.64/(2*Math.max(v.foot,...v.profile.map(p=>p[1]))))*(options.scale??1);
  const bottom=h*.91,centerY=(1-v.stem)/2,roll=pose.roll,elevation=.22+pose.pitch;
  function point(x:number,y:number,z=0):[number,number]{
    const yy=y-centerY,rx=x*Math.cos(roll)-yy*Math.sin(roll),ry=x*Math.sin(roll)+yy*Math.cos(roll);
    return [w/2+rx*scale,bottom-(centerY+v.stem+ry*Math.cos(elevation)-z*Math.sin(elevation))*scale];
  }
  const line=(x:number,y:number,z=0)=>ctx.lineTo(...point(x,y,z));
  const move=(x:number,y:number,z=0)=>ctx.moveTo(...point(x,y,z));
  const dark=v.finish==='smoke',edge=mono?'rgba(220,220,220,.9)':dark?'rgba(237,225,211,.5)':'rgba(89,79,71,.48)';
  const light=mono?'rgba(210,210,210,.75)':dark?'rgba(255,250,235,.55)':'rgba(255,255,255,.95)';
  const ellipse=(radius:number,y:number,start=0,end=Math.PI*2)=>{for(let i=0;i<=72;i++){const a=start+(end-start)*i/72;const p=point(Math.cos(a)*radius,y,Math.sin(a)*radius);if(i===0)ctx.moveTo(...p);else ctx.lineTo(...p);}};
  // Only the web study gets a soft grounding shadow. It is omitted on G2.
  if(!mono&&!options.compact){ctx.save();ctx.translate(w/2,h*.92);ctx.scale(1,.14);const shadow=ctx.createRadialGradient(0,0,0,0,0,scale*.55);shadow.addColorStop(0,dark?'rgba(0,0,0,.3)':'rgba(65,46,40,.17)');shadow.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=shadow;ctx.beginPath();ctx.arc(0,0,scale*.55,0,Math.PI*2);ctx.fill();ctx.restore();}
  if(v.stem>0){
    ctx.beginPath();ellipse(v.foot,-v.stem);ctx.closePath();ctx.fillStyle=mono?'rgba(85,85,85,.3)':dark?'rgba(220,212,203,.06)':'rgba(228,225,219,.35)';ctx.fill();ctx.strokeStyle=edge;ctx.lineWidth=Math.max(.7,scale*.0045);ctx.stroke();
    ctx.beginPath();ellipse(v.foot*.92,-v.stem+.012,0,Math.PI);ctx.strokeStyle=light;ctx.stroke();
    const thick=v.id==='08'?.043:.013;
    ctx.beginPath();move(-.024,0);ctx.bezierCurveTo(...point(-thick,-v.stem*.22),...point(-thick,-v.stem*.72),...point(-thick,-v.stem*.89));
    ctx.quadraticCurveTo(...point(-thick,-v.stem*.98),...point(-v.foot*.42,-v.stem+.012));
    ctx.quadraticCurveTo(...point(0,-v.stem+.005),...point(v.foot*.42,-v.stem+.012));
    ctx.quadraticCurveTo(...point(thick,-v.stem*.98),...point(thick,-v.stem*.89));
    ctx.bezierCurveTo(...point(thick,-v.stem*.72),...point(thick,-v.stem*.22),...point(.024,0));ctx.closePath();
    const stemGradient=ctx.createLinearGradient(w/2-scale*.03,0,w/2+scale*.03,0);stemGradient.addColorStop(0,mono?'#777':dark?'#706967':'#a49c91');stemGradient.addColorStop(.45,mono?'#ddd':'#ffffff');stemGradient.addColorStop(.72,mono?'#555':dark?'#7e7774':'#c8c1b8');stemGradient.addColorStop(1,mono?'#aaa':'#f8f5f0');ctx.fillStyle=stemGradient;ctx.globalAlpha=mono?.65:.72;ctx.fill();ctx.globalAlpha=1;
  }
  const bowl=new Path2D();
  for(let i=0;i<=100;i++){const y=1-i/100,p=point(-radiusAt(v,y),y);if(i===0)bowl.moveTo(...p);else bowl.lineTo(...p);}
  for(let i=0;i<=100;i++){const y=i/100;bowl.lineTo(...point(radiusAt(v,y),y));}
  bowl.closePath();
  const [left]=point(-surface.radius,.5),[right]=point(surface.radius,.5);
  const glass=ctx.createLinearGradient(left,0,right,0);
  glass.addColorStop(0,mono?'rgba(155,155,155,.17)':dark?'rgba(234,232,227,.13)':'rgba(182,175,164,.25)');
  glass.addColorStop(.14,mono?'rgba(30,30,30,.02)':dark?'rgba(130,122,118,.04)':'rgba(255,255,255,.05)');
  glass.addColorStop(.55,mono?'rgba(80,80,80,.04)':dark?'rgba(102,85,90,.08)':'rgba(255,255,255,.13)');
  glass.addColorStop(.9,mono?'rgba(160,160,160,.10)':dark?'rgba(239,229,223,.12)':'rgba(160,147,132,.12)');
  glass.addColorStop(1,mono?'rgba(200,200,200,.3)':dark?'rgba(240,232,225,.27)':'rgba(255,255,255,.6)');
  ctx.fillStyle=glass;ctx.fill(bowl);
  ctx.save();ctx.clip(bowl);
  // Wall contact of the surface: solve radius against the actual bowl profile.
  const ring:{x:number;y:number;z:number}[]=[];
  for(let i=0;i<=128;i++){
    const a=i/128*Math.PI*2;let low=0,high=surface.radius;
    for(let k=0;k<20;k++){const r=(low+high)/2,y=heightAt(surface,r*Math.cos(a),r*Math.sin(a));if(y>0&&y<1&&r<radiusAt(v,y))low=r;else high=r;}
    const r=(low+high)/2,x=r*Math.cos(a),z=r*Math.sin(a),y=heightAt(surface,x,z);ring.push({x,y,z});
  }
  // Front-facing wet wall. The top is a moving 3D boundary, not a rotated rectangle.
  ctx.beginPath();move(ring[0].x,ring[0].y,ring[0].z);
  for(let i=1;i<=64;i++){const p=ring[i];line(p.x,p.y,p.z);}
  line(-surface.radius*2,-.2);line(surface.radius*2,-.2);ctx.closePath();
  const wine=ctx.createLinearGradient(left,0,right,0);
  if(mono){wine.addColorStop(0,'#616161');wine.addColorStop(.25,'#202020');wine.addColorStop(.62,'#373737');wine.addColorStop(1,'#8b8b8b');}
  else {wine.addColorStop(0,'#a84955');wine.addColorStop(.11,'#681c30');wine.addColorStop(.35,'#2b0715');wine.addColorStop(.62,'#3c0a1d');wine.addColorStop(.87,'#72152f');wine.addColorStop(1,'#bd4d59');}
  ctx.fillStyle=wine;ctx.fill();
  // Curved meniscus and subtle surface illumination. Wave modes are shared with the volume solve.
  ctx.beginPath();ring.forEach((p,i)=>i?line(p.x,p.y,p.z):move(p.x,p.y,p.z));ctx.closePath();
  const center=point(0,surface.level),top=ctx.createRadialGradient(center[0]-scale*.12,center[1]-scale*.08,0,center[0],center[1],scale*surface.radius*1.1);
  top.addColorStop(0,mono?'#818181':'#9d354b');top.addColorStop(.65,mono?'#5d5d5d':'#741c34');top.addColorStop(1,mono?'#9c9c9c':'#b15b65');ctx.fillStyle=top;ctx.fill();
  ctx.strokeStyle=mono?'#aaa':'rgba(243,165,163,.75)';ctx.lineWidth=Math.max(.6,scale*.004);ctx.stroke();
  // Surface contour reflections break up as the two transverse waves interfere.
  for(let j=0;j<3;j++){
    ctx.beginPath();let started=false;
    for(let i=0;i<=45;i++){const x=(-.8+i/45*1.6)*radiusAt(v,surface.level),z=(j-1)*surface.radius*.22,y=heightAt(surface,x,z);
      if(Math.hypot(x,z)<radiusAt(v,y)*.83){if(!started){move(x,y+.002,z);started=true;}else line(x,y+.002,z);}}
    ctx.strokeStyle=mono?'rgba(180,180,180,.12)':`rgba(255,206,194,${.07+j*.02})`;ctx.lineWidth=scale*.004;ctx.stroke();
  }
  // Curved strip-light reflections follow the bowl, which makes it read as crystal.
  for(const [side,factor,alpha,width] of [[-1,.82,.74,.018],[-1,.7,.24,.028],[1,.88,.6,.009],[1,.65,.14,.035]]){
    ctx.beginPath();for(let i=0;i<=72;i++){const y=.08+i/72*.86,r=radiusAt(v,y),x=side*r*factor,z=Math.sqrt(Math.max(0,r*r-x*x));if(!i)move(x,y,z);else line(x,y,z);}
    ctx.strokeStyle=mono?`rgba(235,235,235,${alpha*.58})`:`rgba(255,253,241,${alpha})`;ctx.lineWidth=Math.max(.65,scale*width);ctx.stroke();
  }
  if(v.finish==='fluted'||v.finish==='cut')for(let j=1;j<12;j++){
    const a=j/12*Math.PI;ctx.beginPath();for(let i=0;i<=50;i++){const y=.08+i/50*.91,r=radiusAt(v,y),x=Math.cos(a)*r,z=Math.sin(a)*r;if(!i)move(x,y,z);else line(x,y,z);}
    ctx.strokeStyle=mono?'rgba(175,175,175,.22)':`rgba(255,255,255,${v.finish==='cut'?.23:.28})`;ctx.lineWidth=scale*(v.finish==='cut'?.012:.006);ctx.stroke();
  }
  ctx.restore();ctx.strokeStyle=edge;ctx.lineWidth=Math.max(.7,scale*.004);ctx.stroke(bowl);
  ctx.beginPath();ellipse(radiusAt(v,1),1);ctx.strokeStyle=light;ctx.lineWidth=Math.max(.9,scale*.006);ctx.stroke();
  ctx.beginPath();ellipse(radiusAt(v,1)*.985,.997,0,Math.PI);ctx.strokeStyle=edge;ctx.lineWidth=Math.max(.5,scale*.003);ctx.stroke();
  if(!v.stem){ctx.beginPath();ellipse(radiusAt(v,.055),.055,0,Math.PI);ctx.strokeStyle=light;ctx.lineWidth=scale*.012;ctx.stroke();}
}

const thresholds=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
/** Sparse monochrome sprite, rendered at its intended 128 × 144 pixel size. */
export function g2Sprite(v:Vessel,pose:Pose,surface:Surface,canvas:HTMLCanvasElement){
  canvas.width=128;canvas.height=144;paintVessel(canvas,v,pose,surface,{mono:true,compact:true});
  const ctx=canvas.getContext('2d')!,img=ctx.getImageData(0,0,128,144),d=img.data;
  for(let y=0;y<144;y++)for(let x=0;x<128;x++){
    const i=(y*128+x)*4,value=d[i]/255*d[i+3]/255,on=value>(thresholds[(y%4)*4+x%4]+.5)/16;
    d[i]=on?119:0;d[i+1]=on?201:0;d[i+2]=on?105:0;d[i+3]=on?255:0;
  }
  ctx.putImageData(img,0,0);
}
export const DESTINATIONS=['My Winebrary','Find my wine','Wine pairings','Study today','Wine Atlas','Wine by grape','Wine history'];
/** G2 concept layout. Browser font metrics approximate firmware; no SDK is called. */
export function paintG2(canvas:HTMLCanvasElement,sprite:HTMLCanvasElement,v:Vessel,selection=0){
  canvas.width=576;canvas.height=288;const c=canvas.getContext('2d')!;c.fillStyle='#050a07';c.fillRect(0,0,576,288);
  const ink='#a9dba1',dim='#688d64';c.textBaseline='middle';
  const text=(t:string,x:number,y:number,size=18,color=ink)=>{c.font=`${size}px Arial, sans-serif`;c.fillStyle=color;c.fillText(t,x,y);};
  const rows=(x:number,y:number,count:number,spacing:number,start=0)=>{for(let i=0;i<count;i++){const n=(start+i)%DESTINATIONS.length,active=n===selection;text(`${active?'›':' '} ${DESTINATIONS[n]}`,x,y+i*spacing,18,active?ink:dim);if(active){c.strokeStyle='#63865b';c.strokeRect(x-6,y+i*spacing-18,245,36);}}};
  const art=(x:number,y:number)=>{c.imageSmoothingEnabled=false;c.drawImage(sprite,x,y);};
  const brand=(x:number,y:number)=>{text('sommNI',x,y,26);text('ソムニ',x,y+27,14,dim);};
  const start=Math.max(0,Math.min(selection-2,3));
  switch(v.layout){
    case 0: brand(342,40);rows(22,40,6,36,Math.max(0,selection-5));art(334,94);break;
    case 1: brand(54,44);art(347,69);text(DESTINATIONS[selection],34,146,22);text(`${selection+1} / 7`,36,183,16,dim);text('Scroll to explore',34,222,16,dim);break;
    case 2: text('sommNI   /   ソムニ',24,27);c.strokeStyle=dim;c.beginPath();c.moveTo(291,60);c.lineTo(291,245);c.stroke();rows(24,83,5,35,Math.max(0,selection-4));art(345,75);break;
    case 3: brand(28,39);text('Your Winebrary',28,110,22);rows(28,158,3,36,Math.min(selection,4));art(355,70);break;
    case 4: text('sommNI   ソムニ',205,28);art(222,47);text(DESTINATIONS[selection],199,213,21);text('‹     Scroll to explore     ›',180,247,16,dim);break;
    case 5: brand(345,38);rows(24,55,5,40,Math.max(0,selection-4));art(340,98);break;
    case 6: art(60,77);brand(41,32);rows(277,49,6,35,Math.max(0,selection-5));break;
    case 7: brand(41,44);art(349,66);text(DESTINATIONS[selection],30,132,22);rows(30,183,2,37,Math.max(0,selection-1));break;
    case 8: text('sommNI / ソムニ',22,29);for(let i=0;i<5;i++){const n=(start+i)%7;text(`${String(n+1).padStart(2,'0')}   ${DESTINATIONS[n]}`,22,79+i*35,18,n===selection?ink:dim);}art(357,78);break;
    default: art(48,70);text('sommNI / ソムニ',274,35);rows(276,88,4,40,Math.max(0,selection-3));break;
  }
  text('2x: Exit',468,270,14,dim);
}
