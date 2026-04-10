// ═══════════════════════════════════════════════════════════════════
// sommNI — Phone-side Interactive Dashboard
// Full feature parity with sommni-dashboard-v2.jsx
// Vanilla TS — runs inside Even Hub webview
// ═══════════════════════════════════════════════════════════════════

import {
  getInventory, getInventoryStats, adjustStock, setStock,
  getPairings, createPairing, updatePairing, deletePairing,
  getQuizStats, getQuizHistory, getLearnedVault, getFavorites,
  toggleFavorite, saveFavorites, recordQuizAnswer, recordQuizSession,
  checkAndUpdateLearned, getCourseState, saveCourseState,
  type Pairing, type CourseSlot,
} from './sync';
import {
  WINES, WINE_TYPES, COUNTRIES, TYPE_DISPLAY, TOTAL_WINES,
  getWineId, lookupWineById, getWinesForCountry, getGrapesForCountry,
  getWinesForGrape, scoreWine, getRankedWines, getFlavorOptionsForType,
  type Wine, type WineType,
} from './constants';

// ── Type colors matching dashboard v2 ──
const TYPE_COLORS: Record<string, string> = {
  Red: '#722F37', White: '#C2B280', Sparkling: '#D4AF37',
  Rose: '#C97B84', Orange: '#D4772C', Dessert: '#7B4A8C',
};

// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════

let activeTab = 'home';

// Cellar state
let cellarView: 'types' | 'countries' | 'grapes' | 'wines' = 'types';
let cellarType: WineType | null = null;
let cellarCountry: string | null = null;
let cellarGrape: string | null = null;
let cellarFilter: 'all' | '85' | '86' = 'all';
let cellarSearch = '';
let inventoryCache: Record<string, number> = {};
let favoritesCache: string[] = [];

// Course builder state
let courseSlots: CourseSlot[] = [{ answers: {}, wineId: null, wineName: null }];
let activeCourseIdx: number | null = null;
let courseStep: number | 'results' | null = null;

// Finder flow definition
const FINDER_FLOW = [
  { key: 'type', label: 'WHAT ARE YOU IN THE MOOD FOR', options: [
    { id: 'Red', label: 'Red' }, { id: 'White', label: 'White' },
    { id: 'Sparkling', label: 'Sparkling' }, { id: 'Rose', label: 'Rosé' },
    { id: 'Orange', label: 'Orange' }, { id: 'Dessert', label: 'Dessert' },
  ], skipLabel: 'Surprise me' },
  { key: 'world', label: 'OLD WORLD OR NEW WORLD', options: [
    { id: 'old', label: 'Old World' }, { id: 'new', label: 'New World' },
  ], skipLabel: "Don't care" },
  { key: 'body', label: 'HOW SHOULD IT FEEL', options: [
    { id: 'light', label: 'Light & Refreshing' },
    { id: 'medium', label: 'Medium & Balanced' },
    { id: 'full', label: 'Full & Rich' },
  ] },
  { key: 'flavor', label: 'WHAT SOUNDS GOOD RIGHT NOW', dynamicOptions: true },
  { key: 'vibe', label: 'WHAT KIND OF VIBE', options: [
    { id: 'fresh', label: 'Fresh & Crisp' }, { id: 'smooth', label: 'Smooth & Easy' },
    { id: 'bold', label: 'Bold & Powerful' }, { id: 'funky', label: 'Funky & Adventurous' },
    { id: 'elegant', label: 'Elegant & Complex' }, { id: 'cozy', label: 'Cozy & Warm' },
  ] },
];

function getFlavorOptions(answers: Record<string, string>): { id: string; label: string }[] {
  const t = answers.type;
  if (t === 'White' || t === 'Rose' || t === 'Orange') return [
    { id: 'citrus', label: 'Citrus' }, { id: 'stone_fruit', label: 'Stone Fruit' },
    { id: 'tropical', label: 'Tropical' }, { id: 'floral', label: 'Floral' },
    { id: 'mineral', label: 'Mineral & Salty' },
  ];
  if (t === 'Sparkling') return [
    { id: 'citrus', label: 'Bright & Zesty' },
    { id: 'smoky', label: 'Creamy & Toasty' },
    { id: 'red_fruits', label: 'Fruity & Fun' },
  ];
  return [
    { id: 'dark_fruits', label: 'Dark Fruits' }, { id: 'red_fruits', label: 'Red Fruits' },
    { id: 'earthy', label: 'Earthy' }, { id: 'spicy', label: 'Spicy' },
    { id: 'smoky', label: 'Smoky & Oaky' },
  ];
}

// Pairings state
let pairingsCache: Pairing[] = [];
let activePairingId: string | null = null;
let pairingSearchQ = '';
let pairingAddingWine = false;
let pairingEditingName = false;
let pairingEditingNotes = false;

// Study/Quiz state
let studyMode: 'browse' | 'study' | 'quiz' | 'score' = 'browse';
let studyCardIdx = 0;
let studyFlipped = false;
let quizWineId: string | null = null;
let quizQuestions: { category: string; question: string; correct: string; options: string[] }[] = [];
let quizQIdx = 0;
let quizSelected: string | null = null;
let quizShowResult = false;
let quizCorrectCount = 0;
let quizTotalCount = 0;

// ═══════════════════════════════════════════════════════════════════
// QUIZ QUESTION GENERATOR
// ═══════════════════════════════════════════════════════════════════

