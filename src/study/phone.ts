// ═══════════════════════════════════════════════════════════════════
// wineLENS — Study on the phone (PRD S-01…S-09, R-05)
// Renders the shared session: attempt → reveal with source → one rating.
// ═══════════════════════════════════════════════════════════════════
import { STUDY_CARDS, getCard, cardSources, wineReferences, type StudyCard } from './content';
import { allStates, saveStatus, onStudyChange, flagCard, retrySave, currentOwner, GUEST } from './store';
import { activeSession, startSession, endSession, onSessionChange, buildQueue, nextDueAt } from './session';
import { studySyncState, syncStudy } from './sync';
import { dueLabel, type Rating } from './scheduler';
import { catalogPhotoUrl } from '../bottle-assets';
import { getQuizHistory, inEvenHubHost } from '../sync';
import { seasons, season as seasonById, type Glyph, type SeasonId, type Stage } from './seasons';
import { PracticeRun, progress, seasonStats, stageStats, stageUnlocked, bossUnlocked, studyTotals, nextStage, bossId, answerLine } from './practice';
import { glyphCanvas } from './glyph';
import { openSeasonOnGlasses } from './glasses';

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
let openSeason: SeasonId | null = null;
let run: PracticeRun | null = null;
let flipping = false;

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
  // Seasons
  if (act === 'season') { openSeason = el.dataset.value as SeasonId; run = null; renderStudyPanel(); top(); }
  if (act === 'seasons') { openSeason = null; run = null; renderStudyPanel(); top(); }
  if (act === 'play') startRun(el.dataset.value!);
  if (act === 'on-glasses' && openSeason) { el.setAttribute('disabled', ''); await openSeasonOnGlasses(openSeason).catch(() => {}); el.textContent = 'Open on your glasses ✓'; }
  if (act === 'flip' && run?.current && !flipping) {
    // Turn the card over, then swap in the back.
    flipping = true; root?.querySelector('.st-flash')?.classList.add('st-flipping');
    setTimeout(() => { flipping = false; run?.flip(); }, 260);
  }
  if (act === 'grade' && run) await run.grade(el.dataset.value === 'yes');
  if (act === 'pick' && run) await run.choose(el.dataset.value!);
  if (act === 'run-next' && run) { await run.next(); focusRun(); }
  if (act === 'run-stop' && run) run.stop();
  if (act === 'run-again' && run) startRun(run.stage.boss ? 'boss' : run.stage.id);
  if (act === 'run-up' && run) { const up = nextStage(run.season, run.stage); if (up) startRun(up.boss ? 'boss' : up.id); }
  if (act === 'run-close') { run = null; renderStudyPanel(); top(); }
}
function top() { requestAnimationFrame(() => root?.scrollIntoView({ block: 'start', behavior: 'smooth' })); }
function focusRun() { requestAnimationFrame(() => root?.querySelector<HTMLElement>('.st-run [data-focus]')?.focus()); }
function startRun(stageId: string) {
  if (!openSeason) return;
  const s = seasonById(openSeason);
  const stage = stageId === 'boss' ? s.boss : s.stages.find(st => st.id === stageId);
  if (!stage) return;
  run = new PracticeRun(s, stage, 'phone');
  run.on(() => renderStudyPanel());
  renderStudyPanel(); top(); focusRun();
}
function focusCard() { requestAnimationFrame(() => root?.querySelector<HTMLElement>('#st-typed, .st-card h3')?.focus()); }

export async function renderStudyPanel() {
  if (!root) return;
  if (!legacyHtml) legacyHtml = await legacyHistoryHtml();
  const s = activeSession();
  if (run) root.innerHTML = `<div class="st-wrap">${runHtml(run)}</div>`;
  else if (openSeason) root.innerHTML = `<div class="st-wrap">${seasonHtml(openSeason)}</div>`;
  else root.innerHTML = `<div class="st-wrap">${header()}${s ? sessionHtml() : seasonsHtml() + overviewHtml()}<details class="st-more"><summary>Daily review cards and sources</summary>${progressHtml()}${aboutHtml()}</details>${legacyHtml}</div>`;
  paintGlyphs();
}
function renderStatusOnly() { const el = root?.querySelector('#st-status'); if (el) el.outerHTML = statusHtml(); }

