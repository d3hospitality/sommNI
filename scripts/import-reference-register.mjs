// Import approved claims from the wine reference register into src/data/references.json (PRD R-01…R-03).
//
//   node scripts/import-reference-register.mjs <wine-reference-register.json> [--write]
//
// Only claims with review_status "approved-pilot" are imported; everything else stays in the register.
// Values are copied verbatim (null stays null). Nothing is inferred, completed or averaged.
// Hand-authored study cards live in src/data/study-cards.json and must cite claim IDs from this file.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [registerPath] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!registerPath) { console.error('usage: import-reference-register.mjs <register.json> [--write]'); process.exit(2); }
const register = JSON.parse(fs.readFileSync(registerPath, 'utf8'));
const identity = JSON.parse(fs.readFileSync(path.join(root, 'src/data/catalog-identity.json'), 'utf8'));
const canonical = new Map(identity.entries.filter(e => e.legacy_id).map(e => [e.legacy_id, e.id]));

// Publisher names are editorial metadata for display; keep them next to the host they describe.
const PUBLISHERS = {
  'www.cainfive.com': { publisher: 'Cain Vineyard & Winery', kind: 'producer-technical-sheet', title: 'Cain Cuvée NV14 fact sheet' },
  'ixsir.com': { publisher: 'IXSIR', kind: 'producer-technical-sheet', title: 'Grande Réserve Rosé 2023 technical sheet' },
  'tenuta-cafaggiolo.com': { publisher: 'Tenuta Cafaggiolo', kind: 'producer-product-page', title: 'Pater Patriae product page' },
};
const shortHash = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 10);

const sources = new Map(), releases = new Map(), claims = [], openItems = [];
for (const row of register.rows) {
  const wineId = canonical.get(row.legacy_id);
  if (!wineId) throw new Error(`No canonical ID for ${row.legacy_id}`);
  for (const q of row.open_questions || []) openItems.push({ wine_id: wineId, legacy_id: row.legacy_id, status: 'unresolved', note: q });
  for (const c of row.claims || []) {
    if (c.review_status !== 'approved-pilot') continue;
    const host = new URL(c.source_url).host;
    const meta = PUBLISHERS[host];
    if (!meta) throw new Error(`Add publisher metadata for ${host}`);
    const sourceId = `src_${shortHash(c.source_url + c.source_sha256)}`;
    sources.set(sourceId, { id: sourceId, ...meta, url: c.source_url, retrieved_at: c.retrieved_at, sha256: c.source_sha256, availability: 'available', image_rights: 'not-assessed' });
    let releaseId = null;
    if (c.release_scope) {
      releaseId = `rel_${wineId.slice(3)}_${c.release_scope.toLowerCase()}`;
      const r = releases.get(releaseId) || { id: releaseId, wine_id: wineId, scope: c.release_scope, vintage_state: null, year: null, release_code: null };
      if (c.field === 'vintage_state') r.vintage_state = c.value;
      if (c.field === 'release_code') r.release_code = c.value;
      if (c.field === 'vintage_year') { r.year = c.value; r.vintage_state = 'year'; }
      releases.set(releaseId, r);
    }
    claims.push({
      id: `clm_${wineId.slice(3)}_${(c.release_scope || 'wine').toLowerCase()}_${c.field}`,
      wine_id: wineId, release_id: releaseId, field: c.field, value: c.value, unit: null,
      source_id: sourceId, locator: c.source_locator, status: 'approved',
      reviewer: c.reviewer, reviewed_at: c.retrieved_at, revision: 1, note: c.note,
    });
  }
}
const out = {
  version: 1,
  generated_from: { file: path.basename(registerPath), checked_at: register.checked_at, catalog_records: register.catalog_records },
  sources: [...sources.values()], releases: [...releases.values()], claims, open_items: openItems,
};
const ids = claims.map(c => c.id);
if (new Set(ids).size !== ids.length) throw new Error('duplicate claim IDs');
console.log(JSON.stringify({ sources: out.sources.length, releases: out.releases.length, claims: claims.length, open_items: openItems.length }));
if (process.argv.includes('--write')) fs.writeFileSync(path.join(root, 'src/data/references.json'), JSON.stringify(out, null, 1) + '\n');
