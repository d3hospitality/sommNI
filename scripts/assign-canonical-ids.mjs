// Assign immutable canonical wine IDs (PRD I-01).
//
//   node --experimental-strip-types scripts/assign-canonical-ids.mjs          # check only
//   node --experimental-strip-types scripts/assign-canonical-ids.mjs --write  # add IDs for new wines
//
// Rules:
//  - An ID, once written to src/data/catalog-identity.json, is never changed or reused.
//  - Wines are matched by their catalog key "Type|Country|Name", never by position.
//  - The legacy positional map (w0…w214) is frozen at the first run and never regenerated:
//    it is the lossless bridge for data stored before canonical IDs existed.
//  - A renamed wine appears as a new key: it gets a new ID and the old entry is kept
//    (status "retired") so nothing that referenced it is silently re-pointed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'src/data/catalog-identity.json');
const C = await import(path.join(root, 'src/constants.ts'));

const keys = [];
for (const type of C.WINE_TYPES) for (const country of C.COUNTRIES[type]) for (const wine of C.WINES[type]?.[country] || []) keys.push(`${type}|${country}|${wine.name}`);

const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 56).replace(/-+$/, '');

const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
const data = existing ?? { version: 1, frozen_legacy_at: new Date().toISOString().slice(0, 10), entries: [] };
const byKey = new Map(data.entries.map(e => [e.key, e]));
const used = new Set(data.entries.map(e => e.id));
const added = [];
keys.forEach((key, index) => {
  if (byKey.has(key)) return;
  const name = key.split('|').slice(2).join('|');
  let id = 'wl_' + slug(name), n = 2;
  while (used.has(id)) id = `wl_${slug(name)}-${n++}`;
  used.add(id);
  // Only the first run records positional legacy IDs; later additions never get one.
  const entry = { id, key, legacy_id: existing ? null : `w${index}`, status: 'active' };
  data.entries.push(entry); byKey.set(key, entry); added.push(entry);
});
const live = new Set(keys);
const retired = data.entries.filter(e => !live.has(e.key) && e.status !== 'retired');
for (const e of retired) e.status = 'retired';

const problems = [];
if (new Set(data.entries.map(e => e.id)).size !== data.entries.length) problems.push('duplicate canonical IDs');
const legacy = data.entries.filter(e => e.legacy_id).map(e => e.legacy_id);
if (new Set(legacy).size !== legacy.length) problems.push('duplicate legacy IDs');
console.log(JSON.stringify({ catalog: keys.length, entries: data.entries.length, added: added.length, retired: retired.length, legacy: legacy.length, problems }));
if (problems.length) process.exit(1);
if (process.argv.includes('--write')) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
} else if (added.length || retired.length) {
  console.error('Catalog identity is out of date; run with --write and review the diff.');
  process.exit(1);
}
