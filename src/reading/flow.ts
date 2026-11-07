/** A continuous, overlapping reading window for hosts with a 999-byte text limit.
 * Native 2k buffers remain preferred. No chapter/page switching or omitted tail.
 */
export class ReadingFlow {
 readonly lines:string[]=[];readonly visible:number;index=0;
 constructor(text:string,width:number,height:number){
  const capacity=Math.max(8,Math.floor(width/11));this.visible=Math.max(1,Math.floor(height/27));
  const units=(s:string)=>[...s].reduce((n,c)=>n+(c===' '?.5:c.charCodeAt(0)>255?1.8:/[A-ZMW]/.test(c)?1.2:.85),0);
  for(const paragraph of text.split('\n')){
   if(!paragraph.trim()){this.lines.push('');continue;}
   let line='';
   for(const word of paragraph.trim().split(/\s+/)){
    if(line&&units(line+' '+word)>capacity){this.lines.push(line);line='';}
    for(const ch of (line?' ':'')+word){if(units(line+ch)>capacity){this.lines.push(line);line='';}line+=ch;}
   }
   if(line)this.lines.push(line);
  }
 }
 move(delta:number){this.index=Math.max(0,Math.min(Math.max(0,this.lines.length-this.visible),this.index+delta));}
 get content(){return this.lines.slice(this.index,this.index+this.visible).join('\n')||' ';}
}
