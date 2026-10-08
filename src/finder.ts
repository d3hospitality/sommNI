// ═══════════════════════════════════════════════════════════════════
// Find My Wine — ask like a sommelier, learn from the Winebrary, explain every pick.
//
// Five questions (the moment, the food, the colour, the feel, the flavour), any of which can be
// skipped. Every shown catalog wine, and every wine in the person's Winebrary, is scored with the
// reasons a sommelier would give ("Tannin and depth for red meat", "Like your Grand Malbec").
// What the person keeps nudges the ranking. With the default wines hidden, only the Winebrary
// is searched. Shared by the glasses (events.ts) and the phone (finder-phone.ts).
// The pairing rules are textbook guidance, not a tasting.
// ═══════════════════════════════════════════════════════════════════
import { allCatalogWines, lookupWineById, type CatalogWine } from './identity';
import { VIBE_MAP, FLAVOR_MAP, getFlavorOptionsForType, TYPE_DISPLAY, type WineType } from './constants';
import { grapeKey } from './study/seasons';
import { catalogWineShown } from './catalog-view';
// Same names as the Study seasons' blends (kept literal: no evaluation-order dependency).
const BLEND_CAB = 'Cabernet & Merlot', BLEND_PINOT = 'Pinot & Chardonnay';

export interface FinderOption { id: string; label: string }
export interface FinderStep { id: 'moment' | 'food' | 'color' | 'taste' | 'flavor'; question: string; options: FinderOption[] }
export type FinderAnswers = Partial<Record<FinderStep['id'], string>>;
/** What the finder needs to know about a saved wine (a Winebrary row). */
export interface SavedWine {
  id?: string; wine_id?: string | null; wine_name: string; producer?: string | null; vintage?: number | null;
  region?: string | null; notes?: string | null; metadata?: { color?: string; grape?: string; country?: string } | null;
}

const MOMENTS: FinderOption[] = [
  { id: 'dinner', label: 'Dinner' }, { id: 'celebration', label: 'Celebrating' }, { id: 'weeknight', label: 'A weeknight glass' },
  { id: 'gift', label: 'A gift' }, { id: 'explore', label: 'Something new' },
];
const FOODS: FinderOption[] = [
  { id: 'steak', label: 'Steak & red meat' }, { id: 'poultry', label: 'Chicken & pork' }, { id: 'seafood', label: 'Fish & seafood' },
  { id: 'pasta', label: 'Pasta & pizza' }, { id: 'spicy', label: 'Spicy food' }, { id: 'cheese', label: 'Cheese' },
  { id: 'dessert', label: 'Dessert' }, { id: 'none', label: 'Just sipping' },
];
const COLORS: FinderOption[] = [
  { id: 'Red', label: 'Red' }, { id: 'White', label: 'White' }, { id: 'Sparkling', label: 'Sparkling' }, { id: 'Rose', label: 'Rosé' }, { id: 'Dessert', label: 'Sweet' },
];
const TASTES: FinderOption[] = [
  { id: 'fresh', label: 'Fresh & crisp' }, { id: 'smooth', label: 'Smooth & easy' }, { id: 'bold', label: 'Bold & powerful' },
  { id: 'elegant', label: 'Elegant & complex' }, { id: 'funky', label: 'Wild & earthy' }, { id: 'cozy', label: 'Warm & oaky' },
];
export const SKIP = 'skip';
export const STEP_COUNT = 5;

/** The five questions; the flavour options follow the colour. */
export function finderSteps(answers: FinderAnswers = {}): FinderStep[] {
  const color = answers.color && answers.color !== SKIP ? answers.color as WineType : null;
  return [
    { id: 'moment', question: 'What’s the moment?', options: MOMENTS },
    { id: 'food', question: 'What are you eating?', options: FOODS },
    { id: 'color', question: 'Any colour in mind?', options: COLORS },
    { id: 'taste', question: 'How should it feel?', options: TASTES },
    { id: 'flavor', question: 'Which flavours call you?', options: getFlavorOptionsForType(color) },
  ];
}
/** Answer one step. A new colour clears the flavour (its options follow the colour). */
export function answerStep(answers: FinderAnswers, step: FinderStep['id'], value: string): FinderAnswers {
  const next = { ...answers, [step]: value };
  if (step === 'color' && answers.color !== value) delete next.flavor;
  return next;
}