function header(): string {
  const states = allStates().filter(s => !s.flagged);
  const now = new Date().toISOString();
  const due = states.filter(s => s.state.step >= 0 && s.state.due_at && s.state.due_at <= now).length;
  const count = (k: string) => states.filter(s => s.status === k).length;
  const totals = studyTotals();
  return `<header class="st-head"><p class="wl-kicker">STUDY</p><h2>Learn wine<br>one card at a time.</h2>
    <dl class="st-stats st-game"><div><dt>XP</dt><dd>${totals.xp}</dd></div><div><dt>Day streak</dt><dd>${totals.streak}</dd></div><div><dt>Stars</dt><dd>${totals.stars}<small>/${totals.maxStars}</small></dd></div><div><dt>Review ready</dt><dd>${buildQueue().length}</dd></div></dl>
    ${statusHtml()}<p class="sr-only">Daily review: ${count('new')} new, ${count('needs-review')} to review, ${count('stable')} stable.</p></header>`;
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
  return `<section class="st-start" aria-labelledby="st-start-title"><p class="wl-kicker">DAILY REVIEW · SOURCED FACTS · SPACED REPETITION</p>
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
  const photo = card.hide_image ? null : catalogPhotoUrl('./', card.wine_id);
  const image = photo ? `<img class="st-bottle" src="${esc(photo)}" alt="${esc(card.subject)} bottle (catalog photograph, label year may differ)">`
    : card.hide_image ? `<div class="st-bottle st-hidden-label" role="img" aria-label="Bottle hidden">LABEL<br>HIDDEN<span>so it can’t give the answer away</span></div>` : '';
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

// ═══ Seasons (PolyGot model) ═══
const glyphUrls = new Map<string, Promise<string>>();
const glyphKey = (g: Glyph) => JSON.stringify(g);
function glyphUrl(g: Glyph): Promise<string> {
  const key = glyphKey(g);
  if (!glyphUrls.has(key)) {
    const job = glyphCanvas(g, new URL(import.meta.env.BASE_URL || './', location.href).href).then(c => c.toDataURL('image/png'));
    job.catch(() => glyphUrls.delete(key));
    glyphUrls.set(key, job);
  }
  return glyphUrls.get(key)!;
}
const ready = new Map<string, string>();
const glyphs = new Map<string, Glyph>();
/** A glyph image: the cached picture at once, or a placeholder filled when it is drawn. */
function glyphImg(g: Glyph, cls: string, alt = ''): string {
  const key = glyphKey(g); glyphs.set(key, g);
  return `<img class="st-glyph ${cls}" data-glyph="${esc(key)}" ${ready.has(key) ? `src="${ready.get(key)}"` : ''} alt="${esc(alt || g.word)}" width="288" height="128">`;
}
function paintGlyphs() {
  root?.querySelectorAll<HTMLImageElement>('img[data-glyph]:not([src])').forEach(img => {
    const key = img.dataset.glyph!, g = glyphs.get(key); if (!g) return;
    void glyphUrl(g).then(url => { ready.set(key, url); img.src = url; }).catch(() => img.classList.add('st-glyph-missing'));
  });
}
const stars = (n: number) => `<span class="st-stars" aria-label="${n} of 3 stars">${'★'.repeat(n)}<span>${'★'.repeat(3 - n)}</span></span>`;

function seasonsHtml(): string {
  const p = progress();
  return `<section class="st-seasons" aria-labelledby="st-seasons-title"><div class="st-seasons-head"><h3 id="st-seasons-title">Seasons</h3><p class="wl-muted">Stages of quick cards: meet, flip, pick. Earn stars to unlock the next stage, then face the boss.</p></div>
    <div class="st-season-grid">${seasons().map(s => {
      const st = seasonStats(s, p), pct = Math.round(st.stars / st.maxStars * 100);
      return `<button class="st-season" data-st="season" data-value="${s.id}">${glyphImg(s.icon, 'st-season-glyph')}
        <span class="st-season-copy"><strong>${esc(s.title)}</strong><span>${esc(s.blurb)}</span>
        <span class="st-season-meta"><span>★ ${st.stars}/${st.maxStars}</span><span>${st.cleared}/${st.stages} stages${st.boss ? ' · boss ◆' : ''}</span></span>
        <span class="st-bar" aria-hidden="true"><span style="width:${pct}%"></span></span>
        <span class="st-season-go">${st.next ? `${st.stars ? 'Continue' : 'Start'}: ${esc(st.next.title)} ↗` : st.boss ? 'Replay any stage ↗' : 'Face the boss ↗'}</span></span></button>`;
    }).join('')}</div><p class="wl-muted small">Seasons use the wineLENS catalog. They're practice: the daily review below tracks sourced facts over time.</p></section>`;
}

