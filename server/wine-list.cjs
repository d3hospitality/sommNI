// Wine lists → clean wines. POST /api/wine-list with an action:
//   inspect  {pdf}                              free: text layer of a PDF (scans are refused: send photos)
//   read     {kind:'photos', pages[] | kind:'text', text, source, request_id, spend_consent}
//            paid: photo pages (wine_list_page) or 6,000-character text pages (wine_list_text)
//   csv      {text}                             free: spreadsheet columns, no AI
//   upload   {upload_id}                        reopen a reviewed list
//   commit   {upload_id, entries[]}             save the reviewed wines to Winebrary, propose new ones
// Every wine goes through wine-identity.cjs: catalog match, globe place, shared-notes key.
const { randomUUID } = require('node:crypto');
const OpenAI = require('openai');
const { endpoint, rpc, only, HttpError, UNAVAILABLE } = require('./service.cjs');
const { userDb, wineFields, UUID } = require('./winebrary.cjs');
const { runJob } = require('./ai-jobs.cjs');
const { resolveEntry, bottleKey, wineKey, catalogById, sha, norm } = require('./wine-identity.cjs');
const { LIST_SYSTEM, LIST_SCHEMA, LIST_COLORS } = require('../prompts/winelens-ai.cjs');
// Vercel caps a request body at 4.5 MB: the phone compresses page photos (~450 KB each) before sending.
const MAX_PHOTO = 2 * 1024 * 1024, MAX_PHOTOS = 6, TEXT_PAGE = 6000, MAX_TEXT = 60000, MAX_PDF = 3 * 1024 * 1024, MAX_BODY = Math.floor(4.4 * 1024 * 1024), MAX_ENTRIES = 300, MAX_WINES = 2000;

function photoBytes(dataUrl) {
  const m = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!m) throw new HttpError(400, 'Each page must be a PNG, JPEG or WebP photo.');
  const bytes = Buffer.from(m[2], 'base64');
  if (!bytes.length || bytes.length > MAX_PHOTO) throw new HttpError(413, 'Each page photo must be under 2 MB.');
  const ok = m[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : m[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!ok) throw new HttpError(400, 'A page photo does not match its type.');
  return bytes;
}
/** Text pages break at line ends, never inside a wine's line. */
function textPages(text) {
  const pages = []; let page = '';
  for (const line of text.split('\n')) {
    if (page && page.length + line.length + 1 > TEXT_PAGE) { pages.push(page); page = ''; }
    page += (page ? '\n' : '') + line.slice(0, TEXT_PAGE);
  }
  if (page.trim()) pages.push(page);
  return pages;
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } }));
  return out;
}
const str = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';
function validItem(item) {
  if (!item || typeof item !== 'object') return null;
  const v = item.vintage, year = new Date().getUTCFullYear() + 1;
  const vintage = Number.isInteger(v) && v >= 1800 && v <= year ? v : v === 'NV' ? 'NV' : 'unknown';
  const out = { producer: str(item.producer, 200), wine_name: str(item.wine_name, 300), vintage, region: str(item.region, 200), country: str(item.country, 100),
    grape: str(item.grape, 200), color: LIST_COLORS.includes(item.color) ? item.color : 'Unknown', price: str(item.price, 40), source_line: str(item.source_line, 200),
    confidence: Number.isFinite(item.confidence) ? Math.max(0, Math.min(1, item.confidence)) : 0.5 };
  return out.wine_name || out.producer ? out : null;
}