// Textbook pairings: grapes and styles that classically work, and why.
interface Pairing { grapes: string[]; types: WineType[]; styles: string[]; why: string }
const PAIRINGS: Record<string, Pairing> = {
  steak: { grapes: ['Cabernet Sauvignon', BLEND_CAB, 'Syrah', 'Malbec', 'Nebbiolo', 'Tempranillo', 'Touriga Nacional', 'Merlot'], types: ['Red'], styles: ['Dry – Full', 'Dry – Structured'], why: 'Tannin and depth for red meat' },
  poultry: { grapes: ['Pinot Noir', 'Chardonnay', 'Grenache', 'Gamay', 'Chenin Blanc'], types: ['Red', 'White', 'Rose'], styles: ['Dry – Elegant', 'Dry – Medium', 'Dry – Oaked'], why: 'Medium weight that lets chicken and pork shine' },
  seafood: { grapes: ['Sauvignon Blanc', 'Albariño', 'Chardonnay', 'Riesling', 'Assyrtiko', 'Pinot Grigio', 'Grüner Veltliner', BLEND_PINOT, 'Trebbiano', 'Cortese'], types: ['White', 'Sparkling', 'Rose'], styles: ['Dry – Crisp', 'Dry – Mineral-Driven', 'Brut', 'Extra Brut'], why: 'Crisp acidity and a saline edge for seafood' },
  pasta: { grapes: ['Sangiovese', 'Barbera', 'Nebbiolo', 'Tempranillo', 'Grenache', 'Montepulciano'], types: ['Red'], styles: ['Dry – Medium', 'Dry – Elegant'], why: 'Bright acidity for tomato, cheese and herbs' },
  spicy: { grapes: ['Riesling', 'Grenache', 'Pinot Noir', 'Gewürztraminer', 'Viognier'], types: ['White', 'Rose', 'Sparkling'], styles: ['Dry – Aromatic', 'Dry – Fruit-Forward', 'Dry – Crisp'], why: 'Fruit and freshness cool the heat; little tannin' },
  cheese: { grapes: ['Nebbiolo', 'Cabernet Sauvignon', 'Chardonnay', BLEND_PINOT, 'Touriga Nacional'], types: ['Red', 'White', 'Sparkling', 'Dessert'], styles: ['Dry – Structured', 'Sweet', 'Brut', 'Dry – Oaked'], why: 'Structure (or sweetness) to stand up to cheese' },
  dessert: { grapes: [], types: ['Dessert'], styles: ['Sweet'], why: 'Sweeter than the dessert, so neither tastes flat' },
};
const OLD_WORLD = new Set(['France', 'Italy', 'Spain', 'Germany', 'Austria', 'Portugal', 'Greece']);
const WINE_TYPES = new Set<string>(['Red', 'White', 'Sparkling', 'Rose', 'Orange', 'Dessert']);

