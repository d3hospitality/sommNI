/** Gravity-vector tilt, independent of whether firmware reports g or m/s².
 * Axis convention follows the G2 level example: roll=atan2(y,z).
 * Calibrate when opening Home; this is a decorative response, not a head tracker.
 */
export interface GlassPose { roll:number; pitch:number }
const limit=(n:number,max:number)=>Math.max(-max,Math.min(max,n));
const wrap=(n:number)=>Math.atan2(Math.sin(n),Math.cos(n));
export class HeadTilt {
 private neutral:GlassPose|null=null;
 private smooth:GlassPose={roll:0,pitch:0};
 private magnitude=0;
 reset(){this.neutral=null;this.smooth={roll:0,pitch:0};this.magnitude=0;}
 sample(data:{x?:number;y?:number;z?:number}):GlassPose|null {
  const {x,y,z}=data;if(![x,y,z].every(v=>typeof v==='number'&&Number.isFinite(v)))return null;
  const norm=Math.hypot(x!,y!,z!);if(norm<.0001)return null;
  if(this.magnitude && (norm<this.magnitude*.6||norm>this.magnitude*1.5))return null;
  const pose={roll:Math.atan2(y!,z!),pitch:Math.atan2(-x!,Math.hypot(y!,z!))};
  if(!this.neutral){this.neutral=pose;this.magnitude=norm;return {roll:0,pitch:0};}
  this.magnitude=this.magnitude*.98+norm*.02;
  this.smooth.roll+=.32*(limit(wrap(pose.roll-this.neutral.roll),.4)-this.smooth.roll);
  this.smooth.pitch+=.32*(limit(wrap(pose.pitch-this.neutral.pitch),.25)-this.smooth.pitch);
  // Three-degree buckets suppress sensor noise and redundant image transfers.
  return {roll:Math.round(this.smooth.roll/.05)*.05,pitch:Math.round(this.smooth.pitch/.05)*.05};
 }
}