function generateDashboardQuestions(wineId: string): { category: string; question: string; correct: string; options: string[] }[] {
  const lookup = lookupWineById(wineId);
  if (!lookup) return [];
  const wine = lookup.wine;
  const qs: { category: string; question: string; correct: string; options: string[] }[] = [];

  // Build a pool of other wines for distractors
  const allWines: { wine: Wine; type: WineType; country: string }[] = [];
  for (const t of WINE_TYPES) {
    for (const c of COUNTRIES[t]) {
      for (const w of (WINES[t]?.[c] || [])) {
        allWines.push({ wine: w, type: t, country: c });
      }
    }
  }
  const others = allWines.filter(w => w.wine.name !== wine.name);
  const shuffle = <T>(a: T[]): T[] => [...a].sort(() => Math.random() - 0.5);
  const pick3 = <T>(arr: T[]): T[] => shuffle(arr).slice(0, 3);

  // Country
  const otherCountries = [...new Set(others.map(w => w.country))].filter(c => c !== lookup.country);
  qs.push({ category: 'Origin', question: 'What country does this wine come from?',
    correct: lookup.country, options: shuffle([lookup.country, ...pick3(otherCountries)]) });

  // Grape
  const otherGrapes = [...new Set(others.map(w => w.wine.grape))].filter(g => g !== wine.grape);
  qs.push({ category: 'Grape', question: 'What grape(s) is this wine made from?',
    correct: wine.grape, options: shuffle([wine.grape, ...pick3(otherGrapes)]) });

  // Region
  const otherRegions = [...new Set(others.map(w => w.wine.region))].filter(r => r !== wine.region);
  qs.push({ category: 'Region', question: 'What region is this wine from?',
    correct: wine.region, options: shuffle([wine.region, ...pick3(otherRegions)]) });

  // Nose
  if (wine.nose) {
    const otherNoses = others.filter(w => w.wine.nose).map(w => w.wine.nose);
    qs.push({ category: 'Nose', question: 'Which describes the nose of this wine?',
      correct: wine.nose, options: shuffle([wine.nose, ...pick3(otherNoses)]) });
  }

  // Finish
  if (wine.finish) {
    const otherFinishes = others.filter(w => w.wine.finish).map(w => w.wine.finish);
    qs.push({ category: 'Finish', question: 'How would you describe the finish?',
      correct: wine.finish, options: shuffle([wine.finish, ...pick3(otherFinishes)]) });
  }

  return shuffle(qs);
}

// ═══════════════════════════════════════════════════════════════════
// INIT + TAB SWITCHING
// ═══════════════════════════════════════════════════════════════════

export function initDashboard(): void {
  document.addEventListener('click', handleGlobalClick);
  document.addEventListener('input', handleGlobalInput);

  const tabs = document.querySelectorAll<HTMLButtonElement>('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const panel = document.getElementById(`tab-${tab.dataset.tab}`);
      if (panel) panel.classList.add('active');
      activeTab = tab.dataset.tab!;
      refreshTab(activeTab);
    });
  });
}

export async function refreshAll(): Promise<void> {
  inventoryCache = await getInventory();
  favoritesCache = await getFavorites();
  pairingsCache = await getPairings();
  courseSlots = await getCourseState();
  if (courseSlots.length === 0) courseSlots = [{ answers: {}, wineId: null, wineName: null }];
  await refreshTab(activeTab);
}

async function refreshTab(tabId: string): Promise<void> {
  try {
    switch (tabId) {
      case 'home': renderHome(); break;
      case 'cellar': await renderCellar(); break;
      case 'courses': renderCourses(); break;
      case 'pairings': renderPairings(); break;
      case 'study': await renderStudy(); break;
      case 'settings': await renderSettings(); break;
    }
  } catch (e) { console.warn(`[dashboard] refresh ${tabId}:`, e); }
}

// ═══════════════════════════════════════════════════════════════════
// GLOBAL EVENT DELEGATION
// ═══════════════════════════════════════════════════════════════════