function seasonHtml(id: SeasonId): string {
  const s = seasonById(id), p = progress(), st = seasonStats(s, p);
  const node = (stage: Stage, i: number) => {
    const open = stageUnlocked(s, i, p), stats = stageStats(stage, p), meets = stage.cards.filter(c => c.kind === 'meet').length;
    return `<li class="st-node${open ? '' : ' st-locked'}${stats.stars ? ' st-done' : ''}"><span class="st-node-dot" aria-hidden="true">${i + 1}</span>
      <div class="st-node-copy"><strong>${esc(stage.title)}</strong><span>${stage.cards.length} cards${meets ? ` · ${meets} new` : ''}${stats.played ? ` · ${stats.right}/${stats.total} right` : ''}</span></div>
      ${open ? `${stars(stats.stars)}<button class="${stats.stars ? 'wl-outline' : 'wl-primary'} st-play" data-st="play" data-value="${stage.id}">${stats.played ? 'Play again' : 'Play'}</button>` : `<span class="st-lock">Get ★ on stage ${i} first</span>`}</li>`;
  };
  const bossOpen = bossUnlocked(s, p), bossWon = p.bossCleared.has(bossId(s.id));
  return `<section class="st-season-page"><button class="wl-text-button st-back" data-st="seasons">← All seasons</button>
    <div class="st-season-hero">${glyphImg(s.icon, 'st-hero-glyph')}<div><p class="wl-kicker">SEASON · ★ ${st.stars}/${st.maxStars}</p><h2>${esc(s.title)}</h2><p class="wl-muted">${esc(s.blurb)}</p>
    ${inEvenHubHost() ? '<button class="wl-outline" data-st="on-glasses">Play on glasses ↗</button>' : ''}</div></div>
    <ol class="st-path">${s.stages.map(node).join('')}
      <li class="st-node st-boss${bossOpen ? '' : ' st-locked'}${bossWon ? ' st-done' : ''}"><span class="st-node-dot" aria-hidden="true">◆</span>
      <div class="st-node-copy"><strong>Boss</strong><span>8 cards from the whole season · 3 hearts${bossWon ? ' · defeated' : ''}</span></div>
      ${bossOpen ? `<button class="${bossWon ? 'wl-outline' : 'wl-primary'} st-play" data-st="play" data-value="boss">${bossWon ? 'Fight again' : 'Face the boss'}</button>` : '<span class="st-lock">Earn ★ on every stage</span>'}</li></ol></section>`;
}

