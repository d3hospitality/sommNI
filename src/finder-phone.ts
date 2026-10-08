// ═══════════════════════════════════════════════════════════════════
// Find My Wine on the phone: five sommelier questions → picks with the reasons, each one a tap
// from your Winebrary, the glasses, or its tasting notes. Then "beyond the catalog": the
// wineLENS sommelier names three real bottles from anywhere (allowance, then 1 token).
// Lives in the Winebrary dialog (same cost gate, account and busy state as the other flows).
// ═══════════════════════════════════════════════════════════════════
import { findWines, finderSteps, answerStep, answersLine, resultLine, SKIP, STEP_COUNT, type FinderAnswers, type FinderResult } from './finder';
import { accountRequest, requestIds, type Feature } from './billing';
import { catalogSections } from './notes-format';
import { catalogHidden } from './catalog-view';
import { TYPE_DISPLAY, type WineType } from './constants';
import type { CatalogWine } from './identity';
import type { LibraryWine, Gate } from './winebrary';
import type { SaveResult } from './quick-save';

export interface FinderContext {
  dialog: HTMLDialogElement; costHTML: string;
  openDialog(html: string): void; feedback(message: string): void; run(task: () => Promise<void>): Promise<void>; setBusy(value: boolean): void;
  revision(): number; userId(): string | null; esc(value: unknown): string;
  costGate(feature: Feature, onChange: () => void): Gate;
  items(): LibraryWine[];
  thumb(item: CatalogWine): string;
  saveCatalog(catalogId: string): Promise<SaveResult>;
  addWine(fields: Record<string, unknown>): Promise<LibraryWine>;
  openSaved(wine: LibraryWine): void;
  signIn(): void;
  /** Picks on the glasses (throws when the glasses are not connected). */
  showOnGlasses(answers: FinderAnswers): Promise<void>;
}
interface Suggestion { name: string; producer: string; region: string; country: string; grape: string; color: string; vintage: string; why: string; serve: string; confidence: number }
const STEP_NAMES: Record<string, string> = { moment: 'Moment', food: 'Food', color: 'Colour', taste: 'Feel', flavor: 'Flavour' };
const COLOR_LABEL = (c: string) => TYPE_DISPLAY[c as WineType] ?? c;

/** What the sommelier is told: the answered questions, as words. */
export function briefOf(answers: FinderAnswers): string[] {
  return finderSteps(answers).flatMap(s => {
    const v = answers[s.id]; if (!v || v === SKIP) return [];
    const label = s.options.find(o => o.id === v)?.label; return label ? [`${STEP_NAMES[s.id]}: ${label}`] : [];
  });
}

