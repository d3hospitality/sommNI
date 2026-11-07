type SavedWine={wine_name:string;producer?:string|null;vintage?:number|null;metadata?:Record<string,any>|null};
const norm=(s:string)=>s.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function identity(text:string){
 const year=text.match(/\b(?:18|19|20)\d{2}\b/g)||[];
 const vintage=year.length===1?year[0]:/\bN[.\s/-]?V\b/i.test(text)?'NV':'';
 const words=norm(text.replace(/\b(?:18|19|20)\d{2}\b/g,'').replace(/\bN[.\s/-]?V\b/gi,'')).split(' ').filter(Boolean);
 return {name:words.sort().join(' '),vintage};
}
/** Conservative preflight. Research/save performs the final canonical identity check. */
export function menuDuplicate(query:string,wines:SavedWine[]):'existing'|'possible'|''{
 const input=identity(query);if(!input.name)return '';
 let possible=false;
 for(const wine of wines){
  const producer=norm(wine.producer||''),name=norm(wine.wine_name);
  const combined=producer&&!((' '+name+' ').includes(' '+producer+' '))?producer+' '+name:name;
  const candidate=identity(combined);
  if(input.name!==candidate.name)continue;
  const vintage=wine.vintage?String(wine.vintage):wine.metadata?.vintage_state==='non_vintage'?'NV':'';
  if(input.vintage===vintage)return 'existing';
  if(!input.vintage||!vintage)possible=true;
 }
 return possible?'possible':'';
}
