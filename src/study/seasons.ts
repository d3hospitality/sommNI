// ═══════════════════════════════════════════════════════════════════
// wineLENS Study — seasons, stages and practice cards (PolyGot model)
//
//   Map → season → stages (meet → flash → pick → spot) → boss
//
// Four seasons are built from the wineLENS catalog: grapes & styles, regions &
// countries, tasting notes and producers & stories. Cards are generated
// deterministically (stable IDs, seeded option order), so progress replays
// the same way on every device. They are practice: catalog data is not
// producer-verified, so practice never moves the sourced daily review.
// "Classic markers" are textbook descriptors (curated below), not scores of
// anyone's tasting.
// ═══════════════════════════════════════════════════════════════════
import { allCatalogWines, type CatalogWine } from '../identity';
import { TYPE_DISPLAY, type WineType } from '../constants';
import { splitWineName } from '../pages';

export type SeasonId = 'grapes' | 'regions' | 'notes' | 'stories';
export type CardKind = 'meet' | 'flash' | 'pick' | 'spot';
export type GlyphIcon = 'grape' | 'glass' | 'globe' | 'pin' | 'nose' | 'look' | 'bottle' | 'book';
/** What the centred glyph image shows: a pictogram and (optionally) one big word. */
export interface Glyph { icon: GlyphIcon; word: string; style?: WineType | null; country?: string; wineId?: string; grape?: string }
export interface PracticeCard {
  id: string; kind: CardKind; season: SeasonId; stage: string;
  front: Glyph; back: Glyph;
  prompt: string;          // the question under the glyph (meet: a headline)
  answer: string;          // flash: the back; pick/spot: the right option
  options: string[];       // pick/spot (and flash, so a boss can ask it as a pick)
  detail: string;          // shown after answering
  wineId?: string;
}
export interface Stage { id: string; season: SeasonId; index: number; title: string; boss: boolean; cards: PracticeCard[] }
export interface Season { id: SeasonId; title: string; short: string; blurb: string; icon: Glyph; stages: Stage[]; boss: Stage }

