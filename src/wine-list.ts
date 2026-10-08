// ═══════════════════════════════════════════════════════════════════
// wineLENS — wine lists on the phone. Photos, a PDF, a spreadsheet or
// pasted text become wines placed in the catalog, on the globe and next
// to their notes. Nothing is saved until the person has reviewed it.
//   Photo pages: wine_list_page · text pages (6,000 characters): wine_list_text
//   Spreadsheets (CSV): free, read on wineLENS without AI
// ═══════════════════════════════════════════════════════════════════
import { accountRequest, requestIds, type Feature } from './billing';
import type { Gate } from './winebrary';

export interface ListEntry {
  id: string; position: number; decision: 'pending' | 'saved' | 'skipped';
  wine_name: string; producer: string; vintage: number | null; vintage_state: 'year' | 'non_vintage' | 'unknown';
  region: string; country: string; grape: string; color: string; price: string; source_line: string; confidence: number;
  catalog: { id: string; kind: 'exact' | 'match' | 'possible'; score: number; title?: string; producer?: string } | null;
  place: { status: 'mapped' | 'unmapped' | 'country' | 'unknown'; region: string; country: string | null; original: string };
  repeats?: number; in_winebrary?: boolean; notes?: 'catalog' | 'shared' | null;
}
export interface ListUpload { upload: { id: string; source: string; pages: number; entry_count: number }; entries: ListEntry[]; charged_pages?: number }
export interface FlowContext {
  dialog: HTMLDialogElement; costHTML: string;
  openDialog(html: string): void; feedback(message: string): void; run(task: () => Promise<void>): Promise<void>; setBusy(value: boolean): void;
  isBusy(): boolean; revision(): number; userId(): string | null; refresh(): Promise<void>; esc(value: unknown): string;
  costGate(feature: Feature, onChange: () => void, quantity?: () => number): Gate;
  /** Wine cards for saved wines, one at a time (1 token each). */
  makeCards(ids: string[], consent: boolean, progress: (done: number) => void): Promise<{ made: number; error: string | null }>;
}

export const MAX_PHOTOS = 6, PHOTO_TARGET = 450 * 1024, MAX_PDF = 3 * 1024 * 1024, MAX_TEXT = 60000, TEXT_PAGE = 6000, MAX_CSV = 400 * 1024;
const COLORS = ['Red', 'White', 'Sparkling', 'Rose', 'Orange', 'Dessert', 'Unknown'];
const colorLabel = (c: string) => c === 'Rose' ? 'Rosé' : c === 'Unknown' ? 'Not sure' : c;

/** Same split as the server: 6,000-character pages that break at line ends. */
export function textPages(text: string): number {
  let pages = 0, page = '';
  for (const line of text.split('\n')) {
    if (page && page.length + line.length + 1 > TEXT_PAGE) { pages++; page = ''; }
    page += (page ? '\n' : '') + line.slice(0, TEXT_PAGE);
  }
  return pages + (page.trim() ? 1 : 0);
}
const dataUrlBytes = (url: string) => Math.floor((url.length - url.indexOf(',') - 1) * 3 / 4);
/** A page photo as JPEG under ~450 KB (six fit in one request), longest edge ≤ 2000 px. */
export async function compressPage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error(`${file.name || 'That photo'} could not be opened. Try a JPEG or PNG.`)); i.src = url;
    });
    let edge = 2000;
    for (let attempt = 0; attempt < 5; attempt++, edge = Math.round(edge * 0.8)) {
      const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.82, 0.7, 0.6]) { const data = canvas.toDataURL('image/jpeg', quality); if (dataUrlBytes(data) <= PHOTO_TARGET) return data; }
    }
    throw new Error('That page photo is too detailed to send. Try a closer crop of the page.');
  } finally { URL.revokeObjectURL(url); }
}
const readAs = (file: File, kind: 'text' | 'url') => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('That file could not be read.'));
  if (kind === 'text') reader.readAsText(file); else reader.readAsDataURL(file);
});

