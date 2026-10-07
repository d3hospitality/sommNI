const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..'), bin = process.env.WL_PG_BIN || '/opt/homebrew/bin';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'winelens-sql-'));
let started = false;
(async () => {
 const listener = net.createServer(); await new Promise(r => listener.listen(0,'127.0.0.1',r));
 const port = listener.address().port; await new Promise(r => listener.close(r));
 const run = (cmd, args) => execFileSync(path.join(bin,cmd),args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const args = ['-X','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres'];
 const sql = text => run('psql',[...args,'-Atc',text]);
 try {
  run('initdb',['-D',path.join(temp,'db'),'-U','postgres','-A','trust','--no-locale','--encoding=UTF8','-c','shared_memory_type=mmap','-c','dynamic_shared_memory_type=posix']);
  run('pg_ctl',['-D',path.join(temp,'db'),'-l',path.join(temp,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -k ${temp}`,'-w','start']); started=true;
  const files = [path.join(__dirname,'bootstrap.sql'), ...fs.readdirSync(path.join(__dirname,'baseline')).filter(f=>f.endsWith('.sql')).sort().map(f=>path.join(__dirname,'baseline',f)), ...fs.readdirSync(path.join(root,'supabase/migrations')).filter(f=>f.endsWith('.sql')).sort().map(f=>path.join(root,'supabase/migrations',f))];
  for(const file of files) { run('psql',[...args,'-f',file]); console.log('APPLIED locally:',path.relative(root,file)); }
  // The current (latest) card must match the bundled card; v1 stays immutable for history and pack grants.
  assert.deepEqual(JSON.parse(sql('select card from winelens_rate_cards order by version desc limit 1')),require('../../shared/rate-card.json'));
  run('psql',[...args,'-f',path.join(__dirname,'assertions.sql')]);
  run('psql',[...args,'-f',path.join(__dirname,'assertions-ai.sql')]);
  // Independent connections prove locks prevent allowance overspend and grant races.
  const u='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; sql(`insert into auth.users(id) values('${u}')`);
  const results=await Promise.all(Array.from({length:12},(_,i)=>promisify(execFile)(path.join(bin,'psql'),[...args,'-Atc',`set role service_role; select winelens_reserve_usage('${u}','race-${i}','label_scan',1,false);`])));
  assert.equal(results.filter(r=>r.stdout.includes('"allowed": true')).length,5);
  await Promise.all(Array.from({length:8},()=>promisify(execFile)(path.join(bin,'psql'),[...args,'-Atc',`set role service_role; select winelens_grant_tokens('${u}','cs_concurrent','t5',100);`])));
  assert.equal(sql(`select units from winelens_token_wallets where user_id='${u}'`).trim(),'100');
  const c='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; sql(`insert into auth.users(id) values('${c}'); select wl_issue_code('${c}',repeat('b',64));`);
  const claims=await Promise.all(Array.from({length:8},(_,i)=>promisify(execFile)(path.join(bin,'psql'),[...args,'-Atc',`set role service_role; select wl_claim_code(repeat('b',64),md5('race-${i}')||md5('race-${i}'));`])));
  assert.equal(claims.filter(r=>r.stdout.includes('"status": "claimed"')).length,1);
  console.log('PASS: real migrations, rate-card parity, Winebrary storage/study, paid AI jobs, pairing/account RPCs, tokens, RLS, JWT scope/receipt, concurrent reserve/grant/claim');
 } finally { if(started) run('pg_ctl',['-D',path.join(temp,'db'),'-m','immediate','-w','stop']); fs.rmSync(temp,{recursive:true,force:true}); }
})().catch(e=>{ console.error(e.stderr?.toString() || e.message); process.exitCode=1; });
