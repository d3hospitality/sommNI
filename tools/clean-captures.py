"""Marketing copies of G2 captures without the dithered backdrops.

On the glasses the faint dither behind a map (country fill, sea grid, the lens-mask falloff) reads as
atmosphere. Composited onto a 3D lens or a store photo it becomes a flat green patch, because any lit
pixel turns opaque there. This keeps everything bright (text, bottle, region glow, winery dots) and the
dim pixels that touch it (glyph and bottle edges), and clears dim pixels that stand on their own.

  python3 tools/clean-captures.py raw_dir out_dir        # 576x288 captures on black -> cleaned, on black
  python3 tools/clean-captures.py raw_dir out_dir --alpha # ... -> transparent (alpha = brightness), for stores
"""
import sys, pathlib
import numpy as np
from PIL import Image

# The simulator draws the 16 levels as green 0, 96, 131, 157, 179, 197, 214, 230, 244, 255 ... (max channel).
BRIGHT = 197      # real content: text, bottle highlights, region glow, winery dots
DIM = 131         # levels 1-2 (dither fills) are backdrop unless they touch bright content
REACH = 2         # pixels: how close a dim pixel must be to bright content to stay (anti-aliasing, edges)
# Per capture: the Atlas region view's sea/land grid sits one level higher.
DIM_FOR = {'glasses-atlas-region.png': 157}


def clean(rgb: np.ndarray, dim: int = DIM) -> np.ndarray:
    level = rgb.max(axis=2).astype(np.int32)
    bright = level >= BRIGHT
    near = np.zeros_like(bright)
    for dy in range(-REACH, REACH + 1):
        for dx in range(-REACH, REACH + 1):
            near |= np.roll(np.roll(bright, dy, axis=0), dx, axis=1)
    backdrop = (level > 0) & (level <= dim) & ~near
    out = rgb.copy()
    out[backdrop] = 0
    return out


def main():
    src, dst = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    alpha = '--alpha' in sys.argv
    dst.mkdir(parents=True, exist_ok=True)
    for path in sorted(src.glob('*.png')):
        rgb = np.asarray(Image.open(path).convert('RGB'))
        out = clean(rgb, DIM_FOR.get(path.name, DIM))
        if alpha:
            a = out.max(axis=2).astype(np.float32)
            colour = np.zeros_like(out, dtype=np.float32)
            lit = a > 0
            for c in range(3):
                colour[..., c][lit] = np.clip(out[..., c][lit] * 255.0 / a[lit], 0, 255)
            image = Image.fromarray(np.dstack([colour, a]).astype(np.uint8))
        else:
            image = Image.fromarray(out)
        image.save(dst / path.name)
        print('cleaned', path.name)


if __name__ == '__main__':
    main()
