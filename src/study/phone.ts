// ═══════════════════════════════════════════════════════════════════
// wineLENS — Study on the phone (PRD S-01…S-09, R-05)
// Renders the shared session: attempt → reveal with source → one rating.
// ═══════════════════════════════════════════════════════════════════
import { STUDY_CARDS, getCard, cardSources, wineReferences, type StudyCard } from './content';
import { allStates, saveStatus, onStudyChange, flagCard, retrySave, currentOwner, GUEST } from './store';
import { activeSession, startSession, endSession, onSessionChange, buildQueue, nextDueAt } from './session';
import { studySyncState, syncStudy } from './sync';
import { dueLabel, type Rating } from './scheduler';
import { assetIdFor } from '../identity';
import { bottleImageUrl } from '../bottle-assets';
import { getQuizHistory } from '../sync';

const RATINGS: Rating[] = ['again', 'hard', 'good', 'easy'];
const RATING_LABEL: Record<Rating, string> = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };
const RATING_HINT: Record<Rating, string> = { again: 'I didn’t know it', hard: 'With effort', good: 'I knew it', easy: 'Instantly' };
const SKILL: Record<string, string> = { 'release-identity': 'Release identity', origin: 'Origin', grape: 'Grape', appellation: 'Appellation' };
const STATUS: Record<string, string> = { new: 'New', learning: 'Learning', 'needs-review': 'Review this', stable: 'Stable' };
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const tz = () => -new Date().getTimezoneOffset();
const fmtDate = (iso: string) => new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

let root: HTMLElement | null = null;
let preferRecognition = false;
let quick = false;
const QUICK_CARDS = 3;
let legacyHtml = '';

export function initStudyPanel(container: HTMLElement) {
  root = container;
  container.addEventListener('click', e => void onClick(e));
  container.addEventListener('submit', e => { e.preventDefault(); const s = activeSession(); const input = container.querySelector<HTMLTextAreaElement>('#st-typed'); s?.reveal(input?.value ?? ''); });
  onSessionChange(() => renderStudyPanel());
  onStudyChange(() => { if (!activeSession()) renderStudyPanel(); else renderStatusOnly(); });
}

async function onClick(e: Event) {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-st]');
  if (!el) return;
  const s = activeSession();
  const act = el.dataset.st!;
  if (act === 'start') { startSession(preferRecognition ? 'recognition' : 'recall', undefined, quick ? QUICK_CARDS : Infinity); focusCard(); }
  if (act === 'length') { quick = el.dataset.value === 'quick'; renderStudyPanel(); }
  if (act === 'mode') { preferRecognition = el.dataset.value === 'recognition'; s?.setMode(preferRecognition ? 'recognition' : 'recall'); renderStudyPanel(); }
  if (act === 'rate' && s) { await s.rate(el.dataset.value as Rating, 'phone'); }
  if (act === 'choose' && s) { await s.choose(el.dataset.value!, 'phone'); }
  if (act === 'next' && s) { s.next(); focusCard(); }
  if (act === 'stop' && s) { s.stop(); }
  if (act === 'close') { endSession(); }
  if (act === 'flag' && s?.current) { await flagCard(s.current.card.id); s.current.saveError = 'Flagged. This card is paused until the reference is reviewed.'; renderStudyPanel(); }
  if (act === 'retry-save') { await retrySave().catch(() => {}); await syncStudy(); renderStudyPanel(); }
}
function focusCard() { requestAnimationFrame(() => root?.querySelector<HTMLElement>('#st-typed, .st-card h3')?.focus()); }

export async function renderStudyPanel() {
  if (!root) return;
  if (!legacyHtml) legacyHtml = await legacyHistoryHtml();
  const s = activeSession();
  root.innerHTML = `<div class="st-wrap">${header()}${s ? sessionHtml() : overviewHtml()}${progressHtml()}${aboutHtml()}${legacyHtml}</div>`;
}
function renderStatusOnly() { const el = root?.querySelector('#st-status'); if (el) el.outerHTML = statusHtml(); }

