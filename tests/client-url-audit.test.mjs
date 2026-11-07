import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditClientUrls} from '../scripts/client-url-audit.mjs';
const dir=await mkdtemp(join(tmpdir(),'sommni-url-audit-'));
try{
 await writeFile(join(dir,'app.js'),'const endpoint="https://mcmtasetompygfktzhpr.supabase.co/functions/v1/winelens-beta";');
 assert.equal((await auditClientUrls(dir)).unapproved,0);
 await writeFile(join(dir,'leak.json'),JSON.stringify({sources:[{url:'https://producer.example/wine?utm_source=openai'}]}));
 await assert.rejects(auditClientUrls(dir),/producer.example/);
 await rm(join(dir,'leak.json'));
 await writeFile(join(dir,'review.html'),'<a href="https://external.example/research">Reference</a>');
 await assert.rejects(auditClientUrls(dir),/external.example/);
 const anecdotes=JSON.parse(await readFile('src/data/catalog-anecdotes.json','utf8'));
 assert.equal(anecdotes.length,215);assert.equal(/https?:\/\//.test(JSON.stringify(anecdotes)),false);
 const archive=await readFile('backend/research-evidence/src/data/catalog-anecdotes.json','utf8');
 assert.ok(archive.includes('https://'),'private research evidence preserved');
 console.log('PASS: approved assets pass, research JSON and HTML URLs fail, 215 URL-free anecdotes retain private evidence.');
}finally{await rm(dir,{recursive:true,force:true});}
