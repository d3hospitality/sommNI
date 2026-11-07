// Match spoken place names against existing geography; never invent a destination.
const aliases:Record<string,string>={burgandy:'burgundy',bordo:'bordeaux',nippon:'japan',nihon:'japan',piemonte:'piedmont',toscana:'tuscany',sicilia:'sicily',puglia:'apulia',lombardia:'lombardy',bourgogne:'burgundy',italia:'italy',espana:'spain',deutschland:'germany',francia:'france',sudtirol:'alto adige'};
export function normalizePlace(value:string):string {
 return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\b[a-z]+\b/g,word=>aliases[word]??word);
}
const filler=new Set('show me find search for sake prefecture prefectures wines wine region regions country countries from in the please go to take of'.split(' '));
export function placeSearchScore(name:string,query:string,context=''):number {
 const tokens=normalizePlace(query).split(' ').filter(t=>t&&!filler.has(t));if(!tokens.length)return 0;
 const label=normalizePlace(name),all=normalizePlace(name+' '+context),words=all.split(' ');
 if(!tokens.every(t=>words.some(w=>w.startsWith(t))))return 0;
 const phrase=tokens.join(' ');
 return label===phrase?100:label.startsWith(phrase)?80:label.includes(phrase)?60:20;
}