function header(): string {
  const states = allStates().filter(s => !s.flagged);
  const now = new Date().toISOString();
  const due = states.filter(s => s.state.step >= 0 && s.state.due_at && s.state.due_at <= now).length;
  const count = (k: string) => states.filter(s => s.status === k).length;
  return `<header class="st-head"><p class="wl-kicker">STUDY TODAY</p><h2>Recall first.<br>Then check the source.</h2>
    <dl class="st-stats"><div><dt>Due</dt><dd>${due}</dd></div><div><dt>New</dt><dd>${count('new')}</dd></div><div><dt>Review this</dt><dd>${count('needs-review')}</dd></div><div><dt>Stable</dt><dd>${count('stable')}</dd></div></dl>
    ${statusHtml()}</header>`;
}
function statusHtml(): string {
  const save = saveStatus();
  const sync = studySyncState();
  const guest = currentOwner() === GUEST;
  let text = guest ? 'Saved on this device. Sign in to keep progress with your account.' : 'Saved on this device.';
  if (!guest && save.pending) text += sync === 'unavailable' ? ` ${save.pending} waiting: the study service isn’t live yet.` : sync === 'offline' ? ` ${save.pending} waiting for a connection.` : ` ${save.pending} waiting to sync.`;
  if (!guest && !save.pending && sync === 'synced') text = 'Saved and synced to your account.';
  const error = save.state === 'error';
  return `<p id="st-status" class="st-status${error ? ' st-error' : ''}" role="status" aria-live="polite">${esc(error ? save.message : text)}${error || (save.pending && !guest) ? ' <button class="wl-text-button" data-st="retry-save">Retry</button>' : ''}</p>`;
}

function overviewHtml(): string {
  const queue = buildQueue();
  const next = nextDueAt();
  const now = new Date().toISOString();
  const withChoices = queue.filter(c => c.options).length;
  return `<section class="st-start" aria-labelledby="st-start-title">
    <h3 id="st-start-title">${queue.length ? `${queue.length} ${queue.length === 1 ? 'card' : 'cards'} ready` : 'Nothing due right now'}</h3>
    <p class="wl-muted">${queue.length ? 'Answer from memory before you reveal. You can stop at any time; rated cards stay saved.' : next ? `Next review ${esc(dueLabel(next, now, tz()))}. Spacing reviews out is the point.` : 'Cards appear when researched wines have approved facts.'}</p>
    ${queue.length ? `<fieldset class="st-mode"><legend>Length</legend>
      <label><input type="radio" name="st-length" data-st="length" data-value="standard" ${!quick ? 'checked' : ''}> Standard <span class="wl-muted">· about 5 minutes, all ${queue.length} ready</span></label>
      <label><input type="radio" name="st-length" data-st="length" data-value="quick" ${quick ? 'checked' : ''}> Quick <span class="wl-muted">· about 2 minutes, ${Math.min(QUICK_CARDS, queue.length)} cards</span></label></fieldset>
      <fieldset class="st-mode"><legend>Answer by</legend>
      <label><input type="radio" name="st-mode" data-st="mode" data-value="recall" ${!preferRecognition ? 'checked' : ''}> Recall <span class="wl-muted">· counts toward review</span></label>
      <label><input type="radio" name="st-mode" data-st="mode" data-value="recognition" ${preferRecognition ? 'checked' : ''} ${withChoices ? '' : 'disabled'}> Multiple choice <span class="wl-muted">· practice, ${withChoices} of ${queue.length} cards</span></label></fieldset>
      <button class="wl-primary" data-st="start">Start · ${quick ? Math.min(QUICK_CARDS, queue.length) : queue.length} ${(quick ? Math.min(QUICK_CARDS, queue.length) : queue.length) === 1 ? 'card' : 'cards'} ↗</button>` : ''}
  </section>`;
}

