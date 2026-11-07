// Bundled catalog bottle images keep their old file names (w0.png … w214.png), which
// the pixel-art sprites used before. Web views and GitHub Pages cache those names,
// so a device that saw the old sprites could keep showing them after the photographs
// shipped. The version query makes every client fetch the current set.
// Bump it whenever public/bottles/ is regenerated (see public/bottles/manifest.json "pipeline").
export const BOTTLE_ASSET_VERSION = 'photographic-v3'; // v3: hosted photos match bundle; ambiguous Pahlmeyer label explicitly pending.

export function bottleImageUrl(baseUrl: string, assetId: string): string {
  return `${baseUrl}bottles/${assetId === 'w105' ? 'photo-pending.svg' : assetId + '.png'}?v=${BOTTLE_ASSET_VERSION}`;
}