export interface FinderResult {
  /** Catalog ID, or "lib:<row id>" for a Winebrary wine with no catalog twin. */
  key: string;
  /** The catalog wine (full notes, bottle image), when there is one. */
  item: CatalogWine | null;
  /** The person's own saved wine, when this pick is in their Winebrary. */
  saved: SavedWine | null;
  title: string; producer: string; grape: string; type: string; country: string; region: string;
  score: number; reasons: string[]; mine: boolean;
}
interface Candidate {
  key: string; item: CatalogWine | null; saved: SavedWine | null;
  type: string; country: string; region: string; grape: string; style: string; nose: string; palate: string; story: string;
  title: string; producer: string;
}
interface Profile { grapes: Map<string, string>; types: Map<string, number>; countries: Map<string, number>; owned: Map<string, SavedWine>; size: number }
const typeOf = (color: string | undefined) => color && WINE_TYPES.has(color) ? color : color === 'Rosé' ? 'Rose' : '';
function profileOf(library: SavedWine[]): Profile {
  const grapes = new Map<string, string>(), types = new Map<string, number>(), countries = new Map<string, number>(), owned = new Map<string, SavedWine>();
  for (const w of library) {
    const twin = w.wine_id ? lookupWineById(w.wine_id) : null;
    const type = typeOf(w.metadata?.color) || twin?.type || '';
    const rawGrape = w.metadata?.grape || twin?.wine.grape || '';
    if (rawGrape) { const g = grapeKey(rawGrape, (type || 'Red') as WineType); if (!grapes.has(g)) grapes.set(g, w.wine_name); }
    if (type) types.set(type, (types.get(type) || 0) + 1);
    const country = w.metadata?.country || twin?.country;
    if (country) countries.set(country, (countries.get(country) || 0) + 1);
    if (twin) owned.set(twin.id, w);
  }
  return { grapes, types, countries, owned, size: library.length };
}
const has = (text: string, words: string[]) => words.some(w => text.includes(w));
function splitName(name: string) { const at = name.lastIndexOf(' – '); return at > 0 ? { title: name.slice(0, at).trim(), producer: name.slice(at + 3).trim() } : { title: name, producer: '' }; }

/** Every wine the finder may suggest: shown catalog wines, owned catalog twins, then the person's own wines. */
function candidates(library: SavedWine[], p: Profile): Candidate[] {
  const out: Candidate[] = [];
  for (const item of allCatalogWines()) {
    const saved = p.owned.get(item.id) ?? null;
    if (!saved && !catalogWineShown(item.id)) continue;
    const w = item.wine, { title, producer } = splitName(w.name);
    out.push({ key: item.id, item, saved, type: item.type, country: item.country, region: w.region || '', grape: grapeKey(w.grape, item.type), style: w.style || '',
      nose: (w.nose || '').toLowerCase(), palate: (w.palate || '').toLowerCase(), story: w.anecdote || '', title, producer });
  }
  const seen = new Set<string>();
  for (const s of library) {
    if (s.wine_id && lookupWineById(s.wine_id)) continue; // already above, with the catalog notes
    const id = s.id || `${s.wine_name}|${s.producer || ''}|${s.vintage || ''}`;
    if (seen.has(id)) continue; seen.add(id);
    const type = typeOf(s.metadata?.color), notes = (s.notes || '').toLowerCase();
    out.push({ key: `lib:${id}`, item: null, saved: s, type, country: s.metadata?.country || '', region: s.region || '',
      grape: s.metadata?.grape ? grapeKey(s.metadata.grape, (type || 'Red') as WineType) : '', style: '',
      nose: notes, palate: notes, story: '', title: s.wine_name, producer: s.producer || '' });
  }
  return out;
}