// ── deterministic helpers ──
export const fold = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export const slug = (s: string) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'x';
function hash(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed: string) { let a = hash(seed); return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function shuffle<T>(items: T[], seed: string): T[] { const r = rng(seed), out = [...items]; for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; }
const uniq = <T>(items: T[]) => [...new Set(items)];
const top = <T>(items: T[], n = Infinity): T[] => { const m = new Map<T, number>(); for (const x of items) m.set(x, (m.get(x) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k); };
const count = <T>(items: T[], x: T) => items.filter(i => i === x).length;
const sentence = (text: string) => (text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text).trim();
const clip = (text: string, max: number) => [...text].length <= max ? text : [...text].slice(0, max - 3).join('').trimEnd() + '...';
const STYLE_NAME = (t: WineType) => TYPE_DISPLAY[t];
/** A label that names a style ("Brut Rosé", "Blanc") would make a style question ambiguous or trivial. */
/** Sweet sparkling or still wines read as dessert to most people: keep them out of style questions. */
const sweetNotDessert = (b: Bottle) => b.item.wine.style === 'Sweet' && b.type !== 'Dessert';
const namesStyle = (b: { label: string }) => /\b(red|white|rose|rosato|rosado|sparkling|dessert|orange|blanc|bianco|blanco|rouge|rosso|tinto|brut|spumante)\b/.test(fold(b.label));
/** Options: the answer plus distinct distractors, in a seeded order. Null when there are not enough. */
function optionsFor(answer: string, pool: string[], seed: string, n = 3): string[] | null {
  const distractors = shuffle(uniq(pool.filter(p => fold(p) !== fold(answer))), seed + ':d').slice(0, n - 1);
  return distractors.length < n - 1 ? null : shuffle([answer, ...distractors], seed + ':o');
}

// ── catalog views ──
export interface Bottle { item: CatalogWine; id: string; title: string; producer: string; label: string; type: WineType; country: string; region: string; parent: string; grape: string }
const REGION_PARENT: Record<string, string> = {
  'Côte-de-Nuits': 'Burgundy', 'Côte-de-Beaune': 'Burgundy', Margaux: 'Bordeaux', Pauillac: 'Bordeaux', 'Saint-Émilion': 'Bordeaux', Pomerol: 'Bordeaux',
  Oakville: 'Napa Valley', 'Rioja Alta': 'Rioja', Aube: 'Champagne', 'Sonoma Coast': 'Sonoma',
};
export function regionName(raw: string, country: string): string {
  const name = raw.replace(/,\s*[A-Z]{2}$/, '').replace(new RegExp(`,\\s*${country}$`), '').trim();
  return name && fold(name) !== fold(country) ? name : '';
}
// Blends named by their grapes (not by their home), so "Champagne: signature grape?" never answers itself.
export const BLEND_PINOT = 'Pinot & Chardonnay', BLEND_CAB = 'Cabernet & Merlot';
/** One grape name per wine: the first named grape, with blends that have a name of their own. */
export function grapeKey(raw: string, type: WineType): string {
  const g = raw.replace(/\(.*?\)/g, '').trim();
  if (/bordeaux/i.test(raw)) return BLEND_CAB;
  if (/chardonnay/i.test(g) && /pinot (noir|nero)/i.test(g) && (type === 'Sparkling' || /meunier/i.test(g))) return BLEND_PINOT;
  if (/touriga/i.test(raw)) return 'Touriga Nacional';
  const first = g.split(/\/|,|&| and |-led/i)[0].trim();
  const alias: Record<string, string> = { Shiraz: 'Syrah', Garnacha: 'Grenache', 'Garnacha Tinta': 'Grenache', 'Pinot Gris': 'Pinot Grigio', 'Pinot Nero': 'Pinot Noir', 'Trebbiano d’Abruzzo': 'Trebbiano', "Trebbiano d'Abruzzo": 'Trebbiano' };
  return alias[first] ?? first;
}
let bottles: Bottle[] | null = null;
export function catalogBottles(): Bottle[] {
  if (bottles) return bottles;
  bottles = allCatalogWines().map(item => {
    const { title, producer } = splitWineName(item.wine.name);
    const region = regionName(item.wine.region, item.country);
    return { item, id: item.id, title, producer, label: producer ? `${title} – ${producer}` : title, type: item.type, country: item.country,
      region, parent: REGION_PARENT[region] ?? region, grape: grapeKey(item.wine.grape, item.type) };
  });
  return bottles;
}
const GENERIC = new Set(['blend', 'wine', 'wines', 'valley', 'grand', 'chateau', 'domaine', 'true', 'false', 'tenuta', 'fattoria', 'castello', 'bodega', 'bodegas', 'quinta', 'cantina', 'cantine', 'estate', 'maison', 'weingut', 'cellars', 'vineyards', 'winery', 'family', 'famille', 'azienda', 'agricola', 'poggio']);
/** True when the question already contains the answer (any word of 4+ letters, accent-folded). */
export function givesAway(prompt: string, answer: string): boolean {
  const p = fold(prompt);
  return fold(answer).split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !GENERIC.has(w)).some(w => p.includes(w));
}
/** Cut at a word boundary. */
const words = (text: string, max: number) => { if ([...text].length <= max) return text; const cut = text.slice(0, max + 1).replace(/\s+\S*$/, ''); return (cut || text.slice(0, max)).replace(/[,;:–-]+$/, '').trim(); };
/** A title that does not give the grape away. */
const hidesGrape = (b: Bottle, grape: string) => !fold(b.label).includes(fold(grape).split(' ')[0]);

// ── curated: classic markers (textbook descriptors) ──
export const CLASSIC_MARKERS: Record<string, [string, string]> = {
  'Pinot Noir': ['red cherry', 'forest floor'], Nebbiolo: ['tar', 'roses'], 'Cabernet Sauvignon': ['blackcurrant', 'cedar'],
  Syrah: ['black pepper', 'olive'], Sangiovese: ['sour cherry', 'dried herbs'], Tempranillo: ['red cherry', 'leather'],
  Malbec: ['plum', 'violet'], Merlot: ['plum', 'chocolate'], Grenache: ['strawberry', 'white pepper'], 'Cabernet Franc': ['raspberry', 'bell pepper'],
  'Sauvignon Blanc': ['gooseberry', 'cut grass'], Riesling: ['lime', 'petrol'], Chardonnay: ['green apple', 'butter'],
  Albariño: ['peach', 'sea spray'], 'Grüner Veltliner': ['white pepper', 'green apple'], 'Chenin Blanc': ['quince', 'honey'],
  Assyrtiko: ['lemon', 'flint'], 'Pinot Grigio': ['pear', 'almond'], [BLEND_PINOT]: ['brioche', 'green apple'],
};
const MARKER_STAGES: { title: string; grapes: string[] }[] = [
  { title: 'Classic reds', grapes: ['Pinot Noir', 'Nebbiolo', 'Cabernet Sauvignon', 'Syrah'] },
  { title: 'Classic whites', grapes: ['Sauvignon Blanc', 'Riesling', 'Chardonnay', 'Albariño'] },
  { title: 'Old World reds', grapes: ['Sangiovese', 'Tempranillo', 'Malbec', 'Merlot'] },
];
const GRAPE_STAGES: { title: string; grapes: string[] }[] = [
  { title: 'Burgundy & bubbles', grapes: ['Pinot Noir', 'Chardonnay', BLEND_PINOT] },
  { title: 'Italian icons', grapes: ['Sangiovese', 'Nebbiolo', 'Barbera'] },
  { title: 'Bordeaux & friends', grapes: ['Cabernet Sauvignon', 'Merlot', BLEND_CAB] },
  { title: 'Sun & spice', grapes: ['Syrah', 'Grenache', 'Tempranillo', 'Malbec'] },
  { title: 'Crisp whites', grapes: ['Sauvignon Blanc', 'Riesling', 'Albariño', 'Pinot Grigio'] },
];

// ── card factory ──
// The stage part of the ID is filled in by makeStage ("@" until then).
function card(season: SeasonId, _stage: string, subject: string, kind: CardKind, c: Omit<PracticeCard, 'id' | 'kind' | 'season' | 'stage'>): PracticeCard {
  return { id: `p.${season}.@.${slug(subject)}.${kind}`, kind, season, stage: '@', ...c };
}
const TF = ['True', 'False'];
function makeStage(season: SeasonId, index: number, title: string, meets: PracticeCard[], questions: PracticeCard[]): Stage {
  const id = slug(title);
  // Meet cards first (in order), then the questions mixed so the same subject never repeats back to back.
  const mixed = shuffle(questions, `${season}.${id}`);
  for (let i = 1; i < mixed.length; i++) if (mixed[i].id.split('.')[3] === mixed[i - 1].id.split('.')[3]) {
    const j = mixed.findIndex((c, k) => k > i && c.id.split('.')[3] !== mixed[i - 1].id.split('.')[3]);
    if (j > 0) [mixed[i], mixed[j]] = [mixed[j], mixed[i]];
  }
  const seen = new Set<string>();
  const cards = [...meets, ...mixed].map(c => {
    let cardId = c.id.replace('.@.', `.${id}.`);
    for (let n = 2; seen.has(cardId); n++) cardId = c.id.replace('.@.', `.${id}.`) + n;
    seen.add(cardId);
    return { ...c, id: cardId, stage: id };
  });
  return { id, season, index, title, boss: false, cards };
}

// ── Season 1: grapes & styles ──
function grapesSeason(all: Bottle[]): Stage[] {
  const S: SeasonId = 'grapes';
  const stages: Stage[] = [];
  // Stage 1: the styles
  const styles = top(all.map(b => b.type)).filter(t => count(all.map(b => b.type), t) >= 3) as WineType[];
  const styleMeets = styles.map(t => {
    const inStyle = all.filter(b => b.type === t);
    return card(S, 'styles', t, 'meet', { front: { icon: 'glass', word: STYLE_NAME(t), style: t }, back: { icon: 'glass', word: STYLE_NAME(t), style: t },
      prompt: 'Meet the style', answer: STYLE_NAME(t), options: [],
      detail: `${inStyle.length} wines in the catalog · mostly ${top(inStyle.map(b => b.country), 2).join(' and ')} · top grape: ${top(inStyle.map(b => b.grape), 1)[0]}` });
  });
  const styleQs: PracticeCard[] = [];
  for (const t of styles) {
    const pickFrom = shuffle(all.filter(b => b.type === t && !namesStyle(b) && !sweetNotDessert(b)), `${S}.style.${t}`);
    const b = pickFrom[0]; if (!b) continue;
    const options = optionsFor(STYLE_NAME(t), styles.map(STYLE_NAME), `${S}.style.${b.id}`);
    if (options) styleQs.push(card(S, 'styles', b.id, 'pick', { front: { icon: 'glass', word: 'Style?', style: null }, back: { icon: 'glass', word: STYLE_NAME(t), style: t },
      prompt: `What style is ${b.label}?`, answer: STYLE_NAME(t), options, detail: `${b.label} · ${b.region || b.country} · ${b.item.wine.style}`, wineId: b.id }));
    const other = pickFrom[1] ?? b, liar = shuffle(styles.filter(s => s !== t), `${S}.liar.${other.id}`)[0];
    const truth = hash(other.id) % 2 === 0, claimed = truth || !liar ? t : liar;
    styleQs.push(card(S, 'styles', other.id, 'spot', { front: { icon: 'glass', word: STYLE_NAME(claimed), style: claimed }, back: { icon: 'glass', word: STYLE_NAME(t), style: t },
      prompt: `${other.label} is a ${STYLE_NAME(claimed).toLowerCase()} wine.`, answer: claimed === t ? 'True' : 'False', options: TF,
      detail: `${other.label} is ${STYLE_NAME(t).toLowerCase()} · ${other.region || other.country}`, wineId: other.id }));
  }
  stages.push(makeStage(S, 0, 'Meet the styles', styleMeets, styleQs.slice(0, 8)));
  // Grape stages
  const grapes = uniq(all.map(b => b.grape));
  const used = new Set<string>();
  const specs = [...GRAPE_STAGES.map(s => ({ ...s, grapes: s.grapes.filter(g => grapes.includes(g)) })),
    { title: 'Off the beaten path', grapes: [] as string[] }];
  for (const s of GRAPE_STAGES) s.grapes.forEach(g => used.add(g));
  specs[specs.length - 1].grapes = top(all.map(b => b.grape).filter(g => !used.has(g)), 4);
  const grapePool = top(all.map(b => b.grape));
  for (const spec of specs) {
    if (spec.grapes.length < 2) continue;
    const meets: PracticeCard[] = [], qs: PracticeCard[] = [];
    for (const g of spec.grapes) {
      const wines = all.filter(b => b.grape === g);
      const home = top(wines.map(b => b.parent || b.country), 2).filter(Boolean);
      const color = top(wines.map(b => b.type), 1)[0] as WineType;
      const markers = CLASSIC_MARKERS[g];
      const glyph: Glyph = { icon: 'grape', word: g, grape: g };
      meets.push(card(S, spec.title, g, 'meet', { front: glyph, back: glyph, prompt: 'Meet the grape', answer: g, options: [],
        detail: `${wines.length} ${STYLE_NAME(color).toLowerCase()} ${wines.length === 1 ? 'wine' : 'wines'} in the catalog, mostly from ${home.join(' and ')}${g === BLEND_PINOT ? ' · Chardonnay, Pinot Noir and Meunier' : g === BLEND_CAB ? ' · Cabernet Sauvignon and Merlot' : ''}${markers ? ` · classic notes: ${markers.join(', ')}` : ''}` }));
      const cue = shuffle(wines.filter(b => hidesGrape(b, g)), `${S}.cue.${g}`)[0] ?? wines[0];
      const sameStage = spec.grapes.filter(x => x !== g), pool = [...sameStage, ...grapePool.filter(x => x !== g && all.some(b => b.grape === x && b.type === color))];
      const flashOptions = optionsFor(g, pool, `${S}.flash.${g}`);
      if (cue && flashOptions && !givesAway(cue.label, g)) qs.push(card(S, spec.title, g, 'flash', { front: { icon: 'bottle', word: cue.title, wineId: cue.id }, back: glyph,
        prompt: `${cue.label}: which grape?`, answer: g, options: flashOptions, detail: `${cue.label} · ${cue.region || cue.country}`, wineId: cue.id }));
      const right = shuffle(wines.filter(b => b.id !== cue?.id && hidesGrape(b, g)), `${S}.right.${g}`)[0] ?? wines.find(b => b.id !== cue?.id) ?? cue;
      const wrong = shuffle(all.filter(b => b.type === color && b.grape !== g && hidesGrape(b, g)), `${S}.wrong.${g}`).map(b => b.label);
      const pickOptions = right ? optionsFor(right.label, wrong, `${S}.pick.${g}`) : null;
      if (right && pickOptions && hidesGrape(right, g)) qs.push(card(S, spec.title, g, 'pick', { front: glyph, back: { icon: 'bottle', word: right.title, wineId: right.id },
        prompt: `Which one is ${g}?`, answer: right.label, options: pickOptions, detail: `${right.label} is ${g} · ${right.region || right.country}`, wineId: right.id }));
    }
    // Two true/false checks per stage.
    for (const [n, g] of spec.grapes.slice(0, 2).entries()) {
      const liar = spec.grapes.find(x => x !== g)!, b = shuffle(all.filter(x => x.grape === g && hidesGrape(x, g) && hidesGrape(x, liar)), `${S}.spot.${g}`)[0];
      if (!b) continue;
      const truth = (hash(b.id) + n) % 2 === 0, claimed = truth ? g : liar;
      qs.push(card(S, spec.title, g + '-spot', 'spot', { front: { icon: 'bottle', word: b.title, wineId: b.id }, back: { icon: 'grape', word: g, grape: g },
        prompt: `${b.label} is made from ${claimed}.`, answer: truth ? 'True' : 'False', options: TF, detail: `${b.label}: ${b.item.wine.grape}`, wineId: b.id }));
    }
    stages.push(makeStage(S, stages.length, spec.title, meets, qs));
  }
  return stages;
}

// ── Season 2: regions & countries ──
function regionsSeason(all: Bottle[]): Stage[] {
  const S: SeasonId = 'regions';
  const stages: Stage[] = [];
  const countries = top(all.map(b => b.country));
  const regionsOf = (c: string) => top(all.filter(b => b.country === c && b.parent).map(b => b.parent));
  const globe = (c: string, word = c): Glyph => ({ icon: 'globe', word, country: c });
  const countryMeet = (stage: string, c: string) => {
    const n = all.filter(b => b.country === c).length;
    const regs = regionsOf(c).slice(0, 3);
    return card(S, stage, c, 'meet', { front: globe(c), back: globe(c), prompt: 'Meet the country', answer: c, options: [],
      detail: `${n} ${n === 1 ? 'wine' : 'wines'} in the catalog${regs.length ? ` · ${regs.join(', ')}` : ''} · top grape: ${top(all.filter(b => b.country === c).map(b => b.grape), 1)[0]}` });
  };
  const litPick = (stage: string, c: string, pool: string[]) => {
    const options = optionsFor(c, pool, `${S}.lit.${c}`);
    return options ? card(S, stage, c, 'pick', { front: globe(c, ''), back: globe(c), prompt: 'Which country is lit?', answer: c, options, detail: `${c} · ${all.filter(b => b.country === c).length} wines in the catalog` }) : null;
  };
  // Stage 1: the big four
  const big = countries.slice(0, 4);
  {
    const qs: PracticeCard[] = [];
    for (const c of big) {
      const lit = litPick('big', c, big); if (lit) qs.push(lit);
      const r = regionsOf(c)[0];
      const options = r ? optionsFor(c, big, `${S}.where.${r}`) : null;
      if (r && options) qs.push(card(S, 'big', r, 'flash', { front: { icon: 'pin', word: r }, back: globe(c), prompt: `${r}: which country?`, answer: c, options, detail: `${r} · ${c} · ${all.filter(b => b.parent === r).length} wines` }));
    }
    stages.push(makeStage(S, 0, 'The big four', big.map(c => countryMeet('big', c)), qs));
  }
  // Up close: the top countries' regions, then Spain & Portugal together.
  const closeUp: { title: string; countries: string[] }[] = [
    ...countries.slice(0, 3).map(c => ({ title: `${c} up close`, countries: [c] })),
    { title: 'Spain & Portugal', countries: ['Spain', 'Portugal'].filter(c => countries.includes(c)) },
  ];
  for (const spec of closeUp) {
    const regions = top(all.filter(b => spec.countries.includes(b.country) && b.parent).map(b => b.parent), 4);
    if (regions.length < 3) continue;
    const meets: PracticeCard[] = [], qs: PracticeCard[] = [];
    for (const r of regions) {
      const wines = all.filter(b => b.parent === r), grape = top(wines.map(b => b.grape), 1)[0], c = wines[0].country;
      const subs = uniq(wines.map(b => b.region)).filter(x => x !== r);
      meets.push(card(S, spec.title, r, 'meet', { front: { icon: 'pin', word: r }, back: { icon: 'pin', word: r }, prompt: 'Meet the region', answer: r, options: [],
        detail: `${c} · ${wines.length} wines · signature grape here: ${grape}${subs.length ? ` · includes ${subs.slice(0, 3).join(', ')}` : ''}` }));
      const grapeOptions = optionsFor(grape, top(all.filter(b => spec.countries.includes(b.country) || b.type === wines[0].type).map(b => b.grape)), `${S}.sig.${r}`);
      if (grapeOptions && !givesAway(r, grape)) qs.push(card(S, spec.title, r, 'flash', { front: { icon: 'pin', word: r }, back: { icon: 'grape', word: grape, grape },
        prompt: `${r}: signature grape here?`, answer: grape, options: grapeOptions, detail: `${count(wines.map(b => b.grape), grape)} of ${wines.length} ${r} wines here are ${grape}` }));
      const b = shuffle(wines.filter(x => !fold(x.label).includes(fold(r))), `${S}.from.${r}`)[0];
      const fromOptions = b ? optionsFor(r, regions, `${S}.from.${b.id}`) : null;
      if (b && fromOptions) qs.push(card(S, spec.title, b.id, 'pick', { front: { icon: 'bottle', word: b.title, wineId: b.id }, back: { icon: 'pin', word: r },
        prompt: `Where is ${b.label} from?`, answer: r, options: fromOptions, detail: `${b.label} · ${b.region}, ${b.country}`, wineId: b.id }));
    }
    stages.push(makeStage(S, stages.length, spec.title, meets, qs));
  }
  // New frontiers: every other country, lit on the globe.
  const rest = countries.filter(c => !big.includes(c)).slice(0, 6);
  if (rest.length >= 3) {
    const qs = rest.map(c => litPick('frontiers', c, rest)).filter((c): c is PracticeCard => !!c);
    for (const c of rest.slice(0, 3)) {
      const b = all.find(x => x.country === c && x.region)!;
      if (!b) continue;
      const options = optionsFor(c, rest, `${S}.nf.${b.id}`);
      if (options) qs.push(card(S, 'frontiers', b.id, 'flash', { front: { icon: 'pin', word: b.region }, back: globe(c), prompt: `${b.region}: which country?`, answer: c, options, detail: `${b.label} · ${b.region}, ${c}`, wineId: b.id }));
    }
    stages.push(makeStage(S, stages.length, 'New frontiers', rest.map(c => countryMeet('frontiers', c)), qs));
  }
  return stages;
}

// ── Season 3: tasting notes ──
function notesSeason(all: Bottle[]): Stage[] {
  const S: SeasonId = 'notes';
  const stages: Stage[] = [];
  const grapes = uniq(all.map(b => b.grape));
  for (const spec of MARKER_STAGES) {
    const gs = spec.grapes.filter(g => grapes.includes(g) && CLASSIC_MARKERS[g]);
    if (gs.length < 3) continue;
    const meets: PracticeCard[] = [], qs: PracticeCard[] = [];
    for (const g of gs) {
      const [a, b] = CLASSIC_MARKERS[g], words = `${a} · ${b}`;
      meets.push(card(S, spec.title, g, 'meet', { front: { icon: 'nose', word: g }, back: { icon: 'grape', word: g, grape: g }, prompt: 'Classic markers', answer: g, options: [],
        detail: `Textbook markers: ${a} and ${b}. Look for them in the glass.` }));
      const options = optionsFor(g, gs, `${S}.mk.${g}`);
      if (options) qs.push(card(S, spec.title, g, 'flash', { front: { icon: 'nose', word: words }, back: { icon: 'grape', word: g, grape: g },
        prompt: `${a[0].toUpperCase() + a.slice(1)} and ${b}: which grape?`, answer: g, options, detail: `${g}: ${a}, ${b}` }));
      const wrong = gs.filter(x => x !== g).map(x => CLASSIC_MARKERS[x].join(' · '));
      const markerOptions = optionsFor(words, wrong, `${S}.mkp.${g}`);
      if (markerOptions) qs.push(card(S, spec.title, g, 'pick', { front: { icon: 'grape', word: g, grape: g }, back: { icon: 'nose', word: words },
        prompt: `Classic notes of ${g}?`, answer: words, options: markerOptions, detail: `${g}: ${a}, ${b}` }));
    }
    stages.push(makeStage(S, stages.length, spec.title, meets, qs));
  }
  // Read the glass: appearance → style
  const styles = top(all.map(b => b.type)).filter(t => count(all.map(b => b.type), t) >= 3) as WineType[];
  const look: PracticeCard[] = [];
  for (const t of styles) for (const b of shuffle(all.filter(x => x.type === t && x.item.wine.appearance && !namesStyle(x) && !sweetNotDessert(x) && !(t === 'Sparkling' && /pink|salmon|rose|copper/.test(fold(x.item.wine.appearance)))), `${S}.look.${t}`).slice(0, t === 'Red' || t === 'White' ? 2 : 1)) {
    const options = optionsFor(STYLE_NAME(t), styles.map(STYLE_NAME), `${S}.look.${b.id}`);
    if (options) look.push(card(S, 'look', b.id, 'pick', { front: { icon: 'look', word: words(b.item.wine.appearance.split(/[,.]/)[0], 20) }, back: { icon: 'glass', word: STYLE_NAME(t), style: t },
      prompt: `“${clip(b.item.wine.appearance, 90)}” Which style?`, answer: STYLE_NAME(t), options, detail: `${b.label} · catalog note`, wineId: b.id }));
  }
  if (look.length >= 4) stages.push(makeStage(S, stages.length, 'Read the glass', [], look.slice(0, 8)));
  // Nose to wine (catalog notes): which wine has this nose? Distractors: same style, other grapes.
  const nose: PracticeCard[] = [];
  const candidates = shuffle(all.filter(b => b.item.wine.nose && b.producer), `${S}.nose`).filter((b, i, arr) => arr.findIndex(x => x.grape === b.grape) === i);
  for (const b of candidates.slice(0, 8)) {
    const wrong = all.filter(x => x.type === b.type && x.grape !== b.grape && x.producer).map(x => x.label);
    const options = optionsFor(b.label, wrong, `${S}.nose.${b.id}`);
    const first = b.item.wine.nose.split(/,|\./)[0].trim();
    if (options) nose.push(card(S, 'nose', b.id, 'pick', { front: { icon: 'nose', word: words(first, 20) }, back: { icon: 'bottle', word: b.title, wineId: b.id },
      prompt: `Nose: ${clip(b.item.wine.nose, 110)} Which wine?`, answer: b.label, options, detail: `${b.label} · ${b.grape} · catalog note`, wineId: b.id }));
  }
  if (nose.length >= 4) stages.push(makeStage(S, stages.length, 'Nose to wine', [], nose));
  // Palate → grape
  const palate: PracticeCard[] = [];
  const pals = shuffle(all.filter(b => b.item.wine.palate && b.grape !== BLEND_PINOT), `${S}.pal`).filter((b, i, arr) => arr.findIndex(x => x.grape === b.grape) === i);
  for (const b of pals) {
    if (palate.length >= 8) break;
    const text = b.item.wine.palate;
    if (fold(text).includes(fold(b.grape).split(' ')[0])) continue;   // the note names its grape
    const options = optionsFor(b.grape, uniq(all.filter(x => x.type === b.type).map(x => x.grape)), `${S}.pal.${b.id}`);
    const flavour = (text.split('.').map(x => x.trim()).filter(Boolean)[1] ?? text).split(',')[0];
    if (options) palate.push(card(S, 'palate', b.id, 'pick', { front: { icon: 'glass', word: words(flavour, 20), style: b.type }, back: { icon: 'grape', word: b.grape, grape: b.grape },
      prompt: `Palate: ${clip(text, 110)} Which grape?`, answer: b.grape, options, detail: `${b.label} · catalog note`, wineId: b.id }));
  }
  if (palate.length >= 4) stages.push(makeStage(S, stages.length, 'Palate to grape', [], palate));
  return stages;
}

// ── Season 4: producers & stories ──
/** The first story sentence that names the producer, with the producer masked; null if it still gives it away. */
export function maskedStory(b: Bottle): string | null {
  const names = uniq([b.producer, ...b.producer.split(/\s+/).filter(w => w.length >= 4 && !/^(the|wine|wines|estate|domaine|chateau|château|tenuta|cantina|bodega|bodegas|vineyards?|winery|family|cellars?)$/i.test(fold(w)))]).filter(Boolean);
  if (!names.length) return null;
  const sentences = (b.item.wine.anecdote.match(/[^.!?]+[.!?]+/g) ?? []).map(s => s.trim());
  const hit = sentences.find(s => names.some(n => fold(s).includes(fold(n))));
  if (!hit) return null;
  let out = hit;
  for (const n of names.sort((x, y) => y.length - x.length)) out = out.replace(new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '____');
  out = out.replace(/____(\s+\S{1,3}\s+____)+/g, '____');
  const giveaway = b.title.split(/\s+/).filter(w => w.length >= 5).some(w => fold(out).includes(fold(w)));
  return !out.includes('____') || giveaway || givesAway(out, b.producer) || out.length > 220 ? null : out;
}
function storiesSeason(all: Bottle[]): Stage[] {
  const S: SeasonId = 'stories';
  const stages: Stage[] = [];
  const withProducer = all.filter(b => b.producer && b.item.wine.anecdote);
  const groups: { title: string; test: (b: Bottle) => boolean }[] = [
    { title: 'Tuscan houses', test: b => b.parent === 'Tuscany' },
    { title: 'Piedmont families', test: b => b.parent === 'Piedmont' },
    { title: 'California dreamers', test: b => b.country === 'United States' },
    { title: 'French estates', test: b => b.country === 'France' },
    { title: 'Around the world', test: b => !['France', 'Italy', 'United States'].includes(b.country) },
  ];
  for (const g of groups) {
    const firstOf = new Map<string, Bottle>();
    for (const b of shuffle(withProducer.filter(g.test), `${S}.${g.title}`)) if (!firstOf.has(b.producer)) firstOf.set(b.producer, b);
    const picks = [...firstOf.values()].sort((a, b) => Number(!!maskedStory(b)) - Number(!!maskedStory(a))).slice(0, 4);
    if (picks.length < 3) continue;
    const meets: PracticeCard[] = [], qs: PracticeCard[] = [];
    const producers = picks.map(b => b.producer), places = uniq(picks.map(b => b.region || b.country));
    for (const b of picks) {
      const bottle: Glyph = { icon: 'bottle', word: b.producer, wineId: b.id };
      meets.push(card(S, g.title, b.producer, 'meet', { front: bottle, back: bottle, prompt: 'Meet the producer', answer: b.producer, options: [],
        detail: clip(sentence(b.item.wine.anecdote), 170), wineId: b.id }));
      const story = maskedStory(b);
      const storyOptions = optionsFor(b.producer, [...producers, ...withProducer.filter(x => x.country === b.country).map(x => x.producer)], `${S}.story.${b.id}`);
      if (story && storyOptions) qs.push(card(S, g.title, b.producer, 'pick', { front: { icon: 'book', word: 'Who is it?' }, back: bottle,
        prompt: clip(story, 150), answer: b.producer, options: storyOptions, detail: `${b.label} · ${b.region || b.country}`, wineId: b.id }));
      else {
        const options = optionsFor(b.producer, producers, `${S}.whose.${b.id}`);
        if (options) qs.push(card(S, g.title, b.producer, 'pick', { front: { icon: 'bottle', word: '', wineId: b.id }, back: bottle,
          prompt: `Whose bottle is this? (${b.title})`, answer: b.producer, options, detail: `${b.label} · ${b.region || b.country}`, wineId: b.id }));
      }
      const place = b.region || b.country;
      if (places.length < 3) {
        const titleOptions = optionsFor(b.title, picks.map(x => x.title), `${S}.theirs.${b.id}`);
        if (titleOptions && !givesAway(b.producer, b.title)) qs.push(card(S, g.title, b.producer + '-wine', 'flash', { front: { icon: 'book', word: b.producer }, back: { icon: 'bottle', word: b.title, wineId: b.id },
          prompt: `${b.producer}: which wine is theirs?`, answer: b.title, options: titleOptions, detail: `${b.label} · ${place}`, wineId: b.id }));
        continue;
      }
      const placeOptions = optionsFor(place, [...places, ...uniq(all.filter(x => x.country === b.country).map(x => x.region || x.country))], `${S}.where.${b.id}`);
      if (placeOptions) qs.push(card(S, g.title, b.producer + '-where', 'flash', { front: { icon: 'pin', word: b.producer }, back: { icon: 'pin', word: place },
        prompt: `${b.producer}: where?`, answer: place, options: placeOptions, detail: `${b.label} · ${place}, ${b.country}`, wineId: b.id }));
    }
    stages.push(makeStage(S, stages.length, g.title, meets, qs));
  }
  return stages;
}

// ── seasons ──
const SEASON_META: Record<SeasonId, { title: string; short: string; blurb: string; icon: Glyph }> = {
  grapes: { title: 'Grapes & styles', short: 'GRAPES', blurb: 'From red, white and bubbles to the grapes behind them.', icon: { icon: 'grape', word: 'Grapes', grape: 'Nebbiolo' } },
  regions: { title: 'Regions & countries', short: 'REGIONS', blurb: 'Where wine comes from, lit up on the globe.', icon: { icon: 'globe', word: 'Regions', country: 'Italy' } },
  notes: { title: 'Tasting notes', short: 'NOTES', blurb: 'Classic markers, then the catalog’s own notes.', icon: { icon: 'nose', word: 'Notes' } },
  stories: { title: 'Producers & stories', short: 'STORIES', blurb: 'The people and places behind the bottles.', icon: { icon: 'book', word: 'Stories' } },
};
export const SEASON_ORDER: SeasonId[] = ['grapes', 'regions', 'notes', 'stories'];
export const BOSS_SIZE = 8;
let built: Season[] | null = null;
export function seasons(): Season[] {
  if (built) return built;
  const all = catalogBottles();
  const make: Record<SeasonId, (b: Bottle[]) => Stage[]> = { grapes: grapesSeason, regions: regionsSeason, notes: notesSeason, stories: storiesSeason };
  built = SEASON_ORDER.map(id => {
    const stages = make[id](all);
    const boss: Stage = { id: 'boss', season: id, index: stages.length, title: `${SEASON_META[id].title}: boss`, boss: true, cards: stages.flatMap(s => s.cards).filter(c => c.kind !== 'meet') };
    return { id, ...SEASON_META[id], stages, boss };
  });
  return built;
}
export function season(id: SeasonId): Season { return seasons().find(s => s.id === id)!; }
export function practiceCard(id: string): PracticeCard | null {
  for (const s of seasons()) for (const st of s.stages) { const c = st.cards.find(x => x.id === id); if (c) return c; }
  return null;
}
/** Problems that would make a card unfair or unrenderable (used by tests and the dev check). */
export function cardProblems(c: PracticeCard): string[] {
  const p: string[] = [];
  if (!/^p\.[a-z0-9.-]{1,112}$/.test(c.id)) p.push('id');
  if (c.kind !== 'meet') {
    if (c.options.filter(o => o === c.answer).length !== 1) p.push('answer not exactly once');
    if (new Set(c.options.map(fold)).size !== c.options.length) p.push('duplicate options');
    if (c.kind !== 'spot' && c.options.length < 3) p.push('too few options');
    if (c.kind !== 'spot' && givesAway(c.prompt, c.answer)) p.push('prompt gives the answer');
  }
  return p;
}