async function handleGlobalClick(e: Event): Promise<void> {
  const target = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
  if (!target) return;
  const action = target.dataset.action!;
  const val = target.dataset.value || '';
  const val2 = target.dataset.value2 || '';

  switch (action) {
    // ── Cellar ──
    case 'cellar-type':
      cellarType = val as WineType; cellarView = 'countries'; await renderCellar(); break;
    case 'cellar-country':
      cellarCountry = val; cellarView = 'grapes'; await renderCellar(); break;
    case 'cellar-grape':
      cellarGrape = val; cellarView = 'wines'; await renderCellar(); break;
    case 'cellar-back':
      if (cellarView === 'wines') { cellarView = 'grapes'; cellarGrape = null; }
      else if (cellarView === 'grapes') { cellarView = 'countries'; cellarCountry = null; }
      else if (cellarView === 'countries') { cellarView = 'types'; cellarType = null; }
      await renderCellar(); break;
    case 'cellar-filter':
      cellarFilter = val as 'all' | '85' | '86'; await renderCellar(); break;
    case 'stock-plus':
      inventoryCache[val] = (inventoryCache[val] ?? 0) + 1;
      await adjustStock(val, 1); await renderCellar(); break;
    case 'stock-minus':
      inventoryCache[val] = Math.max(0, (inventoryCache[val] ?? 0) - 1);
      await adjustStock(val, -1); await renderCellar(); break;
    case 'toggle-fav': {
      const nowFav = await toggleFavorite(val);
      if (nowFav) { favoritesCache.push(val); } else { favoritesCache = favoritesCache.filter(id => id !== val); }
      await renderCellar(); break;
    }

    // ── Courses ──
    case 'course-start':
      activeCourseIdx = parseInt(val); courseStep = 0; renderCourses(); break;
    case 'course-answer': {
      const step = FINDER_FLOW[courseStep as number];
      if (!step || activeCourseIdx === null) break;
      courseSlots[activeCourseIdx].answers[step.key] = val;
      const nextStep = (courseStep as number) + 1;
      courseStep = nextStep < FINDER_FLOW.length ? nextStep : 'results';
      renderCourses(); break;
    }
    case 'course-skip': {
      const step2 = FINDER_FLOW[courseStep as number];
      if (!step2 || activeCourseIdx === null) break;
      courseSlots[activeCourseIdx].answers[step2.key] = 'skip';
      const nextStep2 = (courseStep as number) + 1;
      courseStep = nextStep2 < FINDER_FLOW.length ? nextStep2 : 'results';
      renderCourses(); break;
    }
    case 'course-back':
      if (courseStep === 'results') courseStep = FINDER_FLOW.length - 1;
      else if (courseStep === 0) { activeCourseIdx = null; courseStep = null; }
      else courseStep = (courseStep as number) - 1;
      renderCourses(); break;
    case 'course-show-results':
      courseStep = 'results'; renderCourses(); break;
    case 'course-select-wine':
      if (activeCourseIdx !== null) {
        courseSlots[activeCourseIdx].wineId = val;
        courseSlots[activeCourseIdx].wineName = val2;
        activeCourseIdx = null; courseStep = null;
        await saveCourseState(courseSlots);
      }
      renderCourses(); break;
    case 'course-clear':
      courseSlots[parseInt(val)] = { answers: {}, wineId: null, wineName: null };
      activeCourseIdx = null; courseStep = null;
      await saveCourseState(courseSlots);
      renderCourses(); break;
    case 'course-add':
      if (courseSlots.length < 5) {
        courseSlots.push({ answers: {}, wineId: null, wineName: null });
        await saveCourseState(courseSlots);
      }
      renderCourses(); break;

    // ── Pairings ──
    case 'pairing-create': {
      const p = await createPairing('Pairing ' + (pairingsCache.length + 1));
      pairingsCache.unshift(p);
      activePairingId = p.id;
      renderPairings(); break;
    }
    case 'pairing-open':
      activePairingId = val; pairingEditingName = false; pairingEditingNotes = false;
      renderPairings(); break;
    case 'pairing-back':
      activePairingId = null; pairingAddingWine = false;
      pairingsCache = await getPairings();
      renderPairings(); break;
    case 'pairing-delete':
      await deletePairing(val);
      pairingsCache = pairingsCache.filter(p => p.id !== val);
      if (activePairingId === val) activePairingId = null;
      renderPairings(); break;
    case 'pairing-edit-name':
      pairingEditingName = true; renderPairings();
      setTimeout(() => { const inp = document.getElementById('pairing-name-input') as HTMLInputElement; if (inp) inp.focus(); }, 50);
      break;
    case 'pairing-save-name': {
      const inp = document.getElementById('pairing-name-input') as HTMLInputElement;
      if (inp && activePairingId) {
        await updatePairing(activePairingId, { name: inp.value });
        const p = pairingsCache.find(p => p.id === activePairingId);
        if (p) p.name = inp.value;
      }
      pairingEditingName = false; renderPairings(); break;
    }
    case 'pairing-edit-notes':
      pairingEditingNotes = true; renderPairings();
      setTimeout(() => { const ta = document.getElementById('pairing-notes-input') as HTMLTextAreaElement; if (ta) ta.focus(); }, 50);
      break;
    case 'pairing-save-notes': {
      const ta = document.getElementById('pairing-notes-input') as HTMLTextAreaElement;
      if (ta && activePairingId) {
        await updatePairing(activePairingId, { notes: ta.value });
        const p = pairingsCache.find(p => p.id === activePairingId);
        if (p) p.notes = ta.value;
      }
      pairingEditingNotes = false; renderPairings(); break;
    }
    case 'pairing-add-wine-open':
      pairingAddingWine = true; pairingSearchQ = ''; renderPairings(); break;
    case 'pairing-add-wine-close':
      pairingAddingWine = false; pairingSearchQ = ''; renderPairings(); break;
    case 'pairing-add-wine': {
      const p = pairingsCache.find(p => p.id === activePairingId);
      if (p && p.wineIds.length < 5 && !p.wineIds.includes(val)) {
        p.wineIds.push(val);
        await updatePairing(activePairingId!, { wineIds: p.wineIds });
      }
      pairingAddingWine = false; pairingSearchQ = '';
      renderPairings(); break;
    }
    case 'pairing-remove-wine': {
      const p2 = pairingsCache.find(p => p.id === activePairingId);
      if (p2) {
        p2.wineIds = p2.wineIds.filter(id => id !== val);
        await updatePairing(activePairingId!, { wineIds: p2.wineIds });
      }
      renderPairings(); break;
    }

    // ── Study ──
    case 'study-start':
      if (favoritesCache.length === 0) break;
      studyMode = 'study'; studyCardIdx = 0; studyFlipped = false; await renderStudy(); break;
    case 'study-browse':
      studyMode = 'browse'; await renderStudy(); break;
    case 'study-flip':
      studyFlipped = !studyFlipped; await renderStudy(); break;
    case 'study-prev':
      studyFlipped = false; studyCardIdx = (studyCardIdx - 1 + favoritesCache.length) % favoritesCache.length;
      await renderStudy(); break;
    case 'study-next':
      studyFlipped = false; studyCardIdx = (studyCardIdx + 1) % favoritesCache.length;
      await renderStudy(); break;
    case 'quiz-start': {
      quizWineId = val;
      quizQuestions = generateDashboardQuestions(val);
      if (quizQuestions.length === 0) break;
      quizQIdx = 0; quizSelected = null; quizShowResult = false;
      quizCorrectCount = 0; quizTotalCount = 0;
      studyMode = 'quiz'; await renderStudy(); break;
    }
    case 'quiz-random': {
      if (favoritesCache.length === 0) break;
      const rid = favoritesCache[Math.floor(Math.random() * favoritesCache.length)];
      quizWineId = rid;
      quizQuestions = generateDashboardQuestions(rid);
      if (quizQuestions.length === 0) break;
      quizQIdx = 0; quizSelected = null; quizShowResult = false;
      quizCorrectCount = 0; quizTotalCount = 0;
      studyMode = 'quiz'; await renderStudy(); break;
    }
    case 'quiz-answer': {
      if (quizShowResult) break;
      quizSelected = val;
      quizShowResult = true;
      const correct = val === quizQuestions[quizQIdx].correct;
      if (correct) quizCorrectCount++;
      quizTotalCount++;
      if (quizWineId) await recordQuizAnswer(quizWineId, correct);
      await renderStudy(); break;
    }
    case 'quiz-next': {
      if (quizQIdx < quizQuestions.length - 1) {
        quizQIdx++; quizSelected = null; quizShowResult = false;
      } else {
        // Quiz complete
        const lookup = lookupWineById(quizWineId!);
        const wineName = lookup ? lookup.wine.name : quizWineId!;
        await recordQuizSession(quizWineId!, wineName, quizCorrectCount, quizTotalCount, quizQuestions.length);
        studyMode = 'score';
      }
      await renderStudy(); break;
    }
    case 'quiz-retry':
      if (quizWineId) {
        quizQuestions = generateDashboardQuestions(quizWineId);
        quizQIdx = 0; quizSelected = null; quizShowResult = false;
        quizCorrectCount = 0; quizTotalCount = 0;
        studyMode = 'quiz';
      }
      await renderStudy(); break;
  }
}

