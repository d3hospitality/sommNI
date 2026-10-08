#!/usr/bin/env python3
"""Glasses bottle images for the wineLENS backend (served from the site at /g2/bottles/).

The glasses never show colour and never draw a bottle taller than ~280 px, yet they used to
download the full 384 × 768 colour photograph (~160 KB) for every page. This makes one small
source per catalog wine, named by its catalog ID:

  · cropped to the bottle (alpha > 8) with a 2% margin, so the phone does no trimming work;
  · 420 px tall (1.5× the largest G2 bottle), keeping the aspect ratio;
  · greyscale + alpha (ITU-R 601 luma, the same weights as toGreenLevels), so the phone's
    tone mapping, stage lighting and reflection produce the same pixels as before.

  python3 scripts/build-g2-bottles.py            # check: report what would change
  python3 scripts/build-g2-bottles.py --write    # write site/public/g2/bottles/*.png + index.json

index.json maps catalog ID → file + content hash. After changing the output, bump
G2_BOTTLE_VERSION in src/bottle-assets.ts so devices refetch.
"""
import hashlib, io, json, sys
from pathlib import Path
from PIL import Image

HEIGHT = 420
MARGIN = 0.02
PIPELINE = 'g2-v1'
ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'public' / 'bottles'
OUT = ROOT / 'site' / 'public' / 'g2' / 'bottles'
IDENTITY = ROOT / 'src' / 'data' / 'catalog-identity.json'


def g2_png(path: Path) -> bytes:
    rgba = Image.open(path).convert('RGBA')
    alpha = rgba.getchannel('A')
    box = alpha.point(lambda a: 255 if a > 8 else 0).getbbox()
    if box is None:
        raise ValueError(f'{path.name}: no opaque pixels')
    left, top, right, bottom = box
    pad = round(max(right - left, bottom - top) * MARGIN)
    left, top = max(0, left - pad), max(0, top - pad)
    right, bottom = min(rgba.width, right + pad), min(rgba.height, bottom + pad)
    crop = rgba.crop((left, top, right, bottom))
    scale = HEIGHT / crop.height
    size = (max(1, round(crop.width * scale)), HEIGHT)
    crop = crop.resize(size, Image.LANCZOS)
    la = Image.merge('LA', (crop.convert('L'), crop.getchannel('A')))
    buffer = io.BytesIO()
    la.save(buffer, 'PNG', optimize=True)
    return buffer.getvalue()


def main(write: bool) -> int:
    identity = json.loads(IDENTITY.read_text())
    manifest = json.loads((SOURCE / 'manifest.json').read_text())
    # Only reviewed photographs: a manifest "issue" (e.g. an ambiguous label) is never exported.
    reviewed = {a['id'] for a in manifest['assets']}
    entries = [e for e in identity['entries'] if e.get('legacy_id') in reviewed and e.get('status') == 'active']
    wines, missing, total = {}, [], 0
    if write:
        OUT.mkdir(parents=True, exist_ok=True)
    for entry in entries:
        source = SOURCE / f"{entry['legacy_id']}.png"
        if not source.exists():
            missing.append(entry['id'])
            continue
        data = g2_png(source)
        total += len(data)
        file = f"{entry['id']}.png"
        wines[entry['id']] = {'file': file, 'asset': entry['legacy_id'], 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()[:16]}
        if write:
            (OUT / file).write_bytes(data)
    index = {'pipeline': PIPELINE, 'source_pipeline': manifest.get('pipeline'), 'held_for_review': sorted(i['id'] for i in manifest.get('issues', [])),
             'height': HEIGHT, 'format': 'PNG greyscale + alpha', 'count': len(wines), 'wines': wines}
    if write:
        (OUT / 'index.json').write_text(json.dumps(index, indent=1, sort_keys=True) + '\n')
        for stale in OUT.glob('*.png'):
            if stale.stem not in wines:
                stale.unlink()
    print(json.dumps({'wines': len(wines), 'missing_source': missing, 'total_kb': round(total / 1024), 'avg_kb': round(total / 1024 / max(1, len(wines)), 1), 'written': write}))
    return 0


if __name__ == '__main__':
    sys.exit(main('--write' in sys.argv))
