"""Photo-preserving bottle cutouts, adapted from the reviewed 215-bottle exporter.
Run locally: python3 server/bottle-cutout/worker.py --port 5196
Only accepts image bytes, never URLs. Private SHA cache; serialized CPU work.
"""
import argparse, base64, hashlib, io, json, os, re, threading, tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
os.environ.setdefault('OMP_NUM_THREADS', '2')
import numpy as np
from PIL import Image, ImageOps, ImageFilter
from scipy import ndimage

VERSION = 'photographic-cutout-v1'
SESSION = None
LOCK = threading.Lock()
MAX_BYTES = 2 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 16000000


def cutout(raw):
    global SESSION
    with Image.open(io.BytesIO(raw)) as opened:
        if opened.format not in ('PNG', 'JPEG', 'WEBP') or getattr(opened, 'n_frames', 1) != 1:
            raise ValueError('Use one PNG, JPEG or WebP bottle photograph.')
        if opened.width * opened.height > Image.MAX_IMAGE_PIXELS:
            raise ValueError('Photo is too large. Choose a smaller photograph.')
        image = ImageOps.exif_transpose(opened).convert('RGBA')
    original_size = list(image.size)
    image.thumbnail((1800, 2400), Image.Resampling.LANCZOS)
    rgba = np.asarray(image)
    if np.mean(rgba[:, :, 3] < 16) > .05:
        method = 'source-alpha'
        mask = rgba[:, :, 3]
    else:
        from rembg import new_session, remove
        if SESSION is None:
            SESSION = new_session('u2net', providers=['CPUExecutionProvider'])
        mask = np.asarray(remove(image, session=SESSION, only_mask=True).convert('L'))
        method = 'local-u2net-filled-silhouette'
    binary = mask > 110
    labels, count = ndimage.label(binary)
    if not count:
        raise ValueError('No bottle found. Use a full-bottle photograph.')
    sizes = np.bincount(labels.ravel()); sizes[0] = 0
    largest = sizes.argmax()
    if np.count_nonzero(sizes[1:] > sizes[largest] * .15) > 1:
        raise ValueError('More than one subject found. Crop to one complete bottle first.')
    binary = ndimage.binary_fill_holes(labels == largest)
    ys, xs = np.where(binary)
    if min(xs) < 2 or min(ys) < 2 or max(xs) >= image.width-2 or max(ys) >= image.height-2:
        raise ValueError('The bottle touches the photo edge. Include the complete neck and base with some space around it.')
    bounds = (int(min(xs)), int(min(ys)), int(max(xs)+1), int(max(ys)+1))
    ratio = (bounds[3]-bounds[1]) / (bounds[2]-bounds[0])
    if not 2.1 <= ratio <= 6.8 or bounds[3]-bounds[1] < 180:
        raise ValueError('Use a clear full-bottle photo, rather than a label close-up or a group of bottles.')
    alpha = Image.fromarray((binary*255).astype('uint8')).filter(ImageFilter.GaussianBlur(.45))
    image.putalpha(alpha)  # RGB is retained; label artwork is never generated.
    crop = image.crop(bounds)
    master = Image.new('RGBA', (768, 1536))
    scale = min(680/crop.width, 1440/crop.height)
    size = (round(crop.width*scale), round(crop.height*scale))
    master.alpha_composite(crop.resize(size, Image.Resampling.LANCZOS), ((768-size[0])//2, 1488-size[1]))
    web = master.resize((384, 768), Image.Resampling.LANCZOS)
    # Same inside-edge cleanup as the current photographic-v2 catalog.
    web.putalpha(web.getchannel('A').filter(ImageFilter.MinFilter(3)))
    output = io.BytesIO(); web.save(output, format='PNG', optimize=True)
    return output.getvalue(), {'pipeline': VERSION, 'kind': 'photograph', 'segmentation': method,
        'source_sha256': hashlib.sha256(raw).hexdigest(), 'source_size': original_size,
        'subject_bounds': list(bounds), 'subject_ratio_h_over_w': ratio, 'output_size': [384,768],
        'height_cm': None, 'scale_basis': 'source-photo-aspect-ratio; physical height unverified'}


def serve(port, cache):
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Never log photos or private wine data.
        def reply(self, code, value):
            data = json.dumps(value).encode()
            self.send_response(code); self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store'); self.send_header('Content-Length', str(len(data)))
            self.end_headers(); self.wfile.write(data)
        def do_GET(self):
            self.reply(200 if self.path == '/health' else 404, {'available': self.path == '/health', 'pipeline': VERSION})
        def do_POST(self):
            if self.path != '/cutout': return self.reply(404, {'error': 'Unknown action.'})
            origin = self.headers.get('Origin', '')
            if origin and not re.fullmatch(r'https?://(?:localhost|127\.0\.0\.1)(?::\d+)?', origin):
                return self.reply(403, {'error': 'Local app requests only.'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length < 3000000: return self.reply(413, {'error': 'Choose a photo under 2 MB.'})
                body = json.loads(self.rfile.read(length))
                match = re.fullmatch(r'data:image/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)', body.get('photo', ''))
                if not match: raise ValueError('Choose a PNG, JPEG or WebP photograph.')
                raw = base64.b64decode(match[1], validate=True)
                if len(raw) > MAX_BYTES: return self.reply(413, {'error': 'Choose a photo under 2 MB.'})
                if not LOCK.acquire(blocking=False): return self.reply(409, {'error': 'The bottle cutter is busy. Try again shortly.'})
                try:
                    digest = hashlib.sha256(VERSION.encode()+raw).hexdigest()
                    target = cache/(digest+'.json')
                    reused = target.exists()
                    if reused: result = json.loads(target.read_text())
                    else:
                        png, provenance = cutout(raw)
                        url = 'data:image/png;base64,'+base64.b64encode(png).decode()
                        result = {'url': url, 'path': url, 'source': 'photograph', 'provenance': provenance}
                        temporary = target.with_suffix('.tmp'); temporary.write_text(json.dumps(result)); temporary.replace(target)
                    self.reply(200, {'draft': result, 'cached': reused})
                finally: LOCK.release()
            except (ValueError, TypeError, KeyError, Image.DecompressionBombError) as error:
                self.reply(422, {'error': str(error) if isinstance(error, ValueError) else 'This photo could not be processed. Try a clear full-bottle photograph.'})
            except Exception:
                self.reply(503, {'error': 'The local bottle cutter could not finish. Your original photo is unchanged.'})
    print(f'Bottle cutout worker listening on http://127.0.0.1:{port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--port', type=int, default=5196)
    parser.add_argument('--cache', type=Path, default=Path(tempfile.gettempdir())/'sommni-bottle-cutouts')
    args = parser.parse_args(); serve(args.port, args.cache)
