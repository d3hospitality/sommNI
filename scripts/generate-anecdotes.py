#!/usr/bin/env python3
"""Process a pre-seeded, expiring editorial run. Never reads an OpenAI key."""
from pathlib import Path
import argparse, concurrent.futures, json, time, urllib.request, urllib.error

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--run-file', required=True, help='Private JSON file containing the temporary run token; do not commit it')
parser.add_argument('--workers', type=int, default=4, choices=range(1, 9))
parser.add_argument('--output', required=True, help='Safe JSONL results (contains no token)')
parser.add_argument('wine_ids', nargs='*', help='Canonical or frozen legacy IDs; defaults to the full seeded catalog')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
run = json.loads(Path(args.run_file).read_text())
wines = json.loads((root/'supabase/functions/winelens-beta/data/catalog.json').read_text())['wines']
known = {key for wine in wines for key in (wine['id'], wine['legacyId'])}
if set(args.wine_ids) - known:
    parser.error('Unknown catalog wine ID')
wines = [wine for wine in wines if not args.wine_ids or wine['id'] in args.wine_ids or wine['legacyId'] in args.wine_ids]

def process(wine):
    started = time.monotonic()
    request = urllib.request.Request('https://mcmtasetompygfktzhpr.supabase.co/functions/v1/sommni-anecdotes',
        data=json.dumps({'wine_id':wine['id']}).encode(), method='POST',
        headers={'Content-Type':'application/json','x-anecdote-run':run['token']})
    try:
        with urllib.request.urlopen(request, timeout=220) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        result = {'status':'error','http_status':error.code,'error':error.read().decode()[:350]}
    except Exception as error:
        result = {'status':'error','error':str(error)}
    result.update(legacy_id=wine['legacyId'],name=wine['name'],seconds=round(time.monotonic()-started,1))
    return result

with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
    for result in pool.map(process, wines):
        line = json.dumps(result, ensure_ascii=False)
        print(line, flush=True)
        with Path(args.output).open('a') as output:
            output.write(line+'\n')