function handleGlobalInput(e: Event): void {
  const target = e.target as HTMLElement;
  if (target.id === 'cellar-search') {
    cellarSearch = (target as HTMLInputElement).value;
    renderCellar();
  }
  if (target.id === 'pairing-search') {
    pairingSearchQ = (target as HTMLInputElement).value;
    renderPairings();
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function $(id: string): HTMLElement | null { return document.getElementById(id); }
function setHTML(id: string, html: string): void { const el = $(id); if (el) el.innerHTML = html; }
function setText(id: string, text: string): void { const el = $(id); if (el) el.textContent = text; }

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 604800000) return Math.floor(diff / 86400000) + 'd ago';
    return d.toLocaleDateString();
  } catch { return iso; }
}

function typeColor(type: string): string { return TYPE_COLORS[type] || '#c4a84d'; }

// ═══════════════════════════════════════════════════════════════════
// HOME TAB
// ═══════════════════════════════════════════════════════════════════

function renderHome(): void {
  const invEntries = Object.values(inventoryCache);
  const totalBottles = invEntries.reduce((s, n) => s + n, 0);
  const oos = invEntries.filter(n => n === 0).length;

  setText('home-wines', String(TOTAL_WINES));
  setText('home-tracked', String(invEntries.length));
  setText('home-pairings', String(pairingsCache.length));
  setText('home-favorites', String(favoritesCache.length));

  // Type breakdown
  const typeCounts: Record<string, number> = {};
  for (const t of WINE_TYPES) {
    let c = 0; for (const country of COUNTRIES[t]) c += (WINES[t]?.[country] || []).length;
    typeCounts[t] = c;
  }
  setHTML('home-types', WINE_TYPES.map(t =>
    `<span class="type-badge" style="background:${typeColor(t)}22;color:${typeColor(t)};border-color:${typeColor(t)}44">${TYPE_DISPLAY[t]} · ${typeCounts[t]}</span>`
  ).join(''));

  // Alerts
  const alerts: string[] = [];
  for (const [wid, stock] of Object.entries(inventoryCache)) {
    const w = lookupWineById(wid);
    if (!w) continue;
    if (stock === 0) alerts.push(`<div class="alert-item alert-86"><span>${esc(w.wine.name.split('–')[0].trim())}</span><span class="badge-86">86</span></div>`);
    else if (stock <= 2) alerts.push(`<div class="alert-item alert-85"><span>${esc(w.wine.name.split('–')[0].trim())}</span><span class="badge-85">${stock} left</span></div>`);
  }
  setHTML('home-alerts', alerts.length > 0 ? alerts.join('') : '<span class="muted">All stocked up</span>');
}

// ═══════════════════════════════════════════════════════════════════
// CELLAR TAB — hierarchical browse: Type > Country > Grape > Wines
// ═══════════════════════════════════════════════════════════════════

