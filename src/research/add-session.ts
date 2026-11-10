export type AddPhase = 'ready' | 'opening' | 'listening' | 'transcribing' | 'researching' | 'review' | 'options' | 'saving' | 'saved' | 'error';
export interface WineDraft {
  id: string;
  result: { bottle_outline?: import('../../prompts/wine-schema').PhotoOutline | null; wine_name: string; producer: string | null; vintage: number | null; vintage_state: string; region?: string; country?: string; grape?: string; color?: string; sake_classification?: string; sake_style?: string; rice_variety?: string; tasting_notes?: string; uncertainty?: string };
}
type Dependencies = {
  research: (query: string, signal: AbortSignal) => Promise<{ draft: WineDraft }>;
  save: (draft: WineDraft) => Promise<{ item: { id: string; wine_name: string }; duplicate?: boolean }>;
  changed: () => Promise<void>;
};
/** Explicit review gate; late research never replaces a newer attempt or cancelled screen. */
export class WineAddSession {
  phase: AddPhase = 'ready'; query = ''; error = ''; draft: WineDraft | null = null;
  item: { id: string; wine_name: string } | null = null; duplicate = false;
  private revision = 0;
  private request: AbortController | null = null;
  constructor(private deps: Dependencies) {}
  async setPhase(phase: AddPhase) { this.phase = phase; await this.deps.changed(); }
  cancel() { this.revision++; this.request?.abort(); this.request = null; }
  async reset() { this.cancel(); this.draft = null; this.item = null; this.error = ''; await this.setPhase('ready'); }
  async fail(error: unknown) { this.error = error instanceof Error ? error.message : String(error); await this.setPhase('error'); }
  async lookup(query: string) {
    this.cancel(); const revision = this.revision;
    this.query = query.trim(); this.draft = null;
    if (!this.query) return this.fail(Error('No wine name heard. Tap to try again.'));
    const request = this.request = new AbortController();
    const timer = setTimeout(() => request.abort(), 120000);
    try {
      await this.setPhase('researching');
      if(revision !== this.revision)return;
      const result = await this.deps.research(this.query, request.signal);
      if (revision !== this.revision) return;
      if (!result.draft?.id || !result.draft.result?.wine_name) throw Error('No wine identified. Say the name and producer again.');
      this.draft = result.draft; await this.setPhase('review');
    } catch (error) { if (revision === this.revision) await this.fail((error as Error).name === 'AbortError' ? Error('Research timed out. Tap to try again.') : error); }
    finally { clearTimeout(timer); }
  }
  async save() {
    if (this.phase !== 'options' || !this.draft) return;
    const revision = this.revision, draft = this.draft;
    await this.setPhase('saving');
    if(revision !== this.revision)return;
    try {
      const result = await this.deps.save(draft);
      if (revision !== this.revision) return;
      this.item = result.item; this.duplicate = !!result.duplicate; await this.setPhase('saved');
    } catch (error) { if (revision === this.revision) await this.fail(error); }
  }
}