export function finderFlow(ctx: FinderContext) {
  const { esc } = ctx;
  let answers: FinderAnswers = {}, results: FinderResult[] = [];
  const ids = requestIds();

  function step(index: number) {
    const steps = finderSteps(answers), s = steps[index];
    const dots = steps.map((_, i) => `<span class="wl-finder-dot${i < index ? ' done' : i === index ? ' on' : ''}"></span>`).join('');
    ctx.openDialog(`<p class="wl-kicker">FIND MY WINE · ${index + 1} OF ${STEP_COUNT}</p><div class="wl-finder-dots" aria-hidden="true">${dots}</div>
      <h2>${esc(s.question)}</h2>
      ${index ? `<p class="wl-muted small wl-finder-sofar">${esc(answersLine(Object.fromEntries(steps.slice(0, index).filter(x => answers[x.id]).map(x => [x.id, answers[x.id]]))))}</p>` : '<p class="wl-muted small wl-finder-sofar">Answer like you would at the table. Skip anything.</p>'}
      <div class="wl-finder-options" role="group" aria-label="${esc(s.question)}">${s.options.map(o => `<button type="button" class="wl-finder-option${answers[s.id] === o.id ? ' active' : ''}" data-answer="${esc(o.id)}">${esc(o.label)}</button>`).join('')}</div>
      <div class="wl-finder-nav"><button type="button" class="wl-text-button" id="wl-finder-back">${index ? '← Back' : 'Close'}</button><button type="button" class="wl-text-button" id="wl-finder-skip">Skip →</button></div>`);
    const go = (value: string) => {
      answers = answerStep(answers, s.id, value);
      if (index + 1 < STEP_COUNT) step(index + 1); else picks();
    };
    ctx.dialog.querySelectorAll<HTMLButtonElement>('[data-answer]').forEach(b => b.addEventListener('click', () => go(b.dataset.answer!)));
    ctx.dialog.querySelector('#wl-finder-skip')!.addEventListener('click', () => go(SKIP));
    ctx.dialog.querySelector('#wl-finder-back')!.addEventListener('click', () => { if (index) step(index - 1); else ctx.dialog.close(); });
  }

  function pickCard(r: FinderResult, i: number): string {
    const img = r.item ? ctx.thumb(r.item) : r.saved && (r.saved as LibraryWine).image_url ? `<img class="wl-cat-bottle" src="${esc((r.saved as LibraryWine).image_url)}" alt="" loading="lazy">` : '<span class="wl-cat-bottle wl-thumb-empty" aria-hidden="true">◎</span>';
    const notes = r.item ? catalogSections(r.item.wine).filter(n => n.label !== 'STORY') : [];
    const action = r.mine
      ? `<button type="button" class="wl-outline" data-open="${i}">Open in Winebrary</button>`
      : `<button type="button" class="wl-primary" data-save="${i}">Save to Winebrary</button>`;
    return `<li class="wl-pick"><div class="wl-pick-head">${img}<div class="wl-cat-copy"><span class="wl-kicker">${esc(COLOR_LABEL(r.type) || 'Wine')}${r.country ? ' · ' + esc(r.country) : ''}${r.mine ? ' · <em>In your Winebrary</em>' : ''}</span>
      <strong>${esc(r.title)}</strong><span class="wl-muted">${esc([r.producer, resultLine(r)].filter(Boolean).join(' · '))}</span></div></div>
      <ul class="wl-pick-why">${(r.reasons.length ? r.reasons : ['A good all-rounder for what you asked']).map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      ${notes.length ? `<details class="wl-pick-notes"><summary>Tasting notes</summary><dl class="wl-notes-dl">${notes.map(n => `<div><dt>${esc(n.label)}</dt><dd>${esc(n.text)}</dd></div>`).join('')}</dl></details>` : ''}
      <div class="wl-pick-actions">${action}</div></li>`;
  }

  function picks() {
    results = findWines(answers, ctx.items(), 8);
    const signedIn = !!ctx.userId();
    const empty = catalogHidden()
      ? 'The default wines are hidden, and nothing in your Winebrary fits these answers yet. Change an answer, or ask the sommelier below.'
      : 'Nothing fits all of that. Change an answer, or ask the sommelier below.';
    ctx.openDialog(`<p class="wl-kicker">FIND MY WINE · YOUR PICKS</p><h2>${results.length ? 'Here’s what I’d pour.' : 'Nothing fits yet.'}</h2>
      <p class="wl-muted wl-finder-sofar">${esc(answersLine(answers))}</p>
      <div class="wl-finder-tools"><button type="button" class="wl-outline" id="wl-finder-glasses">Show on glasses</button><button type="button" class="wl-text-button" id="wl-finder-change">← Change answers</button><button type="button" class="wl-text-button" id="wl-finder-restart">Start over</button></div>
      ${results.length ? `<ol class="wl-picks">${results.map(pickCard).join('')}</ol>` : `<p class="wl-empty">${esc(empty)}</p>`}
      <section class="wl-somm" aria-labelledby="wl-somm-title"><p class="wl-kicker">BEYOND THE CATALOG ✦</p><h3 id="wl-somm-title">Ask the sommelier.</h3>
        <p class="wl-muted">Three real bottles from anywhere for these answers, with the reason and how to serve them. Save any of them to your Winebrary.</p>
        ${signedIn ? `<label class="wl-somm-note">Anything else? <span class="wl-muted small">(optional)</span><textarea id="wl-somm-note" maxlength="280" rows="2" placeholder="A budget, a region, a bottle you loved…"></textarea></label>
        ${ctx.costHTML}<button type="button" class="wl-primary" id="wl-somm-ask" disabled>Ask the sommelier ✦</button>`
        : '<button type="button" class="wl-outline" id="wl-somm-link">Link your account to ask</button>'}
        <ol class="wl-picks wl-somm-picks" id="wl-somm-picks"></ol></section>`);
    const d = ctx.dialog;
    d.querySelector('#wl-finder-change')!.addEventListener('click', () => step(STEP_COUNT - 1));
    d.querySelector('#wl-finder-restart')!.addEventListener('click', () => { answers = {}; step(0); });
    d.querySelector('#wl-finder-glasses')!.addEventListener('click', () => void ctx.run(async () => {
      await ctx.showOnGlasses(answers);
      ctx.feedback('On your glasses: scroll the picks, tap one for its notes, tap again to save it.');
    }));
    d.querySelectorAll<HTMLButtonElement>('[data-save]').forEach(b => b.addEventListener('click', () => {
      const r = results[Number(b.dataset.save)];
      if (!ctx.userId()) { ctx.signIn(); return; }
      void ctx.run(async () => {
        const result = await ctx.saveCatalog(r.key);
        // A label, not a disabled button: the busy state re-enables every button when it ends.
        b.outerHTML = `<span class="wl-pick-saved">${result === 'exists' ? 'Already in your Winebrary' : 'Saved ✓'}</span>`;
        ctx.feedback(result === 'exists' ? `${r.title} is already in your Winebrary.` : `${r.title} is in your Winebrary. Set its year and make its wine card from there.`);
      });
    }));
    d.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(b => b.addEventListener('click', () => {
      const saved = results[Number(b.dataset.open)].saved as LibraryWine | null; if (saved) ctx.openSaved(saved);
    }));
    if (!signedIn) { d.querySelector('#wl-somm-link')!.addEventListener('click', () => ctx.signIn()); return; }
    sommelier();
  }

  function sommelier() {
    const d = ctx.dialog, ask = d.querySelector<HTMLButtonElement>('#wl-somm-ask')!, note = d.querySelector<HTMLTextAreaElement>('#wl-somm-note')!;
    const list = d.querySelector<HTMLOListElement>('#wl-somm-picks')!, revision = ctx.revision();
    const brief = briefOf(answers);
    const gate = ctx.costGate('sommelier', () => { ask.disabled = !gate.ready() || (!brief.length && !note.value.trim()); });
    note.addEventListener('input', () => gate.recompute());
    ask.addEventListener('click', () => void ctx.run(async () => {
      await gate.beforeSpend();
      const avoid = results.slice(0, 12).map(r => [r.title, r.producer].filter(Boolean).join(' – ').slice(0, 120));
      let reply: { wines: Suggestion[]; replayed?: boolean };
      try { reply = await accountRequest('sommelier', { request_id: ids.current, spend_consent: gate.consent(), brief, note: note.value.trim(), avoid }) as typeof reply; ids.settle(); }
      catch (e) { ids.settle(e); throw e; }
      if (revision !== ctx.revision()) return;
      list.innerHTML = reply.wines.map((w, i) => `<li class="wl-pick wl-somm-pick"><div class="wl-cat-copy"><span class="wl-kicker">SOMMELIER PICK · ${esc(COLOR_LABEL(w.color))}${w.country ? ' · ' + esc(w.country) : ''}</span>
        <strong>${esc(w.name)}</strong><span class="wl-muted">${esc([w.producer, w.vintage].filter(Boolean).join(' · '))}</span><span class="wl-muted small">${esc([w.grape, w.region].filter(Boolean).join(' · '))}</span></div>
        <p class="wl-pick-say">${esc(w.why)}</p>${w.serve ? `<p class="wl-muted small">${esc(w.serve)}</p>` : ''}
        <div class="wl-pick-actions"><button type="button" class="wl-primary" data-somm-save="${i}">Save to Winebrary</button></div></li>`).join('');
      if (!d.querySelector('.wl-somm-foot')) list.insertAdjacentHTML('afterend', '<p class="wl-muted small wl-somm-foot">From the wineLENS sommelier (AI), not a tasting. Check the label and vintage at the shop.</p>');
      list.querySelectorAll<HTMLButtonElement>('[data-somm-save]').forEach(b => b.addEventListener('click', () => void ctx.run(async () => {
        const w = reply.wines[Number(b.dataset.sommSave)];
        const year = /^(19|20)\d{2}$/.test(w.vintage.trim()) ? w.vintage.trim() : '';
        const item = await ctx.addWine({ wine_name: w.name, producer: w.producer || null, region: w.region || null, country: w.country || null, grape: w.grape || null, color: w.color,
          vintage_state: year ? 'year' : /^nv$|non.?vintage/i.test(w.vintage.trim()) ? 'non_vintage' : 'unknown', vintage: year });
        const actions = b.parentElement!;
        actions.innerHTML = '<span class="wl-pick-saved">Saved ✓</span><button type="button" class="wl-outline" data-somm-card>Make its wine card ✦</button>';
        actions.querySelector('[data-somm-card]')!.addEventListener('click', () => ctx.openSaved(item));
        ctx.feedback(`${w.name} is in your Winebrary. Its wine card adds the bottle image, notes and map pin (1 token).`);
      })));
      ctx.feedback(reply.replayed ? 'Here are the sommelier’s picks again. Nothing new was charged.' : 'The sommelier’s three picks are below.');
    }));
  }

  return {
    /** Start at the first question. */
    open() { answers = {}; results = []; step(0); },
  };
}
