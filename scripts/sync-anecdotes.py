#!/usr/bin/env python3
"""Bundle the published Supabase anecdotes; reject incomplete catalog snapshots."""
from pathlib import Path
import json, re, urllib.request
root=Path(__file__).resolve().parents[1]
catalog=json.loads((root/'supabase/functions/winelens-beta/data/catalog.json').read_text())['wines']
request=urllib.request.Request('https://mcmtasetompygfktzhpr.supabase.co/functions/v1/winelens-beta',
    data=b'{"action":"catalog_anecdotes"}',headers={'Content-Type':'application/json'},method='POST')
with urllib.request.urlopen(request,timeout=30) as response:
    records=json.load(response)['anecdotes']
by_id={record['wine_id']:record for record in records}
assert len(records)==len(by_id)==len(catalog), 'Incomplete or duplicate catalog snapshot'
assert set(by_id)=={wine['id'] for wine in catalog}, 'Catalog identity mismatch'
assert len({record['anecdote'] for record in records})==len(catalog), 'Duplicate anecdote copy'
for record in records:
    assert record['scope'] in ('wine','producer') and record['sources']
    assert len(record['anecdote'].split('\n\n'))==2 and 150<=len(record['anecdote'])<=850
    assert all(source['url'].startswith('https://') for source in record['sources'])
    for source in record['sources']:
        source['title']=re.sub(r'\s+',' ',re.sub(r'<!--.*?-->','',source['title'])).strip()
# Keep direct WINES consumers and note readers consistent without touching identity/personal data.
path=root/'src/constants.ts';source=path.read_text();marker='export const WINES: Record<string, Record<string, Wine[]>> = '
start=source.index(marker)+len(marker);wines,length=json.JSONDecoder().raw_decode(source[start:])
identity=json.loads((root/'src/data/catalog-identity.json').read_text())
by_key={entry['key']:entry['id'] for entry in identity['entries'] if entry['status']=='active'}
updated=0; anecdotes=[]
for kind,countries in wines.items():
    for country,entries in countries.items():
        for wine in entries:
            anecdotes.append(by_id[by_key[f"{kind}|{country}|{wine['name']}"]]['anecdote']);updated+=1
assert updated==len(catalog)
values=iter(anecdotes)
patched,count=re.subn(r'("anecdote"\s*:\s*)"(?:\\.|[^"\\])*"',lambda match:match[1]+json.dumps(next(values),ensure_ascii=False),source[start:start+length])
assert count==updated
path.write_text(source[:start]+patched+source[start+length:])
(root/'src/data/catalog-anecdotes.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'bundled':updated,'wine_specific':sum(r['scope']=='wine' for r in records),'producer_context':sum(r['scope']=='producer' for r in records)}))
