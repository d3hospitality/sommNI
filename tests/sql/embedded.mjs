// Supplemental real PostgreSQL/WASM execution for environments denying SysV IPC.
// This does not replace the native multi-connection test:sql concurrency proof.
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = path.dirname(new URL(import.meta.url).pathname);
const db = new PGlite({ extensions: { pg_trgm } });
try {
 for (const f of [path.join(dir,'bootstrap.sql'), ...fs.readdirSync(path.join(dir,'baseline')).filter(f=>f.endsWith('.sql')).sort().map(f=>path.join(dir,'baseline',f)), ...fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort().map(f=>path.join('supabase/migrations',f))]) {
  await db.exec(fs.readFileSync(f,'utf8')); console.log('APPLIED embedded PostgreSQL:',path.basename(f));
 }
 assert.deepEqual((await db.query('select card from winelens_rate_cards order by version desc limit 1')).rows[0].card, JSON.parse(fs.readFileSync('shared/rate-card.json')));
 await db.exec(fs.readFileSync(path.join(dir,'assertions.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.join(dir,'assertions-ai.sql'),'utf8'));
 console.log('PASS: embedded PostgreSQL migrations and RPC/RLS assertions (native concurrency not tested)');
} finally { await db.close(); }
