// ═══════════════════════════════════════════════════════════════════
// wineLENS — one way to read tasting notes everywhere (phone + G2).
// Catalog wines, AI notes and label-scan drafts share the LOOK / NOSE /
// PALATE / FINISH / STORY layout. Every note says where it came from.
// ═══════════════════════════════════════════════════════════════════
import type { Wine } from './constants';
import { lookupWineById } from './identity';
import type { LibraryWine } from './winebrary';

export type NotesSource = 'user' | 'scan' | 'generated' | 'catalog';
export interface NoteSection { label: string; text: string }
export interface WineNotes { source: NotesSource | null; sections: NoteSection[] | null; text: string }

export const SOURCE_LABEL: Record<NotesSource, string> = {
  user: 'Your notes',
  scan: 'Draft from your label scan · check it against the bottle',
  generated: 'wineLENS notes · the expected profile, not a tasting',
  catalog: 'Catalog notes · not producer-verified',
};
const GLASSES_FOOTER: Record<NotesSource, string> = {
  user: '', scan: '— Label-scan draft', generated: '— wineLENS notes · expected profile', catalog: '— Catalog notes · not producer-verified',
};

export function catalogSections(wine: Wine): NoteSection[] {
  return ([['LOOK', wine.appearance], ['NOSE', wine.nose], ['PALATE', wine.palate], ['FINISH', wine.finish], ['STORY', wine.anecdote]] as [string, string][])
    .filter(([, t]) => t && t.trim()).map(([label, text]) => ({ label, text: text.trim() }));
}
export const sectionsText = (sections: NoteSection[]) => sections.map(s => `${s.label}  ${s.text}`).join('\n\n');

/** "LOOK  …\n\nNOSE  …" (catalog / AI layout) → sections. Free text → null. */
export function parseSections(text: string | null | undefined): NoteSection[] | null {
  if (!text) return null;
  const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const sections = blocks.map(b => {
    const m = b.match(/^(LOOK|NOSE|PALATE|FINISH|STORY)\s+([\s\S]+)$/);
    return m ? { label: m[1], text: m[2].trim() } : null;
  });
  return sections.length && sections.every(Boolean) ? sections as NoteSection[] : null;
}

/** A Winebrary wine shows the owner's notes; with none, its catalog twin's notes. */
export function libraryNotes(wine: LibraryWine): WineNotes {
  const own = wine.notes?.trim();
  if (own) {
    const src = wine.metadata?.notes_source;
    const source: NotesSource = src === 'generated' || src === 'scan' ? src : 'user';
    return { source, sections: parseSections(own), text: own };
  }
  const twin = lookupWineById(wine.wine_id)?.wine;
  if (twin) { const sections = catalogSections(twin); if (sections.length) return { source: 'catalog', sections, text: sectionsText(sections) }; }
  return { source: null, sections: null, text: '' };
}

/** Glasses body text: the notes, then a one-line source note (like the catalog notes page). */
export function glassesNotes(wine: LibraryWine): string {
  const notes = libraryNotes(wine);
  if (!notes.source) return 'No notes yet. Write your own, or let wineLENS draft them, in Winebrary on your phone.';
  const footer = GLASSES_FOOTER[notes.source];
  return footer ? `${notes.text}\n\n${footer}` : notes.text;
}
