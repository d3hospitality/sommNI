/** Degrees per second. Analytic decay keeps the same glide at any drawing cadence. */
export class OrbitMotion {
 spinning=true;
 velocity:[number,number]=[0,0];
 private last:number|null=null;
 resetClock(){this.last=null;}
 stop(){this.spinning=false;this.velocity=[0,0];this.resetClock();}
 release(dx:number,dy:number,seconds:number){const dt=Math.max(.008,seconds);this.velocity=[Math.max(-45,Math.min(45,dx/dt)),Math.max(-25,Math.min(25,dy/dt))];this.resetClock();}
 get active(){return this.spinning||Math.hypot(...this.velocity)>.015;}
 step(time:number):[number,number]{
  if(this.last===null){this.last=time;return [0,0];}
  const dt=Math.min(.1,Math.max(0,(time-this.last)/1000));this.last=time;
  const decay=Math.exp(-1.15*dt),travel=(1-decay)/1.15;
  const delta:[number,number]=[this.velocity[0]*travel+(this.spinning?3*dt:0),this.velocity[1]*travel];
  this.velocity=[this.velocity[0]*decay,this.velocity[1]*decay];
  if(Math.hypot(...this.velocity)<.015)this.velocity=[0,0];return delta;
 }
}
