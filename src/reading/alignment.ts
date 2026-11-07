export interface ReadingSection { label: string; text: string; context?: string; source?: {title:string;url:string} }
export interface ReadingWord { text: string; key: string; section: number; start: number; end: number }
export const normalizeWord=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function readingWords(sections:ReadingSection[]):ReadingWord[] {
 return sections.flatMap((section,index)=>Array.from(section.text.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu),m=>({text:m[0],key:normalizeWord(m[0]),section:index,start:m.index!,end:m.index!+m[0].length}))).filter(w=>w.key);
}
function matches(a:string,b:string):boolean {
 if(a===b)return true;
 if(a.length<5||b.length<5||Math.abs(a.length-b.length)>1)return false;
 let i=0,j=0,edits=0;
 while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue;}if(++edits>1)return false;if(a.length>=b.length)i++;if(b.length>=a.length)j++;}
 return edits+(a.length-i)+(b.length-j)<=1;
}
/** Local alignment only: recognition supplies words, never instructions or a synthetic reading pace. */
export class ReadingFollower {
 readonly words:ReadingWord[];
 cursor=0;
 private segment=''; private anchor=0; private last='';
 constructor(sections:ReadingSection[]){this.words=readingWords(sections);}
 seek(index:number){this.cursor=Math.max(0,Math.min(this.words.length,index));this.segment='';this.anchor=this.cursor;this.last='';}
 hear(transcript:string,segment:string):number {
  const heard=readingWords([{label:'',text:transcript}]).map(w=>w.key).slice(-36);
  const signature=heard.join(' ');if(!signature||signature===this.last)return this.cursor;
  this.last=signature;
  if(this.cursor>0&&this.cursor===this.words.length-1&&heard.length===1&&heard[0]===this.words[this.cursor].key&&heard[0].length>=3){this.cursor++;return this.cursor;}
  if(segment!==this.segment){this.segment=segment;this.anchor=this.cursor;}
  const from=Math.max(0,this.anchor-8,this.cursor-40),to=Math.min(this.words.length,this.cursor+48);
  let best={score:-Infinity,end:this.cursor,count:0};
  for(let s=from;s<Math.min(to,this.cursor+14);s++)for(let h=0;h<Math.min(heard.length,8);h++){
   if(!matches(this.words[s].key,heard[h]))continue;
   let pos=s+1,count=1,long=(this.words[s].key.length>=4||/[^a-z0-9]/.test(this.words[s].key))?1:0,last=s;
   for(let k=h+1;k<heard.length;k++){
    let found=-1;for(let j=pos;j<Math.min(pos+5,to);j++)if(matches(this.words[j].key,heard[k])){found=j;break;}
    if(found<0)continue;
    count++;if(this.words[found].key.length>=4||/[^a-z0-9]/.test(this.words[found].key))long++;last=found;pos=found+1;
   }
   const span=last-s+1,coverage=count/(heard.length-h);
   if(count<(/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(this.words[s].key)?4:2)||!long||coverage<.55||count/span<.5)continue;
   const score=count*4-(span-count)*1.1-Math.abs(s-this.anchor)*.16-h*.8;
   if(score>best.score)best={score,end:last+1,count};
  }
  if(best.count>=2&&best.end>this.cursor)this.cursor=best.end;
  return this.cursor;
 }
 get progress(){return this.words.length?this.cursor/this.words.length:0;}
 get done(){return this.words.length>0&&this.cursor===this.words.length;}
}
