// ═══════════════════════════════════════════════════════════════════
// wineLENS — reference claims and study cards (PRD R-01…R-05, S-03, S-05)
//
// A scored card exists only when every claim it cites is approved and its
// source is available. Everything else about a wine is shown as unverified
// catalog data. Subjective tasting notes never become scored cards.
// ═══════════════════════════════════════════════════════════════════
import references from '../data/references.json';
import cardData from '../data/study-cards.json';
import { lookupWineById } from '../identity';

export interface Source { id: string; publisher: string; title: string; kind: string; url: string; retrieved_at: string; sha256: string; availability: string }
export interface Release { id: string; wine_id: string; scope: string; vintage_state: string | null; year: number | null; release_code: string | null }
export interface Claim { id: string; wine_id: string; release_id: string | null; field: string; value: unknown; source_id: string; locator: string; status: string; reviewer: string; reviewed_at: string; revision: number }
export interface StudyCard {
  id: string; version: number; wine_id: string; release_id: string | null; skill: string;
  subject: string; prompt: string; answer: string; explanation: string;
  match: string[][]; options?: string[]; claims: string[]; hide_image: boolean;
}
export interface OpenItem { wine_id: string; status: string; note: string }

const data = references as unknown as { sources: Source[]; releases: Release[]; claims: Claim[]; open_items: OpenItem[] };
const sources = new Map(data.sources.map(s => [s.id, s]));
const claims = new Map(data.claims.map(c => [c.id, c]));
const releases = new Map(data.releases.map(r => [r.id, r]));

/** Accent/case/punctuation-insensitive form used for answer matching and option uniqueness. */
export function normalizeAnswer(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();
}
/** True when every required part of the reference answer appears in the typed answer. */
export function answerMatches(card: StudyCard, typed: string): boolean {
  const t = normalizeAnswer(typed);
  return t.length > 0 && card.match.length > 0 && card.match.every(group => group.some(alt => t.includes(normalizeAnswer(alt))));
}

/** Why a card cannot be studied, or null when it is eligible. */
export function cardProblem(card: StudyCard): string | null {
  if (!lookupWineById(card.wine_id)) return 'unknown wine';
  if (card.release_id && !releases.has(card.release_id)) return 'unknown release';
  if (!card.claims.length) return 'no supporting claim';
  for (const id of card.claims) {
    const claim = claims.get(id);
    if (!claim) return `missing claim ${id}`;
    if (claim.status !== 'approved') return `claim ${id} is ${claim.status}`;
    if (claim.wine_id !== card.wine_id) return `claim ${id} belongs to another wine`;
    if (card.release_id && claim.release_id && claim.release_id !== card.release_id) return `claim ${id} is scoped to another release`;
    const source = sources.get(claim.source_id);
    if (!source || source.availability !== 'available') return `source for ${id} unavailable`;
  }
  if (!card.match.length) return 'no answer key';
  if (card.options) {
    const norm = card.options.map(normalizeAnswer);
    if (new Set(norm).size !== norm.length) return 'duplicate options';
    if (card.options.filter(o => o === card.answer).length !== 1) return 'answer must appear exactly once in options';
    if (card.options.filter(o => answerMatches(card, o)).length !== 1) return 'a distractor also matches the answer key';
  }
  return null;
}

const allCards = (cardData as { cards: StudyCard[] }).cards;
export const STUDY_CARDS: StudyCard[] = allCards.filter(c => cardProblem(c) === null);
const cardsById = new Map(STUDY_CARDS.map(c => [c.id, c]));
export function getCard(id: string): StudyCard | null { return cardsById.get(id) ?? null; }
export function rejectedCards(): { id: string; problem: string }[] {
  return allCards.map(c => ({ id: c.id, problem: cardProblem(c) })).filter((x): x is { id: string; problem: string } => x.problem !== null);
}

export interface Citation { source: Source; locator: string; scope: string }
/** Sources behind a card, in citation order, de-duplicated. */
export function cardSources(card: StudyCard): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const id of card.claims) {
    const claim = claims.get(id)!;
    if (seen.has(claim.source_id)) continue;
    seen.add(claim.source_id);
    out.push({ source: sources.get(claim.source_id)!, locator: claim.locator, scope: claim.release_id ? releases.get(claim.release_id)!.scope : 'wine identity' });
  }
  return out;
}

/** Reference status for a catalog wine: approved claims and open questions. */
export function wineReferences(wineId: string): { claims: (Claim & { source: Source; release: Release | null })[]; open: OpenItem[] } {
  return {
    claims: data.claims.filter(c => c.wine_id === wineId && c.status === 'approved')
      .map(c => ({ ...c, source: sources.get(c.source_id)!, release: c.release_id ? releases.get(c.release_id) ?? null : null })),
    open: data.open_items.filter(o => o.wine_id === wineId),
  };
}