// ── Review groups and chips ─────────────────────────────────────────
export type Group = 'matched' | 'new' | 'check';
export function groupOf(e: ListEntry): Group {
  if (e.catalog && e.catalog.kind !== 'possible') return 'matched';
  if (e.catalog?.kind === 'possible' || e.confidence < 0.6 || !e.producer || !e.wine_name) return 'check';
  return 'new';
}
export function chips(e: ListEntry): { text: string; tone: 'good' | 'info' | 'warn' }[] {
  const out: { text: string; tone: 'good' | 'info' | 'warn' }[] = [];
  if (e.catalog?.kind === 'exact' || e.catalog?.kind === 'match') out.push({ text: 'In the catalog ✓', tone: 'good' });
  const p = e.place, region = p.region.replace(/, ([A-Z]{2})$/, (_, code) => `, ${e.country || code}`); // "Champagne, FR" → "Champagne, France"
  out.push(p.status === 'mapped' ? { text: `On the globe · ${region}`, tone: 'good' }
    : p.status === 'unmapped' ? { text: `${region} · not on the globe yet`, tone: 'info' }
    : p.status === 'country' ? { text: `${e.country || 'Country'} · no region given`, tone: 'info' }
    : { text: `${p.region || 'Place'} · not on the globe yet`, tone: 'info' });
  if (e.notes === 'catalog') out.push({ text: 'Catalog notes', tone: 'good' });
  else if (e.notes === 'shared') out.push({ text: 'Notes ready · free', tone: 'good' });
  if (e.in_winebrary) out.push({ text: 'Already in your Winebrary', tone: 'info' });
  if (e.repeats) out.push({ text: `Listed ${e.repeats + 1}×`, tone: 'info' });
  if (e.confidence < 0.6) out.push({ text: 'Hard to read · check it', tone: 'warn' });
  if (!e.producer) out.push({ text: 'No producer', tone: 'warn' });
  return out;
}
const vintageText = (e: Pick<ListEntry, 'vintage' | 'vintage_state'>) => e.vintage ? String(e.vintage) : e.vintage_state === 'non_vintage' ? 'NV' : '';
/** "2017" → year, "NV" → non-vintage, anything else → unknown. */
export function parseVintage(text: string): { vintage_state: 'year' | 'non_vintage' | 'unknown'; vintage: number | '' } {
  const t = text.trim();
  if (/^\d{4}$/.test(t)) return { vintage_state: 'year', vintage: Number(t) };
  return { vintage_state: /^n\.?v\.?$|non.?vintage/i.test(t) ? 'non_vintage' : 'unknown', vintage: '' };
}

// ── The flow ────────────────────────────────────────────────────────
const LAST = (user: string) => `wl-last-list:${user}`;
const remember = (user: string | null, id: string | null) => { try { if (user) { if (id) localStorage.setItem(LAST(user), id); else localStorage.removeItem(LAST(user)); } } catch { /* storage is a convenience */ } };
const recall = (user: string | null) => { try { return user ? localStorage.getItem(LAST(user)) : null; } catch { return null; } };
const list = (body: Record<string, unknown>) => accountRequest('wine-list', body);