// ── Spreadsheets (CSV/TSV): named columns, no AI, free ────────────────
const COLUMNS = {
  producer: ['producer', 'winery', 'estate', 'domaine', 'chateau', 'house', 'maker', 'brand'],
  wine_name: ['wine', 'name', 'wine name', 'cuvee', 'label', 'item', 'description', 'title'],
  vintage: ['vintage', 'year', 'vtg', 'yr'],
  region: ['region', 'appellation', 'area', 'sub region', 'subregion', 'ava', 'doc', 'origin region'],
  country: ['country', 'origin', 'nation'],
  grape: ['grape', 'grapes', 'varietal', 'variety', 'varietals', 'blend'],
  color: ['color', 'colour', 'type', 'style', 'category'],
  price: ['price', 'btl', 'bottle', 'bottle price', 'cost', 'retail', 'list price'],
};
function parseDelimited(text) {
  const first = text.split('\n', 1)[0];
  const delimiter = [',', ';', '\t'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; continue; }
    if (c === '"') quoted = true; else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some(x => x.trim())) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some(x => x.trim())) rows.push(row);
  return rows;
}
function csvItems(text) {
  const rows = parseDelimited(text);
  if (rows.length < 2) throw new HttpError(400, 'The spreadsheet needs a header row and at least one wine.');
  const header = rows[0].map(h => norm(h));
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, header.findIndex(h => names.includes(h))]));
  if (col.wine_name < 0 && col.producer < 0) throw new HttpError(400, 'Name a column “Wine” (and ideally “Producer”, “Vintage”, “Region”, “Country”). Excel files: save as CSV first.');
  const at = (r, k) => col[k] >= 0 ? String(r[col[k]] ?? '').trim() : '';
  return rows.slice(1).map(r => {
    const y = at(r, 'vintage'), n = Number(y);
    return validItem({ producer: at(r, 'producer'), wine_name: at(r, 'wine_name'), vintage: /^\d{4}$/.test(y) ? n : /^n\.?v\.?$|non.?vintage/i.test(y) ? 'NV' : 'unknown',
      region: at(r, 'region'), country: at(r, 'country'), grape: at(r, 'grape'), color: (LIST_COLORS.find(c => norm(c) === norm(at(r, 'color'))) || (norm(at(r, 'color')).startsWith('ros') ? 'Rose' : 'Unknown')),
      price: at(r, 'price'), source_line: r.join(', ').slice(0, 200), confidence: 0.9 });
  }).filter(Boolean);
}

// ── Resolve, de-duplicate, enrich, store ─────────────────────────────
async function enrich(db, udb, userId, items) {
  const seen = new Map(), entries = [];
  for (const raw of items) {
    const resolved = resolveEntry(raw);
    const k = resolved.keys.bottle || `${norm(resolved.producer)}|${norm(resolved.wine_name)}|${resolved.vintage ?? resolved.vintage_state}`;
    if (seen.has(k)) { seen.get(k).repeats++; continue; } // the same bottle listed twice (glass + bottle)
    const entry = { raw, resolved, repeats: 0 }; seen.set(k, entry); entries.push(entry);
    if (entries.length >= MAX_ENTRIES) break;
  }
  const { data: mine } = await udb.from('user_collection').select('wine_name,producer,vintage,metadata').eq('user_id', userId).limit(2000);
  const owned = new Set((mine || []).map(w => bottleKey(w)?.key).filter(Boolean));
  const keys = entries.map(e => e.resolved.keys.bottle).filter(Boolean);
  const { data: shared } = keys.length ? await db.from('winelens_shared_notes').select('key').in('key', keys).eq('status', 'ready') : { data: [] };
  const ready = new Set((shared || []).map(s => s.key));
  for (const e of entries) {
    const r = e.resolved;
    e.resolved = { ...r, repeats: e.repeats, in_winebrary: !!r.keys.bottle && owned.has(r.keys.bottle),
      notes: r.catalog && r.catalog.kind !== 'possible' ? 'catalog' : r.keys.bottle && ready.has(r.keys.bottle) ? 'shared' : null };
  }
  return entries;
}
async function storeUpload(db, userId, requestId, source, pages, entries) {
  const { data: upload, error } = await db.from('winelens_list_uploads').insert({ user_id: userId, request_id: requestId, source, pages, entry_count: entries.length }).select('id').single();
  if (error || !upload) throw new HttpError(503, 'Could not keep the list for review. You were not charged.');
  if (entries.length) {
    const { error: rowsError } = await db.from('winelens_list_entries').insert(entries.map((e, position) => ({ upload_id: upload.id, user_id: userId, position, decision: 'pending', raw: e.raw, resolved: e.resolved })));
    if (rowsError) { await db.from('winelens_list_uploads').delete().eq('id', upload.id); throw new HttpError(503, 'Could not keep the list for review. You were not charged.'); }
  }
  return upload.id;
}
async function loadUpload(db, userId, uploadId) {
  if (!UUID.test(String(uploadId || ''))) throw new HttpError(400, 'Choose a wine list.');
  const { data: upload } = await db.from('winelens_list_uploads').select('id,user_id,source,pages,entry_count,created_at').eq('id', uploadId).eq('user_id', userId).maybeSingle();
  if (!upload) throw new HttpError(404, 'That wine list is not in your account.');
  const { data: rows, error } = await db.from('winelens_list_entries').select('id,position,raw,resolved,decision').eq('upload_id', upload.id).order('position', { ascending: true });
  if (error) throw new HttpError(503, UNAVAILABLE);
  return { upload, entries: (rows || []).map(r => ({ id: r.id, position: r.position, decision: r.decision, raw: r.raw, ...r.resolved })) };
}

