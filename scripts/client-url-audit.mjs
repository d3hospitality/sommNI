import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
/** Inspect shipped executable/data assets; license texts retain their original terms. */
export async function auditClientUrls(root,manifest='app.beta.json'){
 const app=JSON.parse(await readFile(manifest,'utf8'));
 const allowed=new Set(app.permissions.filter(p=>p.name==='network').flatMap(p=>p.whitelist).map(u=>new URL(u).origin));
 const violations=[],origins=new Set();let files=0;
 async function visit(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory()){await visit(p);continue;}if(!/\.(?:html|js|css|json|svg|webmanifest)$/i.test(p))continue;files++;
  const text=await readFile(p,'utf8');
  for(const match of text.matchAll(/https?:\/\/[^\s"'<>`\\)\]]+/g)){
   const url=match[0];if(url.startsWith('http://www.w3.org/'))continue; // SVG/XML namespaces are not network requests.
   let origin;try{origin=new URL(url).origin}catch{violations.push({file:p,url});continue;}
   if(!allowed.has(origin))violations.push({file:p,url});else origins.add(origin);
  }
 }}
 await visit(root);
 if(violations.length)throw Error('Unapproved client URLs:\n'+violations.map(v=>`${v.file}: ${v.url}`).join('\n'));
 return {files,origins:[...origins].sort(),unapproved:0};
}
if(process.argv[1]?.endsWith('/client-url-audit.mjs'))auditClientUrls(process.argv[2]||'dist-ehpk').then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
