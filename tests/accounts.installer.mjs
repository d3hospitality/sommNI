import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const target=fs.mkdtempSync(path.join(os.tmpdir(),'winelens-api-gate-'));
const fixture=`// Preserve this existing comment and unrelated work.\nconst handler = async (req, res) => {\n  const user = await requireAuth(req, res);\n  if (!user || !rateLimit(req, res, { limit: 6 })) return;\n  await reserveQuota();\n  await callOpenAI();\n};\n`;
fs.mkdirSync(path.join(target,'api/_lib'),{recursive:true});fs.writeFileSync(path.join(target,'api/generate-bottle.js'),fixture);
const install=()=>execFileSync(process.execPath,['integrations/sommni-api/install.mjs',target],{stdio:'pipe'});
try{
 install();const once=fs.readFileSync(path.join(target,'api/generate-bottle.js'),'utf8');
 assert.ok(once.includes('// Preserve this existing comment and unrelated work.'));
 assert.ok(once.indexOf('await requireBottleStudioPro') < once.indexOf('await reserveQuota'));
 assert.ok(once.indexOf('await requireBottleStudioPro') < once.indexOf('await callOpenAI'));
 install();assert.equal(fs.readFileSync(path.join(target,'api/generate-bottle.js'),'utf8'),once);
 fs.writeFileSync(path.join(target,'api/_lib/billing.js'),'// Owner has edited this helper');assert.throws(install);
 assert.equal(fs.readFileSync(path.join(target,'api/_lib/billing.js'),'utf8'),'// Owner has edited this helper');
 console.log('PASS: API installer places paid check before quota/provider calls, preserves unrelated work, is repeatable, and refuses conflicting edits.');
}finally{fs.rmSync(target,{recursive:true,force:true})}