function sourceChips(card: StudyCard): string {
  return `<ul class="st-sources" aria-label="Sources">${cardSources(card).map(c => `<li><a href="${esc(c.source.url)}" target="_blank" rel="noopener noreferrer">${esc(c.source.publisher)}</a> · ${esc(c.source.title)} · ${esc(c.scope)} · checked ${esc(fmtDate(c.source.retrieved_at))}</li>`).join('')}</ul>`;
}

function sessionHtml(): string {
  const s = activeSession()!;
  if (s.finished || !s.current) {
    const sum = s.summary();
    const now = new Date().toISOString();
    return `<section class="st-card st-summary" aria-live="polite"><p class="wl-kicker">${sum.stopped ? 'SESSION PAUSED · RATED CARDS ARE SAVED' : 'SESSION COMPLETE'}</p>
      <h3 tabindex="-1">${sum.reviewed} ${sum.reviewed === 1 ? 'review' : 'reviews'} saved${sum.again ? ` · ${sum.again} to revisit` : ''}</h3>
      <p>Next review: <strong>${sum.nextDue ? esc(dueLabel(sum.nextDue, now, tz())) : 'none scheduled'}</strong></p>
      ${sum.saveErrors ? '<p class="st-error">Some reviews are still waiting to be written to storage.</p>' : ''}
      ${sum.takeaway ? `<div class="st-takeaway"><p class="wl-kicker">ONE THING TO KEEP</p><p><strong>${esc(sum.takeaway.subject)}:</strong> ${esc(sum.takeaway.answer)}</p><p class="wl-muted">${esc(sum.takeaway.explanation)}</p></div>` : ''}
      <button class="wl-outline" data-st="close">Done</button></section>`;
  }
  const p = s.current;
  const card = p.card;
  const asset = card.hide_image ? null : assetIdFor(card.wine_id);
  const image = asset ? `<img class="st-bottle" src="${esc(bottleImageUrl('./', asset))}" alt="${esc(card.subject)} bottle (catalog photograph, label year may differ)">`
    : `<div class="st-bottle st-hidden-label" role="img" aria-label="Bottle hidden">LABEL<br>HIDDEN<span>so it can’t give the answer away</span></div>`;
  let body = '';
  if (p.mode === 'recognition') {
    body = `<div class="st-options" role="group" aria-label="Choose an answer">${card.options!.map(o => {
      const state = p.revealed ? (o === card.answer ? ' st-right' : o === p.chosen ? ' st-wrong' : '') : '';
      return `<button class="st-option${state}" data-st="choose" data-value="${esc(o)}" ${p.revealed ? 'disabled' : ''}>${esc(o)}${p.revealed && o === card.answer ? ' <span class="sr-only">(correct answer)</span>' : ''}</button>`;
    }).join('')}</div>`;
    if (p.revealed) body += `<div class="st-reveal" aria-live="polite"><p class="st-verdict">${p.chosen === card.answer ? 'Correct' : 'Review this'}</p><p class="st-answer">${esc(card.answer)}</p><p>${esc(card.explanation)}</p>${sourceChips(card)}<p class="wl-muted small">Multiple choice is recorded as recognition. It doesn’t move your review schedule.</p></div>`;
  } else if (!p.revealed) {
    body = `<form class="st-attempt"><label for="st-typed">Your answer <span class="wl-muted">(optional: say it or type it)</span></label>
      <textarea id="st-typed" rows="2" autocomplete="off" spellcheck="false"></textarea>
      <button class="wl-primary" type="submit">Reveal answer</button></form>`;
  } else {
    const preview = s.ratingPreview()!;
    const typed = p.typedMatches === null ? '' : `<p class="st-match">${p.typedMatches ? 'Your answer matches the reference.' : 'Your answer doesn’t match the reference. Compare below.'}</p>`;
    body = `<div class="st-reveal" aria-live="polite">${typed}<p class="st-answer">${esc(card.answer)}</p><p>${esc(card.explanation)}</p>${sourceChips(card)}</div>
      ${p.done ? '' : `<p class="st-rate-q" id="st-rate-q">How well did you recall it?</p><div class="st-ratings" role="group" aria-labelledby="st-rate-q">${RATINGS.map(r => `<button class="st-rating st-${r}" data-st="rate" data-value="${r}"><strong>${RATING_LABEL[r]}</strong><span>${RATING_HINT[r]}</span><small>Next: ${esc(preview[r])}</small></button>`).join('')}</div>`}`;
  }
  const after = p.done ? `<div class="st-after"><p class="st-saved" role="status">${esc(p.saveError || 'Saved.')}</p><button class="wl-primary" data-st="next">${s.index + 1 < s.total ? 'Next card ↗' : 'Finish ↗'}</button></div>` : (p.saveError ? `<p class="st-error" role="alert">${esc(p.saveError)}</p>` : '');
  return `<section class="st-card" aria-labelledby="st-q">
    <div class="st-card-top"><p class="wl-kicker">CARD ${s.index + 1} OF ${s.total} · ${esc((SKILL[card.skill] ?? card.skill).toUpperCase())}${p.retry ? ' · RETRY' : ''}</p><button class="wl-text-button" data-st="stop">Stop</button></div>
    <div class="st-card-grid">${image}<div><h3 id="st-q" tabindex="-1">${esc(card.subject)}</h3><p class="st-prompt">${esc(card.prompt)}</p>${body}${after}
    ${p.revealed ? `<button class="wl-text-button st-flag" data-st="flag">Flag this question</button>` : ''}</div></div></section>`;
}