function runHtml(r: PracticeRun): string {
  if (r.finished || !r.current) {
    const sum = r.summary(), up = r.boss ? null : nextStage(r.season, r.stage);
    const title = r.boss ? (sum.cleared ? 'Boss defeated.' : sum.stopped ? 'Boss paused.' : 'Out of hearts.') : sum.stopped ? 'Paused.' : sum.cleared ? 'Stage clear.' : 'Keep going.';
    return `<section class="st-run st-run-done" aria-live="polite"><p class="wl-kicker">${esc(r.season.title.toUpperCase())} · ${r.boss ? 'BOSS' : `STAGE ${r.stage.index + 1}`}</p>
      <h2 tabindex="-1" data-focus>${title}</h2>${r.boss ? (sum.cleared ? '<p class="st-big-stars">◆ ◆ ◆</p>' : '') : `<p class="st-big-stars">${stars(sum.stars)}</p>`}
      <dl class="st-stats st-game"><div><dt>Right</dt><dd>${sum.right}<small>/${sum.total}</small></dd></div><div><dt>XP earned</dt><dd>+${sum.xp}</dd></div><div><dt>Best combo</dt><dd>x${sum.bestCombo}</dd></div><div><dt>Total XP</dt><dd>${progress().xp}</dd></div></dl>
      <p class="wl-muted">${!r.boss && !sum.cleared && !sum.stopped ? 'Get 60% right to unlock the next stage. Answers you got right stay counted.' : up ? `Up next: ${up.boss ? 'the boss' : esc(up.title)}.` : r.boss && sum.cleared ? 'Season complete. Replay stages any time to keep the stars.' : ''}</p>
      <div class="st-after">${up ? `<button class="wl-primary" data-st="run-up">${up.boss ? 'Face the boss ↗' : `Next: ${esc(up.title)} ↗`}</button>` : ''}<button class="${up ? 'wl-outline' : 'wl-primary'}" data-st="run-again">Play again</button><button class="wl-text-button" data-st="run-close">Season map</button></div></section>`;
  }
  const t = r.current, c = t.card;
  const hearts = r.hearts !== null ? `<span class="st-hearts" aria-label="${r.hearts} hearts left">${'♥'.repeat(r.hearts)}<span>${'♥'.repeat(3 - r.hearts)}</span></span>` : '';
  const hud = `<div class="st-hud"><span>${esc(r.season.short)} · ${r.boss ? 'BOSS' : `STAGE ${r.stage.index + 1}`}</span><span>${r.index + 1}/${r.total}</span><span>${progress().xp} XP</span>${r.combo >= 2 ? `<span class="st-combo">x${r.combo}</span>` : ''}${hearts}<button class="wl-text-button" data-st="run-stop">Stop</button></div>
    <div class="st-bar" aria-hidden="true"><span style="width:${Math.round(r.index / r.total * 100)}%"></span></div>`;
  const side = t.mode === 'meet' || t.phase === 'front' ? c.front : c.back;
  const kicker = t.mode === 'meet' ? 'NEW' : t.mode === 'flash' ? 'FLASH CARD' : t.mode === 'spot' ? 'TRUE OR FALSE' : 'PICK ONE';
  let body = '';
  if (t.mode === 'meet') body = `<p class="st-prompt">${esc(c.prompt)}</p><p class="st-detail">${esc(c.detail)}</p><button class="wl-primary" data-st="run-next" data-focus>Next ↗</button>`;
  else if (t.phase === 'answered') {
    const right = t.correct === true;
    body = `<p class="st-prompt">${esc(c.prompt)}</p>${t.options.length ? `<div class="st-options">${t.options.map(o => `<button class="st-option${o === c.answer ? ' st-right' : o === t.chosen ? ' st-wrong' : ''}" disabled>${esc(o)}</button>`).join('')}</div>` : ''}
      <div class="st-reveal" aria-live="polite"><p class="st-verdict">${right ? '★ Right' : 'Not quite'} · +${t.gained} XP${!right && r.hearts !== null ? ' · −1 ♥' : ''}</p>${answerLine(t) ? `<p class="st-answer">${esc(answerLine(t).replace(/^Answer: /, ''))}</p>` : ''}<p>${esc(c.detail)}</p>${t.saveError ? `<p class="st-error">${esc(t.saveError)}</p>` : ''}</div>
      <div class="st-after"><button class="wl-primary" data-st="run-next" data-focus>${r.hearts === 0 ? 'See how you did ↗' : r.index + 1 < r.total ? 'Next card ↗' : 'Finish ↗'}</button></div>`;
  } else if (t.mode === 'flash') {
    body = t.phase === 'front' ? `<p class="st-prompt">${esc(c.prompt)}</p><button class="wl-primary" data-st="flip" data-focus>Flip the card ↻</button>`
      : `<p class="st-answer">${esc(c.answer)}</p><p class="st-detail">${esc(c.detail)}</p><p class="st-rate-q">Did you know it?</p><div class="st-grade"><button class="st-rating st-good" data-st="grade" data-value="yes" data-focus><strong>Knew it</strong><span>+${10} XP and the combo grows</span></button><button class="st-rating st-again" data-st="grade" data-value="no"><strong>Not yet</strong><span>It comes back next time</span></button></div>`;
  } else {
    body = `<p class="st-prompt">${esc(c.prompt)}</p><div class="st-options${t.mode === 'spot' ? ' st-tf' : ''}" role="group" aria-label="Choose an answer">${t.options.map((o, i) => `<button class="st-option" data-st="pick" data-value="${esc(o)}" ${i === 0 ? 'data-focus' : ''}>${esc(o)}</button>`).join('')}</div>`;
  }
  return `<section class="st-run" aria-labelledby="st-run-k">${hud}
    <div class="st-flash${t.phase === 'back' ? ' st-back' : ''}${t.phase === 'answered' ? (t.correct ? ' st-good' : ' st-miss') : ''}">${glyphImg(side, 'st-card-glyph', side.word || c.prompt)}</div>
    <p class="wl-kicker" id="st-run-k">${kicker}${c.wineId && t.phase !== 'front' ? ' · CATALOG' : ''}</p>${body}</section>`;
}