export function wineListFlow(ctx: FlowContext) {
  const { esc } = ctx;
  const back = '<button class="wl-text-button" data-list-back>← Choose another way</button>';
  const wireBack = () => ctx.dialog.querySelector('[data-list-back]')?.addEventListener('click', open);
  /** A paid read: the request ID is kept only while the answer may still be on its way. */
  async function read(gate: Gate, ids: ReturnType<typeof requestIds>, body: Record<string, unknown>, account: string | null, revision: number) {
    await gate.beforeSpend();
    let result: ListUpload;
    try { result = await list({ action: 'read', ...body, request_id: ids.current, spend_consent: gate.consent() }); ids.settle(); }
    catch (e) { ids.settle(e); void gate.refresh(); throw e; }
    if (account !== ctx.userId() || revision !== ctx.revision()) return;
    remember(account, result.upload.id); ctx.setBusy(false); review(result);
  }

  function open() {
    const account = ctx.userId();
    ctx.openDialog(`<p class="wl-kicker">WINE LIST ✦</p><h2>A whole list.<br>Every bottle placed.</h2>
      <p class="wl-muted">Upload a restaurant or shop wine list. wineLENS reads every wine, matches it to the catalog, finds it on the globe and shows which already have notes. You review every wine before anything is saved.</p>
      <div id="wl-list-resume"></div>
      <div class="wl-list-sources">
        <button class="wl-list-source" data-source="photos"><strong>Photos of the pages ✦</strong><span>Up to ${MAX_PHOTOS} pages at a time</span></button>
        <button class="wl-list-source" data-source="pdf"><strong>A PDF ✦</strong><span>Menus and price lists with real text</span></button>
        <button class="wl-list-source" data-source="csv"><strong>A spreadsheet</strong><span>CSV · free, no AI</span></button>
        <button class="wl-list-source" data-source="text"><strong>Paste the list ✦</strong><span>From an email or a website</span></button>
      </div>
      <p class="wl-muted small">Photos, PDFs and pasted lists are read by OpenAI and billed per page. Uploaded lists stay in your account for review; new wines are suggested to the wineLENS catalog without your name.</p>`);
    const views: Record<string, () => void> = { photos, pdf, csv, text: () => pasted() };
    ctx.dialog.querySelectorAll<HTMLButtonElement>('[data-source]').forEach(b => b.addEventListener('click', () => views[b.dataset.source!]()));
    const last = recall(account), revision = ctx.revision();
    if (last) void list({ action: 'upload', upload_id: last }).then((r: ListUpload) => {
      const waiting = r.entries.filter(e => e.decision === 'pending').length;
      if (revision !== ctx.revision() || account !== ctx.userId()) return;
      if (!waiting) { remember(account, null); return; }
      const slot = ctx.dialog.querySelector('#wl-list-resume')!;
      slot.innerHTML = `<button class="wl-outline wl-list-resume">Continue your last list · ${waiting} ${waiting === 1 ? 'wine' : 'wines'} to review</button>`;
      slot.querySelector('button')!.addEventListener('click', () => review(r));
    }).catch(() => remember(account, null));
  }

  function photos() {
    const account = ctx.userId();
    let pages: string[] = [], ids = requestIds();
    ctx.openDialog(`<p class="wl-kicker">WINE LIST · PHOTOS ✦</p><h2>One photo per page.</h2>
      <p class="wl-muted">Flat and well lit, the whole page in frame. Screenshots work too. Up to ${MAX_PHOTOS} pages at a time; photos are shrunk on your phone before sending.</p>
      <label class="wl-upload">＋ Choose page photos<input id="wl-list-photos" type="file" accept="image/*" multiple></label>
      <ol id="wl-list-thumbs" class="wl-list-thumbs"></ol>
      ${ctx.costHTML}<button id="wl-list-read" class="wl-primary" disabled>Read the pages ✦</button>${back}`);
    wireBack();
    const revision = ctx.revision(); // after this view's dialog opened
    const go = ctx.dialog.querySelector<HTMLButtonElement>('#wl-list-read')!, input = ctx.dialog.querySelector<HTMLInputElement>('#wl-list-photos')!;
    const gate = ctx.costGate('wine_list_page', () => { go.disabled = ctx.isBusy() || !pages.length || !gate.ready(); }, () => pages.length);
    const draw = () => {
      ctx.dialog.querySelector('#wl-list-thumbs')!.innerHTML = pages.map((p, i) => `<li><img src="${p}" alt="Page ${i + 1}"><button class="wl-text-button" data-drop="${i}" aria-label="Remove page ${i + 1}">Remove</button></li>`).join('');
      ctx.dialog.querySelectorAll<HTMLButtonElement>('[data-drop]').forEach(b => b.addEventListener('click', () => { pages.splice(Number(b.dataset.drop), 1); ids = requestIds(); draw(); }));
      go.textContent = pages.length ? `Read ${pages.length} ${pages.length === 1 ? 'page' : 'pages'} ✦` : 'Read the pages ✦';
      gate.recompute();
    };
    input.addEventListener('change', () => void ctx.run(async () => {
      const files = [...(input.files || [])]; input.value = '';
      if (pages.length + files.length > MAX_PHOTOS) ctx.feedback(`Up to ${MAX_PHOTOS} pages at a time; the rest can go in a second upload.`);
      for (const file of files.slice(0, MAX_PHOTOS - pages.length)) { ctx.feedback(`Preparing ${file.name || 'page'}…`); pages.push(await compressPage(file)); }
      if (revision !== ctx.revision()) return;
      ids = requestIds(); ctx.feedback(''); draw();
    }));
    go.addEventListener('click', () => void ctx.run(async () => {
      ctx.feedback(`Reading ${pages.length} ${pages.length === 1 ? 'page' : 'pages'}… a long list can take a minute or two.`);
      await read(gate, ids, { kind: 'photos', pages }, account, revision);
    }));
  }

  function pdf() {
    const account = ctx.userId();
    let text = '', pagesOfText = 0, ids = requestIds();
    ctx.openDialog(`<p class="wl-kicker">WINE LIST · PDF ✦</p><h2>From the PDF’s own text.</h2>
      <p class="wl-muted">wineLENS reads the text inside the PDF. Checking the file is free; reading it uses text pages of about 6,000 characters. Scanned PDFs have no text: photograph those pages instead.</p>
      <label class="wl-upload">＋ Choose a PDF<input id="wl-list-pdf" type="file" accept="application/pdf,.pdf"></label>
      <div id="wl-list-pdf-result" hidden><p id="wl-list-pdf-line" class="wl-notice"></p>${ctx.costHTML}<button id="wl-list-read" class="wl-primary" disabled>Read the list ✦</button></div>${back}`);
    wireBack();
    const revision = ctx.revision(); // after this view's dialog opened
    const go = ctx.dialog.querySelector<HTMLButtonElement>('#wl-list-read')!, input = ctx.dialog.querySelector<HTMLInputElement>('#wl-list-pdf')!;
    let gate: Gate | null = null;
    input.addEventListener('change', () => void ctx.run(async () => {
      const file = input.files?.[0]; if (!file) return;
      ids = requestIds();
      if (file.size > MAX_PDF) throw new Error('PDFs must be under 3 MB. For a larger list, send photos or screenshots of its pages.');
      ctx.feedback('Checking the PDF… (free)');
      const result = await list({ action: 'inspect', pdf: (await readAs(file, 'url')).replace(/^data:[^;]*;/, 'data:application/pdf;') });
      if (revision !== ctx.revision()) return;
      ctx.feedback('');
      if (!result.has_text) {
        ctx.dialog.querySelector('#wl-list-pdf-result')!.outerHTML = `<p class="wl-notice">This PDF is a scan (pictures of pages, no text). <button class="wl-text-button" id="wl-list-to-photos">Photograph the pages instead →</button></p>`;
        ctx.dialog.querySelector('#wl-list-to-photos')!.addEventListener('click', photos); return;
      }
      text = result.text; pagesOfText = result.text_pages;
      ctx.dialog.querySelector<HTMLElement>('#wl-list-pdf-result')!.hidden = false;
      ctx.dialog.querySelector('#wl-list-pdf-line')!.textContent = `${result.pdf_pages} PDF ${result.pdf_pages === 1 ? 'page' : 'pages'} · ${pagesOfText} text ${pagesOfText === 1 ? 'page' : 'pages'} to read${result.truncated ? ' · only the first 60,000 characters (split longer lists)' : ''}.`;
      go.textContent = `Read ${pagesOfText} text ${pagesOfText === 1 ? 'page' : 'pages'} ✦`;
      gate = ctx.costGate('wine_list_text', () => { go.disabled = ctx.isBusy() || !text || !gate!.ready(); }, () => pagesOfText);
    }));
    go.addEventListener('click', () => void ctx.run(async () => {
      if (!gate) return;
      ctx.feedback('Reading the list… a long list can take a minute or two.');
      await read(gate, ids, { kind: 'text', source: 'pdf', text }, account, revision);
    }));
  }

  function pasted() {
    const account = ctx.userId();
    let ids = requestIds();
    ctx.openDialog(`<p class="wl-kicker">WINE LIST · TEXT ✦</p><h2>Paste the list.</h2>
      <p class="wl-muted">One wine per line works best, as it appears on the list. Billed per text page of about 6,000 characters.</p>
      <label>Wine list<textarea id="wl-list-text" rows="10" maxlength="${MAX_TEXT}" placeholder="Terrazas de los Andes · Grand Malbec · Mendoza 2017 ……… 58"></textarea></label>
      <p id="wl-list-count" class="wl-muted small">0 text pages</p>${ctx.costHTML}<button id="wl-list-read" class="wl-primary" disabled>Read the list ✦</button>${back}`);
    wireBack();
    const revision = ctx.revision(); // after this view's dialog opened
    const area = ctx.dialog.querySelector<HTMLTextAreaElement>('#wl-list-text')!, go = ctx.dialog.querySelector<HTMLButtonElement>('#wl-list-read')!;
    const count = () => area.value.trim() ? textPages(area.value.trim()) : 0;
    const gate = ctx.costGate('wine_list_text', () => { go.disabled = ctx.isBusy() || !count() || !gate.ready(); }, () => count());
    area.addEventListener('input', () => {
      const n = count(); ids = requestIds();
      ctx.dialog.querySelector('#wl-list-count')!.textContent = `${area.value.length.toLocaleString()} characters · ${n} text ${n === 1 ? 'page' : 'pages'}`;
      gate.recompute();
    });
    go.addEventListener('click', () => void ctx.run(async () => {
      ctx.feedback('Reading the list… a long list can take a minute or two.');
      await read(gate, ids, { kind: 'text', source: 'text', text: area.value.trim() }, account, revision);
    }));
  }

  function csv() {
    const account = ctx.userId();
    ctx.openDialog(`<p class="wl-kicker">WINE LIST · SPREADSHEET</p><h2>Columns in, wines out.</h2>
      <p class="wl-muted">A CSV with a header row. wineLENS looks for columns like Producer, Wine, Vintage, Region, Country, Grape and Colour. Read on wineLENS, no AI, free.</p>
      <label class="wl-upload">＋ Choose a CSV file<input id="wl-list-csv" type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain,.xlsx,.xls,.numbers"></label>
      <p class="wl-muted small">Excel or Numbers: File → Save As / Export → CSV first.</p>${back}`);
    wireBack();
    const revision = ctx.revision(); // after this view's dialog opened
    const input = ctx.dialog.querySelector<HTMLInputElement>('#wl-list-csv')!;
    input.addEventListener('change', () => void ctx.run(async () => {
      const file = input.files?.[0]; if (!file) return;
      if (/\.(xlsx|xls|numbers)$/i.test(file.name)) throw new Error('Save the spreadsheet as CSV first (File → Save As / Export → CSV), then choose that file.');
      if (file.size > MAX_CSV) throw new Error('Choose a CSV under 400 KB, or split the list into two files.');
      ctx.feedback('Reading the spreadsheet…');
      const result: ListUpload = await list({ action: 'csv', text: await readAs(file, 'text') });
      if (account !== ctx.userId() || revision !== ctx.revision()) return;
      remember(account, result.upload.id); ctx.setBusy(false); review(result);
    }));
  }

  // ── Review: every wine checked before it is saved ─────────────────
  function review(data: ListUpload) {
    const account = ctx.userId();
    const pending = data.entries.filter(e => e.decision === 'pending'), byId = new Map(pending.map(e => [e.id, e]));
    const groups: Record<Group, ListEntry[]> = { matched: [], new: [], check: [] };
    pending.forEach(e => groups[groupOf(e)].push(e));
    const field = (name: string, label: string, value: unknown, extra = '') => `<label>${label}<input data-field="${name}" value="${esc(value)}" ${extra}></label>`;
    const row = (e: ListEntry) => `<li class="wl-list-row" data-entry="${esc(e.id)}">
      <label class="wl-list-pick"><input type="checkbox" class="wl-list-save" ${!e.in_winebrary && e.confidence >= 0.5 ? 'checked' : ''} aria-label="Save ${esc(e.wine_name || e.producer)}"></label>
      <div class="wl-list-copy"><strong>${esc([e.producer, e.wine_name].filter(Boolean).join(' · '))}</strong>
        <span class="wl-muted">${esc([vintageText(e) || 'Vintage not listed', e.color !== 'Unknown' && colorLabel(e.color), e.grape].filter(Boolean).join(' · '))}</span>
        <div class="wl-list-chips">${chips(e).map(c => `<span class="wl-list-chip wl-list-chip-${c.tone}">${esc(c.text)}</span>`).join('')}</div>
        ${e.catalog ? `<label class="wl-consent wl-list-link"><input type="checkbox" class="wl-list-catalog" ${e.catalog.kind !== 'possible' ? 'checked' : ''}> ${e.catalog.kind === 'possible' ? 'Same wine as' : 'Link to'} ${esc(e.catalog.title)}${e.catalog.producer ? ' – ' + esc(e.catalog.producer) : ''}${e.catalog.kind === 'possible' ? '?' : ''}</label>` : ''}
        ${e.source_line ? `<p class="wl-muted small wl-list-line">On the list: “${esc(e.source_line)}”</p>` : ''}
        <button class="wl-text-button wl-list-edit" type="button" aria-expanded="false">Edit details</button>
        <div class="wl-list-form wl-form-grid" hidden>${field('wine_name', 'Wine name', e.wine_name, 'maxlength="300" required')}${field('producer', 'Producer', e.producer, 'maxlength="200"')}
          ${field('vintage', 'Vintage (year or NV)', vintageText(e), 'maxlength="12" inputmode="text"')}${field('region', 'Region', e.region, 'maxlength="200"')}${field('country', 'Country', e.country, 'maxlength="100"')}${field('grape', 'Grape', e.grape, 'maxlength="200"')}
          <label>Wine style<select data-field="color">${COLORS.map(c => `<option value="${c}" ${c === e.color ? 'selected' : ''}>${colorLabel(c)}</option>`).join('')}</select></label></div>
      </div></li>`;
    const section = (g: Group, title: string, sub: string) => groups[g].length ? `<section class="wl-list-group"><h3>${title} <span>${groups[g].length}</span></h3><p class="wl-muted small">${sub}</p><ul>${groups[g].map(row).join('')}</ul></section>` : '';
    const onGlobe = pending.filter(e => e.place.status === 'mapped').length, withNotes = pending.filter(e => e.notes).length;
    ctx.openDialog(`<div id="wl-list-review"><p class="wl-kicker">WINE LIST · REVIEW</p>
      ${!data.entries.length ? `<h2>No wines found.</h2><p class="wl-muted">Nothing on ${data.upload.pages === 1 ? 'this page' : 'these pages'} looked like a wine. Try a sharper, flatter photo of the list.</p><button class="wl-primary" id="wl-list-another">Try again</button>`
      : !pending.length ? `<h2>All done.</h2><p class="wl-muted">Every wine on this list is saved or skipped.</p><button class="wl-primary" id="wl-list-another">Upload another list</button>`
      : `<h2>${pending.length} ${pending.length === 1 ? 'wine' : 'wines'} found.</h2>
      <p class="wl-muted">${onGlobe} on the globe · ${withNotes} with notes ready · ${groups.matched.length} in the catalog. Tick the wines to save; edit anything that was misread.</p>
      <div class="wl-list-tools"><button class="wl-text-button" id="wl-list-all">Select all</button><button class="wl-text-button" id="wl-list-none">Select none</button></div>
      ${section('matched', 'In the wineLENS catalog', 'Saved with the catalog’s notes and place on the globe.')}
      ${section('new', 'New to wineLENS', 'Saved to your Winebrary and suggested to the catalog for review. Get tasting notes for any of them later ✦.')}
      ${section('check', 'Needs a look', 'Hard to read, missing a producer, or maybe a catalog wine. Check these before saving.')}
      <div class="wl-list-footer"><button class="wl-primary" id="wl-list-save">Save to Winebrary ↗</button><button class="wl-text-button" id="wl-list-later">Review later</button></div>`}</div>`);
    const revision = ctx.revision();
    ctx.dialog.querySelector('#wl-list-another')?.addEventListener('click', open);
    if (!pending.length) { remember(account, null); return; }
    const save = ctx.dialog.querySelector<HTMLButtonElement>('#wl-list-save')!;
    const boxes = () => [...ctx.dialog.querySelectorAll<HTMLInputElement>('.wl-list-save')];
    const count = () => { const n = boxes().filter(b => b.checked).length; save.textContent = n ? `Save ${n} ${n === 1 ? 'wine' : 'wines'} to Winebrary ↗` : 'Choose wines to save'; save.disabled = !n || ctx.isBusy(); };
    ctx.dialog.querySelector('#wl-list-all')!.addEventListener('click', () => { boxes().forEach(b => { b.checked = true; }); count(); });
    ctx.dialog.querySelector('#wl-list-none')!.addEventListener('click', () => { boxes().forEach(b => { b.checked = false; }); count(); });
    ctx.dialog.querySelector('#wl-list-later')!.addEventListener('click', () => ctx.dialog.close());
    ctx.dialog.querySelectorAll<HTMLButtonElement>('.wl-list-edit').forEach(b => b.addEventListener('click', () => {
      const form = b.nextElementSibling as HTMLElement; form.hidden = !form.hidden; b.setAttribute('aria-expanded', String(!form.hidden)); b.textContent = form.hidden ? 'Edit details' : 'Hide details';
    }));
    ctx.dialog.querySelector('#wl-list-review')!.addEventListener('change', count);
    count();
    save.addEventListener('click', () => void ctx.run(async () => {
      const chosen = [...ctx.dialog.querySelectorAll<HTMLElement>('.wl-list-row')].filter(r => r.querySelector<HTMLInputElement>('.wl-list-save')!.checked).map(r => {
        const e = byId.get(r.dataset.entry!)!, value = (name: string) => r.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-field="${name}"]`)!.value.trim();
        if (!value('wine_name')) throw new Error(`Give “${e.producer || 'this wine'}” a wine name, or untick it.`);
        const link = e.catalog && r.querySelector<HTMLInputElement>('.wl-list-catalog')?.checked;
        return { id: e.id, wine_name: value('wine_name'), producer: value('producer'), ...parseVintage(value('vintage')), region: value('region'), country: value('country'),
          grape: value('grape'), color: value('color'), ...(link ? { catalog_id: e.catalog!.id } : {}) };
      });
      ctx.feedback('Saving…');
      const result = await list({ action: 'commit', upload_id: data.upload.id, entries: chosen });
      if (account !== ctx.userId() || revision !== ctx.revision()) return;
      remember(account, null); ctx.setBusy(false); void ctx.refresh(); done(result);
    }));
  }

  function done(result: { saved: number; ids?: string[]; proposed: number; skipped: number }) {
    const ids = result.ids ?? [], n = ids.length;
    ctx.openDialog(`<p class="wl-kicker">WINE LIST · SAVED</p><h2>${result.saved} ${result.saved === 1 ? 'wine' : 'wines'} in your Winebrary.</h2>
      <ul class="wl-list-summary">${result.proposed ? `<li>${result.proposed} new to wineLENS, suggested to the catalog for review.</li>` : ''}${result.skipped ? `<li>${result.skipped} skipped.</li>` : ''}</ul>
      ${n ? `<div class="wl-card-cta"><div><p class="wl-kicker">✦ WINE CARDS · 1 TOKEN EACH</p><p>A 3D bottle, tasting notes and the year for every wine, pinned on your map and ready on your glasses.</p></div></div>
      ${ctx.costHTML}<p id="wl-cards-progress" class="wl-muted small" role="status" aria-live="polite"></p>` : '<p class="wl-muted">Catalog wines show their notes right away.</p>'}
      <div class="wl-list-footer">${n ? `<button class="wl-primary" id="wl-list-cards" disabled>Make ${n} wine ${n === 1 ? 'card' : 'cards'} ✦</button>` : ''}<button class="wl-${n ? 'text-button' : 'primary'}" id="wl-list-close">${n ? 'Not now' : 'Open my Winebrary'}</button><button class="wl-outline" id="wl-list-another">Upload another list</button></div>`);
    ctx.dialog.querySelector('#wl-list-close')!.addEventListener('click', () => ctx.dialog.close());
    ctx.dialog.querySelector('#wl-list-another')!.addEventListener('click', open);
    if (!n) return;
    const make = ctx.dialog.querySelector<HTMLButtonElement>('#wl-list-cards')!, progress = ctx.dialog.querySelector('#wl-cards-progress')!;
    const gate = ctx.costGate('wine_card', () => { make.disabled = ctx.isBusy() || !gate.ready(); }, () => n);
    const revision = ctx.revision();
    make.addEventListener('click', () => void ctx.run(async () => {
      await gate.beforeSpend();
      progress.textContent = `Making card 1 of ${n}…`;
      const outcome = await ctx.makeCards(ids, gate.consent(), made => { if (revision === ctx.revision()) progress.textContent = made < n ? `Making card ${made + 1} of ${n}… (${made} ready)` : `${made} of ${n} ready.`; });
      void ctx.refresh();
      if (revision !== ctx.revision()) return;
      if (outcome.error) { void gate.refresh(); throw new Error(`${outcome.made} of ${n} cards made. ${outcome.error} Cards that did not finish were not charged.`); }
      progress.textContent = `All ${n} wine cards are ready: on your map, and on your glasses under My Winebrary.`;
      make.hidden = true;
    }));
  }

  return { open, review };
}
