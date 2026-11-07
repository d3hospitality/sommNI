const assert = require('node:assert/strict');
const { readdirSync } = require('node:fs');
const { resolve } = require('node:path');
// Loading each entry catches missing server dependencies before Vercel deploys.
// Handlers are never invoked: no accounts, payments or provider calls are made.
const entries = readdirSync(resolve(__dirname, '../api')).filter(name => name.endsWith('.js'));
assert(entries.length > 0);
for (const entry of entries) {
  assert.equal(typeof require(resolve(__dirname, '../api', entry)), 'function', entry);
}
// PDF parsing is lazy-loaded by the menu API, so check it explicitly as well.
import('unpdf').then(pdf => {
  assert.equal(typeof pdf.extractText, 'function');
  console.log(`PASS: ${entries.length} website API entrypoints and PDF parser load.`);
}).catch(error => { console.error(error); process.exitCode = 1; });