// ── Handler ──────────────────────────────────────────────────────────
function createWineListHandler({ getDb, getUserDb = userDb, env = process.env, getOpenAI = () => new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 120000, maxRetries: 0 }),
  extractPdfText = async bytes => { const { getDocumentProxy, extractText } = await import('unpdf'); const pdf = await getDocumentProxy(new Uint8Array(bytes)); const { text } = await extractText(pdf, { mergePages: true }); return { text, pages: pdf.numPages }; } } = {}) {
  return endpoint(async ({ req, body, db, user }) => {
    const udb = getUserDb(req);
    switch (body.action) {
      case 'inspect': {
        only(body, ['action', 'pdf']);
        const m = typeof body.pdf === 'string' && body.pdf.match(/^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/);
        const bytes = m ? Buffer.from(m[1], 'base64') : null;
        if (!bytes || bytes.toString('ascii', 0, 5) !== '%PDF-') throw new HttpError(400, 'Choose a PDF file.');
        if (bytes.length > MAX_PDF) throw new HttpError(413, 'PDFs must be under 3 MB. Larger lists: send photos or screenshots of the pages.');
        let extracted;
        try { extracted = await extractPdfText(bytes); } catch { throw new HttpError(400, 'This PDF could not be opened. Try photos of its pages.'); }
        const text = String(extracted.text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        // A scan has (almost) no text layer: it has to be read as photos.
        const hasText = text.replace(/\s/g, '').length > 40 * Math.max(1, extracted.pages || 1);
        return { has_text: hasText, text: hasText ? text.slice(0, MAX_TEXT) : '', truncated: text.length > MAX_TEXT, pdf_pages: extracted.pages || 0, text_pages: hasText ? textPages(text.slice(0, MAX_TEXT)).length : 0 };
      }
      case 'read': {
        only(body, ['action', 'kind', 'pages', 'text', 'source', 'request_id', 'spend_consent']);
        if (!env.OPENAI_API_KEY) throw new HttpError(503, UNAVAILABLE);
        if (!UUID.test(String(body.request_id || '')) || (body.spend_consent !== undefined && typeof body.spend_consent !== 'boolean')) throw new HttpError(400, 'Invalid request.');
        let inputs, feature, source, fingerprint;
        if (body.kind === 'photos') {
          if (!Array.isArray(body.pages) || !body.pages.length || body.pages.length > MAX_PHOTOS) throw new HttpError(400, `Send 1 to ${MAX_PHOTOS} page photos at a time.`);
          const bytes = body.pages.map(photoBytes);
          inputs = body.pages.map(url => [{ type: 'image_url', image_url: { url, detail: 'high' } }]);
          feature = 'wine_list_page'; source = 'photos'; fingerprint = sha(bytes.map(b => sha(b)).join('|'));
        } else if (body.kind === 'text') {
          const text = typeof body.text === 'string' ? body.text.trim() : '';
          if (!text) throw new HttpError(400, 'Paste or upload some text first.');
          if (text.length > MAX_TEXT) throw new HttpError(413, 'That list is longer than 60,000 characters. Split it into two uploads.');
          inputs = textPages(text).map(page => [{ type: 'text', text: page }]);
          feature = 'wine_list_text'; source = body.source === 'pdf' ? 'pdf' : 'text'; fingerprint = sha(text);
        } else throw new HttpError(400, 'Choose photos or text.');
        const model = env.WINELENS_LIST_MODEL || 'gpt-4.1-mini';
        const { result } = await runJob({ db, user, feature, requestId: body.request_id, fingerprint, consent: body.spend_consent, quantity: inputs.length,
          onReplay: async stored => loadUpload(db, user.id, stored.upload_id),
          work: async () => {
            const pages = await mapLimit(inputs, 6, async content => {
              const answer = await getOpenAI().chat.completions.create({ model, max_completion_tokens: 12000,
                messages: [{ role: 'system', content: LIST_SYSTEM }, { role: 'user', content }],
                response_format: { type: 'json_schema', json_schema: { name: 'wine_list', strict: true, schema: LIST_SCHEMA } } });
              const parsed = JSON.parse(answer.choices?.[0]?.message?.content || 'null');
              if (!parsed || !Array.isArray(parsed.wines)) throw new Error('Invalid list output');
              return parsed.wines.map(validItem).filter(Boolean);
            });
            // Nothing that looks like a wine (a blurred photo, the wrong page): not charged.
            if (!pages.flat().length) throw new HttpError(422, 'No wines found on these pages. Nothing was charged; try a sharper, flatter photo of the list.');
            const entries = await enrich(db, udb, user.id, pages.flat());
            const uploadId = await storeUpload(db, user.id, body.request_id, source, inputs.length, entries);
            return { stored: { upload_id: uploadId }, response: await loadUpload(db, user.id, uploadId), discard: () => db.from('winelens_list_uploads').delete().eq('id', uploadId) };
          } });
        return { ...result, charged_pages: inputs.length, feature };
      }
      case 'csv': {
        only(body, ['action', 'text']);
        if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 400000) throw new HttpError(400, 'Choose a CSV file under 400 KB.');
        const entries = await enrich(db, udb, user.id, csvItems(body.text.replace(/^﻿/, '')));
        if (!entries.length) throw new HttpError(400, 'No wines found in that file.');
        return { ...(await loadUpload(db, user.id, await storeUpload(db, user.id, randomUUID(), 'csv', 0, entries))), charged_pages: 0 };
      }
      case 'upload': { only(body, ['action', 'upload_id']); return loadUpload(db, user.id, body.upload_id); }
      case 'commit': return commit({ db, udb, user, body });
      default: throw new HttpError(400, 'Unknown wine-list action.');
    }
  }, { getDb, maxBytes: MAX_BODY });
}