async function renderCellar(): Promise<void> {
  const content = $('cellar-content');
  if (!content) return;

  let html = '';

  // Breadcrumb
  const crumbs: string[] = ['All Types'];
  if (cellarType) crumbs.push(TYPE_DISPLAY[cellarType]);
  if (cellarCountry) crumbs.push(cellarCountry);
  if (cellarGrape) crumbs.push(cellarGrape);
  const showBack = cellarView !== 'types';

  html += `<div class="breadcrumb">`;
  if (showBack) html += `<button class="btn-back" data-action="cellar-back">‹</button>`;
  html += `<span class="crumb-text">${crumbs.join(' › ')}</span></div>`;

  // Filter chips (only at wine level)
  if (cellarView === 'wines') {
    html += `<div class="filter-row">
      ${(['all', '85', '86'] as const).map(f =>
        `<button class="chip ${cellarFilter === f ? 'active' : ''}" data-action="cellar-filter" data-value="${f}">${f === 'all' ? 'All' : f === '85' ? '85 Low' : '86 OOS'}</button>`
      ).join('')}
      <input id="cellar-search" class="search-input" placeholder="Search..." value="${esc(cellarSearch)}" />
    </div>`;
  }

  if (cellarView === 'types') {
    html += '<div class="browse-grid">';
    for (const t of WINE_TYPES) {
      let count = 0;
      for (const c of COUNTRIES[t]) count += (WINES[t]?.[c] || []).length;
      html += `<button class="browse-card" data-action="cellar-type" data-value="${t}" style="border-left:3px solid ${typeColor(t)}">
        <div class="browse-title">${TYPE_DISPLAY[t]}</div>
        <div class="browse-sub">${count} wines</div>
      </button>`;
    }
    html += '</div>';

  } else if (cellarView === 'countries' && cellarType) {
    html += '<div class="browse-list">';
    for (const country of COUNTRIES[cellarType]) {
      const wines = WINES[cellarType]?.[country] || [];
      html += `<button class="browse-row" data-action="cellar-country" data-value="${esc(country)}">
        <span>${esc(country)}</span><span class="browse-count">${wines.length}</span>
      </button>`;
    }
    html += '</div>';

  } else if (cellarView === 'grapes' && cellarType && cellarCountry) {
    const grapes = getGrapesForCountry(cellarType, cellarCountry);
    html += '<div class="browse-list">';
    for (const grape of grapes) {
      const wines = getWinesForGrape(cellarType, cellarCountry, grape);
      html += `<button class="browse-row" data-action="cellar-grape" data-value="${esc(grape)}">
        <span>${esc(grape)}</span><span class="browse-count">${wines.length}</span>
      </button>`;
    }
    html += '</div>';

  } else if (cellarView === 'wines' && cellarType && cellarCountry && cellarGrape) {
    let wines = getWinesForGrape(cellarType, cellarCountry, cellarGrape);

    // Apply search
    if (cellarSearch.trim()) {
      const q = cellarSearch.toLowerCase();
      wines = wines.filter(w => w.name.toLowerCase().includes(q) || w.grape.toLowerCase().includes(q));
    }

    html += '<div class="wine-cards">';
    for (const wine of wines) {
      const wineId = getWineId(cellarType, cellarCountry, wine.name);
      const stock = inventoryCache[wineId] ?? null;
      const isFav = favoritesCache.includes(wineId);

      // Apply filter
      if (cellarFilter === '85' && (stock === null || stock === 0 || stock > 2)) continue;
      if (cellarFilter === '86' && stock !== 0) continue;

      const stockClass = stock === null ? '' : stock === 0 ? 'stock-out' : stock <= 2 ? 'stock-low' : 'stock-ok';

      html += `<div class="wine-card">
        <div class="wine-card-top">
          <div class="wine-card-info">
            <div class="wine-card-name">${esc(wine.name.split('–')[0].trim())}</div>
            <div class="wine-card-meta">${esc(wine.region)} · ${esc(wine.style)}</div>
          </div>
          <button class="fav-btn ${isFav ? 'faved' : ''}" data-action="toggle-fav" data-value="${wineId}">${isFav ? '★' : '☆'}</button>
        </div>
        <div class="stock-row">
          <button class="stock-btn" data-action="stock-minus" data-value="${wineId}">−</button>
          <span class="stock-value ${stockClass}">${stock ?? '—'}</span>
          <button class="stock-btn" data-action="stock-plus" data-value="${wineId}">+</button>
        </div>
      </div>`;
    }
    html += '</div>';
  }

  content.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════
// COURSE BUILDER TAB
// ═══════════════════════════════════════════════════════════════════

function renderCourses(): void {
  const content = $('courses-content');
  if (!content) return;
  let html = '';

  // Active flow
  if (activeCourseIdx !== null && courseStep !== null) {
    if (typeof courseStep === 'number' && courseStep < FINDER_FLOW.length) {
      const step = FINDER_FLOW[courseStep];
      const answers = courseSlots[activeCourseIdx].answers;
      const options = step.dynamicOptions ? getFlavorOptions(answers) : (step.options || []);

      // Filter options by wine count
      const optionsWithCounts = options.map(opt => {
        const preview = { ...answers, [step.key]: opt.id };
        return { ...opt, count: getRankedWines(preview).length };
      }).filter(o => o.count > 0);

      const totalRemaining = getRankedWines(answers).length;

      html += `<div class="flow-card">
        <div class="flow-header">
          <div class="flow-dots">${FINDER_FLOW.map((_, i) =>
            `<span class="dot-pip ${i === courseStep ? 'active' : i < courseStep ? 'done' : ''}"></span>`
          ).join('')}</div>
          <button class="btn-outline" data-action="course-back">‹ Back</button>
        </div>
        <div class="flow-course-label">COURSE ${activeCourseIdx + 1}</div>
        <div class="flow-question">${step.label}</div>
        <div class="flow-remaining">${totalRemaining} wines in the running</div>
        <div class="flow-options">${optionsWithCounts.map(opt =>
          `<button class="chip" data-action="course-answer" data-value="${opt.id}">${opt.label} <span class="chip-count">${opt.count}</span></button>`
        ).join('')}</div>
        ${step.skipLabel ? `<button class="btn-outline" data-action="course-skip" style="margin-top:8px">${step.skipLabel}</button>` : ''}
        ${answers.type && courseStep > 0 ? `<button class="btn-gold-sm" data-action="course-show-results" style="margin-top:8px">Show wines now</button>` : ''}
      </div>`;

    } else if (courseStep === 'results') {
      const answers = courseSlots[activeCourseIdx].answers;
      const results = getRankedWines(answers);
      const grouped: Record<string, { wine: Wine; type: WineType; country: string; score: number }[]> = {};
      results.forEach(r => { if (!grouped[r.country]) grouped[r.country] = []; grouped[r.country].push(r); });

      html += `<div class="flow-card">
        <div class="flow-header">
          <div class="flow-question">Pick a wine (${results.length} matching)</div>
          <button class="btn-outline" data-action="course-back">‹ Back</button>
        </div>
        <div class="results-list">`;
      for (const [country, wines] of Object.entries(grouped)) {
        html += `<div class="results-country">${esc(country)} <span class="muted">(${wines.length})</span></div>`;
        for (const r of wines) {
          const wid = getWineId(r.type, r.country, r.wine.name);
          html += `<button class="result-wine" data-action="course-select-wine" data-value="${wid}" data-value2="${esc(r.wine.name)}">
            <div class="result-wine-name">${esc(r.wine.name.split('–')[0].trim())}</div>
            <div class="result-wine-meta">${esc(r.wine.grape)} · ${esc(r.wine.style)}</div>
          </button>`;
        }
      }
      html += `</div></div>`;
    }
  } else {
    // Course overview
    html += `<div class="section-label">Build Your Tasting</div>
      <p class="section-desc">Add up to 5 courses. Each uses the wine finder to match your mood.</p>`;

    courseSlots.forEach((slot, idx) => {
      if (slot.wineId) {
        const w = lookupWineById(slot.wineId);
        const name = w ? w.wine.name.split('–')[0].trim() : slot.wineName || slot.wineId;
        const type = w ? w.type : 'Red';
        html += `<div class="course-slot filled" style="border-left:3px solid ${typeColor(type)}">
          <div class="course-slot-inner">
            <div class="slot-number" style="background:${typeColor(type)}">${idx + 1}</div>
            <div class="slot-info">
              <div class="slot-wine-name">${esc(name)}</div>
              <div class="slot-wine-meta" style="color:${typeColor(type)}">${TYPE_DISPLAY[type as WineType] || type}${w ? ' · ' + esc(w.wine.grape) : ''}</div>
            </div>
          </div>
          <div class="slot-actions">
            <button class="btn-outline-sm" data-action="course-start" data-value="${idx}">✎</button>
            <button class="btn-outline-sm" data-action="course-clear" data-value="${idx}">✕</button>
          </div>
        </div>`;
      } else {
        html += `<button class="course-slot empty" data-action="course-start" data-value="${idx}">
          <div class="slot-number">${idx + 1}</div>
          <span class="slot-empty-text">Set up course</span>
        </button>`;
      }
    });

    html += `<div class="course-actions">`;
    if (courseSlots.length < 5)
      html += `<button class="btn-gold" data-action="course-add">+ ADD COURSE</button>`;
    html += `</div>`;
  }

  content.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════
// PAIRINGS TAB
// ═══════════════════════════════════════════════════════════════════

function renderPairings(): void {
  const content = $('pairings-content');
  if (!content) return;
  let html = '';

  const pairing = pairingsCache.find(p => p.id === activePairingId);

  if (pairing) {
    // Detail view
    html += `<button class="btn-outline" data-action="pairing-back" style="margin-bottom:12px">‹ All Pairings</button>`;

    // Name
    if (pairingEditingName) {
      html += `<div class="edit-row">
        <input id="pairing-name-input" class="input-field" value="${esc(pairing.name)}" />
        <button class="btn-gold-sm" data-action="pairing-save-name">✓</button>
      </div>`;
    } else {
      html += `<div class="pairing-header" data-action="pairing-edit-name">
        <h3 class="pairing-title">${esc(pairing.name)} <span class="edit-hint">✎</span></h3>
        <span class="muted">${pairing.wineIds.length}/5</span>
      </div>`;
    }

    // Wine slots 1-5
    html += '<div class="pairing-slots">';
    for (let i = 0; i < 5; i++) {
      const wid = pairing.wineIds[i];
      if (wid) {
        const w = lookupWineById(wid);
        const name = w ? w.wine.name.split('–')[0].trim() : wid;
        const type = w ? w.type : 'Red';
        html += `<div class="pairing-wine-slot" style="border-left:3px solid ${typeColor(type)}">
          <div class="slot-number" style="background:${typeColor(type)}">${i + 1}</div>
          <div class="slot-info">
            <div class="slot-wine-name">${esc(name)}</div>
            <div class="slot-wine-meta">${w ? esc(w.wine.grape) + ' · ' + esc(w.wine.region) : ''}</div>
          </div>
          <button class="btn-outline-sm" data-action="pairing-remove-wine" data-value="${wid}">✕</button>
        </div>`;
      } else if (i === pairing.wineIds.length) {
        html += `<button class="pairing-wine-slot empty" data-action="pairing-add-wine-open">
          <div class="slot-number">${i + 1}</div>
          <span class="slot-empty-text">+ Add Wine</span>
        </button>`;
      } else {
        html += `<div class="pairing-wine-slot dimmed">
          <div class="slot-number">${i + 1}</div><span class="slot-empty-text">—</span>
        </div>`;
      }
    }
    html += '</div>';

    // Notes
    html += '<div class="section-label" style="margin-top:16px">Pairing Notes</div>';
    if (pairingEditingNotes) {
      html += `<div>
        <textarea id="pairing-notes-input" class="input-field" rows="3" placeholder="Why do these wines work together?">${esc(pairing.notes)}</textarea>
        <button class="btn-gold-sm" data-action="pairing-save-notes" style="margin-top:8px">Save</button>
      </div>`;
    } else {
      html += `<div class="notes-display" data-action="pairing-edit-notes">${pairing.notes ? esc(pairing.notes) : '<span class="muted">Tap to add notes...</span>'}</div>`;
    }

    // Wine search overlay
    if (pairingAddingWine) {
      const searchResults = pairingSearchQ.trim() ? getAllWinesFlat().filter(w =>
        !pairing.wineIds.includes(w.id) &&
        (w.name.toLowerCase().includes(pairingSearchQ.toLowerCase()) || w.grape.toLowerCase().includes(pairingSearchQ.toLowerCase()))
      ).slice(0, 12) : [];

      html += `<div class="search-overlay">
        <div class="search-panel">
          <div class="search-panel-header">
            <h4>Add Wine (${pairing.wineIds.length}/5)</h4>
            <button class="btn-outline-sm" data-action="pairing-add-wine-close">✕</button>
          </div>
          <input id="pairing-search" class="input-field" placeholder="Search by name, grape..." value="${esc(pairingSearchQ)}" />
          <div class="search-results">${searchResults.map(w =>
            `<button class="search-result" data-action="pairing-add-wine" data-value="${w.id}">
              <div class="result-wine-name">${esc(w.name.split('–')[0].trim())}</div>
              <span style="color:${typeColor(w.type)};font-size:11px">${TYPE_DISPLAY[w.type as WineType] || w.type}</span>
            </button>`
          ).join('')}
          ${pairingSearchQ.trim() && searchResults.length === 0 ? '<p class="muted" style="text-align:center">No matches</p>' : ''}
          </div>
        </div>
      </div>`;
    }

  } else {
    // Pairings list
    html += `<div class="section-header">
      <div class="section-label">Wine Pairings</div>
      <button class="btn-gold-sm" data-action="pairing-create">+ New Pairing</button>
    </div>`;

    if (pairingsCache.length === 0) {
      html += '<div class="empty-state"><p>No pairings yet</p><p class="muted">Group up to 5 wines together with tasting notes.</p></div>';
    } else {
      for (const p of pairingsCache) {
        const pWines = p.wineIds.map(id => lookupWineById(id)).filter(Boolean);
        html += `<div class="pairing-list-item" data-action="pairing-open" data-value="${p.id}">
          <div class="pairing-list-top">
            <h4 class="pairing-list-name">${esc(p.name)}</h4>
            <button class="btn-outline-sm" data-action="pairing-delete" data-value="${p.id}">✕</button>
          </div>
          <div class="pairing-dots">${[0,1,2,3,4].map(i => {
            const w = pWines[i];
            return `<span class="pairing-dot" style="border-color:${w ? typeColor(w.type) : 'var(--border)'};background:${w ? typeColor(w.type) + '22' : 'transparent'}">${!w ? i + 1 : ''}</span>`;
          }).join('')}</div>
          ${p.notes ? `<p class="pairing-list-notes">${esc(p.notes)}</p>` : ''}
          <span class="muted">${p.wineIds.length}/5 wines</span>
        </div>`;
      }
    }
  }

  content.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════
// STUDY TAB — favorites-based flash cards + quiz
// ═══════════════════════════════════════════════════════════════════

async function renderStudy(): Promise<void> {
  const content = $('study-content');
  if (!content) return;
  let html = '';

  if (studyMode === 'score') {
    const pct = quizTotalCount > 0 ? Math.round((quizCorrectCount / quizTotalCount) * 100) : 0;
    const emoji = pct === 100 ? '&#127942;' : pct >= 75 ? '&#127863;' : pct >= 50 ? '&#128214;' : '&#128170;';
    const lookup = lookupWineById(quizWineId!);
    const wineName = lookup ? lookup.wine.name.split('–')[0].trim() : '';

    html += `<div class="score-screen">
      <div class="score-emoji">${emoji}</div>
      <div class="score-pct">${pct}%</div>
      <div class="score-detail">${quizCorrectCount}/${quizTotalCount} correct on ${esc(wineName)}</div>
      <div class="score-actions">
        <button class="btn-gold" data-action="quiz-retry">Try Again</button>
        <button class="btn-gold" data-action="quiz-random">Random Wine</button>
      </div>
      <button class="btn-outline" data-action="study-browse" style="margin-top:12px">Back to Cards</button>
    </div>`;

  } else if (studyMode === 'quiz' && quizWineId && quizQuestions.length > 0) {
    const q = quizQuestions[quizQIdx];
    const lookup = lookupWineById(quizWineId);
    const wineName = lookup ? lookup.wine.name.split('–')[0].trim() : '';
    const wineType = lookup ? lookup.type : 'Red';

    html += `<button class="btn-outline" data-action="study-browse">‹ Cards</button>
    <div class="quiz-header">
      <div>
        <div class="quiz-wine-name">${esc(wineName)}</div>
        <span style="color:${typeColor(wineType)};font-size:11px">${TYPE_DISPLAY[wineType as WineType]}</span>
      </div>
      <span class="quiz-progress">${quizQIdx + 1}/${quizQuestions.length}</span>
    </div>
    <div class="quiz-card">
      <span class="quiz-category">${q.category}</span>
      <p class="quiz-question">${esc(q.question)}</p>
      <div class="quiz-options">${q.options.map(opt => {
        let cls = 'quiz-option';
        if (quizShowResult) {
          if (opt === q.correct) cls += ' correct';
          else if (opt === quizSelected) cls += ' wrong';
        }
        return `<button class="${cls}" data-action="quiz-answer" data-value="${esc(opt)}">${esc(opt)}</button>`;
      }).join('')}</div>
      ${quizShowResult ? `<div class="quiz-feedback">
        <span class="${quizSelected === q.correct ? 'feedback-correct' : 'feedback-wrong'}">${quizSelected === q.correct ? 'Correct!' : 'Answer: ' + esc(q.correct)}</span>
        <button class="btn-gold-sm" data-action="quiz-next">${quizQIdx < quizQuestions.length - 1 ? 'Next Question' : 'See Score'}</button>
      </div>` : ''}
    </div>
    <div class="quiz-pips">${quizQuestions.map((_, i) =>
      `<span class="dot-pip ${i < quizQIdx ? 'done' : i === quizQIdx ? 'active' : ''}"></span>`
    ).join('')}</div>`;

  } else if (studyMode === 'study' && favoritesCache.length > 0) {
    const wid = favoritesCache[studyCardIdx];
    const lookup = lookupWineById(wid);
    if (!lookup) { studyMode = 'browse'; await renderStudy(); return; }
    const wine = lookup.wine;
    const wineType = lookup.type;

    html += `<button class="btn-outline" data-action="study-browse">‹ Cards</button>
    <div class="study-counter">${studyCardIdx + 1} / ${favoritesCache.length}</div>
    <div class="flash-card" data-action="study-flip">`;
    if (!studyFlipped) {
      html += `<div class="card-front">
        <div class="card-wine-name">${esc(wine.name.split('–')[0].trim())}</div>
        ${wine.name.includes('–') ? `<div class="card-producer">${esc(wine.name.split('–')[1]?.trim() || '')}</div>` : ''}
        <div class="card-type" style="color:${typeColor(wineType)}">${TYPE_DISPLAY[wineType]}</div>
        <div class="card-hint">Tap to reveal details</div>
      </div>`;
    } else {
      html += `<div class="card-back">
        ${[['Grape', wine.grape], ['Country', lookup.country], ['Region', wine.region], ['Style', wine.style],
          ['Nose', wine.nose], ['Palate', wine.palate], ['Finish', wine.finish]].filter(([,v]) => v).map(([l,v]) =>
          `<div class="card-detail"><span class="card-label">${l}</span><span class="card-value">${esc(v as string)}</span></div>`
        ).join('')}
      </div>`;
    }
    html += `</div>
    <div class="study-nav">
      <button class="btn-outline" data-action="study-prev">‹ Prev</button>
      <button class="btn-gold" data-action="quiz-start" data-value="${wid}">Quiz Me</button>
      <button class="btn-outline" data-action="study-next">Next ›</button>
    </div>`;

  } else {
    // Browse mode — show favorites list + quiz history
    html += `<div class="section-header">
      <div class="section-label">Your Favorites</div>
      ${favoritesCache.length > 0 ? `<button class="btn-gold-sm" data-action="study-start">Study Cards</button>` : ''}
    </div>`;

    if (favoritesCache.length === 0) {
      html += '<div class="empty-state"><p>No favorites yet</p><p class="muted">Browse your cellar and star wines to build your study deck.</p></div>';
    } else {
      html += '<div class="fav-list">';
      for (const wid of favoritesCache) {
        const w = lookupWineById(wid);
        if (!w) continue;
        html += `<div class="fav-item">
          <div class="fav-info">
            <div class="fav-name">${esc(w.wine.name.split('–')[0].trim())}</div>
            <div class="fav-meta" style="color:${typeColor(w.type)}">${TYPE_DISPLAY[w.type]} · ${esc(w.wine.grape)}</div>
          </div>
          <button class="btn-gold-sm" data-action="quiz-start" data-value="${wid}">Quiz</button>
        </div>`;
      }
      html += '</div>';
      if (favoritesCache.length > 1) {
        html += `<button class="btn-gold" data-action="quiz-random" style="margin-top:12px;width:100%">Random Quiz</button>`;
      }
    }

    // Quiz history
    const history = await getQuizHistory();
    if (history.length > 0) {
      html += '<div class="section-label" style="margin-top:20px">Quiz History</div>';
      html += history.slice(0, 15).map(h => {
        const scoreClass = h.pct === 100 ? 'perfect' : h.pct >= 70 ? 'good' : 'poor';
        return `<div class="quiz-row">
          <span class="quiz-row-name">${esc(h.wineName.split('–')[0].trim())}</span>
          <span class="quiz-row-score ${scoreClass}">${h.pct}%</span>
          <span class="quiz-row-date">${formatDate(h.date)}</span>
        </div>`;
      }).join('');
    }

    // Learned vault
    const vault = await getLearnedVault();
    if (vault.length > 0) {
      html += '<div class="section-label" style="margin-top:20px">Learned Vault</div>';
      for (const wid of vault) {
        const w = lookupWineById(wid);
        if (!w) continue;
        html += `<div class="vault-item"><span>${esc(w.wine.name.split('–')[0].trim())}</span><span class="vault-badge">Mastered</span></div>`;
      }
    }
  }

  content.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS TAB
// ═══════════════════════════════════════════════════════════════════

async function renderSettings(): Promise<void> {
  // Just update the few dynamic elements
  const favItems = favoritesCache.map(id => {
    const w = lookupWineById(id);
    return w ? w.wine.name : id;
  });
  const el = $('settings-favorites');
  if (el) {
    el.innerHTML = favItems.length > 0
      ? favItems.map(name => `<div class="wine-item"><span class="name">${esc(name)}</span></div>`).join('')
      : '<span class="muted">No favorites yet</span>';
  }
}

// ═══════════════════════════════════════════════════════════════════
// UTILITY: Flat wine list for search
// ═══════════════════════════════════════════════════════════════════

let _flatWines: { id: string; name: string; grape: string; type: string; region: string }[] | null = null;

function getAllWinesFlat() {
  if (_flatWines) return _flatWines;
  _flatWines = [];
  for (const t of WINE_TYPES) {
    for (const c of COUNTRIES[t]) {
      for (const w of (WINES[t]?.[c] || [])) {
        _flatWines.push({
          id: getWineId(t, c, w.name),
          name: w.name,
          grape: w.grape,
          type: t,
          region: w.region,
        });
      }
    }
  }
  return _flatWines;
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC — called from Main.ts
// ═══════════════════════════════════════════════════════════════════

export function setDeviceInfo(model: string, sn: string): void {
  setText('settings-device', `${model} (${sn})`);
}
export function setVersionInfo(version: string): void {
  setText('settings-version', version);
}
export function setGlassesStatus(connected: boolean, battery?: number): void {
  const el = $('home-glasses-status');
  if (el) el.innerHTML = connected
    ? `<span style="color:var(--gold)">Connected</span>${battery !== undefined ? ` · ${battery}%` : ''}`
    : '<span class="muted">Disconnected</span>';
}