/** Score every candidate against the answers and the Winebrary; best first, with reasons. */
export function findWines(answers: FinderAnswers, library: SavedWine[] = [], limit = 12): FinderResult[] {
  const p = profileOf(library), out: FinderResult[] = [];
  const pick = (k: FinderStep['id']) => answers[k] && answers[k] !== SKIP ? answers[k]! : null;
  const moment = pick('moment'), food = pick('food'), color = pick('color'), taste = pick('taste'), flavor = pick('flavor');
  const pairing = food ? PAIRINGS[food] : null;
  for (const c of candidates(library, p)) {
    const { type, style, nose, palate, grape } = c, mine = !!c.saved;
    if (color && type !== color) continue;
    if (food === 'dessert' && type !== 'Dessert' && style !== 'Sweet') continue;
    if (food && food !== 'dessert' && food !== 'cheese' && type === 'Dessert') continue;
    let score = 0; const reasons: [number, string][] = [];
    const add = (n: number, why?: string) => { score += n; if (why) reasons.push([n, why]); };
    if (pairing) {
      if (grape && pairing.grapes.includes(grape)) add(12, `${pairing.why}: ${grape} is a classic`);
      else if (pairing.types.includes(type as WineType)) add(5, pairing.why);
      if (pairing.styles.includes(style)) add(4);
      if (!pairing.types.includes(type as WineType) && !pairing.grapes.includes(grape)) add(-8);
    }
    if (moment === 'celebration' && type === 'Sparkling') add(10, 'Bubbles for a celebration');
    if (moment === 'weeknight') { if (has(style, ['Medium', 'Fruit-Forward', 'Crisp'])) add(5, 'Easygoing for a weeknight'); if (has(style, ['Structured'])) add(-3); if (mine) add(3, 'Already on your shelf'); }
    if (moment === 'gift') { if (c.story.length > 300) add(4, 'A bottle with a story to tell'); if (has(style, ['Structured', 'Full', 'Elegant'])) add(3); }
    if (moment === 'explore') {
      if (mine) add(-6);
      else if (grape && !p.grapes.has(grape)) add(5, `Something new for you: ${grape}`);
      if (c.country && !OLD_WORLD.has(c.country) && c.country !== 'United States') add(3, `From ${c.country}`);
    }
    if (moment === 'dinner' && !food && has(style, ['Elegant', 'Medium', 'Structured'])) add(3, 'Built for the table');
    if (taste) {
      const v = VIBE_MAP[taste];
      if (v) {
        const label = TASTES.find(t => t.id === taste)!.label;
        if (v.styles.includes(style)) add(v.weight, `${label}: ${style.replace('Dry – ', '').toLowerCase()}`);
        if (has(palate, v.palate)) add(v.weight * 0.7, c.item ? undefined : `${label}, from your notes`);
      }
    }
    if (flavor) {
      const f = FLAVOR_MAP[flavor];
      if (f) {
        const hit = f.nose.find(k => nose.includes(k));
        if (hit) add(f.weight, c.item ? `On the nose: ${hit}` : `Your notes mention ${hit}`);
        if (f.palate?.some(k => palate.includes(k))) add(f.weight * 0.5);
      }
    }
    // The Winebrary: more of what you keep. Your own bottle is a pick in its own right.
    if (p.size) {
      const liked = grape ? p.grapes.get(grape) : undefined;
      if (liked && liked !== c.saved?.wine_name) add(Math.min(6, 2 + p.size / 5), `Like your ${liked}`);
      else if (!mine && (p.types.get(type) || 0) >= 2) add(2);
      if (!mine && (p.countries.get(c.country) || 0) >= 2) add(1.5);
    }
    reasons.sort((a, b) => b[0] - a[0]);
    out.push({ key: c.key, item: c.item, saved: c.saved, title: c.title, producer: c.producer, grape: c.grape, type: c.type, country: c.country, region: c.region,
      score, reasons: [...new Set(reasons.filter(([n]) => n > 0).map(([, r]) => r))].slice(0, 3), mine });
  }
  // Ties go to a steady order (key), so the same answers give the same list. Then a
  // sommelier's spread: at most two of one grape near the top, the rest move down the list.
  const ranked = out.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const seen = new Map<string, number>(), first: FinderResult[] = [], later: FinderResult[] = [];
  for (const r of ranked) { const g = r.grape || r.key, n = seen.get(g) || 0; seen.set(g, n + 1); (n < 2 ? first : later).push(r); }
  // And the best bottle already on their shelf, when it fits nearly as well, sits second.
  const list = [...first, ...later];
  const shelf = list.findIndex(r => r.mine && r.score > 0 && r.score >= list[0].score * 0.6);
  if (shelf > 2) { const [own] = list.splice(shelf, 1); list.splice(1, 0, own); }
  return list.slice(0, limit);
}
/** A one-line summary of the answers, for headings ("Steak & red meat · Red · Bold & powerful"). */
export function answersLine(answers: FinderAnswers): string {
  const steps = finderSteps(answers);
  return steps.map(s => answers[s.id] && answers[s.id] !== SKIP ? s.options.find(o => o.id === answers[s.id])?.label : null).filter(Boolean).join(' · ') || 'Anything goes';
}
/** "Malbec · Argentina" (what the pick is, in a few words). */
export function resultLine(r: FinderResult): string {
  return [r.grape, r.country].filter(Boolean).join(' · ') || (r.type ? TYPE_DISPLAY[r.type as WineType] ?? r.type : '');
}