// ── Save the reviewed wines ──────────────────────────────────────────
// The phone sends the final fields (after any edits) and its catalog choice. Everything is resolved
// again server-side: the client never decides the catalog link or the globe place on its own.
async function commit({ db, udb, user, body }) {
  only(body, ['action', 'upload_id', 'entries']);
  if (!Array.isArray(body.entries) || !body.entries.length || body.entries.length > MAX_ENTRIES) throw new HttpError(400, 'Choose at least one wine to save.');
  const { upload, entries } = await loadUpload(db, user.id, body.upload_id);
  const pending = new Map(entries.filter(e => e.decision === 'pending').map(e => [e.id, e]));
  const { count } = await udb.from('user_collection').select('id', { count: 'exact', head: true }).eq('user_id', user.id);
  const chosen = body.entries.filter(e => e && pending.has(e.id));
  if (!chosen.length) throw new HttpError(409, 'These wines are already saved or skipped.');
  if ((count || 0) + chosen.length > MAX_WINES) throw new HttpError(409, `Your Winebrary holds up to ${MAX_WINES} wines.`);
  const rows = [], proposals = new Map();
  for (const e of chosen) {
    const fields = wineFields({ ...e, notes: undefined, notes_source: undefined });
    const resolved = resolveEntry({ producer: fields.producer || '', wine_name: fields.wine_name, vintage: fields.vintage ?? (fields.metadata.vintage_state === 'non_vintage' ? 'NV' : 'unknown'),
      region: fields.region || '', country: fields.metadata.country || '', grape: fields.metadata.grape || '', color: fields.metadata.color });
    // Link to a catalog wine only when the person kept the link and it is the same wine.
    const catalogId = typeof e.catalog_id === 'string' && catalogById.has(e.catalog_id) && resolved.catalog?.id === e.catalog_id ? e.catalog_id : null;
    rows.push({ user_id: user.id, wine_id: catalogId, wine_name: fields.wine_name, producer: fields.producer, vintage: fields.vintage, region: resolved.region || fields.region,
      notes: null, metadata: { ...fields.metadata, country: resolved.country || fields.metadata.country, grape: fields.metadata.grape || resolved.grape || null,
        source: 'wine_list', list_upload: upload.id, list_entry: e.id, place_status: resolved.place.status, region_source: fields.region || null } });
    const key = !catalogId && wineKey(resolved);
    if (key && !proposals.has(key)) proposals.set(key, { wine: { producer: resolved.producer, wine_name: resolved.wine_name, region: resolved.region, country: resolved.country, grape: resolved.grape, color: resolved.color },
      place: resolved.place });
  }
  const { data: saved, error } = await udb.from('user_collection').insert(rows).select('id');
  if (error) throw new HttpError(503, 'Could not save these wines. Nothing was added; try again.');
  const ids = chosen.map(e => e.id);
  await db.from('winelens_list_entries').update({ decision: 'saved' }).eq('upload_id', upload.id).in('id', ids);
  await db.from('winelens_list_entries').update({ decision: 'skipped' }).eq('upload_id', upload.id).eq('decision', 'pending');
  let proposed = 0;
  for (const [key, p] of proposals) { try { await rpc(db, 'winelens_propose_wine', { p_key: key, p_wine: p.wine, p_place: p.place, p_user: user.id }); proposed++; } catch { /* the wine is saved; proposing is best effort */ } }
  return { saved: (saved || []).length, ids: (saved || []).map(r => r.id), proposed, skipped: entries.length - chosen.length };
}
module.exports = { createWineListHandler, csvItems, textPages, parseDelimited, validItem };
