// ═══════════════════════════════════════════════════════════════════
// Display ownership — one module drives the G2 display at a time.
//
// Study, Winebrary and the Wine Atlas each take over the glasses and consume events
// while they are active. Before a module sends a page, it claims the display; the
// previous owner is released first (and the release is awaited), so bridge traffic
// from two modules never overlaps. The legacy catalog is the implicit default owner.
// ═══════════════════════════════════════════════════════════════════

type Release = () => Promise<void> | void;
let owner: { name: string; release: Release } | null = null;
let suspended = false;
export function suspendDisplay(value: boolean): void { suspended = value; }
export async function releaseDisplay(): Promise<void> {
  const previous = owner;
  owner = null;
  await previous?.release();
}

/** Take the display. Awaits the previous owner's release (its queues are idle afterwards). */
export async function claimDisplay(name: string, release: Release): Promise<void> {
  if (suspended) throw new Error('Glasses app is not in the foreground.');
  if (owner && owner.name !== name) {
    const previous = owner;
    owner = null;
    try { await previous.release(); }
    catch (error) { console.warn(`[display] ${previous.name} release: ` + (error instanceof Error ? error.message : String(error))); }
  }
  if (suspended) throw new Error('Glasses app is not in the foreground.');
  owner = { name, release };
}

/** Give the display back to the catalog (the module has already rebuilt Home). */
export function dropDisplay(name: string): void {
  if (owner?.name === name) owner = null;
}

export function displayOwner(): string {
  return owner?.name ?? 'catalog';
}