function progressHtml(): string {
  const now = new Date().toISOString();
  const rows = allStates().map(({ cardId, state, status, flagged }) => {
    const card = getCard(cardId)!;
    const label = flagged ? 'Paused' : STATUS[status];
    return `<li><div><strong>${esc(card.subject)}</strong><span class="wl-muted"> · ${esc(SKILL[card.skill] ?? card.skill)}</span></div>
      <div class="st-row-meta"><span class="st-pill st-${flagged ? 'paused' : status}">${label}</span><span>${state.step < 0 ? 'Not started' : `Due ${esc(dueLabel(state.due_at, now, tz()))}`}</span><span>${state.recall_reviews} recall${state.recognition_reviews ? ` · ${state.recognition_correct}/${state.recognition_reviews} recognition` : ''}</span></div></li>`;
  }).join('');
  return `<section class="st-progress" aria-labelledby="st-prog"><h3 id="st-prog">Your cards</h3>
    <p class="wl-muted small">“Stable” means two correct recall reviews on different days, the latest at least a week after you first learned the card. It’s a starting rule, and forgetting reopens the card.</p>
    <ul>${rows}</ul></section>`;
}

function aboutHtml(): string {
  const wines = [...new Set(STUDY_CARDS.map(c => c.wine_id))];
  const open = ['wl_cabernet-sauvignon-pahlmeyer', 'wl_sancerre-cote-des-monts-damnes-hubert-brochard'].flatMap(id => wineReferences(id).open);
  return `<section class="st-about"><h3>Where these cards come from</h3>
    <p>Every scored card cites facts checked against the producer’s own documents: ${wines.length} wines so far. Catalog details for the other wines stay unverified and aren’t scored. Tasting notes are never marked right or wrong.</p>
    ${open.length ? `<p class="wl-kicker">WAITING FOR REVIEW</p><ul>${open.map(o => `<li>${esc(o.note)}</li>`).join('')}</ul>` : ''}</section>`;
}

async function legacyHistoryHtml(): Promise<string> {
  const history = await getQuizHistory().catch(() => []);
  if (!history.length) return ' ';
  return `<details class="st-legacy"><summary>Earlier quiz results (${history.length})</summary>
    <p class="wl-muted small">Multiple-choice results from the previous quiz, based on unverified catalog data. Kept for reference; not counted as recall.</p>
    <ul>${history.slice(0, 20).map(h => `<li>${esc(h.wineName)} · ${h.pct}% · ${esc(fmtDate(h.date))}</li>`).join('')}</ul></details>`;
}
