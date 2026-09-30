#!/usr/bin/env python3
"""Pull the transparent cut-out edge of every catalog bottle a few pixels inward.

Background removal leaves a 1–3 px fringe of half-transparent, near-white pixels
around each bottle. On the ivory web UI it reads as a white outline; on the G2's
green panel it becomes a bright rim. This erodes the alpha mask by EDGE_PX, then
softens the new edge by ~1 px so it doesn't go jagged. Pixels only ever lose
opacity; colors inside the bottle are untouched.

  python3 scripts/trim-bottle-edges.py            # dry run: report what would change
  python3 scripts/trim-bottle-edges.py --write    # rewrite public/bottles/*.png + manifest

Idempotent: the manifest records edge_trim_px and assets already trimmed are skipped.
After writing, bump BOTTLE_ASSET_VERSION in src/bottle-assets.ts so clients refetch.
"""
import hashlib, json, sys
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter

EDGE_PX = 3          # at the 384 × 768 web asset size (~0.8% of bottle width)
FEATHER = 0.8        # Gaussian radius for the new edge
ROOT = Path(__file__).resolve().parent.parent
BOTTLES = ROOT / 'public' / 'bottles'


def trim(image: Image.Image) -> Image.Image:
    rgba = image.convert('RGBA')
    alpha = rgba.getchannel('A')
    solid = alpha.point(lambda a: 255 if a > 8 else 0)
    eroded = solid.filter(ImageFilter.MinFilter(EDGE_PX * 2 + 1))
    soft = eroded.filter(ImageFilter.GaussianBlur(FEATHER))
    rgba.putalpha(ImageChops.darker(alpha, soft))  # never add opacity
    return rgba


def fringe_score(image: Image.Image) -> float:
    """Mean luminance of partially transparent pixels (the visible halo)."""
    rgba = image.convert('RGBA')
    total = count = 0
    for r, g, b, a in rgba.getdata():
        if 8 < a < 250:
            total += 0.299 * r + 0.587 * g + 0.114 * b
            count += 1
    return round(total / count, 1) if count else 0.0


def main() -> None:
    write = '--write' in sys.argv
    manifest_path = BOTTLES / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    changed = []
    for asset in manifest['assets']:
        if asset.get('edge_trim_px') == EDGE_PX:
            continue
        path = BOTTLES / asset['file']
        before = Image.open(path)
        after = trim(before)
        changed.append((asset['id'], fringe_score(before), fringe_score(after)))
        if write:
            after.save(path, optimize=True)
            data = path.read_bytes()
            asset['sha256'] = hashlib.sha256(data).hexdigest()
            asset['bytes'] = len(data)
            asset['edge_trim_px'] = EDGE_PX
    if write and changed:
        manifest['pipeline'] = 'photographic-v2'
        manifest['edge_trim'] = f'alpha eroded {EDGE_PX}px then feathered {FEATHER}px to remove cut-out fringe'
        manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n')
    worst = sorted(changed, key=lambda row: -row[1])[:5]
    print(json.dumps({'assets': len(manifest['assets']), 'trimmed': len(changed), 'written': write,
                      'brightest_fringes_before_after': worst}))


if __name__ == '__main__':
    main()
