/** Fixed-volume, three-dimensional modal slosh for the design playground.
 * Gravity sets the resting plane. Angular changes excite damped surface modes.
 * This is a real-time visual approximation, not a Navier–Stokes/CFD solver.
 * Coordinates: bowl bottom y=0, lip y=1. All dimensions use bowl height.
 */
export interface Vessel {
  id: string; name: string; subtitle: string; description: string; home: string;
  profile: [number, number][]; stem: number; foot: number; fill: number;
  accent: string; paper: string; ink: string; layout: number; finish?: 'fluted' | 'cut' | 'smoke';
}
export const APERTURE:Vessel={id:'01',name:'Aperture',subtitle:'The precision tulip',description:'A fine rim, an elongated bowl, a barely-there stem. The wine becomes the focal point.',home:'A quiet split home. Your next action on the left; a responsive glass on the right.',profile:[[0,.025],[.12,.24],[.35,.37],[.62,.34],[1,.235]],stem:.69,foot:.30,fill:.36,accent:'#732b3e',paper:'#eeeae3',ink:'#302e2b',layout:0};
export const VESSELS: Vessel[] = [
  APERTURE,
  {id:'02',name:'Kyoto',subtitle:'A quiet tasting cup',description:'A low, rounded cup with a thick crystal heel. Smaller movements read like ripples in a still pond.',home:'Centered Japanese identity, one focused action, and a compact navigation rail.',profile:[[0,.17],[.08,.33],[.38,.41],[.7,.38],[1,.30]],stem:0,foot:.20,fill:.42,accent:'#675e48',paper:'#e8e5dc',ink:'#34382e',layout:1},
  {id:'03',name:'Prism',subtitle:'Cut crystal, drawn in light',description:'A straight shoulder and a precise angular bowl. Facets break the reflections into quiet bands.',home:'An architectural sidebar with one clear active row and a generous object panel.',profile:[[0,.025],[.23,.37],[.56,.35],[1,.27]],stem:.72,foot:.31,fill:.35,accent:'#586783',paper:'#e5e9ee',ink:'#29313e',layout:2,finish:'cut'},
  {id:'04',name:'Burgundy',subtitle:'The generous one',description:'A wide balloon bowl, a delicate mouth, deep wine. A broad surface makes the rolling liquid easy to read.',home:'An editorial welcome with the library in focus and a large glass beside it.',profile:[[0,.025],[.17,.35],[.46,.50],[.72,.44],[1,.29]],stem:.62,foot:.32,fill:.33,accent:'#752e43',paper:'#eddfdf',ink:'#442c34',layout:3},
  {id:'05',name:'Orbit',subtitle:'A coupe with a slower rhythm',description:'A shallow, open bowl on a long stem. The surface stretches into an ellipse; each tilt travels across it.',home:'A centered object above a simple three-action rail. Almost all negative space.',profile:[[0,.035],[.14,.45],[.44,.74],[.73,.82],[1,.84]],stem:1.05,foot:.52,fill:.40,accent:'#7a644b',paper:'#ede4d8',ink:'#443a32',layout:4},
  {id:'06',name:'Nocturne',subtitle:'Smoked glass after dark',description:'A narrow, weighty silhouette with smoky reflections. A thin ruby edge reveals the depth of the wine.',home:'A dark companion home, restrained illumination, and an uncluttered reading-first menu.',profile:[[0,.03],[.14,.25],[.4,.32],[.8,.29],[1,.22]],stem:.52,foot:.27,fill:.42,accent:'#c58c96',paper:'#24262a',ink:'#eee8df',layout:5,finish:'smoke'},
  {id:'07',name:'Reed',subtitle:'Vertical, light, almost weightless',description:'An exceptionally tall flute with a small liquid surface. The silhouette gives the screen a clean vertical accent.',home:'A narrow glass spine alongside a compact stack of destinations.',profile:[[0,.018],[.12,.15],[.48,.20],[.8,.185],[1,.155]],stem:.43,foot:.20,fill:.39,accent:'#626b45',paper:'#e7e9db',ink:'#343a2d',layout:6},
  {id:'08',name:'Halo',subtitle:'A soft bowl. A sculptural stem.',description:'A rounded bowl balanced on a short, thick stem. The luminous foot gives the object a distinct center of gravity.',home:'A soft central composition with a featured destination and a short navigation list.',profile:[[0,.07],[.12,.30],[.42,.45],[.72,.43],[1,.32]],stem:.30,foot:.37,fill:.37,accent:'#8c5e4b',paper:'#eee1d7',ink:'#49352e',layout:7},
  {id:'09',name:'Ribbed',subtitle:'Texture without the noise',description:'Fine vertical ribs catch long reflections. The bowl stays simple; the material carries the personality.',home:'A numbered directory with a tactile glass. Crisp hierarchy, generous breathing room.',profile:[[0,.08],[.10,.31],[.55,.35],[1,.29]],stem:.54,foot:.30,fill:.39,accent:'#596b70',paper:'#e0e9e7',ink:'#2e3d40',layout:8,finish:'fluted'},
  {id:'10',name:'Lens',subtitle:'The modern tasting vessel',description:'A broad stemless bowl with a generous, grounded heel. The simplest silhouette leaves room for the liquid to perform.',home:'A horizontal tasting desk: an oversized vessel, your library, and one suggested next step.',profile:[[0,.18],[.08,.39],[.38,.48],[.72,.43],[1,.31]],stem:0,foot:.28,fill:.37,accent:'#756580',paper:'#e7e1eb',ink:'#3d3445',layout:9},
];
export function radiusAt(v:Vessel,y:number){
  y=Math.max(0,Math.min(1,y)); const p=v.profile;
  let i=0;while(i<p.length-2&&p[i+1][0]<y)i++;
  const [a,ra]=p[i],[b,rb]=p[i+1],t=(y-a)/(b-a);
  if(v.finish==='cut')return ra+(rb-ra)*t;
  // Monotone cubic interpolation: continuous tangents, with no scalloped anchors
  // or radius overshoot. A zero tangent is used only at a true radius extremum.
  const slope=(k:number)=>(p[k+1][1]-p[k][1])/(p[k+1][0]-p[k][0]);
  const tangent=(k:number)=>{
    if(k===0)return slope(0);if(k===p.length-1)return slope(k-1);
    const left=slope(k-1),right=slope(k);if(left*right<=0)return 0;
    const h0=p[k][0]-p[k-1][0],h1=p[k+1][0]-p[k][0],w1=2*h1+h0,w2=h1+2*h0;
    return (w1+w2)/(w1/left+w2/right);
  };
  return (2*t**3-3*t*t+1)*ra+(t**3-2*t*t+t)*(b-a)*tangent(i)+(-2*t**3+3*t*t)*rb+(t**3-t*t)*(b-a)*tangent(i+1);
}
const clamp=(n:number,m:number)=>Math.min(m,Math.max(-m,n));
export interface Pose { roll:number; pitch:number }
export interface Surface { level:number; sx:number; sz:number; modes:number[]; radius:number; volumeError:number }
interface Column {x:number;z:number;bottom:number;top:number;area:number}
export class Liquid {
  readonly vessel:Vessel; readonly columns:Column[]=[]; readonly volume:number; readonly radius:number;
  pose:Pose={roll:0,pitch:0}; sx=0;sz=0;vx=0;vz=0;
  modes=[0,0,0,0]; speeds=[0,0,0,0]; private last=0; private remainder=0;
  constructor(v:Vessel){
    this.vessel=v;this.radius=Math.max(...v.profile.map(p=>p[1]));
    const n=30,dx=2*this.radius/n;
    for(let i=0;i<n;i++)for(let j=0;j<n;j++){
      const x=-this.radius+(i+.5)*dx,z=-this.radius+(j+.5)*dx,r=Math.hypot(x,z);
      let bottom=2,top=-1;
      for(let k=0;k<160;k++){const y=(k+.5)/160;if(r<=radiusAt(v,y)){bottom=Math.min(bottom,k/160);top=(k+1)/160;}}
      if(top>bottom)this.columns.push({x,z,bottom,top,area:dx*dx});
    }
    const capacity=this.columns.reduce((s,c)=>s+(c.top-c.bottom)*c.area,0);
    this.volume=capacity*v.fill;
  }
  reset(now=0){this.pose={roll:0,pitch:0};this.sx=this.sz=this.vx=this.vz=0;this.modes.fill(0);this.speeds.fill(0);this.last=now;this.remainder=0;}
  setPose(pose:Pose,now:number){
    if(!Number.isFinite(now)||now<this.last||!Number.isFinite(pose.roll)||!Number.isFinite(pose.pitch))return;
    this.advance(now);
    const next={roll:clamp(pose.roll,.38),pitch:clamp(pose.pitch,.25)},dr=next.roll-this.pose.roll,dp=next.pitch-this.pose.pitch;
    this.speeds[0]=clamp(this.speeds[0]+dr*1.1,1.3);
    this.speeds[1]=clamp(this.speeds[1]-dp*.9,1.1);
    this.speeds[2]=clamp(this.speeds[2]+dr*.28+dp*.22,.6);
    this.speeds[3]=clamp(this.speeds[3]+dr*.16-dp*.24,.5);
    this.pose=next;
  }
  advance(now:number){
    if(!Number.isFinite(now)||now<this.last)return;
    const elapsed=(now-this.last)/1000;this.last=now;
    // A resumed, hidden tab should not replay stale motion or launch a huge solver loop.
    if(elapsed>3){this.sx=-Math.tan(this.pose.roll);this.sz=Math.tan(this.pose.pitch);this.vx=this.vz=0;this.modes.fill(0);this.speeds.fill(0);this.remainder=0;return;}
    this.remainder+=elapsed;const dt=1/180;
    const frequency=4.4/Math.sqrt(this.radius/.4),tx=-Math.tan(this.pose.roll),tz=Math.tan(this.pose.pitch);
    while(this.remainder>=dt){
      this.remainder-=dt;
      this.vx+=((tx-this.sx)*frequency**2-2.7*this.vx)*dt;this.sx+=this.vx*dt;
      this.vz+=((tz-this.sz)*frequency**2-2.9*this.vz)*dt;this.sz+=this.vz*dt;
      for(let k=0;k<4;k++){
        const w=frequency*(1.3+k*.52),drag=1.7+k*.65;
        // Weak mode coupling makes a reversing slosh asymmetric without random noise.
        const coupling=k===2?.12*this.vx*this.vz:0;
        this.speeds[k]+=(-w*w*this.modes[k]-drag*this.speeds[k]+coupling)*dt;
        this.modes[k]+=this.speeds[k]*dt;
      }
    }
    if(!this.active()){this.sx=tx;this.sz=tz;this.vx=this.vz=0;this.modes.fill(0);this.speeds.fill(0);}
  }
  active(){return Math.abs(this.sx+Math.tan(this.pose.roll))>.0003||Math.abs(this.sz-Math.tan(this.pose.pitch))>.0003||Math.abs(this.vx)+Math.abs(this.vz)>.001||this.modes.some((v,i)=>Math.abs(v)>.00015||Math.abs(this.speeds[i])>.001);}
  surface():Surface{
    const state:Surface={level:0,sx:this.sx,sz:this.sz,modes:[...this.modes],radius:this.radius,volumeError:0};
    const offsets=this.columns.map(c=>heightAt(state,c.x,c.z));
    let low=-1,high=2;
    for(let pass=0;pass<22;pass++){
      const level=(low+high)/2,volume=this.columns.reduce((sum,c,i)=>sum+Math.max(0,Math.min(c.top,level+offsets[i])-c.bottom)*c.area,0);
      if(volume<this.volume)low=level;else high=level;
    }
    state.level=(low+high)/2;
    const actual=this.columns.reduce((s,c,i)=>s+Math.max(0,Math.min(c.top,state.level+offsets[i])-c.bottom)*c.area,0);
    state.volumeError=Math.abs(actual-this.volume)/this.volume;return state;
  }
}
export function heightAt(s:Surface,x:number,z:number){
  const u=x/s.radius,v=z/s.radius;
  return s.level+s.sx*x+s.sz*z+s.modes[0]*Math.sin(u*1.8)+s.modes[1]*Math.sin(v*2.1)+s.modes[2]*Math.cos(u*3.2)*Math.sin(v*2.6)+s.modes[3]*Math.sin(u*4.8+v*2.2);
}
