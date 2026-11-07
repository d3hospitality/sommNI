import { Parser } from 'npm:htmlparser2@10.1.0';
import { Fault } from '../winelens-research/domain.ts';
/** Extract inert menu text, preserving headings and table columns. Never execute or follow page code. */
export function menuHtmlText(html:string){
 const ignored=new Set(['script','style','nav','header','footer','form','svg','template','noscript']);
 const blocks=new Set(['div','p','section','article','main','li','ul','ol','tr','br','h1','h2','h3','h4','h5','h6']);
 const chunks:string[]=[],wineChunks:string[]=[];let depth=0,skip=0,length=0,wineDepth=0;
 const append=(text:string)=>{length+=text.length;if(length>160000)throw new Fault(413,'This menu page is too long. Upload the wine pages separately.');chunks.push(text);if(wineDepth)wineChunks.push(text);};
 const parser=new Parser({
  onopentag(name,attrs){depth++;if(!skip&&!wineDepth&&/^(?:wine[-_ ]?(?:list|menu)|wines)$/i.test(attrs.id||''))wineDepth=depth;if(skip)return;if(ignored.has(name)){skip=depth;return;}if(blocks.has(name))append('\n');if(/^h[1-3]$/.test(name))append('## ');if(/^h[4-6]$/.test(name))append('- ');if(name==='td'||name==='th')append(' | ');},
  ontext(text){if(!skip)append(text.replace(/\s+/g,' '));},
  onclosetag(name){if(skip===depth)skip=0;else if(!skip&&blocks.has(name))append('\n');if(wineDepth===depth)wineDepth=0;depth--;},
 },{decodeEntities:true});
 parser.write(html);parser.end();
 const text=(wineChunks.length?wineChunks:chunks).join('').split('\n').map(s=>s.trim()).filter(Boolean).join('\n').replace(/https?:\/\/\S+/gi,'');
 if(text.length<40)throw new Fault(422,'This page has no readable menu text. Upload its PDF or a photo of the wine list.');
 return text;
}

/** Keep wine labels with their following origin/year; carry section headings across chunks. */
export function menuTextChunks(text:string){
 if(text.length<=5000)return [text];
 const parts=text.split(/\n(?=(?:- |## ))/),chunks:string[]=[];let chunk='',heading='';
 for(const part of parts){
  if(part.length>12000)throw new Fault(422,'This menu has no readable section breaks. Upload its wine pages separately.');
  if(chunk&&chunk.length+part.length>5000){chunks.push(chunk);chunk=heading?heading+'\n':'';}
  chunk+=part+'\n';if(part.startsWith('## '))heading=part.split('\n')[0];
 }
 if(chunk.trim())chunks.push(chunk.trim());
 if(chunks.length>8)throw new Fault(413,'This menu is too long for one import. Upload the wine sections separately.');
 return chunks;
}
